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
import { normalizeHex, pickCategoryColor } from '../utils/categoryColors.js';
import { ensureCategoriesColorColumn } from '../repositories/categorias.repository.js';
import { ensureDefaultTaxRates, resolveProductTaxRate } from './tax-rates.service.js';
import { computeTaxFromBasePrice } from '../utils/taxMath.js';
import {
  applyWarehouseDelta,
  getWarehouseQuantity,
  resolveWarehouseId,
  setWarehouseQuantity,
} from './warehouseStock.service.js';

function resolveTrackLotFlag(payload = {}, productKind, isService) {
  if (isService || (productKind !== 'simple' && productKind !== 'ingredient')) return 0;
  const raw = payload.track_lot ?? payload.trackLot;
  if (raw === true || raw === 1 || raw === '1' || raw === 'true') return 1;
  if (raw === false || raw === 0 || raw === '0' || raw === 'false') return 0;
  return Number(raw) === 1 ? 1 : 0;
}

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

async function resolveColorFromCategory(categoryId, tenantId) {
  if (!categoryId) return null;
  await ensureCategoriesColorColumn();
  const cat = await getDb(
    `SELECT name, color FROM categories WHERE id = ? AND tenant_id = ?`,
    [Number(categoryId), tenantId]
  );
  if (!cat) return null;
  return normalizeHex(cat.color) ?? pickCategoryColor(String(cat.name || 'grupo'));
}

async function resolveProductColor(payloadColor, categoryId, tenantId) {
  const fromPayload = normalizeHex(payloadColor);
  if (fromPayload) return fromPayload;
  return resolveColorFromCategory(categoryId, tenantId);
}

async function resolveTenantId(tenantCandidate) {
  return requireTenantId(tenantCandidate, {
    status: 401,
    message: 'tenant_id ausente para operacao de produtos',
  });
}

const PRODUCT_KINDS = new Set(['simple', 'composed', 'ingredient', 'service']);

function normalizeProductKind(raw) {
  const value = String(raw ?? 'simple').trim().toLowerCase();
  return PRODUCT_KINDS.has(value) ? value : 'simple';
}

function resolveServiceFlag(productKind, payloadIsService) {
  if (productKind === 'composed' || productKind === 'service') return 1;
  if (productKind === 'ingredient') return 0;
  return payloadIsService ? 1 : 0;
}

function resolveProductPrice(payload = {}, productKind) {
  const raw = payload.price;
  if (raw === '' || raw == null) {
    return productKind === 'ingredient' ? 0 : NaN;
  }
  const price = Number(raw);
  if (!Number.isFinite(price)) {
    return productKind === 'ingredient' ? 0 : NaN;
  }
  return Math.max(0, price);
}

const mapProductRow = (row) => {
  const categoryColor = row.category_color != null ? String(row.category_color) : null;
  const productColor = row.color != null && String(row.color).trim() ? String(row.color).trim() : null;
  const { category_color: _omit, ...rest } = row;
  let productKind = normalizeProductKind(row.product_kind);
  // Produtos antigos com is_service=1 e kind simple → tratar como Serviço.
  if (productKind === 'simple' && Boolean(row.is_service)) {
    productKind = 'service';
  }
  return {
    ...rest,
    id: String(row.id),
    category_id: row.category_id != null ? String(row.category_id) : null,
    tenant_id: row.tenant_id ? String(row.tenant_id) : null,
    active: Boolean(row.active),
    is_service: Boolean(row.is_service) || productKind === 'composed' || productKind === 'service',
    product_kind: productKind,
    default_quantity: Boolean(row.default_quantity),
    track_lot: Boolean(row.track_lot) && (productKind === 'simple' || productKind === 'ingredient'),
    tax_rate_id: row.tax_rate_id != null ? String(row.tax_rate_id) : null,
    tax_rate_name: row.tax_rate_name != null ? String(row.tax_rate_name) : null,
    tax_rate_code: row.tax_rate_code != null ? String(row.tax_rate_code) : null,
    tax_rate_percent: Number(row.tax_rate_percent ?? 0),
    tax_rate_is_fixed: Boolean(row.tax_rate_is_fixed),
    tax_rate_price_includes_tax:
      Number(row.tax_rate_percent ?? 0) === 0
        ? false
        : row.tax_rate_price_includes_tax == null
          ? true
          : Boolean(row.tax_rate_price_includes_tax),
    // Cor efectiva: própria do produto, senão a do grupo
    color: productColor || categoryColor || null,
    category_color: categoryColor,
    categories: row.category ? { name: row.category } : undefined,
    warehouse_quantity:
      row.warehouse_quantity != null && Number.isFinite(Number(row.warehouse_quantity))
        ? Number(row.warehouse_quantity)
        : null,
  };
};

