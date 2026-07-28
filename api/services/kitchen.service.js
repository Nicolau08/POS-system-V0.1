/**
 * Tickets KDS (cozinha) — fila de preparação independente do status de pagamento.
 */
import crypto from 'crypto';
import { get } from '../dbUtils.js';
import { HttpError } from '../utils/response.js';
import { requireTenantId } from '../utils/tenant.js';
import {
  hasCapability,
  normalizeCapabilities,
  normalizeVertical,
} from '../utils/tenantCapabilities.js';
import { listAllPrintCenters } from './print-centers.service.js';
import { submitProductionOrder } from './production-print.service.js';
import { publishKitchenEvent } from './kitchen-events.js';
import {
  ensureKitchenTicketsSchema,
  getKitchenTicket,
  insertKitchenTicket,
  insertKitchenTicketItem,
  listKitchenTickets,
  listOpenKitchenTicketsForTable,
  nextKitchenTicketNumber,
  touchKitchenTicket,
  updateKitchenTicketItemFields,
  updateKitchenTicketStatus,
} from '../repositories/kitchenTickets.repository.js';

const NOTES_MAX = 500;
const STATUS_FLOW = ['queued', 'preparing', 'ready', 'served'];
const ALLOWED_STATUS = new Set([...STATUS_FLOW, 'cancelled']);

function resolveTenantId(actorUser) {
  return requireTenantId(actorUser?.tenant_id, {
    status: 401,
    message: 'tenant_id ausente',
  });
}

export function normalizeItemNotes(raw) {
  if (raw == null) return null;
  const trimmed = String(raw)
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .trim()
    .slice(0, NOTES_MAX);
  return trimmed || null;
}

export async function assertRestauracaoForKitchen(actorUser) {
  const tenantId = resolveTenantId(actorUser);
  const row = await get(
    `SELECT commerce_type, vertical, capabilities_json FROM tenant_profile WHERE id = ?`,
    [tenantId],
  );
  const vertical = normalizeVertical(row?.vertical, row?.commerce_type);
  const capabilities = normalizeCapabilities(row?.capabilities_json, vertical, row?.commerce_type);
  if (!hasCapability(capabilities, 'print_centers')) {
    throw new HttpError(
      403,
      'KDS disponível apenas em licenças com centros de impressão.',
      'KDS_NOT_AVAILABLE',
    );
  }
  return tenantId;
}

async function loadCategoryMaps(tenantId) {
  const { all } = await import('../dbUtils.js');
  const rows = await all(`SELECT id, name, parent_id FROM categories WHERE tenant_id = ?`, [
    tenantId,
  ]);
  const parentMap = new Map();
  const byName = new Map();
  for (const row of rows || []) {
    const id = String(row.id);
    parentMap.set(id, row.parent_id != null ? String(row.parent_id) : null);
    byName.set(
      String(row.name ?? '')
        .trim()
        .toLowerCase(),
      id,
    );
  }
  return { parentMap, byName };
}

function resolveCenterForCategory(categoryId, categoryName, centers, parentMap, byName) {
  const enabled = (centers || []).filter((c) => c.enabled);
  if (!enabled.length) return null;
  const categoryToCenter = new Map();
  for (const center of enabled) {
    for (const id of center.categoryIds || []) {
      categoryToCenter.set(String(id), center);
    }
  }
  let currentId =
    categoryId != null && String(categoryId).trim()
      ? String(categoryId)
      : categoryName
        ? byName.get(String(categoryName).trim().toLowerCase()) || ''
        : '';
  const visited = new Set();
  while (currentId && !visited.has(currentId)) {
    visited.add(currentId);
    const center = categoryToCenter.get(currentId);
    if (center) return center;
    currentId = parentMap.get(currentId) || '';
  }
  // Sem mapeamento: primeiro centro activo (fallback) para não perder o pedido no KDS.
  return enabled[0] || null;
}

function mapTicketRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    tableKey: row.table_key ?? null,
    tableLabel: row.table_label ?? null,
    ticketNumber: Number(row.ticket_number) || 0,
    printCenterId: row.print_center_id ?? null,
    printCenterName: row.print_center_name ?? null,
    status: row.status,
    source: row.source,
    saleOrderId: row.sale_order_id ?? null,
    createdByUserId: row.created_by_user_id ?? null,
    createdByUserName: row.created_by_user_name ?? null,
    stationCode: row.station_code ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    items: (row.items || []).map((item) => ({
      id: item.id,
      productId: item.product_id ?? null,
      cloudId: item.cloud_id ?? null,
      name: item.name,
      quantity: Number(item.quantity) || 0,
      categoryId: item.category_id ?? null,
      categoryName: item.category_name ?? null,
      notes: item.notes ?? null,
      sortOrder: Number(item.sort_order) || 0,
      status: item.status,
    })),
  };
}

