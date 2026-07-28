import crypto from 'crypto';
import { HttpError } from '../utils/response.js';
import { requireTenantId } from '../utils/tenant.js';
import { run } from '../dbUtils.js';
import {
  clearDefaultWarehouse,
  countWarehouses,
  getWarehouseById,
  getWarehouseStockSum,
  insertWarehouse,
  listWarehouses,
  setWarehouseDefault,
  updateWarehouse,
} from '../repositories/warehouses.repository.js';
import {
  ensureDefaultWarehouse,
  transferWarehouseStock,
} from './warehouseStock.service.js';
import {
  beginImmediateTransaction as beginDocTransaction,
  commitTransaction as commitDocTransaction,
  getNextOrderSequence,
  insertOrder,
  insertOrderItem,
  rollbackTransaction as rollbackDocTransaction,
} from '../repositories/documentos.repository.js';

async function beginImmediateTransaction() {
  await run('BEGIN IMMEDIATE');
}
async function commitTransaction() {
  await run('COMMIT');
}
async function rollbackTransaction() {
  await run('ROLLBACK');
}

function resolveTenantId(actorUser) {
  return requireTenantId(actorUser?.tenant_id, {
    status: 401,
    message: 'tenant_id ausente para operacao de armazéns',
  });
}

function normalizeWarehouse(row) {
  return {
    id: String(row.id),
    name: String(row.name ?? ''),
    code: row.code != null ? String(row.code) : null,
    isDefault: Boolean(row.is_default),
    isActive: Boolean(row.is_active),
    createdAt: row.created_at ?? null,
    updatedAt: row.updated_at ?? null,
  };
}

export async function listAllWarehouses(actorUser = null) {
  const tenantId = resolveTenantId(actorUser);
  await ensureDefaultWarehouse(tenantId);
  const rows = await listWarehouses(tenantId);
  return rows.map(normalizeWarehouse);
}

export async function createWarehouse(payload = {}, actorUser = null) {
  const tenantId = resolveTenantId(actorUser);
  await ensureDefaultWarehouse(tenantId);

  const name = String(payload.name ?? '').trim();
  if (!name) throw new HttpError(400, 'Nome do armazém é obrigatório');

  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const makeDefault = payload.isDefault === true || payload.is_default === true;

  try {
    if (makeDefault) {
      await beginImmediateTransaction();
      await clearDefaultWarehouse(tenantId, now);
    }

    await insertWarehouse([
      id,
      tenantId,
      name,
      String(payload.code ?? '').trim() || null,
      makeDefault ? 1 : 0,
      payload.active === false || payload.isActive === false ? 0 : 1,
      now,
      now,
    ]);

    if (makeDefault) {
      await commitTransaction();
    }
  } catch (error) {
    if (makeDefault) {
      try {
        await rollbackTransaction();
      } catch {}
    }
    if (String(error?.message || '').includes('UNIQUE')) {
      throw new HttpError(409, 'Já existe um armazém com este nome');
    }
    throw error;
  }

  const row = await getWarehouseById(id, tenantId);
  return normalizeWarehouse(row);
}

export async function updateWarehouseById(id, payload = {}, actorUser = null) {
  const tenantId = resolveTenantId(actorUser);
  const existing = await getWarehouseById(String(id), tenantId);
  if (!existing) throw new HttpError(404, 'Armazém não encontrado');

  const name = String(payload.name ?? existing.name).trim();
  if (!name) throw new HttpError(400, 'Nome do armazém é obrigatório');

  const wantsInactive =
    payload.active === false ||
    payload.isActive === false ||
    payload.is_active === false;
  const wantsActive =
    payload.active === true || payload.isActive === true || payload.is_active === true;

  let nextActive = existing.is_active ? 1 : 0;
  if (wantsInactive) nextActive = 0;
  else if (wantsActive) nextActive = 1;

  if (nextActive === 0 && Number(existing.is_default) === 1) {
    throw new HttpError(400, 'Não é possível desactivar o armazém principal. Defina outro primeiro.');
  }

  if (nextActive === 0) {
    const stockSum = await getWarehouseStockSum(String(id), tenantId);
    if (Math.abs(Number(stockSum?.total ?? 0)) > 1e-9) {
      throw new HttpError(400, 'Não é possível desactivar um armazém com stock. Transfira o stock primeiro.');
    }
  }

  const now = new Date().toISOString();
  try {
    await updateWarehouse(String(id), tenantId, [
      name,
      String(payload.code ?? existing.code ?? '').trim() || null,
      nextActive,
      now,
    ]);
  } catch (error) {
    if (String(error?.message || '').includes('UNIQUE')) {
      throw new HttpError(409, 'Já existe um armazém com este nome');
    }
    throw error;
  }

  const updated = await getWarehouseById(String(id), tenantId);
  return normalizeWarehouse(updated);
}

