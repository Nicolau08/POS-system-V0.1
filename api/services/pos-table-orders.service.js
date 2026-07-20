import { getOrCreateDefaultTenantId } from '../database.js';
import { HttpError } from '../utils/response.js';
import {
  deletePosTableOrder,
  getPosTableOrder,
  listPosTableOrders,
  upsertPosTableOrder,
} from '../repositories/pos-table-orders.repository.js';
import { publishTableOrderEvent } from './table-orders-events.js';

async function resolveTenantId(actorUser) {
  const fromUser = String(actorUser?.tenant_id ?? '').trim();
  if (fromUser) return fromUser;
  return getOrCreateDefaultTenantId();
}

function parsePayload(raw) {
  if (raw == null || raw === '') return null;
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function normalizeCart(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((row) => {
      const id = String(row?.id ?? '').trim();
      if (!id) return null;
      return {
        id,
        name: String(row?.name ?? 'Produto'),
        price: Number(row?.price) || 0,
        quantity: Math.max(1, Number(row?.quantity) || 1),
        category: String(row?.category ?? 'Geral'),
        category_id: row?.category_id != null ? String(row.category_id) : null,
        cloud_id: row?.cloud_id != null ? String(row.cloud_id) : null,
        discount: row?.discount ?? undefined,
      };
    })
    .filter(Boolean);
}

function toOrderPayload(body) {
  const cart = normalizeCart(body?.cart);
  return {
    cart,
    globalDiscount: body?.globalDiscount ?? null,
    selectedCustomer: body?.selectedCustomer ?? null,
    docType: String(body?.docType ?? 'VD').toUpperCase() || 'VD',
  };
}

export async function listSharedTableOrders(actorUser = null) {
  const tenantId = await resolveTenantId(actorUser);
  const rows = await listPosTableOrders(tenantId);
  const orders = {};
  for (const row of rows || []) {
    const key = String(row.table_key);
    const payload = parsePayload(row.payload_json) || { cart: [] };
    orders[key] = {
      cart: normalizeCart(payload.cart),
      globalDiscount: payload.globalDiscount ?? null,
      selectedCustomer: payload.selectedCustomer ?? null,
      docType: payload.docType ?? 'VD',
      updatedAt: row.updated_at ?? null,
      updatedById: row.updated_by_id ?? null,
      updatedByName: row.updated_by_name ?? null,
      stationCode: row.station_code ?? null,
    };
  }
  return { orders, updatedAt: new Date().toISOString() };
}

export async function saveSharedTableOrder(tableKeyRaw, body = {}, actorUser = null) {
  const tenantId = await resolveTenantId(actorUser);
  const tableKey = String(tableKeyRaw ?? '').trim();
  if (!tableKey) throw new HttpError(400, 'Mesa obrigatória.');
  const payload = toOrderPayload(body);
  const now = new Date().toISOString();
  const stationCode =
    String(body?.stationCode ?? body?.station_code ?? actorUser?.station_code ?? '').trim() || null;
  const expectedUpdatedAt =
    body?.expectedUpdatedAt != null
      ? String(body.expectedUpdatedAt)
      : body?.expected_updated_at != null
        ? String(body.expected_updated_at)
        : null;

  const existing = await getPosTableOrder(tenantId, tableKey);
  if (existing && expectedUpdatedAt != null) {
    const current = String(existing.updated_at ?? '');
    if (current && current !== expectedUpdatedAt) {
      const currentPayload = parsePayload(existing.payload_json) || { cart: [] };
      throw new HttpError(
        409,
        'Pedido da mesa foi actualizado noutro posto. Recarregue e tente outra vez.',
        'TABLE_ORDER_CONFLICT',
        {
          tableKey,
          order: {
            cart: normalizeCart(currentPayload.cart),
            globalDiscount: currentPayload.globalDiscount ?? null,
            selectedCustomer: currentPayload.selectedCustomer ?? null,
            docType: currentPayload.docType ?? 'VD',
            updatedAt: existing.updated_at ?? null,
            updatedById: existing.updated_by_id ?? null,
            updatedByName: existing.updated_by_name ?? null,
            stationCode: existing.station_code ?? null,
          },
        },
      );
    }
  }

  if (!payload.cart.length) {
    await deletePosTableOrder(tenantId, tableKey);
    publishTableOrderEvent(tenantId, {
      type: 'cleared',
      tableKey,
      updatedAt: now,
      cleared: true,
    });
    return { tableKey, order: null, updatedAt: now, cleared: true };
  }

  await upsertPosTableOrder(
    tenantId,
    tableKey,
    JSON.stringify(payload),
    now,
    actorUser?.id ? String(actorUser.id) : null,
    actorUser?.name ? String(actorUser.name) : null,
    stationCode,
  );
  publishTableOrderEvent(tenantId, {
    type: 'upsert',
    tableKey,
    updatedAt: now,
    cleared: false,
  });
  return {
    tableKey,
    order: {
      ...payload,
      updatedAt: now,
      updatedById: actorUser?.id ? String(actorUser.id) : null,
      updatedByName: actorUser?.name ? String(actorUser.name) : null,
      stationCode,
    },
    updatedAt: now,
    cleared: false,
  };
}

export async function clearSharedTableOrder(tableKeyRaw, actorUser = null) {
  const tenantId = await resolveTenantId(actorUser);
  const tableKey = String(tableKeyRaw ?? '').trim();
  if (!tableKey) throw new HttpError(400, 'Mesa obrigatória.');
  await deletePosTableOrder(tenantId, tableKey);
  publishTableOrderEvent(tenantId, {
    type: 'cleared',
    tableKey,
    updatedAt: new Date().toISOString(),
    cleared: true,
  });
  return { tableKey, cleared: true };
}

export async function getSharedTableOrder(tableKeyRaw, actorUser = null) {
  const tenantId = await resolveTenantId(actorUser);
  const tableKey = String(tableKeyRaw ?? '').trim();
  if (!tableKey) throw new HttpError(400, 'Mesa obrigatória.');
  const row = await getPosTableOrder(tenantId, tableKey);
  if (!row) return { tableKey, order: null };
  const payload = parsePayload(row.payload_json) || { cart: [] };
  return {
    tableKey,
    order: {
      cart: normalizeCart(payload.cart),
      globalDiscount: payload.globalDiscount ?? null,
      selectedCustomer: payload.selectedCustomer ?? null,
      docType: payload.docType ?? 'VD',
      updatedAt: row.updated_at ?? null,
      updatedById: row.updated_by_id ?? null,
      updatedByName: row.updated_by_name ?? null,
      stationCode: row.station_code ?? null,
    },
  };
}
