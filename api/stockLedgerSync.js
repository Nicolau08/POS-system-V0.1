/**
 * Etapa 1G.2B.3 - sync local -> cloud dos movimentos de stock que nao sao vendas (entradas,
 * ajustes, transferencias entre armazens da mesma Store) + saldo de abertura + reconciliacao.
 *
 * Este modulo so le/escreve a BD local (testavel sem cloud). A chamada RPC vive em syncService.js.
 * Ledger cloud = autoridade; divergencias sao DETECTADAS/REPORTADAS, nunca corrigidas em silencio.
 */
import { all, get, run } from './dbUtils.js';
import { isUuidString } from './cloudIdUtils.js';

const EPS = 0.0001;
const BATCH_LIMIT = 200;
export const SYNCABLE = ['restock', 'adjustment', 'transfer_out', 'transfer_in'];

// Linhas ja resolvidas (synced/conflict/rejected) ou vindas da cloud (pulled) nao voltam a ser enviadas.
const NOT_ELIGIBLE_SQL = `
  m.warehouse_id IS NOT NULL
  AND m.reference_id NOT LIKE 'order:%'
  AND m.reference_id NOT LIKE 'transfer:%'
  AND NOT EXISTS (SELECT 1 FROM stock_ledger_sync s WHERE s.movement_id = m.id)`;

export async function ensureStockLedgerTables() {
  await run(`CREATE TABLE IF NOT EXISTS stock_ledger_sync (
    movement_id INTEGER PRIMARY KEY,
    status TEXT NOT NULL CHECK (status IN ('synced', 'conflict', 'rejected', 'pulled')),
    error TEXT,
    updated_at TEXT NOT NULL
  )`);
  await run(`CREATE TABLE IF NOT EXISTS stock_opening_sync (
    warehouse_id TEXT NOT NULL,
    product_id INTEGER NOT NULL,
    quantity REAL NOT NULL,
    reference_id TEXT,
    status TEXT NOT NULL CHECK (status IN ('synced', 'zero', 'conflict', 'rejected')),
    error TEXT,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (warehouse_id, product_id)
  )`);
}

/** Marca um movimento local como vindo da cloud (historico apenas; nunca reenviado, nunca conta para o saldo de abertura). */
export async function markMovementPulled(cloudId) {
  await ensureStockLedgerTables();
  await run(
    `INSERT OR REPLACE INTO stock_ledger_sync (movement_id, status, updated_at)
     SELECT id, 'pulled', ? FROM stock_movements WHERE cloud_id = ?`,
    [new Date().toISOString(), String(cloudId)]
  );
}

async function costLayersForMovement(m, partner) {
  const consumptionsOf = async (movementCloudId) =>
    (
      await all(
        `SELECT c.qty AS qty, c.unit_cost AS unit_cost, l.lot_code AS lot_code
         FROM stock_layer_consumptions c
         LEFT JOIN stock_layers l ON l.id = c.layer_id
         WHERE c.tenant_id = ? AND c.stock_movement_id = ?`,
        [m.tenant_id, String(movementCloudId)]
      )
    )
      .filter((c) => Number(c.qty) > EPS)
      .map((c) => ({ qty: Number(c.qty), unit_cost: Number(c.unit_cost), lot_code: c.lot_code ?? null }));

  if (m.movement_type === 'transfer_out') {
    const layers = await consumptionsOf(m.cloud_id);
    return layers.length ? layers : null;
  }
  if (m.movement_type === 'transfer_in') {
    // o destino recebe as camadas exactamente como saíram da origem (custo FIFO viaja com a transferência)
    if (!partner) return null;
    const layers = await consumptionsOf(partner.cloud_id);
    return layers.length ? layers : null;
  }
  if (Number(m.quantity) > 0) {
    const layers = await all(
      `SELECT unit_cost, lot_code, qty_remaining FROM stock_layers
       WHERE tenant_id = ? AND warehouse_id = ? AND product_id = ? AND source_ref = ?`,
      [m.tenant_id, m.warehouse_id, m.product_id, m.reference_id]
    );
    if (layers.length === 0) return null;
    if (layers.length === 1) {
      return [{ qty: Number(m.quantity), unit_cost: Number(layers[0].unit_cost), lot_code: layers[0].lot_code ?? null }];
    }
    const totalRemaining = layers.reduce((s, l) => s + Number(l.qty_remaining || 0), 0);
    const weighted = totalRemaining > EPS
      ? layers.reduce((s, l) => s + Number(l.qty_remaining || 0) * Number(l.unit_cost || 0), 0) / totalRemaining
      : Number(layers[0].unit_cost);
    return [{ qty: Number(m.quantity), unit_cost: weighted, lot_code: null }];
  }
  return null;
}

