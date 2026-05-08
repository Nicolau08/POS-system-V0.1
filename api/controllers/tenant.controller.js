import { readTenantInfo } from '../services/tenant.service.js';
import { logError } from '../utils/logger.js';

function controllerError(res, error) {
  console.error('❌ controller error:', error);
  return res.status(500).json({
    error: 'Erro interno',
    message: error instanceof Error ? error.message : String(error),
  });
}

export async function getTenantInfo(req, res) {
  try {
    const payload = await readTenantInfo(req.user);
    return res.json(payload);
  } catch (error) {
    logError('get_tenant_info_error', { error: error instanceof Error ? error.message : String(error) });
    return controllerError(res, error);
  }
}
