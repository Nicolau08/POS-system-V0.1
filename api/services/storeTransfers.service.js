/**
 * Etapa 1G.2B.5 - transferencias Store -> Store (lado local, offline-first). A cloud arbitra as transicoes
 * cross-store; localmente cada Store so mexe no SEU stock:
 *   origem  (direction 'out'): draft -> dispatched (debita o armazem de origem e captura o custo FIFO)
 *   destino (direction 'in') : dispatched (aprendido por pull) -> received (credita o armazem de destino com o custo enviado)
 * Cancelamento pos-dispatch so por cloud; aqui apenas se aplica localmente o resultado (movimento compensatorio).
 * Divergencia (qty_received != qty_sent) fica registada; nunca gera ajuste automatico.
 */
import crypto from 'crypto';
import { all, get, run } from '../dbUtils.js';
import { HttpError } from '../utils/response.js';
import { isUuidString } from '../cloudIdUtils.js';
import { beginImmediateTransaction, commitTransaction, rollbackTransaction } from '../repositories/documentos.repository.js';
import {
  applyWarehouseDelta,
  creditWarehouseFromLayers,
  resolveWarehouseId,
} from './warehouseStock.service.js';

const EPS = 0.0001;
const nowIso = () => new Date().toISOString();
const ref = (id, productCloudId, suffix) => `transfer:${id}:${productCloudId}:${suffix}`;
const parseLayers = (v) => {
  try {
    const a = typeof v === 'string' ? JSON.parse(v) : v;
    return Array.isArray(a) ? a : [];
  } catch {
    return [];
  }
};

async function inTx(fn) {
  await beginImmediateTransaction();
  try {
    const out = await fn();
    await commitTransaction();
    return out;
  } catch (e) {
    try { await rollbackTransaction(); } catch { /* noop */ }
    throw e;
  }
}

const loadTransfer = async (id, direction, tenantId) =>
  get(`SELECT * FROM stock_transfers WHERE id = ? AND direction = ? AND tenant_id = ?`, [String(id), direction, tenantId]);
const loadItems = (id, direction) =>
  all(`SELECT * FROM stock_transfer_items WHERE transfer_id = ? AND direction = ? ORDER BY product_id`, [String(id), direction]);

/** Rascunho na origem (so local; a cloud so o conhece no dispatch). */
export async function createDraft({ tenantId, toStoreId, fromWarehouseId = null, items = [], note = null, id = null } = {}) {
  if (!tenantId) throw new HttpError(400, 'tenant_id obrigatório');
  if (!isUuidString(String(toStoreId ?? ''))) throw new HttpError(400, 'Store de destino inválida');
  if (!Array.isArray(items) || items.length === 0) throw new HttpError(400, 'Transferência sem itens');
  const whId = await resolveWarehouseId({ tenantId, explicitWarehouseId: fromWarehouseId });
  const tid = id && isUuidString(String(id)) ? String(id) : crypto.randomUUID();
  const now = nowIso();
  const seen = new Set();
  const rows = [];
  for (const it of items) {
    const pid = Number(it?.productId ?? it?.product_id);
    const qty = Number(it?.qty ?? it?.quantity);
    if (!Number.isFinite(pid) || !Number.isFinite(qty) || qty <= EPS) throw new HttpError(400, 'Item inválido');
    if (seen.has(pid)) throw new HttpError(400, 'Produto repetido na transferência');
    seen.add(pid);
    const p = await get(`SELECT id, cloud_id FROM products WHERE id = ? AND tenant_id = ? AND COALESCE(deleted, 0) = 0`, [pid, tenantId]);
    if (!p) throw new HttpError(404, 'Produto não encontrado');
    if (!p.cloud_id) throw new HttpError(409, 'Produto ainda não sincronizado com a cloud (é o mesmo produto mestre em todas as Stores)');
    rows.push({ pid, cloud: String(p.cloud_id), qty });
  }
  await inTx(async () => {
    await run(
      `INSERT INTO stock_transfers (id, direction, tenant_id, to_store_id, from_warehouse_id, status, note, push_state, created_at, updated_at)
       VALUES (?, 'out', ?, ?, ?, 'draft', ?, 'local', ?, ?)`,
      [tid, tenantId, String(toStoreId), whId, note, now, now]
    );
    for (const r of rows) {
      await run(
        `INSERT INTO stock_transfer_items (transfer_id, direction, product_id, product_cloud_id, qty_requested) VALUES (?, 'out', ?, ?, ?)`,
        [tid, r.pid, r.cloud, r.qty]
      );
    }
  });
  return { id: tid, status: 'draft' };
}

