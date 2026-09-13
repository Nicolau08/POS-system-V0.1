import crypto from 'crypto';
import db from '../database.js';
import { enqueueSync } from '../syncQueue.js';
import { logAudit, logEvent } from '../utils/logger.js';
import { HttpError } from '../utils/response.js';
import { assertTenantWrite, requireTenantId } from '../utils/tenant.js';
import {
  parseDateFilter,
  parsePagination,
  parseSearchTerm,
  withPaginationPayload,
} from './queryOptions.service.js';
import { buildStockAdjustmentsFromCart } from './product.service.js';
import {
  applyWarehouseDelta,
  getWarehouseQuantity,
  resolveWarehouseId,
} from './warehouseStock.service.js';
import { get } from '../dbUtils.js';

const POS_TAX_RATE = Math.max(0, Number(process.env.POS_TAX_RATE ?? 0.16) || 0.16);
const TAX_DIVISOR = 1 + POS_TAX_RATE;
const SALES_STATUS_SQL = `
  CASE
    WHEN LOWER(COALESCE(v.status, '')) IN ('approved', 'aprovado') THEN 'approved'
    WHEN UPPER(COALESCE(v.doc_type, '')) = 'FP' THEN 'pending'
    WHEN LOWER(REPLACE(COALESCE(v.payment_method, ''), '-', ' ')) LIKE '%conta corrente%' THEN 'pending'
    ELSE COALESCE(v.status, 'completed')
  END
`;

/** Conta Corrente / dívida a prazo → documento FT. Aceita "conta-corrente" e "conta corrente". */
function isAccountReceivablePaymentMethod(rawMethod) {
  const normalized = String(rawMethod ?? '')
    .trim()
    .toLowerCase()
    .replace(/-/g, ' ');
  return normalized.includes('conta') && normalized.includes('corrente');
}

function resolveStoredPaymentMethod(rawMethod) {
  const raw = String(rawMethod ?? '').trim();
  if (!raw) return null;
  const normalized = raw.toLowerCase().replace(/_/g, ' ').replace(/-/g, ' ');
  if (normalized === 'cash' || normalized === 'dinheiro') return 'Dinheiro';
  if (isAccountReceivablePaymentMethod(raw)) return 'conta corrente';
  return raw;
}

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

const allDb = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows ?? []);
    });
  });

async function resolveTenantId(tenantCandidate) {
  return requireTenantId(tenantCandidate, {
    status: 401,
    message: 'tenant_id ausente para operacao de vendas',
  });
}

function sanitizeIdempotencyKey(value) {
  const key = String(value ?? '').trim();
  if (!key) return null;
  if (key.length > 128) return key.slice(0, 128);
  return key;
}

function calculateTaxFromTotal(totalAmount) {
  const subtotalAmount = totalAmount / (1 + POS_TAX_RATE);
  const taxAmount = totalAmount - subtotalAmount;
  return {
    subtotal: Number(subtotalAmount.toFixed(2)),
    tax: Number(taxAmount.toFixed(2)),
  };
}

async function canOverrideZeroStock(actorUser, tenantId) {
  const role = String(actorUser?.role ?? '').trim().toLowerCase();
  if (role === 'admin') return true;
  const accessLevel = Number(actorUser?.access_level ?? actorUser?.accessLevel ?? 0);
  const permissionRow = await getDb(
    `SELECT required_level
     FROM permission_rules
     WHERE key = ?
     LIMIT 1`,
    ['vendas.venda_estoque_zero']
  );
  const requiredLevel = Number(permissionRow?.required_level ?? 999);
  if (Number.isFinite(requiredLevel) && accessLevel >= requiredLevel) return true;
  await logAudit('STOCK_OVERRIDE_DENIED', actorUser, {
    entity: 'sale',
    entity_id: null,
    description: 'Stock override denied due to insufficient permission',
    tenant_id: tenantId,
    required_level: requiredLevel,
    access_level: accessLevel,
  });
  return false;
}

