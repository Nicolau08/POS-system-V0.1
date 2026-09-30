/**
 * Etapa 1G.4 Fase 8 — login NUIT+username+password, primeiro owner via License Console,
 * primeiro acesso (troca de password + verificação de email de recuperação) e "esqueci a
 * senha". Bate nos dois servidores Next.js reais (license-console :3002, backoffice
 * :3003) — nenhuma destas rotas tem lógica em Postgres que um teste directo a psql
 * pudesse validar sozinho.
 *
 * Requer env: POSLY_1G4K_ISSUER_URL, POSLY_1G4K_ADMIN_TOKEN, POSLY_1G4K_SUPABASE_URL,
 *   POSLY_1G4K_ANON_KEY, POSLY_1G4K_SERVICE_ROLE_KEY, POSLY_1G4K_BACKOFFICE_URL
 *   (default http://localhost:3003 — arrancar `npm run dev` em backoffice/ e
 *   license-console/ antes; BACKOFFICE_DEV_MAIL_ECHO=true tem de estar no
 *   backoffice/.env.local para os tokens virem no corpo da resposta).
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { test, before } from 'node:test';
import { createClient } from '@supabase/supabase-js';

const E = (k) => process.env[`POSLY_1G4K_${k}`] || '';
const BACKOFFICE_URL = E('BACKOFFICE_URL') || 'http://localhost:3003';
const run = Boolean(E('ISSUER_URL') && E('ADMIN_TOKEN') && E('SUPABASE_URL') && E('ANON_KEY') && E('SERVICE_ROLE_KEY'));
const opts = { skip: !run && 'defina POSLY_1G4K_*' };

const svc = run ? createClient(E('SUPABASE_URL'), E('SERVICE_ROLE_KEY'), { auth: { persistSession: false } }) : null;
const rand = () => crypto.randomBytes(4).toString('hex');

async function post(p, body, admin = true) {
  const res = await fetch(`${E('ISSUER_URL')}${p}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(admin ? { Authorization: `Bearer ${E('ADMIN_TOKEN')}` } : {}) },
    body: JSON.stringify(body),
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}
async function provisionOwner(tenantId, username = 'admin') {
  const res = await post('/api/license-issuer/backoffice-owner', { tenant_id: tenantId, username });
  assert.equal(res.status, 200, JSON.stringify(res.data));
  return res.data;
}
async function mkTenant(nuit) {
  const tenantId = `itest-1g4k-${rand()}`;
  const res = await post('/api/license-issuer/tenants', { id: tenantId, name: 'T1G4K', nuit });
  assert.equal(res.status, 200, JSON.stringify(res.data));
  return tenantId;
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

  c.nuit = `NUIT-1G4K-${rand()}`;
  c.tenantId = await mkTenant(c.nuit);
});

test('primeiro owner: provisionamento gera NUIT/username/password temporária/URL (TXT)', opts, async () => {
  const owner = await provisionOwner(c.tenantId, 'admin');
  assert.equal(owner.nuit, c.nuit);
  assert.equal(owner.username, 'admin');
  assert.ok(owner.tempPassword && owner.tempPassword.length >= 12);
  assert.ok(owner.url.includes('/login'));
  assert.ok(owner.txt.includes(c.nuit) && owner.txt.includes('admin') && owner.txt.includes(owner.tempPassword));
  c.tempPassword = owner.tempPassword;

  // Duplicado (mesmo Tenant, mesmo username) tem de ser rejeitado, nunca reprovisionar.
  const dup = await post('/api/license-issuer/backoffice-owner', { tenant_id: c.tenantId, username: 'admin' });
  assert.equal(dup.status, 409);
});

test('troca obrigatória: login com password temporária -> APIs bloqueadas até concluir', opts, async () => {
  const login1 = await bo('/api/auth/login', { method: 'POST', body: { nuit: c.nuit, username: 'admin', password: c.tempPassword } });
  assert.equal(login1.status, 200, JSON.stringify(login1.data));
  assert.equal(login1.data.firstAccessRequired, true);
  c.cookie = cookieHeader(login1.setCookies);

  const blocked1 = await bo('/api/stores', { cookie: c.cookie });
  assert.equal(blocked1.status, 403, 'API protegida devia bloquear antes do primeiro acesso concluído');

  const newPassword = `Nova!${rand()}Aa1`;
  c.password = newPassword;
  const setPw = await bo('/api/auth/first-access/password', { method: 'POST', body: { newPassword }, cookie: c.cookie });
  assert.equal(setPw.status, 200, JSON.stringify(setPw.data));
  // A troca de password revoga o token antigo — a rota emite cookies novas, que o teste
  // (tal como um browser real) tem de passar a usar a partir daqui.
  assert.ok(setPw.setCookies.length > 0, 'esperava cookies novas depois da troca de password');
  c.cookie = cookieHeader(setPw.setCookies);

  // Password trocada mas email de recuperação ainda não verificado — continua bloqueado.
  const blocked2 = await bo('/api/stores', { cookie: c.cookie });
  assert.equal(blocked2.status, 403);
});

test('email de recuperação: verificação conclui o primeiro acesso e liberta o Backoffice', opts, async () => {
  c.recoveryEmail = `owner-1g4k-${rand()}@test.local`;
  const setEmail = await bo('/api/auth/first-access/recovery-email', { method: 'POST', body: { recoveryEmail: c.recoveryEmail }, cookie: c.cookie });
  assert.equal(setEmail.status, 200, JSON.stringify(setEmail.data));
  assert.ok(setEmail.data.dev?.token, 'BACKOFFICE_DEV_MAIL_ECHO=true devia devolver o token');

  const badToken = await bo('/api/auth/first-access/verify-email', { method: 'POST', body: { token: 'token-invalido' } });
  assert.equal(badToken.status, 400);

  const verify = await bo('/api/auth/first-access/verify-email', { method: 'POST', body: { token: setEmail.data.dev.token } });
  assert.equal(verify.status, 200, JSON.stringify(verify.data));

  const reused = await bo('/api/auth/first-access/verify-email', { method: 'POST', body: { token: setEmail.data.dev.token } });
  assert.equal(reused.status, 400);

  const nowOk = await bo('/api/stores', { cookie: c.cookie });
  assert.equal(nowOk.status, 200, 'API protegida devia libertar depois do primeiro acesso concluído');
});

test('login normal NUIT+username: firstAccessRequired=false depois de concluído', opts, async () => {
  const login = await bo('/api/auth/login', { method: 'POST', body: { nuit: c.nuit, username: 'admin', password: c.password } });
  assert.equal(login.status, 200, JSON.stringify(login.data));
  assert.equal(login.data.firstAccessRequired, false);
  assert.equal(login.data.username, 'admin');
});

test('Tenant errado: NUIT inválido com username/password certos -> credenciais inválidas genérico', opts, async () => {
  const res = await bo('/api/auth/login', { method: 'POST', body: { nuit: `NUIT-INEXISTENTE-${rand()}`, username: 'admin', password: c.password } });
  assert.equal(res.status, 401);
  assert.equal(res.data.error, 'NUIT, utilizador ou senha inválidos.');
});

test('username igual em dois Tenants: sem colisão entre Tenants', opts, async () => {
  const nuitB = `NUIT-1G4K-B-${rand()}`;
  const tenantB = await mkTenant(nuitB);
  const ownerB = await provisionOwner(tenantB, 'admin'); // mesmo username 'admin' do Tenant A — tem de passar
  assert.equal(ownerB.username, 'admin');

  const loginA = await bo('/api/auth/login', { method: 'POST', body: { nuit: c.nuit, username: 'admin', password: c.password } });
  assert.equal(loginA.status, 200);
  assert.equal(loginA.data.tenantId, c.tenantId);

  const loginB = await bo('/api/auth/login', { method: 'POST', body: { nuit: nuitB, username: 'admin', password: ownerB.tempPassword } });
  assert.equal(loginB.status, 200);
  assert.equal(loginB.data.tenantId, tenantB);
  assert.notEqual(loginA.data.tenantId, loginB.data.tenantId);
});

test('reset ("esqueci a senha"): pedido genérico, confirmação, token expirado/reutilizado', opts, async () => {
  // NUIT/username inexistentes -> resposta genérica igual (sem enumeração).
  const nonExistent = await bo('/api/auth/reset/request', { method: 'POST', body: { nuit: 'NUIT-NAO-EXISTE', username: 'ninguem' } });
  assert.equal(nonExistent.status, 200);
  assert.ok(!nonExistent.data.dev);

  const reqRes = await bo('/api/auth/reset/request', { method: 'POST', body: { nuit: c.nuit, username: 'admin' } });
  assert.equal(reqRes.status, 200);
  assert.ok(reqRes.data.dev?.token, 'BACKOFFICE_DEV_MAIL_ECHO=true devia devolver o token');
  const resetToken = reqRes.data.dev.token;

  const newerPassword = `Nova2!${rand()}Bb2`;
  const confirmed = await bo('/api/auth/reset/confirm', { method: 'POST', body: { token: resetToken, newPassword: newerPassword } });
  assert.equal(confirmed.status, 200, JSON.stringify(confirmed.data));

  // Token reutilizado.
  const reused = await bo('/api/auth/reset/confirm', { method: 'POST', body: { token: resetToken, newPassword: 'Outra!Pass9' } });
  assert.equal(reused.status, 400);

  // Login com a password antiga já não funciona; com a nova, funciona.
  const oldLogin = await bo('/api/auth/login', { method: 'POST', body: { nuit: c.nuit, username: 'admin', password: c.password } });
  assert.equal(oldLogin.status, 401);
  const newLogin = await bo('/api/auth/login', { method: 'POST', body: { nuit: c.nuit, username: 'admin', password: newerPassword } });
  assert.equal(newLogin.status, 200);
  c.password = newerPassword;

  // Token expirado: novo pedido, forçar expires_at para o passado via service_role, confirmar.
  const req2 = await bo('/api/auth/reset/request', { method: 'POST', body: { nuit: c.nuit, username: 'admin' } });
  assert.ok(req2.data.dev?.token);
  const { data: latest, error: findErr } = await svc
    .from('backoffice_auth_tokens')
    .select('id')
    .eq('purpose', 'password_reset')
    .is('used_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  assert.equal(findErr, null, JSON.stringify(findErr));
  assert.ok(latest, 'devia existir um token de reset por usar');
  const { error: expErr } = await svc.from('backoffice_auth_tokens').update({ expires_at: new Date(Date.now() - 60_000).toISOString() }).eq('id', latest.id);
  assert.equal(expErr, null, JSON.stringify(expErr));
  const expiredConfirm = await bo('/api/auth/reset/confirm', { method: 'POST', body: { token: req2.data.dev.token, newPassword: 'MaisUma!Pass9' } });
  assert.equal(expiredConfirm.status, 400);
});
