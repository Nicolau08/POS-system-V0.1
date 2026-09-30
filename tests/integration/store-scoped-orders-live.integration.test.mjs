/**
 * Etapa 1G.2B - store_id em orders/order_items/stock_movements derivado no servidor
 * (Device JWT -> device_id -> pos_devices.store_id), com Device JWT REAL contra
 * license-console + Postgres reais (supabase/). Sem mocks.
 * Env: POSLY_1G2B_ISSUER_URL, POSLY_1G2B_ADMIN_TOKEN, POSLY_1G2B_SUPABASE_URL,
 *      POSLY_1G2B_ANON_KEY, POSLY_1G2B_SERVICE_ROLE_KEY.
 * (usa 3 bootstraps; /device/bootstrap tem rate limit 10/h/IP)
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { test, before } from 'node:test';
import { createClient } from '@supabase/supabase-js';

const ISSUER_URL = process.env.POSLY_1G2B_ISSUER_URL || '';
const ADMIN_TOKEN = process.env.POSLY_1G2B_ADMIN_TOKEN || '';
const SUPABASE_URL = process.env.POSLY_1G2B_SUPABASE_URL || '';
const ANON_KEY = process.env.POSLY_1G2B_ANON_KEY || '';
const SERVICE_KEY = process.env.POSLY_1G2B_SERVICE_ROLE_KEY || '';
const run = Boolean(ISSUER_URL && ADMIN_TOKEN && SUPABASE_URL && ANON_KEY && SERVICE_KEY);
const opts = { skip: !run && 'defina POSLY_1G2B_*' };

const svc = run ? createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } }) : null;

async function post(path, body, admin = true) {
  const res = await fetch(`${ISSUER_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(admin ? { Authorization: `Bearer ${ADMIN_TOKEN}` } : {}) },
    body: JSON.stringify(body),
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

async function provisionDevice(tenantId, licenseId, storeId) {
  const tok = await post('/api/license-issuer/device/activation-tokens', { tenant_id: tenantId, license_id: licenseId, store_id: storeId });
  assert.equal(tok.status, 200, JSON.stringify(tok.data));
  const boot = await post('/api/license-issuer/device/bootstrap', { activation_token: tok.data.activation_token, machine_id: `m-${crypto.randomBytes(3).toString('hex')}` }, false);
  assert.equal(boot.status, 200, JSON.stringify(boot.data));
  const client = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${boot.data.access_token}` } },
    auth: { persistSession: false },
  });
  return { client, deviceId: boot.data.device_id };
}

const ctx = {};

before(async () => {
  if (!run) return;
  const mk = async (label) => {
    const tenantId = `itest-1g2b-${label}-${crypto.randomBytes(3).toString('hex')}`;
    await post('/api/license-issuer/tenants', { id: tenantId, name: label });
    const lic = await post('/api/license-issuer/licenses', { tenant_id: tenantId, plan: 'PRO', commerce_type: 'retalho' });
    const licenseId = lic.data.license.id;
    const stores = [];
    for (const n of label === 'T1' ? ['A', 'B'] : ['C']) {
      const s = await post('/api/license-issuer/stores', { tenant_id: tenantId, license_id: licenseId, name: `Loja ${n}` });
      assert.equal(s.status, 200, JSON.stringify(s.data));
      stores.push(s.data.store.id);
    }
    return { tenantId, licenseId, stores };
  };
  ctx.t1 = await mk('T1');
  ctx.t2 = await mk('T2');
  ctx.storeA = ctx.t1.stores[0];
  ctx.storeB = ctx.t1.stores[1];
  ctx.storeC = ctx.t2.stores[0];
  ctx.dA = await provisionDevice(ctx.t1.tenantId, ctx.t1.licenseId, ctx.storeA);
  ctx.dB = await provisionDevice(ctx.t1.tenantId, ctx.t1.licenseId, ctx.storeB);
  ctx.dC = await provisionDevice(ctx.t2.tenantId, ctx.t2.licenseId, ctx.storeC);
  const { data: p1, error } = await svc.from('products').insert({ tenant_id: ctx.t1.tenantId, name: 'Produto T1', price: 10 }).select('id').single();
  assert.equal(error, null, JSON.stringify(error));
  ctx.product = p1.id;
  // 1G.2B.2: a venda exige o produto activo na Store do device
  for (const s of [ctx.storeA, ctx.storeB]) await svc.from('store_products').insert({ tenant_id: ctx.t1.tenantId, store_id: s, product_id: p1.id });
  const { data: p2 } = await svc.from('products').insert({ tenant_id: ctx.t2.tenantId, name: 'Produto T2', price: 10 }).select('id').single();
  ctx.productT2 = p2.id;
});

const sell = (client, extraOrder = {}, extraItem = {}, productId = ctx.product, qty = 2) => {
  const localSaleId = extraOrder.local_sale_id ?? `sale-${crypto.randomUUID()}`;
  return client
    .rpc('create_order_with_items', {
      order_data: { total: 20, subtotal: 20, doc_type: 'VD', ...extraOrder, local_sale_id: localSaleId },
      items: [{ product_id: productId, product_name: 'P', quantity: qty, price: 10, ...extraItem }],
    })
    .then((r) => ({ ...r, localSaleId }));
};

async function rowsFor(tenantId, localSaleId) {
  const { data: o } = await svc.from('orders').select('id, store_id, device_id, station_code').eq('tenant_id', tenantId).eq('local_sale_id', localSaleId);
  const orderId = o?.[0]?.id;
  const { data: items } = await svc.from('order_items').select('store_id').eq('order_id', orderId);
  const { data: mov } = await svc.from('stock_movements').select('store_id, quantity, type').eq('reference_id', `order:${orderId}`);
  return { orders: o ?? [], items: items ?? [], mov: mov ?? [] };
}

test('Device da Store A: order, order_items e stock_movements ficam com store_id=A (e device_id do JWT)', opts, async () => {
  const r = await sell(ctx.dA.client);
  assert.equal(r.error, null, JSON.stringify(r.error));
  const rows = await rowsFor(ctx.t1.tenantId, r.localSaleId);
  assert.equal(rows.orders.length, 1);
  assert.equal(rows.orders[0].store_id, ctx.storeA);
  assert.equal(rows.orders[0].device_id, ctx.dA.deviceId);
  assert.ok(rows.items.length === 1 && rows.items.every((i) => i.store_id === ctx.storeA));
  assert.ok(rows.mov.length === 1 && rows.mov[0].store_id === ctx.storeA && Number(rows.mov[0].quantity) === -2);
});

test('Device da Store B (mesmo tenant): store_id=B; as duas Stores ficam distinguíveis', opts, async () => {
  const r = await sell(ctx.dB.client);
  assert.equal(r.error, null, JSON.stringify(r.error));
  const rows = await rowsFor(ctx.t1.tenantId, r.localSaleId);
  assert.equal(rows.orders[0].store_id, ctx.storeB);
  assert.ok(rows.mov.every((m) => m.store_id === ctx.storeB));
  const { data: all } = await svc.from('orders').select('store_id').eq('tenant_id', ctx.t1.tenantId);
  const stores = new Set(all.map((o) => o.store_id));
  assert.ok(stores.has(ctx.storeA) && stores.has(ctx.storeB));
});

test('store_id enviado pelo POS (order_data e items) é ignorado: vale sempre a store do device', opts, async () => {
  const r = await sell(ctx.dA.client, { store_id: ctx.storeB, storeId: ctx.storeB }, { store_id: ctx.storeB });
  assert.equal(r.error, null, JSON.stringify(r.error));
  const rows = await rowsFor(ctx.t1.tenantId, r.localSaleId);
  assert.equal(rows.orders[0].store_id, ctx.storeA);
  assert.ok(rows.items.every((i) => i.store_id === ctx.storeA));
  assert.ok(rows.mov.every((m) => m.store_id === ctx.storeA));
  // store de OUTRO tenant também ignorada
  const r2 = await sell(ctx.dA.client, { store_id: ctx.storeC });
  assert.equal(r2.error, null);
  assert.equal((await rowsFor(ctx.t1.tenantId, r2.localSaleId)).orders[0].store_id, ctx.storeA);
});

test('RLS: device só lê orders/order_items/stock_movements da SUA store; outro tenant não lê nada', opts, async () => {
  await sell(ctx.dA.client);
  await sell(ctx.dB.client);
  const read = async (client, table) => {
    const { data, error } = await client.from(table).select('store_id');
    assert.equal(error, null, `${table}: ${JSON.stringify(error)}`);
    return data;
  };
  for (const table of ['orders', 'order_items', 'stock_movements']) {
    const a = await read(ctx.dA.client, table);
    assert.ok(a.length > 0 && a.every((r) => r.store_id === ctx.storeA), `A vê só A em ${table}`);
    const b = await read(ctx.dB.client, table);
    assert.ok(b.length > 0 && b.every((r) => r.store_id === ctx.storeB), `B vê só B em ${table}`);
    const c = await read(ctx.dC.client, table);
    assert.equal(c.length, 0, `tenant T2 não vê nada de T1 em ${table}`);
  }
});

test('tenant A nunca grava no tenant B: produto de T2 rejeitado; INSERT directo negado', opts, async () => {
  const r = await sell(ctx.dA.client, {}, {}, ctx.productT2);
  assert.ok(r.error);
  assert.match(r.error.message, /item_product_not_in_tenant/);
  const direct = await ctx.dA.client.from('orders').insert({ tenant_id: ctx.t2.tenantId, store_id: ctx.storeC, local_sale_id: 'x' });
  assert.ok(direct.error, 'escrita directa em orders continua negada');
  const directSm = await ctx.dA.client.from('stock_movements').insert({ tenant_id: ctx.t1.tenantId, store_id: ctx.storeB, product_id: ctx.product, type: 'adjustment', quantity: 1, reference_id: 'x' });
  assert.ok(directSm.error, 'escrita directa em stock_movements continua negada');
});

test('idempotência: retry da mesma venda não duplica order/items/stock; retry vindo de OUTRA store é recusado', opts, async () => {
  const first = await sell(ctx.dA.client);
  assert.equal(first.error, null);
  const retry = await sell(ctx.dA.client, { local_sale_id: first.localSaleId });
  assert.equal(retry.error, null);
  assert.equal(retry.data[0].already_exists, true);
  assert.equal(retry.data[0].order_id, first.data[0].order_id);
  const rows = await rowsFor(ctx.t1.tenantId, first.localSaleId);
  assert.equal(rows.orders.length, 1);
  assert.equal(rows.items.length, 1);
  assert.equal(rows.mov.length, 1);

  const cross = await sell(ctx.dB.client, { local_sale_id: first.localSaleId });
  assert.ok(cross.error);
  assert.match(cross.error.message, /sale_store_mismatch/);
  assert.equal((await rowsFor(ctx.t1.tenantId, first.localSaleId)).orders.length, 1);

  // retries concorrentes (mesma venda): exactamente 1 order/stock
  const lsid = `sale-${crypto.randomUUID()}`;
  const results = await Promise.all(Array.from({ length: 6 }, () => sell(ctx.dA.client, { local_sale_id: lsid })));
  assert.ok(results.every((x) => !x.error), JSON.stringify(results.map((x) => x.error)));
  assert.equal(results.filter((x) => x.data[0].already_exists === false).length, 1);
  const rows2 = await rowsFor(ctx.t1.tenantId, lsid);
  assert.equal(rows2.orders.length, 1);
  assert.equal(rows2.mov.length, 1);
});

test('station_code enviado é propagado como rótulo informativo; store continua a do device', opts, async () => {
  const r = await sell(ctx.dA.client, { station_code: 'caixa-2' });
  assert.equal(r.error, null);
  const rows = await rowsFor(ctx.t1.tenantId, r.localSaleId);
  assert.equal(rows.orders[0].station_code, 'caixa-2');
  assert.equal(rows.orders[0].store_id, ctx.storeA);
});
