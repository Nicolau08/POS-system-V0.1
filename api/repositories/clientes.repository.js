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

export function insertCliente({ name, phone, email, address, cloudId, tenantId, updatedAt, syncVersion, originNodeId }) {
  return run(
    `INSERT INTO clientes (name, phone, email, address, cloud_id, tenant_id, updated_at, deleted_at, sync_version, origin_node_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
    [name, phone, email, address, cloudId, tenantId, updatedAt, syncVersion, originNodeId]
  );
}

export function findClienteCloudIdByIdAndTenant(id, tenantId) {
  return get(
    `SELECT cloud_id, deleted_at, sync_version
     FROM clientes
     WHERE id = ?
       AND tenant_id = ?
       AND deleted_at IS NULL`,
    [id, tenantId]
  );
}

export function updateClienteByIdAndTenant({
  id,
  name,
  phone,
  email,
  address,
  cloudId,
  tenantId,
  updatedAt,
  syncVersion,
  originNodeId,
}) {
  return run(
    `UPDATE clientes
     SET name = ?, phone = ?, email = ?, address = ?, cloud_id = ?, tenant_id = ?, deleted_at = NULL,
         updated_at = ?, sync_version = ?, origin_node_id = ?
     WHERE id = ?
       AND tenant_id = ?
       AND deleted_at IS NULL`,
    [name, phone, email, address, cloudId, tenantId, updatedAt, syncVersion, originNodeId, id, tenantId]
  );
}

export function deleteClienteByIdAndTenant({ id, tenantId, deletedAt, syncVersion, originNodeId }) {
  return run(
    `UPDATE clientes
     SET deleted_at = ?, updated_at = ?, sync_version = ?, origin_node_id = ?
     WHERE id = ?
       AND tenant_id = ?
       AND deleted_at IS NULL`,
    [deletedAt, deletedAt, syncVersion, originNodeId, id, tenantId]
  );
}
