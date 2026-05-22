import { sendError, sendSuccess } from '../utils/response.js';
import {
  readFirstRunStatus,
  runInitialSetup,
  acknowledgeLicenseFileOnServer,
  syncLicenseFromConsole,
  redeemReactivationTokenOnDevice,
} from '../services/setup.service.js';

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
    res.setHeader('Cache-Control', 'no-store, private, no-cache, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    const skipRegistrySync =
      req.query?.skipRegistrySync === '1' ||
      req.query?.skipRegistrySync === 'true' ||
      String(req.headers['x-pos-skip-registry-sync'] ?? '') === '1';
    const payload = await readFirstRunStatus({ skipRegistrySync });
    return sendSuccess(res, payload);
  } catch (error) {
    return sendError(res, 500, error instanceof Error ? error.message : 'Falha ao ler estado do setup.', 'SETUP_STATUS_FAILED');
  }
}

export async function syncSetupLicenseFromConsole(req, res) {
  try {
    if (!isLocalRequest(req)) {
      return sendError(res, 403, 'Operação permitida apenas localmente.', 'LOCAL_ONLY_OPERATION');
    }
    const result = await syncLicenseFromConsole();
    if (result?.error && !result?.synced) {
      return sendError(res, 502, result.error, 'LICENSE_REGISTRY_SYNC_FAILED');
    }
    const status = await readFirstRunStatus();
    return sendSuccess(res, { registrySync: result, status });
  } catch (error) {
    return sendError(
      res,
      500,
      error instanceof Error ? error.message : 'Falha ao sincronizar licença com a consola.',
      'LICENSE_REGISTRY_SYNC_FAILED',
    );
  }
}

export async function redeemSetupReactivationToken(req, res) {
  try {
    if (!isLocalRequest(req)) {
      return sendError(res, 403, 'Operação permitida apenas localmente.', 'LOCAL_ONLY_OPERATION');
    }
    const token = String(req.body?.token ?? req.body?.licenseKey ?? '').trim();
    const result = await redeemReactivationTokenOnDevice(token);
    if (result?.error) {
      return sendError(res, result.status ?? 400, result.error, 'LICENSE_REACTIVATION_FAILED');
    }
    const status = await readFirstRunStatus();
    return sendSuccess(res, { ...result, status });
  } catch (error) {
    return sendError(
      res,
      500,
      error instanceof Error ? error.message : 'Falha ao reativar licença.',
      'LICENSE_REACTIVATION_FAILED',
    );
  }
}

export async function acknowledgeSetupLicenseFile(req, res) {
  try {
    if (!isLocalRequest(req)) {
      return sendError(res, 403, 'Operação permitida apenas localmente.', 'LOCAL_ONLY_OPERATION');
    }
    const result = await acknowledgeLicenseFileOnServer();
    if (result?.error) {
      return sendError(res, result.status ?? 400, result.error, 'LICENSE_ACK_FAILED');
    }
    return sendSuccess(res, result);
  } catch (error) {
    return sendError(
      res,
      500,
      error instanceof Error ? error.message : 'Falha ao registar licença na base local.',
      'LICENSE_ACK_FAILED'
    );
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
