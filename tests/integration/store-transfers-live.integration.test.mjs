/**
 * Etapa 1G.2B.5 - transferencias Store -> Store (cloud arbitra). Device JWT REAL + Postgres REAL.
 * O ultimo bloco liga o POS local (SQLite real: rascunho -> dispatch offline -> sync -> receive offline -> sync).
 * Env: POSLY_1G2B5_ISSUER_URL, _ADMIN_TOKEN, _SUPABASE_URL, _ANON_KEY, _SERVICE_ROLE_KEY. (3 bootstraps)
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { test, before } from 'node:test';
import { createClient } from '@supabase/supabase-js';

const E = (k) => process.env[`POSLY_1G2B5_${k}`] || '';
const run = Boolean(E('ISSUER_URL') && E('ADMIN_TOKEN') && E('SUPABASE_URL') && E('ANON_KEY') && E('SERVICE_ROLE_KEY'));
const opts = { skip: !run && 'defina POSLY_1G2B5_*' };
const svc = run ? createClient(E('SUPABASE_URL'), E('SERVICE_ROLE_KEY'), { auth: { persistSession: false } }) : null;

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
const dispatch = (cl, o) =>
  cl.rpc('transfer_dispatch', {
    p_transfer: { id: uuid(), from_warehouse_id: c.A1, to_store_id: c.B, items: [{ product_id: c.P, qty: 4, cost_layers: [{ qty: 4, unit_cost: 2.5, lot_code: null }] }], ...o },
  });
const receive = (cl, id, qty, wh = null, product = c.P) => cl.rpc('transfer_receive', { p_id: id, p_to_warehouse: wh, p_items: [{ product_id: product, qty_received: qty }] });
const cancel = (cl, id) => cl.rpc('transfer_cancel', { p_id: id, p_reason: 'teste' });
const qty = async (wh, p = c.P) => Number((await svc.from('warehouse_stock').select('quantity').eq('warehouse_id', wh).eq('product_id', p)).data?.[0]?.quantity ?? 0);
const movs = async (id) => (await svc.from('stock_movements').select('type, quantity, warehouse_id, store_id, cost_layers').like('reference_id', `transfer:${id}:%`)).data;
const transit = async (id) => (await svc.from('stock_in_transit').select('quantity, to_store_id').eq('transfer_id', id)).data;
const tstatus = async (id) => (await svc.from('stock_transfers').select('*').eq('id', id).single()).data;

before(async () => {
  if (!run) return;
  const mkT = async (n) => {
    const tenantId = `itest-2b5-${n}-${crypto.randomBytes(3).toString('hex')}`;
    await post('/api/license-issuer/tenants', { id: tenantId, name: n });
    const lic = await post('/api/license-issuer/licenses', { tenant_id: tenantId, plan: 'PRO', commerce_type: 'retalho' });
    return { tenantId, licenseId: lic.data.license.id };
  };
  c.t = await mkT('T1');
  c.t2 = await mkT('T2');
  const mkS = async (t, n) => (await post('/api/license-issuer/stores', { tenant_id: t.tenantId, license_id: t.licenseId, name: n })).data.store.id;
  [c.A, c.B, c.C] = [await mkS(c.t, 'A'), await mkS(c.t, 'B'), await mkS(c.t2, 'C')];
  [c.dA, c.dB, c.dC] = [await device(c.t, c.A), await device(c.t, c.B), await device(c.t2, c.C)];
  const prod = async (t, n) => (await svc.from('products').insert({ tenant_id: t.tenantId, name: n, price: 5 }).select('id').single()).data.id;
  [c.P, c.Q, c.PC] = [await prod(c.t, 'P'), await prod(c.t, 'Q'), await prod(c.t2, 'PC')];
  const def = async (s) => (await svc.from('warehouses').select('id').eq('store_id', s).eq('is_default', true).single()).data.id;
  [c.A1, c.B1, c.C1] = [await def(c.A), await def(c.B), await def(c.C)];
  c.A2 = (await svc.from('warehouses').insert({ tenant_id: c.t.tenantId, store_id: c.A, name: 'A2' }).select('id').single()).data.id;
  c.B2 = (await svc.from('warehouses').insert({ tenant_id: c.t.tenantId, store_id: c.B, name: 'B2' }).select('id').single()).data.id;
  // A tem 100 de P e 100 de Q em A1
  for (const p of [c.P, c.Q]) {
    const r = await c.dA.rpc('sync_stock_movements', { p_groups: [[{ reference_id: `r-${uuid()}`, type: 'restock', product_id: p, warehouse_id: c.A1, quantity: 100, created_at: new Date().toISOString() }]] });
    assert.equal(r.error, null, JSON.stringify(r.error));
  }
  await svc.from('store_products').insert({ tenant_id: c.t.tenantId, store_id: c.B, product_id: c.Q, status: 'discontinued' });
});

test('A→B normal: dispatch reduz só A; antes do receive B não tem stock; em trânsito é visível e distinto', opts, async () => {
  const r = await dispatch(c.dA, {});
  assert.equal(r.error, null, JSON.stringify(r.error));
  c.T1 = r.data[0].out_id;
  assert.equal(r.data[0].out_status, 'dispatched');
  assert.equal(await qty(c.A1), 96);
  assert.equal(await qty(c.B1), 0);
  assert.equal((await svc.from('store_products').select('status').eq('store_id', c.B).eq('product_id', c.P)).data.length, 0, 'produto ainda não activo em B');
  const tr = await transit(c.T1);
  assert.equal(Number(tr[0].quantity), 4);
  assert.equal(tr[0].to_store_id, c.B);
  const m = await movs(c.T1);
  assert.deepEqual(m.map((x) => [x.type, Number(x.quantity), x.store_id]), [['transfer_out', -4, c.A]]);
  const a = (await c.dA.from('device_stock_transfers').select('id,direction')).data.find((x) => x.id === c.T1);
  const b = (await c.dB.from('device_stock_transfers').select('id,direction,status')).data.find((x) => x.id === c.T1);
  assert.equal(a.direction, 'out');
  assert.equal(b.direction, 'in');
  assert.equal(b.status, 'dispatched');
  assert.equal((await c.dB.from('stock_transfer_items').select('qty_sent,cost_layers').eq('transfer_id', c.T1)).data[0].cost_layers[0].unit_cost, 2.5, 'destino conhece o custo enviado');
});

test('retry dispatch é idempotente (sem duplo débito); dispatch concorrente: 1 só vence', opts, async () => {
  const again = await c.dA.rpc('transfer_dispatch', { p_transfer: { id: c.T1, from_warehouse_id: c.A1, to_store_id: c.B, items: [{ product_id: c.P, qty: 4 }] } });
  assert.equal(again.data[0].out_already_exists, true);
  assert.equal(await qty(c.A1), 96);
  const id = uuid();
  const rs = await Promise.all(Array.from({ length: 6 }, () => dispatch(c.dA, { id })));
  assert.ok(rs.every((x) => !x.error), JSON.stringify(rs.map((x) => x.error)));
  assert.equal(rs.filter((x) => x.data[0].out_already_exists === false).length, 1);
  assert.equal((await movs(id)).length, 1);
  assert.equal(await qty(c.A1), 92);
  // a outra Store não consegue "reclamar" o mesmo id
  const steal = await c.dB.rpc('transfer_dispatch', { p_transfer: { id, from_warehouse_id: c.B1, to_store_id: c.A, items: [{ product_id: c.P, qty: 1 }] } });
  assert.match(steal.error.message, /transfer_store_mismatch/);
});

test('receive: aumenta só B; custo FIFO enviado preservado; activa produto no destino; retry e receive concorrente não duplicam', opts, async () => {
  const wrongStore = await receive(c.dA, c.T1, 4);
  assert.match(wrongStore.error.message, /transfer_not_for_store/, 'a origem não recebe a sua própria transferência');
  const rs = await Promise.all(Array.from({ length: 6 }, () => receive(c.dB, c.T1, 4, c.B2)));
  assert.ok(rs.every((x) => !x.error), JSON.stringify(rs.map((x) => x.error)));
  assert.equal(rs.filter((x) => x.data[0].out_applied).length, 1, 'receive concorrente: 1 só aplica');
  assert.equal(await qty(c.B2), 4);
  assert.equal(await qty(c.B1), 0);
  assert.equal(await qty(c.A1), 92, 'origem intacta pelo receive');
  const m = await movs(c.T1);
  assert.equal(m.length, 2);
  const inn = m.find((x) => x.type === 'transfer_in');
  assert.equal(inn.store_id, c.B);
  assert.equal(inn.warehouse_id, c.B2);
  assert.equal(Number(inn.cost_layers[0].unit_cost), 2.5);
  assert.equal((await transit(c.T1)).length, 0, 'já não está em trânsito');
  assert.equal((await svc.from('store_products').select('status').eq('store_id', c.B).eq('product_id', c.P)).data[0].status, 'active', 'receive activa o produto no destino sem duplicar products');
  assert.equal((await svc.from('products').select('id', { count: 'exact', head: true }).eq('tenant_id', c.t.tenantId).eq('name', 'P')).count, 1);
  assert.equal((await svc.from('stock_transfer_items').select('dest_store_product_created').eq('transfer_id', c.T1).single()).data.dest_store_product_created, true);
});

test('divergência: qty_received != qty_sent fica registada e pendente; sem ajuste/perda automáticos', opts, async () => {
  const d = await dispatch(c.dA, { items: [{ product_id: c.P, qty: 5, cost_layers: [{ qty: 5, unit_cost: 3, lot_code: null }] }] });
  const id = d.data[0].out_id;
  const r = await receive(c.dB, id, 3);
  assert.equal(r.data[0].out_has_divergence, true);
  const t = await tstatus(id);
  assert.equal(t.has_divergence, true);
  assert.equal(t.divergence_status, 'pending');
  const item = (await svc.from('stock_transfer_items').select('qty_sent,qty_received,divergence_qty').eq('transfer_id', id).single()).data;
  assert.deepEqual([Number(item.qty_sent), Number(item.qty_received), Number(item.divergence_qty)], [5, 3, -2]);
  assert.deepEqual((await movs(id)).map((x) => x.type).sort(), ['transfer_in', 'transfer_out']);
  assert.equal((await movs(id)).find((x) => x.type === 'transfer_in').quantity, 3);
  assert.equal((await svc.from('stock_movements').select('id', { count: 'exact', head: true }).eq('type', 'adjustment').like('reference_id', `%${id}%`)).count, 0);
});

test('cancel draft é local; pós-dispatch só via cloud com movimento compensatório; receive depois de cancelado não credita; cancel depois de received recusado', opts, async () => {
  const d = await dispatch(c.dA, {});
  const id = d.data[0].out_id;
  const before = await qty(c.A1);
  const b1Before = await qty(c.B1);
  assert.match((await cancel(c.dB, id)).error.message, /transfer_not_from_store/, 'só a origem cancela');
  const cx = await cancel(c.dA, id);
  assert.deepEqual([cx.data[0].out_status, cx.data[0].out_applied], ['cancelled', true]);
  assert.equal(await qty(c.A1), before + 4, 'compensação devolve o stock à origem');
  const m = await movs(id);
  assert.deepEqual(m.map((x) => x.type).sort(), ['transfer_out', 'transfer_reversal'], 'movimentos nunca apagados');
  const late = await receive(c.dB, id, 4);
  assert.deepEqual([late.data[0].out_status, late.data[0].out_applied], ['cancelled', false]);
  assert.equal(await qty(c.B1), b1Before);
  assert.equal((await cancel(c.dA, id)).data[0].out_applied, false, 'cancel repetido é idempotente');
  // cancel depois de received
  const d2 = await dispatch(c.dA, {});
  await receive(c.dB, d2.data[0].out_id, 4);
  const cx2 = await cancel(c.dA, d2.data[0].out_id);
  assert.deepEqual([cx2.data[0].out_status, cx2.data[0].out_applied], ['received', false]);
  assert.equal((await movs(d2.data[0].out_id)).length, 2);
});

test('receive vs cancel concorrentes: exactamente 1 vence e o ledger fica coerente', opts, async () => {
  for (let i = 0; i < 4; i += 1) {
    const d = await dispatch(c.dA, {});
    const id = d.data[0].out_id;
    const [r, x] = await Promise.all([receive(c.dB, id, 4), cancel(c.dA, id)]);
    assert.equal(r.error, null);
    assert.equal(x.error, null);
    assert.equal([r.data[0].out_applied, x.data[0].out_applied].filter(Boolean).length, 1);
    const t = await tstatus(id);
    const types = (await movs(id)).map((m) => m.type).sort();
    if (t.status === 'received') assert.deepEqual(types, ['transfer_in', 'transfer_out']);
    else assert.deepEqual(types, ['transfer_out', 'transfer_reversal']);
  }
});

test('validações: warehouse origem/destino inválido, Store inválida/cross-tenant, produto de outro tenant, itens incompletos', opts, async () => {
  const b1Before = await qty(c.B1);
  const bad = async (o, re) => assert.match((await dispatch(c.dA, o)).error.message, re);
  await bad({ from_warehouse_id: c.B1 }, /warehouse_not_in_store/);
  await bad({ from_warehouse_id: c.C1 }, /warehouse_not_in_store/);
  await bad({ to_store_id: c.C }, /transfer_to_store_invalid/);
  await bad({ to_store_id: c.A }, /transfer_same_store/);
  await bad({ items: [{ product_id: c.PC, qty: 1 }] }, /item_product_not_in_tenant/);
  await bad({ items: [{ product_id: c.P, qty: 0 }] }, /item_invalid/);
  await bad({ items: [] }, /items_required/);
  const d = await dispatch(c.dA, {});
  const id = d.data[0].out_id;
  assert.match((await receive(c.dB, id, 4, c.A1)).error.message, /warehouse_not_in_store/, 'armazém de outra Store no receive');
  assert.match((await c.dB.rpc('transfer_receive', { p_id: id, p_to_warehouse: null, p_items: [] })).error.message, /received_items_incomplete/);
  assert.match((await receive(c.dC, id, 4)).error.message, /transfer_not_found/, 'outro tenant não vê nem recebe');
  assert.equal((await c.dC.from('device_stock_transfers').select('id')).data.length, 0);
  assert.ok((await c.dA.from('stock_transfers').insert({ id: uuid(), tenant_id: c.t.tenantId, from_store_id: c.A, from_warehouse_id: c.A1, to_store_id: c.B, status: 'received' })).error, 'escrita directa negada');
  assert.equal((await tstatus(id)).status, 'dispatched');
  assert.equal(await qty(c.B1), b1Before, 'nenhuma falha deixou crédito parcial');
});

test('produto descontinuado no destino: receive credita stock mas NÃO reactiva o produto', opts, async () => {
  const d = await dispatch(c.dA, { items: [{ product_id: c.Q, qty: 2, cost_layers: [{ qty: 2, unit_cost: 1, lot_code: null }] }] });
  const r = await receive(c.dB, d.data[0].out_id, 2, null, c.Q);
  assert.equal(r.error, null, JSON.stringify(r.error));
  assert.equal(await qty(c.B1, c.Q), 2);
  assert.equal((await svc.from('store_products').select('status').eq('store_id', c.B).eq('product_id', c.Q).single()).data.status, 'discontinued');
});

test('POS local A/B offline + sync real: dispatch offline (A), receive offline (B), cancelamento em corrida, retries e reconciliação', opts, async () => {
  const path = await import('node:path');
  const fs = await import('node:fs');
  const os = await import('node:os');
  process.env.POS_DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'posly-1g2b5-live-')), 'database.db');
  const LT = 'tenant-1g2b5-live-local';
  process.env.DEFAULT_TENANT_ID = LT;
  const db = (await import('../../api/database.js')).default;
  const wh = await import('../../api/services/warehouseStock.service.js');
  const tr = await import('../../api/services/storeTransfers.service.js');
  const led = await import('../../api/stockLedgerSync.js');
  const { syncTransfersToCloud } = await import('../../api/syncService.js');
  const runDb = (s, p = []) => new Promise((res, rej) => db.run(s, p, (e) => (e ? rej(e) : res())));
  const allDb = (s, p = []) => new Promise((res, rej) => db.all(s, p, (e, r) => (e ? rej(e) : res(r))));
  const deadline = Date.now() + 8000;
  for (;;) {
    try { await allDb('SELECT 1 FROM stock_transfers LIMIT 1'); await allDb('SELECT 1 FROM stock_layers LIMIT 1'); break; } catch (e) { if (Date.now() > deadline) throw e; await new Promise((r) => setTimeout(r, 100)); }
  }
  const nowIso = () => new Date().toISOString();
  await runDb(`INSERT INTO products (cloud_id, tenant_id, name, price, cost, created_at, updated_at) VALUES (?, ?, 'P', 5, 2, ?, ?)`, [c.P, LT, nowIso(), nowIso()]);
  const pid = (await allDb(`SELECT id FROM products WHERE cloud_id = ?`, [c.P]))[0].id;
  const [LA, LB] = [uuid(), uuid()];
  for (const w of [LA, LB]) await runDb(`INSERT INTO warehouses (id, tenant_id, name, is_default, is_active, created_at, updated_at) VALUES (?, ?, ?, 0, 1, ?, ?)`, [w, LT, `W-${w.slice(0, 4)}`, nowIso(), nowIso()]);
  assert.equal((await c.dA.rpc('sync_upsert_warehouse', { p_id: LA, p_name: 'LocalA', p_code: null, p_is_default: false, p_is_active: true })).error, null);
  assert.equal((await c.dB.rpc('sync_upsert_warehouse', { p_id: LB, p_name: 'LocalB', p_code: null, p_is_default: false, p_is_active: true })).error, null);
  await wh.applyWarehouseDelta({ tenantId: LT, warehouseId: LA, productId: pid, delta: 20, movementType: 'restock', referenceId: 'REST:live', cost: 2 });
  const lg = await led.collectLedgerGroups({ tenantId: LT });
  const pushed = await c.dA.rpc('sync_stock_movements', { p_groups: lg.groups });
  assert.equal(pushed.error, null, JSON.stringify(pushed.error));
  await led.recordLedgerResults(pushed.data, { index: lg.index });
  const lq = (w) => wh.getWarehouseQuantity(w, pid, LT);
  const pull = async (client) => {
    const { data: rows } = await client.from('device_stock_transfers').select('id,direction,from_store_id,to_store_id,from_warehouse_id,to_warehouse_id,status,note,has_divergence,cancel_reason,created_at,dispatched_at,received_at,cancelled_at,updated_at');
    const { data: items } = await client.from('stock_transfer_items').select('transfer_id,product_id,qty_requested,qty_sent,qty_received,cost_layers').in('transfer_id', rows.map((r) => r.id));
    const by = new Map();
    for (const i of items) by.set(i.transfer_id, [...(by.get(i.transfer_id) ?? []), i]);
    return tr.applyRemoteTransfers(LT, rows, by);
  };

  // A despacha OFFLINE (nada foi à cloud ainda)
  const d1 = await tr.createDraft({ tenantId: LT, toStoreId: c.B, fromWarehouseId: LA, items: [{ productId: pid, qty: 8 }] });
  await tr.dispatchLocal(d1.id, LT);
  assert.equal(await lq(LA), 12);
  assert.equal((await svc.from('stock_transfers').select('id').eq('id', d1.id)).data.length, 0, 'cloud ainda não conhece');
  // reconnect A: sync real
  await syncTransfersToCloud(c.dA);
  assert.equal((await tstatus(d1.id)).status, 'dispatched');
  assert.equal(await qty(LA), 12, 'cloud debitou a origem uma vez');
  assert.equal(await qty(LB), 0);
  assert.equal((await transit(d1.id))[0].quantity, 8);
  await syncTransfersToCloud(c.dA); // retry sem pendentes
  assert.equal((await movs(d1.id)).length, 1);

  // B aprende por pull e recebe OFFLINE 7 de 8 (divergência); sync
  await pull(c.dB);
  await tr.receiveLocal(d1.id, LT, { toWarehouseId: LB, items: [{ productId: pid, qtyReceived: 7 }] });
  assert.equal(await lq(LB), 7);
  assert.equal(await qty(LB), 0, 'cloud só credita B quando a recepção sincroniza');
  await syncTransfersToCloud(c.dB);
  await syncTransfersToCloud(c.dB);
  assert.equal(await qty(LB), 7);
  assert.equal((await tstatus(d1.id)).divergence_status, 'pending');
  assert.equal((await movs(d1.id)).length, 2, 'retry de receive não duplica');
  const cloud = (await svc.from('warehouse_stock').select('warehouse_id,product_id,quantity').in('warehouse_id', [LA, LB])).data;
  const rec = await led.computeReconciliation({ tenantId: LT, cloudRows: cloud });
  assert.equal(rec.divergent.filter((d) => [LA, LB].includes(d.warehouse_id)).length, 0, 'saldo local == ledger cloud em A e B');

  // corrida: A despacha, B aprende, A cancela (cloud) enquanto B recebe OFFLINE sem saber
  const d2 = await tr.createDraft({ tenantId: LT, toStoreId: c.B, fromWarehouseId: LA, items: [{ productId: pid, qty: 5 }] });
  await tr.dispatchLocal(d2.id, LT);
  await syncTransfersToCloud(c.dA);
  await pull(c.dB);
  const c2 = await c.dA.rpc('transfer_cancel', { p_id: d2.id, p_reason: 'erro' });
  assert.equal(c2.data[0].out_applied, true);
  const lbBefore = await lq(LB);
  await tr.receiveLocal(d2.id, LT, { toWarehouseId: LB, items: [{ productId: pid, qtyReceived: 5 }] });
  assert.equal(await lq(LB), lbBefore + 5, 'B creditou offline');
  await syncTransfersToCloud(c.dB);
  assert.equal(await lq(LB), lbBefore, 'cloud recusou (já cancelada): crédito local revertido por movimento compensatório');
  assert.equal(await qty(LB), 7, 'cloud de B intacta');
  await pull(c.dA);
  assert.equal(await lq(LA), 12 + 0, 'origem recupera os 5 ao aprender o cancelamento');
  assert.equal(await qty(LA), 12);
  const rec2 = await led.computeReconciliation({ tenantId: LT, cloudRows: (await svc.from('warehouse_stock').select('warehouse_id,product_id,quantity').in('warehouse_id', [LA, LB])).data });
  assert.equal(rec2.divergent.filter((d) => [LA, LB].includes(d.warehouse_id)).length, 0);
});
