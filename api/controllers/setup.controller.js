import db from '../database.js';
import { sendError, sendSuccess } from '../utils/response.js';
import { bindSerialToMachine } from '../services/licenseSerial.service.js';
import { readFirstRunStatus, runInitialSetup } from '../services/setup.service.js';

const getRow = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row ?? null);
    });
  });

function normalizeText(value) {
  return String(value ?? '').trim();
}

function isActivationSecretValid(req) {
  const expected = normalizeText(process.env.POS_LICENSE_ACTIVATION_SECRET);
  if (!expected) return true;
  const got = normalizeText(req.headers?.['x-license-activation-secret']);
  return got === expected;
}

function isLocalRequest(req) {
  const localhostCandidates = new Set(['127.0.0.1', '::1', 'localhost']);
  const forwarded = String(req.headers?.['x-forwarded-for'] ?? '').split(',')[0].trim();
  const remote = String(req.socket?.remoteAddress ?? '').trim();
  const candidate = forwarded || remote;
  if (!candidate) return false;
  if (candidate.startsWith('::ffff:')) {
    return localhostCandidates.has(candidate.replace('::ffff:', ''));
  }
  return localhostCandidates.has(candidate);
}

export async function getSetupStatus(req, res) {
  try {
    const payload = await readFirstRunStatus();
    return sendSuccess(res, payload);
  } catch (error) {
    return sendError(res, 500, error instanceof Error ? error.message : 'Falha ao ler estado do setup.', 'SETUP_STATUS_FAILED');
  }
}

export async function initializeSetup(req, res) {
  try {
    if (!isLocalRequest(req)) {
      return sendError(res, 403, 'Operação permitida apenas localmente.', 'LOCAL_ONLY_OPERATION');
    }

    const result = await runInitialSetup(req.body ?? {});
    if (result?.error) {
      return sendError(res, result.status ?? 400, result.error, 'SETUP_VALIDATION_FAILED');
    }
    return sendSuccess(res, result);
  } catch (error) {
    return sendError(res, 500, error instanceof Error ? error.message : 'Falha ao inicializar setup.', 'SETUP_INIT_FAILED');
  }
}

export async function bindSerialLicense(req, res) {
  try {
    if (!isActivationSecretValid(req)) {
      return sendError(res, 401, 'Credencial de ativação inválida.', 'LICENSE_ACTIVATION_UNAUTHORIZED');
    }

    const serial = req.body?.serial_number ?? req.body?.serial ?? req.body?.licenseKey;
    const machineId = req.body?.machine_id ?? req.body?.machineId;
    const result = await bindSerialToMachine(serial, machineId);
    if (!result.ok) {
      return sendError(res, result.status ?? 400, result.error, 'LICENSE_BIND_FAILED');
    }

    const license = await getRow(`SELECT * FROM licenses WHERE id = ? LIMIT 1`, [result.licenseId]);
    const tenant = await getRow(`SELECT id, name FROM tenants WHERE id = ? LIMIT 1`, [result.tenantId]);
    const profile = await getRow(`SELECT id, name, nuit FROM tenant_profile WHERE id = ? LIMIT 1`, [result.tenantId]);

    return sendSuccess(res, {
      license_snapshot: license
        ? {
            id: String(license.id),
            tenant_id: String(license.tenant_id),
            license_key: license.license_key != null ? String(license.license_key) : null,
            serial_number: license.serial_number != null ? String(license.serial_number) : null,
            plan: license.plan != null ? String(license.plan) : null,
            expires_at: license.expires_at != null ? String(license.expires_at) : null,
            active: Number(license.active ?? 1),
            machine_id: license.machine_id != null ? String(license.machine_id) : null,
            activated_at: license.activated_at != null ? String(license.activated_at) : null,
          }
        : null,
      tenant: tenant ? { id: String(tenant.id), name: String(tenant.name ?? '') } : null,
      tenant_profile: profile
        ? {
            id: String(profile.id),
            name: profile.name != null ? String(profile.name) : null,
            nuit: profile.nuit != null ? String(profile.nuit) : null,
          }
        : null,
    });
  } catch (error) {
    return sendError(
      res,
      500,
      error instanceof Error ? error.message : 'Falha ao vincular número de série.',
      'LICENSE_BIND_FAILED'
    );
  }
}
