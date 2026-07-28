import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import machineIdModule from 'node-machine-id';
import db from '../database.js';
import { ensureHashedPin } from '../pinAuth.js';
import { uuidv4 } from '../cloudIdUtils.js';
import {
  bindSerialToMachine,
  fetchRemoteSerialBinding,
  getLocalMachineId,
  tryParseSerialFormat,
} from './licenseSerial.service.js';
import {
  ACTIVATION_VOUCHER_KIND,
  materializeMachineLicenseFromVoucher,
  verifyActivationVoucher,
} from '../../lib/licensing/signMachineLicense.js';
import { LICENSE_IN_USE_MESSAGE } from '../../lib/licensing/licenseConflict.js';
import {
  normalizeCapabilities,
  normalizeVertical,
} from '../utils/tenantCapabilities.js';

const { machineIdSync } = machineIdModule;

const runDb = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) return reject(err);
      resolve(this);
    });
  });

const getDb = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row ?? null);
    });
  });

function normalizeText(value) {
  return String(value ?? '').trim();
}

function normalizeOptionalVertical(value, fallbackCommerceType = null) {
  const raw = normalizeText(value);
  if (!raw) return null;
  return normalizeVertical(raw, fallbackCommerceType);
}

function normalizeOptionalCapabilitiesJson(value, vertical = null, fallbackCommerceType = null) {
  if (value == null) return null;
  if (typeof value === 'string' && !value.trim()) return null;
  return JSON.stringify(normalizeCapabilities(value, vertical, fallbackCommerceType));
}

function hashLicenseKey(licenseKey) {
  return crypto.createHash('sha256').update(String(licenseKey ?? '')).digest('hex');
}

export function resolveLicenseHmacSecret() {
  return normalizeText(
    process.env.POS_LICENSE_HMAC_SECRET ||
    process.env.LICENSE_HMAC_SECRET
  );
}

function allowUnsignedLicenseFallback() {
  const raw = normalizeText(process.env.POS_LICENSE_ALLOW_UNSIGNED).toLowerCase();
  return ['1', 'true', 'yes', 'y'].includes(raw);
}

function buildCanonicalLicensePayload(payload) {
  const tenant_id = normalizeText(payload?.tenant_id);
  const machine_id = normalizeText(payload?.machine_id);
  const expiration = normalizeText(payload?.expiration || payload?.expires_at);
  return { tenant_id, machine_id, expiration };
}

function signCanonicalLicensePayload(canonicalPayload, secret) {
  return crypto
    .createHmac('sha256', secret)
    .update(JSON.stringify(canonicalPayload))
    .digest('hex');
}

function timingSafeEqualHex(a, b) {
  const left = Buffer.from(String(a ?? ''), 'utf8');
  const right = Buffer.from(String(b ?? ''), 'utf8');
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function verifyLicenseSignature(payload) {
  const signature = normalizeText(payload?.signature);
  const secret = resolveLicenseHmacSecret();
  const allowUnsigned = allowUnsignedLicenseFallback();

  if (!signature) {
    if (allowUnsigned) return { ok: true, mode: 'unsigned-fallback' };
    return { ok: false, error: 'Licença sem assinatura (signature).' };
  }
  if (!secret) {
    return { ok: false, error: 'POS_LICENSE_HMAC_SECRET não configurado para validar assinatura.' };
  }

  const canonicalPayload = buildCanonicalLicensePayload(payload);
  const expectedSignature = signCanonicalLicensePayload(canonicalPayload, secret);
  const matches = timingSafeEqualHex(signature, expectedSignature);
  if (!matches) {
    return { ok: false, error: 'Assinatura da licença inválida (tampering detectado).' };
  }

  return { ok: true, mode: 'signed' };
}

function resolveSetupConfigPath() {
  const explicitPath = normalizeText(process.env.POS_CONFIG_PATH);
  if (explicitPath) return path.resolve(explicitPath);

  const userDataPath = normalizeText(process.env.POS_USER_DATA_PATH);
  if (userDataPath) {
    return path.join(userDataPath, 'config.json');
  }
  return path.resolve(process.cwd(), 'data', 'config.json');
}

export function resolveLicensePath() {
  const explicitPath = normalizeText(process.env.POS_LICENSE_PATH);
  if (explicitPath) return path.resolve(explicitPath);

  const userDataPath = normalizeText(process.env.POS_USER_DATA_PATH);
  if (userDataPath) {
    return path.join(userDataPath, 'license.json');
  }
  return path.resolve(process.cwd(), 'data', 'license.json');
}

async function ensureParentDir(filePath) {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
}

function parseBooleanFromEnv(name, fallback = false) {
  const value = normalizeText(process.env[name]).toLowerCase();
  if (!value) return fallback;
  return ['1', 'true', 'yes', 'y'].includes(value);
}

function parseLicenseToken(rawToken) {
  const raw = normalizeText(rawToken);
  if (!raw) return { payload: null, error: 'Chave de licença é obrigatória.' };

  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      return { payload: parsed, error: null };
    }
  } catch {
    // try base64(JSON)
  }

  try {
    const normalized = raw.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    const decoded = Buffer.from(padded, 'base64').toString('utf8');
    const parsed = JSON.parse(decoded);
    if (parsed && typeof parsed === 'object') {
      return { payload: parsed, error: null };
    }
  } catch {
    // ignored
  }

  return { payload: null, error: 'Formato da chave de licença inválido.' };
}

