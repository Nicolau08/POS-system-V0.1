import fs from 'fs/promises';
import path from 'path';
import { homedir } from 'os';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import machineIdModule from 'node-machine-id';
import db from '../database.js';
import {
  isGenericStoreName,
  pickStoreDisplayName,
  storeNameFromLicensePayload,
} from '../lib/storeDisplayName.js';
import { normalizeReactivationTokenInput } from '../../lib/licensing/reactivationToken.js';
import {
  resignMachineLicensePayload,
  verifyOfflineReactivationToken,
} from '../../lib/licensing/offlineReactivationToken.js';
import { ensureHashedPin } from '../pinAuth.js';
import { validateLicenseAccess } from './user.service.js';
import { uuidv4 } from '../cloudIdUtils.js';
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

/** Preferir a data mais tardia (ficheiro local vs consola) — evita regressão após token offline. */
function pickLaterExpirationIso(fileIso, registryIso) {
  const a = normalizeText(fileIso);
  const b = normalizeText(registryIso);
  const aMs = Date.parse(a);
  const bMs = Date.parse(b);
  if (Number.isFinite(aMs) && Number.isFinite(bMs)) {
    return aMs >= bMs ? a : b;
  }
  if (Number.isFinite(aMs)) return a;
  if (Number.isFinite(bMs)) return b;
  return a || b || null;
}

function hashLicenseKey(licenseKey) {
  return crypto.createHash('sha256').update(String(licenseKey ?? '')).digest('hex');
}

