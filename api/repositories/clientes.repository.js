import { all, get, run } from '../dbUtils.js';

export function listClientes(whereSql, params) {
  return all(
    `SELECT id, cloud_id, name, phone, email, address
     FROM clientes
     ${whereSql}
     ORDER BY name ASC`,
    params
  );
}

export function listClientesPaginated(whereSql, params, limit, offset) {
  return all(
    `SELECT id, cloud_id, name, phone, email, address
     FROM clientes
     ${whereSql}
     ORDER BY name ASC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
}

export async function countClientes(whereSql, params) {
  const row = await get(`SELECT COUNT(*) AS total FROM clientes ${whereSql}`, params);
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
