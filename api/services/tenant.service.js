import db from '../database.js';
import { requireTenantId } from '../utils/tenant.js';

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

export async function readTenantInfo(actorUser = null) {
  const tenantId = requireTenantId(actorUser?.tenant_id, {
    status: 401,
    message: 'tenant_id ausente para leitura do tenant',
  });

  let tenantRow = await getDb(
    `SELECT tp.name, tp.nuit, tp.license_type
     FROM tenant_profile tp
     WHERE tp.id = ?
     LIMIT 1`,
    [tenantId]
  );

  if (!tenantRow) {
    const baseTenantRow = await getDb(
      `SELECT name
         FROM tenants
         WHERE id = ?
         LIMIT 1`,
      [tenantId]
    );
    if (baseTenantRow?.name) {
      await runDb(
        `INSERT INTO tenant_profile (id, name, nuit, license_type, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name,
           updated_at = excluded.updated_at`,
        [tenantId, String(baseTenantRow.name).trim() || 'Loja', null, 'BASIC', new Date().toISOString(), new Date().toISOString()]
      );
      tenantRow = await getDb(
        `SELECT tp.name, tp.nuit, tp.license_type
         FROM tenant_profile tp
         WHERE tp.id = ?
         LIMIT 1`,
        [tenantId]
      );
    }
  }

  console.log('[TENANT DEBUG]', {
    tenantId,
    expected: 'tenant-1',
    tenantRow,
  });

  const licenseRow = await getDb(
    `SELECT plan, expires_at, active
     FROM licenses
     WHERE tenant_id = ?
     ORDER BY datetime(COALESCE(created_at, expires_at, '1970-01-01T00:00:00.000Z')) DESC
     LIMIT 1`,
    [tenantId]
  );

  const activeLicensePlan =
    Number(licenseRow?.active ?? 0) === 1 && String(licenseRow?.plan ?? '').trim()
      ? String(licenseRow.plan).trim()
      : null;
  const activeLicenseExpiresAt =
    Number(licenseRow?.active ?? 0) === 1 && String(licenseRow?.expires_at ?? '').trim()
      ? String(licenseRow.expires_at).trim()
      : null;

  return {
    name: tenantRow?.name || 'Loja',
    nuit: tenantRow?.nuit || '--',
    license_type: activeLicensePlan || tenantRow?.license_type || 'BASIC',
    license_expires_at: activeLicenseExpiresAt,
  };
}
