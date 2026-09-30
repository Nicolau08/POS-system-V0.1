/**
 * Etapa 1G.2B-FINAL - cenario integrado minimo do nucleo Multi-Store Inventory. Device JWT REAL + Postgres REAL +
 * POS local (SQLite real; uma BD faz os papeis de Store A e Store B) + sync real (syncTransfersToCloud) + RPCs reais.
 *   Store A: Principal + Bar ; Store B: Principal ; mesmo produto mestre activo nas duas.
 * Env: POSLY_FINAL_ISSUER_URL, _ADMIN_TOKEN, _SUPABASE_URL, _ANON_KEY, _SERVICE_ROLE_KEY. (2 bootstraps)
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { createClient } from '@supabase/supabase-js';

const E = (k) => process.env[`POSLY_FINAL_${k}`] || '';
const run = Boolean(E('ISSUER_URL') && E('ADMIN_TOKEN') && E('SUPABASE_URL') && E('ANON_KEY') && E('SERVICE_ROLE_KEY'));
const opts = { skip: !run && 'defina POSLY_FINAL_*' };
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
const uuid = () => crypto.randomUUID();

test('cenário integrado: entrada, vendas, transferência interna, A→B com trânsito, receive, venda em B, offline/reconnect, retries', opts, async () => {
  const LT = 'tenant-final-local';
  process.env.POS_DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'posly-final-')), 'database.db');
  process.env.DEFAULT_TENANT_ID = LT;
  const db = (await import('../../api/database.js')).default;
  const wh = await import('../../api/services/warehouseStock.service.js');
  const tr = await import('../../api/services/storeTransfers.service.js');
  const led = await import('../../api/stockLedgerSync.js');
  const { syncTransfersToCloud } = await import('../../api/syncService.js');
  const runDb = (s, p = []) => new Promise((res, rej) => db.run(s, p, (e) => (e ? rej(e) : res())));
  const allDb = (s, p = []) => new Promise((res, rej) => db.all(s, p, (e, r) => (e ? rej(e) : res(r))));

  // ---- cloud: Tenant -> Stores -> devices -> produto mestre -> store_products em A e B
  const tenantId = `itest-final-${crypto.randomBytes(3).toString('hex')}`;
  await post('/api/license-issuer/tenants', { id: tenantId, name: 'T' });
  const lic = await post('/api/license-issuer/licenses', { tenant_id: tenantId, plan: 'PRO', commerce_type: 'retalho' });
  const t = { tenantId, licenseId: lic.data.license.id };
  const mkS = async (n) => (await post('/api/license-issuer/stores', { tenant_id: tenantId, license_id: t.licenseId, name: n })).data.store.id;
  const [A, B] = [await mkS('A'), await mkS('B')];
  const [dA, dB] = [await device(t, A), await device(t, B)];
  const P = (await svc.from('products').insert({ tenant_id: tenantId, name: 'Produto Mestre', price: 5 }).select('id').single()).data.id;
  for (const s of [A, B]) assert.equal((await post('/api/license-issuer/store-products', { tenant_id: tenantId, store_id: s, product_id: P, config: {} })).status, 200);

  // ---- local: produto mestre (mesmo cloud id), armazéns A/Principal, A/Bar, B/Principal (ids UUID locais = ids cloud)
  const nowIso = () => new Date().toISOString();
  await runDb(`INSERT INTO products (cloud_id, tenant_id, name, price, cost, created_at, updated_at) VALUES (?, ?, 'Produto Mestre', 5, 2, ?, ?)`, [P, LT, nowIso(), nowIso()]);
  const pid = (await allDb(`SELECT id FROM products WHERE cloud_id = ?`, [P]))[0].id;
  const LA1 = String((await wh.ensureDefaultWarehouse(LT)).id);
  const [LA2, LB1] = [uuid(), uuid()];
  for (const w of [LA2, LB1]) await runDb(`INSERT INTO warehouses (id, tenant_id, name, is_default, is_active, created_at, updated_at) VALUES (?, ?, ?, 0, 1, ?, ?)`, [w, LT, `W-${w.slice(0, 4)}`, nowIso(), nowIso()]);
  const pushWh = (cl, id, name, d) => cl.rpc('sync_upsert_warehouse', { p_id: id, p_name: name, p_code: null, p_is_default: d, p_is_active: true });
  for (const [cl, id, n, d] of [[dA, LA2, 'Bar', false], [dA, LA1, 'Principal', true], [dB, LB1, 'Principal', true]]) assert.equal((await pushWh(cl, id, n, d)).error, null);

  // ---- helpers
  const lq = (w) => wh.getWarehouseQuantity(w, pid, LT);
  const cq = async (w) => Number((await svc.from('warehouse_stock').select('quantity').eq('warehouse_id', w).eq('product_id', P)).data?.[0]?.quantity ?? 0);
  const syncLedger = async (cl) => {
    const op = await led.collectOpeningGroups({ tenantId: LT });
    await led.recordZeroOpenings(op.zero);
    const lg = await led.collectLedgerGroups({ tenantId: LT });
    for (const [groups, o] of [[op.groups, { index: op.index, opening: true }], [lg.groups, { index: lg.index }]]) {
      if (!groups.length) continue;
      const r = await cl.rpc('sync_stock_movements', { p_groups: groups });
      assert.equal(r.error, null, JSON.stringify(r.error));
      assert.ok(r.data.every((x) => ['inserted', 'duplicate'].includes(x.out_status)), JSON.stringify(r.data));
      await led.recordLedgerResults(r.data, o);
    }
  };
  const localSale = (w, q, tag) => wh.applyWarehouseDelta({ tenantId: LT, warehouseId: w, productId: pid, delta: -q, movementType: 'sale', referenceId: `SALE:${tag}:${pid}` });
  const cloudSale = (cl, w, q, lsid) =>
    cl.rpc('create_order_with_items', {
      order_data: { local_sale_id: lsid, total: q * 5, subtotal: q * 5, doc_type: 'VD', warehouse_id: w },
      items: [{ product_id: P, product_name: 'Produto Mestre', quantity: q, price: 5 }],
    });
  const pull = async (cl) => {
    const { data: rows } = await cl.from('device_stock_transfers').select('id,direction,from_store_id,to_store_id,from_warehouse_id,to_warehouse_id,status,note,has_divergence,cancel_reason,created_at,dispatched_at,received_at,cancelled_at,updated_at');
    const { data: items } = await cl.from('stock_transfer_items').select('transfer_id,product_id,qty_requested,qty_sent,qty_received,cost_layers').in('transfer_id', rows.map((r) => r.id));
    const by = new Map();
    for (const i of items) by.set(i.transfer_id, [...(by.get(i.transfer_id) ?? []), i]);
    return tr.applyRemoteTransfers(LT, rows, by);
  };

  // 1. entrada de stock em A/Principal (50 @ custo 2)
  await wh.applyWarehouseDelta({ tenantId: LT, warehouseId: LA1, productId: pid, delta: 50, movementType: 'restock', referenceId: 'REST:final', cost: 2 });
  await syncLedger(dA);
  assert.equal(await cq(LA1), 50);

  // 2. venda A/Principal (5)
  await localSale(LA1, 5, 's1');
  const s1 = uuid();
  assert.equal((await cloudSale(dA, LA1, 5, s1)).error, null);
  assert.equal(await cq(LA1), 45);

  // 3. transferência interna A/Principal -> A/Bar (10): total da Store inalterado
  const storeTotal = async (s) => ((await svc.from('warehouse_stock').select('quantity').eq('store_id', s).eq('product_id', P)).data ?? []).reduce((a, r) => a + Number(r.quantity), 0);
  await wh.transferWarehouseStock({ tenantId: LT, fromWarehouseId: LA1, toWarehouseId: LA2, productId: pid, quantity: 10, referenceId: 'WH/TR:final' });
  await syncLedger(dA);
  assert.deepEqual([await cq(LA1), await cq(LA2)], [35, 10]);
  assert.equal(await storeTotal(A), 45);

  // 4. venda no Bar (3)
  await localSale(LA2, 3, 's2');
  assert.equal((await cloudSale(dA, LA2, 3, uuid())).error, null);
  assert.equal(await cq(LA2), 7);

  // 5. A -> B: A despacha OFFLINE 12 de A/Principal; cloud ainda não sabe
  const d = await tr.createDraft({ tenantId: LT, toStoreId: B, fromWarehouseId: LA1, items: [{ productId: pid, qty: 12 }] });
  await tr.dispatchLocal(d.id, LT);
  assert.equal(await lq(LA1), 23);
  assert.equal((await svc.from('stock_transfers').select('id').eq('id', d.id)).data.length, 0);
  await pull(dB); // B ainda não vê nada
  assert.equal((await allDb(`SELECT id FROM stock_transfers WHERE direction = 'in'`)).length, 0);
  await syncTransfersToCloud(dA); // A reconecta

  // 6. em trânsito: A já debitado, B ainda sem stock, e a soma conserva-se
  const transit = (await svc.from('stock_in_transit').select('quantity,to_store_id').eq('transfer_id', d.id)).data;
  assert.deepEqual([Number(transit[0].quantity), transit[0].to_store_id], [12, B]);
  assert.equal(await cq(LA1), 23);
  assert.equal(await cq(LB1), 0);
  assert.equal((await cq(LA1)) + (await cq(LA2)) + Number(transit[0].quantity) + (await cq(LB1)), 50 - 5 - 3, 'disponível A + trânsito + B == entrada - vendas');
  // isolamento por RLS: B só vê o que lhe diz respeito (transferência 'in'), não o stock de A
  assert.ok((await dB.from('warehouse_stock').select('store_id')).data.every((r) => r.store_id === B));
  assert.ok((await dA.from('warehouse_stock').select('store_id')).data.every((r) => r.store_id === A));

  // 7. B aprende (pull) e recebe OFFLINE em B/Principal; antes de reconectar vende 2 localmente
  assert.equal((await pull(dB)).created, 1);
  await tr.receiveLocal(d.id, LT, { toWarehouseId: LB1, items: [{ productId: pid, qtyReceived: 12 }] });
  assert.equal(await lq(LB1), 12);
  assert.equal(await cq(LB1), 0, 'cloud só credita B quando a recepção sincroniza');
  await localSale(LB1, 2, 's3'); // 8. venda em B (offline)
  assert.equal(await lq(LB1), 10);

  // 9. B reconecta: receive primeiro, depois a venda; retries de tudo
  const s3 = uuid();
  await syncTransfersToCloud(dB);
  assert.equal((await cloudSale(dB, LB1, 2, s3)).error, null);
  await syncTransfersToCloud(dB);
  await syncTransfersToCloud(dA);
  await syncLedger(dA);
  await syncLedger(dB);
  const again = await cloudSale(dB, LB1, 2, s3);
  assert.equal(again.data[0].already_exists, true);
  assert.equal((await cloudSale(dA, LA1, 5, s1)).data[0].already_exists, true);

  // 10. saldos finais e ausência de duplicações
  assert.deepEqual([await cq(LA1), await cq(LA2), await cq(LB1)], [23, 7, 10]);
  assert.equal((await svc.from('stock_in_transit').select('quantity').eq('transfer_id', d.id)).data.length, 0);
  assert.deepEqual([await storeTotal(A), await storeTotal(B)], [30, 10]);
  const rec = await led.computeReconciliation({ tenantId: LT, cloudRows: (await svc.from('warehouse_stock').select('warehouse_id,product_id,quantity').in('warehouse_id', [LA1, LA2, LB1])).data });
  assert.equal(rec.divergent.filter((x) => [LA1, LA2, LB1].includes(x.warehouse_id)).length, 0, 'saldo local == ledger cloud por warehouse');
  const movs = (await svc.from('stock_movements').select('type,reference_id,quantity,warehouse_id').eq('tenant_id', tenantId)).data;
  const keys = movs.map((m) => `${m.type}|${m.reference_id}`);
  assert.equal(new Set(keys).size, keys.length, 'sem movimentos duplicados');
  const count = (ty) => movs.filter((m) => m.type === ty).length;
  assert.deepEqual([count('restock'), count('sale'), count('transfer_out'), count('transfer_in'), count('opening')], [1, 3, 2, 2, 0]);
  assert.equal(movs.filter((m) => m.type === 'sale').length, 3);
  assert.ok((await svc.from('warehouse_stock').select('quantity').eq('tenant_id', tenantId)).data.every((r) => Number(r.quantity) >= 0), 'sem stock negativo');
  assert.equal(Number((await svc.from('products').select('stock_quantity').eq('id', P).single()).data.stock_quantity), 0, 'products.stock_quantity global não é autoridade');
  assert.equal((await svc.from('products').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId)).count, 1, 'um só produto mestre');
});
