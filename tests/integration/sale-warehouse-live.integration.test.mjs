/**
 * Etapa 1G.2B.2 - venda + sync com stock por Store/Warehouse. Device JWT REAL + Postgres REAL
 * (supabase/). Env: POSLY_1G2B2_ISSUER_URL, _ADMIN_TOKEN, _SUPABASE_URL, _ANON_KEY,
 * _SERVICE_ROLE_KEY. (2 bootstraps; rate limit 10/h/IP)
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { test, before } from 'node:test';
import { createClient } from '@supabase/supabase-js';

const E = (k) => process.env[`POSLY_1G2B2_${k}`] || '';
const run = Boolean(E('ISSUER_URL') && E('ADMIN_TOKEN') && E('SUPABASE_URL') && E('ANON_KEY') && E('SERVICE_ROLE_KEY'));
const opts = { skip: !run && 'defina POSLY_1G2B2_*' };
const svc = run ? createClient(E('SUPABASE_URL'), E('SERVICE_ROLE_KEY'), { auth: { persistSession: false } }) : null;

async function post(path, body, admin = true) {
  const res = await fetch(`${E('ISSUER_URL')}${path}`, {
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
// espelha um armazém local (id UUID local = id cloud estável)
const pushWh = (cl, id, name, isDefault = false, isActive = true) =>
  cl.rpc('sync_upsert_warehouse', { p_id: id, p_name: name, p_code: null, p_is_default: isDefault, p_is_active: isActive });
const defaults = async (storeId) => (await svc.from('warehouses').select('id').eq('store_id', storeId).eq('is_default', true)).data.map((r) => r.id);
const stockOf = async (whId, productId) => Number((await svc.from('warehouse_stock').select('quantity').eq('warehouse_id', whId).eq('product_id', productId)).data?.[0]?.quantity ?? 0);
const sell = (cl, productId, qty, extra = {}) => {
  const localSaleId = extra.local_sale_id ?? `sale-${uuid()}`;
  return cl
    .rpc('create_order_with_items', {
      order_data: { total: qty * 5, subtotal: qty * 5, doc_type: 'VD', ...extra, local_sale_id: localSaleId },
      items: [{ product_id: productId, product_name: 'p', quantity: qty, price: 5 }],
    })
    .then((r) => ({ ...r, localSaleId }));
};
const movOf = async (orderId) => (await svc.from('stock_movements').select('store_id, warehouse_id, quantity').eq('reference_id', `order:${orderId}`)).data;

before(async () => {
  if (!run) return;
  const tenantId = `itest-2b2-${crypto.randomBytes(3).toString('hex')}`;
  await post('/api/license-issuer/tenants', { id: tenantId, name: 'T' });
  const lic = await post('/api/license-issuer/licenses', { tenant_id: tenantId, plan: 'PRO', commerce_type: 'retalho' });
  c.t = { tenantId, licenseId: lic.data.license.id };
  const mkStore = async (name) => (await post('/api/license-issuer/stores', { tenant_id: tenantId, license_id: c.t.licenseId, name })).data.store.id;
  c.A = await mkStore('A');
  c.B = await mkStore('B');
  c.dA = await device(c.t, c.A);
  c.dB = await device(c.t, c.B);
  const prod = async (name) => (await svc.from('products').insert({ tenant_id: tenantId, name, price: 5, stock_quantity: 100 }).select('id').single()).data.id;
  c.p1 = await prod('p1');
  c.p2 = await prod('p2');
  c.p3 = await prod('p3');
  const sp = (storeId, productId, status = 'active') => svc.from('store_products').insert({ tenant_id: tenantId, store_id: storeId, product_id: productId, status });
  await sp(c.A, c.p1); await sp(c.A, c.p2); await sp(c.A, c.p3, 'discontinued');
  await sp(c.B, c.p1);
  // Store A: A1 (default local), A2 Bar, A3 Restaurante
  c.A1 = uuid(); c.A2 = uuid(); c.A3 = uuid();
  for (const [id, name, def] of [[c.A2, 'Bar', false], [c.A3, 'Restaurante', false], [c.A1, 'Principal', true]]) {
    const r = await pushWh(c.dA, id, name, def);
    assert.equal(r.error, null, JSON.stringify(r.error));
  }
  c.B1 = (await defaults(c.B))[0];
});

test('warehouses locais sincronizam com id estável; Store A fica com exactamente 1 default (o local)', opts, async () => {
  assert.deepEqual(await defaults(c.A), [c.A1]);
  const { data } = await svc.from('warehouses').select('id, store_id, name').eq('store_id', c.A);
  assert.deepEqual(new Set(data.map((w) => w.id)), new Set([c.A1, c.A2, c.A3]), 'o "Armazém Principal" cloud sem movimentos foi substituído');
  assert.ok(data.every((w) => w.store_id === c.A));
  // re-sync idempotente (mesmo id, mesmo resultado)
  assert.equal((await pushWh(c.dA, c.A2, 'Bar', false)).error, null);
  assert.equal((await svc.from('warehouses').select('id').eq('id', c.A2)).data.length, 1);
});

test('venda sem warehouse -> default da Store; com warehouse (Bar/Restaurante) -> esse warehouse', opts, async () => {
  const r0 = await sell(c.dA, c.p1, 2);
  assert.equal(r0.error, null, JSON.stringify(r0.error));
  assert.equal((await movOf(r0.data[0].order_id))[0].warehouse_id, c.A1);
  const r1 = await sell(c.dA, c.p1, 3, { warehouse_id: c.A2 });
  assert.equal((await movOf(r1.data[0].order_id))[0].warehouse_id, c.A2);
  const r2 = await sell(c.dA, c.p1, 4, { warehouse_id: c.A3 });
  assert.equal((await movOf(r2.data[0].order_id))[0].warehouse_id, c.A3);
  assert.equal(await stockOf(c.A1, c.p1), -2);
  assert.equal(await stockOf(c.A2, c.p1), -3);
  assert.equal(await stockOf(c.A3, c.p1), -4);
});

test('products.stock_quantity global não é tocado nem é autoridade', opts, async () => {
  const { data } = await svc.from('products').select('stock_quantity').eq('id', c.p1).single();
  assert.equal(Number(data.stock_quantity), 100);
});

test('mudar o default A1 -> A3: só 1 default; venda sem warehouse cai em A3', opts, async () => {
  assert.equal((await pushWh(c.dA, c.A3, 'Restaurante', true)).error, null);
  assert.deepEqual(await defaults(c.A), [c.A3]);
  const r = await sell(c.dA, c.p2, 1);
  assert.equal((await movOf(r.data[0].order_id))[0].warehouse_id, c.A3);
  // 2.º default directo é impossível
  const dup = await svc.from('warehouses').update({ is_default: true }).eq('id', c.A2);
  assert.ok(dup.error);
});

test('segurança: warehouse de outra Store rejeitado; device nunca cria/reclama warehouse alheio', opts, async () => {
  const cross = await sell(c.dA, c.p1, 1, { warehouse_id: c.B1 });
  assert.ok(cross.error);
  assert.match(cross.error.message, /warehouse_not_in_store/);
  const wid = uuid();
  const steal = await pushWh(c.dA, c.B1, 'roubo', false);
  assert.ok(steal.error);
  assert.match(steal.error.message, /warehouse_belongs_to_other_store/);
  // store_id enviado pelo cliente continua ignorado
  const r = await sell(c.dA, c.p1, 1, { store_id: c.B, warehouse_id: c.A2 });
  assert.equal(r.error, null);
  const m = await movOf(r.data[0].order_id);
  assert.equal(m[0].store_id, c.A);
  assert.equal(m[0].warehouse_id, c.A2);
  void wid;
});

test('Store B independente: default próprio, vendas de A não a afectam', opts, async () => {
  const before = await stockOf(c.B1, c.p1);
  const r = await sell(c.dB, c.p1, 5);
  assert.equal(r.error, null, JSON.stringify(r.error));
  assert.equal((await movOf(r.data[0].order_id))[0].warehouse_id, c.B1);
  assert.equal(await stockOf(c.B1, c.p1), before - 5);
  assert.deepEqual(await defaults(c.B), [c.B1]);
  const bNoA = await sell(c.dB, c.p1, 1, { warehouse_id: c.A1 });
  assert.match(bNoA.error.message, /warehouse_not_in_store/);
});

test('produto activo/inactivo/ausente por Store', opts, async () => {
  // 1G.2B.3: descontinuado NAO rejeita (venda autorizada localmente/offline); ausente da Store continua rejeitado
  const disc = await sell(c.dA, c.p3, 1);
  assert.equal(disc.error, null, JSON.stringify(disc.error));
  const absent = await sell(c.dB, c.p2, 1);
  assert.match(absent.error.message, /item_product_not_in_store/);
  assert.equal((await sell(c.dA, c.p2, 1)).error, null);
});

test('idempotência + concorrência: retry não duplica; vendas simultâneas em armazéns diferentes somam certo', opts, async () => {
  const first = await sell(c.dA, c.p2, 2, { warehouse_id: c.A2 });
  const retry = await sell(c.dA, c.p2, 2, { warehouse_id: c.A2, local_sale_id: first.localSaleId });
  assert.equal(retry.data[0].already_exists, true);
  assert.equal((await movOf(first.data[0].order_id)).length, 1);
  // retry a apontar para outro armazém devolve a venda original (armazém original preservado)
  const retryOther = await sell(c.dA, c.p2, 2, { warehouse_id: c.A3, local_sale_id: first.localSaleId });
  assert.equal(retryOther.data[0].already_exists, true);
  assert.equal((await movOf(first.data[0].order_id))[0].warehouse_id, c.A2);

  const b2 = await stockOf(c.A2, c.p2);
  const b3 = await stockOf(c.A3, c.p2);
  const res = await Promise.all([
    ...Array.from({ length: 5 }, () => sell(c.dA, c.p2, 1, { warehouse_id: c.A2 })),
    ...Array.from({ length: 5 }, () => sell(c.dA, c.p2, 1, { warehouse_id: c.A3 })),
  ]);
  assert.ok(res.every((x) => !x.error), JSON.stringify(res.map((x) => x.error)));
  assert.equal(await stockOf(c.A2, c.p2), b2 - 5);
  assert.equal(await stockOf(c.A3, c.p2), b3 - 5);
});

test('offline -> reconnect: venda antiga com warehouse Bar chega depois e mantém Store+Warehouse', opts, async () => {
  const old = new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString();
  const r = await sell(c.dA, c.p1, 1, { warehouse_id: c.A2, created_at: old });
  assert.equal(r.error, null, JSON.stringify(r.error));
  const m = await movOf(r.data[0].order_id);
  assert.equal(m[0].store_id, c.A);
  assert.equal(m[0].warehouse_id, c.A2);
});
