import crypto from 'crypto';
import { enqueueSync } from '../syncQueue.js';
import { HttpError } from '../utils/response.js';
import { assertTenantWrite, requireTenantId } from '../utils/tenant.js';
import {
  parseDateOnly,
  parsePagination,
  parseSearchTerm,
  withPaginationPayload,
} from './queryOptions.service.js';
import {
  beginImmediateTransaction,
  commitTransaction,
  countDocumentoItems,
  countDocumentos,
  findOrderById,
  getNextOrderSequence,
  getNextVdSequence,
  getProductForSync,
  increaseProductStock,
  insertOrder,
  insertOrderItem,
  insertStockMovement,
  listDashboardCustomers,
  listDashboardOrderItems,
  listDashboardOrderRows,
  listDashboardSaleRows,
  listDocumentoItems,
  listDocumentoItemsPaginated,
  listDocumentos,
  listDocumentosPaginated,
  rollbackTransaction,
  sumDebitNotesForSource,
  sumDebitNoteQuantitiesByProductForSource,
  sumCreditNotesForSource,
  sumReceiptsForSource,
  updateOrderApproval,
  updateOrderDocumentPayment,
  updateOrderNotes,
  updateOrderPaymentStatus,
  updateVendaApproval,
  updateVendaDocumentPayment,
  updateVendaStatus,
  findOrderByDocumentNumber,
  findOrderByDocumentParts,
  findVendaByDocumentNumber,
  getOrderPaymentContext,
  getVendaPaymentContext,
  insertVendaRecord,
  listOrderItemsByDocumentId,
  updateOrderSourceReference,
} from '../repositories/documentos.repository.js';

import { filterCashInflowDocuments, isPendingContaCorrenteFt, resolveDocCode } from '../utils/revenueDocuments.js';
import { formatPaymentMethodLabel } from '../utils/paymentMethodLabel.js';
import {
  applyWarehouseDelta,
  getWarehouseQuantity,
  resolveWarehouseId,
} from './warehouseStock.service.js';
import {
  createPartyCreditId,
  insertPartyCredit,
} from '../repositories/partyCredits.repository.js';
import { logAudit, logError, logWarn } from '../utils/logger.js';

const STOCK_IN_PREFIXES = new Set(['WH/IN', 'EN/ST', 'PUR', 'FTF', 'NC']);
const STOCK_OUT_PREFIXES = new Set(['VD', 'TK', 'FT', 'DP', 'WH/LOSS', 'CP', 'ND']);
const CLIENT_CREDIT_PREFIXES = new Set(['RCA', 'AD']);
const SUPPLIER_CREDIT_PREFIXES = new Set(['PAAD']);
const DEFAULT_PAID_PREFIXES = new Set(['VD', 'TK', 'RC', 'RCA', 'AD', 'PAG', 'PAAD', 'NC', 'ND', 'DP', 'CP']);

function resolveStockSign(prefix, documentType) {
  const p = String(prefix || '').toUpperCase();
  const type = String(documentType || '').trim().toLowerCase();
  if (
    STOCK_IN_PREFIXES.has(p) ||
    type === 'entrada de stock' ||
    type === 'entrada de armazem' ||
    type === 'entrada de armazém' ||
    type === 'compra' ||
    type === 'fatura de fornecedor'
  ) {
    return 1;
  }
  if (STOCK_OUT_PREFIXES.has(p)) return -1;
  return 0;
}

function resolveMovementType(prefix, stockSign) {
  const p = String(prefix || '').toUpperCase();
  if (stockSign > 0) {
    if (p === 'NC') return 'restock';
    return 'restock';
  }
  if (p === 'VD' || p === 'TK' || p === 'FT') return 'sale';
  if (p === 'DP' || p === 'WH/LOSS') return 'adjustment';
  if (p === 'CP' || p === 'ND') return 'adjustment';
  return 'adjustment';
}

const DASHBOARD_SUMMARY_CACHE_TTL_MS = Math.max(1000, Number(process.env.DASHBOARD_SUMMARY_CACHE_TTL_MS ?? 8000));
const dashboardSummaryCache = new Map();

function resolveTenantIdStrict(tenantCandidate) {
  return requireTenantId(tenantCandidate, {
    status: 401,
    message: 'tenant_id ausente para operacao de documentos',
  });
}

function buildDocumentosBaseSql() {
  return `
    FROM (
      SELECT
        CAST(o.id AS TEXT) AS id,
        o.doc_type AS doc_type,
        o.document_number AS document_number,
        o.payment_method AS payment_method,
        o.status AS status,
        o.approved_document_type AS approved_document_type,
        o.approved_document_number AS approved_document_number,
        o.external_document AS external_document,
        o.notes AS notes,
        o.is_waste AS is_waste,
        CASE
          WHEN UPPER(COALESCE(o.doc_prefix, '')) = 'FTF' THEN COALESCE((
            SELECT SUM(COALESCE(nd.total, 0))
            FROM orders nd
            WHERE nd.tenant_id = o.tenant_id
              AND UPPER(COALESCE(nd.doc_prefix, '')) = 'ND'
              AND UPPER(TRIM(COALESCE(nd.approved_document_type, ''))) = 'FTF'
              AND UPPER(TRIM(COALESCE(nd.approved_document_number, ''))) =
                  UPPER(TRIM(COALESCE(o.document_number, '')))
          ), 0)
          WHEN UPPER(COALESCE(o.doc_prefix, '')) = 'FT' THEN COALESCE((
            SELECT SUM(COALESCE(nc.total, 0))
            FROM orders nc
            WHERE nc.tenant_id = o.tenant_id
              AND UPPER(COALESCE(nc.doc_prefix, '')) = 'NC'
              AND UPPER(TRIM(COALESCE(nc.approved_document_type, ''))) = 'FT'
              AND UPPER(TRIM(COALESCE(nc.approved_document_number, ''))) =
                  UPPER(TRIM(COALESCE(o.document_number, '')))
          ), 0)
          ELSE 0
        END AS credit_note_total,
        CASE
          WHEN UPPER(COALESCE(o.doc_prefix, '')) = 'FT' THEN COALESCE((
            SELECT SUM(COALESCE(rc.total, 0))
            FROM orders rc
            WHERE rc.tenant_id = o.tenant_id
              AND UPPER(COALESCE(rc.doc_prefix, '')) = 'RC'
              AND UPPER(TRIM(COALESCE(rc.approved_document_type, ''))) = 'FT'
              AND UPPER(TRIM(COALESCE(rc.approved_document_number, ''))) =
                  UPPER(TRIM(COALESCE(o.document_number, '')))
          ), 0)
          ELSE 0
        END AS receipt_total,
        o.discount AS discount,
        o.subtotal AS subtotal,
        o.tax AS tax,
        o.total AS total,
        o.created_at AS created_at,
        o.customer_id AS customer_id,
        o.local_sale_id AS local_sale_id,
        o.user_name AS user_name,
        COALESCE(c.name, 'Consumidor final') AS client_name
      FROM orders o
      LEFT JOIN clientes c
        ON CAST(c.id AS TEXT) = CAST(o.customer_id AS TEXT)
       AND c.tenant_id = o.tenant_id
      WHERE o.tenant_id = ?

      UNION ALL

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
        CASE
          WHEN LOWER(COALESCE(v.status, '')) IN ('approved', 'aprovado') THEN 'approved'
          WHEN UPPER(COALESCE(v.doc_type, '')) = 'FP' THEN 'pending'
          WHEN LOWER(REPLACE(COALESCE(v.payment_method, ''), '-', ' ')) LIKE '%conta corrente%' THEN 'pending'
          ELSE COALESCE(v.status, 'completed')
        END AS status,
        v.approved_document_type AS approved_document_type,
        v.approved_document_number AS approved_document_number,
        NULL AS external_document,
        NULL AS notes,
        0 AS is_waste,
        0 AS credit_note_total,
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
        v.total AS subtotal,
        0 AS tax,
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
      WHERE v.tenant_id = ?

      UNION ALL

      SELECT
        ('inv:' || CAST(sm.id AS TEXT)) AS id,
        'Inventário rápido' AS doc_type,
        (
          'INV/' ||
          CAST(strftime('%Y', sm.created_at) AS TEXT) ||
          '/' ||
          printf('%04d', sm.id)
        ) AS document_number,
        NULL AS payment_method,
        'completed' AS status,
        NULL AS approved_document_type,
        NULL AS approved_document_number,
        NULL AS external_document,
        NULL AS notes,
        0 AS is_waste,
        0 AS credit_note_total,
        0 AS receipt_total,
        0 AS discount,
        0 AS subtotal,
        0 AS tax,
        0 AS total,
        sm.created_at AS created_at,
        NULL AS customer_id,
        NULL AS local_sale_id,
        NULL AS user_name,
        'Inventário' AS client_name
      FROM stock_movements sm
      WHERE sm.tenant_id = ?
        AND sm.reference_id LIKE 'INV-COUNT:%'
    ) docs`;
}

export async function getDocumentos(query = {}, user = null) {
  const tenantId = resolveTenantIdStrict(user?.tenant_id);
  const pagination = parsePagination(query);
  const search = parseSearchTerm(query.search);
  const dateFromRaw = parseDateOnly(query.dateFrom ?? query.from);
  const dateToRaw = parseDateOnly(query.dateTo ?? query.to);
  const docsBaseSql = buildDocumentosBaseSql();

  const where = ['1=1'];
  const params = [tenantId, tenantId, tenantId];
  if (search) {
    const token = `%${search}%`;
    where.push(`(
      LOWER(COALESCE(client_name, '')) LIKE LOWER(?)
      OR LOWER(COALESCE(document_number, '')) LIKE LOWER(?)
      OR LOWER(COALESCE(user_name, '')) LIKE LOWER(?)
      OR LOWER(COALESCE(doc_type, '')) LIKE LOWER(?)
    )`);
    params.push(token, token, token, token);
  }
  if (dateFromRaw) {
    where.push(`date(created_at) >= date(?)`);
    params.push(dateFromRaw);
  }
  if (dateToRaw) {
    where.push(`date(created_at) <= date(?)`);
    params.push(dateToRaw);
  }
  const whereSql = ` WHERE ${where.join(' AND ')}`;
  const orderedSql = `SELECT id, doc_type, document_number, payment_method, status, approved_document_type, approved_document_number, external_document, notes, is_waste, credit_note_total, receipt_total, discount, subtotal, tax, total, created_at, customer_id, local_sale_id, user_name, client_name ${docsBaseSql}${whereSql} ORDER BY datetime(created_at) DESC, id DESC`;

  if (!pagination.hasPagination) {
    const rows = await listDocumentos(orderedSql, params);
    return rows ?? [];
  }

  const rows = await listDocumentosPaginated(orderedSql, params, pagination.limit, pagination.offset);
  const total = await countDocumentos(docsBaseSql, whereSql, params);
  return withPaginationPayload(rows ?? [], {
    page: pagination.page,
    limit: pagination.limit,
    total,
  });
}

