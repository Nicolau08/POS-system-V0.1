import crypto from 'crypto';
import { HttpError } from '../utils/response.js';
import { get } from '../dbUtils.js';
import { logWarn } from '../utils/logger.js';
import {
  backfillStockMovementsWarehouse,
  backfillWarehouseStockFromProducts,
  getDefaultWarehouse,
  getWarehouseById,
  getWarehouseStockRow,
  insertStockMovementWithWarehouse,
  insertWarehouse,
  listWarehouses,
  recalculateAllProductStockCaches,
  refreshProductStockCache,
  sumProductWarehouseStock,
  updateProductCost,
  upsertWarehouseStockDelta,
} from '../repositories/warehouses.repository.js';
import {
  backfillStockLayersFromWarehouseStock,
  insertLayerConsumption,
  insertStockLayer,
  listFifoLayers,
  sumAllLayersForProduct,
  sumLayersRemaining,
  updateLayerQtyRemaining,
} from '../repositories/stockLayers.repository.js';

const DEFAULT_WAREHOUSE_NAME = 'Loja';
const DEFAULT_WAREHOUSE_CODE = 'LOJA';
const QTY_EPS = 1e-9;

function shouldTrackStockLayers(productRow) {
  if (!productRow) return false;
  if (Number(productRow.is_service ?? 0) !== 0) return false;
  const kind = String(productRow.product_kind ?? 'simple').trim().toLowerCase();
  if (kind === 'service' || kind === 'composed') return false;
  return true;
}

async function getProductStockMeta(productId, tenantId) {
  return get(
    `SELECT id, cost, is_service, product_kind, track_lot
     FROM products
     WHERE CAST(id AS TEXT) = ?
       AND tenant_id = ?
       AND COALESCE(deleted, 0) = 0`,
    [String(productId), tenantId]
  );
}

/**
 * Recalcula products.cost como média ponderada das camadas restantes (todos os armazéns).
 */
export async function recalcProductCostCache(productId, tenantId, updatedAt = new Date().toISOString()) {
  const pid = Number(productId);
  const sums = await sumAllLayersForProduct(tenantId, pid);
  const qty = Number(sums?.qty ?? 0) || 0;
  const value = Number(sums?.value ?? 0) || 0;
  if (qty > QTY_EPS) {
    await updateProductCost(pid, tenantId, value / qty, updatedAt);
  }
  // Se qty=0, mantém o último cost (histórico / referência).
}

/**
 * Garante armazém «Loja» default + backfill idempotente do stock legado + camadas FIFO.
 */
export async function ensureDefaultWarehouse(tenantId) {
  if (!tenantId) throw new HttpError(400, 'tenant_id obrigatório');

  let defaultWh = await getDefaultWarehouse(tenantId);
  if (!defaultWh) {
    const existing = await listWarehouses(tenantId);
    const now = new Date().toISOString();
    if (existing.length === 0) {
      const id = crypto.randomUUID();
      await insertWarehouse([
        id,
        tenantId,
        DEFAULT_WAREHOUSE_NAME,
        DEFAULT_WAREHOUSE_CODE,
        1,
        1,
        now,
        now,
      ]);
      defaultWh = await getWarehouseById(id, tenantId);
    } else {
      const promote =
        existing.find((w) => Number(w.is_active) !== 0) || existing[0];
      const { clearDefaultWarehouse, setWarehouseDefault } = await import(
        '../repositories/warehouses.repository.js'
      );
      await clearDefaultWarehouse(tenantId, now);
      await setWarehouseDefault(String(promote.id), tenantId, now);
      defaultWh = await getWarehouseById(String(promote.id), tenantId);
    }
  }

  if (!defaultWh) {
    throw new HttpError(500, 'Falha ao garantir armazém principal');
  }

  const warehouseId = String(defaultWh.id);
  const now = new Date().toISOString();
  await backfillWarehouseStockFromProducts(tenantId, warehouseId, now);
  await backfillStockMovementsWarehouse(tenantId, warehouseId);
  await backfillStockLayersFromWarehouseStock(tenantId);
  await recalculateAllProductStockCaches(tenantId, now);
  return defaultWh;
}

