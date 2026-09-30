/**
 * Etapa 1G.2B.5 - lado local das transferencias Store -> Store (offline-first). Uma so BD SQLite temporaria faz
 * os dois papeis (origem = direction 'out', destino = direction 'in'), sem cloud.
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'posly-1g2b5-'));
process.env.POS_DB_PATH = path.join(tmpDir, 'database.db');
process.env.DEFAULT_TENANT_ID = 'tenant-1g2b5';

const db = (await import('../../api/database.js')).default;
const wh = await import('../../api/services/warehouseStock.service.js');
const tr = await import('../../api/services/storeTransfers.service.js');
const led = await import('../../api/stockLedgerSync.js');

const T = 'tenant-1g2b5';
const uuid = () => crypto.randomUUID();
const now = () => new Date().toISOString();
const runDb = (s, p = []) => new Promise((res, rej) => db.run(s, p, (e) => (e ? rej(e) : res())));
const allDb = (s, p = []) => new Promise((res, rej) => db.all(s, p, (e, r) => (e ? rej(e) : res(r))));
const ctx = {};
const qty = (w) => wh.getWarehouseQuantity(w, ctx.pid, T);

test('setup: 10 un a custo 3 e 5 un a custo 4 na origem (A1); armazém do destino (B1) vazio', async () => {
  const deadline = Date.now() + 8000;
  for (;;) {
    try { await allDb('SELECT 1 FROM stock_transfers LIMIT 1'); await allDb('SELECT 1 FROM stock_layers LIMIT 1'); break; } catch (e) { if (Date.now() > deadline) throw e; await new Promise((r) => setTimeout(r, 100)); }
  }
  ctx.cP = uuid();
  await runDb(`INSERT INTO products (cloud_id, tenant_id, name, price, cost, created_at, updated_at) VALUES (?, ?, 'P', 5, 3, ?, ?)`, [ctx.cP, T, now(), now()]);
  ctx.pid = (await allDb(`SELECT id FROM products WHERE cloud_id = ?`, [ctx.cP]))[0].id;
  ctx.A1 = String((await wh.ensureDefaultWarehouse(T)).id);
  ctx.B1 = uuid();
  await runDb(`INSERT INTO warehouses (id, tenant_id, name, is_default, is_active, created_at, updated_at) VALUES (?, ?, 'DestB', 0, 1, ?, ?)`, [ctx.B1, T, now(), now()]);
  await wh.applyWarehouseDelta({ tenantId: T, warehouseId: ctx.A1, productId: ctx.pid, delta: 10, movementType: 'restock', referenceId: 'R1', cost: 3 });
  await wh.applyWarehouseDelta({ tenantId: T, warehouseId: ctx.A1, productId: ctx.pid, delta: 5, movementType: 'restock', referenceId: 'R2', cost: 4 });
  assert.equal(await qty(ctx.A1), 15);
  ctx.storeB = uuid();
});

test('draft: cancelável localmente; não mexe em stock; produto sem cloud_id é recusado', async () => {
  const d = await tr.createDraft({ tenantId: T, toStoreId: ctx.storeB, fromWarehouseId: ctx.A1, items: [{ productId: ctx.pid, qty: 2 }] });
  assert.equal(await qty(ctx.A1), 15);
  await tr.cancelDraft(d.id, T);
  await assert.rejects(tr.cancelDraft(d.id, T), /rascunho/);
  await runDb(`INSERT INTO products (tenant_id, name, price, created_at, updated_at) VALUES (?, 'Local', 5, ?, ?)`, [T, now(), now()]);
  const lp = (await allDb(`SELECT id FROM products WHERE name = 'Local'`))[0].id;
  await assert.rejects(tr.createDraft({ tenantId: T, toStoreId: ctx.storeB, items: [{ productId: lp, qty: 1 }] }), /sincronizado/);
});

test('dispatch offline: debita só a origem, custo FIFO enviado (3 e 4), CAS impede segundo dispatch', async () => {
  const d = await tr.createDraft({ tenantId: T, toStoreId: ctx.storeB, fromWarehouseId: ctx.A1, items: [{ productId: ctx.pid, qty: 12 }] });
  ctx.out = d.id;
  await tr.dispatchLocal(d.id, T);
  assert.equal(await qty(ctx.A1), 3);
  assert.equal(await qty(ctx.B1), 0);
  await assert.rejects(tr.dispatchLocal(d.id, T), /rascunho/);
  await assert.rejects(tr.cancelDraft(d.id, T), /rascunho/, 'pós-dispatch não se cancela localmente');
  const { dispatch } = await tr.collectPendingTransfers(T);
  assert.equal(dispatch.length, 1);
  const layers = dispatch[0].payload.items[0].cost_layers;
  assert.deepEqual(layers.map((l) => [l.qty, l.unit_cost]), [[10, 3], [2, 4]]);
  assert.equal(dispatch[0].payload.items[0].qty, 12);
});

test('dispatch com stock insuficiente falha e faz rollback (continua rascunho, sem débito)', async () => {
  const d = await tr.createDraft({ tenantId: T, toStoreId: ctx.storeB, fromWarehouseId: ctx.A1, items: [{ productId: ctx.pid, qty: 50 }] });
  await assert.rejects(tr.dispatchLocal(d.id, T));
  assert.equal(await qty(ctx.A1), 3);
  assert.equal((await allDb(`SELECT status FROM stock_transfers WHERE id = ? AND direction = 'out'`, [d.id]))[0].status, 'draft');
  await tr.cancelDraft(d.id, T);
});

test('movimentos de transferência nunca vão pelo sync do ledger; a abertura continua coerente', async () => {
  const { groups } = await led.collectLedgerGroups({ tenantId: T });
  assert.ok(groups.flat().every((i) => !String(i.reference_id).startsWith('transfer:')));
  const { groups: opening, zero } = await led.collectOpeningGroups({ tenantId: T });
  assert.equal(opening.length, 0);
  assert.ok(zero.length >= 1);
});

test('destino: pull cria a transferência "in" (dispatched); receive parcial guarda divergência e cria camadas com o custo enviado', async () => {
  ctx.inId = uuid();
  const remote = { id: ctx.inId, direction: 'in', to_store_id: ctx.storeB, from_warehouse_id: uuid(), to_warehouse_id: null, status: 'dispatched', note: null, has_divergence: false, created_at: now(), dispatched_at: now() };
  const items = new Map([[ctx.inId, [{ product_id: ctx.cP, qty_requested: 4, qty_sent: 4, qty_received: null, cost_layers: [{ qty: 3, unit_cost: 3, lot_code: null }, { qty: 1, unit_cost: 4, lot_code: null }] }]]]);
  const bad = new Map([[uuid(), [{ product_id: uuid(), qty_requested: 1, qty_sent: 1, cost_layers: [] }]]]);
  const badRow = { ...remote, id: [...bad.keys()][0] };
  const s = await tr.applyRemoteTransfers(T, [remote, badRow], new Map([...items, ...bad]));
  assert.deepEqual([s.created, s.incomplete], [1, 1], 'produto mestre desconhecido: tenta de novo no próximo ciclo');
  assert.equal(await qty(ctx.B1), 0, 'antes do receive o destino não tem stock');
  await assert.rejects(tr.receiveLocal(uuid(), T, { items: [] }), /não conhecida/);

  const r = await tr.receiveLocal(ctx.inId, T, { toWarehouseId: ctx.B1, items: [{ productId: ctx.pid, qtyReceived: 3 }] });
  assert.equal(r.divergence, true);
  assert.equal(await qty(ctx.B1), 3);
  await assert.rejects(tr.receiveLocal(ctx.inId, T, { toWarehouseId: ctx.B1, items: [{ productId: ctx.pid, qtyReceived: 3 }] }), /pendente/, 'segundo receive perde o CAS');
  const layers = await allDb(`SELECT qty_remaining, unit_cost FROM stock_layers WHERE warehouse_id = ? AND product_id = ? ORDER BY unit_cost`, [ctx.B1, ctx.pid]);
  assert.deepEqual(layers.map((l) => [l.qty_remaining, l.unit_cost]), [[3, 3]], '3 recebidos vêm das camadas enviadas (FIFO: primeiro custo 3)');
  assert.equal((await allDb(`SELECT divergence FROM stock_transfers WHERE id = ? AND direction = 'in'`, [ctx.inId]))[0].divergence, 1);
  assert.equal((await allDb(`SELECT COUNT(*) AS n FROM stock_movements WHERE reference_id LIKE ? AND movement_type = 'adjustment'`, [`transfer:${ctx.inId}%`]))[0].n, 0, 'sem ajuste automático');
  const { receive } = await tr.collectPendingTransfers(T);
  assert.deepEqual(receive[0].items, [{ product_id: ctx.cP, qty_received: 3 }]);
});

test('cloud cancela: origem recebe movimento compensatório (custo devolvido); destino que já creditou reverte; idempotente', async () => {
  const a1Before = await qty(ctx.A1);
  const res = await tr.applyCloudCancellation(ctx.out, 'out', T, { reason: 'x' });
  assert.deepEqual([res.applied, res.compensated], [true, true]);
  assert.equal(await qty(ctx.A1), a1Before + 12);
  assert.equal((await tr.applyCloudCancellation(ctx.out, 'out', T)).applied, false, 'idempotente: sem duplo crédito');
  assert.equal(await qty(ctx.A1), a1Before + 12);
  assert.equal((await allDb(`SELECT COUNT(*) AS n FROM stock_movements WHERE reference_id = ?`, [`transfer:${ctx.out}:${ctx.cP}:reversal`]))[0].n, 1);
  const layers = await allDb(`SELECT SUM(qty_remaining) AS q FROM stock_layers WHERE warehouse_id = ? AND product_id = ?`, [ctx.A1, ctx.pid]);
  assert.equal(Number(layers[0].q), 15, 'camadas FIFO da origem repostas');

  const b1Before = await qty(ctx.B1);
  const rev = await tr.applyCloudCancellation(ctx.inId, 'in', T, { rejected: true });
  assert.equal(rev.compensated, true);
  assert.equal(await qty(ctx.B1), b1Before - 3);
  assert.equal((await tr.collectPendingTransfers(T)).receive.length, 0);
});