const salesSelectSql = `
  SELECT
    CAST(v.id AS TEXT) AS id,
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
    ${SALES_STATUS_SQL} AS status,
    v.approved_document_type AS approved_document_type,
    v.approved_document_number AS approved_document_number,
    CASE
      WHEN UPPER(COALESCE(v.doc_type, '')) = 'FT'
        OR (
          UPPER(COALESCE(v.doc_type, '')) NOT IN ('FP', 'TK', 'VD')
          AND LOWER(REPLACE(COALESCE(v.payment_method, ''), '-', ' ')) LIKE '%conta corrente%'
        )
      THEN COALESCE((
        SELECT SUM(COALESCE(rc.total, 0))
        FROM orders rc
        WHERE rc.tenant_id = v.tenant_id
          AND UPPER(COALESCE(rc.doc_prefix, '')) = 'RC'
          AND UPPER(TRIM(COALESCE(rc.approved_document_type, ''))) = 'FT'
          AND UPPER(TRIM(COALESCE(rc.approved_document_number, ''))) = (
            'FT/' ||
            CAST(strftime('%Y', v.data) AS TEXT) ||
            '/' ||
            printf('%04d', COALESCE(v.doc_sequence, v.id))
          )
      ), 0)
      ELSE 0
    END AS receipt_total,
    0 AS discount,
    ROUND(v.total / ${TAX_DIVISOR}, 2) AS subtotal,
    ROUND(v.total - (v.total / ${TAX_DIVISOR}), 2) AS tax,
    v.total AS total,
    v.data AS created_at,
    v.customer_id AS customer_id,
    CAST(v.id AS TEXT) AS local_sale_id,
    v.user_name AS user_name,
    COALESCE(c.name, v.customer_name, 'Consumidor final') AS client_name
  FROM vendas v
  LEFT JOIN clientes c
    ON CAST(c.cloud_id AS TEXT) = CAST(v.customer_id AS TEXT)
   AND c.tenant_id = v.tenant_id
`;

function buildSalesWhereClause({
  tenantId,
  search = '',
  dateFrom = '',
  dateTo = '',
  status = '',
  paymentMethod = '',
  customerId = '',
}) {
  const where = [];
  const params = [];
  where.push(`v.tenant_id = ?`);
  params.push(tenantId);

  if (search) {
    where.push(`(LOWER(COALESCE(v.customer_name, '')) LIKE LOWER(?) OR LOWER(COALESCE(c.name, '')) LIKE LOWER(?) OR LOWER(COALESCE(v.user_name, '')) LIKE LOWER(?))`);
    const token = `%${search}%`;
    params.push(token, token, token);
  }
  if (dateFrom) {
    where.push(`datetime(v.data) >= datetime(?)`);
    params.push(dateFrom);
  }
  if (dateTo) {
    where.push(`datetime(v.data) <= datetime(?)`);
    params.push(dateTo);
  }
  if (status) {
    where.push(`${SALES_STATUS_SQL} = ?`);
    params.push(status);
  }
  if (paymentMethod) {
    where.push(`COALESCE(v.payment_method, '') = ?`);
    params.push(paymentMethod);
  }
  if (customerId) {
    where.push(`CAST(COALESCE(v.customer_id, '') AS TEXT) = ?`);
    params.push(customerId);
  }

  return {
    whereSql: where.length ? `WHERE ${where.join(' AND ')}` : '',
    params,
  };
}

export async function listSales(filters = {}, actorUser = null) {
  const pagination = parsePagination(filters);
  const search = parseSearchTerm(filters.search);
  const dateFrom = parseDateFilter(filters.dateFrom ?? filters.from);
  const dateTo = parseDateFilter(filters.dateTo ?? filters.to);
  const tenantId = await resolveTenantId(actorUser?.tenant_id);
  const { whereSql, params } = buildSalesWhereClause({
    tenantId,
    search,
    dateFrom,
    dateTo,
  });
  const orderedSql = `${salesSelectSql} ${whereSql} ORDER BY datetime(v.data) DESC, v.id DESC`;

  if (!pagination.hasPagination) {
    return allDb(orderedSql, params);
  }

  const rows = await allDb(`${orderedSql} LIMIT ? OFFSET ?`, [...params, pagination.limit, pagination.offset]);
  const totalRow = await getDb(
    `SELECT COUNT(*) AS total
     FROM vendas v
     LEFT JOIN clientes c
       ON CAST(c.cloud_id AS TEXT) = CAST(v.customer_id AS TEXT)
      AND c.tenant_id = v.tenant_id
     ${whereSql}`,
    params
  );
  return withPaginationPayload(rows, {
    page: pagination.page,
    limit: pagination.limit,
    total: Number(totalRow?.total ?? 0),
  });
}