export async function getDefaultWarehouseId(tenantId) {
  const wh = await ensureDefaultWarehouse(tenantId);
  return String(wh.id);
}

/**
 * Resolve armazém:
 * 1. explicitWarehouseId se válido
 * 2. location.warehouse_id se preenchido
 * 3. armazém is_default do tenant
 */
export async function resolveWarehouseId({
  tenantId,
  locationId = null,
  explicitWarehouseId = null,
} = {}) {
  if (!tenantId) throw new HttpError(400, 'tenant_id obrigatório');

  await ensureDefaultWarehouse(tenantId);

  if (explicitWarehouseId != null && String(explicitWarehouseId).trim()) {
    const wh = await getWarehouseById(String(explicitWarehouseId).trim(), tenantId);
    if (!wh) throw new HttpError(400, 'Armazém inválido');
    if (Number(wh.is_active) === 0) throw new HttpError(400, 'Armazém inactivo');
    return String(wh.id);
  }

  if (locationId != null && String(locationId).trim()) {
    const location = await get(
      `SELECT id, warehouse_id FROM locations WHERE id = ? AND tenant_id = ?`,
      [String(locationId).trim(), tenantId]
    );
    if (location?.warehouse_id) {
      const wh = await getWarehouseById(String(location.warehouse_id), tenantId);
      if (wh && Number(wh.is_active) !== 0) {
        return String(wh.id);
      }
    }
  }

  return getDefaultWarehouseId(tenantId);
}

export async function getWarehouseQuantity(warehouseId, productId, tenantId) {
  const row = await getWarehouseStockRow(warehouseId, Number(productId), tenantId);
  return Number(row?.quantity ?? 0) || 0;
}

async function addLayer({
  tenantId,
  warehouseId,
  productId,
  qty,
  unitCost,
  lotCode = null,
  expiryDate = null,
  sourceRef = null,
  receivedAt = null,
  now,
}) {
  const qtyAdd = Number(qty);
  if (!Number.isFinite(qtyAdd) || qtyAdd <= QTY_EPS) return null;
  const id = crypto.randomUUID();
  const received = receivedAt || now;
  await insertStockLayer([
    id,
    tenantId,
    String(warehouseId),
    Number(productId),
    qtyAdd,
    Number.isFinite(Number(unitCost)) ? Number(unitCost) : 0,
    received,
    lotCode != null && String(lotCode).trim() ? String(lotCode).trim() : null,
    expiryDate || null,
    sourceRef || null,
    now,
    now,
  ]);
  return {
    layerId: id,
    qty: qtyAdd,
    unitCost: Number.isFinite(Number(unitCost)) ? Number(unitCost) : 0,
    lotCode: lotCode != null && String(lotCode).trim() ? String(lotCode).trim() : null,
  };
}

/**
 * Consome camadas FIFO; permite stock negativo criando layer com custo 0 se allowNegative.
 */