/** Cancelar rascunho: local, sem cloud. Compare-and-set draft -> cancelled. */
export async function cancelDraft(id, tenantId) {
  const r = await run(
    `UPDATE stock_transfers SET status = 'cancelled', cancelled_at = ?, updated_at = ?, push_state = 'local'
     WHERE id = ? AND direction = 'out' AND tenant_id = ? AND status = 'draft'`,
    [nowIso(), nowIso(), String(id), tenantId]
  );
  if (r.changes !== 1) throw new HttpError(409, 'Só é possível cancelar localmente um rascunho');
  return { id, status: 'cancelled' };
}

/** DISPATCH local (offline): draft -> dispatched (CAS), debita a origem e guarda o custo FIFO enviado. */
export async function dispatchLocal(id, tenantId) {
  return inTx(async () => {
    const t = await loadTransfer(id, 'out', tenantId);
    if (!t) throw new HttpError(404, 'Transferência não encontrada');
    const now = nowIso();
    const cas = await run(
      `UPDATE stock_transfers SET status = 'dispatched', dispatched_at = ?, updated_at = ?, push_state = 'pending'
       WHERE id = ? AND direction = 'out' AND tenant_id = ? AND status = 'draft'`,
      [now, now, String(id), tenantId]
    );
    if (cas.changes !== 1) throw new HttpError(409, 'A transferência já não está em rascunho');
    for (const it of await loadItems(id, 'out')) {
      const res = await applyWarehouseDelta({
        tenantId,
        warehouseId: t.from_warehouse_id,
        productId: it.product_id,
        delta: -Number(it.qty_requested),
        movementType: 'transfer_out',
        referenceId: ref(id, it.product_cloud_id, 'out'),
        fromWarehouseId: t.from_warehouse_id,
      });
      const layers = (res.consumptions ?? [])
        .filter((c) => c && !c.synthetic && Number(c.qty) > EPS)
        .map((c) => ({ qty: Number(c.qty), unit_cost: Number(c.unitCost), lot_code: c.lotCode ?? null }));
      await run(
        `UPDATE stock_transfer_items SET qty_sent = ?, cost_layers = ? WHERE transfer_id = ? AND direction = 'out' AND product_id = ?`,
        [Number(it.qty_requested), JSON.stringify(layers), String(id), it.product_id]
      );
    }
    return { id, status: 'dispatched' };
  });
}

/** RECEIVE local (offline): so depois de a transferencia ser conhecida (pull). CAS dispatched -> received; credita o destino. */
export async function receiveLocal(id, tenantId, { toWarehouseId = null, items = [] } = {}) {
  return inTx(async () => {
    const t = await loadTransfer(id, 'in', tenantId);
    if (!t) throw new HttpError(404, 'Transferência não conhecida nesta Store (ainda não sincronizada)');
    const whId = await resolveWarehouseId({ tenantId, explicitWarehouseId: toWarehouseId });
    const base = await loadItems(id, 'in');
    const received = new Map((items ?? []).map((i) => [Number(i.productId ?? i.product_id), Number(i.qtyReceived ?? i.qty_received)]));
    for (const it of base) {
      const q = received.get(Number(it.product_id));
      if (q == null || !Number.isFinite(q) || q < 0) throw new HttpError(400, 'Quantidade recebida em falta para um item');
    }
    const now = nowIso();
    const cas = await run(
      `UPDATE stock_transfers SET status = 'received', to_warehouse_id = ?, received_at = ?, updated_at = ?, push_state = 'pending'
       WHERE id = ? AND direction = 'in' AND tenant_id = ? AND status = 'dispatched'`,
      [whId, now, now, String(id), tenantId]
    );
    if (cas.changes !== 1) throw new HttpError(409, 'A transferência não está pendente de recepção');
    let diverge = 0;
    for (const it of base) {
      const q = received.get(Number(it.product_id));
      if (Math.abs(q - Number(it.qty_sent)) > EPS) diverge = 1;
      await run(`UPDATE stock_transfer_items SET qty_received = ? WHERE transfer_id = ? AND direction = 'in' AND product_id = ?`, [q, String(id), it.product_id]);
      if (q > EPS) {
        await creditWarehouseFromLayers({
          tenantId,
          warehouseId: whId,
          productId: it.product_id,
          qty: q,
          layers: parseLayers(it.cost_layers),
          movementType: 'transfer_in',
          referenceId: ref(id, it.product_cloud_id, 'in'),
          toWarehouseId: whId,
        });
      }
    }
    if (diverge) await run(`UPDATE stock_transfers SET divergence = 1 WHERE id = ? AND direction = 'in'`, [String(id)]);
    return { id, status: 'received', divergence: Boolean(diverge) };
  });
}

