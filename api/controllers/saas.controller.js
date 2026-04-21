import { v4 as uuid } from 'uuid';
import db from '../database.js';
import { sendError, sendSuccess } from '../utils/response.js';
import { generateSerialNumber } from '../services/licenseSerial.service.js';

const run = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) return reject(err);
      return resolve(this);
    });
  });

const all = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      return resolve(rows ?? []);
    });
  });

function controllerError(res, error) {
  console.error('❌ controller error:', error);
  return sendError(
    res,
    500,
    error instanceof Error ? error.message : String(error),
    'SAAS_INTERNAL_ERROR'
  );
}

export async function createTenant(req, res) {
  try {
    const { name, nuit } = req.body ?? {};
    if (!name) {
      return sendError(res, 400, 'name is required', 'SAAS_NAME_REQUIRED');
    }

    const id = uuid();
    await run(`INSERT INTO tenants (id, name, created_at) VALUES (?, ?, datetime('now'))`, [id, name]);
    await run(
      `INSERT INTO tenant_profile (id, name, nuit, license_type, created_at, updated_at)
       VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))`,
      [id, name, nuit ?? null, 'BASIC']
    );

    return sendSuccess(res, { id, name, nuit: nuit ?? null });
  } catch (error) {
    return controllerError(res, error);
  }
}

/** Cadastro rápido + primeira licença com número de série (formato X_XXXXXXXX). */
export async function createTenantWithSerial(req, res) {
  try {
    const { name, nuit } = req.body ?? {};
    if (!name || !String(name).trim()) {
      return sendError(res, 400, 'name is required', 'SAAS_NAME_REQUIRED');
    }

    const tenantId = `tenant-${Date.now()}`;
    const trimmedName = String(name).trim();

    await run(`INSERT INTO tenants (id, name, created_at) VALUES (?, ?, datetime('now'))`, [tenantId, trimmedName]);
    await run(
      `INSERT INTO tenant_profile (id, name, nuit, license_type)
       VALUES (?, ?, ?, ?)`,
      [tenantId, trimmedName, nuit != null && String(nuit).trim() ? String(nuit).trim() : null, 'BASIC']
    );

    const serialNumber = generateSerialNumber();
    const expiresAt = new Date();
    expiresAt.setMonth(expiresAt.getMonth() + 1);

    await run(
      `INSERT INTO licenses (id, tenant_id, license_key, serial_number, plan, expires_at, active)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        `lic-${Date.now()}`,
        tenantId,
        serialNumber,
        serialNumber,
        'BASIC',
        expiresAt.toISOString(),
        1,
      ]
    );

    return sendSuccess(res, {
      tenant_id: tenantId,
      license_key: serialNumber,
      serial_number: serialNumber,
      serie_label: `série ${serialNumber}`,
      expires_at: expiresAt.toISOString(),
    });
  } catch (error) {
    return controllerError(res, error);
  }
}

export async function listTenants(req, res) {
  try {
    const rows = await all(`SELECT * FROM tenants ORDER BY datetime(COALESCE(created_at, '1970-01-01')) DESC`);
    return sendSuccess(res, rows);
  } catch (error) {
    return controllerError(res, error);
  }
}

export async function createLicense(req, res) {
  try {
    const { tenant_id, plan, expires_at } = req.body ?? {};
    if (!tenant_id || !plan || !expires_at) {
      return sendError(res, 400, 'tenant_id, plan and expires_at are required', 'SAAS_LICENSE_FIELDS');
    }

    const serialNumber = generateSerialNumber();
    const expiresNormalized = String(expires_at).trim();
    const licenseId = uuid();
    await run(
      `INSERT INTO licenses (id, tenant_id, license_key, serial_number, plan, expires_at, active)
       VALUES (?, ?, ?, ?, ?, ?, 1)`,
      [licenseId, tenant_id, serialNumber, serialNumber, plan, expiresNormalized]
    );

    return sendSuccess(res, {
      tenant_id,
      license_key: serialNumber,
      serial_number: serialNumber,
      serie_label: `série ${serialNumber}`,
      expires_at: expiresNormalized,
    });
  } catch (error) {
    return controllerError(res, error);
  }
}