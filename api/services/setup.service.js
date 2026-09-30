import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import db from '../database.js';
import { getLocalMachineId } from './licenseSerial.service.js';
import {
  normalizeCapabilities,
  normalizeVertical,
} from '../utils/tenantCapabilities.js';
import { verifyOfflineLicense } from '../../lib/licensing/offlineLicense.js';
import { resolveOfflineLicensePublicKeyPem } from '../../lib/licensing/offlineLicensePublicKeys.js';
import { logInfo, logError } from '../utils/logger.js';

// Etapa 1F.5c (itens 5, 8-10): toda a implementação HMAC de licença local
// (assinatura/verificação, selagem AES-GCM derivada do segredo, serial,
// voucher) foi removida deste ficheiro. O único mecanismo comercial é
// Activation Token → Device Auth → Offline License Ed25519 — ver
// installOfflineLicenseState() abaixo e electron/deviceAuth/offlineLicenseClient.js.

function normalizeText(value) {
  return String(value ?? '').trim();
}

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

function resolveSetupConfigPath() {
  const explicitPath = normalizeText(process.env.POS_CONFIG_PATH);
  if (explicitPath) return path.resolve(explicitPath);

  const userDataPath = normalizeText(process.env.POS_USER_DATA_PATH);
  if (userDataPath) {
    return path.join(userDataPath, 'config.json');
  }
  return path.resolve(process.cwd(), 'data', 'config.json');
}

/** Etapa 1F.5c: continua a existir só para readLocalLicenseFile() (licenseRegistry.service.js)
 * detectar um license.json legado (LEGACY_LICENSE_UNSUPPORTED) — o POS nunca mais escreve aqui. */
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

