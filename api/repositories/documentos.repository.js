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

export function updateOrderNotes(orderId, notes, isWaste, updatedAt, tenantId) {
  return run(
    `UPDATE orders
     SET notes = ?,
         is_waste = ?,
         updated_at = ?
     WHERE CAST(id AS TEXT) = ?
       AND tenant_id = ?`,
    [notes, isWaste ? 1 : 0, updatedAt, orderId, tenantId]
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
    SELECT id, order_id, product_id, product_name, quantity, price, discount_amount,
           unit_cost, cogs_total, created_at
    FROM (
      SELECT
        oi.id AS id,
        oi.order_id AS order_id,
        oi.product_id AS product_id,
        oi.product_name AS product_name,
        oi.quantity AS quantity,
        oi.price AS price,
        oi.discount_amount AS discount_amount,
        oi.unit_cost AS unit_cost,
        oi.cogs_total AS cogs_total,
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
        NULL AS unit_cost,
        NULL AS cogs_total,
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
  // 18 params (legacy) ou 19 (+ external_document)
  if (Array.isArray(params) && params.length >= 19) {
    return run(
      `INSERT INTO orders
        (id, customer_id, user_id, user_name, total, subtotal, tax, discount, payment_method, status,
         doc_type, doc_prefix, doc_year, doc_sequence, document_number, created_at, updated_at, tenant_id,
         external_document)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params,
    );
  }
  return run(
    `INSERT INTO orders
      (id, customer_id, user_id, user_name, total, subtotal, tax, discount, payment_method, status, doc_type, doc_prefix, doc_year, doc_sequence, document_number, created_at, updated_at, tenant_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    params,
  );
}

export function insertOrderItem(params) {
  // 10 params (legacy) or 12 params (+ unit_cost, cogs_total)
  if (Array.isArray(params) && params.length >= 12) {
    return run(
      `INSERT INTO order_items
        (id, order_id, tenant_id, product_id, product_name, quantity, price, discount_amount,
         created_at, updated_at, unit_cost, cogs_total)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params
    );
  }
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
       active, unit, description, age_restriction, is_service, product_kind, default_quantity,
       track_lot, tenant_id, stock_quantity, min_stock, color, image, deleted
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
        o.doc_type,
        o.document_number,
        o.payment_method,
        o.approved_document_type,
        o.approved_document_number,
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
        ('venda:' || CAST(v.id AS TEXT)) AS id,
        CASE
          WHEN UPPER(COALESCE(v.doc_type, '')) = 'FP' THEN 'FP'
          WHEN UPPER(COALESCE(v.doc_type, '')) = 'TK' THEN 'TK'
          WHEN UPPER(COALESCE(v.doc_type, '')) = 'FT' THEN 'FT'
          WHEN UPPER(COALESCE(v.doc_type, '')) = 'VD' THEN 'VD'
          WHEN LOWER(REPLACE(COALESCE(v.payment_method, ''), '-', ' ')) LIKE '%conta corrente%' THEN 'FT'
          ELSE 'VD'
        END AS doc_type,
        (
          CASE
            WHEN UPPER(COALESCE(v.doc_type, '')) = 'FP' THEN 'FP'
            WHEN UPPER(COALESCE(v.doc_type, '')) = 'TK' THEN 'TK'
            WHEN UPPER(COALESCE(v.doc_type, '')) = 'FT' THEN 'FT'
            WHEN UPPER(COALESCE(v.doc_type, '')) = 'VD' THEN 'VD'
            WHEN LOWER(REPLACE(COALESCE(v.payment_method, ''), '-', ' ')) LIKE '%conta corrente%' THEN 'FT'
            ELSE 'VD'
          END
          || '/' ||
          CAST(strftime('%Y', v.data) AS TEXT)
          || '/' ||
          printf('%04d', COALESCE(v.doc_sequence, v.id))
        ) AS document_number,
        v.payment_method AS payment_method,
        v.approved_document_type AS approved_document_type,
        v.approved_document_number AS approved_document_number,
        CASE
          WHEN LOWER(COALESCE(v.status, '')) IN ('approved', 'aprovado') THEN 'approved'
          WHEN UPPER(COALESCE(v.doc_type, '')) = 'FP' THEN 'pending'
          WHEN LOWER(REPLACE(COALESCE(v.payment_method, ''), '-', ' ')) LIKE '%conta corrente%' THEN 'pending'
          ELSE COALESCE(v.status, 'completed')
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

export function findOrderByDocumentNumber(documentNumber, tenantId) {
  return get(
    `SELECT
       CAST(o.id AS TEXT) AS id,
       o.doc_type,
       o.doc_prefix,
       o.document_number,
       o.status,
       o.payment_method,
       o.total,
       o.approved_document_type,
       o.approved_document_number,
       COALESCE(c.name, 'Consumidor final') AS client_name
     FROM orders o
     LEFT JOIN clientes c
       ON CAST(c.id AS TEXT) = CAST(o.customer_id AS TEXT)
      AND c.tenant_id = o.tenant_id
     WHERE UPPER(TRIM(o.document_number)) = UPPER(TRIM(?))
       AND o.tenant_id = ?
     LIMIT 1`,
    [documentNumber, tenantId]
  );
}

export async function sumDebitNotesForSource(documentNumber, tenantId) {
  const row = await get(
    `SELECT COALESCE(SUM(COALESCE(total, 0)), 0) AS total
     FROM orders
     WHERE tenant_id = ?
       AND UPPER(COALESCE(doc_prefix, '')) = 'ND'
       AND UPPER(TRIM(COALESCE(approved_document_type, ''))) = 'FTF'
       AND UPPER(TRIM(COALESCE(approved_document_number, ''))) = UPPER(TRIM(?))`,
    [tenantId, documentNumber]
  );
  return Number(row?.total ?? 0);
}

/** Soma dos recibos (RC) já emitidos contra uma fatura de cliente (FT). */
export async function sumReceiptsForSource(documentNumber, tenantId) {
  const row = await get(
    `SELECT COALESCE(SUM(COALESCE(total, 0)), 0) AS total
     FROM orders
     WHERE tenant_id = ?
       AND UPPER(COALESCE(doc_prefix, '')) = 'RC'
       AND UPPER(TRIM(COALESCE(approved_document_type, ''))) = 'FT'
       AND UPPER(TRIM(COALESCE(approved_document_number, ''))) = UPPER(TRIM(?))`,
    [tenantId, documentNumber]
  );
  return Number(row?.total ?? 0);
}

/** Quantidades já devolvidas por produto em NDs ligadas à FTF de origem. */
export async function sumDebitNoteQuantitiesByProductForSource(documentNumber, tenantId) {
  const rows = await all(
    `SELECT CAST(oi.product_id AS TEXT) AS product_id,
            COALESCE(SUM(COALESCE(oi.quantity, 0)), 0) AS quantity
     FROM order_items oi
     INNER JOIN orders o
       ON CAST(o.id AS TEXT) = CAST(oi.order_id AS TEXT)
      AND o.tenant_id = oi.tenant_id
     WHERE o.tenant_id = ?
       AND UPPER(COALESCE(o.doc_prefix, '')) = 'ND'
       AND UPPER(TRIM(COALESCE(o.approved_document_type, ''))) = 'FTF'
       AND UPPER(TRIM(COALESCE(o.approved_document_number, ''))) = UPPER(TRIM(?))
       AND oi.product_id IS NOT NULL
     GROUP BY CAST(oi.product_id AS TEXT)`,
    [tenantId, documentNumber]
  );
  const map = {};
  for (const row of rows ?? []) {
    const pid = row?.product_id != null ? String(row.product_id) : '';
    if (!pid) continue;
    map[pid] = Number(row?.quantity ?? 0) || 0;
  }
  return map;
}

export function findOrderByDocumentParts(prefix, year, sequence, tenantId) {
  return get(
    `SELECT
       CAST(o.id AS TEXT) AS id,
       o.doc_type,
       o.doc_prefix,
       o.document_number,
       o.status,
       o.payment_method,
       o.total,
       o.approved_document_type,
       o.approved_document_number,
       COALESCE(c.name, 'Consumidor final') AS client_name
     FROM orders o
     LEFT JOIN clientes c
       ON CAST(c.id AS TEXT) = CAST(o.customer_id AS TEXT)
      AND c.tenant_id = o.tenant_id
     WHERE o.tenant_id = ?
       AND UPPER(COALESCE(o.doc_prefix, '')) = UPPER(?)
       AND CAST(COALESCE(o.doc_year, strftime('%Y', o.created_at)) AS INTEGER) = ?
       AND CAST(COALESCE(o.doc_sequence, 0) AS INTEGER) = ?
     LIMIT 1`,
    [tenantId, prefix, year, sequence]
  );
}

export function findVendaByDocumentNumber(documentNumber, tenantId) {
  const match = String(documentNumber ?? '')
    .trim()
    .toUpperCase()
    .match(/^([A-Z]+)\/(\d{4})\/(\d+)$/);
  if (!match) return null;
  const prefix = match[1];
  const year = match[2];
  const sequence = Number(match[3]);
  if (!Number.isFinite(sequence)) return null;

  return get(
    `SELECT
       v.id,
       v.doc_type,
       v.doc_sequence,
       v.status,
       v.payment_method,
       v.total,
       v.approved_document_type,
       v.approved_document_number,
       COALESCE(c.name, v.customer_name, 'Consumidor final') AS client_name,
       (
         UPPER(COALESCE(v.doc_type, 'VD')) || '/' ||
         CAST(strftime('%Y', v.data) AS TEXT) || '/' ||
         printf('%04d', COALESCE(v.doc_sequence, v.id))
       ) AS document_number
     FROM vendas v
     LEFT JOIN clientes c
       ON CAST(c.cloud_id AS TEXT) = CAST(v.customer_id AS TEXT)
      AND c.tenant_id = v.tenant_id
     WHERE v.tenant_id = ?
       AND UPPER(COALESCE(v.doc_type, 'VD')) = ?
       AND COALESCE(v.doc_sequence, v.id) = ?
       AND strftime('%Y', v.data) = ?
     LIMIT 1`,
    [tenantId, prefix, sequence, year]
  );
}

export function updateOrderDocumentPayment(
  orderId,
  { paymentMethod, status, approvedDocType, approvedDocumentNumber, updatedAt },
  tenantId
) {
  return run(
    `UPDATE orders
     SET payment_method = ?,
         status = ?,
         approved_document_type = ?,
         approved_document_number = ?,
         updated_at = ?
     WHERE CAST(id AS TEXT) = ?
       AND tenant_id = ?`,
    [paymentMethod, status, approvedDocType, approvedDocumentNumber, updatedAt, orderId, tenantId]
  );
}

export function updateVendaDocumentPayment(
  saleId,
  { paymentMethod, status, approvedDocType, approvedDocumentNumber },
  tenantId
) {
  return run(
    `UPDATE vendas
     SET payment_method = ?,
         status = ?,
         approved_document_type = ?,
         approved_document_number = ?
     WHERE id = ?
       AND tenant_id = ?`,
    [paymentMethod, status, approvedDocType, approvedDocumentNumber, saleId, tenantId]
  );
}

export function getOrderPaymentContext(orderId, tenantId) {
  return get(
    `SELECT
       CAST(o.id AS TEXT) AS id,
       o.customer_id,
       o.user_id,
       o.user_name,
       o.total,
       o.subtotal,
       o.tax,
       o.discount,
       o.document_number,
       COALESCE(c.name, 'Consumidor final') AS client_name
     FROM orders o
     LEFT JOIN clientes c
       ON CAST(c.id AS TEXT) = CAST(o.customer_id AS TEXT)
      AND c.tenant_id = o.tenant_id
     WHERE CAST(o.id AS TEXT) = ?
       AND o.tenant_id = ?
     LIMIT 1`,
    [String(orderId), tenantId]
  );
}

export function getVendaPaymentContext(saleId, tenantId) {
  return get(
    `SELECT
       v.id,
       v.customer_id,
       v.customer_name,
       v.user_id,
       v.user_name,
       v.total,
       v.doc_type,
       (
         UPPER(COALESCE(v.doc_type, 'VD')) || '/' ||
         CAST(strftime('%Y', v.data) AS TEXT) || '/' ||
         printf('%04d', COALESCE(v.doc_sequence, v.id))
       ) AS document_number,
       COALESCE(c.name, v.customer_name, 'Consumidor final') AS client_name
     FROM vendas v
     LEFT JOIN clientes c
       ON CAST(c.cloud_id AS TEXT) = CAST(v.customer_id AS TEXT)
      AND c.tenant_id = v.tenant_id
     WHERE v.id = ?
       AND v.tenant_id = ?
     LIMIT 1`,
    [Number(saleId), tenantId]
  );
}

export function listOrderItemsByDocumentId(documentId, tenantId) {
  return all(
    `SELECT product_id, product_name, quantity, price, discount_amount
     FROM order_items
     WHERE tenant_id = ?
       AND CAST(order_id AS TEXT) = CAST(? AS TEXT)
     ORDER BY datetime(created_at) ASC, id ASC`,
    [tenantId, String(documentId)]
  );
}

export function insertVendaRecord(params) {
  return run(
    `INSERT INTO vendas (
       total, data, doc_type, doc_sequence, status, customer_id, customer_name, payment_method,
       user_id, user_name, approved_document_type, approved_document_number, tenant_id
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    params
  );
}

export function updateOrderSourceReference(orderId, sourceDocType, sourceDocumentNumber, updatedAt, tenantId) {
  return run(
    `UPDATE orders
     SET approved_document_type = ?,
         approved_document_number = ?,
         updated_at = ?
     WHERE CAST(id AS TEXT) = ?
       AND tenant_id = ?`,
    [sourceDocType, sourceDocumentNumber, updatedAt, String(orderId), tenantId]
  );
}