const toItem = (m, productCloudId, costLayers) => ({
  reference_id: m.reference_id,
  type: m.movement_type,
  product_id: productCloudId,
  warehouse_id: m.warehouse_id,
  from_warehouse_id: m.from_warehouse_id ?? null,
  to_warehouse_id: m.to_warehouse_id ?? null,
  quantity: Number(m.quantity),
  created_at: m.created_at,
  cost_layers: costLayers,
});

/**
 * Constroi grupos atómicos para a RPC. Cada grupo = [movimento] ou [transfer_out, transfer_in].
 * Devolve { groups, index } onde index mapeia "type|reference_id" -> id local (para registar resultados).
 */
export async function collectLedgerGroups({ tenantId, limit = BATCH_LIMIT } = {}) {
  await ensureStockLedgerTables();
  const rows = await all(
    `SELECT m.*, p.cloud_id AS product_cloud_id
     FROM stock_movements m
     JOIN products p ON p.id = m.product_id AND p.tenant_id = m.tenant_id
     WHERE m.tenant_id = ?
       AND m.movement_type IN (${SYNCABLE.map(() => '?').join(',')})
       AND ${NOT_ELIGIBLE_SQL}
       AND p.cloud_id IS NOT NULL
     ORDER BY m.id ASC
     LIMIT ?`,
    [tenantId, ...SYNCABLE, limit]
  );

  const groups = [];
  const index = new Map();
  const used = new Set();
  const key = (m) => `${m.movement_type}|${m.reference_id}`;

  for (const m of rows) {
    if (used.has(m.id)) continue;
    if (!isUuidString(String(m.warehouse_id)) || !isUuidString(String(m.product_cloud_id))) continue;
    used.add(m.id);
    const isTransfer = m.movement_type === 'transfer_out' || m.movement_type === 'transfer_in';
    if (!isTransfer) {
      groups.push([toItem(m, m.product_cloud_id, await costLayersForMovement(m, null))]);
      index.set(key(m), m.id);
      continue;
    }
    const isOut = m.movement_type === 'transfer_out';
    const partnerRef = isOut ? m.reference_id.replace(/:out$/, ':in') : m.reference_id.replace(/:in$/, ':out');
    const partner = await get(
      `SELECT m.* FROM stock_movements m
       WHERE m.tenant_id = ? AND m.product_id = ? AND m.movement_type = ? AND m.reference_id = ?
         AND ${NOT_ELIGIBLE_SQL}`,
      [m.tenant_id, m.product_id, isOut ? 'transfer_in' : 'transfer_out', partnerRef]
    );
    const outRow = isOut ? m : partner;
    const inRow = isOut ? partner : m;
    const group = [];
    if (outRow) {
      group.push(toItem(outRow, m.product_cloud_id, await costLayersForMovement(outRow, null)));
      index.set(key(outRow), outRow.id);
      used.add(outRow.id);
    }
    if (inRow) {
      group.push(toItem(inRow, m.product_cloud_id, await costLayersForMovement(inRow, outRow)));
      index.set(key(inRow), inRow.id);
      used.add(inRow.id);
    }
    groups.push(group);
  }
  return { groups, index };
}

/** Saldo de abertura = saldo local SEM historico (saldo - soma dos movimentos locais). Avaliado uma unica vez por produto+armazem. */
export async function collectOpeningGroups({ tenantId } = {}) {
  await ensureStockLedgerTables();
  const rows = await all(
    `SELECT ws.warehouse_id AS warehouse_id, ws.product_id AS product_id, ws.quantity AS quantity,
            p.cloud_id AS product_cloud_id, p.cost AS product_cost,
            COALESCE((
              SELECT SUM(m.quantity) FROM stock_movements m
              WHERE m.tenant_id = ws.tenant_id AND m.product_id = ws.product_id AND m.warehouse_id = ws.warehouse_id
                AND m.reference_id NOT LIKE 'order:%'
                AND NOT EXISTS (SELECT 1 FROM stock_ledger_sync s WHERE s.movement_id = m.id AND s.status = 'pulled')
            ), 0) AS movements_sum
     FROM warehouse_stock ws
     JOIN products p ON p.id = ws.product_id AND p.tenant_id = ws.tenant_id
     WHERE ws.tenant_id = ?
       AND p.cloud_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM stock_opening_sync o WHERE o.warehouse_id = ws.warehouse_id AND o.product_id = ws.product_id)`,
    [tenantId]
  );
  const groups = [];
  const index = new Map();
  const zero = [];
  for (const r of rows) {
    if (!isUuidString(String(r.warehouse_id)) || !isUuidString(String(r.product_cloud_id))) continue;
    const base = Number(r.quantity) - Number(r.movements_sum);
    if (Math.abs(base) <= EPS) {
      zero.push(r);
      continue;
    }
    const ref = `opening:${r.warehouse_id}:${r.product_cloud_id}`;
    groups.push([
      {
        reference_id: ref,
        type: 'opening',
        product_id: r.product_cloud_id,
        warehouse_id: r.warehouse_id,
        from_warehouse_id: null,
        to_warehouse_id: null,
        quantity: base,
        created_at: new Date().toISOString(),
        cost_layers: base > 0 ? [{ qty: base, unit_cost: Number(r.product_cost ?? 0), source: 'product_cost' }] : null,
      },
    ]);
    index.set(`opening|${ref}`, { warehouse_id: r.warehouse_id, product_id: r.product_id, quantity: base, ref });
  }
  return { groups, index, zero };
}