function resolveLicenseHmacSecret() {
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

/**
 * Raiz dos dados por utilizador fora da pasta do projecto (equivalente a userData do Electron).
 * `POS_APP_USERDATA_SUBDIR` — por omissão `POSly` (%APPDATA%\POSly).
 * Instalações antigas (`ai-studio-applet`, `POS System`) não migram automaticamente.
 */
function resolveDefaultUserDataRoot() {
  const subdir = normalizeText(process.env.POS_APP_USERDATA_SUBDIR) || 'POSly';
  const home = homedir();
  if (process.platform === 'win32') {
    return path.join(home, 'AppData', 'Roaming', subdir);
  }
  if (process.platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support', subdir);
  }
  return path.join(home, '.config', subdir);
}

/** Caminho por omissão do license.json (nunca em `cwd/data` do repo). */
function resolveDefaultUserLicensePath() {
  return path.join(resolveDefaultUserDataRoot(), 'license.json');
}

function resolveSetupConfigPath() {
  const explicitPath = normalizeText(process.env.POS_CONFIG_PATH);
  if (explicitPath) return path.resolve(explicitPath);

  const userDataPath = normalizeText(process.env.POS_USER_DATA_PATH);
  if (userDataPath) {
    return path.join(userDataPath, 'config.json');
  }
  return path.join(resolveDefaultUserDataRoot(), 'config.json');
}

function resolveLicensePath() {
  const explicitPath = normalizeText(process.env.POS_LICENSE_PATH);
  if (explicitPath) return path.resolve(explicitPath);

  const userDataPath = normalizeText(process.env.POS_USER_DATA_PATH);
  if (userDataPath) {
    return path.join(userDataPath, 'license.json');
  }
  return resolveDefaultUserLicensePath();
}

/** Same file as `database.js` when `POS_DB_PATH` is unset (`api/pos.db`). */
function resolvePosDbPathForStatus() {
  const explicit = normalizeText(process.env.POS_DB_PATH);
  if (explicit) return path.resolve(explicit);
  const apiDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
  return path.join(apiDir, 'pos.db');
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

function validateMachineBoundLicense(payload, expectedTenantId = null) {
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
    return { ok: false, error: 'tenant_id da licença não corresponde ao tenant local.' };
  }

  const localMachineId = machineIdSync({ original: true });
  if (machineId !== localMachineId) {
    return { ok: false, error: 'Licença vinculada a outra máquina.' };
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

const FOREIGN_TENANT_SQL = `tenant_id IS NOT NULL AND TRIM(tenant_id) <> '' AND tenant_id <> ?`;

/**
 * Remove catálogo/vendas de outros tenants (ex. demo Coca-Cola em tenant-1 após pos:reset-user-data).
 */
async function purgeCatalogAndSalesForOtherTenants(keepTenantId) {
  const params = [keepTenantId];
  const where = FOREIGN_TENANT_SQL;
  await runDb(`DELETE FROM order_items WHERE ${where}`, params);
  await runDb(`DELETE FROM orders WHERE ${where}`, params);
  try {
    await runDb(`DELETE FROM vendas WHERE ${where}`, params);
  } catch {
    // tabela opcional em instalações antigas
  }
  await runDb(`DELETE FROM stock_movements WHERE ${where}`, params);
  await runDb(`DELETE FROM products WHERE ${where}`, params);
  await runDb(`DELETE FROM categories WHERE ${where}`, params);
  await runDb(`DELETE FROM deleted_category_tombstones WHERE ${where}`, params);
}

async function reassignMasterDataToLicensedTenant(keepTenantId, now) {
  await runDb(`UPDATE payment_methods SET tenant_id = ?, updated_at = ? WHERE ${FOREIGN_TENANT_SQL}`, [
    keepTenantId,
    now,
    keepTenantId,
  ]);
  await runDb(`UPDATE clientes SET tenant_id = ?, updated_at = ? WHERE ${FOREIGN_TENANT_SQL}`, [
    keepTenantId,
    now,
    keepTenantId,
  ]);
}

/**
 * Após activar voucher/licença: utilizadores, catálogo e vendas devem usar o tenant da licença,
 * não o tenant seed (tenant-1) criado pelo reset/demo.
 */
async function rebindInstallationToLicensedTenant(licenseTenantId, options = {}) {
  const tenantId = normalizeText(licenseTenantId);
  if (!tenantId) return { rebound: false };

  const displayName = normalizeText(options.displayName);
  const now = new Date().toISOString();

  const misalignedUsers = Number(
    (
      await getDb(
        `SELECT COUNT(*) AS c
         FROM users
         WHERE active = 1
           AND TRIM(COALESCE(tenant_id, '')) <> ''
           AND tenant_id <> ?`,
        [tenantId],
      )
    )?.c ?? 0,
  );
  const foreignProducts = Number(
    (
      await getDb(
        `SELECT COUNT(*) AS c
         FROM products
         WHERE COALESCE(deleted, 0) = 0
           AND ${FOREIGN_TENANT_SQL}`,
        [tenantId],
      )
    )?.c ?? 0,
  );

  if (misalignedUsers === 0 && foreignProducts === 0 && !displayName) {
    return { rebound: false };
  }

  if (misalignedUsers > 0) {
    await runDb(`UPDATE users SET tenant_id = ? WHERE tenant_id <> ?`, [tenantId, tenantId]);
  }

  if (foreignProducts > 0) {
    await purgeCatalogAndSalesForOtherTenants(tenantId);
  }

  await reassignMasterDataToLicensedTenant(tenantId, now);

  if (displayName) {
    await runDb(
      `INSERT INTO tenants (id, name, created_at)
       VALUES (?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name`,
      [tenantId, displayName, now],
    );
    await runDb(
      `INSERT INTO tenant_profile (id, name, nuit, license_type, created_at, updated_at)
       VALUES (?, ?, COALESCE((SELECT nuit FROM tenant_profile WHERE id = ?), '000000000'), 'LICENSE', ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         license_type = excluded.license_type,
         updated_at = excluded.updated_at`,
      [tenantId, displayName, tenantId, now, now],
    );
    await runDb(`UPDATE company_profile SET name = ?, updated_at = ? WHERE id = 1`, [displayName, now]);
  }

  await runDb(`UPDATE licenses SET active = 0 WHERE tenant_id <> ?`, [tenantId]);
  await runDb(`UPDATE licenses SET active = 1 WHERE tenant_id = ?`, [tenantId]);

  return {
    rebound: true,
    usersUpdated: misalignedUsers,
    foreignProductsRemoved: foreignProducts,
  };
}

export async function syncLicenseFileIntoLocalDb() {
  const licensePath = resolveLicensePath();
  let raw;
  try {
    raw = await fs.readFile(licensePath, 'utf8');
  } catch {
    return;
  }
  const parsedLicense = parseLicenseToken(raw);
  if (parsedLicense.error || !parsedLicense.payload) return;
  const v = validateMachineBoundLicense(parsedLicense.payload, null);
  if (!v.ok) return;

  const now = new Date().toISOString();
  const tenantId = v.tenantId;
  const payload = parsedLicense.payload;
  const storeName = normalizeText(payload?.store_name ?? payload?.tenant_name ?? payload?.storeName) || 'Loja';
  const nuit = normalizeText(payload?.nuit ?? payload?.NUIT) || '000000000';

  try {
    await runDb(
      `INSERT INTO tenants (id, name, created_at)
       VALUES (?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name`,
      [tenantId, storeName, now]
    );
    const issuerBase = normalizeText(process.env.POS_LICENSE_ISSUER_BASE_URL);
    if (!issuerBase) {
      await runDb(
        `INSERT INTO tenant_profile (id, name, nuit, license_type, created_at, updated_at)
         VALUES (?, ?, ?, 'LICENSE', ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name,
           nuit = excluded.nuit,
           license_type = excluded.license_type,
           updated_at = excluded.updated_at`,
        [tenantId, storeName, nuit, now, now]
      );
    }
    await runDb(
      `INSERT OR IGNORE INTO app_setup_state (id, admin_password_set, license_activated, updated_at)
       VALUES (1, 0, 0, ?)`,
      [now]
    );
    if (issuerBase) {
      await runDb(
        `INSERT INTO licenses (id, tenant_id, license_key, plan, expires_at, active, created_at)
         VALUES (?, ?, ?, 'REMOTE', ?, 1, ?)
         ON CONFLICT(id) DO UPDATE SET
           tenant_id = excluded.tenant_id,
           license_key = excluded.license_key,
           expires_at = excluded.expires_at,
           active = 1`,
        [`license-${tenantId}`, tenantId, normalizeText(raw), v.expiresAt, now]
      );
    } else {
      await runDb(
        `INSERT INTO licenses (id, tenant_id, license_key, plan, expires_at, active, created_at)
         VALUES (?, ?, ?, 'REMOTE', ?, 1, ?)
         ON CONFLICT(id) DO UPDATE SET
           tenant_id = excluded.tenant_id,
           license_key = excluded.license_key,
           plan = excluded.plan,
           expires_at = excluded.expires_at,
           active = 1`,
        [`license-${tenantId}`, tenantId, normalizeText(raw), v.expiresAt, now]
      );
    }
    await rebindInstallationToLicensedTenant(tenantId, { displayName: storeName });
  } catch (error) {
    console.error('[license-sync] falha ao importar license.json:', error);
  }
}

/**
 * Chamado depois do Electron gravar license.json: importa tenant/licença para a BD
 * e marca license_activated na app_setup_state (sync sozinho já não activa — evita saltar
 * o ecrã de licença após apagar pos.db com license.json antigo).
 */
/**
 * Notifica a consola de licenças (Next) com a licença final: resgata voucher e regista tenant no Supabase.
 * `POS_LICENSE_ISSUER_BASE_URL` — ex. http://localhost:3000 em dev (mesmo repo com `npm run dev`).
 */
/**
 * Puxa validade (e nome) actualizados da consola Supabase → SQLite local.
 * Chamado em /setup/status para o rodapé e bloqueio 403 reflectirem prolongamentos.
 */
export async function syncLicenseRegistryFromIssuer() {
  const base = normalizeText(process.env.POS_LICENSE_ISSUER_BASE_URL);
  if (!base) {
    return { synced: false, skipped: true, error: null };
  }

  const licensePath = resolveLicensePath();
  let raw;
  try {
    raw = await fs.readFile(licensePath, 'utf8');
  } catch {
    return { synced: false, skipped: false, error: 'Ficheiro de licença não encontrado.' };
  }

  const parsedLicense = parseLicenseToken(raw);
  if (parsedLicense.error || !parsedLicense.payload) {
    return { synced: false, skipped: false, error: parsedLicense.error || 'Licença inválida.' };
  }

  const v = validateMachineBoundLicense(parsedLicense.payload, null);
  if (!v.ok) {
    return { synced: false, skipped: false, error: v.error || 'Licença inválida.' };
  }

  const url = `${base.replace(/\/$/, '')}/api/license-issuer/device-status`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ license_key: String(raw ?? '') }),
      signal: ctrl.signal,
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body?.success) {
      const msg = body?.error || `${res.status} ${res.statusText}`;
      return { synced: false, skipped: false, error: msg };
    }

    const expiresAt = normalizeText(body.license_expires_at) || v.expiresAt;
    const tenantId = normalizeText(body.tenant_id) || v.tenantId;
    const displayNameFromIssuer = normalizeText(body.display_name);
    const storeNameFromLicense = storeNameFromLicensePayload(parsedLicense.payload);
    const displayName = pickStoreDisplayName(displayNameFromIssuer, storeNameFromLicense);
    const nuitFromIssuer = normalizeText(body.nuit);
    const planRaw = normalizeText(body.plan).toUpperCase();
    const plan = planRaw === 'PRO' || planRaw === 'LITE' ? planRaw : null;
    const now = new Date().toISOString();

    if (plan) {
      await runDb(
        `UPDATE licenses
         SET expires_at = ?, plan = ?, active = 1
         WHERE tenant_id = ?`,
        [expiresAt, plan, tenantId],
      );
    } else {
      await runDb(
        `UPDATE licenses
         SET expires_at = ?, active = 1
         WHERE tenant_id = ?`,
        [expiresAt, tenantId],
      );
    }
    await runDb(
      `UPDATE app_setup_state SET license_expires_at = ?, updated_at = ? WHERE id = 1`,
      [expiresAt, now],
    );

    const profileName = !isGenericStoreName(displayName) ? displayName : null;

    if (profileName) {
      await runDb(
        `INSERT INTO tenants (id, name, created_at)
         VALUES (?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name`,
        [tenantId, profileName, now],
      );
    }
    await runDb(
      `INSERT INTO tenant_profile (id, name, nuit, license_type, created_at, updated_at)
       VALUES (?, COALESCE(?, 'Loja'), COALESCE(?, '000000000'), COALESCE(?, 'LICENSE'), ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = CASE
           WHEN excluded.name IS NOT NULL AND TRIM(excluded.name) <> '' AND LOWER(TRIM(excluded.name)) NOT IN ('loja', 'store', 'tenant')
           THEN excluded.name
           ELSE tenant_profile.name
         END,
         updated_at = excluded.updated_at`,
      [tenantId, profileName, nuitFromIssuer || null, plan || null, now, now],
    );
    if (profileName) {
      await runDb(
        `UPDATE tenant_profile SET name = ?, updated_at = ? WHERE id = ?`,
        [profileName, now, tenantId],
      );
      await runDb(`UPDATE tenants SET name = ? WHERE id = ?`, [profileName, tenantId]);
      await runDb(`UPDATE company_profile SET name = ?, updated_at = ? WHERE id = 1`, [profileName, now]);
    }
    if (nuitFromIssuer) {
      await runDb(
        `UPDATE tenant_profile SET nuit = ?, updated_at = ? WHERE id = ?`,
        [nuitFromIssuer, now, tenantId],
      );
    }
    if (plan) {
      await runDb(
        `UPDATE tenant_profile SET license_type = ?, updated_at = ? WHERE id = ?`,
        [plan, now, tenantId],
      );
    }

    const tenantRebound = await rebindInstallationToLicensedTenant(tenantId, {
      displayName: profileName || undefined,
    });

    return {
      synced: true,
      skipped: false,
      error: null,
      expiresAt,
      tenantId,
      displayName: profileName || null,
      nuit: nuitFromIssuer || null,
      plan: plan || null,
      tenantRebound,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[license-registry-sync]', msg);
    return { synced: false, skipped: false, error: msg };
  } finally {
    clearTimeout(timer);
  }
}

