import { HttpError } from './response.js';

export function requireTenantId(tenantCandidate, options = {}) {
  const tenantId = String(tenantCandidate ?? '').trim();
  if (tenantId) return tenantId;

  const status = Number(options.status ?? 401);
  const message = String(options.message ?? 'tenant_id ausente no contexto da requisicao');
  const code = String(options.code ?? 'TENANT_CONTEXT_REQUIRED');
  throw new HttpError(status, message, code);
}

export function assertTenantWrite(tenantId, payloadTenantId) {
  const payloadValue = payloadTenantId == null ? '' : String(payloadTenantId).trim();
  if (!payloadValue) return;
  if (payloadValue !== tenantId) {
    throw new HttpError(403, 'tenant_id do payload nao corresponde ao tenant autenticado', 'TENANT_MISMATCH');
  }
}