export async function readFirstRunStatus() {
  const dbPath = normalizeText(process.env.POS_DB_PATH);
  const dbExists = dbPath ? await fs.access(dbPath).then(() => true).catch(() => false) : false;

  // Preferir o tenant da licença activa (BD) — NÃO o seed mais antigo (tenant-1),
  // senão o Electron compara license.tenant_id (loja real) com tenant-1 e marca "em uso".
  // Etapa 1F.5c: já não há fallback de leitura de license.json legado aqui —
  // installOfflineLicenseState() já persiste tenants/licenses directamente,
  // a BD é sempre a fonte de verdade para o novo caminho Ed25519.
  // Uma licença real (license_key != 'AUTO') nunca perde para o fallback
  // 'AUTO'/LOCAL auto-semeado abaixo em api/server.js, mesmo com timestamp
  // mais recente — ver mesmo comentário em tenant.service.js#resolveLicenseTenantId.
  let tenantRow = null;
  const activeLicense = await getDb(
    `SELECT tenant_id FROM licenses
     WHERE active = 1 AND tenant_id IS NOT NULL AND TRIM(tenant_id) != ''
     ORDER BY
       CASE WHEN license_key = 'AUTO' THEN 1 ELSE 0 END ASC,
       datetime(COALESCE(activated_at, created_at)) DESC
     LIMIT 1`,
  );
  if (activeLicense?.tenant_id) {
    tenantRow = await getDb(`SELECT id, name FROM tenants WHERE id = ? LIMIT 1`, [
      String(activeLicense.tenant_id),
    ]);
  }
  if (!tenantRow) {
    tenantRow = await getDb(
      `SELECT id, name FROM tenants
       WHERE id IS NOT NULL AND TRIM(id) != '' AND lower(trim(id)) != 'tenant-1'
       ORDER BY datetime(created_at) DESC, id DESC
       LIMIT 1`,
    );
  }
  if (!tenantRow) {
    tenantRow = await getDb(
      `SELECT id, name FROM tenants ORDER BY datetime(created_at) ASC, id ASC LIMIT 1`,
    );
  }

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

/**
 * Apaga license.json/offline-license.json e reabre o fluxo de activação.
 * Usado após desvincular na consola + «Limpar licença local».
 */
export async function resetLocalLicenseForReactivation() {
  const licensePath = resolveLicensePath();
  const setupConfigPath = resolveSetupConfigPath();
  const now = new Date().toISOString();

  try {
    await fs.unlink(licensePath);
  } catch (err) {
    if (err?.code !== 'ENOENT') throw err;
  }

  await runDb(
    `UPDATE app_setup_state
     SET license_activated = 0,
         license_token_hash = NULL,
         license_expires_at = NULL,
         setup_completed = 0,
         setup_completed_at = NULL,
         updated_at = ?
     WHERE id = 1`,
    [now],
  );

  try {
    const raw = await fs.readFile(setupConfigPath, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      parsed.setupCompleted = false;
      parsed.setupCompletedAt = null;
      parsed.licenseActivated = false;
      parsed.licenseClearedAt = now;
      await fs.writeFile(setupConfigPath, JSON.stringify(parsed, null, 2), 'utf8');
    }
  } catch {
    // config opcional
  }

  try {
    await fs.unlink(resolveOfflineLicensePath());
  } catch (err) {
    if (err?.code !== 'ENOENT') throw err;
  }

  return {
    success: true,
    licensePath,
    setupConfigPath,
    requiresWizard: true,
  };
}

export function resolveOfflineLicensePath() {
  const userDataPath = normalizeText(process.env.POS_USER_DATA_PATH);
  if (userDataPath) return path.join(userDataPath, 'offline-license.json');
  return path.resolve(process.cwd(), 'data', 'offline-license.json');
}

async function atomicWriteJson(filePath, data) {
  await ensureParentDir(filePath);
  const tmpPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${crypto.randomBytes(6).toString('hex')}.tmp`,
  );
  await fs.writeFile(tmpPath, JSON.stringify(data, null, 2), 'utf8');
  // rename é atómico no mesmo volume — nunca deixa o ficheiro final a meio de uma escrita.
  await fs.rename(tmpPath, filePath);
}

/**
 * Persiste o estado local (tenant/tenant_profile/licenses/admin user/
 * app_setup_state) a partir de um envelope Ed25519 já pedido pelo Electron
 * (Etapa 1F.5b, itens 3/16/19). Revalida a assinatura AQUI de novo — defesa
 * em profundidade, nunca confia cegamente no chamador local (Electron),
 * mesmo sendo IPC local — mesmo princípio já aplicado a todo o resto desta
 * etapa: "nunca assumir que já foi verificada".
 *
 * Idempotente por device (item 19): re-emitir para o MESMO tenant/license/
 * machine nunca cria um tenant/licença duplicados — usa sempre
 * `license-${tenant_id}` como id estável (ON CONFLICT DO UPDATE).
 */
/**
 * Resolução de "qual o tenant activo" partilhada com tenant.service.js/
 * setup.service.js#readFirstRunStatus — usada aqui só para o read-back
 * atómico (item de Pilot Gate abaixo), nunca para decidir o que persistir.
 * Uma licença real (license_key != 'AUTO') nunca perde para o fallback
 * 'AUTO'/LOCAL, mesmo com timestamp mais recente.
 */
async function resolveActiveTenantIdForConsistencyCheck() {
  const row = await getDb(
    `SELECT tenant_id FROM licenses
     WHERE active = 1 AND tenant_id IS NOT NULL AND TRIM(tenant_id) != ''
     ORDER BY
       CASE WHEN license_key = 'AUTO' THEN 1 ELSE 0 END ASC,
       datetime(COALESCE(activated_at, created_at)) DESC
     LIMIT 1`,
  );
  return row?.tenant_id ? String(row.tenant_id).trim() : null;
}

export async function installOfflineLicenseState(envelope, opts = {}) {
  const machineId = normalizeText(opts?.machineId) || getLocalMachineId();
  const verification = verifyOfflineLicense(envelope, resolveOfflineLicensePublicKeyPem, { machineId });
  if (!verification.ok) {
    logError('offline_license_install_rejected', { reason: verification.kind || 'INVALID', machineId });
    return { error: verification.error, status: 400, kind: verification.kind };
  }
  const payload = verification.payload;

  const tenantId = normalizeText(payload.tenant_id);
  const licenseId = normalizeText(payload.license_id);
  if (!tenantId || !licenseId) {
    logError('offline_license_install_rejected', { reason: 'MALFORMED', machineId });
    return { error: 'Licença offline sem tenant_id/license_id.', status: 400, kind: 'MALFORMED' };
  }

  const now = new Date().toISOString();
  const storeName = normalizeText(payload.name) || tenantId;
  const nuit = normalizeText(payload.nuit);
  const plan = normalizeText(payload.plan) || 'LITE';
  const commerceType = normalizeText(payload.commerce_type) || 'retalho';
  const vertical = normalizeOptionalVertical(payload.vertical, commerceType);
  const capabilitiesJson = normalizeOptionalCapabilitiesJson(payload.capabilities, vertical, commerceType);
  const expiresAt = normalizeText(payload.expires_at) || null;

  const dbPath = normalizeText(process.env.POS_DB_PATH);
  if (dbPath) {
    await fs.mkdir(path.dirname(dbPath), { recursive: true });
    await fs.writeFile(dbPath, '', { flag: 'a' });
  }

  // Pilot Gate (achado real na VM): activação atómica do ponto de vista
  // funcional — todas as escritas numa única transacção, com um read-back
  // (usando exactamente a mesma resolução que o resto da app usa) ANTES de
  // marcar setup_completed/license_activated. Se o tenant resolvido não bater
  // certo com o que acabámos de instalar, FAIL CLOSED: ROLLBACK, nunca marca
  // a instalação como concluída, nunca deixa a app entrar como Default Tenant.
  await runDb('BEGIN IMMEDIATE');
  try {
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
      `UPDATE company_profile SET name = ?, tax_id = ?, updated_at = ? WHERE id = 1`,
      [storeName, nuit, now],
    );

    // Admin sem PIN só na PRIMEIRA activação desta instalação (a senha é
    // depois configurada no ecrã de login) — uma re-emissão idempotente
    // (item 19: renovação periódica, retry após falha parcial) NUNCA pode
    // apagar um PIN que o utilizador já configurou entretanto. O sinal é
    // `setup_completed` ANTES desta chamada, não a presença de um pin — a BD
    // nova já semeia 'admin-local' com um PIN de desenvolvimento ("1234", ver
    // schema/bootstrap.js) que a primeira activação real ainda precisa de substituir.
    const setupAlreadyCompletedBefore = Boolean(
      Number((await getDb(`SELECT setup_completed FROM app_setup_state WHERE id = 1`))?.setup_completed ?? 0),
    );
    if (setupAlreadyCompletedBefore) {
      await runDb(
        `INSERT INTO users (id, name, surname, email, role, pin, access_level, active, is_system, tenant_id, cloud_id, updated_at)
         VALUES ('admin-local', ?, NULL, NULL, 'admin', '', 9, 1, 1, ?, NULL, ?)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name,
           role = 'admin',
           access_level = 9,
           active = 1,
           is_system = 1,
           tenant_id = excluded.tenant_id,
           updated_at = excluded.updated_at`,
        ['Administrador', tenantId, now],
      );
    } else {
      await runDb(
        `INSERT INTO users (id, name, surname, email, role, pin, access_level, active, is_system, tenant_id, cloud_id, updated_at)
         VALUES ('admin-local', ?, NULL, NULL, 'admin', '', 9, 1, 1, ?, NULL, ?)
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
        ['Administrador', tenantId, now],
      );
    }

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
      [`license-${tenantId}`, tenantId, licenseId, plan, expiresAt, now, machineId, now],
    );

    // Read-back: confirma que o tenant que a resto da app vai resolver é
    // mesmo o que acabámos de instalar — nunca confia que os INSERTs acima
    // "devem ter funcionado".
    const resolvedTenantId = await resolveActiveTenantIdForConsistencyCheck();
    if (resolvedTenantId !== tenantId) {
      await runDb('ROLLBACK');
      logError('offline_license_install_consistency_failed', {
        expectedTenantId: tenantId,
        resolvedTenantId: resolvedTenantId || null,
        machineId,
      });
      return {
        error: 'Falha de consistência pós-instalação — activação cancelada (fail-closed).',
        status: 409,
        kind: 'POST_INSTALL_CONSISTENCY_FAILED',
      };
    }

    await runDb(
      `UPDATE app_setup_state
       SET license_activated = 1,
           license_expires_at = ?,
           printer_type = COALESCE(printer_type, 'thermal-80'),
           setup_completed = 1,
           setup_completed_at = COALESCE(setup_completed_at, ?),
           updated_at = ?
       WHERE id = 1`,
      [expiresAt, now, now],
    );

    await runDb('COMMIT');
  } catch (err) {
    try {
      await runDb('ROLLBACK');
    } catch {
      // ignore — a transacção pode já não estar activa
    }
    logError('offline_license_install_failed', {
      error: err instanceof Error ? err.message : String(err),
      tenantId,
      machineId,
    });
    throw err;
  }

  await atomicWriteJson(resolveOfflineLicensePath(), envelope);

  logInfo('offline_license_installed', { tenantId, licenseId, machineId, expiresAt });

  return {
    success: true,
    tenantId,
    licenseId,
    expiresAt,
    machineId,
  };
}