export async function listProducts(filters = {}, actorUser = null) {
  const pagination = parsePagination(filters);
  const search = parseSearchTerm(filters.search);
  const active = parseBooleanFilter(filters.active);
  const includeDeleted = parseBooleanFilter(filters.include_deleted) === true;
  const deleted = parseBooleanFilter(filters.deleted);
  const tenantId = await resolveTenantId(actorUser?.tenant_id);
  await ensureDefaultTaxRates(tenantId);

  const warehouseIdFilter =
    filters.warehouseId != null || filters.warehouse_id != null
      ? String(filters.warehouseId ?? filters.warehouse_id).trim() || null
      : null;

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
  const selectParams = warehouseIdFilter ? [warehouseIdFilter, ...params] : params;
  const baseSelect = `
    SELECT
      p.id, p.cloud_id, p.code, p.name, p.category_id, p.barcode, p.cost, p.price,
      p.tax_rate_id, p.tax, p.final_price,
      p.active, p.unit, p.description, p.age_restriction, p.is_service, p.product_kind, p.default_quantity,
      p.track_lot, p.stock_quantity, p.min_stock, p.color, p.image, p.deleted, p.tenant_id, p.created_at, p.updated_at,
      ${warehouseIdFilter ? 'COALESCE(ws.quantity, 0) AS warehouse_quantity,' : 'NULL AS warehouse_quantity,'}
      c.name AS category,
      c.color AS category_color,
      tr.name AS tax_rate_name,
      tr.code AS tax_rate_code,
      tr.rate AS tax_rate_percent,
      tr.is_fixed AS tax_rate_is_fixed,
      tr.price_includes_tax AS tax_rate_price_includes_tax
    FROM products p
    ${
      warehouseIdFilter
        ? `LEFT JOIN warehouse_stock ws
             ON ws.product_id = p.id AND ws.tenant_id = p.tenant_id AND ws.warehouse_id = ?`
        : ''
    }
    LEFT JOIN categories c ON c.id = p.category_id
    LEFT JOIN tax_rates tr ON tr.id = p.tax_rate_id AND tr.tenant_id = p.tenant_id
    ${whereSql}
    ORDER BY p.name ASC`;

  await ensureCategoriesColorColumn();

  if (!pagination.hasPagination) {
    const rows = await allDb(baseSelect, selectParams);
    return rows.map(mapProductRow);
  }

  const rows = await allDb(`${baseSelect} LIMIT ? OFFSET ?`, [...selectParams, pagination.limit, pagination.offset]);
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
  const productKind = normalizeProductKind(payload.product_kind ?? payload.productKind);
  const price = resolveProductPrice(payload, productKind);
  if (!payload.name || !Number.isFinite(price)) {
    return {
      error:
        productKind === 'ingredient'
          ? 'name e obrigatorio'
          : 'name e price sao obrigatorios',
      status: 400,
    };
  }

  const cloudId =
    payload.cloud_id && isUuidString(String(payload.cloud_id)) ? String(payload.cloud_id).trim() : uuidv4();

  const categoryId = payload.category_id ? Number(payload.category_id) : null;
  const inheritedColor = await resolveProductColor(payload.color, categoryId, tenantId);
  const taxRate = await resolveProductTaxRate(payload.tax_rate_id ?? payload.taxRateId, tenantId);
  const { tax: taxAmount, finalPrice } = computeTaxFromBasePrice({
    basePrice: price,
    rate: Number(taxRate.rate ?? 0),
    isFixed: Boolean(taxRate.is_fixed),
    priceIncludesTax:
      Number(taxRate.rate ?? 0) === 0
        ? false
        : taxRate.price_includes_tax == null
          ? true
          : Boolean(taxRate.price_includes_tax),
  });
  const isService = resolveServiceFlag(productKind, Boolean(payload.is_service));
  const trackLot = resolveTrackLotFlag(payload, productKind, Boolean(isService));

  const result = await runDb(
    `INSERT INTO products
      (cloud_id, code, name, category_id, barcode, cost, price, tax_rate_id, tax, final_price, active, unit, description, age_restriction, is_service, product_kind, default_quantity, track_lot, stock_quantity, min_stock, color, image, deleted, tenant_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      cloudId,
      payload.code ?? null,
      payload.name,
      categoryId,
      payload.barcode ?? null,
      Number(payload.cost ?? 0),
      price,
      Number(taxRate.id),
      taxAmount,
      finalPrice,
      payload.active === false ? 0 : 1,
      payload.unit ?? 'un',
      payload.description ?? null,
      payload.age_restriction ? Number(payload.age_restriction) : null,
      isService,
      productKind,
      payload.default_quantity === false ? 0 : 1,
      trackLot,
      Number(payload.stock_quantity ?? 0),
      Number(payload.min_stock ?? 0),
      inheritedColor,
      payload.image ?? null,
      0,
      tenantId,
      now,
      now,
    ]
  );

  const insertedId = result.lastID;
  if (!isService && productKind !== 'composed') {
    try {
      const initialStock = Number(payload.stock_quantity ?? 0) || 0;
      const warehouseId = await resolveWarehouseId({ tenantId });
      await setWarehouseQuantity({
        tenantId,
        warehouseId,
        productId: insertedId,
        quantity: initialStock,
        cost: Number(payload.cost ?? 0) || 0,
        lotCode: payload.lotCode ?? payload.lot_code ?? null,
        referenceId: `PRODUCT-CREATE:${insertedId}`,
        allowNegative: true,
      });
    } catch (whErr) {
      console.warn('[product] falha ao inicializar stock no armazém', whErr?.message ?? whErr);
    }
  }
  if (Array.isArray(payload.bom_lines ?? payload.bomLines)) {
    const bomResult = await replaceProductBom(insertedId, payload.bom_lines ?? payload.bomLines, actorUser);
    if (bomResult?.error) return bomResult;
  }

  await logAudit('PRODUCT_CREATE', actorUser, {
    entity: 'product',
    entity_id: String(insertedId),
    description: 'Product created',
    product_name: payload.name ?? null,
  });

  try {
    await enqueueSync('product', {
      ...payload,
      id: insertedId,
      cloud_id: cloudId,
      product_kind: productKind,
      track_lot: Boolean(trackLot),
      is_service: Boolean(isService),
      tax_rate_id: Number(taxRate.id),
      tax: taxAmount,
      final_price: finalPrice,
      deleted: 0,
      tenant_id: tenantId,
      updated_at: now,
    });
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
  const productKind = normalizeProductKind(payload.product_kind ?? payload.productKind);
  const price = resolveProductPrice(payload, productKind);
  if (!payload.name || !Number.isFinite(price)) {
    return {
      error:
        productKind === 'ingredient'
          ? 'name e obrigatorio'
          : 'name e price sao obrigatorios',
      status: 400,
    };
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

  const categoryId = payload.category_id ? Number(payload.category_id) : null;
  const inheritedColor = await resolveProductColor(payload.color, categoryId, tenantId);
  const taxRate = await resolveProductTaxRate(payload.tax_rate_id ?? payload.taxRateId, tenantId);
  const { tax: taxAmount, finalPrice } = computeTaxFromBasePrice({
    basePrice: price,
    rate: Number(taxRate.rate ?? 0),
    isFixed: Boolean(taxRate.is_fixed),
    priceIncludesTax:
      Number(taxRate.rate ?? 0) === 0
        ? false
        : taxRate.price_includes_tax == null
          ? true
          : Boolean(taxRate.price_includes_tax),
  });
  const isService = resolveServiceFlag(productKind, Boolean(payload.is_service));
  const trackLot = resolveTrackLotFlag(payload, productKind, Boolean(isService));

  const result = await runDb(
    `UPDATE products SET
      cloud_id = ?, code = ?, name = ?, category_id = ?, barcode = ?, cost = ?, price = ?, tax_rate_id = ?,
      tax = ?, final_price = ?, active = ?, unit = ?, description = ?, age_restriction = ?, is_service = ?,
      product_kind = ?, default_quantity = ?, track_lot = ?, stock_quantity = ?, min_stock = ?, color = ?, image = ?, deleted = 0, updated_at = ?
     WHERE id = ? AND tenant_id = ? AND COALESCE(deleted, 0) = 0`,
    [
      nextCloudId,
      payload.code ?? null,
      payload.name,
      categoryId,
      payload.barcode ?? null,
      Number(payload.cost ?? 0),
      price,
      Number(taxRate.id),
      taxAmount,
      finalPrice,
      payload.active === false ? 0 : 1,
      payload.unit ?? 'un',
      payload.description ?? null,
      payload.age_restriction ? Number(payload.age_restriction) : null,
      isService,
      productKind,
      payload.default_quantity === false ? 0 : 1,
      trackLot,
      Number(payload.stock_quantity ?? 0),
      Number(payload.min_stock ?? 0),
      inheritedColor,
      payload.image ?? null,
      now,
      localId,
      tenantId,
    ]
  );

  if (result.changes <= 0) return { success: true, updated: false };

  if (!isService && productKind !== 'composed') {
    try {
      const { listWarehouseStockByProduct, refreshProductStockCache } = await import(
        '../repositories/warehouses.repository.js'
      );
      const rows = await listWarehouseStockByProduct(localId, tenantId);
      if (!rows.length) {
        const warehouseId = await resolveWarehouseId({ tenantId });
        await setWarehouseQuantity({
          tenantId,
          warehouseId,
          productId: localId,
          quantity: Number(payload.stock_quantity ?? 0) || 0,
          cost: Number(payload.cost ?? 0) || 0,
          referenceId: `PRODUCT-UPDATE:${localId}`,
          allowNegative: true,
        });
      } else {
        await refreshProductStockCache(localId, tenantId, now);
      }
    } catch (whErr) {
      console.warn('[product] falha ao sincronizar stock de armazém', whErr?.message ?? whErr);
    }
  }

  if (Array.isArray(payload.bom_lines ?? payload.bomLines)) {
    const bomResult = await replaceProductBom(localId, payload.bom_lines ?? payload.bomLines, actorUser);
    if (bomResult?.error) return bomResult;
  } else if (productKind !== 'composed') {
    await runDb(
      `DELETE FROM product_bom_lines WHERE tenant_id = ? AND parent_product_id = ?`,
      [tenantId, localId]
    );
  }

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
      product_kind: productKind,
      track_lot: Boolean(trackLot),
      is_service: Boolean(isService),
      tax_rate_id: Number(taxRate.id),
      tax: taxAmount,
      final_price: finalPrice,
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
       cloud_id, code, name, category_id, barcode, cost, price, tax_rate_id, tax, final_price, active,
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
       active, unit, description, age_restriction, is_service, product_kind, default_quantity,
       stock_quantity, min_stock, color, image, deleted, tenant_id
     FROM products
     WHERE id = ? AND tenant_id = ? AND COALESCE(deleted, 0) = 0
     LIMIT 1`,
    [productId, tenantId],
  );
  if (!product) {
    return { error: 'Produto não encontrado', status: 404 };
  }

  const kind = normalizeProductKind(product.product_kind);
  if (Number(product.is_service ?? 0) !== 0 || kind === 'composed') {
    return {
      error: 'Produto sem controlo de stock (serviço/composto). A quantidade não é alterada.',
      status: 400,
      code: 'STOCK_NOT_TRACKED',
    };
  }

  let warehouseId;
  try {
    warehouseId = await resolveWarehouseId({
      tenantId,
      explicitWarehouseId: payload.warehouseId ?? payload.warehouse_id ?? null,
    });
  } catch (err) {
    return { error: err?.message || 'Armazém inválido', status: err?.status || 400 };
  }

  const warehouseQtyBefore = await getWarehouseQuantity(warehouseId, productId, tenantId);
  const stockBefore = Number(product.stock_quantity ?? 0) || 0;
  let quantityDelta = 0;
  let result;

  try {
    if (mode === 'set') {
      const counted = Number(payload.counted_quantity ?? payload.quantity);
      if (!Number.isFinite(counted)) {
        return { error: 'Quantidade de inventário inválida.', status: 400 };
      }
      quantityDelta = counted - warehouseQtyBefore;
      result = await setWarehouseQuantity({
        tenantId,
        warehouseId,
        productId,
        quantity: counted,
        cost: Number(product.cost ?? 0) || 0,
        lotCode: payload.lotCode ?? payload.lot_code ?? null,
        referenceId: `INV-COUNT:${uuidv4()}`,
        allowNegative: true,
      });
      if (result.unchanged) {
        return {
          success: true,
          updated: false,
          unchanged: true,
          productId: String(productId),
          warehouse_id: warehouseId,
          stock_before: stockBefore,
          stock_after: stockBefore,
          warehouse_qty_before: warehouseQtyBefore,
          warehouse_qty_after: warehouseQtyBefore,
          quantity_delta: 0,
        };
      }
    } else {
      quantityDelta = Number(payload.quantity);
      if (!Number.isFinite(quantityDelta) || quantityDelta === 0) {
        return { error: 'quantity é obrigatório e diferente de zero', status: 400 };
      }
      if (warehouseQtyBefore + quantityDelta < 0) {
        return { error: 'Stock insuficiente para ajuste', status: 409 };
      }
      result = await applyWarehouseDelta({
        tenantId,
        warehouseId,
        productId,
        delta: quantityDelta,
        movementType: quantityDelta >= 0 ? 'restock' : 'adjustment',
        referenceId: `INV-COUNT:${uuidv4()}`,
        cost: quantityDelta > 0 ? Number(product.cost ?? 0) || 0 : null,
        lotCode: quantityDelta > 0 ? payload.lotCode ?? payload.lot_code ?? null : null,
        allowNegative: false,
      });
    }
  } catch (err) {
    const status = err?.status || err?.statusCode || 500;
    return { error: err?.message || 'Falha ao actualizar stock', status };
  }

  const stockAfter = Number(result.stockAfter ?? result.totalAfter ?? stockBefore);
  const referenceId = `INV-COUNT:${now}`;

  await logAudit('STOCK_COUNT', actorUser, {
    entity: 'product',
    entity_id: String(productId),
    description: mode === 'set' ? 'Inventário rápido (contagem)' : 'Ajuste manual de stock',
    quantity_delta: quantityDelta,
    stock_before: stockBefore,
    stock_after: stockAfter,
    warehouse_id: warehouseId,
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
    warehouse_id: warehouseId,
    stock_before: stockBefore,
    stock_after: stockAfter,
    warehouse_qty_before: warehouseQtyBefore,
    warehouse_qty_after: Number(result.warehouseQtyAfter ?? warehouseQtyBefore + quantityDelta),
    quantity_delta: quantityDelta,
    sync_queued: syncQueued,
    sync_error: syncError,
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
      sm.warehouse_id,
      w.name AS warehouse_name,
      sm.from_warehouse_id,
      sm.to_warehouse_id,
      CASE
        WHEN sm.movement_type = 'transfer_out' OR sm.movement_type = 'transfer_in' THEN 'Transferência'
        WHEN sm.reference_id LIKE 'INV-COUNT:%' THEN 'Inventário rápido'
        WHEN sm.reference_id LIKE 'WH/IN:%' OR sm.movement_type = 'restock' THEN 'Entrada de stock'
        WHEN sm.movement_type = 'sale' THEN 'Venda'
        ELSE 'Ajuste de stock'
      END AS doc_type,
      CASE
        WHEN sm.movement_type IN ('transfer_out', 'transfer_in') THEN 'WH/TR'
        WHEN sm.reference_id LIKE 'INV-COUNT:%' THEN 'INV'
        WHEN sm.reference_id LIKE 'WH/IN:%' OR sm.movement_type = 'restock' THEN 'WH/IN'
        WHEN sm.movement_type = 'sale' THEN 'SALE'
        ELSE 'WH/ADJ'
      END AS doc_prefix,
      sm.created_at AS document_date,
      NULL AS customer_id,
      'Inventário' AS customer_name,
      'stock_move' AS source
    FROM stock_movements sm
    INNER JOIN products p ON p.id = sm.product_id AND p.tenant_id = sm.tenant_id
    LEFT JOIN warehouses w ON w.id = sm.warehouse_id AND w.tenant_id = sm.tenant_id
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
      docPrefix === 'EN/ST' ||
      docPrefix === 'FTF' ||
      docPrefix === 'PUR' ||
      docTypeNormalized === 'compra'
    ) {
      movementType = 'compra';
    } else if (
      docPrefix === 'WH/IN' ||
      docTypeNormalized === 'entrada de stock' ||
      docTypeNormalized === 'entrada de armazem' ||
      docTypeNormalized === 'entrada de armazém'
    ) {
      movementType = 'entrada';
    } else if (
      docPrefix === 'WH/LOSS' ||
      docPrefix === 'DP' ||
      docPrefix === 'CP' ||
      docTypeNormalized === 'perdas' ||
      docTypeNormalized.includes('quebra') ||
      docTypeNormalized.includes('desperd')
    ) {
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
      movementType === 'entrada' ||
      movementType === 'compra' ||
      movementType === 'devolucao'
        ? Math.abs(quantity)
        : movementType === 'ajuste'
          ? quantity
          : -Math.abs(quantity);

    const movementDate =
      movementType === 'entrada' || movementType === 'compra'
        ? String(row?.item_created_at ?? row?.document_date ?? '')
        : String(row?.document_date ?? row?.item_created_at ?? '');

    return {
      id: String(row?.movement_id ?? ''),
      product_id: row?.product_id != null ? String(row.product_id) : null,
      product_name: String(row?.product_name ?? ''),
      movement_type: movementType,
      document_type: isDebt
        ? 'FT'
        : movementType === 'compra'
          ? 'Compra'
          : docType || null,
      document_number: row?.document_number ? String(row.document_number) : null,
      document_id: row?.document_id ? String(row.document_id) : null,
      customer_name: String(row?.customer_name ?? 'Consumidor final'),
      quantity: signedQuantity,
      quantity_abs: Math.abs(quantity),
      unit_price: Number(row?.price ?? 0) || 0,
      discount_amount: Number(row?.discount_amount ?? 0) || 0,
      date: movementDate,
      warehouse_id: null,
      warehouse_name: null,
    };
  };

  const mapInventoryRow = (row) => {
    const qty = Number(row?.quantity ?? 0) || 0;
    const rawRef = String(row?.document_number ?? row?.document_id ?? '');
    const isCount = rawRef.startsWith('INV-COUNT:');
    const isWarehouseIn = rawRef.startsWith('WH/IN:');
    const isPurchaseIn =
      rawRef.startsWith('EN/ST:') ||
      rawRef.startsWith('FTF:') ||
      rawRef.startsWith('PUR:');
    const isTransfer =
      String(row?.doc_prefix ?? '') === 'WH/TR' ||
      rawRef.includes('WH/TR:') ||
      String(row?.doc_type ?? '').toLowerCase().includes('transfer');
    const movementId = row?.movement_id != null ? String(row.movement_id) : '';
    return {
      id: `sm-${movementId}`,
      product_id: row?.product_id != null ? String(row.product_id) : null,
      product_name: String(row?.product_name ?? ''),
      movement_type: isTransfer
        ? 'transferencia'
        : isCount
          ? 'inventario'
          : isPurchaseIn
            ? 'compra'
            : qty >= 0
              ? 'entrada'
              : 'ajuste',
      document_type: String(
        row?.doc_type ??
          (isCount ? 'Inventário rápido' : isPurchaseIn ? 'Compra' : 'Entrada de stock'),
      ),
      document_number: isCount
        ? `INV/${movementId || '0'}`
        : isWarehouseIn
          ? rawRef.replace(/^WH\/IN:/, '')
          : isPurchaseIn
            ? rawRef.replace(/^(EN\/ST|PUR):/, '')
            : rawRef || null,
      document_id: rawRef || null,
      customer_name: isWarehouseIn ? 'Armazém' : isPurchaseIn ? 'Fornecedor' : 'Inventário',
      warehouse_id: row?.warehouse_id != null ? String(row.warehouse_id) : null,
      warehouse_name: row?.warehouse_name != null ? String(row.warehouse_name) : null,
      quantity: qty,
      quantity_abs: Math.abs(qty),
      unit_price: Number(row?.price ?? 0) || 0,
      discount_amount: 0,
      date: String(row?.document_date ?? row?.item_created_at ?? ''),
    };
  };

  // Entradas via documento (EN/ST, PUR, WH/IN) já aparecem em order_items —
  // ignorar o stock_movement espelho para não duplicar (Venda -N + Entrada +N).
  const inventoryRowsDeduped = (inventoryRows ?? []).filter((row) => {
    const ref = String(row?.document_number ?? row?.document_id ?? '');
    return !/^(EN\/ST|PUR|WH\/IN):/i.test(ref);
  });

  const combined = [
    ...(saleRows ?? []).map(mapSaleRow),
    ...inventoryRowsDeduped.map(mapInventoryRow),
  ].sort((a, b) => {
    const aTime = Date.parse(String(a.date ?? '')) || 0;
    const bTime = Date.parse(String(b.date ?? '')) || 0;
    return bTime - aTime;
  });

  return combined;
}

export async function listProductBom(parentIdRaw, actorUser = null) {
  const tenantId = await resolveTenantId(actorUser?.tenant_id);
  const parentId = Number(parentIdRaw);
  if (!Number.isFinite(parentId)) return { error: 'id invalido', status: 400 };

  const rows = await allDb(
    `SELECT
       b.id,
       b.parent_product_id,
       b.component_product_id,
       b.quantity,
       c.name AS component_name,
       c.unit AS component_unit,
       c.product_kind AS component_kind,
       c.stock_quantity AS component_stock
     FROM product_bom_lines b
     INNER JOIN products c
       ON c.id = b.component_product_id
      AND c.tenant_id = b.tenant_id
      AND COALESCE(c.deleted, 0) = 0
     WHERE b.tenant_id = ?
       AND b.parent_product_id = ?
     ORDER BY c.name ASC`,
    [tenantId, parentId]
  );

  return (rows ?? []).map((row) => ({
    id: String(row.id),
    parent_product_id: String(row.parent_product_id),
    component_product_id: String(row.component_product_id),
    quantity: Number(row.quantity ?? 0),
    component_name: String(row.component_name ?? ''),
    component_unit: String(row.component_unit ?? 'un'),
    component_kind: normalizeProductKind(row.component_kind),
    component_stock: Number(row.component_stock ?? 0),
  }));
}

export async function replaceProductBom(parentIdRaw, linesRaw = [], actorUser = null) {
  const tenantId = await resolveTenantId(actorUser?.tenant_id);
  const parentId = Number(parentIdRaw);
  if (!Number.isFinite(parentId)) return { error: 'id invalido', status: 400 };

  const parent = await getDb(
    `SELECT id, product_kind, name
     FROM products
     WHERE id = ? AND tenant_id = ? AND COALESCE(deleted, 0) = 0`,
    [parentId, tenantId]
  );
  if (!parent) return { error: 'Produto nao encontrado', status: 404 };

  const parentKind = normalizeProductKind(parent.product_kind);
  if (parentKind !== 'composed') {
    await runDb(`DELETE FROM product_bom_lines WHERE tenant_id = ? AND parent_product_id = ?`, [
      tenantId,
      parentId,
    ]);
    return { success: true, count: 0 };
  }

  const rawLines = Array.isArray(linesRaw) ? linesRaw : [];
  const normalized = [];
  const seen = new Set();

  for (const line of rawLines) {
    const componentId = Number(line?.component_product_id ?? line?.componentProductId ?? line?.id);
    const quantity = Number(line?.quantity ?? 0);
    if (!Number.isFinite(componentId) || componentId <= 0) {
      return { error: 'Ingrediente invalido na ficha tecnica', status: 400 };
    }
    if (componentId === parentId) {
      return { error: 'Um produto nao pode ser ingrediente de si proprio', status: 400 };
    }
    if (!Number.isFinite(quantity) || quantity <= 0) {
      return { error: 'Quantidade da ficha tecnica deve ser maior que zero', status: 400 };
    }
    if (seen.has(componentId)) {
      return { error: 'Ingrediente duplicado na ficha tecnica', status: 400 };
    }
    seen.add(componentId);

    const component = await getDb(
      `SELECT id, name, product_kind
       FROM products
       WHERE id = ? AND tenant_id = ? AND COALESCE(deleted, 0) = 0`,
      [componentId, tenantId]
    );
    if (!component) {
      return { error: `Ingrediente ${componentId} nao encontrado`, status: 400 };
    }
    if (normalizeProductKind(component.product_kind) !== 'ingredient') {
      return {
        error: `“${component.name}” deve ser do tipo Ingrediente para entrar na ficha tecnica`,
        status: 400,
      };
    }

    normalized.push({ componentId, quantity });
  }

  const now = new Date().toISOString();
  try {
    await runDb('BEGIN IMMEDIATE TRANSACTION');
    await runDb(`DELETE FROM product_bom_lines WHERE tenant_id = ? AND parent_product_id = ?`, [
      tenantId,
      parentId,
    ]);
    for (const line of normalized) {
      await runDb(
        `INSERT INTO product_bom_lines
          (tenant_id, parent_product_id, component_product_id, quantity, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [tenantId, parentId, line.componentId, line.quantity, now, now]
      );
    }
    await runDb('COMMIT');
  } catch (error) {
    try {
      await runDb('ROLLBACK');
    } catch {}
    throw error;
  }

  return { success: true, count: normalized.length };
}

/** Expande itens de venda em ajustes de stock (compostos → ingredientes). */
export async function buildStockAdjustmentsFromCart(cart, tenantId) {
  const adjustments = new Map();

  const addQty = (productId, quantity, name) => {
    const key = Number(productId);
    if (!Number.isFinite(key) || !Number.isFinite(quantity) || quantity <= 0) return;
    const prev = adjustments.get(key);
    if (prev) {
      prev.quantity += quantity;
    } else {
      adjustments.set(key, { productId: key, quantity, name: name || `Produto ${key}` });
    }
  };

  for (const item of Array.isArray(cart) ? cart : []) {
    const productId = Number(item?.id);
    const quantity = Number(item?.quantity ?? 0);
    if (!Number.isFinite(productId) || !Number.isFinite(quantity) || quantity <= 0) continue;

    const product = await getDb(
      `SELECT id, name, is_service, product_kind
       FROM products
       WHERE id = ? AND tenant_id = ? AND COALESCE(deleted, 0) = 0`,
      [productId, tenantId]
    );
    if (!product) continue;

    const kind = normalizeProductKind(product.product_kind);
    const isService =
      Boolean(product.is_service) || kind === 'composed' || kind === 'service';

    if (kind === 'composed') {
      const bom = await allDb(
        `SELECT b.component_product_id, b.quantity, c.name
         FROM product_bom_lines b
         INNER JOIN products c
           ON c.id = b.component_product_id
          AND c.tenant_id = b.tenant_id
          AND COALESCE(c.deleted, 0) = 0
         WHERE b.tenant_id = ? AND b.parent_product_id = ?`,
        [tenantId, productId]
      );
      if (!bom.length) {
        // Composto sem ficha: nao baixa stock do proprio produto.
        continue;
      }
      for (const line of bom) {
        addQty(
          line.component_product_id,
          quantity * Number(line.quantity ?? 0),
          String(line.name ?? 'Ingrediente')
        );
      }
      continue;
    }

    if (isService || kind === 'ingredient') {
      // Serviços não controlam stock; ingredientes não se vendem no POS.
      continue;
    }

    addQty(productId, quantity, String(product.name ?? item?.name ?? 'Produto'));
  }

  return Array.from(adjustments.values());
}