export function validateMachineBoundLicense(payload, expectedTenantId = null) {
  if (!payload || typeof payload !== 'object') {
    return { ok: false, error: 'Licença inválida.' };
  }

  const signatureCheck = verifyLicenseSignature(payload);
  if (!signatureCheck.ok) {
    return { ok: false, error: signatureCheck.error || 'Assinatura da licença inválida.' };
  }

  const canonicalPayload = buildCanonicalLicensePayload(payload);
  const tenantId = canonicalPayload.tenant_id;
  const machineId = canonicalPayload.machine_id;
  const expirationRaw = canonicalPayload.expiration;

  if (!tenantId) return { ok: false, error: 'Licença sem tenant_id.' };
  if (!machineId) return { ok: false, error: 'Licença sem machine_id.' };
  if (!expirationRaw) return { ok: false, error: 'Licença sem expiração.' };

  if (expectedTenantId && tenantId !== normalizeText(expectedTenantId)) {
    return {
      ok: false,
      error: LICENSE_IN_USE_MESSAGE,
    };
  }

  const localMachineId = machineIdSync({ original: true });
  if (machineId !== localMachineId) {
    return {
      ok: false,
      error: LICENSE_IN_USE_MESSAGE,
    };
  }

  const expiresAt = new Date(expirationRaw);
  if (Number.isNaN(expiresAt.getTime())) {
    return { ok: false, error: 'Data de expiração da licença inválida.' };
  }
  if (Date.now() > expiresAt.getTime()) {
    return { ok: false, error: 'Licença expirada.' };
  }

  return {
    ok: true,
    tenantId,
    machineId,
    expiresAt: expiresAt.toISOString(),
    signatureMode: signatureCheck.mode,
  };
}

export async function readFirstRunStatus() {
  const dbPath = normalizeText(process.env.POS_DB_PATH);
  const dbExists = dbPath ? await fs.access(dbPath).then(() => true).catch(() => false) : false;
  const tenantRow = await getDb(`SELECT id, name FROM tenants ORDER BY datetime(created_at) ASC, id ASC LIMIT 1`);
  const tenantExists = Boolean(tenantRow?.id);

  const setupRow = await getDb(
    `SELECT admin_password_set, license_activated, setup_completed, printer_type, setup_completed_at
     FROM app_setup_state
     WHERE id = 1
     LIMIT 1`
  );
  const adminPasswordSet = Number(setupRow?.admin_password_set ?? 0) === 1;
  const licenseActivated = Number(setupRow?.license_activated ?? 0) === 1;
  const setupCompleted = Number(setupRow?.setup_completed ?? 0) === 1;
  const inferredLegacyCompletion = adminPasswordSet && licenseActivated && tenantExists;

  const hadDatabaseOnBoot = parseBooleanFromEnv('POS_DB_EXISTED_BEFORE_BOOT', dbExists);
  const isSetupComplete = (setupCompleted || inferredLegacyCompletion) && tenantExists;

  return {
    dbPath: dbPath || null,
    dbExists,
    hadDatabaseOnBoot,
    tenantExists,
    tenantId: tenantRow?.id ? String(tenantRow.id) : null,
    tenantName: tenantRow?.name ? String(tenantRow.name) : null,
    adminPasswordSet,
    licenseActivated,
    printerType: setupRow?.printer_type ? String(setupRow.printer_type) : null,
    setupCompleted,
    setupCompletedAt: setupRow?.setup_completed_at ? String(setupRow.setup_completed_at) : null,
    isSetupComplete,
    setupConfigPath: resolveSetupConfigPath(),
    licensePath: resolveLicensePath(),
    requiresWizard: !isSetupComplete,
  };
}