/**
 * Cria tickets KDS (um por print center) e opcionalmente imprime ESC/POS.
 */
export async function createKitchenTickets(payload = {}, actorUser = null) {
  const tenantId = await assertRestauracaoForKitchen(actorUser);
  await ensureKitchenTicketsSchema();

  const items = Array.isArray(payload.items) ? payload.items : [];
  if (!items.length) throw new HttpError(400, 'Pedido sem itens.');

  const printAlso = payload.printAlso !== false && payload.print_also !== false;
  const tableKey =
    payload.tableKey != null
      ? String(payload.tableKey).trim()
      : payload.table_key != null
        ? String(payload.table_key).trim()
        : null;
  const tableLabel =
    payload.tableLabel != null
      ? String(payload.tableLabel).trim()
      : payload.table_label != null
        ? String(payload.table_label).trim()
        : tableKey;
  const source = String(payload.source ?? actorUser?.station_role ?? 'pos_desktop').trim() || 'pos_desktop';
  const stationCode =
    String(payload.stationCode ?? payload.station_code ?? actorUser?.station_code ?? '').trim() ||
    null;
  const saleOrderId =
    payload.saleOrderId != null
      ? String(payload.saleOrderId)
      : payload.sale_order_id != null
        ? String(payload.sale_order_id)
        : null;

  const [centers, { parentMap, byName }] = await Promise.all([
    listAllPrintCenters(actorUser),
    loadCategoryMaps(tenantId),
  ]);

  const buckets = new Map();
  for (const item of items) {
    const qty = Number(item.quantity ?? item.qty) || 0;
    if (qty <= 0) continue;
    const center = resolveCenterForCategory(
      item.category_id ?? item.categoryId ?? null,
      item.category ?? item.categoryName ?? null,
      centers,
      parentMap,
      byName,
    );
    if (!center) continue;
    const line = {
      productId: item.productId ?? item.product_id ?? item.id ?? null,
      cloudId: item.cloud_id ?? item.cloudId ?? null,
      name: String(item.name ?? 'Item'),
      quantity: qty,
      categoryId: item.category_id ?? item.categoryId ?? null,
      categoryName: item.category ?? item.categoryName ?? null,
      notes: normalizeItemNotes(item.notes),
    };
    const existing = buckets.get(center.id);
    if (existing) existing.items.push(line);
    else buckets.set(center.id, { center, items: [line] });
  }

  if (!buckets.size) {
    throw new HttpError(
      409,
      'Nenhum centro de produção para as categorias deste pedido. Configure Imp. Cozinha/Balcão.',
      'NO_PRINT_CENTER',
    );
  }

  const now = new Date().toISOString();
  const created = [];

  for (const { center, items: ticketItems } of buckets.values()) {
    const ticketId = crypto.randomUUID();
    const ticketNumber = await nextKitchenTicketNumber(tenantId);
    await insertKitchenTicket({
      id: ticketId,
      tenant_id: tenantId,
      table_key: tableKey,
      table_label: tableLabel,
      ticket_number: ticketNumber,
      print_center_id: center.id,
      print_center_name: center.name,
      status: 'queued',
      source,
      sale_order_id: saleOrderId,
      created_by_user_id: actorUser?.id ?? null,
      created_by_user_name: actorUser?.name ?? null,
      station_code: stationCode,
      created_at: now,
      updated_at: now,
    });

    let sort = 0;
    for (const line of ticketItems) {
      await insertKitchenTicketItem({
        id: crypto.randomUUID(),
        ticket_id: ticketId,
        product_id: line.productId != null ? String(line.productId) : null,
        cloud_id: line.cloudId != null ? String(line.cloudId) : null,
        name: line.name,
        quantity: line.quantity,
        category_id: line.categoryId != null ? String(line.categoryId) : null,
        category_name: line.categoryName != null ? String(line.categoryName) : null,
        notes: line.notes,
        sort_order: sort++,
        status: 'queued',
      });
    }

    const full = await getKitchenTicket(tenantId, ticketId);
    created.push(mapTicketRow(full));
    publishKitchenEvent(tenantId, {
      type: 'ticket-created',
      ticketId,
      printCenterId: center.id,
      status: 'queued',
    });
  }

  let printResult = null;
  if (printAlso) {
    try {
      printResult = await submitProductionOrder(
        {
          items: items.map((item) => ({
            name: item.name,
            quantity: item.quantity ?? item.qty,
            category_id: item.category_id ?? item.categoryId ?? null,
            category: item.category ?? item.categoryName ?? null,
            notes: normalizeItemNotes(item.notes),
          })),
          tableLabel,
          docLabel: payload.docLabel ?? 'PEDIDO',
          timeLabel: payload.timeLabel ?? null,
        },
        actorUser,
      );
    } catch (err) {
      // Tickets já criados — impressão falhou mas KDS tem o pedido.
      printResult = {
        printed: 0,
        errors: [err instanceof Error ? err.message : String(err)],
        printFailed: true,
      };
    }
  }

  return { tickets: created, print: printResult };
}

