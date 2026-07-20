import {
  activateLicenseWithToken,
  authenticateLogin,
  configureInitialAdminPassword,
  listLoginUsers,
  listUsers,
  createUser,
  readSetupStatus,
  renewLicenseExpiration,
  updateUser,
  deactivateUser,
  resetAdminPinToDefault,
} from '../services/user.service.js';
import { processFullSyncCycle, processPullSyncCycle } from '../syncService.js';
import { logAudit, logError } from '../utils/logger.js';
import { getClientIp, isLoopbackIp } from '../utils/authSecret.js';

function controllerError(res, error) {
  console.error('❌ controller error:', error);
  return res.status(500).json({
    error: 'Erro interno',
    message: error instanceof Error ? error.message : String(error),
  });
}

function isLocalRequest(req) {
  return isLoopbackIp(getClientIp(req));
}

export async function login(req, res) {
  try {
    const userId = String(req.body?.userId ?? req.body?.id ?? '').trim();
    const enteredPin =
      req.body?.enteredPin ??
      req.body?.pin ??
      req.body?.password ??
      '';
    if (!userId || String(enteredPin).trim() === '') {
      return res.status(400).json({ error: 'userId e pin sao obrigatorios' });
    }

    const result = await authenticateLogin({ userId, enteredPin });
    if (!result?.ok) {
      await logAudit('USER_LOGIN_FAILED', { id: userId }, {
        entity: 'auth',
        entity_id: userId,
        description: 'Failed login attempt',
      });
      return res.status(401).json({ error: 'credenciais invalidas' });
    }
    return res.json({ success: true, user: result.user, token: result.token || null });
  } catch (error) {
    logError('user_login_error', { error: error instanceof Error ? error.message : String(error) });
    return controllerError(res, error);
  }
}

export async function getLoginUsers(req, res) {
  try {
    const users = await listLoginUsers();
    return res.json({ success: true, data: users });
  } catch (error) {
    return controllerError(res, error);
  }
}

export async function getUsers(req, res) {
  try {
    const users = await listUsers(
      {
        ...(req.query ?? {}),
        actorTenantId: req.user?.tenant_id,
      }
    );
    // Fonte primária da UI: SQLite local.
    // Dispara pull em background para trazer utilizadores criados no Supabase.
    void processPullSyncCycle().catch((error) => {
      logError('users_background_pull_sync_error', {
        error: error instanceof Error ? error.message : String(error),
      });
    });
    return res.json(users);
  } catch (error) {
    return controllerError(res, error);
  }
}

export async function postUser(req, res) {
  try {
    const result = await createUser(req.body ?? {}, req.user);
    if (result?.error) return res.status(result.status ?? 400).json({ error: result.error });
    // Push/pull bidirecional em background para reduzir atraso de propagação.
    void processFullSyncCycle().catch((error) => {
      logError('users_background_full_sync_error', {
        action: 'create',
        error: error instanceof Error ? error.message : String(error),
      });
    });
    return res.json(result);
  } catch (error) {
    logError('create_user_error', { error: error.message });
    return controllerError(res, error);
  }
}

export async function putUser(req, res) {
  try {
    const result = await updateUser(req.params?.id, req.body ?? {}, req.user);
    if (result?.error) return res.status(result.status ?? 400).json({ error: result.error });
    void processFullSyncCycle().catch((error) => {
      logError('users_background_full_sync_error', {
        action: 'update',
        user_id: req.params?.id,
        error: error instanceof Error ? error.message : String(error),
      });
    });
    return res.json(result);
  } catch (error) {
    logError('update_user_error', { error: error.message, user_id: req.params?.id });
    return controllerError(res, error);
  }
}

export async function deleteUser(req, res) {
  try {
    const result = await deactivateUser(req.params?.id, req.user);
    if (result?.error) return res.status(result.status ?? 400).json({ error: result.error });
    void processFullSyncCycle().catch((error) => {
      logError('users_background_full_sync_error', {
        action: 'deactivate',
        user_id: req.params?.id,
        error: error instanceof Error ? error.message : String(error),
      });
    });
    return res.json(result);
  } catch (error) {
    logError('delete_user_error', { error: error.message, user_id: req.params?.id });
    return controllerError(res, error);
  }
}

export async function resetAdminPin(req, res) {
  try {
    const isProduction = String(process.env.NODE_ENV ?? 'development').toLowerCase() === 'production';
    const isPackagedPos = String(process.env.POS_PACKAGED ?? '').trim() === '1';
    if (isProduction || isPackagedPos) {
      return res.status(403).json({ error: 'redefinir PIN do admin nao permitido em producao' });
    }

    if (!isLocalRequest(req)) {
      return res.status(403).json({ error: 'operacao permitida apenas localmente' });
    }

    const userId = String(req.body?.userId ?? '').trim();
    if (!userId) {
      return res.status(400).json({ error: 'userId obrigatorio' });
    }

    const result = await resetAdminPinToDefault(userId);
    if (result?.error) return res.status(result.status ?? 400).json({ error: result.error });
    return res.json({ success: true, userId: result.userId });
  } catch (error) {
    logError('reset_admin_pin_error', { error: error instanceof Error ? error.message : String(error) });
    return controllerError(res, error);
  }
}

export async function getSetupStatus(req, res) {
  try {
    const status = await readSetupStatus();
    return res.json(status);
  } catch (error) {
    logError('get_setup_status_error', { error: error instanceof Error ? error.message : String(error) });
    return controllerError(res, error);
  }
}

export async function configureSetupAdminPassword(req, res) {
  try {
    if (!isLocalRequest(req)) {
      return res.status(403).json({ error: 'operacao permitida apenas localmente' });
    }

    const pin = String(req.body?.pin ?? req.body?.password ?? '').trim();
    if (!pin) return res.status(400).json({ error: 'pin obrigatorio' });
    const result = await configureInitialAdminPassword(pin);
    if (result?.error) return res.status(result.status ?? 400).json({ error: result.error });
    return res.json({ success: true, userId: result.userId });
  } catch (error) {
    logError('configure_setup_admin_password_error', { error: error instanceof Error ? error.message : String(error) });
    return controllerError(res, error);
  }
}

export async function activateSetupLicense(req, res) {
  try {
    if (!isLocalRequest(req)) {
      return res.status(403).json({ error: 'operacao permitida apenas localmente' });
    }

    const token = String(req.body?.token ?? '').trim();
    if (!token) return res.status(400).json({ error: 'token obrigatorio' });
    const licenseExpiresAt = req.body?.license_expires_at ?? req.body?.licenseExpiresAt ?? null;
    const result = await activateLicenseWithToken(token, licenseExpiresAt);
    if (result?.error) return res.status(result.status ?? 400).json({ error: result.error });
    return res.json({ success: true });
  } catch (error) {
    logError('activate_setup_license_error', { error: error instanceof Error ? error.message : String(error) });
    return controllerError(res, error);
  }
}

export async function renewLicense(req, res) {
  try {
    if (!isLocalRequest(req)) {
      return res.status(403).json({ error: 'operacao permitida apenas localmente' });
    }

    const licenseExpiresAt = req.body?.license_expires_at;
    const result = await renewLicenseExpiration(licenseExpiresAt);
    if (result?.error) return res.status(result.status ?? 400).json({ error: result.error });
    return res.json(result);
  } catch (error) {
    logError('renew_license_error', { error: error instanceof Error ? error.message : String(error) });
    return controllerError(res, error);
  }
}
