import db from '../database.js';
import { requireTenantId } from '../utils/tenant.js';
import {
  readLocalLicenseFile,
  resolveLocalLicenseExpiry,
  syncLicenseRegistry,
} from './licenseRegistry.service.js';

const getDb = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row ?? null);
    });
  });

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

/**
 * Prefere o tenant da licença local (servidor/consola) sobre o utilizador
 * da sessão de desenvolvimento (ex.: tenant-qa-02).
 */
async function resolveLicenseTenantId(actorTenantId) {
  const file = await readLocalLicenseFile();
  if (file.ok && file.payload) {
    const fromFile = normalizeText(file.payload.tenant_id);
    if (fromFile) return fromFile;
  }

  const activeLicense = await getDb(
    `SELECT tenant_id
     FROM licenses
     WHERE active = 1
       AND tenant_id IS NOT NULL
       AND TRIM(tenant_id) != ''
     ORDER BY datetime(COALESCE(activated_at, created_at, '1970-01-01')) DESC
     LIMIT 1`,
  );
  if (activeLicense?.tenant_id) return String(activeLicense.tenant_id).trim();

  return requireTenantId(actorTenantId, {
    status: 401,
    message: 'tenant_id ausente para leitura do tenant',
  });
}

async function ensureTenantProfileRow(tenantId, fallbackName = 'Loja') {
  let tenantRow = await getDb(
    `SELECT tp.name, tp.nuit, tp.license_type
     FROM tenant_profile tp
     WHERE tp.id = ?
     LIMIT 1`,
    [tenantId],
  );

  if (tenantRow) return tenantRow;

  const baseTenantRow = await getDb(`SELECT name FROM tenants WHERE id = ? LIMIT 1`, [tenantId]);
  const name = normalizeText(baseTenantRow?.name) || fallbackName;
  const now = new Date().toISOString();
  await runDb(
    `INSERT INTO tenant_profile (id, name, nuit, license_type, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       updated_at = excluded.updated_at`,
    [tenantId, name, null, 'BASIC', now, now],
  );

  return getDb(
    `SELECT tp.name, tp.nuit, tp.license_type
     FROM tenant_profile tp
     WHERE tp.id = ?
     LIMIT 1`,
    [tenantId],
  );
}

export async function readTenantInfo(actorUser = null) {
  // Sincroniza nome/NUIT/plano/expiração a partir da consola (melhor esforço).
  try {
    await syncLicenseRegistry();
  } catch {
    // offline / sem issuer — continua com dados locais
  }

  const tenantId = await resolveLicenseTenantId(actorUser?.tenant_id);
  const tenantRow = await ensureTenantProfileRow(tenantId);

  const licenseRow = await getDb(
    `SELECT plan, expires_at, active
     FROM licenses
     WHERE tenant_id = ?
     ORDER BY datetime(COALESCE(activated_at, created_at, expires_at, '1970-01-01T00:00:00.000Z')) DESC
     LIMIT 1`,
    [tenantId],
  );

  const setupRow = await getDb(
    `SELECT license_expires_at, license_activated FROM app_setup_state WHERE id = 1 LIMIT 1`,
  );
  const licenseFile = await readLocalLicenseFile();
  const expiry = resolveLocalLicenseExpiry(
    {
      license_expires_at:
        (Number(licenseRow?.active ?? 0) === 1 && licenseRow?.expires_at
          ? String(licenseRow.expires_at)
          : null) || setupRow?.license_expires_at,
      license_activated: setupRow?.license_activated,
    },
    licenseFile.ok ? licenseFile.payload : null,
  );

  const activeLicensePlan =
    Number(licenseRow?.active ?? 0) === 1 && normalizeText(licenseRow?.plan)
      ? normalizeText(licenseRow.plan)
      : null;

  return {
    name: normalizeText(tenantRow?.name) || 'Loja',
    nuit: normalizeText(tenantRow?.nuit) || '--',
    license_type: activeLicensePlan || normalizeText(tenantRow?.license_type) || 'BASIC',
    license_expires_at: expiry.licenseExpiresAt,
    tenant_id: tenantId,
  };
}
