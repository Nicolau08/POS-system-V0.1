import db from '../database.js';
import { sendError, sendSuccess } from '../utils/response.js';
import {
  resolveLocalLicenseExpiry,
  readLocalLicenseFile,
  syncLicenseRegistry,
} from '../services/licenseRegistry.service.js';
import {
  readFirstRunStatus,
  resetLocalLicenseForReactivation,
  installOfflineLicenseState,
} from '../services/setup.service.js';
import { configureInitialAdminPassword } from '../services/user.service.js';

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

function isLocalRequest(req) {
  const localhostCandidates = new Set(['127.0.0.1', '::1', 'localhost']);
  // Etapa 1G.3.5: so o socket decide (nunca X-Forwarded-For, mesmo com TRUST_PROXY).
  const candidate = String(req.socket?.remoteAddress ?? '').trim();
  if (!candidate) return false;
  if (candidate.startsWith('::ffff:')) {
    return localhostCandidates.has(candidate.replace('::ffff:', ''));
  }
  return localhostCandidates.has(candidate);
}

export async function getSetupStatus(req, res) {
  try {
    const skipRegistrySync =
      String(req.query?.skipRegistrySync ?? '').trim() === '1' ||
      String(req.query?.skipRegistrySync ?? '').trim().toLowerCase() === 'true';

    const payload = await readFirstRunStatus();
    const setupRow = await getRow(
      `SELECT license_expires_at, license_activated FROM app_setup_state WHERE id = 1 LIMIT 1`,
    );
    const licenseFile = await readLocalLicenseFile();
    const expiry = resolveLocalLicenseExpiry(
      setupRow,
      licenseFile.ok ? licenseFile.payload : null,
    );

    let registrySync = undefined;
    if (!skipRegistrySync && payload.licenseActivated && !expiry.licenseExpired) {
      try {
        registrySync = await syncLicenseRegistry();
        if (registrySync?.expiresAt) {
          const refreshed = resolveLocalLicenseExpiry(
            { license_expires_at: registrySync.expiresAt },
            null,
          );
          expiry.licenseExpiresAt = refreshed.licenseExpiresAt;
          expiry.licenseExpired = refreshed.licenseExpired;
        }
      } catch (syncErr) {
        registrySync = {
          synced: false,
          skipped: false,
          error: syncErr instanceof Error ? syncErr.message : String(syncErr),
          expiresAt: expiry.licenseExpiresAt,
        };
      }
    }

    // Pedidos não-locais (LAN / proxy) só recebem booleanos — sem paths, tenantId ou nomes.
    if (!isLocalRequest(req)) {
      return sendSuccess(res, {
        isSetupComplete: Boolean(payload.isSetupComplete),
        requiresWizard: Boolean(payload.requiresWizard),
        licenseExpired: Boolean(expiry.licenseExpired),
        licenseActivated: Boolean(payload.licenseActivated),
        adminPasswordSet: Boolean(payload.adminPasswordSet),
        dbExists: Boolean(payload.dbExists),
        tenantExists: Boolean(payload.tenantExists),
      });
    }

    return sendSuccess(res, {
      ...payload,
      licenseExpiresAt: expiry.licenseExpiresAt,
      license_expires_at: expiry.licenseExpiresAt,
      licenseExpired: expiry.licenseExpired,
      registrySync,
    });
  } catch (error) {
    return sendError(res, 500, error instanceof Error ? error.message : 'Falha ao ler estado do setup.', 'SETUP_STATUS_FAILED');
  }
}

/**
 * Instala localmente um envelope Ed25519 já pedido/verificado pelo Electron
 * (Etapa 1F.5b) — reverifica aqui de novo (setup.service.js) antes de
 * persistir qualquer estado. Local-only, mesmo gate que os outros endpoints
 * de setup.
 */
export async function installOfflineLicense(req, res) {
  try {
    if (!isLocalRequest(req)) {
      return sendError(res, 403, 'Operação permitida apenas localmente.', 'LOCAL_ONLY_OPERATION');
    }
    const envelope = req.body?.offline_license;
    if (!envelope || typeof envelope !== 'object') {
      return sendError(res, 400, 'offline_license em falta.', 'OFFLINE_LICENSE_MISSING');
    }
    const machineId = normalizeText(req.body?.machine_id);
    const result = await installOfflineLicenseState(envelope, { machineId: machineId || undefined });
    if (result?.error) {
      return sendError(res, result.status ?? 400, result.error, result.kind || 'OFFLINE_LICENSE_INVALID');
    }
    return sendSuccess(res, result);
  } catch (error) {
    return sendError(
      res,
      500,
      error instanceof Error ? error.message : 'Falha ao instalar licença offline.',
      'OFFLINE_LICENSE_INSTALL_FAILED',
    );
  }
}

export async function setAdminPassword(req, res) {
  try {
    if (!isLocalRequest(req)) {
      return sendError(res, 403, 'Operação permitida apenas localmente.', 'LOCAL_ONLY_OPERATION');
    }
    const pin = String(req.body?.pin ?? req.body?.password ?? '').trim();
    if (!pin) {
      return sendError(res, 400, 'PIN obrigatório.', 'SETUP_ADMIN_PASSWORD_REQUIRED');
    }
    const status = await readFirstRunStatus();
    const tenantCandidate =
      String(req.body?.tenantId ?? req.body?.tenant_id ?? '').trim() || status?.tenantId || null;
    const result = await configureInitialAdminPassword(pin, tenantCandidate);
    if (result?.error) {
      return sendError(res, result.status ?? 400, result.error, 'SETUP_ADMIN_PASSWORD_FAILED');
    }
    return sendSuccess(res, result);
  } catch (error) {
    return sendError(
      res,
      500,
      error instanceof Error ? error.message : 'Falha ao configurar a senha do admin.',
      'SETUP_ADMIN_PASSWORD_FAILED',
    );
  }
}

export async function syncLicenseRegistryHandler(req, res) {
  try {
    if (!isLocalRequest(req)) {
      return sendError(res, 403, 'Operação permitida apenas localmente.', 'LOCAL_ONLY_OPERATION');
    }
    const result = await syncLicenseRegistry();
    return sendSuccess(res, result);
  } catch (error) {
    return sendError(
      res,
      500,
      error instanceof Error ? error.message : 'Falha ao sincronizar licença.',
      'LICENSE_SYNC_FAILED',
    );
  }
}

export async function resetLocalLicense(req, res) {
  try {
    if (!isLocalRequest(req)) {
      return sendError(res, 403, 'Operação permitida apenas localmente.', 'LOCAL_ONLY_OPERATION');
    }
    const result = await resetLocalLicenseForReactivation();
    return sendSuccess(res, result);
  } catch (error) {
    return sendError(
      res,
      500,
      error instanceof Error ? error.message : 'Falha ao limpar licença local.',
      'LICENSE_RESET_FAILED',
    );
  }
}
