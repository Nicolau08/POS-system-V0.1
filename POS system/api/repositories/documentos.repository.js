import { all, get, run } from '../dbUtils.js';

export function queryAll(sql, params = []) {
  return all(sql, params);
}

export function queryOne(sql, params = []) {
  return get(sql, params);
}

export function execute(sql, params = []) {
  return run(sql, params);
}

export function listDocumentos(orderedSql, params) {
  return all(orderedSql, params);
}

export function listDocumentosPaginated(orderedSql, params, limit, offset) {
  return all(`${orderedSql} LIMIT ? OFFSET ?`, [...params, limit, offset]);
}

export async function countDocumentos(docsBaseSql, whereSql, params) {
  const row = await get(`SELECT COUNT(*) AS total ${docsBaseSql}${whereSql}`, params);
  return Number(row?.total ?? 0);
}

export function updateVendaApproval(saleId, approvedDocType, approvedDocumentNumber, tenantId) {
  return run(
    `UPDATE vendas
     SET status = ?,
         approved_document_type = ?,
         approved_document_number = ?
     WHERE id = ?
       AND tenant_id = ?`,
    ['approved', approvedDocType, approvedDocumentNumber, saleId, tenantId]
  );
}

export function updateOrderApproval(sourceId, approvedDocType, approvedDocumentNumber, updatedAt, tenantId) {
  return run(
    `UPDATE orders
     SET status = ?,
         approved_document_type = ?,
         approved_document_number = ?,
         updated_at = ?
     WHERE CAST(id AS TEXT) = ?
       AND tenant_id = ?`,
    ['approved', approvedDocType, approvedDocumentNumber, updatedAt, sourceId, tenantId]
  );
}

export function updateOrderPaymentStatus(orderId, nextStatus, updatedAt, tenantId) {
  return run(
    `UPDATE orders
     SET status = ?,
         updated_at = ?
     WHERE CAST(id AS TEXT) = ?
       AND tenant_id = ?`,
    [nextStatus, updatedAt, orderId, tenantId]
  );
}

export function findOrderById(orderId, tenantId) {
  return get(
    `SELECT id
     FROM orders
     WHERE CAST(id AS TEXT) = ?
       AND tenant_id = ?
     LIMIT 1`,
    [orderId, tenantId]
  );
}

/** Itens de orders, vendas locais e inventário rápido (stock_movements INV-COUNT). */
function buildDocumentoItemsSelectSql(whereSql) {
  // whereSql: "WHERE 1=1" ou com filtro em product_name (coluna do SELECT externo).
  return `
    SELECT id, order_id, product_id, product_name, quantity, price, discount_amount, created_at
    FROM (
      SELECT
        oi.id AS id,
        oi.order_id AS order_id,
        oi.product_id AS product_id,
        oi.product_name AS product_name,
        oi.quantity AS quantity,
        oi.price AS price,
        oi.discount_amount AS discount_amount,
        oi.created_at AS created_at
      FROM order_items oi
      WHERE oi.tenant_id = ?
        AND (
          EXISTS (
            SELECT 1
            FROM orders o
            WHERE CAST(o.id AS TEXT) = CAST(oi.order_id AS TEXT)
              AND o.tenant_id = oi.tenant_id
          )
          OR EXISTS (
            SELECT 1
            FROM vendas v
            WHERE CAST(v.id AS TEXT) = CAST(oi.order_id AS TEXT)
              AND v.tenant_id = oi.tenant_id
          )
        )

      UNION ALL

      SELECT
        ('inv-item:' || CAST(sm.id AS TEXT)) AS id,
        ('inv:' || CAST(sm.id AS TEXT)) AS order_id,
        CAST(sm.product_id AS TEXT) AS product_id,
        p.name AS product_name,
        sm.quantity AS quantity,
        COALESCE(p.price, 0) AS price,
        0 AS discount_amount,
        sm.created_at AS created_at
      FROM stock_movements sm
      INNER JOIN products p
        ON p.id = sm.product_id
       AND p.tenant_id = sm.tenant_id
      WHERE sm.tenant_id = ?
        AND sm.reference_id LIKE 'INV-COUNT:%'
    ) items
    ${whereSql}
    ORDER BY datetime(created_at) DESC, id DESC`;
}

export function listDocumentoItems(whereSql, params, tenantId) {
  return all(buildDocumentoItemsSelectSql(whereSql), [tenantId, tenantId, ...params]);
}

export function listDocumentoItemsPaginated(whereSql, params, limit, offset, tenantId) {
  return all(
    `${buildDocumentoItemsSelectSql(whereSql)}
     LIMIT ? OFFSET ?`,
    [tenantId, tenantId, ...params, limit, offset]
  );
}