export async function approveCotacao(payload = {}, user = null) {
  const tenantId = resolveTenantIdStrict(user?.tenant_id);
  assertTenantWrite(tenantId, payload?.tenant_id ?? payload?.tenantId);
  const sourceIdRaw = String(payload.sourceId ?? '').trim();
  const sourceTypeRaw = String(payload.sourceType ?? '').trim().toLowerCase();
  const approvedDocType = String(payload.approvedDocType ?? '').trim().toUpperCase();
  const approvedDocumentNumber = String(payload.approvedDocumentNumber ?? '').trim();

  if (!sourceIdRaw) throw new HttpError(400, 'sourceId obrigatorio');
  if (!approvedDocType) throw new HttpError(400, 'approvedDocType obrigatorio');
  if (!approvedDocumentNumber) throw new HttpError(400, 'approvedDocumentNumber obrigatorio');

  const sourceType =
    sourceTypeRaw === 'sale' || sourceIdRaw.startsWith('venda:')
      ? 'sale'
      : sourceTypeRaw === 'order'
        ? 'order'
        : 'order';
  const sourceId = sourceIdRaw.replace(/^venda:/, '');

  if (sourceType === 'sale') {
    const saleId = Number(sourceId);
    if (!Number.isFinite(saleId)) throw new HttpError(400, 'sourceId de venda invalido');
    const result = await updateVendaApproval(saleId, approvedDocType, approvedDocumentNumber, tenantId);
    if (Number(result?.changes ?? 0) === 0) {
      throw new HttpError(404, 'cotacao de venda nao encontrada');
    }
    return {
      success: true,
      sourceType: 'sale',
      sourceId: String(saleId),
      status: 'approved',
      approvedDocumentType: approvedDocType,
      approvedDocumentNumber,
    };
  }

  const result = await updateOrderApproval(
    sourceId,
    approvedDocType,
    approvedDocumentNumber,
    new Date().toISOString(),
    tenantId
  );
  if (Number(result?.changes ?? 0) === 0) throw new HttpError(404, 'cotacao nao encontrada');
  return {
    success: true,
    sourceType: 'order',
    sourceId,
    status: 'approved',
    approvedDocumentType: approvedDocType,
    approvedDocumentNumber,
  };
}

export async function updateDocumentoPaymentStatus(idRaw, payload = {}, user = null) {
  const tenantId = resolveTenantIdStrict(user?.tenant_id);
  assertTenantWrite(tenantId, payload?.tenant_id ?? payload?.tenantId);
  const orderId = String(idRaw ?? '').trim();
  if (!orderId) throw new HttpError(400, 'id invalido');
  const paid = Boolean(payload.paid);
  const nextStatus = paid ? 'completed' : 'pending';
  const result = await updateOrderPaymentStatus(orderId, nextStatus, new Date().toISOString(), tenantId);

  if (Number(result?.changes ?? 0) === 0) {
    const existing = await findOrderById(orderId, tenantId);
    if (!existing?.id) throw new HttpError(404, 'documento nao encontrado');
  }
  return { success: true, id: orderId, status: nextStatus };
}

export async function getDocumentosItens(query = {}, user = null) {
  const tenantId = resolveTenantIdStrict(user?.tenant_id);
  const pagination = parsePagination(query);
  const search = parseSearchTerm(query.search);
  const where = ['1=1'];
  const params = [];
  if (search) {
    where.push(`LOWER(COALESCE(product_name, '')) LIKE LOWER(?)`);
    params.push(`%${search}%`);
  }
  const whereSql = `WHERE ${where.join(' AND ')}`;

  if (!pagination.hasPagination) {
    const rows = await listDocumentoItems(whereSql, params, tenantId);
    return rows ?? [];
  }

  const rows = await listDocumentoItemsPaginated(whereSql, params, pagination.limit, pagination.offset, tenantId);
  const total = await countDocumentoItems(whereSql, params, tenantId);
  return withPaginationPayload(rows ?? [], {
    page: pagination.page,
    limit: pagination.limit,
    total,
  });
}

export async function getDocumentosNextNumber(query = {}, user = null) {
  const tenantId = resolveTenantIdStrict(user?.tenant_id);
  const prefix = String(query.prefix ?? '').trim().toUpperCase();
  const yearRaw = Number(query.year ?? new Date().getFullYear());
  const year = Number.isFinite(yearRaw) ? yearRaw : new Date().getFullYear();
  if (!prefix) throw new HttpError(400, 'prefix obrigatorio');

  const row = await getNextOrderSequence(prefix, year, tenantId);
  const sequence = Number(row?.next ?? 1);
  const padSize = prefix === 'FP' ? 4 : 5;
  const documentNumber = `${prefix}/${year}/${String(sequence).padStart(padSize, '0')}`;
  return { prefix, year, sequence, documentNumber };
}

