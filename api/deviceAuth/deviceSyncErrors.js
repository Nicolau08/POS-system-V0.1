/**
 * Classificação de erros do novo caminho de sync via Device JWT (Etapa 1F.2,
 * item 23). Objectivo explícito do pedido: não fazer retry infinito agressivo,
 * não perder dados, não bloquear o POS — não é preciso usar exactamente estes
 * nomes, só distinguir as categorias abaixo.
 */

/** Lançado pelo cliente Supabase por device (deviceSupabaseClient.js) quando não há access token disponível. */
export class DeviceAuthUnavailableError extends Error {
  constructor(message = 'device access token unavailable') {
    super(message);
    this.name = 'DeviceAuthUnavailableError';
  }
}

export const SYNC_ERROR_KIND = Object.freeze({
  NETWORK: 'NETWORK',
  AUTH_TEMPORARY: 'AUTH_TEMPORARY',
  DEVICE_REVOKED: 'DEVICE_REVOKED',
  LICENSE_SUSPENDED: 'LICENSE_SUSPENDED',
  TENANT_SUSPENDED: 'TENANT_SUSPENDED',
  RLS_DENIED: 'RLS_DENIED',
  VALIDATION: 'VALIDATION',
  SERVER: 'SERVER',
});

function isNetworkLikeMessage(error) {
  const code = String(error?.code ?? error?.cause?.code ?? '').toUpperCase();
  const message = String(error?.message ?? '').toLowerCase();
  return (
    code === 'ENOTFOUND' ||
    code === 'ECONNREFUSED' ||
    code === 'ETIMEDOUT' ||
    message.includes('enotfound') ||
    message.includes('econnrefused') ||
    message.includes('fetch failed') ||
    message.includes('networkerror') ||
    message.includes('aborted')
  );
}

/**
 * @param {unknown} error
 * @returns {'NETWORK'|'AUTH_TEMPORARY'|'DEVICE_REVOKED'|'LICENSE_SUSPENDED'|'TENANT_SUSPENDED'|'RLS_DENIED'|'VALIDATION'|'SERVER'}
 */
export function classifySyncError(error) {
  if (error instanceof DeviceAuthUnavailableError) {
    return SYNC_ERROR_KIND.AUTH_TEMPORARY;
  }
  if (isNetworkLikeMessage(error)) {
    return SYNC_ERROR_KIND.NETWORK;
  }

  const message = String(error?.message ?? '').toLowerCase();
  const code = String(error?.code ?? '');

  // Mensagens das RPCs SECURITY DEFINER (create_order_with_items, sync_upsert_user)
  // e do erro de device_id em falta/JWT rejeitado pelo PostgREST/Postgres.
  if (message.includes('device_revoked') || message.includes('device_token_version_mismatch') || message.includes('device_not_found')) {
    return SYNC_ERROR_KIND.DEVICE_REVOKED;
  }
  if (message.includes('license_suspended') || message.includes('license_revoked') || message.includes('license_expired') || message.includes('license_not_found')) {
    return SYNC_ERROR_KIND.LICENSE_SUSPENDED;
  }
  if (message.includes('tenant_suspended') || message.includes('tenant_not_found') || message.includes('unauthenticated_or_missing_tenant') || message.includes('payload_tenant_mismatch')) {
    return SYNC_ERROR_KIND.TENANT_SUSPENDED;
  }
  // PostgreSQL 42501 = insufficient_privilege (RLS/GRANT negou) — retry nunca
  // resolve sozinho (é um caminho que o nosso próprio código não devia ter
  // tentado), mas também não é "dados inválidos" — categoria própria.
  if (code === '42501' || message.includes('permission denied') || message.includes('row-level security') || message.includes('new row violates row-level security')) {
    return SYNC_ERROR_KIND.RLS_DENIED;
  }
  if (
    message.includes('invalid') ||
    message.includes('violates') ||
    message.includes('null value') ||
    message.includes('required') ||
    message.includes('unsupported sync type')
  ) {
    return SYNC_ERROR_KIND.VALIDATION;
  }
  return SYNC_ERROR_KIND.SERVER;
}

/**
 * Erros que devem ser tratados exactamente como offline (nunca consumir
 * retries, nunca marcar dead, nunca apagar dados) — item 22: "não pode ser
 * marcado permanently failed se for retryable".
 */
export function isRetryableWithoutPenalty(kind) {
  return kind === SYNC_ERROR_KIND.NETWORK || kind === SYNC_ERROR_KIND.AUTH_TEMPORARY;
}

/**
 * Erros definitivos — retry nunca vai resolver sozinho (bug no payload, ou
 * RLS a negar algo que o código nunca devia ter tentado).
 */
export function isDefinitive(kind) {
  return kind === SYNC_ERROR_KIND.VALIDATION || kind === SYNC_ERROR_KIND.RLS_DENIED;
}
