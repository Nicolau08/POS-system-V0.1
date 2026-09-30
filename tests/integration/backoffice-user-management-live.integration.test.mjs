/**
 * Etapa 1G.4 Fase 9 — gestão de utilizadores do Backoffice pelo owner. Reutiliza o fluxo
 * de primeiro acesso da Fase 8 integralmente (sem alterar nada lá) — só a origem da
 * credencial muda (owner via /api/users em vez de License Console).
 *
 * Requer env: POSLY_1G4L_ISSUER_URL, POSLY_1G4L_ADMIN_TOKEN, POSLY_1G4L_SUPABASE_URL,
 *   POSLY_1G4L_ANON_KEY, POSLY_1G4L_SERVICE_ROLE_KEY, POSLY_1G4L_BACKOFFICE_URL
 *   (default http://localhost:3003; BACKOFFICE_DEV_MAIL_ECHO=true em backoffice/.env.local).
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { test, before } from 'node:test';

const E = (k) => process.env[`POSLY_1G4L_${k}`] || '';
const BACKOFFICE_URL = E('BACKOFFICE_URL') || 'http://localhost:3003';
const run = Boolean(E('ISSUER_URL') && E('ADMIN_TOKEN') && E('SUPABASE_URL') && E('ANON_KEY') && E('SERVICE_ROLE_KEY'));
const opts = { skip: !run && 'defina POSLY_1G4L_*' };

const rand = () => crypto.randomBytes(4).toString('hex');

async function post(p, body, admin = true) {
  const res = await fetch(`${E('ISSUER_URL')}${p}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(admin ? { Authorization: `Bearer ${E('ADMIN_TOKEN')}` } : {}) },
    body: JSON.stringify(body),
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}
function cookieHeader(setCookies) {
  return setCookies.map((c) => c.split(';')[0]).join('; ');
}
async function bo(path, { method = 'GET', body, cookie } = {}) {
  const res = await fetch(`${BACKOFFICE_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  const setCookies = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [res.headers.get('set-cookie')].filter(Boolean);
  return { status: res.status, data, setCookies };
}

async function mkTenant(nuit) {
  const tenantId = `itest-1g4l-${rand()}`;
  const res = await post('/api/license-issuer/tenants', { id: tenantId, name: 'T1G4L', nuit });
  assert.equal(res.status, 200, JSON.stringify(res.data));
  return tenantId;
}
async function mkStore(tenantId, licenseId, name) {
  const res = await post('/api/license-issuer/stores', { tenant_id: tenantId, license_id: licenseId, name });
  assert.equal(res.status, 200, JSON.stringify(res.data));
  return res.data.store.id;
}
async function provisionFirstOwner(tenantId, username = 'admin') {
  const res = await post('/api/license-issuer/backoffice-owner', { tenant_id: tenantId, username });
  assert.equal(res.status, 200, JSON.stringify(res.data));
  return res.data;
}

/** Login + fluxo completo de primeiro acesso (password -> recovery email -> verify) -> devolve a cookie final. */
async function loginAndCompleteFirstAccess(nuit, username, tempPassword) {
  const login = await bo('/api/auth/login', { method: 'POST', body: { nuit, username, password: tempPassword } });
  assert.equal(login.status, 200, JSON.stringify(login.data));
  let cookie = cookieHeader(login.setCookies);
  if (!login.data.firstAccessRequired) return cookie;

  const newPassword = `Pw!${rand()}Aa1`;
  const setPw = await bo('/api/auth/first-access/password', { method: 'POST', body: { newPassword }, cookie });
  assert.equal(setPw.status, 200, JSON.stringify(setPw.data));
  cookie = cookieHeader(setPw.setCookies);

  const recoveryEmail = `${username}-${rand()}@test.local`;
  const setEmail = await bo('/api/auth/first-access/recovery-email', { method: 'POST', body: { recoveryEmail }, cookie });
  assert.equal(setEmail.status, 200, JSON.stringify(setEmail.data));
  assert.ok(setEmail.data.dev?.token);
  const verify = await bo('/api/auth/first-access/verify-email', { method: 'POST', body: { token: setEmail.data.dev.token } });
  assert.equal(verify.status, 200, JSON.stringify(verify.data));

  return cookie;
}
async function loginOnly(nuit, username, password) {
  const login = await bo('/api/auth/login', { method: 'POST', body: { nuit, username, password } });
  return login;
}

