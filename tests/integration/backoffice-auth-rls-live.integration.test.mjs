/**
 * Etapa 1G.4 Fase 2 — Backoffice Auth + Permissões: fronteiras de RLS/membership,
 * directamente contra Postgres real (supabase/), com sessões REAIS do Supabase
 * Auth (signInWithPassword, nunca tokens forjados). Prova o modelo antes/independente da
 * app Next.js: backoffice_users/backoffice_user_stores, backoffice_current_tenant_id(),
 * backoffice_current_role(), backoffice_can_access_store().
 *
 * Requer env: POSLY_1G4B_SUPABASE_URL, POSLY_1G4B_ANON_KEY, POSLY_1G4B_SERVICE_ROLE_KEY.
 * Sem eles, os testes são saltados.
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { test, before } from 'node:test';
import { createClient } from '@supabase/supabase-js';

const E = (k) => process.env[`POSLY_1G4B_${k}`] || '';
const run = Boolean(E('SUPABASE_URL') && E('ANON_KEY') && E('SERVICE_ROLE_KEY'));
const opts = { skip: !run && 'defina POSLY_1G4B_*' };

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
  const sessioned = createClient(E('SUPABASE_URL'), E('ANON_KEY'), {
    global: { headers: { Authorization: `Bearer ${data.session.access_token}` } },
    auth: { persistSession: false },
  });
  return { client: sessioned, session: data.session };
}

const c = {};

before(async () => {
  if (!run) return;
  c.tenantA = `bo-test-A-${rand()}`;
  c.tenantB = `bo-test-B-${rand()}`;
  await mkTenant(c.tenantA);
  await mkTenant(c.tenantB);
  const licA = await mkLicense(c.tenantA);
  const licB = await mkLicense(c.tenantB);
  c.storeA1 = await mkStore(c.tenantA, licA, 'A1');
  c.storeA2 = await mkStore(c.tenantA, licA, 'A2');
  c.storeB1 = await mkStore(c.tenantB, licB, 'B1');

  c.ownerAEmail = `owner-a-${rand()}@test.local`;
  c.opAEmail = `op-a-${rand()}@test.local`;
  c.disabledAEmail = `disabled-a-${rand()}@test.local`;
  c.ownerBEmail = `owner-b-${rand()}@test.local`;

  c.ownerAId = await mkAuthUser(c.ownerAEmail);
  c.opAId = await mkAuthUser(c.opAEmail);
  c.disabledAId = await mkAuthUser(c.disabledAEmail);
  c.ownerBId = await mkAuthUser(c.ownerBEmail);

  await mkBoUser(c.ownerAId, c.tenantA, 'owner');
  await mkBoUser(c.opAId, c.tenantA, 'store_operator');
  await assignStore(c.opAId, c.tenantA, c.storeA1); // só A1, nunca A2
  await mkBoUser(c.disabledAId, c.tenantA, 'owner', 'disabled');
  await mkBoUser(c.ownerBId, c.tenantB, 'owner');
});

test('owner: vê a própria linha, tenant correcto, acede a TODAS as Stores do seu Tenant', opts, async () => {
  const { client: cl } = await signIn(c.ownerAEmail);
  const { data: rows, error } = await cl.from('backoffice_users').select('user_id,tenant_id,role');
  assert.equal(error, null);
  // Etapa 1G.4 Fase 9: owner passou a ver TODO o tenant (policy aditiva
  // backoffice_users_select_owner), não só a própria linha — ownerA, opA e disabledA são
  // as 3 linhas do tenantA; nenhuma de tenantB.
  assert.equal(rows.length, 3);
  const rowIds = rows.map((r) => r.user_id).sort();
  assert.deepEqual(rowIds, [c.disabledAId, c.opAId, c.ownerAId].sort());
  assert.ok(rows.every((r) => r.tenant_id === c.tenantA));

  const { data: tid } = await cl.rpc('backoffice_current_tenant_id');
  assert.equal(tid, c.tenantA);
  const { data: role } = await cl.rpc('backoffice_current_role');
  assert.equal(role, 'owner');

  const { data: canA1 } = await cl.rpc('backoffice_can_access_store', { p_store_id: c.storeA1 });
  const { data: canA2 } = await cl.rpc('backoffice_can_access_store', { p_store_id: c.storeA2 });
  assert.equal(canA1, true);
  assert.equal(canA2, true, 'owner vê todas as Stores do Tenant, sem linha explícita em backoffice_user_stores');
});

test('store_operator: só acede às Stores explicitamente atribuídas', opts, async () => {
  const { client: cl } = await signIn(c.opAEmail);
  const { data: canA1 } = await cl.rpc('backoffice_can_access_store', { p_store_id: c.storeA1 });
  const { data: canA2 } = await cl.rpc('backoffice_can_access_store', { p_store_id: c.storeA2 });
  assert.equal(canA1, true);
  assert.equal(canA2, false, 'nunca acede a uma Store não atribuída, mesmo do mesmo Tenant');
});

test('disabled: resolvers falham fechado mesmo com sessão válida', opts, async () => {
  const { client: cl } = await signIn(c.disabledAEmail);
  const { data: tid } = await cl.rpc('backoffice_current_tenant_id');
  assert.equal(tid, null);
  const { data: canA1 } = await cl.rpc('backoffice_can_access_store', { p_store_id: c.storeA1 });
  assert.equal(canA1, false);
});

test('isolamento total entre Tenants: owner de B nunca vê nada de A', opts, async () => {
  const { client: cl } = await signIn(c.ownerBEmail);
  const { data: canA1 } = await cl.rpc('backoffice_can_access_store', { p_store_id: c.storeA1 });
  assert.equal(canA1, false);
  const { data } = await cl.from('backoffice_users').select('user_id');
  assert.equal(data.length, 1);
  assert.equal(data[0].user_id, c.ownerBId);
});

test('manipulação bloqueada: nunca lê a membership de outro utilizador, nem escreve a própria', opts, async () => {
  const { client: cl } = await signIn(c.opAEmail);
  const { data: otherUserRows } = await cl.from('backoffice_user_stores').select('user_id,store_id').eq('user_id', c.ownerAId);
  assert.equal((otherUserRows ?? []).length, 0, 'RLS self-only — nunca vê linhas de outro utilizador mesmo pedindo explicitamente');

  const { client: clOwner } = await signIn(c.ownerAEmail);
  const { error: updErr } = await clOwner.from('backoffice_users').update({ role: 'owner' }).eq('user_id', c.ownerAId);
  assert.ok(updErr, 'nenhuma policy de escrita existe para a própria sessão — só service_role escreve');
});

test('logout/expiração: sem sessão (token inválido), tudo falha fechado', opts, async () => {
  const cl = createClient(E('SUPABASE_URL'), E('ANON_KEY'), {
    global: { headers: { Authorization: 'Bearer token-invalido-1g4' } },
    auth: { persistSession: false },
  });
  const { data: tid, error } = await cl.rpc('backoffice_current_tenant_id');
  // Um JWT malformado é rejeitado pelo PostgREST (401) antes de chegar à função — em
  // qualquer dos casos, nunca devolve um tenant real.
  assert.ok(error || tid === null);
});
