import db from '../database.js';
import { requireTenantId } from '../utils/tenant.js';
import { filterRevenueDocuments } from '../utils/revenueDocuments.js';
import { getDocumentos } from './documentos.service.js';

const allDb = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows ?? []);
    });
  });

async function resolveTenantId(actorUser) {
  return requireTenantId(actorUser?.tenant_id, {
    status: 401,
    message: 'tenant_id ausente para operacao de relatorios',
  });
}

export async function getReportFilters(actorUser = null) {
  const tenantId = await resolveTenantId(actorUser);

  const [customers, paymentRows] = await Promise.all([
    allDb(
      `SELECT
         COALESCE(NULLIF(TRIM(cloud_id), ''), CAST(id AS TEXT)) AS id,
         name
       FROM clientes
       WHERE tenant_id = ?
       ORDER BY name ASC`,
      [tenantId]
    ),
    allDb(
      `SELECT DISTINCT TRIM(payment_method) AS payment_method
       FROM vendas
       WHERE tenant_id = ?
         AND TRIM(COALESCE(payment_method, '')) <> ''
       ORDER BY payment_method ASC`,
      [tenantId]
    ),
  ]);

  return {
    customers: (customers ?? []).map((row) => ({
      id: String(row?.id ?? ''),
      name: String(row?.name ?? ''),
    })),
    paymentMethods: (paymentRows ?? [])
      .map((row) => String(row?.payment_method ?? '').trim())
      .filter(Boolean),
  };
}

export async function getReportCustomers(filters = {}, actorUser = null) {
  const tenantId = await resolveTenantId(actorUser);
  const search = parseSearchTerm(filters.search);
  const customerId = String(filters.customerId ?? filters.customer_id ?? '').trim();

  const where = [`tenant_id = ?`];
  const params = [tenantId];

  if (search) {
    const token = `%${search}%`;
    where.push(`(
      LOWER(COALESCE(name, '')) LIKE LOWER(?)
      OR LOWER(COALESCE(phone, '')) LIKE LOWER(?)
      OR LOWER(COALESCE(email, '')) LIKE LOWER(?)
    )`);
    params.push(token, token, token);
  }

  if (customerId) {
    where.push(`(
      COALESCE(NULLIF(TRIM(cloud_id), ''), CAST(id AS TEXT)) = ?
      OR CAST(id AS TEXT) = ?
      OR COALESCE(TRIM(cloud_id), '') = ?
    )`);
    params.push(customerId, customerId, customerId);
  }

  const rows = await allDb(
    `SELECT
       COALESCE(NULLIF(TRIM(cloud_id), ''), CAST(id AS TEXT)) AS id,
       name,
       phone,
       email,
       address,
       updated_at
     FROM clientes
     WHERE ${where.join(' AND ')}
     ORDER BY name ASC`,
    params
  );

  return (rows ?? []).map((row) => ({
    id: String(row?.id ?? ''),
    name: String(row?.name ?? ''),
    phone: row?.phone ?? '',
    email: row?.email ?? null,
    address: row?.address ?? null,
    points: 0,
    created_at: row?.updated_at ?? null,
  }));
}

export async function getReportSales(filters = {}, actorUser = null) {
  const rows = await getDocumentos(filters, actorUser);
  const docs = Array.isArray(rows) ? rows : rows?.data ?? [];
  const revenueDocs = filterRevenueDocuments(docs, filters.status ?? 'all');

  return revenueDocs.map((row) => ({
    id: String(row?.id ?? ''),
    doc_type: row?.doc_type ?? null,
    document_number: row?.document_number ?? null,
    total: Number(row?.total ?? 0),
    subtotal: Number(row?.subtotal ?? 0),
    tax: Number(row?.tax ?? 0),
    discount: Number(row?.discount ?? 0),
    payment_method: row?.payment_method ?? null,
    status: row?.status ?? null,
    created_at: row?.created_at ?? null,
    customer_id: row?.customer_id ?? null,
    table_number: null,
    customers: {
      name: row?.client_name ?? 'Consumidor final',
    },
  }));
}
