import { all, get, run } from '../dbUtils.js';

export function listPrintCenters(tenantId) {
  return all(
    `SELECT id, tenant_id, name, connection_type, windows_printer_name, host, port,
            paper_width, enabled, sort_order, created_at, updated_at
     FROM print_centers
     WHERE tenant_id = ?
     ORDER BY sort_order ASC, name ASC`,
    [tenantId]
  );
}

export function getPrintCenterById(id, tenantId) {
  return get(
    `SELECT id, tenant_id, name, connection_type, windows_printer_name, host, port,
            paper_width, enabled, sort_order, created_at, updated_at
     FROM print_centers
     WHERE id = ? AND tenant_id = ?`,
    [id, tenantId]
  );
}

export function insertPrintCenter(row) {
  return run(
    `INSERT INTO print_centers
      (id, tenant_id, name, connection_type, windows_printer_name, host, port,
       paper_width, enabled, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    row
  );
}

export function updatePrintCenter(id, tenantId, payload) {
  return run(
    `UPDATE print_centers SET
      name = ?,
      connection_type = ?,
      windows_printer_name = ?,
      host = ?,
      port = ?,
      paper_width = ?,
      enabled = ?,
      sort_order = ?,
      updated_at = ?
     WHERE id = ? AND tenant_id = ?`,
    [...payload, id, tenantId]
  );
}

export function deletePrintCenter(id, tenantId) {
  return run(`DELETE FROM print_centers WHERE id = ? AND tenant_id = ?`, [id, tenantId]);
}

export function listCategoriesForCenter(printCenterId, tenantId) {
  return all(
    `SELECT pcc.category_id, c.name AS category_name, c.parent_id
     FROM print_center_categories pcc
     LEFT JOIN categories c ON c.id = pcc.category_id AND c.tenant_id = pcc.tenant_id
     WHERE pcc.print_center_id = ? AND pcc.tenant_id = ?
     ORDER BY c.name ASC`,
    [printCenterId, tenantId]
  );
}

export function listAllCategoriesWithNames(tenantId) {
  return all(
    `SELECT pcc.print_center_id, pcc.category_id, c.name AS category_name, c.parent_id
     FROM print_center_categories pcc
     LEFT JOIN categories c ON c.id = pcc.category_id AND c.tenant_id = pcc.tenant_id
     WHERE pcc.tenant_id = ?
     ORDER BY c.name ASC`,
    [tenantId]
  );
}

/** Mapeamentos categoria → centro (sem JOIN de nomes). */
export function listAllCategoryMappings(tenantId) {
  return all(
    `SELECT print_center_id, category_id
     FROM print_center_categories
     WHERE tenant_id = ?`,
    [tenantId]
  );
}

export function deleteCategoriesForCenter(printCenterId, tenantId) {
  return run(`DELETE FROM print_center_categories WHERE print_center_id = ? AND tenant_id = ?`, [
    printCenterId,
    tenantId,
  ]);
}

export function insertCategoryMapping(printCenterId, categoryId, tenantId) {
  return run(
    `INSERT OR IGNORE INTO print_center_categories (print_center_id, category_id, tenant_id)
     VALUES (?, ?, ?)`,
    [printCenterId, categoryId, tenantId]
  );
}

export function findCenterIdByCategory(categoryId, tenantId) {
  return get(
    `SELECT print_center_id
     FROM print_center_categories
     WHERE category_id = ? AND tenant_id = ?
     LIMIT 1`,
    [categoryId, tenantId]
  );
}

export function clearCategoryFromOtherCenters(categoryId, tenantId, keepCenterId) {
  return run(
    `DELETE FROM print_center_categories
     WHERE category_id = ? AND tenant_id = ? AND print_center_id != ?`,
    [categoryId, tenantId, keepCenterId]
  );
}