/** Compensa localmente um efeito de stock que a cloud recusou/cancelou (movimento compensatorio; nunca apaga). */
async function compensate(t, items, tenantId) {
  const now = nowIso();
  if (t.direction === 'out') {
    for (const it of items) {
      if (Number(it.qty_sent) <= EPS) continue;
      await creditWarehouseFromLayers({
        tenantId,
        warehouseId: t.from_warehouse_id,
        productId: it.product_id,
        qty: Number(it.qty_sent),
        layers: parseLayers(it.cost_layers),
        movementType: 'adjustment',
        referenceId: ref(t.id, it.product_cloud_id, 'reversal'),
      });
    }
  } else if (t.status === 'received') {
    for (const it of items) {
      const q = Number(it.qty_received ?? 0);
      if (q <= EPS) continue;
      await applyWarehouseDelta({
        tenantId,
        warehouseId: t.to_warehouse_id,
        productId: it.product_id,
        delta: -q,
        movementType: 'adjustment',
        referenceId: ref(t.id, it.product_cloud_id, 'in-reversal'),
        allowNegative: true,
      });
    }
  }
  void now;
}

/** Aplica localmente uma transicao arbitrada pela cloud (cancelada / recusada). Idempotente. */
export async function applyCloudCancellation(id, direction, tenantId, { reason = null, rejected = false } = {}) {
  return inTx(async () => {
    const t = await loadTransfer(id, direction, tenantId);
    if (!t) return { applied: false };
    if (t.status === 'cancelled' || t.push_state === 'rejected') return { applied: false };
    const items = await loadItems(id, direction);
    const hadEffect = (direction === 'out' && t.status === 'dispatched') || (direction === 'in' && t.status === 'received');
    if (hadEffect) await compensate(t, items, tenantId);
    const now = nowIso();
    await run(
      `UPDATE stock_transfers SET status = 'cancelled', cancelled_at = ?, updated_at = ?, cancel_reason = ?, push_state = ?
       WHERE id = ? AND direction = ? AND tenant_id = ?`,
      [now, now, reason, rejected ? 'rejected' : 'synced', String(id), direction, tenantId]
    );
    return { applied: true, compensated: hadEffect };
  });
}

/** Pendentes para a cloud. */
export async function collectPendingTransfers(tenantId) {
  const outs = await all(`SELECT * FROM stock_transfers WHERE tenant_id = ? AND direction = 'out' AND status = 'dispatched' AND push_state = 'pending'`, [tenantId]);
  const ins = await all(`SELECT * FROM stock_transfers WHERE tenant_id = ? AND direction = 'in' AND status = 'received' AND push_state = 'pending'`, [tenantId]);
  const dispatch = [];
  for (const t of outs) {
    const items = await loadItems(t.id, 'out');
    dispatch.push({
      id: t.id,
      payload: {
        id: t.id,
        from_warehouse_id: t.from_warehouse_id,
        to_store_id: t.to_store_id,
        note: t.note,
        created_at: t.created_at,
        items: items.map((i) => ({ product_id: i.product_cloud_id, qty: Number(i.qty_sent), cost_layers: parseLayers(i.cost_layers) })),
      },
    });
  }
  const receive = [];
  for (const t of ins) {
    const items = await loadItems(t.id, 'in');
    receive.push({
      id: t.id,
      to_warehouse_id: t.to_warehouse_id,
      items: items.map((i) => ({ product_id: i.product_cloud_id, qty_received: Number(i.qty_received ?? 0) })),
    });
  }
  return { dispatch, receive };
}