export async function listKitchenTicketsForApi(query = {}, actorUser = null) {
  const tenantId = await assertRestauracaoForKitchen(actorUser);
  const rows = await listKitchenTickets(tenantId, {
    status: query.status,
    printCenterId: query.printCenterId ?? query.print_center_id,
    since: query.since,
  });
  return {
    tickets: rows.map(mapTicketRow),
    updatedAt: new Date().toISOString(),
  };
}

export async function bumpKitchenTicketStatus(ticketIdRaw, body = {}, actorUser = null) {
  const tenantId = await assertRestauracaoForKitchen(actorUser);
  const ticketId = String(ticketIdRaw ?? '').trim();
  if (!ticketId) throw new HttpError(400, 'ticket id obrigatório.');

  const existing = await getKitchenTicket(tenantId, ticketId);
  if (!existing) throw new HttpError(404, 'Ticket não encontrado.');

  let nextStatus = body.status != null ? String(body.status).trim().toLowerCase() : '';
  if (!nextStatus || nextStatus === 'bump' || nextStatus === 'next') {
    const idx = STATUS_FLOW.indexOf(existing.status);
    if (idx < 0 || idx >= STATUS_FLOW.length - 1) {
      throw new HttpError(409, `Não é possível avançar o estado «${existing.status}».`);
    }
    nextStatus = STATUS_FLOW[idx + 1];
  }

  if (!ALLOWED_STATUS.has(nextStatus)) {
    throw new HttpError(400, `Estado inválido: ${nextStatus}`);
  }

  const now = new Date().toISOString();
  await updateKitchenTicketStatus(tenantId, ticketId, nextStatus, now);
  const updated = await getKitchenTicket(tenantId, ticketId);
  publishKitchenEvent(tenantId, {
    type: 'ticket-updated',
    ticketId,
    printCenterId: updated?.print_center_id ?? null,
    status: nextStatus,
  });
  return mapTicketRow(updated);
}

function itemMatchesProduct(item, productId, name) {
  const pid = String(item.product_id ?? '').trim();
  const iname = String(item.name ?? '')
    .trim()
    .toLowerCase();
  if (productId && pid && pid === productId) return true;
  if (name && iname && iname === name) return true;
  return false;
}

async function publishTicketUpdated(tenantId, ticketId) {
  const updated = await getKitchenTicket(tenantId, ticketId);
  if (!updated) return null;
  publishKitchenEvent(tenantId, {
    type: 'ticket-updated',
    ticketId,
    printCenterId: updated.print_center_id ?? null,
    status: updated.status,
  });
  return mapTicketRow(updated);
}

async function cancelTicketIfEmpty(tenantId, ticketId, now) {
  const full = await getKitchenTicket(tenantId, ticketId);
  if (!full) return;
  if (!['queued', 'preparing', 'ready'].includes(full.status)) return;
  const active = (full.items || []).filter(
    (item) => item.status !== 'cancelled' && Number(item.quantity) > 0,
  );
  if (active.length) return;
  await updateKitchenTicketStatus(tenantId, ticketId, 'cancelled', now);
}

/**
 * Ajusta tickets abertos de uma mesa (anular qty / actualizar notas) e notifica o KDS.
 * adjustments: [{ productId?, name?, quantityDelta?, notes? }]
 * Se `notes` estiver presente (mesmo null), actualiza notas nos itens abertos.
 */
