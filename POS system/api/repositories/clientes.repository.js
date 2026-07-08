import { all, get, run } from '../dbUtils.js';

const DEBT_BALANCE_SQL = `COALESCE((
  SELECT ROUND(SUM(COALESCE(v.total, 0)), 2)
  FROM vendas v
  WHERE v.tenant_id = c.tenant_id
    AND (
      CAST(v.customer_id AS TEXT) = CAST(c.id AS TEXT)
      OR CAST(v.customer_id AS TEXT) = CAST(c.cloud_id AS TEXT)
    )
    AND LOWER(COALESCE(v.status, '')) NOT IN ('completed', 'paid', 'approved', 'aprovado', 'cancelled', 'canceled')
    AND (
      UPPER(COALESCE(v.doc_type, '')) = 'FT'
      OR LOWER(REPLACE(COALESCE(v.payment_method, ''), '-', ' ')) LIKE '%conta corrente%'
    )
), 0)`;

export function listClientes(whereSql, params) {
  return all(
    `SELECT
       c.id,
       c.cloud_id,
       c.name,
       c.phone,
       c.email,
       c.address,
       ${DEBT_BALANCE_SQL} AS debt_balance
     FROM clientes c
     ${whereSql}
     ORDER BY c.name ASC`,
    params
  );
}

export function listClientesPaginated(whereSql, params, limit, offset) {
  return all(
    `SELECT
       c.id,
       c.cloud_id,
       c.name,
       c.phone,
       c.email,
       c.address,
       ${DEBT_BALANCE_SQL} AS debt_balance
     FROM clientes c
     ${whereSql}
     ORDER BY c.name ASC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
}

export async function countClientes(whereSql, params) {
  const row = await get(`SELECT COUNT(*) AS total FROM clientes c ${whereSql}`, params);
  return Number(row?.total ?? 0);
}

export function insertCliente({ name, phone, email, address, cloudId, tenantId }) {
  return run(
    `INSERT INTO clientes (name, phone, email, address, cloud_id, tenant_id) VALUES (?, ?, ?, ?, ?, ?)`,
    [name, phone, email, address, cloudId, tenantId]
  );
}

export function findClienteCloudIdByIdAndTenant(id, tenantId) {
  return get(
    `SELECT cloud_id
     FROM clientes
     WHERE id = ?
       AND tenant_id = ?`,
    [id, tenantId]
  );
}

export function updateClienteByIdAndTenant({ id, name, phone, email, address, cloudId, tenantId }) {
  return run(
    `UPDATE clientes
     SET name = ?, phone = ?, email = ?, address = ?, cloud_id = ?, tenant_id = ?
     WHERE id = ?
       AND tenant_id = ?`,
    [name, phone, email, address, cloudId, tenantId, id, tenantId]
  );
}

export function deleteClienteByIdAndTenant(id, tenantId) {
  return run(
    `DELETE FROM clientes
     WHERE id = ?
       AND tenant_id = ?`,
    [id, tenantId]
  );
}

export function findClienteByIdAndTenant(id, tenantId) {
  return get(
    `SELECT id, cloud_id, name, phone, email, address, tenant_id
     FROM clientes
     WHERE CAST(id AS TEXT) = CAST(? AS TEXT)
       AND tenant_id = ?
     LIMIT 1`,
    [String(id), tenantId]
  );
}

/** Conta documentos/vendas/dívidas ligados ao cliente (bloqueia apagar). */
export async function countClienteLinkedDocuments(clienteId, cloudId, tenantId) {
  const ids = [String(clienteId ?? '').trim(), String(cloudId ?? '').trim()].filter(Boolean);
  if (ids.length === 0) {
    return { total: 0, vendas: 0, orders: 0, debt: 0 };
  }

  const vendaParams = [tenantId, ...ids];
  const vendaPlaceholders = ids.map(() => '?').join(', ');
  const vendaRow = await get(
    `SELECT
       COUNT(*) AS total,
       SUM(
         CASE
           WHEN LOWER(COALESCE(status, '')) NOT IN ('completed', 'paid', 'approved', 'aprovado', 'cancelled', 'canceled')
            AND (
              UPPER(COALESCE(doc_type, '')) = 'FT'
              OR LOWER(REPLACE(COALESCE(payment_method, ''), '-', ' ')) LIKE '%conta corrente%'
            )
           THEN 1 ELSE 0
         END
       ) AS debt_count
     FROM vendas
     WHERE tenant_id = ?
       AND CAST(customer_id AS TEXT) IN (${vendaPlaceholders})`,
    vendaParams
  );

  const orderParams = [tenantId, ...ids];
  const orderPlaceholders = ids.map(() => '?').join(', ');
  const orderRow = await get(
    `SELECT COUNT(*) AS total
     FROM orders
     WHERE tenant_id = ?
       AND CAST(customer_id AS TEXT) IN (${orderPlaceholders})`,
    orderParams
  );

  const vendas = Number(vendaRow?.total ?? 0) || 0;
  const orders = Number(orderRow?.total ?? 0) || 0;
  const debt = Number(vendaRow?.debt_count ?? 0) || 0;

  return {
    total: vendas + orders,
    vendas,
    orders,
    debt,
  };
}