async function applyRemoteLicenseSnapshot(remote) {
  const snap = remote?.license_snapshot;
  const tenant = remote?.tenant;
  const profile = remote?.tenant_profile;
  if (!snap?.id || !snap.tenant_id) {
    throw new Error('Resposta do servidor de licenças incompleta.');
  }
  const now = new Date().toISOString();
  const commerceType = normalizeText(profile?.commerce_type) || 'retalho';
  const vertical = normalizeOptionalVertical(profile?.vertical, commerceType);
  const capabilitiesJson = normalizeOptionalCapabilitiesJson(
    profile?.capabilities_json,
    vertical,
    commerceType,
  );
  await runDb(
    `INSERT INTO tenants (id, name, created_at)
     VALUES (?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name`,
    [snap.tenant_id, tenant?.name || snap.tenant_id, now]
  );
  await runDb(
    `INSERT INTO tenant_profile (id, name, nuit, license_type, commerce_type, vertical, capabilities_json, created_at, updated_at)
     VALUES (?, ?, ?, 'BASIC', ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       nuit = excluded.nuit,
       commerce_type = COALESCE(excluded.commerce_type, tenant_profile.commerce_type),
       vertical = COALESCE(excluded.vertical, tenant_profile.vertical),
       capabilities_json = COALESCE(excluded.capabilities_json, tenant_profile.capabilities_json),
       updated_at = excluded.updated_at`,
    [
      snap.tenant_id,
      profile?.name || tenant?.name || snap.tenant_id,
      profile?.nuit ?? null,
      commerceType,
      vertical,
      capabilitiesJson,
      now,
      now,
    ]
  );
  await runDb(
    `INSERT INTO licenses (
       id,
       tenant_id,
       license_key,
       plan,
       expires_at,
       active,
       created_at,
       serial_number,
       machine_id,
       activated_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       tenant_id = excluded.tenant_id,
       license_key = excluded.license_key,
       plan = excluded.plan,
       expires_at = excluded.expires_at,
       active = excluded.active,
       serial_number = excluded.serial_number,
       machine_id = excluded.machine_id,
       activated_at = excluded.activated_at`,
    [
      snap.id,
      snap.tenant_id,
      snap.license_key,
      snap.plan ?? 'BASIC',
      snap.expires_at,
      Number(snap.active ?? 1) !== 0 ? 1 : 0,
      now,
      snap.serial_number,
      snap.machine_id,
      snap.activated_at || now,
    ]
  );
}

