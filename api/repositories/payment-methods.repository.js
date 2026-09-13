import { all, get, run } from '../dbUtils.js';

export function listPaymentMethods(whereSql, params) {
  return all(
    `SELECT
      id, name, code, shortcut, position, enabled, quick_payment, required_customer, allow_change, mark_as_paid, print_receipt, open_cash_drawer, color
     FROM payment_methods
     ${whereSql}
     ORDER BY position ASC, name ASC`,
    params
  );
}

export function listPaymentMethodsPaginated(whereSql, params, limit, offset) {
  return all(
    `SELECT
      id, name, code, shortcut, position, enabled, quick_payment, required_customer, allow_change, mark_as_paid, print_receipt, open_cash_drawer, color
     FROM payment_methods
     ${whereSql}
     ORDER BY position ASC, name ASC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
}

export async function countPaymentMethods(whereSql, params) {
  const row = await get(`SELECT COUNT(*) AS total FROM payment_methods ${whereSql}`, params);
  return Number(row?.total ?? 0);
}

export function insertPaymentMethod(payload) {
  return run(
    `INSERT INTO payment_methods
      (name, code, tenant_id, shortcut, position, enabled, quick_payment, required_customer, allow_change, mark_as_paid, print_receipt, open_cash_drawer, color, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    payload
  );
}

export function updatePaymentMethod(id, tenantId, payload) {
  return run(
    `UPDATE payment_methods SET
      name = ?,
      code = ?,
      tenant_id = ?,
      shortcut = ?,
      position = ?,
      enabled = ?,
      quick_payment = ?,
      required_customer = ?,
      allow_change = ?,
      mark_as_paid = ?,
      print_receipt = ?,
      open_cash_drawer = ?,
      color = ?,
      updated_at = ?
     WHERE id = ?
       AND tenant_id = ?`,
    [...payload, id, tenantId]
  );
}

export function deletePaymentMethod(id, tenantId) {
  return run(`DELETE FROM payment_methods WHERE id = ? AND tenant_id = ?`, [id, tenantId]);
}

export function deleteAllPaymentMethods(tenantId) {
  return run(`DELETE FROM payment_methods WHERE tenant_id = ?`, [tenantId]);
}