async function consumeFifoLayers({
  tenantId,
  warehouseId,
  productId,
  qtyNeeded,
  stockMovementId = null,
  allowNegative = false,
  now,
}) {
  let remaining = Number(qtyNeeded);
  if (!Number.isFinite(remaining) || remaining <= QTY_EPS) {
    return { cogsTotal: 0, unitCostFifo: 0, consumptions: [] };
  }

  const layers = await listFifoLayers(tenantId, warehouseId, productId);
  const consumptions = [];
  let cogsTotal = 0;

  for (const layer of layers) {
    if (remaining <= QTY_EPS) break;
    const available = Number(layer.qty_remaining) || 0;
    if (available <= QTY_EPS) continue;
    const take = Math.min(available, remaining);
    const newQty = available - take;
    await updateLayerQtyRemaining(layer.id, tenantId, newQty, now);
    const unitCost = Number(layer.unit_cost) || 0;
    const consumptionId = crypto.randomUUID();
    await insertLayerConsumption([
      consumptionId,
      tenantId,
      stockMovementId,
      String(layer.id),
      take,
      unitCost,
      now,
    ]);
    consumptions.push({
      id: consumptionId,
      layerId: String(layer.id),
      qty: take,
      unitCost,
      lotCode: layer.lot_code ?? null,
    });
    cogsTotal += take * unitCost;
    remaining -= take;
  }

  if (remaining > QTY_EPS) {
    if (!allowNegative) {
      throw new HttpError(409, 'Stock insuficiente no armazém');
    }
    // Stock negativo: não há camada restante; COGS do em falta a custo 0.
    consumptions.push({
      id: null,
      layerId: null,
      qty: remaining,
      unitCost: 0,
      lotCode: null,
      synthetic: true,
    });
    remaining = 0;
  }

  const consumedQty = Number(qtyNeeded) - remaining;
  const unitCostFifo = consumedQty > QTY_EPS ? cogsTotal / consumedQty : 0;
  return { cogsTotal, unitCostFifo, consumptions };
}

/**
 * Aplica delta num armazém, actualiza cache products.stock_quantity e grava ledger + FIFO layers.
 * @returns {{ stockBefore, stockAfter, warehouseQtyBefore, warehouseQtyAfter, totalAfter, cogsTotal?, unitCostFifo?, consumptions? }}
 */