export async function runInitialSetup(payload) {
  const storeName = normalizeText(payload?.storeName);
  const nuit = normalizeText(payload?.nuit);
  const adminName = normalizeText(payload?.adminName);
  const adminPin = normalizeText(payload?.adminPin);
  const printerType = normalizeText(payload?.printerType);
  const licenseKey = normalizeText(payload?.licenseKey);

  if (storeName.length < 2) return { error: 'Nome da loja deve conter pelo menos 2 caracteres.', status: 400 };
  if (!nuit) return { error: 'NUIT é obrigatório.', status: 400 };
  if (adminName.length < 2) return { error: 'Nome do admin deve conter pelo menos 2 caracteres.', status: 400 };
  if (adminPin.length < 4) return { error: 'PIN do admin deve conter pelo menos 4 caracteres.', status: 400 };
  if (!printerType) return { error: 'Tipo de impressora é obrigatório.', status: 400 };
  if (licenseKey.length < 4) return { error: 'Chave de licença inválida.', status: 400 };

  const dbPath = normalizeText(process.env.POS_DB_PATH);
  if (dbPath) {
    await fs.mkdir(path.dirname(dbPath), { recursive: true });
    await fs.writeFile(dbPath, '', { flag: 'a' });
  }

  const status = await readFirstRunStatus();
  if (status.isSetupComplete) {
    return { error: 'Setup já foi concluído nesta instalação.', status: 409 };
  }

  const serialCandidate = tryParseSerialFormat(licenseKey);
  let licenseValidation = null;
  let parsedLicense = null;
  let licenseFilePayload = null;
  let serialMode = false;
  let voucherMode = false;

  if (serialCandidate) {
    serialMode = true;
    const machineIdLocal = getLocalMachineId();
    let bind = await bindSerialToMachine(licenseKey, machineIdLocal);
    if (!bind.ok && bind.status === 404 && normalizeText(process.env.POS_LICENSE_SERVER_URL)) {
      try {
        const remote = await fetchRemoteSerialBinding(licenseKey, machineIdLocal);
        await applyRemoteLicenseSnapshot(remote);
        bind = await bindSerialToMachine(licenseKey, machineIdLocal);
      } catch (err) {
        return {
          error: err instanceof Error ? err.message : 'Falha na ativação remota da licença.',
          status: 400,
        };
      }
    }
    if (!bind.ok) {
      return { error: bind.error, status: bind.status ?? 400 };
    }
    const expiresIso =
      bind.expiresAt && String(bind.expiresAt).trim()
        ? new Date(bind.expiresAt).toISOString()
        : null;
    licenseValidation = {
      ok: true,
      tenantId: bind.tenantId,
      machineId: machineIdLocal,
      expiresAt: expiresIso,
      licenseId: bind.licenseId,
    };
  } else {
    const parsed = parseLicenseToken(licenseKey);
    if (parsed.error || !parsed.payload) {
      return {
        error:
          parsed.error ||
          'Informe o número de série (ex.: D_9L6WAKYU) ou o Base64/JSON gerado na consola de licenças.',
        status: 400,
      };
    }
    parsedLicense = parsed;
    const payload = parsed.payload;
    const secret = resolveLicenseHmacSecret();
    const machineIdLocal = getLocalMachineId();

    if (String(payload?.kind ?? '').trim() === ACTIVATION_VOUCHER_KIND) {
      const voucherCheck = verifyActivationVoucher(payload, secret);
      if (!voucherCheck.ok) {
        return { error: voucherCheck.error || 'Código de ativação inválido.', status: 400 };
      }
      const voucherTenantId = voucherCheck.voucher.tenant_id;
      // Antes da licença estar activada, ignorar o tenant seed (ex.: tenant-1) — o tenant vem do voucher.
      if (
        status.licenseActivated &&
        status.tenantId &&
        voucherTenantId !== normalizeText(status.tenantId)
      ) {
        return {
          error: LICENSE_IN_USE_MESSAGE,
          status: 400,
        };
      }
      try {
        licenseFilePayload = materializeMachineLicenseFromVoucher(
          voucherCheck.voucher,
          machineIdLocal,
          secret,
        );
      } catch {
        return { error: 'Falha ao gerar licença para esta máquina.', status: 400 };
      }
      licenseFilePayload.voucher_nonce = voucherCheck.voucher.nonce;
      licenseFilePayload.activated_at = new Date().toISOString();
      voucherMode = true;
      licenseValidation = {
        tenantId: voucherTenantId,
        machineId: machineIdLocal,
        expiresAt: voucherCheck.voucher.expiration,
      };
    } else {
      const validated = validateMachineBoundLicense(
        payload,
        status.licenseActivated ? status.tenantId : null,
      );
      if (!validated.ok) {
        return { error: validated.error || 'Licença inválida.', status: 400 };
      }
      licenseValidation = validated;
      licenseFilePayload = {
        ...payload,
        tenant_id: validated.tenantId,
        machine_id: validated.machineId,
        expiration: validated.expiresAt,
      };
    }
  }

  const now = new Date().toISOString();
  const tenantId =
    serialMode || voucherMode
      ? licenseValidation.tenantId
      : status.tenantId || licenseValidation.tenantId || `tenant-${uuidv4()}`;
  const adminId = 'admin-local';
  const adminPinHash = await ensureHashedPin(adminPin);
  const licenseHash = hashLicenseKey(licenseKey);
  const licenseMeta = licenseFilePayload || parsedLicense?.payload || null;
  const inferredCommerceType = normalizeText(
    licenseMeta?.commerce_type || licenseMeta?.vertical,
  ) || 'retalho';
  const vertical = normalizeOptionalVertical(licenseMeta?.vertical, inferredCommerceType);
  const capabilitiesJson = normalizeOptionalCapabilitiesJson(
    licenseMeta?.capabilities_json ?? licenseMeta?.capabilities,
    vertical,
    inferredCommerceType,
  );

  await runDb(
    `INSERT INTO tenants (id, name, created_at)
     VALUES (?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name`,
    [tenantId, storeName, now]
  );

  await runDb(
    `INSERT INTO tenant_profile (id, name, nuit, license_type, commerce_type, vertical, capabilities_json, created_at, updated_at)
     VALUES (?, ?, ?, 'LOCAL', ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       nuit = excluded.nuit,
       commerce_type = COALESCE(excluded.commerce_type, tenant_profile.commerce_type),
       vertical = COALESCE(excluded.vertical, tenant_profile.vertical),
       capabilities_json = COALESCE(excluded.capabilities_json, tenant_profile.capabilities_json),
       updated_at = excluded.updated_at`,
    [tenantId, storeName, nuit, inferredCommerceType, vertical, capabilitiesJson, now, now]
  );

  await runDb(
    `UPDATE company_profile
     SET name = ?, tax_id = ?, updated_at = ?
     WHERE id = 1`,
    [storeName, nuit, now]
  );

  await runDb(
    `INSERT INTO users (id, name, surname, email, role, pin, access_level, active, is_system, tenant_id, cloud_id, updated_at)
     VALUES (?, ?, NULL, NULL, 'admin', ?, 9, 1, 1, ?, NULL, ?)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       role = 'admin',
       pin = excluded.pin,
       access_level = 9,
       active = 1,
       is_system = 1,
       tenant_id = excluded.tenant_id,
       cloud_id = NULL,
       updated_at = excluded.updated_at`,
    [adminId, adminName, adminPinHash, tenantId, now]
  );

  if (serialMode) {
    await runDb(
      `UPDATE licenses
       SET active = 1,
           expires_at = COALESCE(expires_at, ?)
       WHERE id = ?`,
      [licenseValidation.expiresAt, licenseValidation.licenseId]
    );
  } else {
    await runDb(
      `INSERT INTO licenses (id, tenant_id, license_key, plan, expires_at, active, created_at)
       VALUES (?, ?, ?, 'LOCAL', ?, 1, ?)
       ON CONFLICT(id) DO UPDATE SET
         tenant_id = excluded.tenant_id,
         license_key = excluded.license_key,
         plan = excluded.plan,
         expires_at = excluded.expires_at,
         active = 1`,
      [`license-${tenantId}`, tenantId, licenseKey, licenseValidation.expiresAt, now]
    );
  }

  await runDb(
    `UPDATE app_setup_state
     SET admin_password_set = 1,
         license_activated = 1,
         license_token_hash = ?,
         license_expires_at = ?,
         printer_type = ?,
         setup_completed = 1,
         setup_completed_at = ?,
         updated_at = ?
     WHERE id = 1`,
    [licenseHash, licenseValidation.expiresAt, printerType, now, now]
  );

  const setupConfigPath = resolveSetupConfigPath();
  await ensureParentDir(setupConfigPath);
  const licensePath = resolveLicensePath();
  await ensureParentDir(licensePath);

  await fs.writeFile(
    setupConfigPath,
    JSON.stringify(
      {
        setupCompleted: true,
        setupCompletedAt: now,
        tenantId,
        storeName,
        nuit,
        printerType,
        machineId: licenseValidation.machineId,
        licenseExpiresAt: licenseValidation.expiresAt,
        licenseKeyHash: licenseHash,
        licenseMode: serialMode ? 'serial' : voucherMode ? 'voucher' : 'signed',
      },
      null,
      2
    ),
    'utf8'
  );

  if (serialMode) {
    await fs.writeFile(
      licensePath,
      JSON.stringify(
        {
          mode: 'serial',
          serial_number: serialCandidate,
          tenant_id: tenantId,
          machine_id: licenseValidation.machineId,
          expiration: licenseValidation.expiresAt,
          activated_at: now,
        },
        null,
        2
      ),
      'utf8'
    );
  } else {
    const toWrite = licenseFilePayload
      ? {
          ...licenseFilePayload,
          tenant_id: tenantId,
          machine_id: licenseValidation.machineId,
          expiration: licenseValidation.expiresAt,
          activated_at: licenseFilePayload.activated_at || now,
        }
      : {
          ...parsedLicense.payload,
          tenant_id: tenantId,
          machine_id: licenseValidation.machineId,
          expiration: licenseValidation.expiresAt,
          activated_at: now,
        };
    await fs.writeFile(licensePath, JSON.stringify(toWrite, null, 2), 'utf8');
  }

  return {
    success: true,
    tenantId,
    adminId,
    setupConfigPath,
    licensePath,
    setupCompletedAt: now,
  };
}

