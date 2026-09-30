/**
 * Pilot Gate POS/Dinheiro — breakdown real por tender na cloud (order_payments) via
 * create_order_with_items(order_data, items, payments). Device JWT REAL + Postgres REAL
 * (supabase/), mesmo padrão de sale-warehouse-live.integration.test.mjs.
 *
 * Env: POSLY_1G5A_ISSUER_URL, _ADMIN_TOKEN, _SUPABASE_URL, _ANON_KEY, _SERVICE_ROLE_KEY.
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { test, before } from 'node:test';
import { createClient } from '@supabase/supabase-js';

const E = (k) => process.env[`POSLY_1G5A_${k}`] || '';
const run = Boolean(E('ISSUER_URL') && E('ADMIN_TOKEN') && E('SUPABASE_URL') && E('ANON_KEY') && E('SERVICE_ROLE_KEY'));
const opts = { skip: !run && 'defina POSLY_1G5A_*' };
const svc = run ? createClient(E('SUPABASE_URL'), E('SERVICE_ROLE_KEY'), { auth: { persistSession: false } }) : null;
const uuid = () => crypto.randomUUID();
const rand = () => crypto.randomBytes(3).toString('hex');

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
  const boot = await post('/api/license-issuer/device/bootstrap', { activation_token: tok.data.activation_token, machine_id: `m-${rand()}` }, false);
  assert.equal(boot.status, 200, JSON.stringify(boot.data));
  return createClient(E('SUPABASE_URL'), E('ANON_KEY'), { global: { headers: { Authorization: `Bearer ${boot.data.access_token}` } }, auth: { persistSession: false } });
}

const c = {};
const sell = (cl, productId, qty, total, payments, extra = {}) => {
  const localSaleId = extra.local_sale_id ?? `sale-${uuid()}`;
  return cl
    .rpc('create_order_with_items', {
      order_data: { total, subtotal: total, doc_type: 'VD', ...extra, local_sale_id: localSaleId },
      items: [{ product_id: productId, product_name: 'p', quantity: qty, price: total / qty }],
      payments,
    })
    .then((r) => ({ ...r, localSaleId }));
};
const paymentsOf = (orderId) => svc.from('order_payments').select('method,amount,tendered_amount').eq('order_id', orderId).then((r) => r.data);

before(async () => {
  if (!run) return;
  const tenantId = `itest-1g5a-${rand()}`;
  await post('/api/license-issuer/tenants', { id: tenantId, name: 'T1G5A' });
  const lic = await post('/api/license-issuer/licenses', { tenant_id: tenantId, plan: 'PRO', commerce_type: 'retalho' });
  c.t = { tenantId, licenseId: lic.data.license.id };
  const store = (await post('/api/license-issuer/stores', { tenant_id: tenantId, license_id: c.t.licenseId, name: 'A' })).data.store.id;
  c.store = store;
  c.device = await device(c.t, store);
  c.product = (await svc.from('products').insert({ tenant_id: tenantId, name: 'p1', price: 5, stock_quantity: 1000 }).select('id').single()).data.id;
  await svc.from('store_products').insert({ tenant_id: tenantId, store_id: store, product_id: c.product, status: 'active' });
});

test('venda simples (dinheiro): 1 linha em order_payments, SUM(amount) = total', opts, async () => {
  const r = await sell(c.device, c.product, 2, 100, [{ method: 'Dinheiro', amount: 100, tendered_amount: null }]);
  assert.equal(r.error, null, JSON.stringify(r.error));
  const orderId = r.data[0].order_id;
  const rows = await paymentsOf(orderId);
  assert.deepEqual(rows, [{ method: 'Dinheiro', amount: 100, tendered_amount: null }]);
});

test('venda mista com troco (60 dinheiro líquido + 40 cartão): breakdown chega intacto à cloud', opts, async () => {
  const r = await sell(c.device, c.product, 2, 100, [
    { method: 'Dinheiro', amount: 60, tendered_amount: 70 },
    { method: 'cartao', amount: 40, tendered_amount: null },
  ]);
  assert.equal(r.error, null, JSON.stringify(r.error));
  const orderId = r.data[0].order_id;
  const rows = await paymentsOf(orderId);
  const byMethod = Object.fromEntries(rows.map((row) => [row.method, row]));
  assert.equal(byMethod['Dinheiro'].amount, 60);
  assert.equal(byMethod['Dinheiro'].tendered_amount, 70);
  assert.equal(byMethod['cartao'].amount, 40);
  assert.equal(byMethod['cartao'].tendered_amount, null);
  const sum = rows.reduce((acc, row) => acc + Number(row.amount), 0);
  assert.equal(sum, 100, 'SUM(amount) na cloud tem de bater com orders.total');
});

test('retry (mesmo local_sale_id): nunca duplica linhas em order_payments', opts, async () => {
  const first = await sell(c.device, c.product, 1, 50, [{ method: 'Dinheiro', amount: 50, tendered_amount: null }]);
  assert.equal(first.error, null, JSON.stringify(first.error));
  const orderId = first.data[0].order_id;
  const retry = await sell(c.device, c.product, 1, 50, [{ method: 'Dinheiro', amount: 999, tendered_amount: null }], { local_sale_id: first.localSaleId });
  assert.equal(retry.data[0].already_exists, true);
  assert.equal(retry.data[0].order_id, orderId);
  const rows = await paymentsOf(orderId);
  assert.equal(rows.length, 1, 'retry nunca insere uma segunda linha, mesmo com payments diferente');
  assert.equal(rows[0].amount, 50, 'o valor fica o da PRIMEIRA tentativa, nunca o do retry');
});

test('venda sem payments (device antigo, compatibilidade): continua a funcionar, sem linhas em order_payments', opts, async () => {
  const r = await sell(c.device, c.product, 1, 20, null);
  assert.equal(r.error, null, JSON.stringify(r.error));
  const rows = await paymentsOf(r.data[0].order_id);
  assert.deepEqual(rows, [], 'sem payments enviado = sem breakdown, mas a venda em si tem de continuar a funcionar');
});

test('chamada com só 2 argumentos (assinatura antiga) continua a funcionar', opts, async () => {
  const localSaleId = `sale-${uuid()}`;
  const r = await c.device.rpc('create_order_with_items', {
    order_data: { total: 5, subtotal: 5, doc_type: 'VD', local_sale_id: localSaleId },
    items: [{ product_id: c.product, product_name: 'p', quantity: 1, price: 5 }],
  });
  assert.equal(r.error, null, JSON.stringify(r.error));
  assert.deepEqual(await paymentsOf(r.data[0].order_id), []);
});