async function notifyLicenseIssuerDeviceActivation(licenseRaw) {
  const base = normalizeText(process.env.POS_LICENSE_ISSUER_BASE_URL);
  if (!base) {
    return { ok: false, skipped: true, error: null };
  }
  const url = `${base.replace(/\/$/, '')}/api/license-issuer/device-activation`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ license_key: String(licenseRaw ?? '') }),
      signal: ctrl.signal,
    });
    const body = await res.json().catch(() => ({}));
    if (res.ok && body?.success) {
      return { ok: true, skipped: false, error: null, body };
    }
    const msg = body?.error || `${res.status} ${res.statusText}`;
    console.error('[license-issuer-notify]', msg);
    return { ok: false, skipped: false, error: msg, body };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[license-issuer-notify]', msg);
    return { ok: false, skipped: false, error: msg, body: null };
  } finally {
    clearTimeout(timer);
  }
}

export async function acknowledgeLicenseFileOnServer() {
  await syncLicenseFileIntoLocalDb();
  const licensePath = resolveLicensePath();
  let raw;
  try {
    raw = await fs.readFile(licensePath, 'utf8');
  } catch {
    return { error: 'Ficheiro de licença não encontrado.', status: 404 };
  }
  const parsedLicense = parseLicenseToken(raw);
  if (parsedLicense.error || !parsedLicense.payload) {
    return { error: parsedLicense.error || 'Licença inválida.', status: 400 };
  }
  const v = validateMachineBoundLicense(parsedLicense.payload, null);
  if (!v.ok) {
    return { error: v.error || 'Licença inválida.', status: 400 };
  }
  const now = new Date().toISOString();
  await runDb(
    `INSERT OR IGNORE INTO app_setup_state (id, admin_password_set, license_activated, updated_at)
     VALUES (1, 0, 0, ?)`,
    [now]
  );
  const issuerNotify = await notifyLicenseIssuerDeviceActivation(raw);
  const registrySync = await syncLicenseRegistryFromIssuer();
  const expiresAtForSetup = pickLaterExpirationIso(v.expiresAt, registrySync?.expiresAt);
  await runDb(
    `UPDATE app_setup_state SET license_activated = 1, license_expires_at = ?, updated_at = ? WHERE id = 1`,
    [expiresAtForSetup, now]
  );
  const displayName = pickStoreDisplayName(
    registrySync.displayName,
    issuerNotify.ok ? issuerNotify.body?.display_name : '',
    storeNameFromLicensePayload(parsedLicense.payload),
  );
  const rebound = await rebindInstallationToLicensedTenant(v.tenantId, {
    displayName: displayName !== 'Loja' ? displayName : undefined,
  });
  return {
    success: true,
    expiresAt: expiresAtForSetup,
    issuerNotify,
    registrySync,
    tenantRebound: rebound,
  };
}

