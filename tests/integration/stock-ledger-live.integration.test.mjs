/**
 * Etapa 1G.2B.3 - sync de movimentos não-venda, transferências internas, abertura e reconciliação.
 * Device JWT REAL + Postgres REAL. O último teste liga o lado LOCAL (SQLite real + stockLedgerSync.js)
 * à RPC real. Env: POSLY_1G2B3_ISSUER_URL, _ADMIN_TOKEN, _SUPABASE_URL, _ANON_KEY, _SERVICE_ROLE_KEY.
 * (3 bootstraps; rate limit 10/h/IP)
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, before } from 'node:test';
import { createClient } from '@supabase/supabase-js';

const E = (k) => process.env[`POSLY_1G2B3_${k}`] || '';
const run = Boolean(E('ISSUER_URL') && E('ADMIN_TOKEN') && E('SUPABASE_URL') && E('ANON_KEY') && E('SERVICE_ROLE_KEY'));
const opts = { skip: !run && 'defina POSLY_1G2B3_*' };
const svc = run ? createClient(E('SUPABASE_URL'), E('SERVICE_ROLE_KEY'), { auth: { persistSession: false } }) : null;

if (run) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'posly-1g2b3-live-'));
  process.env.POS_DB_PATH = path.join(tmpDir, 'database.db');
  process.env.DEFAULT_TENANT_ID = 'tenant-1g2b3-live-local';
}
const local = run
  ? {
      db: (await import('../../api/database.js')).default,
      wh: await import('../../api/services/warehouseStock.service.js'),
      led: await import('../../api/stockLedgerSync.js'),
    }
  : null;

async function post(p, body, admin = true) {
  const res = await fetch(`${E('ISSUER_URL')}${p}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(admin ? { Authorization: `Bearer ${E('ADMIN_TOKEN')}` } : {}) },
    body: JSON.stringify(body),
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}
async function device(t, storeId) {
  const tok = await post('/api/license-issuer/device/activation-tokens', { tenant_id: t.tenantId, license_id: t.licenseId, store_id: storeId });
  const boot = await post('/api/license-issuer/device/bootstrap', { activation_token: tok.data.activation_token, machine_id: `m-${crypto.randomBytes(3).toString('hex')}` }, false);
  assert.equal(boot.status, 200, JSON.stringify(boot.data));
  return createClient(E('SUPABASE_URL'), E('ANON_KEY'), { global: { headers: { Authorization: `Bearer ${boot.data.access_token}` } }, auth: { persistSession: false } });
}

const c = {};
const uuid = () => crypto.randomUUID();
const pushWh = (cl, id, name, isDefault = false) =>
  cl.rpc('sync_upsert_warehouse', { p_id: id, p_name: name, p_code: null, p_is_default: isDefault, p_is_active: true });
const send = (cl, groups) => cl.rpc('sync_stock_movements', { p_groups: groups });
const item = (o) => ({ reference_id: `r-${uuid()}`, type: 'restock', quantity: 1, created_at: new Date().toISOString(), ...o });
const qty = async (wh, p) => Number((await svc.from('warehouse_stock').select('quantity').eq('warehouse_id', wh).eq('product_id', p)).data?.[0]?.quantity ?? 0);
const storeTotal = async (storeId, p) =>
  ((await svc.from('warehouse_stock').select('quantity').eq('store_id', storeId).eq('product_id', p)).data ?? []).reduce((s, r) => s + Number(r.quantity), 0);
const status = (r) => r.data?.map((x) => x.out_status);

before(async () => {
  if (!run) return;
  const tenantId = `itest-2b3-${crypto.randomBytes(3).toString('hex')}`;
  await post('/api/license-issuer/tenants', { id: tenantId, name: 'T' });
  const lic = await post('/api/license-issuer/licenses', { tenant_id: tenantId, plan: 'PRO', commerce_type: 'retalho' });
  c.t = { tenantId, licenseId: lic.data.license.id };
  const mk = async (n) => (await post('/api/license-issuer/stores', { tenant_id: tenantId, license_id: c.t.licenseId, name: n })).data.store.id;
  [c.A, c.B, c.C] = [await mk('A'), await mk('B'), await mk('C')];
  [c.dA, c.dB, c.dC] = [await device(c.t, c.A), await device(c.t, c.B), await device(c.t, c.C)];
  const prod = async (name) => (await svc.from('products').insert({ tenant_id: tenantId, name, price: 5 }).select('id').single()).data.id;
  [c.p1, c.p2, c.p3, c.pd] = [await prod('p1'), await prod('p2'), await prod('p3'), await prod('pd')];
  const sp = (s, p, status = 'active') => svc.from('store_products').insert({ tenant_id: tenantId, store_id: s, product_id: p, status });
  await sp(c.A, c.p1); await sp(c.A, c.pd, 'discontinued'); await sp(c.B, c.p1); await sp(c.C, c.p3);
  c.A1 = uuid(); c.A2 = uuid();
  for (const [id, n, d] of [[c.A2, 'Bar', false], [c.A1, 'Principal', true]]) assert.equal((await pushWh(c.dA, id, n, d)).error, null);
  c.B1 = (await svc.from('warehouses').select('id').eq('store_id', c.B).eq('is_default', true).single()).data.id;
});

test('entrada + ajuste (+ e -) entram no ledger da Store/armazém do Device', opts, async () => {
  const r = await send(c.dA, [
    [item({ type: 'restock', product_id: c.p1, warehouse_id: c.A1, quantity: 20, cost_layers: [{ qty: 20, unit_cost: 2.5, lot_code: null }] })],
    [item({ type: 'adjustment', product_id: c.p1, warehouse_id: c.A1, quantity: 3 })],
    [item({ type: 'adjustment', product_id: c.p1, warehouse_id: c.A1, quantity: -5 })],
  ]);
  assert.equal(r.error, null, JSON.stringify(r.error));
  assert.deepEqual(status(r), ['inserted', 'inserted', 'inserted']);
  assert.equal(await qty(c.A1, c.p1), 18);
  const { data } = await svc.from('stock_movements').select('store_id, cost_layers').eq('product_id', c.p1).eq('type', 'restock');
  assert.equal(data[0].store_id, c.A);
  assert.equal(Number(data[0].cost_layers[0].unit_cost), 2.5);
});

test('transferência A1->A2: par atómico, saldo total da Store inalterado, custo FIFO preservado', opts, async () => {
  const before = await storeTotal(c.A, c.p1);
  const ref = `WH/TR:${uuid()}`;
  const layers = [{ qty: 4, unit_cost: 2.5, lot_code: null }];
  const base = { product_id: c.p1, from_warehouse_id: c.A1, to_warehouse_id: c.A2, cost_layers: layers };
  const r = await send(c.dA, [[
    item({ ...base, type: 'transfer_out', reference_id: `${ref}:out`, warehouse_id: c.A1, quantity: -4 }),
    item({ ...base, type: 'transfer_in', reference_id: `${ref}:in`, warehouse_id: c.A2, quantity: 4 }),
  ]]);
  assert.deepEqual(status(r), ['inserted', 'inserted']);
  assert.equal(await qty(c.A1, c.p1), 14);
  assert.equal(await qty(c.A2, c.p1), 4);
  assert.equal(await storeTotal(c.A, c.p1), before);
  const { data } = await svc.from('stock_movements').select('type, cost_layers, from_warehouse_id, to_warehouse_id').like('reference_id', `${ref}%`);
  assert.equal(data.length, 2);
  assert.ok(data.every((m) => Number(m.cost_layers[0].unit_cost) === 2.5 && m.from_warehouse_id === c.A1 && m.to_warehouse_id === c.A2));
});

test('idempotência: retry = duplicate sem duplicar; mesmo ref com quantidade diferente = conflict (não sobrescreve)', opts, async () => {
  const it = item({ type: 'restock', product_id: c.p1, warehouse_id: c.A1, quantity: 7 });
  assert.deepEqual(status(await send(c.dA, [[it]])), ['inserted']);
  assert.deepEqual(status(await send(c.dA, [[it], [it]])), ['duplicate', 'duplicate']);
  const conflict = await send(c.dA, [[{ ...it, quantity: 9 }]]);
  assert.deepEqual(status(conflict), ['conflict']);
  const { data } = await svc.from('stock_movements').select('quantity').eq('reference_id', it.reference_id);
  assert.equal(data.length, 1);
  assert.equal(Number(data[0].quantity), 7);
});

test('grupo atómico: se um item do par falha, nada do par fica gravado', opts, async () => {
  const ref = `WH/TR:${uuid()}`;
  const before = await qty(c.A1, c.p1);
  const r = await send(c.dA, [[
    item({ type: 'transfer_out', reference_id: `${ref}:out`, product_id: c.p1, warehouse_id: c.A1, from_warehouse_id: c.A1, to_warehouse_id: c.B1, quantity: -1 }),
    item({ type: 'transfer_in', reference_id: `${ref}:in`, product_id: c.p1, warehouse_id: c.B1, from_warehouse_id: c.A1, to_warehouse_id: c.B1, quantity: 1 }),
  ]]);
  assert.deepEqual(status(r), ['rejected', 'rejected']);
  assert.match(r.data[0].out_error, /warehouse_not_in_store/);
  assert.equal((await svc.from('stock_movements').select('id').like('reference_id', `${ref}%`)).data.length, 0);
  assert.equal(await qty(c.A1, c.p1), before);
});

test('cross-store bloqueado; Store B não é afectada; venda/tipo inválido rejeitados; produto ainda não sincronizado = retry', opts, async () => {
  const bBefore = await qty(c.B1, c.p1);
  const r = await send(c.dA, [
    [item({ product_id: c.p1, warehouse_id: c.B1, quantity: 5 })],
    [item({ type: 'sale', product_id: c.p1, warehouse_id: c.A1, quantity: -1 })],
    [item({ product_id: uuid(), warehouse_id: c.A1, quantity: 1 })],
  ]);
  assert.deepEqual(status(r), ['rejected', 'rejected', 'retry']);
  assert.match(r.data[0].out_error, /warehouse_not_in_store/);
  assert.match(r.data[1].out_error, /movement_type_not_syncable/);
  assert.equal(await qty(c.B1, c.p1), bBefore);
  // Store B faz o seu próprio movimento no seu armazém, sem tocar em A
  const aBefore = await storeTotal(c.A, c.p1);
  assert.deepEqual(status(await send(c.dB, [[item({ product_id: c.p1, warehouse_id: c.B1, quantity: 6 })]])), ['inserted']);
  assert.equal(await storeTotal(c.A, c.p1), aBefore);
  assert.equal(await qty(c.B1, c.p1), bBefore + 6);
});

test('abertura: aplicada uma vez; retry = duplicate; não duplica stock', opts, async () => {
  const op = item({ type: 'opening', reference_id: `opening:${c.A2}:${c.p2}`, product_id: c.p2, warehouse_id: c.A2, quantity: 12 });
  assert.deepEqual(status(await send(c.dA, [[op]])), ['inserted']);
  assert.deepEqual(status(await send(c.dA, [[op]])), ['duplicate']);
  assert.equal(await qty(c.A2, c.p2), 12);
  assert.ok(((await svc.from('store_products').select('status').eq('store_id', c.A).eq('product_id', c.p2)).data ?? []).length === 1, 'produto passa a existir na Store');
});

test('regressão de vendas (1G.2B.2): produto descontinuado ainda sincroniza venda offline; ausente da Store continua rejeitado', opts, async () => {
  const sell = (p) =>
    c.dA.rpc('create_order_with_items', {
      order_data: { local_sale_id: `sale-${uuid()}`, total: 5, subtotal: 5, doc_type: 'VD', warehouse_id: c.A1 },
      items: [{ product_id: p, product_name: 'x', quantity: 1, price: 5 }],
    });
  const ok = await sell(c.pd);
  assert.equal(ok.error, null, JSON.stringify(ok.error));
  const bad = await sell(c.p3);
  assert.match(bad.error.message, /item_product_not_in_store/);
});

test('E2E local->cloud: SQLite real gera grupos, RPC aplica, reconciliação igual; divergência é reportada e nada é corrigido', opts, async () => {
  const { db, wh, led } = local;
  const T = 'tenant-1g2b3-live-local';
  const runDb = (sql, p = []) => new Promise((res, rej) => db.run(sql, p, (e) => (e ? rej(e) : res())));
  const allDb = (sql, p = []) => new Promise((res, rej) => db.all(sql, p, (e, r) => (e ? rej(e) : res(r))));
  const deadline = Date.now() + 8000;
  for (;;) {
    try { await allDb('SELECT warehouse_id FROM locations LIMIT 1'); await allDb('SELECT 1 FROM stock_layers LIMIT 1'); break; } catch (e) { if (Date.now() > deadline) throw e; await new Promise((r) => setTimeout(r, 100)); }
  }
  const nowIso = () => new Date().toISOString();
  await runDb(`INSERT INTO products (cloud_id, tenant_id, name, price, cost, stock_quantity, created_at, updated_at) VALUES (?, ?, 'P3', 5, 3, 10, ?, ?)`, [c.p3, T, nowIso(), nowIso()]);
  const pid = (await allDb(`SELECT id FROM products WHERE cloud_id = ?`, [c.p3]))[0].id;
  const L1 = String((await wh.ensureDefaultWarehouse(T)).id);
  const L2 = uuid();
  await runDb(`INSERT INTO warehouses (id, tenant_id, name, is_default, is_active, created_at, updated_at) VALUES (?, ?, 'Bar', 0, 1, ?, ?)`, [L2, T, nowIso(), nowIso()]);
  for (const [id, n, d] of [[L2, 'Bar', false], [L1, 'Loja', true]]) assert.equal((await pushWh(c.dC, id, n, d)).error, null);

  await wh.applyWarehouseDelta({ tenantId: T, warehouseId: L1, productId: pid, delta: 6, movementType: 'restock', referenceId: 'RST:e2e', cost: 4 });
  await wh.applyWarehouseDelta({ tenantId: T, warehouseId: L1, productId: pid, delta: -1, movementType: 'adjustment', referenceId: 'ADJ:e2e' });
  await wh.transferWarehouseStock({ tenantId: T, fromWarehouseId: L1, toWarehouseId: L2, productId: pid, quantity: 5, referenceId: 'WH/TR:e2e' });

  const cycle = async () => {
    const op = await led.collectOpeningGroups({ tenantId: T });
    await led.recordZeroOpenings(op.zero);
    let total = 0;
    if (op.groups.length) {
      const r = await send(c.dC, op.groups);
      assert.equal(r.error, null, JSON.stringify(r.error));
      await led.recordLedgerResults(r.data, { index: op.index, opening: true });
      total += op.groups.length;
    }
    const lg = await led.collectLedgerGroups({ tenantId: T });
    if (lg.groups.length) {
      const r = await send(c.dC, lg.groups);
      assert.equal(r.error, null, JSON.stringify(r.error));
      assert.ok(r.data.every((x) => x.out_status === 'inserted' || x.out_status === 'duplicate'), JSON.stringify(r.data));
      await led.recordLedgerResults(r.data, { index: lg.index });
      total += lg.groups.length;
    }
    return total;
  };
  const cloudRows = async () => (await svc.from('warehouse_stock').select('warehouse_id,product_id,quantity').eq('store_id', c.C)).data;

  assert.equal(await cycle(), 4, 'abertura + restock + ajuste + par de transferência');
  assert.equal(await cycle(), 0, 'segundo ciclo: nada a enviar (retry/reconnect não duplica)');
  assert.equal(await storeTotal(c.C, c.p3), 15, 'saldo total da Store = local (10 legado +6 -1; a transferência interna soma 0)');
  const ok = await led.computeReconciliation({ tenantId: T, cloudRows: await cloudRows() });
  assert.equal(ok.divergent_count, 0, JSON.stringify(ok.divergent));

  // divergência: a cloud recebe uma venda que o local não conhece -> reportada, local e cloud intactos
  const sale = await c.dC.rpc('create_order_with_items', {
    order_data: { local_sale_id: `sale-${uuid()}`, total: 5, subtotal: 5, doc_type: 'VD', warehouse_id: L1 },
    items: [{ product_id: c.p3, product_name: 'P3', quantity: 2, price: 5 }],
  });
  assert.equal(sale.error, null, JSON.stringify(sale.error));
  const bad = await led.computeReconciliation({ tenantId: T, cloudRows: await cloudRows() });
  assert.equal(bad.divergent_count, 1);
  assert.equal(bad.divergent[0].diff, 2);
  assert.equal(await wh.getWarehouseQuantity(L1, pid, T), 10);
  assert.equal(await qty(L1, c.p3), 8);
});
