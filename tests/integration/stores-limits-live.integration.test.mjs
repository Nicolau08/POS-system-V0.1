/**
 * Etapa 1G.2A — Stores + limites (max_stores/max_devices independentes) contra
 * license-console REAL + Postgres REAL (supabase/). Sem mocks.
 * Env: POSLY_1G2A_ISSUER_URL, POSLY_1G2A_ADMIN_TOKEN, POSLY_1G2A_SUPABASE_URL,
 *      POSLY_1G2A_SERVICE_ROLE_KEY.
 * Nota: /device/bootstrap tem rate limit de 10/h por IP — limpar
 * pos_device_auth_rate_limits (baseline local) antes de correr.
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { test } from 'node:test';
import { createClient } from '@supabase/supabase-js';

const ISSUER_URL = process.env.POSLY_1G2A_ISSUER_URL || '';
const ADMIN_TOKEN = process.env.POSLY_1G2A_ADMIN_TOKEN || '';
const SUPABASE_URL = process.env.POSLY_1G2A_SUPABASE_URL || '';
const SERVICE_KEY = process.env.POSLY_1G2A_SERVICE_ROLE_KEY || '';
const run = Boolean(ISSUER_URL && ADMIN_TOKEN && SUPABASE_URL && SERVICE_KEY);
const opts = { skip: !run && 'defina POSLY_1G2A_*' };

const db = run ? createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } }) : null;

async function post(path, body, { admin = true, method = 'POST' } = {}) {
  const res = await fetch(`${ISSUER_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(admin ? { Authorization: `Bearer ${ADMIN_TOKEN}` } : {}) },
    body: JSON.stringify(body),
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

async function tenantLicense(limits = {}) {
  const tenantId = `itest-1g2a-${crypto.randomBytes(4).toString('hex')}`;
  assert.equal((await post('/api/license-issuer/tenants', { id: tenantId, name: 'Itest 1G2A' })).status, 200);
  const lic = await post('/api/license-issuer/licenses', { tenant_id: tenantId, plan: 'BASIC', commerce_type: 'retalho', ...limits });
  assert.equal(lic.status, 200, JSON.stringify(lic.data));
  return { tenantId, licenseId: lic.data.license.id };
}

const createStore = (tenantId, licenseId, name = 'Loja') =>
  post('/api/license-issuer/stores', { tenant_id: tenantId, license_id: licenseId, name });

async function storeOk(tenantId, licenseId, name) {
  const r = await createStore(tenantId, licenseId, name);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return r.data.store.id;
}

const tokenFor = (tenantId, licenseId, storeId) =>
  post('/api/license-issuer/device/activation-tokens', { tenant_id: tenantId, license_id: licenseId, store_id: storeId });

const bootstrap = (token, extra = {}) =>
  post('/api/license-issuer/device/bootstrap', { activation_token: token, machine_id: `m-${crypto.randomBytes(3).toString('hex')}`, ...extra }, { admin: false });

async function tokenOk(tenantId, licenseId, storeId) {
  const r = await tokenFor(tenantId, licenseId, storeId);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return r.data.activation_token;
}

async function countStores(licenseId) {
  const { count } = await db.from('stores').select('id', { count: 'exact', head: true }).eq('license_id', licenseId);
  return count;
}

test('max_stores=1: primeira loja OK, segunda falha fechada (409 max_stores_reached)', opts, async () => {
  const { tenantId, licenseId } = await tenantLicense({ max_stores: 1 });
  await storeOk(tenantId, licenseId, 'A');
  const second = await createStore(tenantId, licenseId, 'B');
  assert.equal(second.status, 409);
  assert.equal(second.data.code, 'max_stores_reached');
  assert.equal(await countStores(licenseId), 1);
});

test('concorrência na ÚLTIMA vaga (max_stores=1, 8 pedidos HTTP simultâneos) -> exactamente 1 sucesso', opts, async () => {
  const { tenantId, licenseId } = await tenantLicense({ max_stores: 1 });
  const results = await Promise.all(Array.from({ length: 8 }, (_, i) => createStore(tenantId, licenseId, `C${i}`)));
  assert.equal(results.filter((r) => r.status === 200).length, 1, JSON.stringify(results.map((r) => r.status)));
  assert.equal(results.filter((r) => r.status === 409).length, 7);
  assert.equal(await countStores(licenseId), 1);
});

test('concorrência com vagas parciais (max_stores=3, 2 usadas, 10 RPCs directas simultâneas) -> exactamente 1 sucesso', opts, async () => {
  const { tenantId, licenseId } = await tenantLicense({ max_stores: 3 });
  await storeOk(tenantId, licenseId, 'S1');
  await storeOk(tenantId, licenseId, 'S2');
  const results = await Promise.all(
    Array.from({ length: 10 }, (_, i) => db.rpc('create_store', { p_tenant_id: tenantId, p_license_id: licenseId, p_name: `R${i}`, p_code: null })),
  );
  assert.equal(results.filter((r) => !r.error).length, 1);
  assert.ok(results.filter((r) => r.error).every((r) => /max_stores_reached/.test(r.error.message)));
  assert.equal(await countStores(licenseId), 3);
});

test('max_stores=NULL -> ilimitado (6 lojas); max_stores=0 -> nenhuma', opts, async () => {
  const a = await tenantLicense({});
  for (let i = 0; i < 6; i += 1) await storeOk(a.tenantId, a.licenseId, `U${i}`);
  assert.equal(await countStores(a.licenseId), 6);
  const z = await tenantLicense({ max_stores: 0 });
  assert.equal((await createStore(z.tenantId, z.licenseId)).status, 409);
});

test('insert directo em stores (service_role, sem RPC) também é bloqueado pelo trigger', opts, async () => {
  const { tenantId, licenseId } = await tenantLicense({ max_stores: 1 });
  await storeOk(tenantId, licenseId, 'A');
  const { error } = await db.from('stores').insert({ tenant_id: tenantId, license_id: licenseId, name: 'Bypass' });
  assert.ok(error);
  assert.match(error.message, /max_stores_reached/);
});

test('cross-tenant bloqueado: API, FK composta e imutabilidade de scope', opts, async () => {
  const A = await tenantLicense({});
  const B = await tenantLicense({});
  const storeA = await storeOk(A.tenantId, A.licenseId, 'A');

  // API: licença de A com tenant B
  assert.equal((await createStore(B.tenantId, A.licenseId)).status, 404);
  // token para a store de A usando tenant/licença de B
  const t = await tokenFor(B.tenantId, B.licenseId, storeA);
  assert.equal(t.status, 403);
  assert.equal(t.data.code, 'store_not_found');
  // FK composta na BD (bypass da API): token e device com store de outro tenant
  const tok = await db.from('device_activation_tokens').insert({
    tenant_id: B.tenantId, license_id: B.licenseId, store_id: storeA, token_hash: crypto.randomBytes(16).toString('hex'),
    expires_at: new Date(Date.now() + 60000).toISOString(),
  });
  assert.ok(tok.error, 'FK composta devia impedir token com store de outro tenant');
  const dev = await db.from('pos_devices').insert({
    id: crypto.randomUUID(), tenant_id: B.tenantId, license_id: B.licenseId, store_id: storeA, machine_id: 'x',
    refresh_token_hash: 'h', refresh_token_expires_at: new Date(Date.now() + 60000).toISOString(),
  });
  assert.ok(dev.error, 'FK composta devia impedir device com store de outro tenant');
  // mover store para outra licença (contornar limite) é proibido
  const mv = await db.from('stores').update({ license_id: B.licenseId, tenant_id: B.tenantId }).eq('id', storeA);
  assert.ok(mv.error);
});

test('token pertence à Store; bootstrap deriva store_id só do token e ignora store_id do cliente', opts, async () => {
  const { tenantId, licenseId } = await tenantLicense({});
  const s1 = await storeOk(tenantId, licenseId, 'S1');
  const s2 = await storeOk(tenantId, licenseId, 'S2');
  const token = await tokenOk(tenantId, licenseId, s1);
  const { data: tokRow } = await db.from('device_activation_tokens').select('store_id').eq('tenant_id', tenantId).single();
  assert.equal(tokRow.store_id, s1);

  const boot = await bootstrap(token, { store_id: s2, storeId: s2 });
  assert.equal(boot.status, 200, JSON.stringify(boot.data));
  const { data: dev } = await db.from('pos_devices').select('store_id, tenant_id, license_id').eq('id', boot.data.device_id).single();
  assert.equal(dev.store_id, s1, 'store_id vem do token, nunca do corpo do pedido');
  assert.equal(dev.tenant_id, tenantId);
  assert.equal(dev.license_id, licenseId);
});

test('store suspensa bloqueia nova activação (token novo e token já emitido); reactivar restaura', opts, async () => {
  const { tenantId, licenseId } = await tenantLicense({});
  const s = await storeOk(tenantId, licenseId, 'S');
  const token = await tokenOk(tenantId, licenseId, s);
  await db.from('stores').update({ status: 'suspended' }).eq('id', s);

  const blocked = await bootstrap(token);
  assert.equal(blocked.status, 403);
  assert.equal(blocked.data.code, 'store_suspended');
  const { data: t } = await db.from('device_activation_tokens').select('used_at').eq('store_id', s).single();
  assert.equal(t.used_at, null, 'token não pode ser consumido por um bootstrap recusado');
  const newTok = await tokenFor(tenantId, licenseId, s);
  assert.equal(newTok.status, 403);
  assert.equal(newTok.data.code, 'store_suspended');

  await db.from('stores').update({ status: 'active' }).eq('id', s);
  assert.equal((await bootstrap(token)).status, 200);
});

test('max_devices continua independente de max_stores', opts, async () => {
  // max_devices=1, stores ilimitadas: 2.º device (noutra loja) falha por max_devices
  const a = await tenantLicense({ max_devices: 1 });
  const a1 = await storeOk(a.tenantId, a.licenseId, 'A1');
  const a2 = await storeOk(a.tenantId, a.licenseId, 'A2');
  const t1 = await tokenOk(a.tenantId, a.licenseId, a1);
  const t2 = await tokenOk(a.tenantId, a.licenseId, a2);
  assert.equal((await bootstrap(t1)).status, 200);
  const over = await bootstrap(t2);
  assert.equal(over.status, 409);
  assert.equal(over.data.code, 'max_devices_reached');

  // max_stores=1 mas max_devices=5: 2 devices na mesma store
  const b = await tenantLicense({ max_stores: 1, max_devices: 5 });
  const b1 = await storeOk(b.tenantId, b.licenseId, 'B1');
  assert.equal((await bootstrap(await tokenOk(b.tenantId, b.licenseId, b1))).status, 200);
  assert.equal((await bootstrap(await tokenOk(b.tenantId, b.licenseId, b1))).status, 200);
});

test('refresh / revocation / token_version sem regressão', opts, async () => {
  const { tenantId, licenseId } = await tenantLicense({});
  const s = await storeOk(tenantId, licenseId, 'S');
  const boot = await bootstrap(await tokenOk(tenantId, licenseId, s));
  assert.equal(boot.status, 200);
  const claims = JSON.parse(Buffer.from(boot.data.access_token.split('.')[1], 'base64url').toString());
  assert.equal(claims.token_version, 1);
  assert.equal(claims.tenant_id, tenantId);

  const refreshed = await post('/api/license-issuer/device/token', { refresh_token: boot.data.refresh_token }, { admin: false });
  assert.equal(refreshed.status, 200, JSON.stringify(refreshed.data));
  assert.notEqual(refreshed.data.refresh_token, boot.data.refresh_token, 'refresh roda');

  await db.from('pos_devices').update({ revoked_at: new Date().toISOString(), revoked_reason: 'itest' }).eq('id', boot.data.device_id);
  const afterRevoke = await post('/api/license-issuer/device/token', { refresh_token: refreshed.data.refresh_token }, { admin: false });
  assert.equal(afterRevoke.status, 403);
  assert.equal(afterRevoke.data.code, 'device_revoked');
});

test('licença suspensa bloqueia criação de store (trigger fail-closed)', opts, async () => {
  const { tenantId, licenseId } = await tenantLicense({});
  await post('/api/license-issuer/licenses', { license_id: licenseId, status: 'suspended' }, { method: 'PATCH' });
  const r = await createStore(tenantId, licenseId);
  assert.equal(r.status, 403);
  assert.equal(r.data.code, 'license_suspended');
});
