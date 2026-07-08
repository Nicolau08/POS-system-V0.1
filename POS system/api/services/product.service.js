import db from '../database.js';
import { uuidv4, isUuidString } from '../cloudIdUtils.js';
import { enqueueSync } from '../syncQueue.js';
import { logAudit } from '../utils/logger.js';
import { assertTenantWrite, requireTenantId } from '../utils/tenant.js';
import {
  parseBooleanFilter,
  parsePagination,
  parseSearchTerm,
  withPaginationPayload,
} from './queryOptions.service.js';

const allDb = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows ?? []);
    });
  });

const runDb = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) return reject(err);
      resolve(this);
    });
  });

const getDb = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row ?? null);
    });
  });

async function resolveTenantId(tenantCandidate) {
  return requireTenantId(tenantCandidate, {
    status: 401,
    message: 'tenant_id ausente para operacao de produtos',
  });
}

const mapProductRow = (row) => ({
    ...row,
    id: String(row.id),
    category_id: row.category_id != null ? String(row.category_id) : null,
    tenant_id: row.tenant_id ? String(row.tenant_id) : null,
    active: Boolean(row.active),
    is_service: Boolean(row.is_service),
    default_quantity: Boolean(row.default_quantity),
    categories: row.category ? { name: row.category } : undefined,
  });

