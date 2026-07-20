import fs from 'fs/promises';
import path from 'path';
import db from '../database.js';
import {
  encodeLicenseBase64,
  verifySignedMachineLicense,
} from '../../lib/licensing/signMachineLicense.js';
import {
  resignMachineLicensePayload,
  verifyOfflineReactivationToken,
} from '../../lib/licensing/offlineReactivationToken.js';
import { normalizeReactivationTokenInput } from '../../lib/licensing/reactivationToken.js';
import { getLocalMachineId } from './licenseSerial.service.js';
import {
  resolveLicensePath,
  resolveLicenseHmacSecret,
  validateMachineBoundLicense,
} from './setup.service.js';

const runDb = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) return reject(err);
      resolve(this);
    });
  });

function normalizeText(value) {
  return String(value ?? '').trim();
}

function resolveIssuerBaseUrl() {
  return normalizeText(process.env.POS_LICENSE_ISSUER_BASE_URL);
}

export async function readLocalLicenseFile() {
  const licensePath = resolveLicensePath();
  try {
    const raw = await fs.readFile(licensePath, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') {
      return { ok: false, error: 'Ficheiro de licença inválido.', licensePath };
    }
    return { ok: true, payload: parsed, licensePath, raw };
  } catch (err) {
    if (err && typeof err === 'object' && err.code === 'ENOENT') {
      return { ok: false, error: 'Licença não encontrada nesta instalação.', licensePath };
    }
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Falha ao ler licença local.',
      licensePath,
    };
  }
}

function licenseKeyFromPayload(payload) {
  try {
    return encodeLicenseBase64(payload);
  } catch {
    return JSON.stringify(payload);
  }
}