export async function setDefaultWarehouseById(id, actorUser = null) {
  const tenantId = resolveTenantId(actorUser);
  const existing = await getWarehouseById(String(id), tenantId);
  if (!existing) throw new HttpError(404, 'Armazém não encontrado');
  if (Number(existing.is_active) === 0) {
    throw new HttpError(400, 'Não é possível definir um armazém inactivo como principal');
  }

  const now = new Date().toISOString();
  try {
    await beginImmediateTransaction();
    await clearDefaultWarehouse(tenantId, now);
    await setWarehouseDefault(String(id), tenantId, now);
    await commitTransaction();
  } catch (error) {
    try {
      await rollbackTransaction();
    } catch {}
    throw error;
  }

  const updated = await getWarehouseById(String(id), tenantId);
  return normalizeWarehouse(updated);
}

export async function assertWarehouseActive(warehouseId, tenantId) {
  if (warehouseId == null || !String(warehouseId).trim()) return null;
  const wh = await getWarehouseById(String(warehouseId).trim(), tenantId);
  if (!wh) throw new HttpError(400, 'Armazém inválido');
  if (Number(wh.is_active) === 0) throw new HttpError(400, 'Armazém inactivo');
  return String(wh.id);
}

/**
 * Transferência entre armazéns + documento WH/TR para auditoria.
 */
export async function transferStock(payload = {}, actorUser = null) {
  const tenantId = resolveTenantId(actorUser);
  await ensureDefaultWarehouse(tenantId);

  const fromWarehouseId = await assertWarehouseActive(
    payload.fromWarehouseId ?? payload.from_warehouse_id,
    tenantId
  );
  const toWarehouseId = await assertWarehouseActive(
    payload.toWarehouseId ?? payload.to_warehouse_id,
    tenantId
  );
  if (!fromWarehouseId || !toWarehouseId) {
    throw new HttpError(400, 'Armazém de origem e destino são obrigatórios');
  }
  if (fromWarehouseId === toWarehouseId) {
    throw new HttpError(400, 'Armazém de origem e destino devem ser diferentes');
  }

  const items = Array.isArray(payload.items) ? payload.items : [];
  if (!items.length) throw new HttpError(400, 'Indique pelo menos um produto');

  const allowNegative = payload.allowNegative === true || payload.allow_negative === true;
  const now = new Date().toISOString();
  const documentDate = payload.documentDate
    ? String(payload.documentDate)
    : now;
  const dateObj = new Date(documentDate);
  const year = Number.isNaN(dateObj.getTime()) ? new Date().getFullYear() : dateObj.getFullYear();
  const prefix = 'WH/TR';

  let orderId = null;
  let documentNumber = null;
  let usedSequence = 1;

  try {
    await beginDocTransaction();
    const nextSequenceRow = await getNextOrderSequence(prefix, year, tenantId);
    usedSequence = Number(nextSequenceRow?.next ?? 1);
    documentNumber = `${prefix}/${year}/${String(usedSequence).padStart(5, '0')}`;
    orderId = crypto.randomUUID();

    let totalQty = 0;
    const normalizedItems = [];
    for (const raw of items) {
      const productId = raw?.productId ?? raw?.product_id;
      const quantity = Number(raw?.quantity ?? 0);
      if (!productId || !Number.isFinite(quantity) || quantity <= 0) {
        throw new HttpError(400, 'Item de transferência inválido');
      }
      totalQty += quantity;
      normalizedItems.push({
        productId,
        quantity,
        name: String(raw?.name ?? `Produto ${productId}`),
      });
    }

    await insertOrder([
      orderId,
      null,
      actorUser?.id != null ? String(actorUser.id) : null,
      actorUser?.name != null ? String(actorUser.name) : null,
      totalQty,
      totalQty,
      0,
      0,
      null,
      'completed',
      'Transferência de stock',
      prefix,
      year,
      usedSequence,
      documentNumber,
      documentDate,
      now,
      tenantId,
    ]);

    for (const item of normalizedItems) {
      await insertOrderItem([
        crypto.randomUUID(),
        orderId,
        tenantId,
        String(item.productId),
        item.name,
        item.quantity,
        0,
        0,
        now,
        now,
      ]);

      await transferWarehouseStock({
        tenantId,
        fromWarehouseId,
        toWarehouseId,
        productId: item.productId,
        quantity: item.quantity,
        referenceId: `${prefix}:${documentNumber}`,
        allowNegative,
      });
    }

    await commitDocTransaction();
  } catch (error) {
    try {
      await rollbackDocTransaction();
    } catch {}
    if (error instanceof HttpError) throw error;
    if (error?.status || error?.statusCode) throw error;
    throw new HttpError(500, error?.message || 'Falha na transferência');
  }

  return {
    ok: true,
    documentNumber,
    orderId,
    fromWarehouseId,
    toWarehouseId,
  };
}

export { normalizeWarehouse, countWarehouses };