export async function countDocumentoItems(whereSql, params, tenantId) {
  const row = await get(
    `SELECT COUNT(*) AS total
     FROM (
       SELECT id, product_name
       FROM (
         SELECT
           oi.id AS id,
           oi.product_name AS product_name
         FROM order_items oi
         WHERE oi.tenant_id = ?
           AND (
             EXISTS (
               SELECT 1
               FROM orders o
               WHERE CAST(o.id AS TEXT) = CAST(oi.order_id AS TEXT)
                 AND o.tenant_id = oi.tenant_id
             )
             OR EXISTS (
               SELECT 1
               FROM vendas v
               WHERE CAST(v.id AS TEXT) = CAST(oi.order_id AS TEXT)
                 AND v.tenant_id = oi.tenant_id
             )
           )

         UNION ALL

         SELECT
           ('inv-item:' || CAST(sm.id AS TEXT)) AS id,
           p.name AS product_name
         FROM stock_movements sm
         INNER JOIN products p
           ON p.id = sm.product_id
          AND p.tenant_id = sm.tenant_id
         WHERE sm.tenant_id = ?
           AND sm.reference_id LIKE 'INV-COUNT:%'
       ) items
       ${whereSql}
     ) counted`,
    [tenantId, tenantId, ...params]
  );
  return Number(row?.total ?? 0);
}

export function getNextOrderSequence(prefix, year, tenantId) {
  return get(
    `SELECT COALESCE(MAX(COALESCE(doc_sequence, 0)), 0) + 1 AS next
       FROM orders
      WHERE UPPER(COALESCE(doc_prefix, '')) = ?
        AND COALESCE(doc_year, 0) = ?
        AND tenant_id = ?`,
    [prefix, year, tenantId]
  );
}

export function beginImmediateTransaction() {
  return run('BEGIN IMMEDIATE TRANSACTION');
}

export function commitTransaction() {
  return run('COMMIT');
}

export function rollbackTransaction() {
  return run('ROLLBACK');
}

export function insertOrder(params) {
  return run(
    `INSERT INTO orders
      (id, customer_id, user_id, user_name, total, subtotal, tax, discount, payment_method, status, doc_type, doc_prefix, doc_year, doc_sequence, document_number, created_at, updated_at, tenant_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    params
  );
}

export function insertOrderItem(params) {
  return run(
    `INSERT INTO order_items
      (id, order_id, tenant_id, product_id, product_name, quantity, price, discount_amount, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    params
  );
}

export function increaseProductStock(params) {
  return run(
    `UPDATE products
     SET stock_quantity = COALESCE(stock_quantity, 0) + ?,
         cost = ?,
         updated_at = ?
     WHERE CAST(id AS TEXT) = ?
       AND tenant_id = ?
       AND COALESCE(deleted, 0) = 0`,
    params
  );
}

export function insertStockMovement(params) {
  return run(
    `INSERT INTO stock_movements
      (cloud_id, tenant_id, product_id, movement_type, quantity, reference_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    params
  );
}

export function getProductForSync(localProductId, tenantId) {
  return get(
    `SELECT
       id, cloud_id, code, name, category_id, barcode, cost, price, tax, final_price,
       active, unit, description, age_restriction, is_service, default_quantity, tenant_id,
       stock_quantity, min_stock, color, image, deleted
     FROM products
     WHERE CAST(id AS TEXT) = ?
       AND tenant_id = ?
       AND COALESCE(deleted, 0) = 0
     LIMIT 1`,
    [String(localProductId), tenantId]
  );
}

export function listDashboardOrderRows(tenantId) {
  return all(
    `
      SELECT
        o.id,
        o.status,
        o.total,
        o.created_at,
        o.customer_id,
        COALESCE(c.name, 'Consumidor final') AS client_name
      FROM orders o
      LEFT JOIN clientes c
        ON CAST(c.id AS TEXT) = CAST(o.customer_id AS TEXT)
       AND c.tenant_id = o.tenant_id
      WHERE o.tenant_id = ?
      ORDER BY datetime(o.created_at) DESC, o.id DESC
    `,
    [tenantId]
  );
}

export function listDashboardSaleRows(tenantId) {
  return all(
    `
      SELECT
        CAST(v.id AS TEXT) AS id,
        CASE
          WHEN LOWER(REPLACE(COALESCE(v.payment_method, ''), '-', ' ')) LIKE '%conta corrente%' THEN 'pending'
          ELSE 'completed'
        END AS status,
        v.total AS total,
        v.data AS created_at,
        v.customer_id AS customer_id,
        COALESCE(c.name, v.customer_name, 'Consumidor final') AS client_name
      FROM vendas v
      LEFT JOIN clientes c
        ON CAST(c.cloud_id AS TEXT) = CAST(v.customer_id AS TEXT)
       AND c.tenant_id = v.tenant_id
      WHERE v.tenant_id = ?
      ORDER BY datetime(v.data) DESC, v.id DESC
    `,
    [tenantId]
  );
}

export function listDashboardOrderItems(tenantId) {
  return all(
    `
      SELECT
        oi.order_id,
        oi.product_name,
        oi.quantity,
        oi.price
      FROM order_items oi
      INNER JOIN orders o ON CAST(o.id AS TEXT) = CAST(oi.order_id AS TEXT)
      WHERE o.tenant_id = ?
      ORDER BY datetime(oi.created_at) DESC, oi.id DESC
    `,
    [tenantId]
  );
}

export function listDashboardCustomers(tenantId) {
  return all(
    `SELECT id, cloud_id, name
     FROM clientes
     WHERE tenant_id = ?
     ORDER BY name ASC`,
    [tenantId]
  );
}

export function getNextVdSequence(tenantId) {
  return get(
    `SELECT COALESCE(MAX(COALESCE(doc_sequence, id)), 0) + 1 AS next
       FROM vendas
      WHERE UPPER(COALESCE(doc_type, 'VD')) = 'VD'
        AND tenant_id = ?`,
    [tenantId]
  );
}