export async function syncLicenseFromConsole() {
  return syncLicenseRegistryFromIssuer();
}

async function persistRedeemedLicenseFile(licenseToWrite) {
  const validation = validateMachineBoundLicense(licenseToWrite, null);
  if (!validation.ok) {
    return { error: validation.error || 'Licença inválida.', status: 400 };
  }

  const licensePath = resolveLicensePath();
  const payloadToSave = {
    ...licenseToWrite,
    activated_at: licenseToWrite.activated_at || new Date().toISOString(),
  };
  try {
    await ensureParentDir(licensePath);
    await fs.writeFile(licensePath, JSON.stringify(payloadToSave, null, 2), 'utf8');
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { error: `Falha ao gravar license.json: ${msg}`, status: 500 };
  }

  const ack = await acknowledgeLicenseFileOnServer();
  if (ack?.error) {
    return { error: ack.error, status: ack.status ?? 500 };
  }

  return {
    success: true,
    expiresAt: validation.expiresAt,
    tenantId: validation.tenantId,
    ack,
  };
}

async function tryOfflineReactivationRedeem(rawToken) {
  const tokenDigits = normalizeReactivationTokenInput(rawToken);
  if (!tokenDigits) return { offlineInvalid: true, error: 'Token inválido.' };

  const secret = resolveLicenseHmacSecret();
  if (!secret) {
    return {
      error: 'POS_LICENSE_HMAC_SECRET não configurado para validação offline.',
      status: 503,
    };
  }

  let localPayload;
  try {
    const raw = await fs.readFile(resolveLicensePath(), 'utf8');
    const parsed = parseLicenseToken(raw);
    if (parsed.error || !parsed.payload) {
      return {
        error: 'Licença local não encontrada. Use o código Base64 de ativação inicial.',
        status: 404,
      };
    }
    localPayload = parsed.payload;
  } catch {
    return { error: 'Ficheiro license.json não encontrado nesta máquina.', status: 404 };
  }

  const machineId = machineIdSync({ original: true });
  const verified = verifyOfflineReactivationToken(tokenDigits, {
    secret,
    tenantId: localPayload.tenant_id,
    expectedMachineId: machineId,
    licenseMachineId: localPayload.machine_id,
    voucherNonce: localPayload.voucher_nonce,
  });

  if (!verified.ok) {
    return { offlineInvalid: true, error: verified.error || 'Token offline inválido.' };
  }

  const licenseToWrite = resignMachineLicensePayload(localPayload, verified.expirationIso, secret);
  const persisted = await persistRedeemedLicenseFile(licenseToWrite);
  if (persisted?.error) return persisted;

  return { ...persisted, offline: true };
}

