/**
 * Etapa 1F.6.1 — regressão real (Postgres, supabase/) da correcção do
 * P1 encontrado na 1F.6: sync_upsert_user (migração
 * 20260918000100_sync_upsert_user_elevated_field_lock.sql) agora bloqueia
 * qualquer alteração a role/access_level/pin_hash de um utilizador JÁ
 * elevado (existing admin), preservando o guard de escalonamento da 1E.9 e
 * o sync normal de utilizadores não-elevados. Usa Device JWT real (nunca
 * SQL isolado/mocks) e dois tenants reais para provar isolamento
 * cross-tenant.
 *
 * Requer env: POSLY_161_ISSUER_URL, POSLY_161_SUPABASE_URL,
 *   POSLY_161_SUPABASE_ANON_KEY, POSLY_161_SUPABASE_SERVICE_ROLE_KEY,
 *   POSLY_161_TOKEN_A, POSLY_161_TENANT_A, POSLY_161_TOKEN_B, POSLY_161_TENANT_B.
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, mock, before } from 'node:test';
import { createClient } from '@supabase/supabase-js';

const ISSUER_URL = process.env.POSLY_161_ISSUER_URL || '';
const SUPABASE_URL = process.env.POSLY_161_SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.POSLY_161_SUPABASE_ANON_KEY || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.POSLY_161_SUPABASE_SERVICE_ROLE_KEY || '';
const TOKEN_A = process.env.POSLY_161_TOKEN_A || '';
const TENANT_A = process.env.POSLY_161_TENANT_A || '';
const TOKEN_B = process.env.POSLY_161_TOKEN_B || '';
const TENANT_B = process.env.POSLY_161_TENANT_B || '';
const shouldRun = Boolean(
  ISSUER_URL && SUPABASE_URL && SUPABASE_ANON_KEY && SUPABASE_SERVICE_ROLE_KEY && TOKEN_A && TENANT_A && TOKEN_B && TENANT_B,
);

mock.module('electron', {
  exports: {
    safeStorage: {
      isEncryptionAvailable: () => true,
      encryptString: (s) => Buffer.concat([Buffer.from('FAKEENC:'), Buffer.from(s, 'utf8')]),
      decryptString: (b) => Buffer.from(b).subarray(8).toString('utf8'),
    },
  },
});

const BCRYPT_A = '$2b$10$' + 'a'.repeat(53);
const BCRYPT_B = '$2b$10$' + 'b'.repeat(53);
const BCRYPT_C = '$2b$10$' + 'c'.repeat(53);

let deviceClientA;
let deviceClientB;
let adminSupabase;

before(async () => {
  if (!shouldRun) return;
  const { bootstrapDevice } = await import('../../electron/deviceAuth/deviceAuthClient.js');

  const udA = fs.mkdtempSync(path.join(os.tmpdir(), 'posly-161-A-'));
  const bootA = await bootstrapDevice({ activationToken: TOKEN_A, machineId: 'machine-161-A', userDataPath: udA, issuerBaseUrl: ISSUER_URL });
  if (!bootA.ok) throw new Error(`bootstrap A falhou: ${JSON.stringify(bootA)}`);

  const udB = fs.mkdtempSync(path.join(os.tmpdir(), 'posly-161-B-'));
  const bootB = await bootstrapDevice({ activationToken: TOKEN_B, machineId: 'machine-161-B', userDataPath: udB, issuerBaseUrl: ISSUER_URL });
  if (!bootB.ok) throw new Error(`bootstrap B falhou: ${JSON.stringify(bootB)}`);

  deviceClientA = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${bootA.accessToken}` } },
    auth: { persistSession: false },
  });
  deviceClientB = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${bootB.accessToken}` } },
    auth: { persistSession: false },
  });
  adminSupabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
});

function upsert(client, overrides) {
  return client.rpc('sync_upsert_user', {
    p_id: overrides.id,
    p_name: overrides.name ?? 'User',
    p_role: overrides.role ?? 'cashier',
    p_access_level: overrides.access_level ?? 0,
    p_pin_hash: overrides.pin_hash ?? BCRYPT_A,
    p_active: overrides.active ?? true,
  });
}

test('A) device cria cashier novo -> permitido', { skip: !shouldRun && 'defina POSLY_161_*' }, async () => {
  const id = crypto.randomUUID();
  const { error } = await upsert(deviceClientA, { id, name: 'Caixa Novo', role: 'cashier', access_level: 1, pin_hash: BCRYPT_A });
  assert.equal(error, null, JSON.stringify(error));
});

test('B) device actualiza o SEU cashier (nome/PIN) -> permitido', { skip: !shouldRun && 'defina POSLY_161_*' }, async () => {
  const id = crypto.randomUUID();
  await upsert(deviceClientA, { id, name: 'Caixa X', role: 'cashier', access_level: 1, pin_hash: BCRYPT_A });
  const { error } = await upsert(deviceClientA, { id, name: 'Caixa X Renomeado', role: 'cashier', access_level: 1, pin_hash: BCRYPT_B });
  assert.equal(error, null, JSON.stringify(error));
  const { data: row } = await adminSupabase.from('users').select('name, pin_hash').eq('id', id).single();
  assert.equal(row.name, 'Caixa X Renomeado');
  assert.equal(row.pin_hash, BCRYPT_B);
});

test('C) device tenta CRIAR admin novo -> FAIL (privilege_escalation_denied)', { skip: !shouldRun && 'defina POSLY_161_*' }, async () => {
  const id = crypto.randomUUID();
  const { error } = await upsert(deviceClientA, { id, name: 'Admin Forjado', role: 'admin', access_level: 9, pin_hash: BCRYPT_A });
  assert.ok(error);
  assert.match(error.message, /privilege_escalation_denied/);
  const { data: rows } = await adminSupabase.from('users').select('id').eq('id', id);
  assert.equal((rows ?? []).length, 0);
});

test('D) device tenta PROMOVER cashier existente a admin -> FAIL', { skip: !shouldRun && 'defina POSLY_161_*' }, async () => {
  const id = crypto.randomUUID();
  await upsert(deviceClientA, { id, name: 'Caixa Alvo', role: 'cashier', access_level: 1, pin_hash: BCRYPT_A });
  const { error } = await upsert(deviceClientA, { id, name: 'Caixa Alvo', role: 'admin', access_level: 9, pin_hash: BCRYPT_A });
  assert.ok(error);
  assert.match(error.message, /privilege_escalation_denied/);
  const { data: row } = await adminSupabase.from('users').select('role, access_level').eq('id', id).single();
  assert.equal(row.role, 'cashier');
  assert.equal(row.access_level, 1);
});

test('E) device tenta mudar pin_hash de admin EXISTENTE -> FAIL (elevated_user_protected_field)', { skip: !shouldRun && 'defina POSLY_161_*' }, async () => {
  const id = crypto.randomUUID();
  // Semeia o admin directamente como service_role (simula um admin já legitimamente elevado na cloud).
  const { error: seedErr } = await adminSupabase.from('users').insert({
    id, tenant_id: TENANT_A, name: 'Admin Real', role: 'admin', access_level: 9, pin_hash: BCRYPT_A, active: true,
  });
  assert.equal(seedErr, null, JSON.stringify(seedErr));

  const { error } = await upsert(deviceClientA, { id, name: 'Admin Real', role: 'admin', access_level: 9, pin_hash: BCRYPT_C });
  assert.ok(error, 'devia FALHAR ao tentar mudar o pin_hash de um admin existente');
  assert.match(error.message, /elevated_user_protected_field/);

  const { data: row } = await adminSupabase.from('users').select('pin_hash').eq('id', id).single();
  assert.equal(row.pin_hash, BCRYPT_A, 'pin_hash do admin NUNCA pode ter mudado');
});

test('F) device tenta mudar access_level/role de admin EXISTENTE (downgrade) -> FAIL (política escolhida: FAIL, não downgrade-only)', { skip: !shouldRun && 'defina POSLY_161_*' }, async () => {
  const id = crypto.randomUUID();
  const { error: seedErr } = await adminSupabase.from('users').insert({
    id, tenant_id: TENANT_A, name: 'Admin Real 2', role: 'admin', access_level: 9, pin_hash: BCRYPT_A, active: true,
  });
  assert.equal(seedErr, null, JSON.stringify(seedErr));

  const { error } = await upsert(deviceClientA, { id, name: 'Admin Real 2', role: 'cashier', access_level: 1, pin_hash: BCRYPT_A });
  assert.ok(error, 'devia FALHAR ao tentar rebaixar um admin existente');
  assert.match(error.message, /elevated_user_protected_field/);

  const { data: row } = await adminSupabase.from('users').select('role, access_level').eq('id', id).single();
  assert.equal(row.role, 'admin');
  assert.equal(row.access_level, 9);
});

test('E/F extra) re-sync idempotente do MESMO admin (valores inalterados) -> permitido (nome/active continuam a sincronizar)', { skip: !shouldRun && 'defina POSLY_161_*' }, async () => {
  const id = crypto.randomUUID();
  await adminSupabase.from('users').insert({
    id, tenant_id: TENANT_A, name: 'Admin Idempotente', role: 'admin', access_level: 9, pin_hash: BCRYPT_A, active: true,
  });
  const { error } = await upsert(deviceClientA, { id, name: 'Admin Idempotente (sincronizado)', role: 'admin', access_level: 9, pin_hash: BCRYPT_A, active: true });
  assert.equal(error, null, `re-sync idempotente (role/access_level/pin_hash inalterados) não devia falhar: ${JSON.stringify(error)}`);
  const { data: row } = await adminSupabase.from('users').select('name, role, access_level, pin_hash').eq('id', id).single();
  assert.equal(row.name, 'Admin Idempotente (sincronizado)', 'name continua a sincronizar livremente para um admin existente');
  assert.equal(row.pin_hash, BCRYPT_A);
});

test('G) cross-tenant user mutation -> FAIL (user_id_belongs_to_other_tenant)', { skip: !shouldRun && 'defina POSLY_161_*' }, async () => {
  const id = crypto.randomUUID();
  await upsert(deviceClientA, { id, name: 'Utilizador Tenant A', role: 'cashier', access_level: 1, pin_hash: BCRYPT_A });

  const { error } = await upsert(deviceClientB, { id, name: 'Sequestrado por B', role: 'cashier', access_level: 1, pin_hash: BCRYPT_B });
  assert.ok(error, 'device do tenant B NUNCA deve conseguir alterar um utilizador do tenant A');
  assert.match(error.message, /user_id_belongs_to_other_tenant/);

  const { data: row } = await adminSupabase.from('users').select('name, tenant_id').eq('id', id).single();
  assert.equal(row.name, 'Utilizador Tenant A', 'nome não pode ter mudado');
  assert.equal(row.tenant_id, TENANT_A);
});

test('H) admin existente permanece utilizável depois de um sync normal (não elevado) de OUTRO utilizador', { skip: !shouldRun && 'defina POSLY_161_*' }, async () => {
  const adminId = crypto.randomUUID();
  await adminSupabase.from('users').insert({
    id: adminId, tenant_id: TENANT_A, name: 'Admin Estável', role: 'admin', access_level: 9, pin_hash: BCRYPT_A, active: true,
  });
  const cashierId = crypto.randomUUID();
  const { error } = await upsert(deviceClientA, { id: cashierId, name: 'Caixa Qualquer', role: 'cashier', access_level: 1, pin_hash: BCRYPT_B });
  assert.equal(error, null, JSON.stringify(error));

  const { data: adminRow } = await adminSupabase.from('users').select('role, access_level, pin_hash, active').eq('id', adminId).single();
  assert.equal(adminRow.role, 'admin');
  assert.equal(adminRow.access_level, 9);
  assert.equal(adminRow.pin_hash, BCRYPT_A);
  assert.equal(adminRow.active, true);
});

test('I) tenant A nunca modifica utilizador do tenant B (device A tenta ler/gravar id existente de B)', { skip: !shouldRun && 'defina POSLY_161_*' }, async () => {
  const id = crypto.randomUUID();
  await upsert(deviceClientB, { id, name: 'Utilizador Tenant B', role: 'cashier', access_level: 1, pin_hash: BCRYPT_A });

  const { data: aSeesB } = await deviceClientA.from('users').select('id').eq('id', id);
  assert.equal((aSeesB ?? []).length, 0, 'device A nunca deve conseguir LER um utilizador do tenant B via RLS');

  const { error } = await upsert(deviceClientA, { id, name: 'Roubado por A', role: 'cashier', access_level: 1, pin_hash: BCRYPT_C });
  assert.ok(error);
  assert.match(error.message, /user_id_belongs_to_other_tenant/);
});
