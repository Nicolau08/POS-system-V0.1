import { get, run } from './dbUtils.js';

function buildDedupeKey(type, payload) {
  if (type === 'product' && payload?.id) return `product:${Number(payload.id)}`;
  if (type === 'customer' && payload?.id) return `customer:${Number(payload.id)}`;
  return null;
}

function buildSyncRef(type, payload) {
  if (payload?.syncRef) return String(payload.syncRef);
  if (type === 'sale' && payload?.local_sale_id) return `sale:${payload.local_sale_id}`;
  if (payload?.id != null) return `${type}:${payload.id}`;
  return null;
}

async function enqueueSync(type, payload, options = {}) {
  if (!type) throw new Error('enqueueSync requires type');
  const normalizedPayload = payload ?? {};
  const dedupeKey = buildDedupeKey(type, normalizedPayload);
  const syncRef = buildSyncRef(type, normalizedPayload);
  const now = new Date().toISOString();

  if (syncRef) {
    const existingByRef = await get(
      `SELECT id, status
       FROM sync_queue
       WHERE sync_ref = ?
         AND status IN ('pending', 'failed', 'dead')
       ORDER BY id DESC
       LIMIT 1`,
      [syncRef]
    );

    if (existingByRef && options.allowReplace !== false) {
      return run(
        `UPDATE sync_queue
         SET type = ?, data = ?, status = 'pending', retries = 0, next_retry_at = ?, updated_at = ?, lock_token = NULL, locked_at = NULL
         WHERE id = ?`,
        [type, JSON.stringify(normalizedPayload), now, now, existingByRef.id]
      );
    }
  }

  if ((type === 'product' || type === 'customer') && dedupeKey) {
    const existing = await get(
      `SELECT id
       FROM sync_queue
       WHERE type = ?
         AND dedupe_key = ?
         AND status IN ('pending', 'failed')
       ORDER BY id DESC
       LIMIT 1`,
      [type, dedupeKey]
    );

    if (existing) {
      return run(
        `UPDATE sync_queue
         SET data = ?, sync_ref = COALESCE(sync_ref, ?), status = 'pending', retries = 0, next_retry_at = ?, updated_at = ?, lock_token = NULL, locked_at = NULL
         WHERE id = ?`,
        [JSON.stringify(normalizedPayload), syncRef, now, now, existing.id]
      );
    }
  }

  return run(
    `INSERT INTO sync_queue (type, data, dedupe_key, sync_ref, status, retries, next_retry_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'pending', 0, ?, ?, ?)`,
    [type, JSON.stringify(normalizedPayload), dedupeKey, syncRef, now, now, now]
  );
}

export { enqueueSync };
