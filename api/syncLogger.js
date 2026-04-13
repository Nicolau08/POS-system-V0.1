import { run } from './dbUtils.js';

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
  const payloadString = payload == null ? null : JSON.stringify(payload);

  try {
    await run(
      `INSERT INTO sync_logs (queue_id, type, payload, error_message) VALUES (?, ?, ?, ?)`,
      [queueId, type, payloadString, errorMessage]
    );
  } catch (logErr) {
    console.error('[sync] failed to persist sync log:', logErr.message);
  }

  console.error('[sync] error:', {
    queueId,
    type,
    message: errorMessage,
    code: errorObj?.code ?? null,
    details: errorObj?.details ?? null,
    hint: errorObj?.hint ?? null,
    errorRaw: error ?? null,
    payload,
  });
}

export { logSyncError };