export async function applyWarehouseDelta({
  tenantId,
  warehouseId,
  productId,
  delta,
  movementType,
  referenceId,
  fromWarehouseId = null,
  toWarehouseId = null,
  cost = null,
  lotCode = null,
  trackLot = null,
  requireLot = false,
  expiryDate = null,
  skipLayers = false,
  allowNegative = false,
  skipMovement = false,
} = {}) {
  const pid = Number(productId);
  const qtyDelta = Number(delta);
  if (!tenantId) throw new HttpError(400, 'tenant_id obrigatório');
  if (!warehouseId) throw new HttpError(400, 'warehouse_id obrigatório');
  if (!Number.isFinite(pid) || pid <= 0) throw new HttpError(400, 'product_id inválido');
  if (!Number.isFinite(qtyDelta) || qtyDelta === 0) {
    throw new HttpError(400, 'delta de stock inválido');
  }

  const wh = await getWarehouseById(String(warehouseId), tenantId);
  if (!wh) throw new HttpError(400, 'Armazém inválido');
  if (Number(wh.is_active) === 0) throw new HttpError(400, 'Armazém inactivo');

  const productRow = await getProductStockMeta(pid, tenantId);
  const trackLayers = !skipLayers && shouldTrackStockLayers(productRow);
  const productTracksLot =
    trackLot != null ? Boolean(trackLot) : Number(productRow?.track_lot ?? 0) !== 0;

  if (qtyDelta > 0 && trackLayers && (requireLot || productTracksLot)) {
    const code = lotCode != null ? String(lotCode).trim() : '';
    if (!code) {
      throw new HttpError(400, 'Lote obrigatório');
    }
  }

  const now = new Date().toISOString();
  const warehouseQtyBefore = await getWarehouseQuantity(warehouseId, pid, tenantId);
  const warehouseQtyAfter = warehouseQtyBefore + qtyDelta;

  if (!allowNegative && warehouseQtyAfter < -QTY_EPS) {
    throw new HttpError(409, 'Stock insuficiente no armazém');
  }

  const totalBeforeRow = await sumProductWarehouseStock(pid, tenantId);
  const stockBefore = Number(totalBeforeRow?.total ?? 0) || 0;

  let movementCloudId = null;
  if (!skipMovement) {
    const type = String(movementType || (qtyDelta >= 0 ? 'restock' : 'adjustment'));
    movementCloudId = crypto.randomUUID();
    await insertStockMovementWithWarehouse([
      movementCloudId,
      tenantId,
      pid,
      type,
      qtyDelta,
      String(referenceId || `WH:${crypto.randomUUID()}`),
      String(warehouseId),
      fromWarehouseId ? String(fromWarehouseId) : null,
      toWarehouseId ? String(toWarehouseId) : null,
      now,
      now,
    ]);
  }

  let cogsTotal = 0;
  let unitCostFifo = 0;
  let consumptions = [];
  let addedLayer = null;

  if (trackLayers) {
    if (qtyDelta > 0) {
      let unitCost = cost != null && Number.isFinite(Number(cost)) ? Number(cost) : null;
      if (unitCost == null) {
        unitCost = Number(productRow?.cost ?? 0) || 0;
      }
      addedLayer = await addLayer({
        tenantId,
        warehouseId,
        productId: pid,
        qty: qtyDelta,
        unitCost,
        lotCode,
        expiryDate,
        sourceRef: referenceId ? String(referenceId) : null,
        now,
      });
    } else {
      const consumed = await consumeFifoLayers({
        tenantId,
        warehouseId,
        productId: pid,
        qtyNeeded: Math.abs(qtyDelta),
        stockMovementId: movementCloudId,
        allowNegative,
        now,
      });
      cogsTotal = consumed.cogsTotal;
      unitCostFifo = consumed.unitCostFifo;
      consumptions = consumed.consumptions;
    }
  }

  await upsertWarehouseStockDelta(String(warehouseId), pid, tenantId, qtyDelta, now);
  await refreshProductStockCache(pid, tenantId, now);

  if (trackLayers) {
    await recalcProductCostCache(pid, tenantId, now);
    try {
      const layerSum = await sumLayersRemaining(tenantId, warehouseId, pid);
      const layerQty = Number(layerSum?.total ?? 0) || 0;
      const whQty = await getWarehouseQuantity(warehouseId, pid, tenantId);
      if (Math.abs(layerQty - Math.max(0, whQty)) > 0.01 && whQty >= 0) {
        logWarn('fifo_layers_divergence', {
          module: 'warehouseStock',
          reason: 'Camadas FIFO (stock_layers) e warehouse_stock divergem para este produto/armazém',
          product_id: pid,
          warehouse_id: warehouseId,
          layers_qty: layerQty,
          warehouse_qty: whQty,
        });
      }
    } catch {
      /* ignore assert noise */
    }
  }

  const totalAfterRow = await sumProductWarehouseStock(pid, tenantId);
  const stockAfter = Number(totalAfterRow?.total ?? 0) || 0;

  return {
    stockBefore,
    stockAfter,
    warehouseQtyBefore,
    warehouseQtyAfter,
    totalAfter: stockAfter,
    warehouseId: String(warehouseId),
    cogsTotal,
    unitCostFifo,
    consumptions,
    addedLayer,
    movementId: movementCloudId,
  };
}

/**
 * Define quantidade absoluta num armazém (inventário).
 * ↑ cria layer com custo actual; ↓ consome FIFO.
 */