export async function postDocumento(payload = {}, user = null) {
  const tenantId = resolveTenantIdStrict(user?.tenant_id);
  assertTenantWrite(tenantId, payload?.tenant_id ?? payload?.tenantId);
  const now = new Date().toISOString();
  const documentDate = payload.documentDate ? String(payload.documentDate) : now;
  const documentType = String(payload.documentType ?? 'Documento').trim() || 'Documento';
  const prefix = String(payload.prefix ?? '').trim().toUpperCase();
  const discount = Number(payload.discount ?? 0);
  const customerId = payload.customerId == null ? null : String(payload.customerId).trim() || null;
  const customerName = payload.customerName == null ? null : String(payload.customerName).trim() || null;
  const userId = payload.userId == null ? null : String(payload.userId).trim() || null;
  const userName = payload.userName == null ? null : String(payload.userName).trim() || null;
  const paymentMethodRaw =
    payload.paymentMethod == null ? null : String(payload.paymentMethod).trim() || null;
  const paymentMethod =
    paymentMethodRaw == null ? null : formatPaymentMethodLabel(paymentMethodRaw, paymentMethodRaw);
  const items = Array.isArray(payload.items) ? payload.items : [];
  const allowNegativeStock = Boolean(payload.allowNegativeStock);
  const physicalReturn = payload.physicalReturn !== false; // NC/ND: por defeito movimenta stock

  // Totais a partir das linhas (unitGross / taxAmount) quando a compra envia breakdown de IVA.
  const roundMoney = (n) => Math.round((Number(n) || 0) * 100) / 100;
  let fromItemsNet = 0;
  let fromItemsTax = 0;
  let fromItemsGross = 0;
  let hasLineTaxBreakdown = false;
  for (const rawItem of items) {
    const quantity = Number(rawItem?.quantity ?? 0);
    if (!Number.isFinite(quantity) || quantity <= 0) continue;
    const unitPrice = Number(rawItem?.unitPrice ?? rawItem?.price ?? 0);
    const unitGrossRaw = rawItem?.unitGross ?? rawItem?.unit_gross;
    const taxAmountRaw = rawItem?.taxAmount ?? rawItem?.tax_amount;
    const unitGross =
      unitGrossRaw != null && Number.isFinite(Number(unitGrossRaw)) ? Number(unitGrossRaw) : null;
    const taxAmount =
      taxAmountRaw != null && Number.isFinite(Number(taxAmountRaw)) ? Number(taxAmountRaw) : null;
    if (unitGross != null || taxAmount != null) hasLineTaxBreakdown = true;
    const lineNet = (Number.isFinite(unitPrice) ? unitPrice : 0) * quantity;
    const lineTax = (taxAmount != null ? taxAmount : 0) * quantity;
    const lineGross =
      unitGross != null ? unitGross * quantity : lineNet + lineTax;
    fromItemsNet += lineNet;
    fromItemsTax += lineTax;
    fromItemsGross += lineGross;
  }
  fromItemsNet = roundMoney(fromItemsNet);
  fromItemsTax = roundMoney(fromItemsTax);
  fromItemsGross = roundMoney(fromItemsGross);

  let total = Number(payload.total ?? 0);
  let subtotal =
    payload.subtotal != null && Number.isFinite(Number(payload.subtotal))
      ? Number(payload.subtotal)
      : total;
  let tax =
    payload.tax != null && Number.isFinite(Number(payload.tax))
      ? Number(payload.tax)
      : 0;

  const purchasePrefix =
    prefix === 'FTF' || prefix === 'PUR' || prefix === 'EN/ST';

  // 1) Linhas com breakdown explícito → preferir soma das linhas.
  if (
    hasLineTaxBreakdown &&
    fromItemsGross > 0 &&
    (tax === 0 || Math.abs(subtotal - total) < 0.0001) &&
    Math.abs(fromItemsGross - fromItemsNet) > 0.0001
  ) {
    subtotal = fromItemsNet;
    tax = fromItemsTax > 0 ? fromItemsTax : roundMoney(fromItemsGross - fromItemsNet);
    total = fromItemsGross;
  } else if (
    // 2) Compra: total (pago) > soma dos custos líquidos nas linhas e tax=0 → derivar IVA.
    purchasePrefix &&
    tax === 0 &&
    fromItemsNet > 0 &&
    Number.isFinite(total) &&
    total > fromItemsNet + 0.009
  ) {
    subtotal = fromItemsNet;
    tax = roundMoney(total - fromItemsNet);
  } else {
    total = Number.isFinite(total) ? total : fromItemsGross || 0;
    subtotal = Number.isFinite(subtotal) ? subtotal : total;
    tax = Number.isFinite(tax) ? tax : 0;
  }

  if (!prefix) throw new HttpError(400, 'prefix obrigatorio');

  let paid = Boolean(payload.paid);
  if (payload.paid == null && DEFAULT_PAID_PREFIXES.has(prefix)) {
    paid = true;
  }
  if (prefix === 'FP') paid = false;
  // Compra a fornecedor (FTF/PUR/EN/ST): factura em dívida por defeito.
  if (prefix === 'FTF' || prefix === 'PUR' || prefix === 'EN/ST') {
    paid = false;
  }
  if (prefix === 'FT' && payload.paid == null) {
    paid = false;
  }

  const linkedDocNumber = String(
    payload.sourceDocumentNumber ?? payload.externalDocument ?? payload.external_document ?? ''
  ).trim();

  if (prefix === 'ND' && linkedDocNumber) {
    const sourceOrder = await findOrderByDocumentNumber(linkedDocNumber, tenantId);
    if (!sourceOrder?.id || String(sourceOrder.doc_prefix ?? '').toUpperCase() !== 'FTF') {
      throw new HttpError(404, 'Fatura de fornecedor de origem não encontrada');
    }
    const alreadyCredited = await sumDebitNotesForSource(linkedDocNumber, tenantId);
    const remaining = Math.max(0, roundMoney(Number(sourceOrder.total ?? 0) - alreadyCredited));
    if (total > remaining + 0.009) {
      throw new HttpError(
        409,
        `Valor da nota de débito excede o saldo da fatura (${remaining.toFixed(2)} MT)`
      );
    }
  }

  if (prefix === 'NC' && linkedDocNumber) {
    const sourceOrder = await findOrderByDocumentNumber(linkedDocNumber, tenantId);
    if (!sourceOrder?.id || String(sourceOrder.doc_prefix ?? '').toUpperCase() !== 'FT') {
      throw new HttpError(404, 'Fatura de cliente de origem não encontrada');
    }
    const alreadyCredited = await sumCreditNotesForSource(linkedDocNumber, tenantId);
    const remaining = Math.max(0, roundMoney(Number(sourceOrder.total ?? 0) - alreadyCredited));
    if (total > remaining + 0.009) {
      throw new HttpError(
        409,
        `Valor da nota de crédito excede o saldo da fatura (${remaining.toFixed(2)} MT)`
      );
    }
  }

  const status = paid ? 'completed' : 'pending';
  let stockSign = resolveStockSign(prefix, documentType);
  // NC/ND sem devolução física: não mexer no stock
  if ((prefix === 'NC' || prefix === 'ND') && !physicalReturn) {
    stockSign = 0;
  }

  const warehouseId =
    stockSign !== 0
      ? await resolveWarehouseId({
          tenantId,
          explicitWarehouseId: payload.warehouseId ?? payload.warehouse_id ?? null,
        })
      : null;

  // ND com devolução física: só permite se houver stock no armazém (ex.: ainda não vendido).
  if (prefix === 'ND' && physicalReturn && stockSign < 0 && warehouseId) {
    const alreadyReturnedByProduct = linkedDocNumber
      ? await sumDebitNoteQuantitiesByProductForSource(linkedDocNumber, tenantId)
      : {};
    let purchasedByProduct = {};
    if (linkedDocNumber) {
      const sourceOrder = await findOrderByDocumentNumber(linkedDocNumber, tenantId);
      if (sourceOrder?.id) {
        const sourceItems = await listOrderItemsByDocumentId(String(sourceOrder.id), tenantId);
        for (const row of sourceItems ?? []) {
          const pid = row.product_id != null ? String(row.product_id) : '';
          if (!pid) continue;
          purchasedByProduct[pid] = (purchasedByProduct[pid] || 0) + (Number(row.quantity ?? 0) || 0);
        }
      }
    }

    const requestedByProduct = new Map();
    for (const rawItem of items) {
      const quantity = Number(rawItem?.quantity ?? 0);
      if (!Number.isFinite(quantity) || quantity <= 0) continue;
      const productId = rawItem?.productId != null ? String(rawItem.productId) : null;
      if (!productId) {
        throw new HttpError(400, 'Há linhas sem produto — não é possível baixar stock na ND');
      }
      requestedByProduct.set(productId, (requestedByProduct.get(productId) || 0) + quantity);
    }

    for (const [productId, qtyNeeded] of requestedByProduct.entries()) {
      const productRow = await getProductForSync(productId, tenantId);
      if (Number(productRow?.is_service ?? 0) !== 0) continue;

      const alreadyReturned = Number(alreadyReturnedByProduct[productId] ?? 0) || 0;
      if (linkedDocNumber) {
        const purchased = Number(purchasedByProduct[productId] ?? 0) || 0;
        const remainingQty = Math.max(0, purchased - alreadyReturned);
        if (qtyNeeded > remainingQty + 1e-6) {
          const name = String(productRow?.name ?? productId);
          throw new HttpError(
            409,
            `Quantidade a devolver de «${name}» excede o restante da FTF (${remainingQty}).`
          );
        }
      }

      const available = await getWarehouseQuantity(warehouseId, productId, tenantId);
      if (qtyNeeded > available + 1e-6) {
        const name = String(productRow?.name ?? productId);
        throw new HttpError(
          409,
          `Não é possível emitir ND com devolução física: «${name}» sem stock suficiente no armazém (disponível: ${available}). O stock já foi vendido ou não há existências para devolver.`
        );
      }
    }
  }

  const dateObj = new Date(documentDate);
  const year = Number.isNaN(dateObj.getTime()) ? new Date().getFullYear() : dateObj.getFullYear();

  let orderId = null;
  let documentNumber = null;
  let usedSequence = 1;
  const touchedProductIds = new Set();

  try {
    await beginImmediateTransaction();

    // Revalidar crédito ND/NC sob lock exclusivo.
    if (prefix === 'ND' && linkedDocNumber) {
      const sourceOrderLocked = await findOrderByDocumentNumber(linkedDocNumber, tenantId);
      if (!sourceOrderLocked?.id || String(sourceOrderLocked.doc_prefix ?? '').toUpperCase() !== 'FTF') {
        throw new HttpError(404, 'Fatura de fornecedor de origem não encontrada');
      }
      const alreadyCreditedLocked = await sumDebitNotesForSource(linkedDocNumber, tenantId);
      const remainingLocked = Math.max(
        0,
        roundMoney(Number(sourceOrderLocked.total ?? 0) - alreadyCreditedLocked),
      );
      if (total > remainingLocked + 0.009) {
        throw new HttpError(
          409,
          `Valor da nota de débito excede o saldo da fatura (${remainingLocked.toFixed(2)} MT)`,
        );
      }
    }

    if (prefix === 'NC' && linkedDocNumber) {
      const sourceOrderLocked = await findOrderByDocumentNumber(linkedDocNumber, tenantId);
      if (!sourceOrderLocked?.id || String(sourceOrderLocked.doc_prefix ?? '').toUpperCase() !== 'FT') {
        throw new HttpError(404, 'Fatura de cliente de origem não encontrada');
      }
      const alreadyCreditedLocked = await sumCreditNotesForSource(linkedDocNumber, tenantId);
      const remainingLocked = Math.max(
        0,
        roundMoney(Number(sourceOrderLocked.total ?? 0) - alreadyCreditedLocked),
      );
      if (total > remainingLocked + 0.009) {
        throw new HttpError(
          409,
          `Valor da nota de crédito excede o saldo da fatura (${remainingLocked.toFixed(2)} MT)`,
        );
      }
    }

    const nextSequenceRow = await getNextOrderSequence(prefix, year, tenantId);
    usedSequence = Number(nextSequenceRow?.next ?? 1);
    const padSize = prefix === 'FP' || prefix === 'VD' || prefix === 'TK' ? 4 : 5;
    documentNumber = `${prefix}/${year}/${String(usedSequence).padStart(padSize, '0')}`;
    orderId = crypto.randomUUID();

    const effectivePaymentMethod =
      paymentMethod ||
      (paid && (prefix === 'VD' || prefix === 'TK' || prefix === 'RC' || prefix === 'RCA' || prefix === 'AD')
        ? 'Dinheiro'
        : paid && (prefix === 'PAG' || prefix === 'PAAD')
          ? 'Transferência'
          : prefix === 'FT' || prefix === 'FTF' || prefix === 'EN/ST' || prefix === 'PUR'
            ? 'Conta corrente'
            : paymentMethod);

    await insertOrder([
      orderId,
      customerId,
      userId,
      userName,
      total,
      subtotal,
      tax,
      discount,
      effectivePaymentMethod,
      status,
      documentType,
      prefix,
      year,
      usedSequence,
      documentNumber,
      documentDate,
      now,
      tenantId,
      // Doc. externo (ex.: nº da fatura do fornecedor na compra)
      String(payload.externalDocument ?? payload.external_document ?? '').trim() || null,
    ]);

    const notes = String(payload.notes ?? '').trim() || null;
    const isWaste = Boolean(payload.isWaste ?? payload.is_waste);
    if (notes || isWaste) {
      await updateOrderNotes(orderId, notes, isWaste, now, tenantId);
    }

    for (const rawItem of items) {
      const quantity = Number(rawItem?.quantity ?? 0);
      if (!Number.isFinite(quantity) || quantity <= 0) continue;
      const unitPrice = Number(rawItem?.unitPrice ?? rawItem?.price ?? 0);
      const discountAmount = Number(rawItem?.discountAmount ?? 0);
      const productId = rawItem?.productId != null ? String(rawItem.productId) : null;

      const lotCode =
        rawItem?.lotCode ?? rawItem?.lot_code ?? rawItem?.lote ?? null;
      let lineUnitCost = null;
      let lineCogsTotal = null;

      if (stockSign !== 0 && productId && warehouseId) {
        const productRow = await getProductForSync(productId, tenantId);
        const isService = Number(productRow?.is_service ?? 0) !== 0;
        if (!isService) {
          const deltaResult = await applyWarehouseDelta({
            tenantId,
            warehouseId,
            productId,
            delta: stockSign * quantity,
            movementType: resolveMovementType(prefix, stockSign),
            referenceId: `${prefix}:${documentNumber}`,
            // Entrada: unitPrice = custo da camada. Saída: NUNCA passar preço de venda.
            cost: stockSign > 0 && Number.isFinite(unitPrice) ? unitPrice : null,
            lotCode: stockSign > 0 ? lotCode : null,
            allowNegative: allowNegativeStock || stockSign > 0,
          });
          if (stockSign < 0 && deltaResult) {
            lineUnitCost = Number(deltaResult.unitCostFifo ?? 0) || 0;
            lineCogsTotal = Number(deltaResult.cogsTotal ?? 0) || 0;
          }
          touchedProductIds.add(String(productId));
        }
      }

      await insertOrderItem([
        crypto.randomUUID(),
        orderId,
        tenantId,
        productId,
        String(rawItem?.name ?? 'Item'),
        quantity,
        Number.isFinite(unitPrice) ? unitPrice : 0,
        Number.isFinite(discountAmount) ? discountAmount : 0,
        now,
        now,
        lineUnitCost,
        lineCogsTotal,
      ]);
    }

    if (CLIENT_CREDIT_PREFIXES.has(prefix) && customerId && total > 0) {
      await insertPartyCredit([
        createPartyCreditId(),
        tenantId,
        customerId,
        'customer',
        total,
        total,
        orderId,
        documentNumber,
        prefix,
        null,
        now,
        now,
      ]);
    }

    if (SUPPLIER_CREDIT_PREFIXES.has(prefix) && customerId && total > 0) {
      await insertPartyCredit([
        createPartyCreditId(),
        tenantId,
        customerId,
        'supplier',
        total,
        total,
        orderId,
        documentNumber,
        prefix,
        null,
        now,
        now,
      ]);
    }

    // Ligar/liquidar documento origem via «Documento externo»
    if (linkedDocNumber && (prefix === 'PAG' || prefix === 'RC' || prefix === 'NC' || prefix === 'ND')) {
      await updateOrderSourceReference(
        orderId,
        prefix === 'PAG' || prefix === 'ND' ? 'FTF' : 'FT',
        linkedDocNumber,
        now,
        tenantId
      );
      if (prefix === 'RC' || prefix === 'PAG') {
        const linkedOrder = await findOrderByDocumentNumber(linkedDocNumber, tenantId);
        if (linkedOrder?.id) {
          try {
            await updateOrderDocumentPayment(
              String(linkedOrder.id),
              {
                paymentMethod: effectivePaymentMethod,
                status: 'completed',
                approvedDocType: prefix,
                approvedDocumentNumber: documentNumber,
                updatedAt: now,
              },
              tenantId
            );
          } catch (linkErr) {
            logWarn('documentos_link_source_failed', {
              module: 'documentos',
              reason: 'Falha ao liquidar documento origem',
              tenant_id: tenantId,
              order_id: linkedOrder.id,
              document_number: documentNumber,
              error: linkErr,
            });
          }
        }
      }
    }

    await commitTransaction();
  } catch (error) {
    try {
      await rollbackTransaction();
    } catch {}
    if (error instanceof HttpError) throw error;
    logError('documentos_post_failed', {
      module: 'documentos',
      action: 'postDocumento',
      reason: 'Falha não tratada ao gravar documento',
      tenant_id: tenantId,
      error,
    });
    throw new HttpError(500, error?.message || 'Falha ao salvar documento');
  }

  if (stockSign !== 0 && touchedProductIds.size > 0) {
    for (const localProductId of touchedProductIds) {
      try {
        const productRow = await getProductForSync(localProductId, tenantId);
        if (!productRow?.id || !productRow?.cloud_id) continue;
        await enqueueSync('product', {
          ...productRow,
          id: Number(productRow.id),
          category_id: productRow.category_id != null ? Number(productRow.category_id) : null,
          cost: Number(productRow.cost ?? 0),
          price: Number(productRow.price ?? 0),
          tax: Number(productRow.tax ?? 0),
          final_price: Number(productRow.final_price ?? productRow.price ?? 0),
          stock_quantity: Number(productRow.stock_quantity ?? 0),
          min_stock: Number(productRow.min_stock ?? 0),
          active: Number(productRow.active ?? 1) !== 0,
          is_service: Number(productRow.is_service ?? 0) !== 0,
          default_quantity: Number(productRow.default_quantity ?? 1) !== 0,
          deleted: Number(productRow.deleted ?? 0),
          tenant_id: productRow.tenant_id ? String(productRow.tenant_id) : tenantId,
          updated_at: now,
        });
      } catch (queueErr) {
        logWarn('documentos_product_sync_enqueue_failed', {
          module: 'documentos',
          reason: 'Falha ao enfileirar sync de produto tocado pelo documento',
          tenant_id: tenantId,
          local_product_id: localProductId,
          error: queueErr,
        });
      }
    }
  }

  return {
    success: true,
    id: orderId,
    documentNumber,
    sequence: usedSequence,
    year,
    prefix,
    status,
    customerName: customerName ?? 'Consumidor final',
    userName: userName ?? '-',
  };
}

