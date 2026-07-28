import { all, get, run } from '../dbUtils.js';

export function listWarehouses(tenantId) {
  return all(
    `SELECT id, tenant_id, name, code, is_default, is_active, created_at, updated_at
     FROM warehouses
     WHERE tenant_id = ?
     ORDER BY is_default DESC, name ASC`,
    [tenantId]
  );
}

export function getWarehouseById(id, tenantId) {
  return get(
    `SELECT id, tenant_id, name, code, is_default, is_active, created_at, updated_at
     FROM warehouses
     WHERE id = ? AND tenant_id = ?`,
    [id, tenantId]
  );
}

export function getDefaultWarehouse(tenantId) {
  return get(
    `SELECT id, tenant_id, name, code, is_default, is_active, created_at, updated_at
     FROM warehouses
     WHERE tenant_id = ? AND is_default = 1
     LIMIT 1`,
    [tenantId]
  );
}

export function countWarehouses(tenantId) {
  return get(`SELECT COUNT(*) AS total FROM warehouses WHERE tenant_id = ?`, [tenantId]);
}

export function insertWarehouse(row) {
  return run(
    `INSERT INTO warehouses
      (id, tenant_id, name, code, is_default, is_active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    row
  );
}

export function updateWarehouse(id, tenantId, payload) {
  return run(
    `UPDATE warehouses SET
      name = ?,
      code = ?,
      is_active = ?,
      updated_at = ?
     WHERE id = ? AND tenant_id = ?`,
    [...payload, id, tenantId]
  );
}

export function clearDefaultWarehouse(tenantId, updatedAt) {
  return run(
    `UPDATE warehouses SET is_default = 0, updated_at = ? WHERE tenant_id = ? AND is_default = 1`,
    [updatedAt, tenantId]
  );
}

export function setWarehouseDefault(id, tenantId, updatedAt) {
  return run(
    `UPDATE warehouses SET is_default = 1, is_active = 1, updated_at = ?
     WHERE id = ? AND tenant_id = ?`,
    [updatedAt, id, tenantId]
  );
}

export function getWarehouseStockSum(warehouseId, tenantId) {
  return get(
    `SELECT COALESCE(SUM(quantity), 0) AS total
     FROM warehouse_stock
     WHERE warehouse_id = ? AND tenant_id = ?`,
    [warehouseId, tenantId]
  );
}

export function getWarehouseStockRow(warehouseId, productId, tenantId) {
  return get(
    `SELECT warehouse_id, product_id, tenant_id, quantity, updated_at
     FROM warehouse_stock
     WHERE warehouse_id = ? AND product_id = ? AND tenant_id = ?`,
    [warehouseId, productId, tenantId]
  );
}

export function listWarehouseStockByProduct(productId, tenantId) {
  return all(
    `SELECT ws.warehouse_id, ws.product_id, ws.tenant_id, ws.quantity, ws.updated_at,
            w.name AS warehouse_name, w.is_default, w.is_active
     FROM warehouse_stock ws
     INNER JOIN warehouses w ON w.id = ws.warehouse_id AND w.tenant_id = ws.tenant_id
     WHERE ws.product_id = ? AND ws.tenant_id = ?
     ORDER BY w.is_default DESC, w.name ASC`,
    [productId, tenantId]
  );
}

export function listWarehouseStockForWarehouse(warehouseId, tenantId) {
  return all(
    `SELECT warehouse_id, product_id, tenant_id, quantity, updated_at
     FROM warehouse_stock
     WHERE warehouse_id = ? AND tenant_id = ?`,
    [warehouseId, tenantId]
  );
}

export function upsertWarehouseStockDelta(warehouseId, productId, tenantId, delta, updatedAt) {
  return run(
    `INSERT INTO warehouse_stock (warehouse_id, product_id, tenant_id, quantity, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(warehouse_id, product_id) DO UPDATE SET
       quantity = quantity + excluded.quantity,
       updated_at = excluded.updated_at`,
    [warehouseId, productId, tenantId, delta, updatedAt]
  );
}

export function setWarehouseStockQuantity(warehouseId, productId, tenantId, quantity, updatedAt) {
  return run(
    `INSERT INTO warehouse_stock (warehouse_id, product_id, tenant_id, quantity, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(warehouse_id, product_id) DO UPDATE SET
       quantity = excluded.quantity,
       updated_at = excluded.updated_at`,
    [warehouseId, productId, tenantId, quantity, updatedAt]
  );
}

export function sumProductWarehouseStock(productId, tenantId) {
  return get(
    `SELECT COALESCE(SUM(quantity), 0) AS total
     FROM warehouse_stock
     WHERE product_id = ? AND tenant_id = ?`,
    [productId, tenantId]
  );
}

export function refreshProductStockCache(productId, tenantId, updatedAt) {
  return run(
    `UPDATE products
     SET stock_quantity = (
           SELECT COALESCE(SUM(quantity), 0)
           FROM warehouse_stock
           WHERE product_id = products.id AND tenant_id = products.tenant_id
         ),
         updated_at = ?
     WHERE id = ? AND tenant_id = ? AND COALESCE(deleted, 0) = 0`,
    [updatedAt, productId, tenantId]
  );
}

export function insertStockMovementWithWarehouse(params) {
  return run(
    `INSERT INTO stock_movements
      (cloud_id, tenant_id, product_id, movement_type, quantity, reference_id,
       warehouse_id, from_warehouse_id, to_warehouse_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    params
  );
}

export function backfillWarehouseStockFromProducts(tenantId, warehouseId, updatedAt) {
  return run(
    `INSERT INTO warehouse_stock (warehouse_id, product_id, tenant_id, quantity, updated_at)
     SELECT ?, p.id, p.tenant_id, COALESCE(p.stock_quantity, 0), ?
     FROM products p
     WHERE p.tenant_id = ?
       AND COALESCE(p.deleted, 0) = 0
       AND COALESCE(p.is_service, 0) = 0
       AND COALESCE(p.product_kind, 'simple') != 'composed'
       AND NOT EXISTS (
         SELECT 1 FROM warehouse_stock ws
         WHERE ws.product_id = p.id AND ws.tenant_id = p.tenant_id
       )`,
    [warehouseId, updatedAt, tenantId]
  );
}

export function backfillStockMovementsWarehouse(tenantId, warehouseId) {
  return run(
    `UPDATE stock_movements
     SET warehouse_id = ?
     WHERE tenant_id = ?
       AND (warehouse_id IS NULL OR TRIM(COALESCE(warehouse_id, '')) = '')`,
    [warehouseId, tenantId]
  );
}

export function recalculateAllProductStockCaches(tenantId, updatedAt) {
  return run(
    `UPDATE products
     SET stock_quantity = (
           SELECT COALESCE(SUM(quantity), 0)
           FROM warehouse_stock
           WHERE product_id = products.id AND tenant_id = products.tenant_id
         ),
         updated_at = ?
     WHERE tenant_id = ?
       AND COALESCE(deleted, 0) = 0
       AND EXISTS (
         SELECT 1 FROM warehouse_stock ws
         WHERE ws.product_id = products.id AND ws.tenant_id = products.tenant_id
       )`,
    [updatedAt, tenantId]
  );
}

export function updateProductCost(productId, tenantId, cost, updatedAt) {
  return run(
    `UPDATE products
     SET cost = ?, updated_at = ?
     WHERE CAST(id AS TEXT) = ? AND tenant_id = ? AND COALESCE(deleted, 0) = 0`,
    [cost, updatedAt, String(productId), tenantId]
  );
}
