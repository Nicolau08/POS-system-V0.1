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

const SUPPLIER_DOC_PREFIXES = new Set(['FTF', 'PUR', 'EN/ST', 'PAG', 'ND', 'PAAD']);
const CUSTOMER_DOC_PREFIXES = new Set(['FT', 'VD', 'TK', 'RC', 'NC', 'FP', 'AD', 'RCA']);

/**
 * Agrupa as entidades pelos identificadores realmente usados nos documentos
 * (orders.customer_id guarda o id local, vendas.customer_id guarda o cloud_id).
 */
function collectParties(rows, roleResolver) {
  const byKey = new Map();

  for (const row of rows ?? []) {
    const role = roleResolver(row);
    if (!role) continue;

    const docCustomerId = String(row?.doc_customer_id ?? '').trim();
    const localId = String(row?.local_id ?? '').trim();
    const cloudId = String(row?.cloud_id ?? '').trim();
    const name = String(row?.name ?? '').trim();
    if (!docCustomerId && !localId) continue;

    const key = `${role}:${localId || docCustomerId}`;
    const existing = byKey.get(key) ?? {
      id: localId || docCustomerId,
      name: name || 'Sem nome',
      role,
      ids: new Set(),
    };
    if (name && existing.name === 'Sem nome') existing.name = name;
    if (docCustomerId) existing.ids.add(docCustomerId);
    if (localId) existing.ids.add(localId);
    if (cloudId) existing.ids.add(cloudId);
    byKey.set(key, existing);
  }

  return Array.from(byKey.values())
    .map((party) => ({
      id: party.id,
      name: party.name,
      role: party.role,
      ids: Array.from(party.ids),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'pt'));
}

export async function getReportFilters(actorUser = null) {
  const tenantId = await resolveTenantId(actorUser);

  const [customers, paymentRows, orderPartyRows, salePartyRows] = await Promise.all([
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
    allDb(
      `SELECT
         UPPER(TRIM(COALESCE(o.doc_prefix, ''))) AS prefix,
         CAST(o.customer_id AS TEXT) AS doc_customer_id,
         CAST(c.id AS TEXT) AS local_id,
         TRIM(COALESCE(c.cloud_id, '')) AS cloud_id,
         COALESCE(c.name, '') AS name
       FROM orders o
       LEFT JOIN clientes c
         ON c.tenant_id = o.tenant_id
        AND (
          CAST(c.id AS TEXT) = CAST(o.customer_id AS TEXT)
          OR CAST(COALESCE(c.cloud_id, '') AS TEXT) = CAST(o.customer_id AS TEXT)
        )
       WHERE o.tenant_id = ?
         AND o.customer_id IS NOT NULL
         AND TRIM(CAST(o.customer_id AS TEXT)) <> ''`,
      [tenantId]
    ),
    allDb(
      `SELECT
         CAST(v.customer_id AS TEXT) AS doc_customer_id,
         CAST(c.id AS TEXT) AS local_id,
         TRIM(COALESCE(c.cloud_id, '')) AS cloud_id,
         COALESCE(c.name, v.customer_name, '') AS name
       FROM vendas v
       LEFT JOIN clientes c
         ON c.tenant_id = v.tenant_id
        AND (
          CAST(COALESCE(c.cloud_id, '') AS TEXT) = CAST(v.customer_id AS TEXT)
          OR CAST(c.id AS TEXT) = CAST(v.customer_id AS TEXT)
        )
       WHERE v.tenant_id = ?
         AND v.customer_id IS NOT NULL
         AND TRIM(CAST(v.customer_id AS TEXT)) <> ''`,
      [tenantId]
    ),
  ]);

  const suppliers = collectParties(orderPartyRows, (row) =>
    SUPPLIER_DOC_PREFIXES.has(String(row?.prefix ?? '')) ? 'supplier' : null
  );
  const statementCustomers = collectParties(
    [
      ...(orderPartyRows ?? []).filter((row) => CUSTOMER_DOC_PREFIXES.has(String(row?.prefix ?? ''))),
      ...(salePartyRows ?? []).map((row) => ({ ...row, prefix: 'VD' })),
    ],
    () => 'customer'
  );

  return {
    customers: (customers ?? []).map((row) => ({
      id: String(row?.id ?? ''),
      name: String(row?.name ?? ''),
    })),
    statementCustomers,
    suppliers,
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