export async function setWarehouseQuantity({
  tenantId,
  warehouseId,
  productId,
  quantity,
  referenceId = null,
  cost = null,
  lotCode = null,
  requireLot = false,
  allowNegative = false,
} = {}) {
  const pid = Number(productId);
  const counted = Number(quantity);
  if (!Number.isFinite(counted)) throw new HttpError(400, 'Quantidade inválida');
  if (!allowNegative && counted < 0) throw new HttpError(400, 'Quantidade não pode ser negativa');

  const warehouseQtyBefore = await getWarehouseQuantity(warehouseId, pid, tenantId);
  const delta = counted - warehouseQtyBefore;
  if (Math.abs(delta) < 1e-12) {
    const totalRow = await sumProductWarehouseStock(pid, tenantId);
    const total = Number(totalRow?.total ?? 0) || 0;
    return {
      updated: false,
      unchanged: true,
      stockBefore: total,
      stockAfter: total,
      warehouseQtyBefore,
      warehouseQtyAfter: warehouseQtyBefore,
      quantityDelta: 0,
      warehouseId: String(warehouseId),
      cogsTotal: 0,
      unitCostFifo: 0,
      consumptions: [],
    };
  }

  const movementType = delta >= 0 ? 'restock' : 'adjustment';
  const result = await applyWarehouseDelta({
    tenantId,
    warehouseId,
    productId: pid,
    delta,
    movementType,
    referenceId: referenceId || `INV-COUNT:${crypto.randomUUID()}`,
    cost: delta > 0 ? cost : null,
    lotCode: delta > 0 ? lotCode : null,
    requireLot: delta > 0 ? requireLot : false,
    allowNegative: true,
  });

  return {
    updated: true,
    unchanged: false,
    quantityDelta: delta,
    ...result,
  };
}

/**
 * Transferência A→B: origem consome FIFO; destino cria layers com mesmo unit_cost/lot_code.
 */
export async function transferWarehouseStock({
  tenantId,
  fromWarehouseId,
  toWarehouseId,
  productId,
  quantity,
  referenceId,
  allowNegative = false,
} = {}) {
  const qty = Number(quantity);
  if (!Number.isFinite(qty) || qty <= 0) {
    throw new HttpError(400, 'Quantidade de transferência inválida');
  }
  if (String(fromWarehouseId) === String(toWarehouseId)) {
    throw new HttpError(400, 'Armazém de origem e destino devem ser diferentes');
  }

  const ref = String(referenceId || `WH/TR:${crypto.randomUUID()}`);
  const now = new Date().toISOString();
  const pid = Number(productId);

  const outResult = await applyWarehouseDelta({
    tenantId,
    warehouseId: fromWarehouseId,
    productId: pid,
    delta: -qty,
    movementType: 'transfer_out',
    referenceId: `${ref}:out`,
    fromWarehouseId,
    toWarehouseId,
    allowNegative,
  });

  const consumptions = Array.isArray(outResult.consumptions) ? outResult.consumptions : [];
  const realConsumptions = consumptions.filter((c) => c && !c.synthetic && c.qty > QTY_EPS);

  if (realConsumptions.length > 0) {
    // Ledger da entrada + layers espelhadas (skipLayers no apply genérico; addLayer manual).
    const movementCloudId = crypto.randomUUID();
    await insertStockMovementWithWarehouse([
      movementCloudId,
      tenantId,
      pid,
      'transfer_in',
      qty,
      `${ref}:in`,
      String(toWarehouseId),
      String(fromWarehouseId),
      String(toWarehouseId),
      now,
      now,
    ]);

    for (const c of realConsumptions) {
      await addLayer({
        tenantId,
        warehouseId: toWarehouseId,
        productId: pid,
        qty: c.qty,
        unitCost: c.unitCost,
        lotCode: c.lotCode,
        sourceRef: `${ref}:in`,
        receivedAt: now,
        now,
      });
    }

    await upsertWarehouseStockDelta(String(toWarehouseId), pid, tenantId, qty, now);
    await refreshProductStockCache(pid, tenantId, now);
    await recalcProductCostCache(pid, tenantId, now);
  } else {
    // Sem layers (serviço/composed) ou override: fallback qty-only.
    await applyWarehouseDelta({
      tenantId,
      warehouseId: toWarehouseId,
      productId: pid,
      delta: qty,
      movementType: 'transfer_in',
      referenceId: `${ref}:in`,
      fromWarehouseId,
      toWarehouseId,
      allowNegative: true,
      skipLayers: true,
    });
  }

  return {
    ok: true,
    referenceId: ref,
    quantity: qty,
    unitCostFifo: outResult.unitCostFifo,
    cogsTotal: outResult.cogsTotal,
    consumptions: outResult.consumptions,
  };
}
