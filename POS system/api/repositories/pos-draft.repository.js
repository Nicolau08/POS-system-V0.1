import { get, run } from '../dbUtils.js';

export function getPosOpenDraft(tenantId, userId) {
  return get(
    `SELECT tenant_id, user_id, payload_json, updated_at
       FROM pos_open_drafts
      WHERE tenant_id = ?
        AND user_id = ?`,
    [tenantId, userId],
  );
}

export function upsertPosOpenDraft(tenantId, userId, payloadJson, updatedAt) {
  return run(
    `INSERT INTO pos_open_drafts (tenant_id, user_id, payload_json, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(tenant_id, user_id) DO UPDATE SET
       payload_json = excluded.payload_json,
       updated_at = excluded.updated_at`,
    [tenantId, userId, payloadJson, updatedAt],
  );
}

export function deletePosOpenDraft(tenantId, userId) {
  return run(
    `DELETE FROM pos_open_drafts
      WHERE tenant_id = ?
        AND user_id = ?`,
    [tenantId, userId],
  );
}