async function callIssuer(pathSuffix, body, timeoutMs = 15000) {
  const issuerBaseUrl = resolveIssuerBaseUrl();
  if (!issuerBaseUrl) {
    return { ok: false, skipped: true, error: 'POS_LICENSE_ISSUER_BASE_URL não configurado.' };
  }

  const url = `${issuerBaseUrl.replace(/\/$/, '')}${pathSuffix}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return {
        ok: false,
        skipped: false,
        error: normalizeText(data?.error) || `${res.status} ${res.statusText}`,
        status: res.status,
      };
    }
    return { ok: true, skipped: false, data };
  } catch (err) {
    return {
      ok: false,
      skipped: false,
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    clearTimeout(timer);
  }
}

async function persistLicenseState({
  tenantId,
  expiresAt,
  licenseKey,
  machineId,
  plan = 'LOCAL',
  licensePayload = null,
}) {
  const now = new Date().toISOString();
  const licenseId = `license-${tenantId}`;

  await runDb(
    `INSERT INTO licenses (id, tenant_id, license_key, plan, expires_at, active, created_at, machine_id, activated_at)
     VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       tenant_id = excluded.tenant_id,
       license_key = excluded.license_key,
       plan = excluded.plan,
       expires_at = excluded.expires_at,
       active = 1,
       machine_id = excluded.machine_id,
       activated_at = excluded.activated_at`,
    [licenseId, tenantId, licenseKey, plan, expiresAt, now, machineId, now],
  );

  await runDb(
    `UPDATE app_setup_state
     SET license_activated = 1,
         license_expires_at = ?,
         updated_at = ?
     WHERE id = 1`,
    [expiresAt, now],
  );

  if (licensePayload) {
    const licensePath = resolveLicensePath();
    await fs.mkdir(path.dirname(licensePath), { recursive: true });
    await fs.writeFile(licensePath, JSON.stringify(licensePayload, null, 2), 'utf8');
  }

  return { tenantId, expiresAt, licenseId };
}

export async function acknowledgeLicenseFile() {
  const file = await readLocalLicenseFile();
  if (!file.ok) {
    return { error: file.error, status: 404 };
  }

  const payload = file.payload;
  const serialMode = normalizeText(payload?.mode) === 'serial';

  if (serialMode) {
    const tenantId = normalizeText(payload.tenant_id);
    const expiresAt = normalizeText(payload.expiration || payload.expires_at) || null;
    const machineId = normalizeText(payload.machine_id) || getLocalMachineId();
    if (!tenantId) {
      return { error: 'Licença serial sem tenant_id.', status: 400 };
    }
    await persistLicenseState({
      tenantId,
      expiresAt,
      licenseKey: normalizeText(payload.serial_number),
      machineId,
      plan: 'BASIC',
    });
    return { success: true, mode: 'serial', tenantId, expiresAt };
  }

  const validated = validateMachineBoundLicense(payload);
  if (!validated.ok) {
    return { error: validated.error || 'Licença inválida.', status: 400 };
  }

  const licenseKey = licenseKeyFromPayload(payload);
  await persistLicenseState({
    tenantId: validated.tenantId,
    expiresAt: validated.expiresAt,
    licenseKey,
    machineId: validated.machineId,
    plan: 'LOCAL',
  });

  let registry = { synced: false, skipped: true, error: null };
  const activation = await callIssuer('/api/license-issuer/device-activation', {
    license_key: licenseKey,
  });
  if (activation.skipped) {
    registry = { synced: false, skipped: true, error: activation.error };
  } else if (activation.ok) {
    registry = { synced: true, skipped: false, error: null };
  } else {
    registry = { synced: false, skipped: false, error: activation.error };
  }

  return {
    success: true,
    mode: 'signed',
    tenantId: validated.tenantId,
    expiresAt: validated.expiresAt,
    registry,
  };
}

export async function syncLicenseRegistry() {
  const file = await readLocalLicenseFile();
  if (!file.ok) {
    return {
      synced: false,
      skipped: true,
      error: file.error,
      expiresAt: null,
    };
  }

  const payload = file.payload;
  if (normalizeText(payload?.mode) === 'serial') {
    const serial = normalizeText(payload.serial_number);
    const tenantId = normalizeText(payload.tenant_id);
    const expiresAt = normalizeText(payload.expiration || payload.expires_at) || null;
    if (!serial || !tenantId) {
      return { synced: false, skipped: true, error: null, expiresAt };
    }

    const lookup = await callIssuer('/api/license-issuer/serial/lookup', { serial });
    if (!lookup.ok) {
      return {
        synced: false,
        skipped: lookup.skipped,
        error: lookup.error,
        expiresAt,
      };
    }

    const store = Array.isArray(lookup.data?.stores) ? lookup.data.stores[0] : null;
    const displayName = normalizeText(store?.name);
    const nuit = normalizeText(store?.nuit);
    const plan = normalizeText(store?.plan);
    const commerceType = normalizeText(store?.commerce_type) || null;
    const remoteExpires = normalizeText(store?.expires_at) || expiresAt;
    const now = new Date().toISOString();

    if (displayName || nuit || plan || commerceType) {
      await runDb(
        `INSERT INTO tenants (id, name, created_at)
         VALUES (?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET name = COALESCE(?, name)`,
        [tenantId, displayName || tenantId, now, displayName || null],
      );
      await runDb(
        `INSERT INTO tenant_profile (id, name, nuit, license_type, commerce_type, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name = COALESCE(?, name),
           nuit = COALESCE(?, nuit),
           license_type = COALESCE(?, license_type),
           commerce_type = COALESCE(?, commerce_type),
           updated_at = excluded.updated_at`,
        [
          tenantId,
          displayName || tenantId,
          nuit || null,
          plan || 'LITE',
          commerceType || 'retalho',
          now,
          now,
          displayName || null,
          nuit || null,
          plan || null,
          commerceType,
        ],
      );
      if (plan) {
        await runDb(`UPDATE licenses SET plan = ? WHERE tenant_id = ?`, [plan, tenantId]);
      }
    }
    if (remoteExpires) {
      await runDb(
        `UPDATE app_setup_state SET license_expires_at = ?, updated_at = ? WHERE id = 1`,
        [remoteExpires, now],
      );
      await runDb(`UPDATE licenses SET expires_at = ? WHERE tenant_id = ?`, [remoteExpires, tenantId]);
    }

    return {
      synced: true,
      skipped: false,
      error: null,
      expiresAt: remoteExpires,
      tenantId,
      plan: plan || null,
      displayName: displayName || null,
      nuit: nuit || null,
    };
  }

  const secret = resolveLicenseHmacSecret();
  if (!secret) {
    return {
      synced: false,
      skipped: true,
      error: 'POS_LICENSE_HMAC_SECRET não configurado.',
      expiresAt: normalizeText(payload.expiration || payload.expires_at) || null,
    };
  }

  const verified = verifySignedMachineLicense(payload, secret);
  if (!verified.ok) {
    return {
      synced: false,
      skipped: false,
      error: verified.error || 'Licença local inválida.',
      expiresAt: null,
    };
  }

  const licenseKey = licenseKeyFromPayload(payload);
  const status = await callIssuer('/api/license-issuer/device-status', { license_key: licenseKey });
  if (status.skipped) {
    return {
      synced: false,
      skipped: true,
      error: status.error,
      expiresAt: verified.license.expiration,
    };
  }
  if (!status.ok) {
    return {
      synced: false,
      skipped: false,
      error: status.error,
      expiresAt: verified.license.expiration,
    };
  }

  const remoteExpiresAt = normalizeText(status.data?.license_expires_at);
  const localExpiresAt = verified.license.expiration;
  const effectiveExpiresAt = remoteExpiresAt || localExpiresAt;

  if (remoteExpiresAt && Date.parse(remoteExpiresAt) > Date.parse(localExpiresAt)) {
    const updatedPayload = resignMachineLicensePayload(payload, remoteExpiresAt, secret);
    await persistLicenseState({
      tenantId: verified.license.tenant_id,
      expiresAt: remoteExpiresAt,
      licenseKey: licenseKeyFromPayload(updatedPayload),
      machineId: verified.license.machine_id,
      plan: normalizeText(status.data?.plan) || 'LOCAL',
      licensePayload: updatedPayload,
    });
  } else if (remoteExpiresAt) {
    await runDb(
      `UPDATE app_setup_state SET license_expires_at = ?, updated_at = ? WHERE id = 1`,
      [remoteExpiresAt, new Date().toISOString()],
    );
    await runDb(
      `UPDATE licenses SET expires_at = ? WHERE tenant_id = ?`,
      [remoteExpiresAt, verified.license.tenant_id],
    );
  }

  const plan = normalizeText(status.data?.plan);
  const nuit = normalizeText(status.data?.nuit);
  const displayName = normalizeText(status.data?.display_name);
  const commerceType = normalizeText(status.data?.commerce_type) || null;
  if (plan || nuit || displayName || commerceType) {
    const tenantId = verified.license.tenant_id;
    const now = new Date().toISOString();

    await runDb(
      `INSERT INTO tenants (id, name, created_at)
       VALUES (?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = COALESCE(?, name)`,
      [tenantId, displayName || tenantId, now, displayName || null],
    );

    await runDb(
      `INSERT INTO tenant_profile (id, name, nuit, license_type, commerce_type, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = COALESCE(?, name),
         nuit = COALESCE(?, nuit),
         license_type = COALESCE(?, license_type),
         commerce_type = COALESCE(?, commerce_type),
         updated_at = excluded.updated_at`,
      [
        tenantId,
        displayName || tenantId,
        nuit || null,
        plan || 'LITE',
        commerceType || 'retalho',
        now,
        now,
        displayName || null,
        nuit || null,
        plan || null,
        commerceType,
      ],
    );

    if (plan) {
      await runDb(`UPDATE licenses SET plan = ? WHERE tenant_id = ?`, [plan, tenantId]);
    }
  }

  return {
    synced: true,
    skipped: false,
    error: null,
    expiresAt: effectiveExpiresAt,
    tenantId: verified.license.tenant_id,
    plan: plan || null,
    displayName: displayName || null,
    nuit: nuit || null,
  };
}

export async function redeemReactivationToken(rawToken) {
  const tokenDigits = normalizeReactivationTokenInput(rawToken);
  if (!tokenDigits) {
    return { error: 'Token inválido. Introduza os 12 dígitos.', status: 400 };
  }

  const file = await readLocalLicenseFile();
  const localPayload = file.ok ? file.payload : null;
  const secret = resolveLicenseHmacSecret();
  const machineId = getLocalMachineId();

  if (localPayload && secret) {
    const offline = verifyOfflineReactivationToken(tokenDigits, {
      secret,
      tenantId: localPayload.tenant_id,
      machineId: localPayload.machine_id,
      voucherNonce: localPayload.voucher_nonce,
    });
    if (offline.ok) {
      const updated = resignMachineLicensePayload(
        localPayload,
        offline.expirationIso,
        secret,
      );
      await persistLicenseState({
        tenantId: offline.tenantId,
        expiresAt: offline.expirationIso,
        licenseKey: licenseKeyFromPayload(updated),
        machineId: offline.machineId,
        licensePayload: updated,
      });
      return {
        success: true,
        offline: true,
        tenantId: offline.tenantId,
        expiresAt: offline.expirationIso,
        license: updated,
      };
    }
  }

  const online = await callIssuer('/api/license-issuer/reactivate', {
    token: tokenDigits,
    machine_id: machineId,
  });
  if (online.skipped) {
    return { error: online.error, status: 503 };
  }
  if (!online.ok) {
    return { error: online.error || 'Falha na reativação online.', status: online.status || 400 };
  }

  const licensePayload = online.data?.license;
  const expiresAt = normalizeText(online.data?.license_expires_at);
  const tenantId = normalizeText(online.data?.tenant_id);
  if (!licensePayload || !expiresAt || !tenantId) {
    return { error: 'Resposta da consola incompleta.', status: 502 };
  }

  const fullPayload = {
    ...licensePayload,
    voucher_nonce: licensePayload.voucher_nonce ?? localPayload?.voucher_nonce ?? undefined,
    activated_at: licensePayload.activated_at || new Date().toISOString(),
  };

  await persistLicenseState({
    tenantId,
    expiresAt,
    licenseKey: normalizeText(online.data?.license_key) || licenseKeyFromPayload(fullPayload),
    machineId,
    licensePayload: fullPayload,
  });

  return {
    success: true,
    offline: false,
    tenantId,
    expiresAt,
    license: fullPayload,
    license_key: online.data?.license_key,
  };
}

export function resolveLocalLicenseExpiry(setupRow, licenseFile = null) {
  const fromDb = normalizeText(setupRow?.license_expires_at);
  const fromFile = licenseFile
    ? normalizeText(licenseFile.expiration || licenseFile.expires_at)
    : '';
  const candidate = fromDb || fromFile;
  if (!candidate) return { licenseExpiresAt: null, licenseExpired: false };
  const ms = Date.parse(candidate);
  if (Number.isNaN(ms)) return { licenseExpiresAt: null, licenseExpired: false };
  return {
    licenseExpiresAt: new Date(ms).toISOString(),
    licenseExpired: Date.now() > ms,
  };
}
