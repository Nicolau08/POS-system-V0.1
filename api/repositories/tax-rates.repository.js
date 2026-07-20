import { all, get, run } from '../dbUtils.js';

export function listTaxRates(tenantId) {
  return all(
    `SELECT id, name, code, rate, is_fixed, price_includes_tax, is_default, enabled, is_system, created_at, updated_at
     FROM tax_rates
     WHERE tenant_id = ?
     ORDER BY COALESCE(is_default, 0) DESC, rate ASC, name ASC`,
    [tenantId],
  );
}

export function getTaxRateById(id, tenantId) {
  return get(
    `SELECT id, name, code, rate, is_fixed, price_includes_tax, is_default, enabled, is_system
     FROM tax_rates
     WHERE id = ? AND tenant_id = ?`,
    [id, tenantId],
  );
}

export function getTaxRateByCode(code, tenantId) {
  return get(
    `SELECT id, name, code, rate, is_fixed, price_includes_tax, is_default, enabled, is_system
     FROM tax_rates
     WHERE tenant_id = ? AND UPPER(code) = UPPER(?)`,
    [tenantId, code],
  );
}

export function getDefaultTaxRate(tenantId) {
  return get(
    `SELECT id, name, code, rate, is_fixed, price_includes_tax, is_default, enabled, is_system
     FROM tax_rates
     WHERE tenant_id = ? AND COALESCE(is_default, 0) = 1 AND COALESCE(enabled, 0) = 1
     ORDER BY id ASC
     LIMIT 1`,
    [tenantId],
  );
}

export function clearDefaultTaxRates(tenantId, exceptId = null) {
  if (exceptId != null) {
    return run(
      `UPDATE tax_rates SET is_default = 0
       WHERE tenant_id = ? AND id <> ? AND COALESCE(is_default, 0) = 1`,
      [tenantId, exceptId],
    );
  }
  return run(
    `UPDATE tax_rates SET is_default = 0
     WHERE tenant_id = ? AND COALESCE(is_default, 0) = 1`,
    [tenantId],
  );
}

export function insertTaxRate(payload) {
  return run(
    `INSERT INTO tax_rates
      (tenant_id, name, code, rate, is_fixed, price_includes_tax, is_default, enabled, is_system, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    payload,
  );
}

export function updateTaxRate(id, tenantId, payload) {
  return run(
    `UPDATE tax_rates
     SET name = ?, code = ?, rate = ?, is_fixed = ?, price_includes_tax = ?, is_default = ?, enabled = ?, updated_at = ?
     WHERE id = ? AND tenant_id = ?`,
    [...payload, id, tenantId],
  );
}

export function deleteTaxRate(id, tenantId) {
  return run(`DELETE FROM tax_rates WHERE id = ? AND tenant_id = ?`, [id, tenantId]);
}

export function countProductsUsingTaxRate(id, tenantId) {
  return get(
    `SELECT COUNT(*) AS total
     FROM products
     WHERE tax_rate_id = ? AND tenant_id = ? AND COALESCE(deleted, 0) = 0`,
    [id, tenantId],
  );
}

export function listProductsByTaxRate(id, tenantId) {
  return all(
    `SELECT id, price
     FROM products
     WHERE tax_rate_id = ? AND tenant_id = ? AND COALESCE(deleted, 0) = 0`,
    [id, tenantId],
  );
}
