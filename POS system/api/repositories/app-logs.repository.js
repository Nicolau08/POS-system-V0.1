import { all, get, run } from '../dbUtils.js';

export function insertAppLog(row) {
  return run(
    `INSERT INTO app_logs (
       id, level, event, message, source, module, action, reason,
       user_id, user_name, tenant_id, request_id, entity, entity_id,
       payload_json, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      row.id,
      row.level,
      row.event,
      row.message,
      row.source ?? null,
      row.module ?? null,
      row.action ?? null,
      row.reason ?? null,
      row.user_id ?? null,
      row.user_name ?? null,
      row.tenant_id ?? null,
      row.request_id ?? null,
      row.entity ?? null,
      row.entity_id ?? null,
      row.payload_json ?? null,
      row.created_at,
    ],
  );
}

export function listAppLogs({
  limit = 100,
  offset = 0,
  level = null,
  event = null,
  q = null,
  from = null,
  to = null,
  userId = null,
} = {}) {
  const where = [];
  const params = [];

  if (level) {
    where.push('level = ?');
    params.push(String(level).toLowerCase());
  }
  if (event) {
    where.push('event LIKE ?');
    params.push(`%${String(event)}%`);
  }
  if (userId) {
    where.push('user_id = ?');
    params.push(String(userId));
  }
  if (from) {
    where.push('created_at >= ?');
    params.push(String(from));
  }
  if (to) {
    where.push('created_at <= ?');
    params.push(String(to));
  }
  if (q) {
    where.push('(message LIKE ? OR event LIKE ? OR reason LIKE ? OR module LIKE ? OR user_name LIKE ?)');
    const like = `%${String(q)}%`;
    params.push(like, like, like, like, like);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const safeLimit = Math.min(500, Math.max(1, Number(limit) || 100));
  const safeOffset = Math.max(0, Number(offset) || 0);

  return all(
    `SELECT id, level, event, message, source, module, action, reason,
            user_id, user_name, tenant_id, request_id, entity, entity_id,
            payload_json, created_at
       FROM app_logs
       ${whereSql}
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?`,
    [...params, safeLimit, safeOffset],
  );
}

export function countAppLogs(filters = {}) {
  const where = [];
  const params = [];
  const { level = null, event = null, q = null, from = null, to = null, userId = null } = filters;

  if (level) {
    where.push('level = ?');
    params.push(String(level).toLowerCase());
  }
  if (event) {
    where.push('event LIKE ?');
    params.push(`%${String(event)}%`);
  }
  if (userId) {
    where.push('user_id = ?');
    params.push(String(userId));
  }
  if (from) {
    where.push('created_at >= ?');
    params.push(String(from));
  }
  if (to) {
    where.push('created_at <= ?');
    params.push(String(to));
  }
  if (q) {
    where.push('(message LIKE ? OR event LIKE ? OR reason LIKE ? OR module LIKE ? OR user_name LIKE ?)');
    const like = `%${String(q)}%`;
    params.push(like, like, like, like, like);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  return get(`SELECT COUNT(*) AS total FROM app_logs ${whereSql}`, params);
}

export function listAuditLogs({ limit = 100, offset = 0, action = null, q = null } = {}) {
  const where = [];
  const params = [];
  if (action) {
    where.push('action LIKE ?');
    params.push(`%${String(action)}%`);
  }
  if (q) {
    where.push('(action LIKE ? OR entity LIKE ? OR details LIKE ?)');
    const like = `%${String(q)}%`;
    params.push(like, like, like);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const safeLimit = Math.min(500, Math.max(1, Number(limit) || 100));
  const safeOffset = Math.max(0, Number(offset) || 0);
  return all(
    `SELECT id, user_id, action, entity, entity_id, details, created_at
       FROM audit_logs
       ${whereSql}
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?`,
    [...params, safeLimit, safeOffset],
  );
}

export function listSyncLogs({ limit = 100, offset = 0, q = null, type = null, tenantId = null } = {}) {
  const where = [];
  const params = [];
  if (tenantId) {
    where.push('(tenant_id = ? OR tenant_id IS NULL)');
    params.push(String(tenantId));
  }
  if (type) {
    where.push('type LIKE ?');
    params.push(`%${String(type)}%`);
  }
  if (q) {
    where.push(
      `(LOWER(COALESCE(type, '')) LIKE LOWER(?) OR LOWER(COALESCE(error_message, '')) LIKE LOWER(?) OR LOWER(COALESCE(payload, '')) LIKE LOWER(?))`,
    );
    const like = `%${String(q)}%`;
    params.push(like, like, like);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const safeLimit = Math.min(500, Math.max(1, Number(limit) || 100));
  const safeOffset = Math.max(0, Number(offset) || 0);
  return all(
    `SELECT id, queue_id, tenant_id, type, payload, error_message, created_at
       FROM sync_logs
       ${whereSql}
      ORDER BY id DESC
      LIMIT ? OFFSET ?`,
    [...params, safeLimit, safeOffset],
  );
}

export function countSyncLogs({ q = null, type = null, tenantId = null } = {}) {
  const where = [];
  const params = [];
  if (tenantId) {
    where.push('(tenant_id = ? OR tenant_id IS NULL)');
    params.push(String(tenantId));
  }
  if (type) {
    where.push('type LIKE ?');
    params.push(`%${String(type)}%`);
  }
  if (q) {
    where.push(
      `(LOWER(COALESCE(type, '')) LIKE LOWER(?) OR LOWER(COALESCE(error_message, '')) LIKE LOWER(?) OR LOWER(COALESCE(payload, '')) LIKE LOWER(?))`,
    );
    const like = `%${String(q)}%`;
    params.push(like, like, like);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  return get(`SELECT COUNT(*) AS total FROM sync_logs ${whereSql}`, params);
}
