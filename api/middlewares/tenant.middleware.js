import { sendError } from '../utils/response.js';

export function requireTenantContext(req, res, next) {
  const tenantId = String(req.tenantId ?? req.user?.tenant_id ?? '').trim();
  if (!tenantId) {
    return sendError(res, 401, 'Tenant context ausente', 'TENANT_CONTEXT_REQUIRED');
  }

  req.tenantId = tenantId;
  if (req.user && !req.user.tenant_id) {
    req.user.tenant_id = tenantId;
  }
  return next();
}