const MONTH_LABELS = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

function isCancelledDocument(doc) {
  const status = String(doc?.status ?? '').trim().toLowerCase();
  return (
    status === 'cancelled' ||
    status === 'cancelado' ||
    status === 'canceled' ||
    status === 'anulado' ||
    status === 'void'
  );
}

function isSaleDocument(doc) {
  const code = resolveDocCode(doc);
  return code === 'VD' || code === 'TK' || code === 'FT';
}

function isReturnDocument(doc) {
  return resolveDocCode(doc) === 'NC';
}

/** Notas de crédito (NC) e vendas anuladas/canceladas contam como devoluções no dashboard. */
function isDashboardReturnDocument(doc) {
  if (isReturnDocument(doc)) {
    return !isCancelledDocument(doc);
  }
  return isCancelledDocument(doc) && isSaleDocument(doc);
}

function sumDashboardReturnAmount(doc) {
  return Math.abs(Number(doc?.total ?? 0));
}

function isCreditSaleDocument(doc) {
  if (isCancelledDocument(doc) || !isSaleDocument(doc)) return false;
  if (isPendingContaCorrenteFt(doc)) return true;
  const payment = String(doc?.payment_method ?? '')
    .toLowerCase()
    .replace(/-/g, ' ')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  return (
    payment.includes('conta corrente') ||
    payment.includes('credito') ||
    payment.includes('a prazo')
  );
}

function docInMonthYear(doc, monthIndex, year) {
  const date = new Date(doc?.created_at ?? '');
  if (Number.isNaN(date.getTime())) return false;
  return date.getFullYear() === year && date.getMonth() === monthIndex;
}

function docInYear(doc, year) {
  const date = new Date(doc?.created_at ?? '');
  if (Number.isNaN(date.getTime())) return false;
  return date.getFullYear() === year;
}

function aggregatePaymentTypes(docs) {
  const map = {};
  for (const doc of docs ?? []) {
    if (isCancelledDocument(doc)) continue;
    const label = formatPaymentMethodLabel(doc?.payment_method, 'Outro');
    const amount = Math.abs(Number(doc?.total ?? 0));
    if (amount <= 0) continue;
    map[label] = (map[label] || 0) + amount;
  }
  const entries = Object.entries(map)
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value);
  const grandTotal = entries.reduce((acc, row) => acc + row.value, 0);
  return entries.map((row) => ({
    ...row,
    percent: grandTotal > 0 ? Math.round((row.value / grandTotal) * 100) : 0,
  }));
}

