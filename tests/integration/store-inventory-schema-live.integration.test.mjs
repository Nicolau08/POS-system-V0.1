/**
 * Etapa 1G.2B.1 - schema cloud de inventario multi-store (warehouses, store_products,
 * stock_movements com warehouse, stock derivado, RLS por store). Device JWT REAL +
 * Postgres REAL (supabase/). Env: POSLY_1G2B1_ISSUER_URL, _ADMIN_TOKEN,
 * _SUPABASE_URL, _ANON_KEY, _SERVICE_ROLE_KEY. (3 bootstraps; rate limit 10/h/IP)
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { test, before } from 'node:test';
import { createClient } from '@supabase/supabase-js';

const E = (k) => process.env[`POSLY_1G2B1_${k}`] || '';
const run = Boolean(E('ISSUER_URL') && E('ADMIN_TOKEN') && E('SUPABASE_URL') && E('ANON_KEY') && E('SERVICE_ROLE_KEY'));
const opts = { skip: !run && 'defina POSLY_1G2B1_*' };
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
before(async () => {
  if (!run) return;
  const mk = async (label, n) => {
    const tenantId = `itest-2b1-${label}-${crypto.randomBytes(3).toString('hex')}`;
    await post('/api/license-issuer/tenants', { id: tenantId, name: label });
    const lic = await post('/api/license-issuer/licenses', { tenant_id: tenantId, plan: 'PRO', commerce_type: 'retalho' });
    const licenseId = lic.data.license.id;
    const stores = [];
    for (let i = 0; i < n; i += 1) {
      const s = await post('/api/license-issuer/stores', { tenant_id: tenantId, license_id: licenseId, name: `${label}-${i}` });
      assert.equal(s.status, 200, JSON.stringify(s.data));
      stores.push(s.data.store.id);
    }
    return { tenantId, licenseId, stores };
  };
  c.t1 = await mk('T1', 2);
  c.t2 = await mk('T2', 1);
  [c.A, c.B] = c.t1.stores;
  [c.C] = c.t2.stores;
  c.dA = await device(c.t1, c.A);
  c.dB = await device(c.t1, c.B);
  c.dC = await device(c.t2, c.C);
  const prod = async (tenantId, name) => (await svc.from('products').insert({ tenant_id: tenantId, name, price: 5 }).select('id').single()).data.id;
  c.p1 = await prod(c.t1.tenantId, 'p1');
  c.p2 = await prod(c.t1.tenantId, 'p2');
  c.pC = await prod(c.t2.tenantId, 'pC');
  const wh = async (tenantId, storeId, name) => {
    const r = await svc.from('warehouses').insert({ tenant_id: tenantId, store_id: storeId, name }).select('id').single();
    assert.equal(r.error, null, JSON.stringify(r.error));
    return r.data.id;
  };
  c.A2 = await wh(c.t1.tenantId, c.A, 'A-Armazem-2');
  c.B2 = await wh(c.t1.tenantId, c.B, 'B-Armazem-2');
  const def = async (storeId) => (await svc.from('warehouses').select('id').eq('store_id', storeId).eq('is_default', true).single()).data.id;
  c.A1 = await def(c.A);
  c.B1 = await def(c.B);
  c.C1 = await def(c.C);
});

const mov = (o) => svc.from('stock_movements').insert({ reference_id: `r-${crypto.randomUUID()}`, type: 'restock', quantity: 1, ...o });

test('toda a store nasce com 1 Armazém Principal default; 2.º default na mesma store é rejeitado', opts, async () => {
  for (const s of [c.A, c.B, c.C]) {
    const { data } = await svc.from('warehouses').select('name, is_default').eq('store_id', s).eq('is_default', true);
    assert.equal(data.length, 1);
    assert.equal(data[0].name, 'Armazém Principal');
  }
  const dup = await svc.from('warehouses').insert({ tenant_id: c.t1.tenantId, store_id: c.A, name: 'outro-default', is_default: true });
  assert.ok(dup.error);
});

test('warehouse nunca pertence a outra store/tenant (FK composta + scope imutável)', opts, async () => {
  const cross = await svc.from('warehouses').insert({ tenant_id: c.t2.tenantId, store_id: c.A, name: 'x' });
  assert.ok(cross.error, 'tenant T2 com store de T1');
  const move = await svc.from('warehouses').update({ store_id: c.B }).eq('id', c.A2);
  assert.ok(move.error, 'mover warehouse para outra store é proibido');
});

test('store_products: bloqueia cross-tenant, duplicados e alteração de scope', opts, async () => {
  const ok = await svc.from('store_products').insert({ tenant_id: c.t1.tenantId, store_id: c.A, product_id: c.p1 });
  assert.equal(ok.error, null, JSON.stringify(ok.error));
  assert.ok((await svc.from('store_products').insert({ tenant_id: c.t1.tenantId, store_id: c.A, product_id: c.p1 })).error, 'duplicado');
  assert.ok((await svc.from('store_products').insert({ tenant_id: c.t1.tenantId, store_id: c.A, product_id: c.pC })).error, 'produto de outro tenant');
  assert.ok((await svc.from('store_products').insert({ tenant_id: c.t1.tenantId, store_id: c.C, product_id: c.p1 })).error, 'store de outro tenant');
  assert.ok((await svc.from('store_products').insert({ tenant_id: c.t2.tenantId, store_id: c.A, product_id: c.pC })).error, 'tenant errado para a store');
  assert.equal((await svc.from('store_products').insert({ tenant_id: c.t1.tenantId, store_id: c.B, product_id: c.p1 })).error, null, 'mesmo mestre em 2 stores, sem duplicar products');
  assert.ok((await svc.from('store_products').update({ store_id: c.B }).eq('store_id', c.A).eq('product_id', c.p1)).error);
  const { count } = await svc.from('products').select('id', { count: 'exact', head: true }).eq('tenant_id', c.t1.tenantId).eq('name', 'p1');
  assert.equal(count, 1);
});

test('stock_movements: warehouse da mesma store; default automático; cross-store/tenant bloqueados', opts, async () => {
  const auto = await mov({ tenant_id: c.t1.tenantId, store_id: c.A, product_id: c.p1, quantity: 10 }).select('warehouse_id').single();
  assert.equal(auto.data.warehouse_id, c.A1, 'sem warehouse -> default da store do movimento');
  assert.ok((await mov({ tenant_id: c.t1.tenantId, store_id: c.A, warehouse_id: c.B1, product_id: c.p1 })).error, 'warehouse da store B em movimento da store A');
  assert.ok((await mov({ tenant_id: c.t1.tenantId, store_id: c.A, warehouse_id: c.C1, product_id: c.p1 })).error, 'warehouse de outro tenant');
  assert.ok((await mov({ tenant_id: c.t1.tenantId, store_id: c.A, product_id: c.pC })).error, 'produto de outro tenant');
  assert.ok((await mov({ tenant_id: c.t1.tenantId, store_id: c.A, product_id: c.p1, from_warehouse_id: c.C1 })).error, 'from_warehouse de outro tenant');
});

test('venda via RPC (comportamento inalterado): movimento cai no armazém default da store do device', opts, async () => {
  await svc.from('store_products').upsert({ tenant_id: c.t1.tenantId, store_id: c.A, product_id: c.p2 });
  const lsid = `sale-${crypto.randomUUID()}`;
  const r = await c.dA.rpc('create_order_with_items', {
    order_data: { local_sale_id: lsid, total: 10, subtotal: 10, doc_type: 'VD' },
    items: [{ product_id: c.p2, product_name: 'p2', quantity: 2, price: 5 }],
  });
  assert.equal(r.error, null, JSON.stringify(r.error));
  const { data } = await svc.from('stock_movements').select('store_id, warehouse_id, quantity').eq('reference_id', `order:${r.data[0].order_id}`);
  assert.equal(data.length, 1);
  assert.equal(data[0].store_id, c.A);
  assert.equal(data[0].warehouse_id, c.A1);
  assert.equal(Number(data[0].quantity), -2);
});

test('stock derivado por store+warehouse+produto; 2 armazéns por store; transferência interna soma zero', opts, async () => {
  await mov({ tenant_id: c.t1.tenantId, store_id: c.A, warehouse_id: c.A2, product_id: c.p1, quantity: 4 });
  await mov({ tenant_id: c.t1.tenantId, store_id: c.B, warehouse_id: c.B2, product_id: c.p1, quantity: 6 });
  const ref = `wh-tr-${crypto.randomUUID()}`;
  await mov({ tenant_id: c.t1.tenantId, store_id: c.A, warehouse_id: c.A1, product_id: c.p1, type: 'transfer_out', quantity: -3, reference_id: `${ref}:out`, from_warehouse_id: c.A1, to_warehouse_id: c.A2 });
  await mov({ tenant_id: c.t1.tenantId, store_id: c.A, warehouse_id: c.A2, product_id: c.p1, type: 'transfer_in', quantity: 3, reference_id: `${ref}:in`, from_warehouse_id: c.A1, to_warehouse_id: c.A2 });
  const { data } = await svc.from('warehouse_stock').select('store_id, warehouse_id, quantity').eq('product_id', c.p1);
  const q = (wh) => Number(data.find((r) => r.warehouse_id === wh)?.quantity);
  assert.equal(q(c.A1), 10 - 3);
  assert.equal(q(c.A2), 4 + 3);
  assert.equal(q(c.B2), 6);
  assert.equal(data.find((r) => r.warehouse_id === c.A2).store_id, c.A);
});

test('RLS por store: device só vê warehouses, store_products e stock da SUA store; escrita directa negada', opts, async () => {
  const rd = async (cl, table) => {
    const r = await cl.from(table).select('store_id');
    assert.equal(r.error, null, `${table}: ${JSON.stringify(r.error)}`);
    return r.data;
  };
  for (const table of ['warehouses', 'store_products', 'stock_movements', 'warehouse_stock']) {
    const a = await rd(c.dA, table);
    const b = await rd(c.dB, table);
    assert.ok(a.length > 0 && a.every((r) => r.store_id === c.A), `A vê só A em ${table}`);
    assert.ok(b.length > 0 && b.every((r) => r.store_id === c.B), `B vê só B em ${table}`);
    if (table !== 'store_products') assert.ok((await rd(c.dC, table)).every((r) => r.store_id === c.C), `C vê só C em ${table}`);
  }
  assert.equal((await rd(c.dC, 'store_products')).length, 0);
  assert.ok((await c.dA.from('warehouses').insert({ tenant_id: c.t1.tenantId, store_id: c.A, name: 'hack' })).error);
  assert.ok((await c.dA.from('store_products').insert({ tenant_id: c.t1.tenantId, store_id: c.A, product_id: c.p2 })).error);
  assert.ok((await c.dA.from('warehouses').update({ name: 'hack' }).eq('id', c.A1).select()).data?.length !== 1);
});
