/**
 * Etapa 1G.4 Fase 3A — Backoffice: Produtos + Categorias. Fronteiras de RLS directamente
 * contra Postgres real, com sessões REAIS do Supabase Auth — sem service_role em nenhum
 * caminho de escrita/leitura (products/categories já tinham GRANT a `authenticated`
 * desde 1E.8; aqui só se prova que a policy aditiva do Backoffice funciona igual).
 *
 * Requer env: POSLY_1G4C_SUPABASE_URL, POSLY_1G4C_ANON_KEY, POSLY_1G4C_SERVICE_ROLE_KEY
 * (service_role só usado para SEMEAR dados de teste, nunca no caminho do Backoffice).
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { test, before } from 'node:test';
import { createClient } from '@supabase/supabase-js';

const E = (k) => process.env[`POSLY_1G4C_${k}`] || '';
const run = Boolean(E('SUPABASE_URL') && E('ANON_KEY') && E('SERVICE_ROLE_KEY'));
const opts = { skip: !run && 'defina POSLY_1G4C_*' };

const svc = run ? createClient(E('SUPABASE_URL'), E('SERVICE_ROLE_KEY'), { auth: { persistSession: false } }) : null;
const rand = () => crypto.randomBytes(4).toString('hex');
const PASSWORD = 'Senha!Teste123';

async function mkTenant(id) {
  const { error } = await svc.from('tenants').insert({ id, name: id });
  assert.equal(error, null, JSON.stringify(error));
}
async function mkLicense(tenantId) {
  const { data, error } = await svc.from('licenses').insert({ tenant_id: tenantId, plan: 'PRO', commerce_type: 'retalho' }).select('id').single();
  assert.equal(error, null, JSON.stringify(error));
  return data.id;
}
async function mkStore(tenantId, licenseId, name) {
  const { data, error } = await svc.from('stores').insert({ tenant_id: tenantId, license_id: licenseId, name }).select('id').single();
  assert.equal(error, null, JSON.stringify(error));
  return data.id;
}
async function mkAuthUser(email) {
  const { data, error } = await svc.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
  assert.equal(error, null, JSON.stringify(error));
  return data.user.id;
}
async function mkBoUser(userId, tenantId, role, status = 'active') {
  const { error } = await svc.from('backoffice_users').insert({ user_id: userId, tenant_id: tenantId, role, status });
  assert.equal(error, null, JSON.stringify(error));
}
async function assignStore(userId, tenantId, storeId) {
  const { error } = await svc.from('backoffice_user_stores').insert({ user_id: userId, tenant_id: tenantId, store_id: storeId });
  assert.equal(error, null, JSON.stringify(error));
}
async function signIn(email) {
  const anonClient = createClient(E('SUPABASE_URL'), E('ANON_KEY'), { auth: { persistSession: false } });
  const { data, error } = await anonClient.auth.signInWithPassword({ email, password: PASSWORD });
  assert.equal(error, null, JSON.stringify(error));
  return createClient(E('SUPABASE_URL'), E('ANON_KEY'), {
    global: { headers: { Authorization: `Bearer ${data.session.access_token}` } },
    auth: { persistSession: false },
  });
}

const c = {};

before(async () => {
  if (!run) return;
  c.tenantA = `bo-cat-A-${rand()}`;
  c.tenantB = `bo-cat-B-${rand()}`;
  await mkTenant(c.tenantA);
  await mkTenant(c.tenantB);
  const licA = await mkLicense(c.tenantA);
  const licB = await mkLicense(c.tenantB);
  c.storeA1 = await mkStore(c.tenantA, licA, 'A1');
  c.storeA2 = await mkStore(c.tenantA, licA, 'A2');
  c.storeB1 = await mkStore(c.tenantB, licB, 'B1');

  c.ownerAEmail = `owner-cat-a-${rand()}@test.local`;
  c.opAEmail = `op-cat-a-${rand()}@test.local`;
  c.ownerBEmail = `owner-cat-b-${rand()}@test.local`;
  const ownerAId = await mkAuthUser(c.ownerAEmail);
  const opAId = await mkAuthUser(c.opAEmail);
  const ownerBId = await mkAuthUser(c.ownerBEmail);
  await mkBoUser(ownerAId, c.tenantA, 'owner');
  await mkBoUser(opAId, c.tenantA, 'store_operator');
  await assignStore(opAId, c.tenantA, c.storeA1); // só A1, nunca A2
  await mkBoUser(ownerBId, c.tenantB, 'owner');

  // categoria + produto de A pré-existentes (simulam dados já sincronizados pelo POS)
  const cat = await svc.from('categories').insert({ tenant_id: c.tenantA, name: `Cat seed ${rand()}` }).select('id').single();
  c.categorySeedId = cat.data.id;
  const prod = await svc.from('products').insert({ tenant_id: c.tenantA, name: `Prod seed ${rand()}`, price: 10 }).select('id').single();
  c.productSeedId = prod.data.id;
});

test('owner: lista/cria categoria e produto do próprio Tenant, sem service_role', opts, async () => {
  const cl = await signIn(c.ownerAEmail);
  const { data: cats, error: catErr } = await cl.from('categories').select('id,name').eq('tenant_id', c.tenantA);
  assert.equal(catErr, null);
  assert.ok(cats.some((x) => x.id === c.categorySeedId));

  const newCat = await cl.from('categories').insert({ tenant_id: c.tenantA, name: `Nova cat ${rand()}` }).select('id').single();
  assert.equal(newCat.error, null, JSON.stringify(newCat.error));

  const newProd = await cl.from('products').insert({ tenant_id: c.tenantA, name: `Novo produto ${rand()}`, price: 25, category_id: newCat.data.id }).select('id').single();
  assert.equal(newProd.error, null, JSON.stringify(newProd.error));
  c.newProductId = newProd.data.id;

  const upd = await cl.from('products').update({ price: 30 }).eq('id', newProd.data.id).select('price').single();
  assert.equal(upd.error, null);
  assert.equal(Number(upd.data.price), 30);
});

test('owner: activa um produto em A1, descontinua noutra Store atribuída (A2, é owner=Tenant inteiro)', opts, async () => {
  const cl = await signIn(c.ownerAEmail);
  const act1 = await cl.from('store_products').insert({ tenant_id: c.tenantA, store_id: c.storeA1, product_id: c.productSeedId, status: 'active' }).select('status').single();
  assert.equal(act1.error, null, JSON.stringify(act1.error));

  const act2 = await cl.from('store_products').insert({ tenant_id: c.tenantA, store_id: c.storeA2, product_id: c.productSeedId, status: 'discontinued' }).select('status').single();
  assert.equal(act2.error, null, JSON.stringify(act2.error));

  const upd = await cl.from('store_products').update({ status: 'discontinued' }).eq('store_id', c.storeA1).eq('product_id', c.productSeedId).select('status').single();
  assert.equal(upd.error, null);
  assert.equal(upd.data.status, 'discontinued');
});

test('store_operator: só activa/lê store_products na Store atribuída (A1), nunca em A2', opts, async () => {
  const cl = await signIn(c.opAEmail);
  const { data: readA1 } = await cl.from('store_products').select('status').eq('store_id', c.storeA1).eq('product_id', c.productSeedId);
  assert.equal((readA1 ?? []).length, 1, 'lê A1 (atribuída)');

  const { data: readA2 } = await cl.from('store_products').select('status').eq('store_id', c.storeA2).eq('product_id', c.productSeedId);
  assert.equal((readA2 ?? []).length, 0, 'nunca lê A2 (não atribuída) — RLS filtra em silêncio');

  const newProd2 = await svc.from('products').insert({ tenant_id: c.tenantA, name: `Prod2 ${rand()}`, price: 5 }).select('id').single();
  const tryA2 = await cl.from('store_products').insert({ tenant_id: c.tenantA, store_id: c.storeA2, product_id: newProd2.data.id, status: 'active' });
  assert.ok(tryA2.error, 'INSERT em Store não atribuída é recusado pela RLS');

  const okA1 = await cl.from('store_products').insert({ tenant_id: c.tenantA, store_id: c.storeA1, product_id: newProd2.data.id, status: 'active' });
  assert.equal(okA1.error, null, JSON.stringify(okA1.error));

  // store_operator pode LER o catálogo (tenant inteiro — produtos não são por Store)
  const { data: prodRead } = await cl.from('products').select('id').eq('id', c.productSeedId);
  assert.equal((prodRead ?? []).length, 1);
});

test('Tenant A nunca vê/altera dados de B (categorias, produtos, store_products)', opts, async () => {
  const cl = await signIn(c.ownerBEmail);
  const { data: cats } = await cl.from('categories').select('id').eq('id', c.categorySeedId);
  assert.equal((cats ?? []).length, 0);
  const { data: prods } = await cl.from('products').select('id').eq('id', c.productSeedId);
  assert.equal((prods ?? []).length, 0);
  const { data: sp } = await cl.from('store_products').select('store_id').eq('store_id', c.storeA1);
  assert.equal((sp ?? []).length, 0);
});

test('tentativa de forjar tenant/store: INSERT com tenant_id de outro Tenant é bloqueado pela RLS', opts, async () => {
  const cl = await signIn(c.ownerAEmail);
  const forged = await cl.from('products').insert({ tenant_id: c.tenantB, name: 'Forjado', price: 1 });
  assert.ok(forged.error, 'WITH CHECK nega tenant_id diferente do da própria sessão');

  const forgedCat = await cl.from('categories').insert({ tenant_id: c.tenantB, name: 'Forjada' });
  assert.ok(forgedCat.error);

  const opCl = await signIn(c.opAEmail);
  const forgedStoreProduct = await opCl.from('store_products').insert({ tenant_id: c.tenantA, store_id: c.storeB1, product_id: c.productSeedId, status: 'active' });
  assert.ok(forgedStoreProduct.error, 'store_operator nunca escreve numa Store de outro Tenant, mesmo indicando o próprio tenant_id');
});