function resolveIssuerBaseUrl() {
  return normalizeText(process.env.POS_LICENSE_ISSUER_BASE_URL);
}

async function callLicenseIssuer(pathSuffix, body, timeoutMs = 20000) {
  const issuerBaseUrl = resolveIssuerBaseUrl();
  if (!issuerBaseUrl) {
    return {
      ok: false,
      error:
        'POS_LICENSE_ISSUER_BASE_URL não configurado. Defina a URL da consola de licenças no .env.',
      status: 503,
    };
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
        error: normalizeText(data?.error) || `${res.status} ${res.statusText}`,
        status: res.status,
        data,
      };
    }
    return { ok: true, data };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      status: 502,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Proxy: serial → lojas no servidor da consola.
 */
export async function lookupSerialStores(serialRaw) {
  const serial = tryParseSerialFormat(serialRaw);
  if (!serial) {
    return {
      error: 'Formato de número de série inválido. Use o formato X_XXXXXXXX (ex.: D_9L6WAKYU).',
      status: 400,
    };
  }

  const remote = await callLicenseIssuer('/api/license-issuer/serial/lookup', { serial });
  if (!remote.ok) {
    return { error: remote.error, status: remote.status ?? 502, stores: [] };
  }

  const stores = Array.isArray(remote.data?.stores) ? remote.data.stores : [];
  return {
    success: true,
    serial: remote.data?.serial || serial,
    redeemed: Boolean(remote.data?.redeemed),
    stores,
  };
}