export async function listSalesForReports(filters = {}, actorUser = null) {
  const search = parseSearchTerm(filters.search);
  const dateFrom = parseDateFilter(filters.dateFrom ?? filters.from);
  const dateTo = parseDateFilter(filters.dateTo ?? filters.to);
  const status = String(filters.status ?? '').trim().toLowerCase();
  const paymentMethod = String(filters.paymentMethod ?? filters.payment_method ?? '').trim();
  const customerId = String(filters.customerId ?? filters.customer_id ?? '').trim();
  const tenantId = await resolveTenantId(actorUser?.tenant_id);

  const { whereSql, params } = buildSalesWhereClause({
    tenantId,
    search,
    dateFrom,
    dateTo,
    status,
    paymentMethod,
    customerId,
  });

  const orderedSql = `${salesSelectSql} ${whereSql} ORDER BY datetime(v.data) ASC, v.id ASC`;
  return allDb(orderedSql, params);
}

export async function updateSalePaymentStatus(saleIdRaw, paidRaw, actorUser = null) {
  const saleId = Number(saleIdRaw);
  if (!Number.isFinite(saleId)) return { error: 'id invalido', status: 400 };
  const tenantId = await resolveTenantId(actorUser?.tenant_id);

  const paid = Boolean(paidRaw);
  const paymentMethod = paid ? 'Dinheiro' : 'conta corrente';
  const result = await runDb(
    `UPDATE vendas
     SET payment_method = ?,
         doc_type = CASE
           WHEN ? = 0 AND UPPER(COALESCE(doc_type, '')) <> 'FP' THEN 'FT'
           ELSE doc_type
         END,
         status = CASE
           WHEN LOWER(COALESCE(status, '')) = 'approved' THEN status
           ELSE ?
         END
     WHERE id = ?
       AND tenant_id = ?`,
    [paymentMethod, paid ? 1 : 0, paid ? 'completed' : 'pending', saleId, tenantId]
  );

  if (Number(result?.changes ?? 0) === 0) {
    const existing = await getDb(
      `SELECT id
       FROM vendas
       WHERE id = ?
         AND tenant_id = ?
       LIMIT 1`,
      [saleId, tenantId]
    );
    if (!existing?.id) return { error: 'venda nao encontrada', status: 404 };
  }

  return {
    success: true,
    id: saleId,
    status: paid ? 'completed' : 'pending',
    payment_method: paymentMethod,
  };
}