function aggregateEmployeeSales(docs) {
  const map = {};
  for (const doc of docs ?? []) {
    if (isCancelledDocument(doc) || !isSaleDocument(doc)) continue;
    const amount = Number(doc?.total ?? 0);
    if (amount <= 0) continue;
    const name = String(doc?.user_name ?? '').trim() || 'Sem operador';
    map[name] = (map[name] || 0) + amount;
  }
  return Object.entries(map)
    .map(([name, total]) => ({ name, total }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 5);
}

function formatLocalDateOnly(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseLocalDateParts(isoDate) {
  const match = String(isoDate ?? '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
}

function parseDocDateOnly(doc) {
  return formatLocalDateOnly(new Date(doc?.created_at ?? ''));
}

function docInRange(doc, fromDate, toDate) {
  const only = parseDocDateOnly(doc);
  if (!only) return false;
  return only >= fromDate && only <= toDate;
}

function formatPeriodLabel(from, to) {
  if (from === to) {
    const [y, m, d] = from.split('-');
    return `${d}/${m}/${y}`;
  }
  const fmt = (iso) => {
    const [y, m, d] = iso.split('-');
    return `${d}/${m}/${y}`;
  };
  return `${fmt(from)} – ${fmt(to)}`;
}

function resolveDashboardPeriod(query = {}) {
  const preset = String(query.period ?? 'month').trim().toLowerCase();
  const now = new Date();
  const today = formatLocalDateOnly(now) ?? now.toISOString().slice(0, 10);

  if (preset === 'custom') {
    const from = parseDateOnly(query.from) || today;
    const toRaw = parseDateOnly(query.to) || from;
    const to = toRaw >= from ? toRaw : from;
    return {
      preset: 'custom',
      from,
      to,
      label: formatPeriodLabel(from, to),
    };
  }

  if (preset === 'today') {
    return { preset, from: today, to: today, label: 'Hoje' };
  }

  if (preset === 'yesterday') {
    const y = new Date(now);
    y.setDate(y.getDate() - 1);
    const day = formatLocalDateOnly(y) ?? today;
    return { preset, from: day, to: day, label: 'Ontem' };
  }

  if (preset === 'week') {
    const start = new Date(now);
    start.setDate(start.getDate() - 6);
    return {
      preset,
      from: formatLocalDateOnly(start) ?? today,
      to: today,
      label: 'Últimos 7 dias',
    };
  }

  if (preset === 'year') {
    const year = now.getFullYear();
    return {
      preset,
      from: `${year}-01-01`,
      to: `${year}-12-31`,
      label: `Ano ${year}`,
    };
  }

  if (preset === 'month') {
    const fromParsed = parseDateOnly(query.from);
    if (fromParsed) {
      const [yearStr, monthStr] = fromParsed.split('-');
      const year = Number(yearStr);
      const monthIndex = Number(monthStr) - 1;
      if (Number.isFinite(year) && monthIndex >= 0 && monthIndex <= 11) {
        const from = `${yearStr}-${monthStr}-01`;
        const lastDay = new Date(year, monthIndex + 1, 0).getDate();
        const to = `${yearStr}-${monthStr}-${String(lastDay).padStart(2, '0')}`;
        const nowYear = now.getFullYear();
        const nowMonth = now.getMonth();
        const isCurrentMonth = year === nowYear && monthIndex === nowMonth;
        const label = isCurrentMonth
          ? (MONTH_LABELS[monthIndex] ?? 'Mês actual')
          : `${MONTH_LABELS[monthIndex] ?? monthStr} ${year}`;
        return { preset: 'month', from, to, label };
      }
    }
  }

  const year = now.getFullYear();
  const month = now.getMonth();
  const from = `${year}-${String(month + 1).padStart(2, '0')}-01`;
  const lastDay = new Date(year, month + 1, 0).getDate();
  const to = `${year}-${String(month + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  return {
    preset: 'month',
    from,
    to,
    label: MONTH_LABELS[month] ?? 'Mês actual',
  };
}

function buildDashboardChartSeries(from, to, cashDocs, saleDocs) {
  const fromParts = parseLocalDateParts(from);
  const toParts = parseLocalDateParts(to);
  if (!fromParts || !toParts) {
    return [];
  }

  const fromDate = new Date(fromParts.year, fromParts.month - 1, fromParts.day);
  const toDate = new Date(toParts.year, toParts.month - 1, toParts.day);
  if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) {
    return [];
  }

  const dayMs = 86400000;
  const spanDays = Math.floor((toDate.getTime() - fromDate.getTime()) / dayMs) + 1;

  const addToBucket = (bucketMap, key, label, doc, field) => {
    if (!bucketMap.has(key)) {
      bucketMap.set(key, { name: label, key, sales: 0, vendas: 0 });
    }
    const row = bucketMap.get(key);
    row[field] += Number(doc?.total ?? 0);
  };

  if (spanDays <= 1) {
    const bucketMap = new Map();
    for (let hour = 0; hour < 24; hour += 1) {
      const key = String(hour).padStart(2, '0');
      bucketMap.set(key, { name: `${key}h`, key, sales: 0, vendas: 0 });
    }
    for (const doc of cashDocs ?? []) {
      const date = new Date(doc?.created_at ?? '');
      if (Number.isNaN(date.getTime())) continue;
      const key = String(date.getHours()).padStart(2, '0');
      addToBucket(bucketMap, key, `${key}h`, doc, 'sales');
    }
    for (const doc of saleDocs ?? []) {
      if (isCancelledDocument(doc)) continue;
      const date = new Date(doc?.created_at ?? '');
      if (Number.isNaN(date.getTime())) continue;
      const key = String(date.getHours()).padStart(2, '0');
      addToBucket(bucketMap, key, `${key}h`, doc, 'vendas');
    }
    return Array.from(bucketMap.values());
  }

  if (spanDays <= 62) {
    const bucketMap = new Map();
    const cursorStart = new Date(fromDate);
    while (cursorStart <= toDate) {
      const key = formatLocalDateOnly(cursorStart);
      if (!key) break;
      const label = `${String(cursorStart.getDate()).padStart(2, '0')}/${String(cursorStart.getMonth() + 1).padStart(2, '0')}`;
      bucketMap.set(key, { name: label, key, sales: 0, vendas: 0 });
      cursorStart.setDate(cursorStart.getDate() + 1);
    }
    for (const doc of cashDocs ?? []) {
      const key = parseDocDateOnly(doc);
      if (!key || !bucketMap.has(key)) continue;
      addToBucket(bucketMap, key, bucketMap.get(key).name, doc, 'sales');
    }
    for (const doc of saleDocs ?? []) {
      if (isCancelledDocument(doc)) continue;
      const key = parseDocDateOnly(doc);
      if (!key || !bucketMap.has(key)) continue;
      addToBucket(bucketMap, key, bucketMap.get(key).name, doc, 'vendas');
    }
    return Array.from(bucketMap.values());
  }

  const bucketMap = new Map();
  let cursor = new Date(fromDate.getFullYear(), fromDate.getMonth(), 1);
  const endMonth = new Date(toDate.getFullYear(), toDate.getMonth(), 1);
  while (cursor <= endMonth) {
    const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`;
    bucketMap.set(key, {
      name: MONTH_LABELS[cursor.getMonth()] ?? key,
      key,
      sales: 0,
      vendas: 0,
    });
    cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
  }

  for (const doc of cashDocs ?? []) {
    const date = new Date(doc?.created_at ?? '');
    if (Number.isNaN(date.getTime())) continue;
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    if (!bucketMap.has(key)) continue;
    addToBucket(bucketMap, key, bucketMap.get(key).name, doc, 'sales');
  }
  for (const doc of saleDocs ?? []) {
    if (isCancelledDocument(doc)) continue;
    const date = new Date(doc?.created_at ?? '');
    if (Number.isNaN(date.getTime())) continue;
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    if (!bucketMap.has(key)) continue;
    addToBucket(bucketMap, key, bucketMap.get(key).name, doc, 'vendas');
  }
  return Array.from(bucketMap.values());
}

export async function getDashboardSummary(query = {}, user = null) {
  const tenantId = resolveTenantIdStrict(user?.tenant_id);
  const range = resolveDashboardPeriod(query);
  const yearFromQuery = Number(query.year);
  const targetYear = Number.isFinite(yearFromQuery)
    ? yearFromQuery
    : Number(range.from.slice(0, 4)) || new Date().getFullYear();
  const cacheKey = `${tenantId}:${range.from}:${range.to}:${range.preset}:dash-v6`;
  const forceRefresh = String(query.refresh ?? '').toLowerCase() === 'true';

  if (!forceRefresh) {
    const cached = dashboardSummaryCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.payload;
    }
  }

  const orderRows = await listDashboardOrderRows(tenantId);
  const saleRows = await listDashboardSaleRows(tenantId);
  const documents = [...(orderRows ?? []), ...(saleRows ?? [])];
  const cashInflowDocs = filterCashInflowDocuments(documents, 'all');

  const rangeCashDocs = cashInflowDocs.filter((doc) => docInRange(doc, range.from, range.to));
  const rangeAllDocs = documents.filter((doc) => docInRange(doc, range.from, range.to));
  const rangeSaleDocs = rangeAllDocs.filter((doc) => isSaleDocument(doc) && !isCancelledDocument(doc));
  const rangeReturnDocs = rangeAllDocs.filter((doc) => isDashboardReturnDocument(doc));

  const yearCashDocs = cashInflowDocs.filter((doc) => docInYear(doc, targetYear));
  const monthlySalesData = MONTH_LABELS.map((name) => ({ name, sales: 0, vendas: 0 }));
  for (const doc of yearCashDocs) {
    const date = new Date(doc?.created_at ?? '');
    if (Number.isNaN(date.getTime())) continue;
    monthlySalesData[date.getMonth()].sales += Number(doc?.total ?? 0);
  }
  const yearAllDocs = documents.filter((doc) => docInYear(doc, targetYear));
  for (const doc of yearAllDocs) {
    if (isCancelledDocument(doc) || !isSaleDocument(doc)) continue;
    const date = new Date(doc?.created_at ?? '');
    if (Number.isNaN(date.getTime())) continue;
    monthlySalesData[date.getMonth()].vendas += Number(doc?.total ?? 0);
  }

  const chartData = buildDashboardChartSeries(
    range.from,
    range.to,
    rangeCashDocs,
    rangeSaleDocs,
  );

  const totalSales = yearCashDocs.reduce((acc, doc) => acc + Number(doc?.total ?? 0), 0);
  let bestMonth = '---';
  let bestMonthValue = 0;
  for (const month of monthlySalesData) {
    if (month.sales > bestMonthValue) {
      bestMonth = month.name;
      bestMonthValue = month.sales;
    }
  }

  const period = {
    preset: range.preset,
    from: range.from,
    to: range.to,
    monthLabel: range.label,
    totalVendas: rangeSaleDocs.reduce((acc, doc) => acc + Number(doc?.total ?? 0), 0),
    totalCaixa: rangeCashDocs.reduce((acc, doc) => acc + Number(doc?.total ?? 0), 0),
    creditSales: rangeSaleDocs
      .filter(isCreditSaleDocument)
      .reduce((acc, doc) => acc + Number(doc?.total ?? 0), 0),
    returns: rangeReturnDocs.reduce((acc, doc) => acc + sumDashboardReturnAmount(doc), 0),
  };

  const validOrderIds = new Set();
  for (const doc of rangeSaleDocs) {
    const id = String(doc?.id ?? '').trim();
    if (!id) continue;
    validOrderIds.add(id);
    if (id.startsWith('venda:')) validOrderIds.add(id.slice('venda:'.length));
  }
  const itemRows = await listDashboardOrderItems(tenantId);
  const productMap = {};
  for (const item of itemRows ?? []) {
    const orderId = String(item?.order_id ?? '').trim();
    if (!orderId || !validOrderIds.has(orderId)) continue;
    const productName = String(item?.product_name ?? '').trim() || 'Sem nome';
    const qty = Number(item?.quantity ?? 0);
    const price = Number(item?.price ?? 0);
    if (!Number.isFinite(qty) || qty <= 0) continue;
    if (!productMap[productName]) {
      productMap[productName] = { sales: 0, price };
    }
    productMap[productName].sales += qty;
  }

  const topProducts = Object.entries(productMap)
    .map(([name, data]) => ({ name, sales: data.sales, price: data.price }))
    .sort((a, b) => b.sales - a.sales)
    .slice(0, 5);

  const customerRows = await listDashboardCustomers(tenantId);
  const customerMapById = new Map();
  const customerMapByCloudId = new Map();
  for (const row of customerRows ?? []) {
    const id = row?.id != null ? String(row.id) : '';
    const cloudId = row?.cloud_id != null ? String(row.cloud_id) : '';
    const name = String(row?.name ?? '').trim();
    if (id && name) customerMapById.set(id, name);
    if (cloudId && name) customerMapByCloudId.set(cloudId, name);
  }

  const customerTotals = {};
  for (const doc of rangeSaleDocs) {
    const customerId = doc?.customer_id != null ? String(doc.customer_id) : '';
    const fallbackName = String(doc?.client_name ?? '').trim();
    const customerName =
      customerMapById.get(customerId) ||
      customerMapByCloudId.get(customerId) ||
      fallbackName ||
      'Consumidor final';
    customerTotals[customerName] = (customerTotals[customerName] || 0) + Number(doc?.total ?? 0);
  }

  const topCustomers = Object.entries(customerTotals)
    .map(([name, total]) => ({ name, total }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 5);

  const topEmployees = aggregateEmployeeSales(rangeSaleDocs);
  const paymentTypes = aggregatePaymentTypes(rangeSaleDocs);

  const payloadResult = {
    year: targetYear,
    totalSales,
    monthlySalesData: chartData.length > 0 ? chartData : monthlySalesData,
    chartGranularity: chartData.length > 0 ? range.preset : 'year',
    bestMonth,
    bestMonthValue,
    period,
    topProducts,
    topCustomers,
    topEmployees,
    paymentTypes,
    topGroups: [],
  };

  dashboardSummaryCache.set(cacheKey, {
    payload: payloadResult,
    expiresAt: Date.now() + DASHBOARD_SUMMARY_CACHE_TTL_MS,
  });

  return payloadResult;
}

export async function getNextVd(user = null) {
  const tenantId = resolveTenantIdStrict(user?.tenant_id);
  const row = await getNextVdSequence(tenantId);
  return { next: Number(row?.next ?? 1) };
}

function parseDocumentNumberParts(documentNumber) {
  const match = String(documentNumber ?? '')
    .trim()
    .toUpperCase()
    .match(/^([A-Z]+)\/(\d{4})\/(\d+)$/);
  if (!match) return null;
  return {
    prefix: match[1],
    year: Number(match[2]),
    sequence: Number(match[3]),
  };
}

function formatGeneratedDocumentNumber(prefix, year, sequence) {
  const padSize = prefix === 'FP' || prefix === 'VD' ? 4 : 5;
  return `${prefix}/${year}/${String(sequence).padStart(padSize, '0')}`;
}

function resolvePayableDocumentKind(row, sourceType) {
  const docType = String(row?.doc_type ?? '').trim().toUpperCase();
  const docPrefix =
    sourceType === 'order'
      ? String(row?.doc_prefix ?? '').trim().toUpperCase()
      : docType;
  const number = String(row?.document_number ?? '').trim().toUpperCase();
  const parts = parseDocumentNumberParts(number);

  // 1) Número do documento (fonte mais fiável) — FTF antes de FT.
  if (number.startsWith('FTF/') || parts?.prefix === 'FTF') return 'FTF';
  if (number.startsWith('FP/') || parts?.prefix === 'FP') return 'FP';
  if (number.startsWith('FT/') || parts?.prefix === 'FT') return 'FT';

  // 2) Prefixo / tipo gravados na BD
  if (
    docPrefix === 'FTF' ||
    docType === 'FTF' ||
    docType === 'COMPRA' ||
    docType.includes('FORNECEDOR') ||
    docType.includes('COMPRA')
  ) {
    return 'FTF';
  }
  if (docPrefix === 'FP' || docType === 'FP' || docType.includes('PROFORMA') || docType.includes('COTAC')) {
    return 'FP';
  }
  if (docPrefix === 'FT' || docType === 'FT' || docType === 'FATURA') {
    return 'FT';
  }

  // 3) Fallback: conta corrente só para FT de cliente (nunca FTF).
  if (
    String(row?.payment_method ?? '')
      .toLowerCase()
      .includes('conta corrente')
  ) {
    return 'FT';
  }
  return null;
}

function roundMoney(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function isDocumentAlreadyPaid(row, { remainingTotal = null } = {}) {
  if (remainingTotal != null && Number.isFinite(Number(remainingTotal))) {
    return Number(remainingTotal) <= 0.009;
  }
  const status = String(row?.status ?? '').trim().toLowerCase();
  if (status === 'completed' || status === 'approved' || status === 'pago') return true;
  if (String(row?.approved_document_number ?? '').trim()) return true;
  return false;
}

async function loadPayableDocument(documentNumber, tenantId) {
  const normalized = String(documentNumber ?? '').trim();
  let order = await findOrderByDocumentNumber(normalized, tenantId);
  let sale = null;

  if (!order) {
    sale = await findVendaByDocumentNumber(normalized, tenantId);
  }
  if (!order && !sale) {
    const parts = parseDocumentNumberParts(normalized);
    if (parts) {
      order = await findOrderByDocumentParts(parts.prefix, parts.year, parts.sequence, tenantId);
    }
  }
  if (!order && !sale) return null;

  const sourceType = order ? 'order' : 'sale';
  const sourceRow = order ?? sale;
  const payableKind = resolvePayableDocumentKind(sourceRow, sourceType);
  return { sourceType, sourceRow, payableKind };
}

export async function previewDocumentPayment(query = {}, user = null) {
  const tenantId = resolveTenantIdStrict(user?.tenant_id);
  const documentNumber = String(query.documentNumber ?? '').trim();
  if (!documentNumber) throw new HttpError(400, 'documentNumber obrigatorio');

  const loaded = await loadPayableDocument(documentNumber, tenantId);
  if (!loaded) throw new HttpError(404, 'documento nao encontrado');
  if (!loaded.payableKind) {
    throw new HttpError(
      400,
      'apenas faturas (FT), faturas de fornecedor (FTF) ou cotacoes (FP) podem ser pagas por este ecran',
    );
  }

  let creditedTotal = 0;
  let receiptTotal = 0;
  const originalTotal = Number(loaded.sourceRow.total ?? 0);
  const sourceNumber = String(loaded.sourceRow.document_number ?? documentNumber).trim();

  if (loaded.payableKind === 'FTF') {
    creditedTotal = await sumDebitNotesForSource(sourceNumber, tenantId);
  }
  if (loaded.payableKind === 'FT') {
    receiptTotal = await sumReceiptsForSource(sourceNumber, tenantId);
  }

  const payableTotal = Math.max(
    0,
    roundMoney(originalTotal - (loaded.payableKind === 'FTF' ? creditedTotal : receiptTotal)),
  );
  const alreadyPaid =
    loaded.payableKind === 'FT'
      ? isDocumentAlreadyPaid(loaded.sourceRow, { remainingTotal: payableTotal })
      : isDocumentAlreadyPaid(loaded.sourceRow) || payableTotal <= 0.009;
  const generatedDocumentType =
    loaded.payableKind === 'FP' ? 'VD' : loaded.payableKind === 'FTF' ? 'PAG' : 'RC';
  const generatedDocumentLabel =
    generatedDocumentType === 'VD'
      ? 'Venda a dinheiro (VD)'
      : generatedDocumentType === 'PAG'
        ? 'Pagamento a fornecedor (PAG)'
        : 'Recibo (RC)';
  const resolvedDocumentNumber = sourceNumber;
  const partyLabel =
    loaded.payableKind === 'FTF'
      ? String(loaded.sourceRow.client_name ?? 'Fornecedor')
      : String(loaded.sourceRow.client_name ?? 'Consumidor final');

  return {
    documentNumber: resolvedDocumentNumber,
    clientName: partyLabel,
    total: payableTotal,
    originalTotal,
    creditNoteTotal: creditedTotal,
    receiptTotal,
    payableKind: loaded.payableKind,
    generatedDocumentType,
    generatedDocumentLabel,
    alreadyPaid,
    canPay: !alreadyPaid && payableTotal > 0.009,
    allowPartialPayment: loaded.payableKind === 'FT',
  };
}

async function loadPayableDocumentDetails(sourceType, sourceRow, tenantId) {
  if (sourceType === 'order') {
    const order = await getOrderPaymentContext(sourceRow.id, tenantId);
    if (!order?.id) throw new HttpError(404, 'documento nao encontrado');
    const items = await listOrderItemsByDocumentId(order.id, tenantId);
    const originalTotal = Number(order.total ?? 0);
    const docNumber = String(order.document_number ?? '').trim();
    const isSupplierInvoice = docNumber.toUpperCase().startsWith('FTF/');
    const isCustomerInvoice =
      docNumber.toUpperCase().startsWith('FT/') && !docNumber.toUpperCase().startsWith('FTF/');
    const creditedTotal = isSupplierInvoice ? await sumDebitNotesForSource(docNumber, tenantId) : 0;
    const receiptTotal = isCustomerInvoice ? await sumReceiptsForSource(docNumber, tenantId) : 0;
    const remainingTotal = Math.max(
      0,
      roundMoney(originalTotal - (isSupplierInvoice ? creditedTotal : receiptTotal)),
    );
    const remainingRatio = originalTotal > 0 ? remainingTotal / originalTotal : 0;
    return {
      sourceDocumentNumber: String(order.document_number ?? sourceRow.document_number ?? '').trim(),
      customerId: order.customer_id == null ? null : String(order.customer_id),
      customerName: String(order.client_name ?? 'Consumidor final'),
      userId: order.user_id == null ? null : String(order.user_id),
      userName: order.user_name == null ? null : String(order.user_name),
      total: remainingTotal,
      originalTotal,
      receiptTotal,
      creditNoteTotal: creditedTotal,
      subtotal: Number(order.subtotal ?? originalTotal) * remainingRatio,
      tax: Number(order.tax ?? 0) * remainingRatio,
      discount: Number(order.discount ?? 0),
      items: items ?? [],
    };
  }

  const sale = await getVendaPaymentContext(sourceRow.id, tenantId);
  if (!sale?.id) throw new HttpError(404, 'documento nao encontrado');
  const items = await listOrderItemsByDocumentId(String(sale.id), tenantId);
  const saleDocNumber = String(sale.document_number ?? sourceRow.document_number ?? '').trim();
  const isCustomerInvoice =
    saleDocNumber.toUpperCase().startsWith('FT/') && !saleDocNumber.toUpperCase().startsWith('FTF/');
  const originalTotal = Number(sale.total ?? 0);
  const receiptTotal = isCustomerInvoice ? await sumReceiptsForSource(saleDocNumber, tenantId) : 0;
  const remainingTotal = Math.max(0, roundMoney(originalTotal - receiptTotal));
  return {
    sourceDocumentNumber: saleDocNumber,
    customerId: sale.customer_id == null ? null : String(sale.customer_id),
    customerName: String(sale.client_name ?? sale.customer_name ?? 'Consumidor final'),
    userId: sale.user_id == null ? null : String(sale.user_id),
    userName: sale.user_name == null ? null : String(sale.user_name),
    total: remainingTotal,
    originalTotal,
    receiptTotal,
    creditNoteTotal: 0,
    subtotal: remainingTotal,
    tax: 0,
    discount: 0,
    items: items ?? [],
  };
}

async function copyDocumentItemsToTarget(targetDocumentId, items, tenantId, now) {
  for (const rawItem of items ?? []) {
    const quantity = Number(rawItem?.quantity ?? 0);
    if (!Number.isFinite(quantity) || quantity <= 0) continue;
    const unitPrice = Number(rawItem?.price ?? 0);
    const discountAmount = Number(rawItem?.discount_amount ?? 0);
    await insertOrderItem([
      crypto.randomUUID(),
      String(targetDocumentId),
      tenantId,
      rawItem?.product_id != null ? String(rawItem.product_id) : null,
      String(rawItem?.product_name ?? 'Item'),
      quantity,
      Number.isFinite(unitPrice) ? unitPrice : 0,
      Number.isFinite(discountAmount) ? discountAmount : 0,
      now,
      now,
    ]);
  }
}

async function createReceiptDocument({
  sourceDocumentNumber,
  sourceDocType,
  generatedDocumentNumber,
  paymentMethod,
  details,
  tenantId,
  now,
}) {
  const parts = parseDocumentNumberParts(generatedDocumentNumber);
  const year = parts?.year ?? new Date().getFullYear();
  const sequence = parts?.sequence ?? 1;
  const orderId = crypto.randomUUID();

  await insertOrder([
    orderId,
    details.customerId,
    details.userId,
    details.userName,
    details.total,
    details.subtotal,
    details.tax,
    details.discount,
    paymentMethod,
    'completed',
    'Recibo',
    'RC',
    year,
    sequence,
    generatedDocumentNumber,
    now,
    now,
    tenantId,
  ]);

  await updateOrderSourceReference(orderId, sourceDocType, sourceDocumentNumber, now, tenantId);
  await copyDocumentItemsToTarget(orderId, details.items, tenantId, now);
  return orderId;
}

async function createSupplierPaymentDocument({
  sourceDocumentNumber,
  sourceDocType,
  generatedDocumentNumber,
  paymentMethod,
  details,
  tenantId,
  now,
}) {
  const parts = parseDocumentNumberParts(generatedDocumentNumber);
  const year = parts?.year ?? new Date().getFullYear();
  const sequence = parts?.sequence ?? 1;
  const orderId = crypto.randomUUID();

  await insertOrder([
    orderId,
    details.customerId,
    details.userId,
    details.userName,
    details.total,
    details.subtotal,
    details.tax,
    details.discount,
    paymentMethod,
    'completed',
    'Pagamento',
    'PAG',
    year,
    sequence,
    generatedDocumentNumber,
    now,
    now,
    tenantId,
  ]);

  await updateOrderSourceReference(orderId, sourceDocType, sourceDocumentNumber, now, tenantId);
  await copyDocumentItemsToTarget(orderId, details.items, tenantId, now);
  return orderId;
}

async function createVendaDocument({
  sourceDocumentNumber,
  sourceDocType,
  generatedDocumentNumber,
  paymentMethod,
  details,
  tenantId,
  now,
  warehouseId = null,
  applyStock = true,
}) {
  const parts = parseDocumentNumberParts(generatedDocumentNumber);
  const sequence = parts?.sequence ?? 1;
  const insertResult = await insertVendaRecord([
    details.total,
    now,
    'VD',
    sequence,
    'completed',
    details.customerId,
    details.customerName,
    paymentMethod,
    details.userId,
    details.userName,
    sourceDocType,
    sourceDocumentNumber,
    tenantId,
  ]);
  const saleId = Number(insertResult?.lastID ?? 0);
  if (!Number.isFinite(saleId) || saleId <= 0) {
    throw new HttpError(500, 'falha ao criar venda a dinheiro');
  }
  await copyDocumentItemsToTarget(String(saleId), details.items, tenantId, now);

  if (applyStock && Array.isArray(details.items) && details.items.length > 0) {
    const resolvedWarehouseId =
      warehouseId ||
      (await resolveWarehouseId({
        tenantId,
        explicitWarehouseId: null,
      }));
    for (const item of details.items) {
      const productId = item?.product_id ?? item?.productId;
      const quantity = Number(item?.quantity ?? 0);
      if (!productId || !Number.isFinite(quantity) || quantity <= 0) continue;
      const productRow = await getProductForSync(productId, tenantId);
      if (Number(productRow?.is_service ?? 0) !== 0) continue;
      await applyWarehouseDelta({
        tenantId,
        warehouseId: resolvedWarehouseId,
        productId,
        delta: -quantity,
        movementType: 'sale',
        referenceId: `VD:${generatedDocumentNumber}`,
        allowNegative: false,
      });
    }
  }

  return saleId;
}

export async function registerDocumentPayment(payload = {}, user = null) {
  const tenantId = resolveTenantIdStrict(user?.tenant_id);
  assertTenantWrite(tenantId, payload?.tenant_id ?? payload?.tenantId);
  const documentNumber = String(payload.documentNumber ?? '').trim();
  const paymentMethod = formatPaymentMethodLabel(
    String(payload.paymentMethod ?? '').trim(),
    String(payload.paymentMethod ?? '').trim(),
  );
  const requestedKind = String(payload.payableKind ?? payload.documentKind ?? '')
    .trim()
    .toUpperCase();
  if (!documentNumber) throw new HttpError(400, 'documentNumber obrigatorio');
  if (!paymentMethod) throw new HttpError(400, 'paymentMethod obrigatorio');

  const loaded = await loadPayableDocument(documentNumber, tenantId);
  if (!loaded) throw new HttpError(404, 'documento nao encontrado');

  const { sourceType, sourceRow } = loaded;
  let payableKind = loaded.payableKind;

  // O ecran de Documentos pode indicar o tipo esperado (FTF → PAG).
  if (requestedKind === 'FTF' || requestedKind === 'FT' || requestedKind === 'FP') {
    const number = String(sourceRow?.document_number ?? documentNumber).trim().toUpperCase();
    if (requestedKind === 'FTF' && (number.startsWith('FTF/') || String(sourceRow?.doc_prefix ?? '').toUpperCase() === 'FTF')) {
      payableKind = 'FTF';
    } else if (requestedKind === 'FP' && (number.startsWith('FP/') || String(sourceRow?.doc_prefix ?? '').toUpperCase() === 'FP')) {
      payableKind = 'FP';
    } else if (requestedKind === 'FT' && number.startsWith('FT/') && !number.startsWith('FTF/')) {
      payableKind = 'FT';
    } else if (requestedKind === 'FTF') {
      // Pedido explícito de pagamento a fornecedor com número FTF / Compra
      const docType = String(sourceRow?.doc_type ?? '').trim().toUpperCase();
      if (docType === 'COMPRA' || docType.includes('FORNECEDOR') || number.startsWith('FTF/')) {
        payableKind = 'FTF';
      }
    }
  }

  if (!payableKind) {
    throw new HttpError(
      400,
      'apenas faturas (FT), faturas de fornecedor (FTF) ou cotacoes (FP) podem ser pagas por este ecran',
    );
  }

  const now = new Date().toISOString();
  const year = new Date().getFullYear();
  const generatedDocumentType =
    payableKind === 'FP' ? 'VD' : payableKind === 'FTF' ? 'PAG' : 'RC';
  let generatedDocumentNumber = '';
  const details = await loadPayableDocumentDetails(sourceType, sourceRow, tenantId);
  const sourceDocumentNumber = String(details.sourceDocumentNumber || documentNumber).trim();
  const sourceDocType =
    payableKind === 'FP' ? 'FP' : payableKind === 'FTF' ? 'FTF' : 'FT';

  const remainingTotal = Math.max(0, roundMoney(Number(details.total ?? 0)));
  if (payableKind === 'FT') {
    if (isDocumentAlreadyPaid(sourceRow, { remainingTotal })) {
      throw new HttpError(409, 'documento ja se encontra pago');
    }
  } else if (isDocumentAlreadyPaid(sourceRow) || remainingTotal <= 0.009) {
    throw new HttpError(409, 'documento ja se encontra pago');
  }

  const requestedAmountRaw = payload.amount ?? payload.paymentAmount ?? payload.valor;
  let paymentAmount = remainingTotal;
  if (requestedAmountRaw != null && String(requestedAmountRaw).trim() !== '') {
    paymentAmount = roundMoney(Number(requestedAmountRaw));
  }
  if (!Number.isFinite(paymentAmount) || paymentAmount <= 0) {
    throw new HttpError(400, 'valor do pagamento invalido');
  }
  // Pré-validação rápida (fora da TX). A validação autoritativa corre dentro do BEGIN IMMEDIATE.
  if (paymentAmount > remainingTotal + 0.009) {
    throw new HttpError(
      409,
      `valor do pagamento excede o saldo em divida (${remainingTotal.toFixed(2)} MT)`,
    );
  }
  // FTF e FP continuam a liquidar o valor restante de uma vez.
  if (payableKind !== 'FT' && paymentAmount < remainingTotal - 0.009) {
    throw new HttpError(400, 'pagamento parcial so e permitido em faturas de cliente (FT)');
  }

  let settledRemainingTotal = remainingTotal;
  let paymentDetails = null;

  try {
    await beginImmediateTransaction();

    // Re-ler saldo sob lock exclusivo (BEGIN IMMEDIATE) para impedir dois RC
    // parciais concorrentes a ultrapassar o total da FT.
    const freshDetails = await loadPayableDocumentDetails(sourceType, sourceRow, tenantId);
    settledRemainingTotal = Math.max(0, roundMoney(Number(freshDetails.total ?? 0)));
    if (payableKind === 'FT') {
      if (isDocumentAlreadyPaid(sourceRow, { remainingTotal: settledRemainingTotal })) {
        throw new HttpError(409, 'documento ja se encontra pago');
      }
    } else if (isDocumentAlreadyPaid(sourceRow) || settledRemainingTotal <= 0.009) {
      throw new HttpError(409, 'documento ja se encontra pago');
    }
    if (paymentAmount > settledRemainingTotal + 0.009) {
      throw new HttpError(
        409,
        `valor do pagamento excede o saldo em divida (${settledRemainingTotal.toFixed(2)} MT)`,
      );
    }
    if (payableKind !== 'FT' && paymentAmount < settledRemainingTotal - 0.009) {
      throw new HttpError(400, 'pagamento parcial so e permitido em faturas de cliente (FT)');
    }

    const paymentRatio = settledRemainingTotal > 0 ? paymentAmount / settledRemainingTotal : 1;
    paymentDetails = {
      ...freshDetails,
      total: paymentAmount,
      subtotal: roundMoney(Number(freshDetails.subtotal ?? 0) * paymentRatio),
      tax: roundMoney(Number(freshDetails.tax ?? 0) * paymentRatio),
      items:
        payableKind === 'FT' && paymentAmount < settledRemainingTotal - 0.009
          ? [
              {
                product_id: null,
                product_name: `Pagamento parcial de ${sourceDocumentNumber}`,
                quantity: 1,
                price: paymentAmount,
                discount_amount: 0,
              },
            ]
          : freshDetails.items,
    };

    if (payableKind === 'FP') {
      const nextVd = await getNextVdSequence(tenantId);
      const sequence = Number(nextVd?.next ?? 1);
      generatedDocumentNumber = formatGeneratedDocumentNumber('VD', year, sequence);
      await createVendaDocument({
        sourceDocumentNumber,
        sourceDocType,
        generatedDocumentNumber,
        paymentMethod,
        details: paymentDetails,
        tenantId,
        now,
      });
    } else if (payableKind === 'FTF') {
      const nextPag = await getNextOrderSequence('PAG', year, tenantId);
      const sequence = Number(nextPag?.next ?? 1);
      generatedDocumentNumber = formatGeneratedDocumentNumber('PAG', year, sequence);
      await createSupplierPaymentDocument({
        sourceDocumentNumber,
        sourceDocType,
        generatedDocumentNumber,
        paymentMethod,
        details: paymentDetails,
        tenantId,
        now,
      });
    } else {
      const nextRc = await getNextOrderSequence('RC', year, tenantId);
      const sequence = Number(nextRc?.next ?? 1);
      generatedDocumentNumber = formatGeneratedDocumentNumber('RC', year, sequence);
      await createReceiptDocument({
        sourceDocumentNumber,
        sourceDocType,
        generatedDocumentNumber,
        paymentMethod,
        details: paymentDetails,
        tenantId,
        now,
      });
    }

    const remainingAfter = Math.max(0, roundMoney(settledRemainingTotal - paymentAmount));
    const fullySettled = remainingAfter <= 0.009;
    const sourcePaymentStatus =
      payableKind === 'FP' ? 'approved' : fullySettled || payableKind !== 'FT' ? 'completed' : 'pending';

    if (sourceType === 'order') {
      const result = await updateOrderDocumentPayment(
        String(sourceRow.id),
        {
          paymentMethod,
          status: sourcePaymentStatus,
          approvedDocType: generatedDocumentType,
          approvedDocumentNumber: generatedDocumentNumber,
          updatedAt: now,
        },
        tenantId
      );
      if (Number(result?.changes ?? 0) === 0) throw new HttpError(404, 'documento nao encontrado');
    } else {
      const result = await updateVendaDocumentPayment(
        Number(sourceRow.id),
        {
          paymentMethod,
          status: sourcePaymentStatus,
          approvedDocType: generatedDocumentType,
          approvedDocumentNumber: generatedDocumentNumber,
        },
        tenantId
      );
      if (Number(result?.changes ?? 0) === 0) throw new HttpError(404, 'documento nao encontrado');
    }

    await commitTransaction();
  } catch (error) {
    await rollbackTransaction();
    throw error;
  }

  return {
    success: true,
    sourceType,
    sourceId: sourceType === 'order' ? String(sourceRow.id) : String(sourceRow.id),
    sourceDocumentNumber,
    payableKind,
    generatedDocumentType,
    generatedDocumentNumber,
    paymentMethod,
    paymentAmount,
    remainingTotal: Math.max(0, roundMoney(settledRemainingTotal - paymentAmount)),
    fullySettled: Math.max(0, roundMoney(settledRemainingTotal - paymentAmount)) <= 0.009,
    status:
      payableKind === 'FP'
        ? 'approved'
        : Math.max(0, roundMoney(settledRemainingTotal - paymentAmount)) <= 0.009 || payableKind !== 'FT'
          ? 'completed'
          : 'pending',
  };
}

function isCancelledStatus(status) {
  const s = String(status ?? '').trim().toLowerCase();
  return s === 'cancelled' || s === 'canceled' || s === 'void' || s === 'anulado';
}

function isVdDocument({ docPrefix, docType, documentNumber }) {
  const prefix = String(docPrefix ?? '').trim().toUpperCase();
  if (prefix === 'VD') return true;
  const type = String(docType ?? '').trim().toUpperCase();
  if (type === 'VD') return true;
  const number = String(documentNumber ?? '').trim().toUpperCase();
  return number.startsWith('VD/');
}

/**
 * Anula uma Venda a Dinheiro (VD): marca cancelled e devolve stock.
 */
export async function anularVendaDinheiro(idRaw, payload = {}, user = null) {
  const tenantId = resolveTenantIdStrict(user?.tenant_id);
  assertTenantWrite(tenantId, payload?.tenant_id ?? payload?.tenantId);
  const rawId = String(idRaw ?? '').trim();
  if (!rawId) throw new HttpError(400, 'id invalido');

  const now = new Date().toISOString();
  let sourceType = 'order';
  let documentId = rawId;
  let saleId = null;
  let documentNumber = '';
  let currentStatus = '';
  let docPrefix = '';
  let docType = '';

  if (rawId.toLowerCase().startsWith('venda:')) {
    sourceType = 'venda';
    saleId = Number(rawId.slice(6));
    if (!Number.isFinite(saleId) || saleId <= 0) throw new HttpError(400, 'id de venda invalido');
    const venda = await getVendaPaymentContext(saleId, tenantId);
    if (!venda?.id) throw new HttpError(404, 'venda a dinheiro nao encontrada');
    documentId = String(venda.id);
    documentNumber = String(venda.document_number ?? '').trim();
    currentStatus = String(venda.status ?? '');
    docType = String(venda.doc_type ?? 'VD');
    docPrefix = 'VD';
  } else {
    const order = await findOrderById(rawId, tenantId);
    if (!order?.id) throw new HttpError(404, 'documento nao encontrado');
    documentId = String(order.id);
    documentNumber = String(order.document_number ?? '').trim();
    currentStatus = String(order.status ?? '');
    docPrefix = String(order.doc_prefix ?? '');
    docType = String(order.doc_type ?? '');
  }

  if (!isVdDocument({ docPrefix, docType, documentNumber })) {
    throw new HttpError(400, 'apenas documentos VD (venda a dinheiro) podem ser anulados aqui');
  }
  if (isCancelledStatus(currentStatus)) {
    throw new HttpError(409, 'esta venda a dinheiro ja esta anulada');
  }

  const items = await listOrderItemsByDocumentId(documentId, tenantId);
  const warehouseId = await resolveWarehouseId({
    tenantId,
    explicitWarehouseId: payload.warehouseId ?? payload.warehouse_id ?? null,
  });

  try {
    await beginImmediateTransaction();

    if (sourceType === 'venda') {
      const result = await updateVendaStatus(saleId, 'cancelled', tenantId);
      if (Number(result?.changes ?? 0) === 0) {
        throw new HttpError(404, 'venda a dinheiro nao encontrada');
      }
    } else {
      const result = await updateOrderPaymentStatus(documentId, 'cancelled', now, tenantId);
      if (Number(result?.changes ?? 0) === 0) {
        throw new HttpError(404, 'documento nao encontrado');
      }
    }

    for (const item of items ?? []) {
      const productId = item?.product_id != null ? String(item.product_id) : null;
      const quantity = Number(item?.quantity ?? 0);
      if (!productId || !Number.isFinite(quantity) || quantity <= 0) continue;
      const productRow = await getProductForSync(productId, tenantId);
      if (Number(productRow?.is_service ?? 0) !== 0) continue;
      await applyWarehouseDelta({
        tenantId,
        warehouseId,
        productId,
        delta: quantity,
        movementType: 'restock',
        referenceId: `VD-VOID:${documentNumber || documentId}`,
        allowNegative: true,
      });
    }

    await commitTransaction();
  } catch (error) {
    try {
      await rollbackTransaction();
    } catch {
      // ignore rollback errors
    }
    throw error;
  }

  await logAudit('VD_ANULAR', user, {
    entity: 'document',
    entity_id: sourceType === 'venda' ? `venda:${saleId}` : documentId,
    description: `VD ${documentNumber || documentId} anulada`,
    document_number: documentNumber,
  });

  return {
    success: true,
    id: sourceType === 'venda' ? `venda:${saleId}` : documentId,
    documentNumber,
    status: 'cancelled',
    stockRestored: true,
  };
}
