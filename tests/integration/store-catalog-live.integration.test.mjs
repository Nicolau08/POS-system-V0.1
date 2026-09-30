/**
 * Etapa 1G.2B.4 - catalogo por Store. Device JWT REAL + Postgres REAL + license-console REAL (rota de copia).
 * O ultimo teste liga o POS local (SQLite real + storeCatalog.service) ao pull real limitado a Store do Device.
 * Env: POSLY_1G2B4_ISSUER_URL, _ADMIN_TOKEN, _SUPABASE_URL, _ANON_KEY, _SERVICE_ROLE_KEY. (3 bootstraps)
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, before } from 'node:test';
import { createClient } from '@supabase/supabase-js';

const E = (k) => process.env[`POSLY_1G2B4_${k}`] || '';
const run = Boolean(E('ISSUER_URL') && E('ADMIN_TOKEN') && E('SUPABASE_URL') && E('ANON_KEY') && E('SERVICE_ROLE_KEY'));
const opts = { skip: !run && 'defina POSLY_1G2B4_*' };
const svc = run ? createClient(E('SUPABASE_URL'), E('SERVICE_ROLE_KEY'), { auth: { persistSession: false } }) : null;

if (run) {
  process.env.POS_DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'posly-1g2b4-live-')), 'database.db');
  process.env.DEFAULT_TENANT_ID = 'tenant-1g2b4-live-local';
}
const local = run
  ? { db: (await import('../../api/database.js')).default, cat: await import('../../api/services/storeCatalog.service.js') }
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
const setSp = (cl, product, config = {}) => cl.rpc('set_store_product', { p_product_id: product, p_config: config });
const sell = (cl, p, extra = {}) =>
  cl.rpc('create_order_with_items', {
    order_data: { local_sale_id: `sale-${uuid()}`, total: 5, subtotal: 5, doc_type: 'VD', ...extra },
    items: [{ product_id: p, product_name: 'x', quantity: 1, price: 5 }],
  });
const spRow = async (store, p) => (await svc.from('store_products').select('status, price_override, min_stock').eq('store_id', store).eq('product_id', p)).data?.[0];
const stockRows = async (store, p) => (await svc.from('warehouse_stock').select('quantity').eq('store_id', store).eq('product_id', p)).data ?? [];

before(async () => {
  if (!run) return;
  const mkT = async (n) => {
    const tenantId = `itest-2b4-${n}-${crypto.randomBytes(3).toString('hex')}`;
    await post('/api/license-issuer/tenants', { id: tenantId, name: n });
    const lic = await post('/api/license-issuer/licenses', { tenant_id: tenantId, plan: 'PRO', commerce_type: 'retalho' });
    return { tenantId, licenseId: lic.data.license.id };
  };
  c.t = await mkT('T1');
  c.t2 = await mkT('T2');
  const mkS = async (t, n) => (await post('/api/license-issuer/stores', { tenant_id: t.tenantId, license_id: t.licenseId, name: n })).data.store.id;
  c.A = await mkS(c.t, 'A');
  c.B = await mkS(c.t, 'B');
  c.C = await mkS(c.t2, 'C');
  c.dA = await device(c.t, c.A);
  c.dB = await device(c.t, c.B);
  const prod = async (t, name) => (await svc.from('products').insert({ tenant_id: t.tenantId, name, price: 5 }).select('id').single()).data.id;
  c.P = await prod(c.t, 'P');
  c.Q = await prod(c.t, 'Q');
  c.PC = await prod(c.t2, 'PC');
});

test('P activo na Store A; P inexistente em B -> B não vende; catálogo por Store lido só da própria Store', opts, async () => {
  const r = await setSp(c.dA, c.P);
  assert.equal(r.error, null, JSON.stringify(r.error));
  assert.equal(r.data[0].out_created, true);
  assert.equal(r.data[0].out_status, 'active');
  assert.equal((await sell(c.dA, c.P)).error, null);
  const b = await sell(c.dB, c.P);
  assert.match(b.error.message, /item_product_not_in_store/);
  assert.equal((await c.dA.from('store_products').select('store_id')).data.every((x) => x.store_id === c.A), true);
  assert.equal((await c.dB.from('store_products').select('store_id')).data.length, 0);
});

test('copiar P para B (rota da consola): mesmo products.id, sem duplicar produto, stock de B independente/zero, B passa a vender', opts, async () => {
  await svc.from('stock_movements').select('id').limit(1);
  // A tem stock; B nao
  assert.equal((await c.dA.rpc('sync_stock_movements', { p_groups: [[{ reference_id: `r-${uuid()}`, type: 'restock', product_id: c.P, warehouse_id: (await svc.from('warehouses').select('id').eq('store_id', c.A).eq('is_default', true).single()).data.id, quantity: 10, created_at: new Date().toISOString() }]] })).error, null);
  const res = await post('/api/license-issuer/store-products', { tenant_id: c.t.tenantId, store_id: c.B, product_id: c.P, config: {} });
  assert.equal(res.status, 200, JSON.stringify(res.data));
  assert.equal(res.data.store_product.created, true);
  assert.equal((await stockRows(c.B, c.P)).length, 0, 'B nasce sem stock e sem movimentos');
  const { count } = await svc.from('products').select('id', { count: 'exact', head: true }).eq('tenant_id', c.t.tenantId).eq('name', 'P');
  assert.equal(count, 1, 'produto mestre nunca duplicado');
  assert.equal((await sell(c.dB, c.P)).error, null, 'B passa a vender');
  assert.equal((await stockRows(c.A, c.P)).reduce((s, r) => s + Number(r.quantity), 0), 10 - 1, 'stock de A não foi tocado pela venda de B');
  assert.equal((await stockRows(c.B, c.P)).reduce((s, r) => s + Number(r.quantity), 0), -1, 'stock de B é independente');
});

test('price_override e min_stock diferentes por Store; null limpa; valores inválidos rejeitados', opts, async () => {
  assert.equal((await setSp(c.dA, c.P, { price_override: 7, min_stock: 2 })).error, null);
  assert.equal((await setSp(c.dB, c.P, { price_override: 9, min_stock: 5 })).error, null);
  assert.deepEqual([(await spRow(c.A, c.P)).price_override, (await spRow(c.A, c.P)).min_stock].map(Number), [7, 2]);
  assert.deepEqual([(await spRow(c.B, c.P)).price_override, (await spRow(c.B, c.P)).min_stock].map(Number), [9, 5]);
  const cleared = await setSp(c.dA, c.P, { price_override: null });
  assert.equal(cleared.data[0].out_price_override, null);
  assert.equal(Number(cleared.data[0].out_min_stock), 2, 'chaves ausentes mantêm-se');
  assert.ok((await setSp(c.dA, c.P, { price_override: -1 })).error);
  assert.match((await setSp(c.dA, c.P, { status: 'banana' })).error.message, /status_invalid/);
});

test('discontinued em A não afecta B; não apaga histórico nem stock; a cloud aceita venda histórica offline; reactivar repõe', opts, async () => {
  const stockA = (await stockRows(c.A, c.P)).reduce((s, r) => s + Number(r.quantity), 0);
  const movs = (await svc.from('stock_movements').select('id', { count: 'exact', head: true }).eq('store_id', c.A)).count;
  assert.equal((await setSp(c.dA, c.P, { status: 'discontinued' })).data[0].out_status, 'discontinued');
  assert.equal((await spRow(c.B, c.P)).status, 'active');
  assert.equal((await sell(c.dB, c.P)).error, null, 'B continua a vender');
  assert.equal((await sell(c.dA, c.P)).error, null, 'venda histórica feita offline antes do pull continua a sincronizar (decisão 1G.2B.3)');
  assert.equal((await stockRows(c.A, c.P)).reduce((s, r) => s + Number(r.quantity), 0), stockA - 1);
  assert.ok((await svc.from('stock_movements').select('id', { count: 'exact', head: true }).eq('store_id', c.A)).count >= movs);
  assert.equal((await setSp(c.dA, c.P, { status: 'active' })).data[0].out_status, 'active');
});

test('segurança: cross-tenant/cross-store bloqueado; device não escreve nem escolhe outra Store', opts, async () => {
  const other = await setSp(c.dA, c.PC); // produto de outro tenant
  assert.match(other.error.message, /product_not_in_tenant/);
  const badStore = await post('/api/license-issuer/store-products', { tenant_id: c.t.tenantId, store_id: c.C, product_id: c.P });
  assert.equal(badStore.status, 403, 'Store de outro tenant');
  const badProd = await post('/api/license-issuer/store-products', { tenant_id: c.t.tenantId, store_id: c.B, product_id: c.PC });
  assert.equal(badProd.status, 403, 'produto de outro tenant');
  assert.equal((await post('/api/license-issuer/store-products', { tenant_id: c.t.tenantId, store_id: c.B, product_id: c.P }, false)).status, 401);
  assert.ok((await c.dA.from('store_products').insert({ tenant_id: c.t.tenantId, store_id: c.B, product_id: c.Q })).error, 'INSERT directo negado');
  assert.ok((await c.dA.rpc('admin_set_store_product', { p_tenant_id: c.t.tenantId, p_store_id: c.B, p_product_id: c.Q, p_config: {} })).error, 'função admin não é chamável por devices');
  assert.equal(await spRow(c.B, c.Q), undefined);
  // o device de A não consegue tocar em B: a Store vem sempre do JWT
  assert.equal(await spRow(c.B, c.Q), undefined);
});

test('POS local: pull real (RLS = só a Store do Device) -> B vende P, não vende Q; offline usa último estado; após pull discontinued bloqueia; venda anterior sincroniza', opts, async () => {
  const { db, cat } = local;
  const T = 'tenant-1g2b4-live-local';
  const runDb = (s, p = []) => new Promise((res, rej) => db.run(s, p, (e) => (e ? rej(e) : res())));
  const allDb = (s, p = []) => new Promise((res, rej) => db.all(s, p, (e, r) => (e ? rej(e) : res(r))));
  const deadline = Date.now() + 8000;
  for (;;) {
    try { await allDb('SELECT 1 FROM store_catalog_state LIMIT 1'); break; } catch (e) { if (Date.now() > deadline) throw e; await new Promise((r) => setTimeout(r, 100)); }
  }
  const now = () => new Date().toISOString();
  for (const [name, cid] of [['P', c.P], ['Q', c.Q]]) {
    await runDb(`INSERT INTO products (cloud_id, tenant_id, name, price, created_at, updated_at) VALUES (?, ?, ?, 5, ?, ?)`, [cid, T, name, now(), now()]);
  }
  const lid = async (n) => (await allDb(`SELECT id FROM products WHERE name = ?`, [n]))[0].id;
  const [lp, lq] = [await lid('P'), await lid('Q')];
  const pull = async () => {
    const { data, error } = await c.dB.from('store_products').select('product_id,store_id,status,price_override,min_stock,updated_at');
    assert.equal(error, null);
    assert.ok(data.every((r) => r.store_id === c.B), 'pull só devolve a Store do Device');
    await cat.applyStoreProductRows(T, data, { initialize: true });
  };
  await pull();
  const unsellable = async (...ids) => (await cat.findUnsellableCartItems(ids.map((id) => ({ id, quantity: 1 })), T)).map((x) => x.reason);
  assert.deepEqual(await unsellable(lp), []);
  assert.deepEqual(await unsellable(lq), ['not_in_store']);

  // a cloud descontinua P em B; enquanto o POS não recebe (offline), continua a vender
  assert.equal((await setSp(c.dB, c.P, { status: 'discontinued' })).error, null);
  assert.deepEqual(await unsellable(lp), []);
  const offlineSale = await sell(c.dB, c.P); // venda feita antes do pull, sincronizada depois: cloud aceita
  assert.equal(offlineSale.error, null, JSON.stringify(offlineSale.error));
  await pull();
  assert.deepEqual(await unsellable(lp), ['discontinued'], 'depois do pull bloqueia NOVA venda');
  const afterPull = await sell(c.dB, c.P);
  assert.equal(afterPull.error, null, 'sync de venda histórica/idempotente continua aceite pela cloud');

  // copiar Q para B: passa a vender depois do pull
  assert.equal((await post('/api/license-issuer/store-products', { tenant_id: c.t.tenantId, store_id: c.B, product_id: c.Q })).status, 200);
  assert.deepEqual(await unsellable(lq), ['not_in_store'], 'ainda não chegou');
  await pull();
  assert.deepEqual(await unsellable(lq), []);
});
