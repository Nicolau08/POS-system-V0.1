import { isUuidString, uuidv4 } from '../cloudIdUtils.js';
import { enqueueSync } from '../syncQueue.js';
import { parsePagination, parseSearchTerm, withPaginationPayload } from './queryOptions.service.js';
import { HttpError } from '../utils/response.js';
import { assertTenantWrite, requireTenantId } from '../utils/tenant.js';
import {
  countClienteLinkedDocuments,
  countClientes,
  deleteClienteByIdAndTenant,
  findClienteByIdAndTenant,
  findClienteCloudIdByIdAndTenant,
  insertCliente,
  listClientes,
  listClientesPaginated,
  updateClienteByIdAndTenant,
} from '../repositories/clientes.repository.js';

async function resolveTenantId(tenantCandidate) {
  return requireTenantId(tenantCandidate, {
    status: 401,
    message: 'tenant_id ausente para operacao de clientes',
  });
}

export async function listAllClientes(query = {}, user = null) {
  const tenantId = await resolveTenantId(user?.tenant_id);
  const pagination = parsePagination(query);
  const search = parseSearchTerm(query.search);
  const where = [];
  const params = [];

  where.push(`c.tenant_id = ?`);
  params.push(tenantId);

  if (search) {
    const token = `%${search}%`;
    where.push(`(
      LOWER(COALESCE(c.name, '')) LIKE LOWER(?)
      OR LOWER(COALESCE(c.phone, '')) LIKE LOWER(?)
      OR LOWER(COALESCE(c.email, '')) LIKE LOWER(?)
    )`);
    params.push(token, token, token);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const normalizeCliente = (row) => ({
    ...row,
    id: row?.id != null ? String(row.id) : '',
    cloud_id: row?.cloud_id != null ? String(row.cloud_id) : null,
    name: String(row?.name ?? ''),
    phone: String(row?.phone ?? ''),
    email: row?.email != null ? String(row.email) : null,
    address: row?.address != null ? String(row.address) : null,
    debt_balance: Number(row?.debt_balance ?? 0) || 0,
  });

  if (!pagination.hasPagination) {
    const rows = await listClientes(whereSql, params);
    return (rows ?? []).map(normalizeCliente);
  }

  const rows = await listClientesPaginated(whereSql, params, pagination.limit, pagination.offset);
  const total = await countClientes(whereSql, params);
  return withPaginationPayload((rows ?? []).map(normalizeCliente), {
    page: pagination.page,
    limit: pagination.limit,
    total,
  });
}

export async function createCliente(payload = {}, user = null) {
  const name = payload.name;
  const phone = payload.phone;
  const email = payload.email ?? null;
  const address = payload.address ?? null;

  if (!name || !phone) {
    throw new HttpError(400, 'name e phone sao obrigatorios');
  }

  const tenantId = await resolveTenantId(user?.tenant_id);
  assertTenantWrite(tenantId, payload?.tenant_id ?? payload?.tenantId);
  const customerCloudId =
    payload?.cloud_id && isUuidString(String(payload.cloud_id)) ? String(payload.cloud_id).trim() : uuidv4();

  const insertResult = await insertCliente({
    name,
    phone,
    email,
    address,
    cloudId: customerCloudId,
    tenantId,
  });

  const insertedId = insertResult.lastID;
  const queuePayload = {
    id: insertedId,
    cloud_id: customerCloudId,
    name,
    phone,
    email,
    address,
    tenant_id: tenantId,
  };

  try {
    await enqueueSync('customer', queuePayload);
    return { success: true, id: insertedId };
  } catch (queueErr) {
    return {
      success: true,
      id: insertedId,
      syncQueued: false,
      syncError: queueErr.message,
    };
  }
}

export async function updateCliente(idRaw, payload = {}, user = null) {
  const id = idRaw;
  const name = payload.name;
  const phone = payload.phone;
  const email = payload.email ?? null;
  const address = payload.address ?? null;

  if (!name || !phone) {
    throw new HttpError(400, 'name e phone sao obrigatorios');
  }

  const tenantId = await resolveTenantId(user?.tenant_id);
  assertTenantWrite(tenantId, payload?.tenant_id ?? payload?.tenantId);
  const existing = await findClienteCloudIdByIdAndTenant(id, tenantId);
  const customerCloudId =
    existing?.cloud_id && isUuidString(String(existing.cloud_id)) ? String(existing.cloud_id).trim() : uuidv4();

  const updateResult = await updateClienteByIdAndTenant({
    id,
    name,
    phone,
    email,
    address,
    cloudId: customerCloudId,
    tenantId,
  });

  const updated = updateResult.changes > 0;
  if (!updated) return { success: true, updated: false };

  try {
    await enqueueSync('customer', {
      id: Number(id),
      cloud_id: customerCloudId,
      name,
      phone,
      email,
      address,
      tenant_id: tenantId,
    });
    return { success: true, updated: true };
  } catch (queueErr) {
    return {
      success: true,
      updated: true,
      syncQueued: false,
      syncError: queueErr.message,
    };
  }
}

export async function removeCliente(idRaw, user = null) {
  const id = idRaw;
  const tenantId = await resolveTenantId(user?.tenant_id);
  const cliente = await findClienteByIdAndTenant(id, tenantId);
  if (!cliente?.id) {
    return { success: true, deleted: false };
  }

  const customerCloudId =
    cliente.cloud_id && isUuidString(String(cliente.cloud_id)) ? String(cliente.cloud_id).trim() : null;

  const links = await countClienteLinkedDocuments(cliente.id, customerCloudId, tenantId);
  if (links.total > 0 || links.debt > 0) {
    const parts = [];
    if (links.debt > 0) parts.push(`${links.debt} dívida(s) pendente(s)`);
    if (links.vendas > 0) parts.push(`${links.vendas} venda(s)`);
    if (links.orders > 0) parts.push(`${links.orders} documento(s)`);
    throw new HttpError(
      409,
      `Não é possível apagar este cliente porque tem documentos ou dívida associados (${parts.join(', ')}).`,
      'CUSTOMER_HAS_LINKED_DOCUMENTS',
    );
  }

  const deleteResult = await deleteClienteByIdAndTenant(id, tenantId);
  const deleted = deleteResult.changes > 0;
  if (!deleted) return { success: true, deleted: false };

  try {
    await enqueueSync('customer', {
      id: Number(id),
      cloud_id: customerCloudId,
      deleted: true,
      tenant_id: tenantId,
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
