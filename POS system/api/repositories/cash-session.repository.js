import crypto from 'crypto';
import { all, get, run } from '../dbUtils.js';

export function getOpenCashSession(tenantId, registerCode = 'caixa-1') {
  return get(
    `SELECT *
       FROM cash_sessions
      WHERE tenant_id = ?
        AND register_code = ?
        AND status = 'open'
      ORDER BY opened_at DESC
      LIMIT 1`,
    [tenantId, registerCode],
  );
}

export function getCashSessionById(tenantId, sessionId) {
  return get(`SELECT * FROM cash_sessions WHERE tenant_id = ? AND id = ?`, [tenantId, sessionId]);
}

export async function insertCashSession(row) {
  await run(
    `INSERT INTO cash_sessions (
       id, tenant_id, register_code, status, opened_at, opened_by_id, opened_by_name,
       closed_at, closed_by_id, closed_by_name, z_number
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      row.id,
      row.tenant_id,
      row.register_code,
      row.status,
      row.opened_at,
      row.opened_by_id ?? null,
      row.opened_by_name ?? null,
      row.closed_at ?? null,
      row.closed_by_id ?? null,
      row.closed_by_name ?? null,
      row.z_number ?? null,
    ],
  );
  return row;
}

export async function closeCashSession(tenantId, sessionId, { closedAt, closedById, closedByName, zNumber }) {
  await run(
    `UPDATE cash_sessions
        SET status = 'closed',
            closed_at = ?,
            closed_by_id = ?,
            closed_by_name = ?,
            z_number = ?
      WHERE tenant_id = ?
        AND id = ?
        AND status = 'open'`,
    [closedAt, closedById ?? null, closedByName ?? null, zNumber ?? null, tenantId, sessionId],
  );
}

export function listSessionSales(tenantId, openedAt, closedAt = null) {
  const params = [tenantId, openedAt];
  let endClause = '';
  if (closedAt) {
    endClause = ' AND datetime(v.data) <= datetime(?)';
    params.push(closedAt);
  }
  return all(
    `SELECT v.id, v.total, v.data, v.doc_type, v.payment_method, v.user_id, v.user_name, v.status
       FROM vendas v
      WHERE v.tenant_id = ?
        AND datetime(v.data) >= datetime(?)
        ${endClause}
        AND UPPER(COALESCE(v.doc_type, 'VD')) <> 'FP'
        AND LOWER(COALESCE(v.status, '')) NOT IN ('cancelled', 'canceled', 'void', 'anulado')
      ORDER BY datetime(v.data) ASC`,
    params,
  );
}

export function listSessionSaleItems(tenantId, openedAt, closedAt = null) {
  const params = [tenantId, openedAt];
  let endClause = '';
  if (closedAt) {
    endClause = ' AND datetime(o.created_at) <= datetime(?)';
    params.push(closedAt);
  }
  return all(
    `SELECT oi.product_name AS name,
            SUM(oi.quantity) AS quantity,
            SUM(oi.quantity * oi.price) AS total
       FROM order_items oi
       INNER JOIN orders o ON CAST(o.id AS TEXT) = CAST(oi.order_id AS TEXT)
      WHERE oi.tenant_id = ?
        AND datetime(o.created_at) >= datetime(?)
        ${endClause}
        AND UPPER(COALESCE(o.doc_type, 'VD')) <> 'FP'
      GROUP BY oi.product_name
      ORDER BY total DESC`,
    params,
  );
}

export function listWithdrawals(sessionId) {
  return all(
    `SELECT * FROM cash_withdrawals WHERE session_id = ? ORDER BY datetime(created_at) ASC`,
    [sessionId],
  );
}

export async function insertWithdrawal(row) {
  const id = row.id || crypto.randomUUID();
  await run(
    `INSERT INTO cash_withdrawals (
       id, session_id, tenant_id, user_id, user_name, amount, scope, note, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      row.session_id,
      row.tenant_id,
      row.user_id ?? null,
      row.user_name ?? null,
      Number(row.amount) || 0,
      row.scope,
      row.note ?? null,
      row.created_at || new Date().toISOString(),
    ],
  );
  return { ...row, id };
}

export function getNextZNumber(tenantId) {
  return get(`SELECT COALESCE(MAX(z_number), 0) AS max_z FROM z_reports WHERE tenant_id = ?`, [tenantId]);
}

export async function insertZReport(row) {
  await run(
    `INSERT INTO z_reports (
       id, session_id, tenant_id, z_number, generated_at, generated_by_id, generated_by_name, payload_json
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      row.id,
      row.session_id,
      row.tenant_id,
      row.z_number,
      row.generated_at,
      row.generated_by_id ?? null,
      row.generated_by_name ?? null,
      row.payload_json,
    ],
  );
  return row;
}

export function listZReports(tenantId, { from = null, to = null, limit = 100 } = {}) {
  const where = ['tenant_id = ?'];
  const params = [tenantId];
  if (from) {
    where.push('datetime(generated_at) >= datetime(?)');
    params.push(from);
  }
  if (to) {
    where.push('datetime(generated_at) <= datetime(?)');
    params.push(to);
  }
  const safeLimit = Math.min(500, Math.max(1, Number(limit) || 100));
  return all(
    `SELECT id, session_id, tenant_id, z_number, generated_at, generated_by_id, generated_by_name
       FROM z_reports
      WHERE ${where.join(' AND ')}
      ORDER BY z_number DESC
      LIMIT ?`,
    [...params, safeLimit],
  );
}

export function getZReportById(tenantId, id) {
  return get(`SELECT * FROM z_reports WHERE tenant_id = ? AND id = ?`, [tenantId, id]);
}
