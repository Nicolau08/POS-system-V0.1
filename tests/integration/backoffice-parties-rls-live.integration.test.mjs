/**
 * Etapa 1G.4 Fase 3B — Backoffice: Clientes + Fornecedores. Fronteiras de RLS
 * directamente contra Postgres real, sessões REAIS — sem service_role em nenhum caminho
 * de escrita/leitura.
 *
 * Requer env: POSLY_1G4D_SUPABASE_URL, POSLY_1G4D_ANON_KEY, POSLY_1G4D_SERVICE_ROLE_KEY
 * (service_role só para SEMEAR dados de teste, nunca no caminho do Backoffice).
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { test, before } from 'node:test';
import { createClient } from '@supabase/supabase-js';

const E = (k) => process.env[`POSLY_1G4D_${k}`] || '';
const run = Boolean(E('SUPABASE_URL') && E('ANON_KEY') && E('SERVICE_ROLE_KEY'));
const opts = { skip: !run && 'defina POSLY_1G4D_*' };

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
  c.tenantA = `bo-party-A-${rand()}`;
  c.tenantB = `bo-party-B-${rand()}`;
  await mkTenant(c.tenantA);
  await mkTenant(c.tenantB);
  const licA = await mkLicense(c.tenantA);
  c.storeA1 = await mkStore(c.tenantA, licA, 'A1');
  c.storeA2 = await mkStore(c.tenantA, licA, 'A2');

  c.ownerAEmail = `owner-party-a-${rand()}@test.local`;
  c.opAEmail = `op-party-a-${rand()}@test.local`;
  c.ownerBEmail = `owner-party-b-${rand()}@test.local`;
  const ownerAId = await mkAuthUser(c.ownerAEmail);
  const opAId = await mkAuthUser(c.opAEmail);
  const ownerBId = await mkAuthUser(c.ownerBEmail);
  await mkBoUser(ownerAId, c.tenantA, 'owner');
  await mkBoUser(opAId, c.tenantA, 'store_operator');
  await assignStore(opAId, c.tenantA, c.storeA1); // store_operator sem acesso a nenhuma Store não muda nada aqui (clientes/fornecedores são Tenant-scoped)

  const seedCustomer = await svc.from('customers').insert({ tenant_id: c.tenantA, name: 'Cliente seed', phone: '840000000' }).select('id').single();
  c.customerSeedId = seedCustomer.data.id;
  const seedSupplier = await svc.from('suppliers').insert({ tenant_id: c.tenantA, name: 'Fornecedor seed' }).select('id').single();
  c.supplierSeedId = seedSupplier.data.id;
});

test('owner: lista/cria/edita clientes e fornecedores do próprio Tenant, sem service_role', opts, async () => {
  const cl = await signIn(c.ownerAEmail);

  const { data: customers, error: custErr } = await cl.from('customers').select('id,name').eq('tenant_id', c.tenantA);
  assert.equal(custErr, null);
  assert.ok(customers.some((x) => x.id === c.customerSeedId));

  const newCustomer = await cl.from('customers').insert({ tenant_id: c.tenantA, name: `Cliente novo ${rand()}`, phone: '841111111' }).select('id').single();
  assert.equal(newCustomer.error, null, JSON.stringify(newCustomer.error));
  const updCustomer = await cl.from('customers').update({ email: 'novo@teste.local' }).eq('id', newCustomer.data.id).select('email').single();
  assert.equal(updCustomer.error, null);
  assert.equal(updCustomer.data.email, 'novo@teste.local');

  const { data: suppliers, error: supErr } = await cl.from('suppliers').select('id,name').eq('tenant_id', c.tenantA);
  assert.equal(supErr, null);
  assert.ok(suppliers.some((x) => x.id === c.supplierSeedId));

  const newSupplier = await cl.from('suppliers').insert({ tenant_id: c.tenantA, name: `Fornecedor novo ${rand()}`, phone: '842222222' }).select('id').single();
  assert.equal(newSupplier.error, null, JSON.stringify(newSupplier.error));
  const updSupplier = await cl.from('suppliers').update({ address: 'Rua Teste, 1' }).eq('id', newSupplier.data.id).select('address').single();
  assert.equal(updSupplier.error, null);
  assert.equal(updSupplier.data.address, 'Rua Teste, 1');
});

test('store_operator: clientes/fornecedores são Tenant-scoped — lê/escreve independentemente da Store atribuída', opts, async () => {
  const cl = await signIn(c.opAEmail);
  const { data: customers, error } = await cl.from('customers').select('id').eq('id', c.customerSeedId);
  assert.equal(error, null);
  assert.equal(customers.length, 1);

  const newSupplier = await cl.from('suppliers').insert({ tenant_id: c.tenantA, name: `Fornecedor op ${rand()}` }).select('id').single();
  assert.equal(newSupplier.error, null, JSON.stringify(newSupplier.error));
});

test('Tenant A nunca vê/altera clientes/fornecedores de B', opts, async () => {
  const cl = await signIn(c.ownerBEmail);
  const { data: customers } = await cl.from('customers').select('id').eq('id', c.customerSeedId);
  assert.equal((customers ?? []).length, 0);
  const { data: suppliers } = await cl.from('suppliers').select('id').eq('id', c.supplierSeedId);
  assert.equal((suppliers ?? []).length, 0);

  const forgedUpdate = await cl.from('customers').update({ name: 'Forjado' }).eq('id', c.customerSeedId).select('id');
  assert.equal((forgedUpdate.data ?? []).length, 0, 'UPDATE sobre uma linha de outro Tenant afecta 0 linhas (RLS filtra o WHERE)');
});

test('tentativa de forjar tenant_id é bloqueada pela RLS', opts, async () => {
  const cl = await signIn(c.ownerAEmail);
  const forgedCustomer = await cl.from('customers').insert({ tenant_id: c.tenantB, name: 'Forjado', phone: '840000001' });
  assert.ok(forgedCustomer.error, 'WITH CHECK nega tenant_id diferente do da própria sessão');
  const forgedSupplier = await cl.from('suppliers').insert({ tenant_id: c.tenantB, name: 'Forjado' });
  assert.ok(forgedSupplier.error);
});
