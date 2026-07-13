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
  updateOrderApproval,
  updateOrderDocumentPayment,
  updateOrderPaymentStatus,
  updateVendaApproval,
  updateVendaDocumentPayment,
  findOrderByDocumentNumber,
  findOrderByDocumentParts,
  findVendaByDocumentNumber,
  getOrderPaymentContext,
  getVendaPaymentContext,
  insertVendaRecord,
  listOrderItemsByDocumentId,
  updateOrderSourceReference,
} from '../repositories/documentos.repository.js';

import { filterCashInflowDocuments } from '../utils/revenueDocuments.js';

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
  const orderedSql = `SELECT id, doc_type, document_number, payment_method, status, approved_document_type, approved_document_number, discount, subtotal, tax, total, created_at, customer_id, local_sale_id, user_name, client_name ${docsBaseSql}${whereSql} ORDER BY datetime(created_at) DESC, id DESC`;

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
  const total = Number(payload.total ?? 0);
  const customerId = payload.customerId == null ? null : String(payload.customerId).trim() || null;
  const customerName = payload.customerName == null ? null : String(payload.customerName).trim() || null;
  const userId = payload.userId == null ? null : String(payload.userId).trim() || null;
  const userName = payload.userName == null ? null : String(payload.userName).trim() || null;
  const paymentMethod = payload.paymentMethod == null ? null : String(payload.paymentMethod).trim() || null;
  const paid = Boolean(payload.paid);
  const items = Array.isArray(payload.items) ? payload.items : [];
  const status = paid ? 'completed' : 'pending';

  if (!prefix) throw new HttpError(400, 'prefix obrigatorio');
  const normalizedDocType = String(documentType).trim().toLowerCase();
  const shouldIncreaseStock =
    prefix === 'WH/IN' ||
    prefix === 'EN/ST' ||
    prefix === 'PUR' ||
    normalizedDocType === 'entrada de stock' ||
    normalizedDocType === 'entrada de armazem' ||
    normalizedDocType === 'entrada de armazém' ||
    normalizedDocType === 'compra';

  const dateObj = new Date(documentDate);
  const year = Number.isNaN(dateObj.getTime()) ? new Date().getFullYear() : dateObj.getFullYear();

  let orderId = null;
  let documentNumber = null;
  let usedSequence = 1;
  const touchedProductIds = new Set();

  try {
    await beginImmediateTransaction();
    const nextSequenceRow = await getNextOrderSequence(prefix, year, tenantId);
    usedSequence = Number(nextSequenceRow?.next ?? 1);
    const padSize = prefix === 'FP' ? 4 : 5;
    documentNumber = `${prefix}/${year}/${String(usedSequence).padStart(padSize, '0')}`;
    orderId = crypto.randomUUID();

    await insertOrder([
      orderId,
      customerId,
      userId,
      userName,
      total,
      total,
      0,
      discount,
      paymentMethod,
      status,
      documentType,
      prefix,
      year,
      usedSequence,
      documentNumber,
      documentDate,
      now,
      tenantId,
    ]);

    for (const rawItem of items) {
      const quantity = Number(rawItem?.quantity ?? 0);
      if (!Number.isFinite(quantity) || quantity <= 0) continue;
      const unitPrice = Number(rawItem?.unitPrice ?? rawItem?.price ?? 0);
      const discountAmount = Number(rawItem?.discountAmount ?? 0);
      const productId = rawItem?.productId != null ? String(rawItem.productId) : null;

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
      ]);

      if (shouldIncreaseStock && productId) {
        const productRow = await getProductForSync(productId, tenantId);
        const isService = Number(productRow?.is_service ?? 0) !== 0;
        // Serviço / sem controlo de stock: mantém o documento, não altera quantidade.
        if (!isService) {
          await increaseProductStock([
            quantity,
            Number.isFinite(unitPrice) ? unitPrice : 0,
            now,
            productId,
            tenantId,
          ]);
          touchedProductIds.add(String(productId));
          await insertStockMovement([
            crypto.randomUUID(),
            tenantId,
            Number(productId),
            'restock',
            quantity,
            `${prefix}:${documentNumber}`,
            now,
            now,
          ]);
        }
      }
    }

    await commitTransaction();
  } catch (error) {
    try {
      await rollbackTransaction();
    } catch {}
    throw new HttpError(500, 'Falha ao salvar documento');
  }

  if (shouldIncreaseStock && touchedProductIds.size > 0) {
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
        console.warn('[documentos] falha ao enfileirar sync de produto', {
          localProductId,
          error: queueErr?.message,
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

export async function getDashboardSummary(query = {}, user = null) {
  const tenantId = resolveTenantIdStrict(user?.tenant_id);
  const yearFromQuery = Number(query.year);
  const targetYear = Number.isFinite(yearFromQuery) ? yearFromQuery : new Date().getFullYear();
  const cacheKey = `${tenantId}:${targetYear}:cash-v2`;
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
  const currentYearDocs = cashInflowDocs.filter((doc) => {
    const date = new Date(doc?.created_at ?? '');
    return !Number.isNaN(date.getTime()) && date.getFullYear() === targetYear;
  });

  const monthNow = new Date().getMonth();
  const currentMonthDocs = currentYearDocs.filter((doc) => {
    const date = new Date(doc?.created_at ?? '');
    return !Number.isNaN(date.getTime()) && date.getMonth() === monthNow;
  });

  const monthlySalesData = Array.from({ length: 12 }, (_, i) => ({
    name: ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'][i],
    sales: 0,
  }));

  for (const doc of currentYearDocs) {
    const date = new Date(doc?.created_at ?? '');
    if (Number.isNaN(date.getTime())) continue;
    monthlySalesData[date.getMonth()].sales += Number(doc?.total ?? 0);
  }

  const totalSales = currentYearDocs.reduce((acc, doc) => acc + Number(doc?.total ?? 0), 0);
  let bestMonth = '---';
  let bestMonthValue = 0;
  for (const month of monthlySalesData) {
    if (month.sales > bestMonthValue) {
      bestMonth = month.name;
      bestMonthValue = month.sales;
    }
  }

  const validOrderIds = new Set(currentMonthDocs.map((doc) => String(doc?.id ?? '')));
  for (const doc of currentMonthDocs) {
    const id = String(doc?.id ?? '');
    if (id.startsWith('venda:')) validOrderIds.add(id.slice('venda:'.length));
  }
  const itemRows = await listDashboardOrderItems(tenantId);
  const productMap = {};
  for (const item of itemRows ?? []) {
    const orderId = String(item?.order_id ?? '');
    if (!orderId || !validOrderIds.has(orderId)) continue;
    const productName = String(item?.product_name ?? '').trim() || 'Sem nome';
    const qty = Number(item?.quantity ?? 0);
    const price = Number(item?.price ?? 0);
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
  for (const doc of currentMonthDocs) {
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

  const payloadResult = {
    year: targetYear,
    totalSales,
    monthlySalesData,
    bestMonth,
    bestMonthValue,
    topProducts,
    topCustomers,
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

  if (docPrefix === 'FP' || docType === 'FP' || docType.includes('PROFORMA') || parts?.prefix === 'FP') {
    return 'FP';
  }
  if (
    docPrefix === 'FT' ||
    docType === 'FT' ||
    docType === 'FATURA' ||
    parts?.prefix === 'FT' ||
    String(row?.payment_method ?? '')
      .toLowerCase()
      .includes('conta corrente')
  ) {
    return 'FT';
  }
  return null;
}

function isDocumentAlreadyPaid(row) {
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
    throw new HttpError(400, 'apenas faturas (FT) ou cotacoes (FP) podem ser pagas por este ecran');
  }

  const alreadyPaid = isDocumentAlreadyPaid(loaded.sourceRow);
  const generatedDocumentType = loaded.payableKind === 'FP' ? 'VD' : 'RC';
  const resolvedDocumentNumber = String(loaded.sourceRow.document_number ?? documentNumber).trim();

  return {
    documentNumber: resolvedDocumentNumber,
    clientName: String(loaded.sourceRow.client_name ?? 'Consumidor final'),
    total: Number(loaded.sourceRow.total ?? 0),
    payableKind: loaded.payableKind,
    generatedDocumentType,
    generatedDocumentLabel: generatedDocumentType === 'VD' ? 'Venda a dinheiro (VD)' : 'Recibo (RC)',
    alreadyPaid,
    canPay: !alreadyPaid,
  };
}

async function loadPayableDocumentDetails(sourceType, sourceRow, tenantId) {
  if (sourceType === 'order') {
    const order = await getOrderPaymentContext(sourceRow.id, tenantId);
    if (!order?.id) throw new HttpError(404, 'documento nao encontrado');
    const items = await listOrderItemsByDocumentId(order.id, tenantId);
    return {
      sourceDocumentNumber: String(order.document_number ?? sourceRow.document_number ?? '').trim(),
      customerId: order.customer_id == null ? null : String(order.customer_id),
      customerName: String(order.client_name ?? 'Consumidor final'),
      userId: order.user_id == null ? null : String(order.user_id),
      userName: order.user_name == null ? null : String(order.user_name),
      total: Number(order.total ?? 0),
      subtotal: Number(order.subtotal ?? order.total ?? 0),
      tax: Number(order.tax ?? 0),
      discount: Number(order.discount ?? 0),
      items: items ?? [],
    };
  }

  const sale = await getVendaPaymentContext(sourceRow.id, tenantId);
  if (!sale?.id) throw new HttpError(404, 'documento nao encontrado');
  const items = await listOrderItemsByDocumentId(String(sale.id), tenantId);
  return {
    sourceDocumentNumber: String(sale.document_number ?? sourceRow.document_number ?? '').trim(),
    customerId: sale.customer_id == null ? null : String(sale.customer_id),
    customerName: String(sale.client_name ?? sale.customer_name ?? 'Consumidor final'),
    userId: sale.user_id == null ? null : String(sale.user_id),
    userName: sale.user_name == null ? null : String(sale.user_name),
    total: Number(sale.total ?? 0),
    subtotal: Number(sale.total ?? 0),
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

async function createVendaDocument({
  sourceDocumentNumber,
  sourceDocType,
  generatedDocumentNumber,
  paymentMethod,
  details,
  tenantId,
  now,
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
  return saleId;
}

export async function registerDocumentPayment(payload = {}, user = null) {
  const tenantId = resolveTenantIdStrict(user?.tenant_id);
  assertTenantWrite(tenantId, payload?.tenant_id ?? payload?.tenantId);
  const documentNumber = String(payload.documentNumber ?? '').trim();
  const paymentMethod = String(payload.paymentMethod ?? '').trim();
  if (!documentNumber) throw new HttpError(400, 'documentNumber obrigatorio');
  if (!paymentMethod) throw new HttpError(400, 'paymentMethod obrigatorio');

  const loaded = await loadPayableDocument(documentNumber, tenantId);
  if (!loaded) throw new HttpError(404, 'documento nao encontrado');

  const { sourceType, sourceRow, payableKind } = loaded;
  if (!payableKind) {
    throw new HttpError(400, 'apenas faturas (FT) ou cotacoes (FP) podem ser pagas por este ecran');
  }
  if (isDocumentAlreadyPaid(sourceRow)) {
    throw new HttpError(409, 'documento ja se encontra pago');
  }

  const now = new Date().toISOString();
  const year = new Date().getFullYear();
  const generatedDocumentType = payableKind === 'FP' ? 'VD' : 'RC';
  let generatedDocumentNumber = '';
  const details = await loadPayableDocumentDetails(sourceType, sourceRow, tenantId);
  const sourceDocumentNumber = String(details.sourceDocumentNumber || documentNumber).trim();
  const sourceDocType = payableKind === 'FP' ? 'FP' : 'FT';

  try {
    await beginImmediateTransaction();

    if (payableKind === 'FP') {
      const nextVd = await getNextVdSequence(tenantId);
      const sequence = Number(nextVd?.next ?? 1);
      generatedDocumentNumber = formatGeneratedDocumentNumber('VD', year, sequence);
      await createVendaDocument({
        sourceDocumentNumber,
        sourceDocType,
        generatedDocumentNumber,
        paymentMethod,
        details,
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
        details,
        tenantId,
        now,
      });
    }

    const sourcePaymentStatus = payableKind === 'FP' ? 'approved' : 'completed';

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
    status: payableKind === 'FP' ? 'approved' : 'completed',
  };
}