export async function listProducts(filters = {}, actorUser = null) {
  const pagination = parsePagination(filters);
  const search = parseSearchTerm(filters.search);
  const active = parseBooleanFilter(filters.active);
  const includeDeleted = parseBooleanFilter(filters.include_deleted) === true;
  const deleted = parseBooleanFilter(filters.deleted);
  const tenantId = await resolveTenantId(actorUser?.tenant_id);

  const where = [];
  const params = [];
  where.push(`p.tenant_id = ?`);
  params.push(tenantId);
  if (search) {
    where.push(`(LOWER(COALESCE(p.name, '')) LIKE LOWER(?) OR LOWER(COALESCE(p.barcode, '')) LIKE LOWER(?) OR LOWER(COALESCE(c.name, '')) LIKE LOWER(?))`);
    const token = `%${search}%`;
    params.push(token, token, token);
  }
  if (active != null) {
    where.push(`p.active = ?`);
    params.push(active ? 1 : 0);
  }

  if (deleted != null) {
    where.push(`COALESCE(p.deleted, 0) = ?`);
    params.push(deleted ? 1 : 0);
  } else if (!includeDeleted) {
    where.push(`COALESCE(p.deleted, 0) = 0`);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const baseSelect = `
    SELECT
      p.id, p.cloud_id, p.code, p.name, p.category_id, p.barcode, p.cost, p.price, p.tax, p.final_price,
      p.active, p.unit, p.description, p.age_restriction, p.is_service, p.default_quantity,
      p.stock_quantity, p.min_stock, p.color, p.image, p.deleted, p.tenant_id, p.created_at, p.updated_at,
      c.name AS category
    FROM products p
    LEFT JOIN categories c ON c.id = p.category_id
    ${whereSql}
    ORDER BY p.name ASC`;

  if (!pagination.hasPagination) {
    const rows = await allDb(baseSelect, params);
    return rows.map(mapProductRow);
  }

  const rows = await allDb(`${baseSelect} LIMIT ? OFFSET ?`, [...params, pagination.limit, pagination.offset]);
  const totalRow = await getDb(
    `SELECT COUNT(*) AS total
     FROM products p
     LEFT JOIN categories c ON c.id = p.category_id
     ${whereSql}`,
    params
  );

  return withPaginationPayload(rows.map(mapProductRow), {
    page: pagination.page,
    limit: pagination.limit,
    total: Number(totalRow?.total ?? 0),
  });
}

export async function createProduct(payload = {}, actorUser = null) {
  const now = new Date().toISOString();
  const tenantId = await resolveTenantId(actorUser?.tenant_id);
  assertTenantWrite(tenantId, payload?.tenant_id ?? payload?.tenantId);
  const finalPrice = payload.final_price ?? payload.price;
  if (!payload.name || !Number.isFinite(Number(payload.price))) {
    return { error: 'name e price sao obrigatorios', status: 400 };
  }

  const cloudId =
    payload.cloud_id && isUuidString(String(payload.cloud_id)) ? String(payload.cloud_id).trim() : uuidv4();

  const result = await runDb(
    `INSERT INTO products
      (cloud_id, code, name, category_id, barcode, cost, price, tax, final_price, active, unit, description, age_restriction, is_service, default_quantity, stock_quantity, min_stock, color, image, deleted, tenant_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      cloudId,
      payload.code ?? null,
      payload.name,
      payload.category_id ? Number(payload.category_id) : null,
      payload.barcode ?? null,
      Number(payload.cost ?? 0),
      Number(payload.price),
      Number(payload.tax ?? 0),
      Number(finalPrice ?? payload.price),
      payload.active === false ? 0 : 1,
      payload.unit ?? 'un',
      payload.description ?? null,
      payload.age_restriction ? Number(payload.age_restriction) : null,
      payload.is_service ? 1 : 0,
      payload.default_quantity === false ? 0 : 1,
      Number(payload.stock_quantity ?? 0),
      Number(payload.min_stock ?? 0),
      payload.color ?? null,
      payload.image ?? null,
      0,
      tenantId,
      now,
      now,
    ]
  );

  const insertedId = result.lastID;
  await logAudit('PRODUCT_CREATE', actorUser, {
    entity: 'product',
    entity_id: String(insertedId),
    description: 'Product created',
    product_name: payload.name ?? null,
  });

  try {
    await enqueueSync('product', { ...payload, id: insertedId, cloud_id: cloudId, deleted: 0, tenant_id: tenantId, updated_at: now });
    return { success: true, id: insertedId, cloud_id: cloudId };
  } catch (queueErr) {
    return {
      success: true,
      id: insertedId,
      cloud_id: cloudId,
      syncQueued: false,
      syncError: queueErr.message,
    };
  }
}

export async function updateProduct(localIdRaw, payload = {}, actorUser = null) {
  const tenantId = await resolveTenantId(actorUser?.tenant_id);
  assertTenantWrite(tenantId, payload?.tenant_id ?? payload?.tenantId);
  if (!payload.name || !Number.isFinite(Number(payload.price))) {
    return { error: 'name e price sao obrigatorios', status: 400 };
  }

  const localId = Number(localIdRaw);
  const existing = await getDb(
    `SELECT cloud_id
     FROM products
     WHERE id = ?
       AND tenant_id = ?
       AND COALESCE(deleted, 0) = 0`,
    [localId, tenantId]
  );
  let nextCloudId = existing?.cloud_id && isUuidString(String(existing.cloud_id)) ? String(existing.cloud_id).trim() : null;
  if (!nextCloudId) nextCloudId = uuidv4();
  const now = new Date().toISOString();

  const result = await runDb(
    `UPDATE products SET
      cloud_id = ?, code = ?, name = ?, category_id = ?, barcode = ?, cost = ?, price = ?, tax = ?,
      final_price = ?, active = ?, unit = ?, description = ?, age_restriction = ?, is_service = ?,
      default_quantity = ?, stock_quantity = ?, min_stock = ?, color = ?, image = ?, deleted = 0, updated_at = ?
     WHERE id = ? AND tenant_id = ? AND COALESCE(deleted, 0) = 0`,
    [
      nextCloudId,
      payload.code ?? null,
      payload.name,
      payload.category_id ? Number(payload.category_id) : null,
      payload.barcode ?? null,
      Number(payload.cost ?? 0),
      Number(payload.price),
      Number(payload.tax ?? 0),
      Number(payload.final_price ?? payload.price),
      payload.active === false ? 0 : 1,
      payload.unit ?? 'un',
      payload.description ?? null,
      payload.age_restriction ? Number(payload.age_restriction) : null,
      payload.is_service ? 1 : 0,
      payload.default_quantity === false ? 0 : 1,
      Number(payload.stock_quantity ?? 0),
      Number(payload.min_stock ?? 0),
      payload.color ?? null,
      payload.image ?? null,
      now,
      localId,
      tenantId,
    ]
  );

  if (result.changes <= 0) return { success: true, updated: false };

  await logAudit('PRODUCT_UPDATE', actorUser, {
    entity: 'product',
    entity_id: String(localId),
    description: 'Product updated',
    product_name: payload.name ?? null,
  });

  try {
    await enqueueSync('product', {
      ...payload,
      id: localId,
      cloud_id: nextCloudId,
      deleted: 0,
      tenant_id: tenantId,
      updated_at: now,
    });
    return { success: true, updated: true, cloud_id: nextCloudId };
  } catch (queueErr) {
    return {
      success: true,
      updated: true,
      cloud_id: nextCloudId,
      syncQueued: false,
      syncError: queueErr.message,
    };
  }
}

export async function deleteProduct(localIdRaw, actorUser = null) {
  const tenantId = await resolveTenantId(actorUser?.tenant_id);
  const localId = Number(localIdRaw);
  const now = new Date().toISOString();
  const row = await getDb(
    `SELECT
       cloud_id, code, name, category_id, barcode, cost, price, tax, final_price, active,
       unit, description, age_restriction, is_service, default_quantity, stock_quantity,
       min_stock, color, image, tenant_id
     FROM products
     WHERE id = ?
       AND tenant_id = ?
       AND COALESCE(deleted, 0) = 0`,
    [localId, tenantId]
  );
  const cloudId = row?.cloud_id && isUuidString(String(row.cloud_id)) ? String(row.cloud_id).trim() : null;
  const result = await runDb(
    `UPDATE products
     SET deleted = 1,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?
       AND tenant_id = ?
       AND COALESCE(deleted, 0) = 0`,
    [localId, tenantId]
  );
  if (result.changes <= 0) return { success: true, deleted: false };

  await logAudit('PRODUCT_DELETE', actorUser, {
    entity: 'product',
    entity_id: String(localId),
    description: 'Product deleted',
  });

  try {
    await enqueueSync('product', {
      id: localId,
      cloud_id: cloudId,
      code: row?.code ?? null,
      name: row?.name ?? '',
      category_id: row?.category_id ?? null,
      barcode: row?.barcode ?? null,
      cost: Number(row?.cost ?? 0),
      price: Number(row?.price ?? 0),
      tax: Number(row?.tax ?? 0),
      final_price: Number(row?.final_price ?? row?.price ?? 0),
      active: Number(row?.active ?? 1) !== 0,
      unit: row?.unit ?? 'un',
      description: row?.description ?? null,
      age_restriction: row?.age_restriction == null ? null : Number(row.age_restriction),
      is_service: Number(row?.is_service ?? 0) !== 0,
      default_quantity: Number(row?.default_quantity ?? 1) !== 0,
      stock_quantity: Number(row?.stock_quantity ?? 0),
      min_stock: Number(row?.min_stock ?? 0),
      color: row?.color ?? null,
      image: row?.image ?? null,
      tenant_id: row?.tenant_id ? String(row.tenant_id) : tenantId,
      deleted: 1,
      updated_at: now,
    });
    return { success: true, deleted: true };
  } catch (queueErr) {
    return {
      success: true,
      deleted: true,
      syncQueued: false,
      syncError: queueErr.message,
    };
  }
}

/**
 * Inventário rápido / ajuste de stock.
 * - mode 'set' (default no Rápido): define a quantidade contada (delta = counted - actual).
 * - mode 'delta': soma `quantity` ao stock actual.
 * Sempre grava linha em stock_movements para aparecer no Histórico.
 */
export async function adjustStock(payload = {}, actorUser = null) {
  const tenantId = await resolveTenantId(actorUser?.tenant_id);
  const productId = Number(payload.productId ?? payload.product_id);
  const mode = String(payload.mode ?? (payload.counted_quantity != null ? 'set' : 'delta')).toLowerCase();
  const now = new Date().toISOString();

  if (!Number.isFinite(productId) || productId <= 0) {
    return { error: 'productId é obrigatório', status: 400 };
  }

  const product = await getDb(
    `SELECT
       id, cloud_id, code, name, category_id, barcode, cost, price, tax, final_price,
       active, unit, description, age_restriction, is_service, default_quantity,
       stock_quantity, min_stock, color, image, deleted, tenant_id
     FROM products
     WHERE id = ? AND tenant_id = ? AND COALESCE(deleted, 0) = 0
     LIMIT 1`,
    [productId, tenantId],
  );
  if (!product) {
    return { error: 'Produto não encontrado', status: 404 };
  }

  const stockBefore = Number(product.stock_quantity ?? 0) || 0;
  let stockAfter = stockBefore;
  let quantityDelta = 0;

  if (mode === 'set') {
    const counted = Number(payload.counted_quantity ?? payload.quantity);
    if (!Number.isFinite(counted)) {
      return { error: 'Quantidade de inventário inválida.', status: 400 };
    }
    stockAfter = counted;
    quantityDelta = counted - stockBefore;
  } else {
    quantityDelta = Number(payload.quantity);
    if (!Number.isFinite(quantityDelta) || quantityDelta === 0) {
      return { error: 'quantity é obrigatório e diferente de zero', status: 400 };
    }
    stockAfter = stockBefore + quantityDelta;
    if (stockAfter < 0) {
      return { error: 'Estoque insuficiente para ajuste', status: 409 };
    }
  }

  if (quantityDelta === 0 && mode === 'set') {
    return {
      success: true,
      updated: false,
      unchanged: true,
      productId: String(productId),
      stock_before: stockBefore,
      stock_after: stockAfter,
      quantity_delta: 0,
    };
  }

  const result = await runDb(
    `UPDATE products
     SET stock_quantity = ?, updated_at = ?
     WHERE id = ?
       AND tenant_id = ?
       AND COALESCE(deleted, 0) = 0`,
    [stockAfter, now, productId, tenantId],
  );

  if (result.changes <= 0) {
    return { error: 'Falha ao actualizar stock', status: 409 };
  }

  const referenceId = `INV-COUNT:${uuidv4()}`;
  const movementType = quantityDelta >= 0 ? 'restock' : 'adjustment';
  await runDb(
    `INSERT INTO stock_movements
      (cloud_id, tenant_id, product_id, movement_type, quantity, reference_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [uuidv4(), tenantId, productId, movementType, quantityDelta, referenceId, now, now],
  );

  await logAudit('STOCK_COUNT', actorUser, {
    entity: 'product',
    entity_id: String(productId),
    description: mode === 'set' ? 'Inventário rápido (contagem)' : 'Ajuste manual de stock',
    quantity_delta: quantityDelta,
    stock_before: stockBefore,
    stock_after: stockAfter,
    reference_id: referenceId,
  });

  let syncQueued = false;
  let syncError = null;
  try {
    const cloudId =
      product.cloud_id && isUuidString(String(product.cloud_id))
        ? String(product.cloud_id).trim()
        : null;
    await enqueueSync('product', {
      id: productId,
      cloud_id: cloudId,
      code: product.code ?? null,
      name: product.name ?? '',
      category_id: product.category_id != null ? Number(product.category_id) : null,
      barcode: product.barcode ?? null,
      cost: Number(product.cost ?? 0),
      price: Number(product.price ?? 0),
      tax: Number(product.tax ?? 0),
      final_price: Number(product.final_price ?? product.price ?? 0),
      active: Number(product.active ?? 1) !== 0,
      unit: product.unit ?? 'un',
      description: product.description ?? null,
      age_restriction: product.age_restriction != null ? Number(product.age_restriction) : null,
      is_service: Number(product.is_service ?? 0) !== 0,
      default_quantity: Number(product.default_quantity ?? 1) !== 0,
      stock_quantity: stockAfter,
      min_stock: Number(product.min_stock ?? 0),
      color: product.color ?? null,
      image: product.image ?? null,
      deleted: 0,
      tenant_id: tenantId,
      updated_at: now,
    });
    syncQueued = true;
  } catch (queueErr) {
    syncError = queueErr?.message ?? String(queueErr);
    console.warn('[stock] falha ao enfileirar sync de inventário rápido', {
      productId,
      error: syncError,
    });
  }

  return {
    success: true,
    updated: true,
    productId: String(productId),
    product_name: String(product.name ?? ''),
    stock_before: stockBefore,
    stock_after: stockAfter,
    quantity_delta: quantityDelta,
    reference_id: referenceId,
    unit: product.unit != null ? String(product.unit) : 'un',
    syncQueued,
    syncError,
  };
}

export async function getProductHistory(productId, fromDateRaw, toDateRaw, actorUser = null) {
  const productIdValue = String(productId ?? '').trim();
  if (!productIdValue) return { error: 'id invalido', status: 400 };
  const tenantId = await resolveTenantId(actorUser?.tenant_id);

  const fromDate = fromDateRaw ? `${String(fromDateRaw).trim()}T00:00:00.000Z` : null;
  const toDate = toDateRaw ? `${String(toDateRaw).trim()}T23:59:59.999Z` : null;

  // Vendas locais gravam order_items.order_id = vendas.id; sync cloud usa orders.id.
  // Precisamos de ambos os joins para mostrar FT/VD/TK com número de documento.
  const saleRows = await allDb(
    `SELECT
      oi.id AS movement_id,
      oi.product_id,
      oi.product_name,
      oi.quantity,
      oi.price,
      oi.discount_amount,
      oi.created_at AS item_created_at,
      COALESCE(o.id, CAST(v.id AS TEXT)) AS document_id,
      COALESCE(
        NULLIF(TRIM(COALESCE(o.document_number, '')), ''),
        CASE
          WHEN v.id IS NULL THEN NULL
          ELSE (
            CASE
              WHEN UPPER(COALESCE(v.doc_type, '')) = 'FP' THEN 'FP'
              WHEN UPPER(COALESCE(v.doc_type, '')) = 'TK' THEN 'TK'
              WHEN UPPER(COALESCE(v.doc_type, '')) = 'FT' THEN 'FT'
              WHEN UPPER(COALESCE(v.doc_type, '')) = 'VD' THEN 'VD'
              WHEN LOWER(REPLACE(COALESCE(v.payment_method, ''), '-', ' ')) LIKE '%conta corrente%' THEN 'FT'
              ELSE 'VD'
            END
            || '/' ||
            CAST(strftime('%Y', COALESCE(v.data, oi.created_at)) AS TEXT)
            || '/' ||
            printf('%04d', COALESCE(v.doc_sequence, v.id))
          )
        END
      ) AS document_number,
      CASE
        WHEN o.doc_type IS NOT NULL AND TRIM(COALESCE(o.doc_type, '')) <> '' THEN o.doc_type
        WHEN UPPER(COALESCE(v.doc_type, '')) IN ('FP', 'TK', 'FT', 'VD') THEN UPPER(v.doc_type)
        WHEN LOWER(REPLACE(COALESCE(v.payment_method, ''), '-', ' ')) LIKE '%conta corrente%' THEN 'FT'
        WHEN o.id IS NOT NULL OR v.id IS NOT NULL THEN 'VD'
        ELSE NULL
      END AS doc_type,
      COALESCE(o.doc_prefix, UPPER(COALESCE(v.doc_type, ''))) AS doc_prefix,
      COALESCE(o.created_at, v.data, oi.created_at) AS document_date,
      COALESCE(v.customer_id, o.customer_id) AS customer_id,
      COALESCE(
        NULLIF(TRIM(COALESCE(v.customer_name, '')), ''),
        NULLIF(TRIM(COALESCE(c.name, '')), ''),
        NULLIF(TRIM(COALESCE(o_customer.name, '')), ''),
        'Consumidor final'
      ) AS customer_name,
      COALESCE(v.payment_method, o.payment_method) AS payment_method,
      'sale_doc' AS source
    FROM order_items oi
    INNER JOIN products p ON CAST(p.id AS TEXT) = CAST(oi.product_id AS TEXT)
    LEFT JOIN orders o
      ON CAST(o.id AS TEXT) = CAST(oi.order_id AS TEXT)
     AND o.tenant_id = p.tenant_id
    LEFT JOIN vendas v
      ON CAST(v.id AS TEXT) = CAST(oi.order_id AS TEXT)
     AND v.tenant_id = p.tenant_id
    LEFT JOIN clientes c
      ON (
        CAST(c.id AS TEXT) = CAST(COALESCE(v.customer_id, o.customer_id) AS TEXT)
        OR CAST(c.cloud_id AS TEXT) = CAST(COALESCE(v.customer_id, o.customer_id) AS TEXT)
      )
     AND c.tenant_id = p.tenant_id
    LEFT JOIN clientes o_customer
      ON CAST(o_customer.cloud_id AS TEXT) = CAST(o.customer_id AS TEXT)
     AND o_customer.tenant_id = p.tenant_id
    WHERE CAST(oi.product_id AS TEXT) = CAST(? AS TEXT)
      AND p.tenant_id = ?
      AND (? IS NULL OR datetime(COALESCE(o.created_at, v.data, oi.created_at)) >= datetime(?))
      AND (? IS NULL OR datetime(COALESCE(o.created_at, v.data, oi.created_at)) <= datetime(?))
    ORDER BY datetime(COALESCE(o.created_at, v.data, oi.created_at)) DESC, oi.id DESC`,
    [productIdValue, tenantId, fromDate, fromDate, toDate, toDate]
  );

  const inventoryRows = await allDb(
    `SELECT
      sm.id AS movement_id,
      sm.product_id,
      p.name AS product_name,
      sm.quantity,
      COALESCE(p.cost, 0) AS price,
      0 AS discount_amount,
      sm.created_at AS item_created_at,
      sm.reference_id AS document_id,
      sm.reference_id AS document_number,
      CASE
        WHEN sm.reference_id LIKE 'INV-COUNT:%' THEN 'Inventário rápido'
        WHEN sm.reference_id LIKE 'WH/IN:%' OR sm.movement_type = 'restock' THEN 'Entrada de stock'
        ELSE 'Ajuste de stock'
      END AS doc_type,
      CASE
        WHEN sm.reference_id LIKE 'INV-COUNT:%' THEN 'INV'
        WHEN sm.reference_id LIKE 'WH/IN:%' OR sm.movement_type = 'restock' THEN 'WH/IN'
        ELSE 'WH/ADJ'
      END AS doc_prefix,
      sm.created_at AS document_date,
      NULL AS customer_id,
      'Inventário' AS customer_name,
      'stock_move' AS source
    FROM stock_movements sm
    INNER JOIN products p ON p.id = sm.product_id AND p.tenant_id = sm.tenant_id
    WHERE CAST(sm.product_id AS TEXT) = CAST(? AS TEXT)
      AND sm.tenant_id = ?
      AND (? IS NULL OR datetime(sm.created_at) >= datetime(?))
      AND (? IS NULL OR datetime(sm.created_at) <= datetime(?))
    ORDER BY datetime(sm.created_at) DESC, sm.id DESC`,
    [productIdValue, tenantId, fromDate, fromDate, toDate, toDate],
  );

  const mapSaleRow = (row) => {
    const docType = String(row?.doc_type ?? '').trim();
    const docPrefix = String(row?.doc_prefix ?? '').trim().toUpperCase();
    const docTypeNormalized = docType.toLowerCase();
    const paymentNormalized = String(row?.payment_method ?? '')
      .toLowerCase()
      .replace(/-/g, ' ');
    const isDebt =
      docPrefix === 'FT' ||
      docTypeNormalized === 'ft' ||
      docTypeNormalized === 'fatura' ||
      (paymentNormalized.includes('conta') && paymentNormalized.includes('corrente'));

    let movementType = 'venda';
    if (
      docPrefix === 'WH/IN' ||
      docTypeNormalized === 'entrada de stock' ||
      docTypeNormalized === 'entrada de armazem' ||
      docTypeNormalized === 'entrada de armazém'
    ) {
      movementType = 'entrada';
    } else if (docPrefix === 'WH/LOSS' || docTypeNormalized === 'perdas' || docTypeNormalized.includes('quebra')) {
      movementType = 'quebra';
    } else if (docTypeNormalized.includes('devol')) {
      movementType = 'devolucao';
    } else if (
      docPrefix === 'WH/ADJ' ||
      docTypeNormalized.includes('regularização') ||
      docTypeNormalized.includes('regularizacao') ||
      docTypeNormalized.includes('ajuste')
    ) {
      movementType = 'ajuste';
    } else if (isDebt) {
      movementType = 'fatura';
    }

    const rawQty = Number(row?.quantity ?? 0);
    const quantity = Number.isFinite(rawQty) ? rawQty : 0;
    const signedQuantity =
      movementType === 'entrada' || movementType === 'devolucao'
        ? Math.abs(quantity)
        : movementType === 'ajuste'
          ? quantity
          : -Math.abs(quantity);

    const movementDate =
      movementType === 'entrada'
        ? String(row?.item_created_at ?? row?.document_date ?? '')
        : String(row?.document_date ?? row?.item_created_at ?? '');

    return {
      id: String(row?.movement_id ?? ''),
      product_id: row?.product_id != null ? String(row.product_id) : null,
      product_name: String(row?.product_name ?? ''),
      movement_type: movementType,
      document_type: isDebt ? 'FT' : docType || null,
      document_number: row?.document_number ? String(row.document_number) : null,
      document_id: row?.document_id ? String(row.document_id) : null,
      customer_name: String(row?.customer_name ?? 'Consumidor final'),
      quantity: signedQuantity,
      quantity_abs: Math.abs(quantity),
      unit_price: Number(row?.price ?? 0) || 0,
      discount_amount: Number(row?.discount_amount ?? 0) || 0,
      date: movementDate,
    };
  };

  const mapInventoryRow = (row) => {
    const qty = Number(row?.quantity ?? 0) || 0;
    const rawRef = String(row?.document_number ?? row?.document_id ?? '');
    const isCount = rawRef.startsWith('INV-COUNT:');
    const isWarehouseIn = rawRef.startsWith('WH/IN:');
    const movementId = row?.movement_id != null ? String(row.movement_id) : '';
    return {
      id: `sm-${movementId}`,
      product_id: row?.product_id != null ? String(row.product_id) : null,
      product_name: String(row?.product_name ?? ''),
      movement_type: isCount ? 'inventario' : qty >= 0 ? 'entrada' : 'ajuste',
      document_type: String(row?.doc_type ?? (isCount ? 'Inventário rápido' : 'Entrada de stock')),
      document_number: isCount
        ? `INV/${movementId || '0'}`
        : isWarehouseIn
          ? rawRef.replace(/^WH\/IN:/, '')
          : rawRef || null,
      document_id: rawRef || null,
      customer_name: isWarehouseIn ? 'Armazém' : 'Inventário',
      quantity: qty,
      quantity_abs: Math.abs(qty),
      unit_price: Number(row?.price ?? 0) || 0,
      discount_amount: 0,
      date: String(row?.document_date ?? row?.item_created_at ?? ''),
    };
  };

  const combined = [
    ...(saleRows ?? []).map(mapSaleRow),
    ...(inventoryRows ?? []).map(mapInventoryRow),
  ].sort((a, b) => {
    const aTime = Date.parse(String(a.date ?? '')) || 0;
    const bTime = Date.parse(String(b.date ?? '')) || 0;
    return bTime - aTime;
  });

  return combined;
}
