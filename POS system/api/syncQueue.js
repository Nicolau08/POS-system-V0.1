import { get, run } from './dbUtils.js';

function resolveTenantIdFromPayload(payload) {
  const tenantId = String(payload?.tenant_id ?? payload?.tenantId ?? '').trim();
  if (!tenantId) throw new Error('enqueueSync requires payload.tenant_id');
  return tenantId;
}

function buildDedupeKey(type, payload, tenantId) {
  if (type === 'product' && payload?.id) return `${tenantId}:product:${Number(payload.id)}`;
  if (type === 'customer' && payload?.id) return `${tenantId}:customer:${Number(payload.id)}`;
  if (type === 'category' && payload?.id) return `${tenantId}:category:${Number(payload.id)}`;
  return null;
}

function buildSyncRef(type, payload, tenantId) {
  if (payload?.syncRef) return `${tenantId}:${String(payload.syncRef)}`;
  if (type === 'sale' && payload?.local_sale_id) return `${tenantId}:sale:${payload.local_sale_id}`;
  if (payload?.id != null) return `${tenantId}:${type}:${payload.id}`;
  return null;
}

async function enqueueSync(type, payload, options = {}) {
  if (!type) throw new Error('enqueueSync requires type');
  const normalizedPayload = payload ?? {};
  const tenantId = resolveTenantIdFromPayload(normalizedPayload);
  normalizedPayload.tenant_id = tenantId;
  const dedupeKey = buildDedupeKey(type, normalizedPayload, tenantId);
  const syncRef = buildSyncRef(type, normalizedPayload, tenantId);
  const now = new Date().toISOString();

  if (syncRef) {
    const existingByRef = await get(
      `SELECT id, status
       FROM sync_queue
       WHERE tenant_id = ?
         AND sync_ref = ?
         AND status IN ('pending', 'failed', 'dead')
       ORDER BY id DESC
       LIMIT 1`,
      [tenantId, syncRef]
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

  if ((type === 'product' || type === 'customer' || type === 'category') && dedupeKey) {
    const existing = await get(
      `SELECT id
       FROM sync_queue
       WHERE tenant_id = ?
         AND type = ?
         AND dedupe_key = ?
         AND status IN ('pending', 'failed')
       ORDER BY id DESC
       LIMIT 1`,
      [tenantId, type, dedupeKey]
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
    `INSERT INTO sync_queue (tenant_id, type, data, dedupe_key, sync_ref, status, retries, next_retry_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'pending', 0, ?, ?, ?)`,
    [tenantId, type, JSON.stringify(normalizedPayload), dedupeKey, syncRef, now, now, now]
  );
}

export { enqueueSync };