/**
 * Resgata token de 12 dígitos: primeiro offline (HMAC), depois consola Supabase (rede).
 */
export async function redeemReactivationTokenOnDevice(rawToken) {
  const tokenDigits = normalizeReactivationTokenInput(rawToken);
  if (!tokenDigits) {
    return { error: 'Token inválido. Introduza os 12 dígitos enviados pela consola.', status: 400 };
  }

  const offlineResult = await tryOfflineReactivationRedeem(rawToken);
  if (offlineResult?.success) {
    return offlineResult;
  }

  const issuerBase = normalizeText(process.env.POS_LICENSE_ISSUER_BASE_URL);
  if (!issuerBase) {
    const offlineMsg = offlineResult?.error ? String(offlineResult.error) : '';
    return {
      error:
        offlineMsg ||
        'POS_LICENSE_ISSUER_BASE_URL não definido — não é possível validar o token online.',
      status: offlineResult?.status ?? 503,
    };
  }

  const machineId = machineIdSync({ original: true });
  const url = `${issuerBase.replace(/\/$/, '')}/api/license-issuer/reactivate`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);

  let body;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: tokenDigits, machine_id: machineId }),
      signal: ctrl.signal,
    });
    body = await res.json().catch(() => ({}));
    if (!res.ok || !body?.success) {
      const msg = body?.error || `${res.status} ${res.statusText}`;
      const offlineHint = offlineResult?.offlineInvalid && offlineResult?.error
        ? `${offlineResult.error} `
        : '';
      return {
        error: `${offlineHint}${msg}`.trim(),
        status: res.status >= 400 && res.status < 600 ? res.status : 502,
      };
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const offlineHint = offlineResult?.error ? `${offlineResult.error}. ` : '';
    return {
      error: `${offlineHint}Sem ligação à consola (${msg}). O token offline só funciona se foi gerado após prolongar a data e se o POS_LICENSE_HMAC_SECRET for o mesmo da consola.`,
      status: 502,
    };
  } finally {
    clearTimeout(timer);
  }

  const licenseKey = normalizeText(body.license_key);
  const licenseObject =
    body.license && typeof body.license === 'object' ? body.license : null;
  if (!licenseKey && !licenseObject) {
    return { error: 'Resposta da consola sem licença.', status: 502 };
  }

  let licenseToWrite = licenseObject;
  if (!licenseToWrite) {
    const parsed = parseLicenseToken(licenseKey);
    if (parsed.error || !parsed.payload) {
      return { error: parsed.error || 'Licença devolvida pela consola inválida.', status: 502 };
    }
    licenseToWrite = parsed.payload;
  }

  const persisted = await persistRedeemedLicenseFile(licenseToWrite);
  if (persisted?.error) return persisted;
  return { ...persisted, offline: false };
}

