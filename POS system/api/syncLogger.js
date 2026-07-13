import { run } from './dbUtils.js';
import { logError, logEvent, logWarn } from './utils/logger.js';

async function logSyncError({ queueId = null, type = 'unknown', payload = null, error }) {
  const safeStringify = (value) => {
    if (value == null) return null;
    try {
      const seen = new WeakSet();
      return JSON.stringify(value, (key, val) => {
        if (typeof val === 'object' && val !== null) {
          if (seen.has(val)) return '[Circular]';
          seen.add(val);
        }
        return val;
      });
    } catch (stringifyErr) {
      try {
        return String(value);
      } catch (_) {
        return '[unserializable error value]';
      }
    }
  };

  const isObjectLike = error != null && typeof error === 'object';
  const errorObj = isObjectLike ? error : null;
  const messageFromError =
    error instanceof Error
      ? error.message
      : typeof errorObj?.message === 'string' && errorObj.message.trim()
        ? errorObj.message
        : null;
  const detailsFromError =
    typeof errorObj?.details === 'string' && errorObj.details.trim() ? errorObj.details : null;
  const serializedError = safeStringify(error);
  const errorMessage =
    messageFromError ||
    detailsFromError ||
    serializedError ||
    (error == null ? 'unknown sync error' : '[unknown sync error]');
  const tenantId = String(payload?.tenant_id ?? payload?.tenantId ?? '').trim() || null;
  const payloadString = payload == null ? null : JSON.stringify(payload);
  const syncType = String(type ?? 'unknown');

  try {
    await run(
      `INSERT INTO sync_logs (queue_id, tenant_id, type, payload, error_message) VALUES (?, ?, ?, ?, ?)`,
      [queueId, tenantId, syncType, payloadString, errorMessage]
    );
  } catch (logErr) {
    console.error('[sync] failed to persist sync log:', logErr.message);
  }

  logError('sync_error', {
    event: `sync.${syncType}`,
    message: `Falha de sincronismo (${syncType}): ${errorMessage}`,
    module: 'sync',
    action: syncType,
    reason: 'Erro ao sincronizar dados com a cloud / fila local',
    tenant_id: tenantId,
    queue_id: queueId,
    entity: 'sync',
    entity_id: queueId != null ? String(queueId) : null,
    error: errorObj ?? errorMessage,
    code: errorObj?.code ?? null,
    details: errorObj?.details ?? null,
  });
}

/**
 * Operações de sync (sucesso/aviso) → sync_logs + app_logs legível.
 */
async function logSyncOperation(type, payload, message, { level = 'info' } = {}) {
  const syncType = String(type ?? 'event');
  const tenantId = String(payload?.tenant_id ?? payload?.tenantId ?? '').trim() || null;
  const text = String(message ?? `Evento de sincronismo: ${syncType}`);

  try {
    await run(
      `INSERT INTO sync_logs (queue_id, tenant_id, type, payload, error_message) VALUES (?, ?, ?, ?, ?)`,
      [null, tenantId, syncType, payload == null ? null : JSON.stringify(payload), text],
    );
  } catch (error) {
    console.error('[sync] failed to persist sync operation log:', error.message);
  }

  const meta = {
    event: `sync.${syncType}`,
    message: text,
    module: 'sync',
    action: syncType,
    reason: 'Operação de sincronização com a cloud',
    tenant_id: tenantId,
    entity: 'sync',
    ...(payload && typeof payload === 'object' ? { sync_payload: payload } : {}),
  };

  if (level === 'warn') logWarn('sync_operation', meta);
  else if (level === 'error') logError('sync_operation', meta);
  else logEvent('info', `sync.${syncType}`, text, meta);
}

export { logSyncError, logSyncOperation };