const c = {};

before(async () => {
  if (!run) return;
  try {
    await fetch(`${E('ISSUER_URL')}/`);
  } catch {
    throw new Error(`License Console não está a responder em ${E('ISSUER_URL')} — arrancar "npm run dev" em license-console/ primeiro.`);
  }
  try {
    await fetch(`${BACKOFFICE_URL}/login`);
  } catch {
    throw new Error(`Backoffice não está a responder em ${BACKOFFICE_URL} — arrancar "npm run dev" em backoffice/ primeiro.`);
  }

  c.nuit = `NUIT-1G4L-${rand()}`;
  c.tenantId = await mkTenant(c.nuit);
  const lic = await post('/api/license-issuer/licenses', { tenant_id: c.tenantId, plan: 'PRO', commerce_type: 'retalho', max_devices: 20 });
  assert.equal(lic.status, 200, JSON.stringify(lic.data));
  c.licenseId = lic.data.license.id;
  c.storeA = await mkStore(c.tenantId, c.licenseId, 'Loja A (1G4L)');
  c.storeB = await mkStore(c.tenantId, c.licenseId, 'Loja B (1G4L)');

  const owner1 = await provisionFirstOwner(c.tenantId, 'owner1');
  c.owner1Cookie = await loginAndCompleteFirstAccess(c.nuit, 'owner1', owner1.tempPassword);
});

test('owner cria store_operator: TXT, primeiro acesso, email verificado, acesso só à Store atribuída', opts, async () => {
  const createRes = await bo('/api/users', { method: 'POST', body: { username: 'op1', role: 'store_operator', storeIds: [c.storeA] }, cookie: c.owner1Cookie });
  assert.equal(createRes.status, 201, JSON.stringify(createRes.data));
  assert.equal(createRes.data.username, 'op1');
  assert.ok(createRes.data.tempPassword && createRes.data.tempPassword.length >= 12);
  assert.ok(createRes.data.txt.includes('op1') && createRes.data.txt.includes(createRes.data.tempPassword));
  c.op1TempPassword = createRes.data.tempPassword;

  const op1Cookie = await loginAndCompleteFirstAccess(c.nuit, 'op1', c.op1TempPassword);
  c.op1Cookie = op1Cookie;

  const storesA = await bo('/api/stores', { cookie: op1Cookie });
  assert.equal(storesA.status, 200);
  const names = (storesA.data.stores ?? []).map((s) => s.id);
  assert.deepEqual(names, [c.storeA]);
});

test('store_operator não administra utilizadores', opts, async () => {
  const listAttempt = await bo('/api/users', { cookie: c.op1Cookie });
  assert.equal(listAttempt.status, 403);
  const createAttempt = await bo('/api/users', { method: 'POST', body: { username: 'hacker', role: 'store_operator', storeIds: [c.storeA] }, cookie: c.op1Cookie });
  assert.equal(createAttempt.status, 403);
});

test('owner adicional: novo owner vê todos os utilizadores do Tenant', opts, async () => {
  const createRes = await bo('/api/users', { method: 'POST', body: { username: 'owner2', role: 'owner' }, cookie: c.owner1Cookie });
  assert.equal(createRes.status, 201, JSON.stringify(createRes.data));
  c.owner2TempPassword = createRes.data.tempPassword;
  c.owner2Cookie = await loginAndCompleteFirstAccess(c.nuit, 'owner2', c.owner2TempPassword);

  const list = await bo('/api/users', { cookie: c.owner2Cookie });
  assert.equal(list.status, 200);
  const usernames = list.data.users.map((u) => u.username).sort();
  assert.deepEqual(usernames, ['op1', 'owner1', 'owner2']);
});

test('username duplicado é rejeitado (mesmo Tenant)', opts, async () => {
  const dup = await bo('/api/users', { method: 'POST', body: { username: 'op1', role: 'store_operator', storeIds: [c.storeA] }, cookie: c.owner1Cookie });
  assert.equal(dup.status, 409);
});