export async function createSale(payload = {}, actorUser = null, options = {}) {
  const tenantId = await resolveTenantId(actorUser?.tenant_id);
  assertTenantWrite(tenantId, payload?.tenant_id ?? payload?.tenantId);

  const stationRole = String(actorUser?.station_role ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  if (stationRole === 'consulta') {
    throw new HttpError(403, 'Posto de consulta não pode registar vendas.');
  }
  if (stationRole === 'cozinha') {
    throw new HttpError(403, 'Posto de cozinha não pode registar vendas.');
  }

  const totalNumber = Number(payload.total);
  const idempotencyKey = sanitizeIdempotencyKey(options?.idempotencyKey ?? payload?.idempotencyKey);
  const storedDate = payload.saleTimestamp || payload.saleDate || payload.data || new Date().toISOString();
  const requestedCustomerId = payload.selectedCustomerId == null ? null : String(payload.selectedCustomerId).trim() || null;
  let localCustomerId = requestedCustomerId;
  let localCustomerName = payload.selectedCustomerName == null ? null : String(payload.selectedCustomerName).trim() || null;
  const localUserId = payload.selectedUserId == null ? null : String(payload.selectedUserId).trim() || null;
  const localUserName = payload.selectedUserName == null ? null : String(payload.selectedUserName).trim() || null;
  const paymentFromList = Array.isArray(payload.payments)
    ? payload.payments.map((p) => String(p?.method ?? '').trim()).filter(Boolean)
    : [];

  let normalizedDocType = String(payload.docType ?? 'VD').trim().toUpperCase() || 'VD';
  const isProforma = normalizedDocType === 'FP';

  if (stationRole === 'garcom' && !isProforma) {
    throw new HttpError(403, 'Posto garçom não fecha pagamento — use um posto caixa.');
  }

  // FP = cotação/proforma: sem pagamento/caixa e sem movimento de stock.
  const rawPaymentMethod = isProforma
    ? null
    : Boolean(payload.isMultiplePayment) && paymentFromList.length > 0
      ? paymentFromList.join(' + ')
      : String(payload.paymentMethod ?? paymentFromList[0] ?? '').trim() || null;
  const localPaymentMethod = isProforma
    ? null
    : Boolean(payload.isMultiplePayment)
      ? (paymentFromList.map((m) => resolveStoredPaymentMethod(m) || m).join(' + ') || null)
      : resolveStoredPaymentMethod(rawPaymentMethod);
  const isAccountReceivable =
    !isProforma &&
    (isAccountReceivablePaymentMethod(rawPaymentMethod) ||
      paymentFromList.some((m) => isAccountReceivablePaymentMethod(m)));

  // Conta Corrente gera dívida: documento FT (nunca para proforma FP).
  if (isAccountReceivable && !isProforma) {
    normalizedDocType = 'FT';
  }
  const shouldDecreaseStock = !isProforma && normalizedDocType !== 'FP';
  const allowNegativeStockOverride = !isProforma && Boolean(payload.allowNegativeStockOverride);
  const stockOverrideReason = String(payload.stockOverrideReason ?? '').trim() || 'Stock override without explicit reason.';
  const normalizedPaymentStatus = String(payload.paymentStatus ?? '').trim().toLowerCase();
  const localStatus =
    isProforma || normalizedDocType === 'FP' || isAccountReceivable || normalizedPaymentStatus === 'pending'
      ? 'pending'
      : 'completed';

  const taxComputation = calculateTaxFromTotal(totalNumber);
  const payloadTax = Number(payload.tax);
  const payloadSubtotal = Number(payload.subtotal);
  const effectiveTax = Number.isFinite(payloadTax) ? payloadTax : taxComputation.tax;
  const effectiveSubtotal = Number.isFinite(payloadSubtotal) ? payloadSubtotal : taxComputation.subtotal;

  if (!Number.isFinite(totalNumber)) return { error: 'total invalido', status: 400 };

  if (idempotencyKey) {
    const existingKey = await getDb(
      `SELECT status, response_json
       FROM checkout_idempotency
       WHERE tenant_id = ?
         AND idempotency_key = ?
       LIMIT 1`,
      [tenantId, idempotencyKey]
    );
    if (existingKey?.status === 'completed' && existingKey?.response_json) {
      try {
        const previousResponse = JSON.parse(String(existingKey.response_json));
        return { ...previousResponse, idempotentReplay: true };
      } catch {}
    }
    if (existingKey?.status === 'processing') {
      return {
        error: 'Checkout em processamento para esta chave idempotente',
        status: 409,
        code: 'CHECKOUT_IN_PROGRESS',
      };
    }

    if (existingKey?.status === 'failed') {
      await runDb(
        `UPDATE checkout_idempotency
         SET status = 'processing',
             sale_id = NULL,
             response_json = NULL,
             error_message = NULL,
             updated_at = ?
         WHERE tenant_id = ?
           AND idempotency_key = ?`,
        [new Date().toISOString(), tenantId, idempotencyKey]
      );
    } else {
      try {
        await runDb(
          `INSERT INTO checkout_idempotency (tenant_id, idempotency_key, status, created_at, updated_at)
           VALUES (?, ?, 'processing', ?, ?)`,
          [tenantId, idempotencyKey, new Date().toISOString(), new Date().toISOString()]
        );
      } catch (insertErr) {
        const duplicated = String(insertErr?.message ?? '').includes('UNIQUE constraint failed');
        if (!duplicated) throw insertErr;
        const raceExisting = await getDb(
          `SELECT status, response_json
           FROM checkout_idempotency
           WHERE tenant_id = ?
             AND idempotency_key = ?
           LIMIT 1`,
          [tenantId, idempotencyKey]
        );
        if (raceExisting?.status === 'completed' && raceExisting?.response_json) {
          try {
            const previousResponse = JSON.parse(String(raceExisting.response_json));
            return { ...previousResponse, idempotentReplay: true };
          } catch {}
        }
        return {
          error: 'Checkout em processamento para esta chave idempotente',
          status: 409,
          code: 'CHECKOUT_IN_PROGRESS',
        };
      }
    }
  }

  if (requestedCustomerId) {
    const scopedCustomer = await getDb(
      `SELECT id, name
       FROM clientes
       WHERE tenant_id = ?
         AND (
           CAST(id AS TEXT) = CAST(? AS TEXT)
           OR CAST(cloud_id AS TEXT) = CAST(? AS TEXT)
         )
       LIMIT 1`,
      [tenantId, requestedCustomerId, requestedCustomerId]
    );
    if (!scopedCustomer?.id) {
      localCustomerId = null;
      localCustomerName = null;
    } else {
      localCustomerId = String(scopedCustomer.id);
      localCustomerName = String(scopedCustomer.name ?? localCustomerName ?? '').trim() || null;
    }
  }

  if (isAccountReceivable && !localCustomerId) {
    if (idempotencyKey) {
      await runDb(
        `UPDATE checkout_idempotency
         SET status = 'failed',
             error_message = ?,
             updated_at = ?
         WHERE tenant_id = ?
           AND idempotency_key = ?`,
        ['customer_required_for_account', new Date().toISOString(), tenantId, idempotencyKey]
      ).catch(() => {});
    }
    return {
      error: 'Cliente obrigatório para venda a Conta Corrente (dívida / FT).',
      status: 400,
      code: 'CUSTOMER_REQUIRED_FOR_ACCOUNT',
    };
  }

  const stockAdjustments = shouldDecreaseStock
    ? await buildStockAdjustmentsFromCart(payload.cart, tenantId)
    : [];

  let saleWarehouseId = null;
  if (shouldDecreaseStock && stockAdjustments.length > 0) {
    let locationId =
      payload.locationId != null
        ? String(payload.locationId).trim() || null
        : payload.location_id != null
          ? String(payload.location_id).trim() || null
          : null;

    // Resolver local a partir da mesa seleccionada (nome da mesa → location_tables).
    if (!locationId && payload.selectedTableId != null && String(payload.selectedTableId).trim()) {
      const tableName = String(payload.selectedTableId).trim();
      const tableRow = await get(
        `SELECT location_id FROM location_tables
         WHERE tenant_id = ? AND name = ? AND COALESCE(active, 1) = 1
         LIMIT 1`,
        [tenantId, tableName]
      );
      if (tableRow?.location_id) locationId = String(tableRow.location_id);
    }

    saleWarehouseId = await resolveWarehouseId({
      tenantId,
      locationId,
      explicitWarehouseId: payload.warehouseId ?? payload.warehouse_id ?? null,
    });
  }
  const stockOverrideAuthorized = allowNegativeStockOverride
    ? await canOverrideZeroStock(actorUser, tenantId)
    : false;
  if (allowNegativeStockOverride && !stockOverrideAuthorized) {
    if (idempotencyKey) {
      await runDb(
        `UPDATE checkout_idempotency
         SET status = 'failed',
             error_message = ?,
             updated_at = ?
         WHERE tenant_id = ?
           AND idempotency_key = ?`,
        ['override_forbidden', new Date().toISOString(), tenantId, idempotencyKey]
      );
    }
    return {
      error: 'Utilizador sem permissao para venda com stock zero.',
      status: 403,
      code: 'STOCK_OVERRIDE_FORBIDDEN',
    };
  }

  let usedSaleId;
  let usedSequence;
  let checkoutResponse = null;

  try {
    await runDb('BEGIN IMMEDIATE TRANSACTION');

    // Sequência por tenant — não misturar numeração entre lojas/tenants.
    let candidate = Number(
      (
        await getDb(
          `SELECT COALESCE(MAX(COALESCE(doc_sequence, id)), 0) + 1 AS next
             FROM vendas
            WHERE UPPER(COALESCE(doc_type, 'VD')) = ?
              AND tenant_id = ?`,
          [normalizedDocType, tenantId],
        )
      )?.next ?? 1,
    );
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const taken = await getDb(
        `SELECT 1 AS ok
           FROM vendas
          WHERE tenant_id = ?
            AND UPPER(COALESCE(doc_type, 'VD')) = ?
            AND CAST(COALESCE(doc_sequence, id) AS INTEGER) = ?
          LIMIT 1`,
        [tenantId, normalizedDocType, candidate],
      );
      if (!taken) break;
      candidate += 1;
    }
    usedSequence = candidate;

    const insertResult = await runDb(
      `INSERT INTO vendas (
        total, data, doc_type, doc_sequence, status, customer_id, customer_name, payment_method, user_id, user_name, approved_document_type, approved_document_number, tenant_id, register_code
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        totalNumber,
        storedDate,
        normalizedDocType,
        usedSequence,
        localStatus,
        localCustomerId,
        localCustomerName,
        localPaymentMethod,
        localUserId,
        localUserName,
        null,
        null,
        tenantId,
        String(actorUser?.station_code ?? payload.register_code ?? payload.registerCode ?? 'caixa-1').trim() ||
          'caixa-1',
      ]
    );

    usedSaleId = insertResult.lastID;

    if (Array.isArray(payload.cart) && payload.cart.length > 0) {
      for (const rawItem of payload.cart) {
        const quantity = Number(rawItem?.quantity ?? 0);
        if (!Number.isFinite(quantity) || quantity <= 0) continue;
        const linePrice = Number(rawItem?.price ?? rawItem?.unit_price ?? 0);
        const discountAmount = Number(rawItem?.discount_amount ?? rawItem?.discountAmount ?? 0);
        const nowIso = new Date().toISOString();
        const productId = rawItem?.id != null ? String(rawItem.id) : null;

        await runDb(
          `INSERT INTO order_items
            (id, order_id, tenant_id, product_id, product_name, quantity, price, discount_amount,
             created_at, updated_at, unit_cost, cogs_total)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            crypto.randomUUID(),
            String(usedSaleId),
            tenantId,
            productId,
            String(rawItem?.name ?? rawItem?.product_name ?? 'Item'),
            quantity,
            Number.isFinite(linePrice) ? linePrice : 0,
            Number.isFinite(discountAmount) ? discountAmount : 0,
            nowIso,
            nowIso,
            null,
            null,
          ]
        );
      }
    }

    const cogsByProduct = new Map();
    for (const adjustment of stockAdjustments) {
      const qty = Number(adjustment.quantity);
      if (!Number.isFinite(qty) || qty <= 0) continue;

      try {
        const whQty = await getWarehouseQuantity(saleWarehouseId, adjustment.productId, tenantId);
        if (whQty < qty && !stockOverrideAuthorized) {
          throw new Error(
            `Stock insuficiente para “${adjustment.name || adjustment.productId}”`
          );
        }
        const deltaResult = await applyWarehouseDelta({
          tenantId,
          warehouseId: saleWarehouseId,
          productId: adjustment.productId,
          delta: -qty,
          movementType: 'sale',
          referenceId: `SALE:${usedSaleId}:${adjustment.productId}`,
          allowNegative: stockOverrideAuthorized,
        });
        cogsByProduct.set(String(adjustment.productId), {
          unitCost: Number(deltaResult?.unitCostFifo ?? 0) || 0,
          cogsTotal: Number(deltaResult?.cogsTotal ?? 0) || 0,
          qty,
        });
        if (whQty < qty && stockOverrideAuthorized) {
          await logAudit('STOCK_OVERRIDE_SALE', actorUser, {
            entity: 'sale',
            entity_id: String(usedSaleId),
            description: 'Stock override applied during sale',
            product_id: adjustment.productId,
            quantity_delta: -Math.abs(qty),
            warehouse_id: saleWarehouseId,
            reason: stockOverrideReason,
          });
        }
      } catch (stockErr) {
        if (String(stockErr?.message || '').includes('Stock insuficiente')) {
          throw stockErr;
        }
        if (!stockOverrideAuthorized && (stockErr?.status === 409 || stockErr?.statusCode === 409)) {
          throw new Error(
            `Stock insuficiente para “${adjustment.name || adjustment.productId}”`
          );
        }
        throw stockErr;
      }
    }

    for (const [productId, cogs] of cogsByProduct.entries()) {
      const unitCost = cogs.unitCost;
      await runDb(
        `UPDATE order_items
         SET unit_cost = ?,
             cogs_total = ROUND(COALESCE(quantity, 0) * ?, 6)
         WHERE order_id = ?
           AND tenant_id = ?
           AND CAST(product_id AS TEXT) = ?`,
        [unitCost, unitCost, String(usedSaleId), tenantId, productId]
      );
    }

    await runDb('COMMIT');
  } catch (error) {
    try {
      await runDb('ROLLBACK');
    } catch {}
    const statusCode = String(error?.message || '').includes('Stock insuficiente') ? 409 : 500;
    if (idempotencyKey) {
      await runDb(
        `UPDATE checkout_idempotency
         SET status = 'failed',
             error_message = ?,
             updated_at = ?
         WHERE tenant_id = ?
           AND idempotency_key = ?`,
        [String(error?.message ?? 'checkout_error'), new Date().toISOString(), tenantId, idempotencyKey]
      );
    }
    return {
      error: error.message,
      status: statusCode,
      code: statusCode === 409 ? 'INSUFFICIENT_STOCK' : 'CHECKOUT_FAILED',
    };
  }

  const year = new Date(storedDate).getFullYear();
  const usedDocumentNumber = `${normalizedDocType}/${year}/${String(usedSequence).padStart(4, '0')}`;
  const localSaleId = crypto.randomUUID();

  const salePayload = {
    ...payload,
    id: usedSaleId,
    local_sale_id: localSaleId,
    usedSequence,
    usedDocType: normalizedDocType,
    usedDocumentNumber,
    total: totalNumber,
    subtotal: effectiveSubtotal,
    tax: effectiveTax,
    saleTimestamp: storedDate,
    tenant_id: tenantId,
    stockAdjustments,
  };

  const auditUser =
    actorUser && typeof actorUser === 'object'
      ? actorUser
      : {
          id: localUserId,
          name: localUserName,
          role: null,
        };

  await logAudit('SALE_CREATE', auditUser, {
    entity: 'sale',
    entity_id: String(usedSaleId),
    description: `Venda ${usedDocumentNumber || usedSaleId} criada (${normalizedDocType}) — total ${totalNumber}`,
    total: totalNumber,
    document_number: usedDocumentNumber,
    document_type: normalizedDocType,
  });

  logEvent('info', 'sale.created', `Venda ${usedDocumentNumber || usedSaleId} concluída com sucesso`, {
    source: 'api',
    module: 'sales.service',
    action: 'createSale',
    reason: 'Checkout gravado na base local e enfileirado para sync (se aplicável)',
    who: auditUser,
    entity: 'sale',
    entity_id: String(usedSaleId),
    document_number: usedDocumentNumber,
    document_type: normalizedDocType,
    total: totalNumber,
    tenant_id: tenantId,
    item_count: Array.isArray(payload?.cart) ? payload.cart.length : null,
  });

  if (stockAdjustments.length > 0) {
    await logAudit('STOCK_CHANGE', auditUser, {
      entity: 'sale',
      entity_id: String(usedSaleId),
      description: 'Stock updated from sale',
      items: stockAdjustments.map((item) => ({
        product_id: item.productId,
        quantity_delta: -Math.abs(item.quantity),
      })),
    });
  }

  try {
    await enqueueSync('sale', salePayload);
    checkoutResponse = {
      success: true,
      id: usedSaleId,
      usedSequence,
      usedDocType: normalizedDocType,
      usedDocumentNumber,
      syncQueued: true,
      taxRate: POS_TAX_RATE,
    };
  } catch (queueErr) {
    checkoutResponse = {
      success: true,
      id: usedSaleId,
      usedSequence,
      usedDocType: normalizedDocType,
      usedDocumentNumber,
      syncQueued: false,
      syncError: queueErr.message,
      taxRate: POS_TAX_RATE,
    };
  }

  if (idempotencyKey) {
    await runDb(
      `UPDATE checkout_idempotency
       SET status = 'completed',
           sale_id = ?,
           response_json = ?,
           error_message = NULL,
           updated_at = ?
       WHERE tenant_id = ?
         AND idempotency_key = ?`,
      [usedSaleId, JSON.stringify(checkoutResponse), new Date().toISOString(), tenantId, idempotencyKey]
    );
  }

  return checkoutResponse;
}