/**
 * Instalação mínima: serial → loja do servidor.
 * A senha do admin é definida depois, no ecrã de login.
 * NUIT/impressora ficam para configurar dentro do sistema.
 */
export async function runInitializeFromSerial(payload) {
  const serialRaw = normalizeText(payload?.serial ?? payload?.serial_number ?? payload?.licenseKey);
  const tenantIdRequested = normalizeText(payload?.tenantId ?? payload?.tenant_id);
  const adminName = normalizeText(payload?.adminName) || 'Administrador';
  const printerType = normalizeText(payload?.printerType) || 'thermal-80';

  const serial = tryParseSerialFormat(serialRaw);
  if (!serial) {
    return {
      error: 'Formato de número de série inválido. Use o formato X_XXXXXXXX (ex.: D_9L6WAKYU).',
      status: 400,
    };
  }
  if (adminName.length < 2) {
    return { error: 'Nome do admin deve conter pelo menos 2 caracteres.', status: 400 };
  }

  const status = await readFirstRunStatus();
  if (status.isSetupComplete) {
    return { error: 'Setup já foi concluído nesta instalação.', status: 409 };
  }

  const machineId = getLocalMachineId();
  const remote = await callLicenseIssuer('/api/license-issuer/serial/activate', {
    serial,
    machine_id: machineId,
    tenant_id: tenantIdRequested || undefined,
  });
  if (!remote.ok) {
    return { error: remote.error, status: remote.status ?? 502 };
  }

  const data = remote.data || {};
  const tenantId = normalizeText(data.tenant_id);
  const storeName = normalizeText(data.store_name) || tenantId;
  const nuit = normalizeText(data.nuit);
  const expiresAt = normalizeText(data.expires_at) || null;
  const plan = normalizeText(data.plan) || 'LITE';
  const commerceType = normalizeText(data.commerce_type) || 'retalho';
  const vertical = normalizeOptionalVertical(data.vertical, commerceType);
  const capabilitiesJson = normalizeOptionalCapabilitiesJson(
    data.capabilities_json ?? data.capabilities,
    vertical,
    commerceType,
  );
  const licensePayload =
    data.license && typeof data.license === 'object'
      ? data.license
      : null;

  if (!tenantId) {
    return { error: 'Servidor de licenças não devolveu tenant_id.', status: 502 };
  }
  if (!licensePayload) {
    return { error: 'Servidor de licenças não devolveu a licença assinada.', status: 502 };
  }

  const dbPath = normalizeText(process.env.POS_DB_PATH);
  if (dbPath) {
    await fs.mkdir(path.dirname(dbPath), { recursive: true });
    await fs.writeFile(dbPath, '', { flag: 'a' });
  }

  const now = new Date().toISOString();
  const adminId = 'admin-local';
  const licenseHash = hashLicenseKey(serial);

  await runDb(
    `INSERT INTO tenants (id, name, created_at)
     VALUES (?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name`,
    [tenantId, storeName, now],
  );

  await runDb(
    `INSERT INTO tenant_profile (id, name, nuit, license_type, commerce_type, vertical, capabilities_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       nuit = excluded.nuit,
       license_type = excluded.license_type,
       commerce_type = excluded.commerce_type,
       vertical = COALESCE(excluded.vertical, tenant_profile.vertical),
       capabilities_json = COALESCE(excluded.capabilities_json, tenant_profile.capabilities_json),
       updated_at = excluded.updated_at`,
    [tenantId, storeName, nuit, plan, commerceType, vertical, capabilitiesJson, now, now],
  );

  await runDb(
    `UPDATE company_profile
     SET name = ?, tax_id = ?, updated_at = ?
     WHERE id = 1`,
    [storeName, nuit, now],
  );

  // Admin sem PIN: a senha é configurada no ecrã de login.
  await runDb(
    `INSERT INTO users (id, name, surname, email, role, pin, access_level, active, is_system, tenant_id, cloud_id, updated_at)
     VALUES (?, ?, NULL, NULL, 'admin', '', 9, 1, 1, ?, NULL, ?)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       role = 'admin',
       pin = '',
       access_level = 9,
       active = 1,
       is_system = 1,
       tenant_id = excluded.tenant_id,
       cloud_id = NULL,
       updated_at = excluded.updated_at`,
    [adminId, adminName, tenantId, now],
  );

  await runDb(
    `INSERT INTO licenses (id, tenant_id, license_key, plan, expires_at, active, created_at, serial_number, machine_id, activated_at)
     VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       tenant_id = excluded.tenant_id,
       license_key = excluded.license_key,
       plan = excluded.plan,
       expires_at = excluded.expires_at,
       active = 1,
       serial_number = excluded.serial_number,
       machine_id = excluded.machine_id,
       activated_at = excluded.activated_at`,
    [
      `license-${tenantId}`,
      tenantId,
      serial,
      plan,
      expiresAt,
      now,
      serial,
      machineId,
      now,
    ],
  );

  await runDb(
    `UPDATE app_setup_state
     SET admin_password_set = 0,
         license_activated = 1,
         license_token_hash = ?,
         license_expires_at = ?,
         printer_type = ?,
         setup_completed = 1,
         setup_completed_at = ?,
         updated_at = ?
     WHERE id = 1`,
    [licenseHash, expiresAt, printerType, now, now],
  );

  const setupConfigPath = resolveSetupConfigPath();
  await ensureParentDir(setupConfigPath);
  const licensePath = resolveLicensePath();
  await ensureParentDir(licensePath);

  await fs.writeFile(
    setupConfigPath,
    JSON.stringify(
      {
        setupCompleted: true,
        setupCompletedAt: now,
        tenantId,
        storeName,
        nuit,
        printerType,
        machineId,
        licenseExpiresAt: expiresAt,
        licenseKeyHash: licenseHash,
        licenseMode: 'serial-issuer',
        serialNumber: serial,
      },
      null,
      2,
    ),
    'utf8',
  );

  const toWrite = {
    ...licensePayload,
    tenant_id: tenantId,
    machine_id: machineId,
    expiration: expiresAt,
    serial_number: serial,
    activated_at: licensePayload.activated_at || now,
  };
  await fs.writeFile(licensePath, JSON.stringify(toWrite, null, 2), 'utf8');

  return {
    success: true,
    tenantId,
    storeName,
    nuit,
    adminId,
    serial,
    setupConfigPath,
    licensePath,
    setupCompletedAt: now,
  };
}