export async function recordZeroOpenings(zero) {
  const now = new Date().toISOString();
  for (const r of zero) {
    await run(
      `INSERT OR IGNORE INTO stock_opening_sync (warehouse_id, product_id, quantity, reference_id, status, updated_at)
       VALUES (?, ?, 0, NULL, 'zero', ?)`,
      [r.warehouse_id, r.product_id, now]
    );
  }
}

/** Regista o resultado da RPC. 'retry' nao e registado (volta a tentar). Devolve contadores. */
export async function recordLedgerResults(results, { index, opening = false } = {}) {
  const now = new Date().toISOString();
  const summary = { synced: 0, duplicate: 0, conflict: 0, rejected: 0, retry: 0 };
  for (const r of results ?? []) {
    const status = String(r.out_status ?? r.status);
    const ref = String(r.out_reference_id ?? r.ref);
    const type = String(r.out_type ?? r.type);
    const error = r.out_error ?? r.error ?? null;
    const target = index.get(`${type}|${ref}`);
    if (!target) continue;
    if (status === 'retry') {
      summary.retry += 1;
      continue;
    }
    const resolved = status === 'inserted' || status === 'duplicate' ? 'synced' : status;
    if (status === 'inserted') summary.synced += 1;
    else if (status in summary) summary[status] += 1;
    if (opening) {
      await run(
        `INSERT OR REPLACE INTO stock_opening_sync (warehouse_id, product_id, quantity, reference_id, status, error, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [target.warehouse_id, target.product_id, target.quantity, target.ref, resolved, error, now]
      );
    } else {
      await run(
        `INSERT OR REPLACE INTO stock_ledger_sync (movement_id, status, error, updated_at) VALUES (?, ?, ?, ?)`,
        [target, resolved, error, now]
      );
    }
  }
  return summary;
}

export async function countPendingLedger(tenantId) {
  await ensureStockLedgerTables();
  const row = await get(
    `SELECT COUNT(*) AS n FROM stock_movements m
     WHERE m.tenant_id = ? AND m.movement_type IN (${SYNCABLE.map(() => '?').join(',')}) AND ${NOT_ELIGIBLE_SQL}`,
    [tenantId, ...SYNCABLE]
  );
  return Number(row?.n ?? 0);
}

/**
 * Compara saldo local (warehouse_stock) com o derivado do ledger cloud, por produto+armazem.
 * cloudRows: [{ warehouse_id, product_id (uuid cloud), quantity }]. Nunca altera nenhum saldo.
 */
export async function computeReconciliation({ tenantId, cloudRows, pendingSales = 0 } = {}) {
  await ensureStockLedgerTables();
  const localRows = await all(
    `SELECT ws.warehouse_id AS warehouse_id, ws.product_id AS product_id, ws.quantity AS quantity, p.cloud_id AS product_cloud_id, p.name AS product_name
     FROM warehouse_stock ws
     JOIN products p ON p.id = ws.product_id AND p.tenant_id = ws.tenant_id
     WHERE ws.tenant_id = ?`,
    [tenantId]
  );
  const pendingLedger = await countPendingLedger(tenantId);
  const cloudMap = new Map((cloudRows ?? []).map((r) => [`${r.warehouse_id}|${r.product_id}`, Number(r.quantity)]));
  const seen = new Set();
  const items = [];
  for (const r of localRows) {
    if (!r.product_cloud_id) continue;
    const k = `${r.warehouse_id}|${r.product_cloud_id}`;
    seen.add(k);
    const cloud = cloudMap.get(k) ?? 0;
    const local = Number(r.quantity);
    items.push({
      warehouse_id: r.warehouse_id,
      product_id: r.product_id,
      product_cloud_id: r.product_cloud_id,
      local,
      cloud,
      diff: local - cloud,
      status: Math.abs(local - cloud) <= EPS ? 'equal' : 'divergent',
    });
  }
  for (const [k, cloud] of cloudMap.entries()) {
    if (seen.has(k) || Math.abs(cloud) <= EPS) continue;
    const [warehouse_id, product_cloud_id] = k.split('|');
    items.push({ warehouse_id, product_id: null, product_cloud_id, local: 0, cloud, diff: -cloud, status: 'divergent' });
  }
  const divergent = items.filter((i) => i.status === 'divergent');
  return {
    checked: items.length,
    divergent_count: divergent.length,
    divergent,
    pending_sync: pendingLedger > 0 || pendingSales > 0,
    pending_ledger: pendingLedger,
    pending_sales: pendingSales,
    generated_at: new Date().toISOString(),
  };
}
