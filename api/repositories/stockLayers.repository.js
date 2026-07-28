import crypto from 'crypto';
import { all, get, run } from '../dbUtils.js';

const BACKFILL_SOURCE_PREFIX = 'backfill:fifo';

export function listFifoLayers(tenantId, warehouseId, productId) {
  return all(
    `SELECT id, tenant_id, warehouse_id, product_id, qty_remaining, unit_cost,
            received_at, lot_code, expiry_date, source_ref, created_at, updated_at
     FROM stock_layers
     WHERE tenant_id = ?
       AND warehouse_id = ?
       AND product_id = ?
       AND qty_remaining > 1e-12
     ORDER BY received_at ASC, id ASC`,
    [tenantId, String(warehouseId), Number(productId)]
  );
}

export function sumLayersRemaining(tenantId, warehouseId, productId) {
  return get(
    `SELECT COALESCE(SUM(qty_remaining), 0) AS total
     FROM stock_layers
     WHERE tenant_id = ?
       AND warehouse_id = ?
       AND product_id = ?
       AND qty_remaining > 0`,
    [tenantId, String(warehouseId), Number(productId)]
  );
}

export function sumAllLayersForProduct(tenantId, productId) {
  return get(
    `SELECT COALESCE(SUM(qty_remaining), 0) AS qty,
            COALESCE(SUM(qty_remaining * unit_cost), 0) AS value
     FROM stock_layers
     WHERE tenant_id = ?
       AND product_id = ?
       AND qty_remaining > 0`,
    [tenantId, Number(productId)]
  );
}

export function insertStockLayer(params) {
  return run(
    `INSERT INTO stock_layers
      (id, tenant_id, warehouse_id, product_id, qty_remaining, unit_cost,
       received_at, lot_code, expiry_date, source_ref, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    params
  );
}

export function updateLayerQtyRemaining(layerId, tenantId, qtyRemaining, updatedAt) {
  return run(
    `UPDATE stock_layers
     SET qty_remaining = ?, updated_at = ?
     WHERE id = ? AND tenant_id = ?`,
    [qtyRemaining, updatedAt, String(layerId), tenantId]
  );
}

export function insertLayerConsumption(params) {
  return run(
    `INSERT INTO stock_layer_consumptions
      (id, tenant_id, stock_movement_id, layer_id, qty, unit_cost, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    params
  );
}

export function hasAnyLayerForTrio(tenantId, warehouseId, productId) {
  return get(
    `SELECT id FROM stock_layers
     WHERE tenant_id = ?
       AND warehouse_id = ?
       AND product_id = ?
     LIMIT 1`,
    [tenantId, String(warehouseId), Number(productId)]
  );
}

/**
 * Idempotent backfill: one layer per (tenant, warehouse, product) with qty>0
 * and no existing layers. Uses products.cost as unit_cost.
 */
export async function backfillStockLayersFromWarehouseStock(tenantId) {
  if (!tenantId) return { created: 0 };
  const rows = await all(
    `SELECT ws.warehouse_id, ws.product_id, ws.quantity, COALESCE(p.cost, 0) AS cost
     FROM warehouse_stock ws
     INNER JOIN products p
       ON p.id = ws.product_id AND p.tenant_id = ws.tenant_id
     WHERE ws.tenant_id = ?
       AND ws.quantity > 1e-12
       AND COALESCE(p.deleted, 0) = 0
       AND COALESCE(p.is_service, 0) = 0
       AND COALESCE(p.product_kind, 'simple') NOT IN ('composed', 'service')
       AND NOT EXISTS (
         SELECT 1 FROM stock_layers sl
         WHERE sl.tenant_id = ws.tenant_id
           AND sl.warehouse_id = ws.warehouse_id
           AND sl.product_id = ws.product_id
       )`,
    [tenantId]
  );

  const now = new Date().toISOString();
  let created = 0;
  for (const row of rows || []) {
    const qty = Number(row.quantity) || 0;
    if (qty <= 0) continue;
    await insertStockLayer([
      crypto.randomUUID(),
      tenantId,
      String(row.warehouse_id),
      Number(row.product_id),
      qty,
      Number(row.cost) || 0,
      now,
      null,
      null,
      `${BACKFILL_SOURCE_PREFIX}:${now}`,
      now,
      now,
    ]);
    created += 1;
  }
  return { created };
}

export { BACKFILL_SOURCE_PREFIX };