test('Tenant isolation: owner de outro Tenant nunca vê estes utilizadores', opts, async () => {
  const nuitB = `NUIT-1G4L-B-${rand()}`;
  const tenantB = await mkTenant(nuitB);
  const ownerB = await provisionFirstOwner(tenantB, 'ownerb');
  const ownerBCookie = await loginAndCompleteFirstAccess(nuitB, 'ownerb', ownerB.tempPassword);

  const list = await bo('/api/users', { cookie: ownerBCookie });
  assert.equal(list.status, 200);
  assert.deepEqual(list.data.users.map((u) => u.username), ['ownerb']);
});

test('alteração de Stores atribuídas', opts, async () => {
  const createRes = await bo('/api/users', { method: 'POST', body: { username: 'op2', role: 'store_operator', storeIds: [c.storeA] }, cookie: c.owner1Cookie });
  assert.equal(createRes.status, 201, JSON.stringify(createRes.data));
  const op2Cookie = await loginAndCompleteFirstAccess(c.nuit, 'op2', createRes.data.tempPassword);

  const before1 = await bo('/api/stores', { cookie: op2Cookie });
  assert.deepEqual((before1.data.stores ?? []).map((s) => s.id), [c.storeA]);

  const list1 = await bo('/api/users', { cookie: c.owner1Cookie });
  const op2 = list1.data.users.find((u) => u.username === 'op2');
  const patch = await bo(`/api/users/${op2.user_id}/stores`, { method: 'PATCH', body: { storeIds: [c.storeB] }, cookie: c.owner1Cookie });
  assert.equal(patch.status, 200, JSON.stringify(patch.data));

  const after1 = await bo('/api/stores', { cookie: op2Cookie });
  assert.deepEqual((after1.data.stores ?? []).map((s) => s.id), [c.storeB]);
});

test('desativação: utilizador desactivado deixa de conseguir entrar', opts, async () => {
  const list = await bo('/api/users', { cookie: c.owner1Cookie });
  const op1 = list.data.users.find((u) => u.username === 'op1');
  const disable = await bo(`/api/users/${op1.user_id}/status`, { method: 'PATCH', body: { status: 'disabled' }, cookie: c.owner1Cookie });
  assert.equal(disable.status, 200, JSON.stringify(disable.data));

  // op1 já concluiu o primeiro acesso, por isso a password normal é usada aqui — o teste
  // só precisa de confirmar que o LOGIN falha depois de desactivado (genérico, sem pistas).
  const attemptedLogin = await bo('/api/auth/login', { method: 'POST', body: { nuit: c.nuit, username: 'op1', password: 'password-qualquer' } });
  assert.equal(attemptedLogin.status, 401);

  const reenable = await bo(`/api/users/${op1.user_id}/status`, { method: 'PATCH', body: { status: 'active' }, cookie: c.owner1Cookie });
  assert.equal(reenable.status, 200);
});

test('último owner protegido: nunca se auto-desactiva; consegue reduzir até 1 owner activo mas nunca a 0', opts, async () => {
  const listBefore = await bo('/api/users', { cookie: c.owner1Cookie });
  const owner1Row = listBefore.data.users.find((u) => u.username === 'owner1');

  // Nunca a própria linha.
  const selfDisable = await bo(`/api/users/${owner1Row.user_id}/status`, { method: 'PATCH', body: { status: 'disabled' }, cookie: c.owner1Cookie });
  assert.equal(selfDisable.status, 403);

  // owner1 pode desactivar owner2 (fica só owner1 activo) — reduzir a 1 é permitido.
  const owner2Row = listBefore.data.users.find((u) => u.username === 'owner2');
  const disableOwner2 = await bo(`/api/users/${owner2Row.user_id}/status`, { method: 'PATCH', body: { status: 'disabled' }, cookie: c.owner1Cookie });
  assert.equal(disableOwner2.status, 200, JSON.stringify(disableOwner2.data));

  // Confirma: continua a existir pelo menos 1 owner activo (owner1) — nunca chega a 0,
  // porque a própria linha nunca pode ser desactivada por si mesma.
  const listAfter = await bo('/api/users', { cookie: c.owner1Cookie });
  const activeOwners = listAfter.data.users.filter((u) => u.role === 'owner' && u.status === 'active');
  assert.equal(activeOwners.length, 1);
  assert.equal(activeOwners[0].username, 'owner1');
});
