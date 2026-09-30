/**
 * Etapa 1G.2B.3 - lado local do sync do ledger: movimentos não-venda, transferência (par atómico com
 * custo FIFO), saldo de abertura (sem duplicar nem inventar histórico), exclusão do histórico vindo da
 * cloud e reconciliação (só reporta). BD SQLite real temporária, sem cloud.
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'posly-1g2b3-'));
process.env.POS_DB_PATH = path.join(tmpDir, 'database.db');
process.env.DEFAULT_TENANT_ID = 'tenant-1g2b3';

const db = (await import('../../api/database.js')).default;
const svc = await import('../../api/services/warehouseStock.service.js');
const led = await import('../../api/stockLedgerSync.js');

const T = 'tenant-1g2b3';
const runDb = (sql, params = []) => new Promise((res, rej) => db.run(sql, params, (e) => (e ? rej(e) : res())));
const allDb = (sql, params = []) => new Promise((res, rej) => db.all(sql, params, (e, r) => (e ? rej(e) : res(r))));
const now = () => new Date().toISOString();
const ctx = {};

async function ready() {
  const deadline = Date.now() + 8000;
  for (;;) {
    try {
      await allDb('SELECT warehouse_id FROM locations LIMIT 1');
      await allDb('SELECT 1 FROM stock_layers LIMIT 1');
      return;
    } catch (e) {
      if (Date.now() > deadline) throw e;
      await new Promise((r) => setTimeout(r, 100));
    }
  }
}

test('setup: saldo legado sem histórico (10 un em A1) + restock, ajuste e transferência A1->A2', async () => {
  await ready();
  ctx.p1cloud = crypto.randomUUID();
  await runDb(
    `INSERT INTO products (cloud_id, tenant_id, name, price, cost, stock_quantity, created_at, updated_at) VALUES (?, ?, 'P1', 5, 3, 10, ?, ?)`,
    [ctx.p1cloud, T, now(), now()]
  );
  ctx.pid = (await allDb(`SELECT id FROM products WHERE cloud_id = ?`, [ctx.p1cloud]))[0].id;
  ctx.A1 = String((await svc.ensureDefaultWarehouse(T)).id);
  ctx.A2 = crypto.randomUUID();
  await runDb(`INSERT INTO warehouses (id, tenant_id, name, is_default, is_active, created_at, updated_at) VALUES (?, ?, 'Bar', 0, 1, ?, ?)`, [ctx.A2, T, now(), now()]);

  await svc.applyWarehouseDelta({ tenantId: T, warehouseId: ctx.A1, productId: ctx.pid, delta: 5, movementType: 'restock', referenceId: 'RST:1', cost: 4 });
  await svc.applyWarehouseDelta({ tenantId: T, warehouseId: ctx.A1, productId: ctx.pid, delta: -2, movementType: 'adjustment', referenceId: 'ADJ:1' });
  await svc.transferWarehouseStock({ tenantId: T, fromWarehouseId: ctx.A1, toWarehouseId: ctx.A2, productId: ctx.pid, quantity: 4, referenceId: 'WH/TR:1' });
  assert.equal(await svc.getWarehouseQuantity(ctx.A1, ctx.pid, T), 9);
  assert.equal(await svc.getWarehouseQuantity(ctx.A2, ctx.pid, T), 4);

  // histórico vindo da cloud (movimento de restock alheio + venda 'order:'): nunca reenviado, nunca conta na abertura
  const pulledId = crypto.randomUUID();
  await runDb(
    `INSERT INTO stock_movements (cloud_id, tenant_id, product_id, movement_type, quantity, reference_id, created_at, updated_at) VALUES (?, ?, ?, 'restock', 100, 'PULLED:1', ?, ?)`,
    [pulledId, T, ctx.pid, now(), now()]
  );
  await led.markMovementPulled(pulledId);
  await runDb(
    `INSERT INTO stock_movements (cloud_id, tenant_id, product_id, movement_type, quantity, reference_id, created_at, updated_at) VALUES (?, ?, ?, 'sale', -1, 'order:abc', ?, ?)`,
    [crypto.randomUUID(), T, ctx.pid, now(), now()]
  );
  await svc.ensureDefaultWarehouse(T); // o backfill atribui o armazém default às linhas sem armazém
});

test('movimentos não-venda: 3 grupos (restock, ajuste, par transferência) e nada do histórico da cloud', async () => {
  const { groups } = await led.collectLedgerGroups({ tenantId: T });
  const items = groups.flat();
  assert.equal(groups.length, 3);
  assert.deepEqual(items.map((i) => i.reference_id).sort(), ['ADJ:1', 'RST:1', 'WH/TR:1:in', 'WH/TR:1:out']);
  assert.ok(items.every((i) => i.product_id === ctx.p1cloud && i.type !== 'sale'));
  const pair = groups.find((g) => g.length === 2);
  assert.deepEqual(pair.map((i) => i.type), ['transfer_out', 'transfer_in']);
  assert.equal(pair[0].warehouse_id, ctx.A1);
  assert.equal(pair[1].warehouse_id, ctx.A2);
  assert.equal(pair[0].from_warehouse_id, ctx.A1);
  assert.equal(pair[0].to_warehouse_id, ctx.A2);
  assert.equal(Number(pair[0].quantity) + Number(pair[1].quantity), 0);
});

test('custo/FIFO viaja: restock com custo 4; transfer_in leva exactamente as camadas consumidas pelo transfer_out', async () => {
  const { groups } = await led.collectLedgerGroups({ tenantId: T });
  const restock = groups.flat().find((i) => i.reference_id === 'RST:1');
  assert.equal(restock.cost_layers[0].unit_cost, 4);
  const [out, inn] = groups.find((g) => g.length === 2);
  assert.ok(Array.isArray(out.cost_layers) && out.cost_layers.length > 0);
  assert.deepEqual(inn.cost_layers, out.cost_layers);
  const qty = out.cost_layers.reduce((s, l) => s + l.qty, 0);
  assert.equal(qty, 4);
});

test('abertura: só o saldo sem histórico (10 em A1); A2 zero; excluídos pulled/order', async () => {
  const { groups, zero } = await led.collectOpeningGroups({ tenantId: T });
  assert.equal(groups.length, 1);
  const [o] = groups[0];
  assert.equal(o.type, 'opening');
  assert.equal(o.warehouse_id, ctx.A1);
  assert.equal(o.quantity, 10);
  assert.equal(o.reference_id, `opening:${ctx.A1}:${ctx.p1cloud}`);
  assert.equal(zero.length, 1);
  assert.equal(zero[0].warehouse_id, ctx.A2);
});

test('resultados: inserted marca synced; retry volta a ser enviado; conflict/rejected não são repetidos', async () => {
  const opening = await led.collectOpeningGroups({ tenantId: T });
  await led.recordZeroOpenings(opening.zero);
  const o = opening.groups[0][0];
  await led.recordLedgerResults([{ out_reference_id: o.reference_id, out_type: 'opening', out_status: 'inserted' }], { index: opening.index, opening: true });
  const again = await led.collectOpeningGroups({ tenantId: T });
  assert.equal(again.groups.length, 0, 'abertura avaliada uma única vez (nunca duplica)');
  assert.equal(again.zero.length, 0);

  const { index } = await led.collectLedgerGroups({ tenantId: T });
  const res = (ref, type, status) => ({ out_reference_id: ref, out_type: type, out_status: status, out_error: null });
  await led.recordLedgerResults([res('RST:1', 'restock', 'retry')], { index });
  assert.equal((await led.collectLedgerGroups({ tenantId: T })).groups.flat().filter((i) => i.reference_id === 'RST:1').length, 1);
  await led.recordLedgerResults([res('RST:1', 'restock', 'inserted'), res('ADJ:1', 'adjustment', 'conflict')], { index });
  const left = (await led.collectLedgerGroups({ tenantId: T })).groups.flat().map((i) => i.reference_id).sort();
  assert.deepEqual(left, ['WH/TR:1:in', 'WH/TR:1:out']);
  await led.recordLedgerResults([res('WH/TR:1:out', 'transfer_out', 'duplicate'), res('WH/TR:1:in', 'transfer_in', 'duplicate')], { index });
  assert.equal((await led.collectLedgerGroups({ tenantId: T })).groups.length, 0);
  assert.equal(await led.countPendingLedger(T), 0);
});

test('reconciliação: igual quando o ledger cloud bate; divergente quando não — só reporta, saldo local intacto', async () => {
  const cloudOk = [
    { warehouse_id: ctx.A1, product_id: ctx.p1cloud, quantity: 9 },
    { warehouse_id: ctx.A2, product_id: ctx.p1cloud, quantity: 4 },
  ];
  const ok = await led.computeReconciliation({ tenantId: T, cloudRows: cloudOk });
  assert.equal(ok.divergent_count, 0);
  const bad = await led.computeReconciliation({ tenantId: T, cloudRows: [{ warehouse_id: ctx.A1, product_id: ctx.p1cloud, quantity: 7 }], pendingSales: 1 });
  assert.equal(bad.divergent_count, 2);
  assert.ok(bad.pending_sync);
  const a1 = bad.divergent.find((d) => d.warehouse_id === ctx.A1);
  assert.equal(a1.diff, 2);
  assert.equal(await svc.getWarehouseQuantity(ctx.A1, ctx.pid, T), 9, 'nada é corrigido em silêncio');
});