export async function markPushed(id, direction, tenantId, state = 'synced') {
  await run(`UPDATE stock_transfers SET push_state = ?, updated_at = ? WHERE id = ? AND direction = ? AND tenant_id = ?`, [state, nowIso(), String(id), direction, tenantId]);
}

/**
 * Pull: linhas de device_stock_transfers (direction ja calculada no servidor) + itens.
 * - 'in' desconhecida -> passa a existir localmente (dispatched) para poder ser recebida;
 * - cloud 'cancelled' -> compensacao local se houve efeito; cloud 'received' -> so marca.
 */
export async function applyRemoteTransfers(tenantId, rows, itemsByTransfer) {
  const summary = { created: 0, cancelled: 0, received: 0, incomplete: 0 };
  for (const r of rows ?? []) {
    const direction = r.direction === 'out' ? 'out' : 'in';
    const local = await loadTransfer(r.id, direction, tenantId);
    const remoteItems = itemsByTransfer.get(String(r.id)) ?? [];
    if (!local) {
      if (direction === 'out') continue; // a origem so conhece o que criou
      const mapped = [];
      for (const i of remoteItems) {
        const p = await get(`SELECT id FROM products WHERE cloud_id = ? AND tenant_id = ?`, [String(i.product_id), tenantId]);
        if (p) mapped.push({ i, pid: p.id });
      }
      if (mapped.length !== remoteItems.length || remoteItems.length === 0) {
        summary.incomplete += 1; // produto mestre ainda nao chegou por pull: tenta no proximo ciclo
        continue;
      }
      const now = nowIso();
      await inTx(async () => {
        await run(
          `INSERT INTO stock_transfers (id, direction, tenant_id, to_store_id, from_warehouse_id, to_warehouse_id, status, note, push_state, created_at, updated_at, dispatched_at, received_at, cancelled_at, divergence)
           VALUES (?, 'in', ?, ?, ?, ?, ?, ?, 'synced', ?, ?, ?, ?, ?, ?)`,
          [r.id, tenantId, r.to_store_id, r.from_warehouse_id, r.to_warehouse_id ?? null, r.status, r.note ?? null, r.created_at ?? now, now, r.dispatched_at ?? null, r.received_at ?? null, r.cancelled_at ?? null, r.has_divergence ? 1 : 0]
        );
        for (const { i, pid } of mapped) {
          await run(
            `INSERT INTO stock_transfer_items (transfer_id, direction, product_id, product_cloud_id, qty_requested, qty_sent, qty_received, cost_layers)
             VALUES (?, 'in', ?, ?, ?, ?, ?, ?)`,
            [r.id, pid, String(i.product_id), Number(i.qty_requested), Number(i.qty_sent), i.qty_received == null ? null : Number(i.qty_received), JSON.stringify(i.cost_layers ?? [])]
          );
        }
      });
      summary.created += 1;
      continue;
    }
    if (r.status === 'cancelled' && local.status !== 'cancelled') {
      const res = await applyCloudCancellation(r.id, direction, tenantId, { reason: r.cancel_reason ?? null });
      if (res.applied) summary.cancelled += 1;
    } else if (r.status === 'received' && local.status === 'dispatched') {
      await run(`UPDATE stock_transfers SET status = 'received', received_at = ?, divergence = ?, push_state = 'synced', updated_at = ? WHERE id = ? AND direction = ? AND tenant_id = ?`, [r.received_at ?? nowIso(), r.has_divergence ? 1 : 0, nowIso(), r.id, direction, tenantId]);
      summary.received += 1;
    } else if (r.status === 'received' && local.status === 'received' && local.push_state === 'synced') {
      await run(`UPDATE stock_transfers SET divergence = ? WHERE id = ? AND direction = ? AND tenant_id = ?`, [r.has_divergence ? 1 : 0, r.id, direction, tenantId]);
    }
  }
  return summary;
}

export async function listTransfers(tenantId) {
  const rows = await all(`SELECT * FROM stock_transfers WHERE tenant_id = ? ORDER BY created_at DESC`, [tenantId]);
  for (const r of rows) r.items = await loadItems(r.id, r.direction);
  return rows;
}