/** Nome comercial da licença (consola / ficheiro), não o placeholder «Loja» da BD local. */
async function readStoreNameCandidatesFromLicense(registrySync) {
  const fromRegistry =
    registrySync && typeof registrySync === 'object' && registrySync.displayName
      ? normalizeText(registrySync.displayName)
      : '';
  let fromLicense = '';
  try {
    const raw = await fs.readFile(resolveLicensePath(), 'utf8');
    const parsed = parseLicenseToken(raw);
    if (!parsed.error && parsed.payload) {
      fromLicense = storeNameFromLicensePayload(parsed.payload);
    }
  } catch {
    // sem license.json ou ilegível
  }
  return { fromRegistry, fromLicense };
}

export async function readFirstRunStatus(options = {}) {
  const skipRegistrySync = Boolean(options?.skipRegistrySync);
  const registrySync = skipRegistrySync
    ? { synced: false, skipped: true, error: null }
    : await syncLicenseRegistryFromIssuer();
  if (!skipRegistrySync) {
    await syncLicenseFileIntoLocalDb();
  }
  const resolvedDbPath = resolvePosDbPathForStatus();
  const dbExists = await fs.access(resolvedDbPath).then(() => true).catch(() => false);
  const dbPathForPayload = normalizeText(process.env.POS_DB_PATH) || resolvedDbPath;

  // Preferir tenant ligado a uma licença real (ficheiro sync / wizard), não só o seed + linha AUTO.
  let tenantRow = await getDb(
    `SELECT t.id, t.name
     FROM licenses l
     INNER JOIN tenants t ON t.id = l.tenant_id
     WHERE l.active = 1
       AND TRIM(COALESCE(l.license_key, '')) != ''
       AND TRIM(COALESCE(l.license_key, '')) != 'AUTO'
     ORDER BY datetime(l.created_at) DESC, l.id DESC
     LIMIT 1`
  );
  if (!tenantRow?.id) {
    tenantRow = await getDb(
      `SELECT id, name FROM tenants ORDER BY datetime(created_at) ASC, id ASC LIMIT 1`
    );
  }
  const tenantExists = Boolean(tenantRow?.id);

  const setupRow = await getDb(
    `SELECT admin_password_set, license_activated, license_expires_at, setup_completed, printer_type, setup_completed_at
     FROM app_setup_state
     WHERE id = 1
     LIMIT 1`
  );
  const adminPasswordSet = Number(setupRow?.admin_password_set ?? 0) === 1;
  const licenseActivated = Number(setupRow?.license_activated ?? 0) === 1;
  const setupCompleted = Number(setupRow?.setup_completed ?? 0) === 1;
  const hasAdminPinInUsers = await getDb(
    `SELECT 1 AS ok FROM users
     WHERE lower(trim(role)) = 'admin' AND active = 1
       AND (deleted_at IS NULL OR TRIM(COALESCE(deleted_at, '')) = '')
       AND pin IS NOT NULL AND trim(pin) != ''
     LIMIT 1`
  );
  const adminReady = adminPasswordSet || Boolean(hasAdminPinInUsers?.ok);
  const inferredLegacyCompletion = tenantExists && licenseActivated && adminReady;

  const hadDatabaseOnBoot = parseBooleanFromEnv('POS_DB_EXISTED_BEFORE_BOOT', dbExists);
  const isSetupComplete = (setupCompleted || inferredLegacyCompletion) && tenantExists;

  let resolvedTenantName = tenantRow?.name ? String(tenantRow.name) : null;
  if (tenantRow?.id) {
    const profileRow = await getDb(`SELECT name FROM tenant_profile WHERE id = ? LIMIT 1`, [
      String(tenantRow.id),
    ]);
    const { fromRegistry, fromLicense } = await readStoreNameCandidatesFromLicense(registrySync);
    resolvedTenantName = pickStoreDisplayName(
      fromRegistry,
      fromLicense,
      profileRow?.name,
      tenantRow?.name,
    );
  } else {
    const { fromRegistry, fromLicense } = await readStoreNameCandidatesFromLicense(registrySync);
    const fallback = pickStoreDisplayName(fromRegistry, fromLicense);
    if (!isGenericStoreName(fallback)) {
      resolvedTenantName = fallback;
    }
  }

  const tenantIdForLicense = tenantRow?.id ? String(tenantRow.id) : 'tenant-1';
  const licenseAccess = await validateLicenseAccess(0, { tenant_id: tenantIdForLicense });
  const setupExpiresAt = setupRow?.license_expires_at
    ? String(setupRow.license_expires_at).trim()
    : null;
  const licenseExpiresAt = licenseAccess.expiresAt ?? setupExpiresAt ?? null;
  const licenseExpired = Boolean(licenseAccess.isExpired);

  return {
    dbPath: dbPathForPayload || null,
    dbExists,
    hadDatabaseOnBoot,
    tenantExists,
    tenantId: tenantRow?.id ? String(tenantRow.id) : null,
    tenantName: tenantRow?.id ? resolvedTenantName : null,
    adminPasswordSet,
    licenseActivated,
    printerType: setupRow?.printer_type ? String(setupRow.printer_type) : null,
    setupCompleted,
    setupCompletedAt: setupRow?.setup_completed_at ? String(setupRow.setup_completed_at) : null,
    isSetupComplete,
    setupConfigPath: resolveSetupConfigPath(),
    licensePath: resolveLicensePath(),
    requiresWizard: !isSetupComplete,
    licenseExpired,
    licenseExpiresAt,
    registrySync: {
      synced: Boolean(registrySync?.synced),
      skipped: Boolean(registrySync?.skipped),
      error: registrySync?.error ? String(registrySync.error) : null,
      expiresAt: registrySync?.expiresAt ? String(registrySync.expiresAt) : null,
    },
  };
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
  if (licenseKey.length < 6) return { error: 'Chave de licença inválida.', status: 400 };

  const parsedLicense = parseLicenseToken(licenseKey);
  if (parsedLicense.error || !parsedLicense.payload) {
    return { error: parsedLicense.error || 'Licença inválida.', status: 400 };
  }

  const dbPath = normalizeText(process.env.POS_DB_PATH);
  if (dbPath) {
    await fs.mkdir(path.dirname(dbPath), { recursive: true });
    await fs.writeFile(dbPath, '', { flag: 'a' });
  }

  const status = await readFirstRunStatus();
  if (status.isSetupComplete) {
    return { error: 'Setup já foi concluído nesta instalação.', status: 409 };
  }

  const expectTenantForLicense =
    status.licenseActivated ? normalizeText(status.tenantId) || null : null;
  const licenseValidation = validateMachineBoundLicense(
    parsedLicense.payload,
    expectTenantForLicense
  );
  if (!licenseValidation.ok) {
    return { error: licenseValidation.error || 'Licença inválida.', status: 400 };
  }

  const now = new Date().toISOString();
  const tenantId = !status.licenseActivated
    ? licenseValidation.tenantId || normalizeText(status.tenantId) || `tenant-${uuidv4()}`
    : normalizeText(status.tenantId) || licenseValidation.tenantId || `tenant-${uuidv4()}`;
  const adminId = 'admin-local';
  const adminPinHash = await ensureHashedPin(adminPin);
  const licenseHash = hashLicenseKey(licenseKey);

  await runDb(
    `INSERT INTO tenants (id, name, created_at)
     VALUES (?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name`,
    [tenantId, storeName, now]
  );

  await runDb(
    `INSERT INTO tenant_profile (id, name, nuit, license_type, created_at, updated_at)
     VALUES (?, ?, ?, 'LOCAL', ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       nuit = excluded.nuit,
       updated_at = excluded.updated_at`,
    [tenantId, storeName, nuit, now, now]
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
      },
      null,
      2
    ),
    'utf8'
  );

  await fs.writeFile(
    licensePath,
    JSON.stringify(
      {
        ...parsedLicense.payload,
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

  return {
    success: true,
    tenantId,
    adminId,
    setupConfigPath,
    licensePath,
    setupCompletedAt: now,
  };
}