export async function adjustKitchenForTable(payload = {}, actorUser = null) {
  const tenantId = await assertRestauracaoForKitchen(actorUser);
  await ensureKitchenTicketsSchema();

  const tableKey = String(payload.tableKey ?? payload.table_key ?? '').trim();
  if (!tableKey) throw new HttpError(400, 'Mesa obrigatória.');

  const adjustments = Array.isArray(payload.adjustments) ? payload.adjustments : [];
  const cancelAll = Boolean(payload.cancelAll ?? payload.cancel_all);

  const tickets = await listOpenKitchenTicketsForTable(tenantId, tableKey);
  const now = new Date().toISOString();
  const affected = new Set();

  if (cancelAll) {
    for (const ticket of tickets) {
      await updateKitchenTicketStatus(tenantId, ticket.id, 'cancelled', now);
      affected.add(ticket.id);
    }
  }

  for (const adj of adjustments) {
    const productId = String(adj.productId ?? adj.product_id ?? adj.id ?? '').trim();
    const name = String(adj.name ?? '')
      .trim()
      .toLowerCase();
    if (!productId && !name) continue;

    const hasNotes = Object.prototype.hasOwnProperty.call(adj, 'notes');
    const notes = hasNotes ? normalizeItemNotes(adj.notes) : undefined;
    const qtyDelta = Number(adj.quantityDelta ?? adj.quantity_delta ?? 0) || 0;

    const matches = [];
    // Mais recentes primeiro ao anular qty
    for (const ticket of [...tickets].reverse()) {
      for (const item of ticket.items || []) {
        if (item.status === 'cancelled') continue;
        if (Number(item.quantity) <= 0) continue;
        if (!itemMatchesProduct(item, productId, name)) continue;
        matches.push({ ticket, item });
      }
    }

    if (hasNotes) {
      for (const { ticket, item } of matches) {
        await updateKitchenTicketItemFields(item.id, { notes });
        item.notes = notes;
        await touchKitchenTicket(tenantId, ticket.id, now);
        affected.add(ticket.id);
      }
    }

    if (qtyDelta < 0) {
      let remaining = -qtyDelta;
      for (const { ticket, item } of matches) {
        if (remaining <= 0) break;
        const q = Number(item.quantity) || 0;
        if (q <= 0) continue;
        const take = Math.min(q, remaining);
        const newQ = q - take;
        remaining -= take;
        if (newQ <= 0) {
          await updateKitchenTicketItemFields(item.id, { quantity: 0, status: 'cancelled' });
          item.quantity = 0;
          item.status = 'cancelled';
        } else {
          await updateKitchenTicketItemFields(item.id, { quantity: newQ });
          item.quantity = newQ;
        }
        await touchKitchenTicket(tenantId, ticket.id, now);
        affected.add(ticket.id);
      }
    }
  }

  const out = [];
  for (const ticketId of affected) {
    await cancelTicketIfEmpty(tenantId, ticketId, now);
    const mapped = await publishTicketUpdated(tenantId, ticketId);
    if (mapped) out.push(mapped);
  }

  return { tickets: out, updatedAt: now };
}

function sentQtyOfLine(line) {
  if (line?.sentQuantity != null && Number.isFinite(Number(line.sentQuantity))) {
    return Math.max(0, Number(line.sentQuantity) || 0);
  }
  // Legado sem sentQuantity: assume que o que está na mesa já foi pedido.
  return Math.max(0, Number(line?.quantity) || 0);
}

function notesKey(notes) {
  return normalizeItemNotes(notes) || '';
}

/**
 * Compara carrinho anterior/seguinte da mesa e propaga anulações / notas ao KDS.
 */
export async function reconcileKitchenWithTableCart(
  tableKeyRaw,
  previousCart,
  nextCart,
  actorUser = null,
) {
  try {
    await assertRestauracaoForKitchen(actorUser);
  } catch {
    return null;
  }

  const tableKey = String(tableKeyRaw ?? '').trim();
  if (!tableKey) return null;

  const prev = Array.isArray(previousCart) ? previousCart : [];
  const next = Array.isArray(nextCart) ? nextCart : [];

  if (!next.length && prev.some((line) => sentQtyOfLine(line) > 0)) {
    return adjustKitchenForTable({ tableKey, cancelAll: true }, actorUser);
  }

  const prevById = new Map();
  for (const line of prev) {
    const id = String(line?.id ?? '').trim();
    if (!id) continue;
    prevById.set(id, line);
  }
  const nextById = new Map();
  for (const line of next) {
    const id = String(line?.id ?? '').trim();
    if (!id) continue;
    nextById.set(id, line);
  }

  const adjustments = [];
  const ids = new Set([...prevById.keys(), ...nextById.keys()]);
  for (const id of ids) {
    const before = prevById.get(id);
    const after = nextById.get(id);
    const prevSent = before ? sentQtyOfLine(before) : 0;
    const nextSent = after ? sentQtyOfLine(after) : 0;
    const name = String(after?.name ?? before?.name ?? '').trim();

    if (nextSent < prevSent) {
      adjustments.push({
        productId: id,
        name,
        quantityDelta: nextSent - prevSent,
      });
    }

    if (nextSent > 0 && after) {
      const prevNotes = before ? notesKey(before.notes) : '';
      const nextNotes = notesKey(after.notes);
      if (prevNotes !== nextNotes) {
        adjustments.push({
          productId: id,
          name,
          notes: after.notes ?? null,
        });
      }
    }
  }

  if (!adjustments.length) return null;
  return adjustKitchenForTable({ tableKey, adjustments }, actorUser);
}
