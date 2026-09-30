/**
 * Etapa 1G.3.6 - TLS + pinning da fingerprint do certificado do Store Server. Servidor REAL em LAN (HTTPS so na rede; HTTP so
 * no loopback), Stations com pinnedFetch, servidores FALSOS com outro certificado. Sem Internet/cloud.
 * O fluxo completo (login/PIN, Bearer, venda, locks, skew, revogacao, restart) sobre HTTPS esta em station-client-server /
 * station-hardening-server / station-auth-server (todos passaram a HTTPS com pin nesta etapa).
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { getLocalMachineId } from '../../lib/licensing/localMachineId.js';
import { generateServerCertificate, normalizeFingerprint } from '../../lib/tls/serverCertificate.js';
import { getOrCreateServerTlsIdentity } from '../../electron/serverTlsIdentity.js';
import { createPinnedFetch, probeUnpinned } from '../../electron/station/pinnedHttps.js';
import { createStationIdentityStore, IDENTITY_FILE, parsePairingToken } from '../../electron/station/stationIdentity.js';
import { createStationClient } from '../../electron/station/stationClient.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const lcDir = path.join(repoRoot, 'license-console');
const lanIp = Object.values(os.networkInterfaces()).flat().find((i) => i && i.family === 'IPv4' && !i.internal)?.address;
const MACHINE = getLocalMachineId();

function fakeSafeStorage({ available = true, secret = crypto.randomBytes(32) } = {}) {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (s) => {
      const iv = crypto.randomBytes(12);
      const c = crypto.createCipheriv('aes-256-gcm', secret, iv);
      const enc = Buffer.concat([c.update(s, 'utf8'), c.final()]);
      return Buffer.concat([iv, c.getAuthTag(), enc]);
    },
    decryptString: (b) => {
      const d = crypto.createDecipheriv('aes-256-gcm', secret, b.subarray(0, 12));
      d.setAuthTag(b.subarray(12, 28));
      return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8');
    },
  };
}
function gen(o) {
  const r = spawnSync(process.execPath, ['--experimental-strip-types', path.join(lcDir, 'scripts', 'gen-offline-license-fixture.mjs'), JSON.stringify(o)], { cwd: lcDir, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}
/** Servidor HTTPS falso: regista QUANTOS bytes de aplicacao recebe (pairing code/PIN/Bearer nunca devem la chegar). */
async function fakeServer({ cert, key, handler }) {
  const seen = { bytes: 0, requests: 0 };
  const server = https.createServer({ cert, key }, (req, res) => {
    seen.requests += 1;
    handler ? handler(req, res) : (res.writeHead(200, { 'Content-Type': 'application/json' }), res.end('{"ok":true}'));
  });
  server.on('secureConnection', (s) => s.on('data', (b) => { seen.bytes += b.length; }));
  server.on('tlsClientError', () => {});
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { origin: `https://127.0.0.1:${server.address().port}`, seen, close: () => server.close() };
}

test('identidade TLS do Server (main): persistente entre reinicios; outro perfil/sem safeStorage nunca cai em plaintext', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'posly-tls-id-'));
  const ss = fakeSafeStorage();
  const a = await getOrCreateServerTlsIdentity({ userDataPath: dir, safeStorage: ss });
  assert.equal(a.created, true);
  const b = await getOrCreateServerTlsIdentity({ userDataPath: dir, safeStorage: ss });
  assert.equal(b.created, false);
  assert.equal(b.fingerprint, a.fingerprint, 'reinicio nao muda a fingerprint');
  const keyFile = fs.readFileSync(path.join(dir, 'tls', 'server-key.enc'));
  assert.equal(keyFile.includes('PRIVATE KEY'), false, 'chave privada so cifrada em disco');
  assert.equal(fs.readdirSync(path.join(dir, 'tls')).sort().join(), 'server-cert.pem,server-key.enc');
  assert.equal(await getOrCreateServerTlsIdentity({ userDataPath: dir, safeStorage: fakeSafeStorage({ available: false }) }), null, 'sem armazenamento seguro: sem TLS (a LAN nao abre)');
  assert.equal(await getOrCreateServerTlsIdentity({ userDataPath: dir, safeStorage: { ...fakeSafeStorage(), getSelectedStorageBackend: () => 'basic_text' } }), null);
  // outro perfil (nao decifra) => nova identidade EXPLICITA e fingerprint diferente (as Stations tem de repetir o pairing)
  const c = await getOrCreateServerTlsIdentity({ userDataPath: dir, safeStorage: fakeSafeStorage() });
  assert.equal(c.created, true);
  assert.notEqual(c.fingerprint, a.fingerprint);
});

test('pinning (unit): so o certificado com a fingerprint certa; outro, expirado, HTTP e redirect sao recusados; sem CA publica', async () => {
  const real = await generateServerCertificate();
  const other = await generateServerCertificate();
  const expired = await generateServerCertificate({ now: new Date(Date.now() - 3 * 24 * 3600 * 1000), validityDays: 1 });
  const srv = await fakeServer({ cert: real.certPem, key: real.keyPem });
  const redir = await fakeServer({ cert: real.certPem, key: real.keyPem, handler: (_q, res) => { res.writeHead(302, { Location: 'https://example.invalid/' }); res.end(); } });
  const old = await fakeServer({ cert: expired.certPem, key: expired.keyPem });
  try {
    assert.equal((await createPinnedFetch({ fingerprint: real.fingerprint })(`${srv.origin}/x`)).status, 200, 'pin certo: aceite');
    assert.equal((await createPinnedFetch({ fingerprint: real.fingerprint.toUpperCase().match(/.{2}/g).join(':') })(`${srv.origin}/x`)).status, 200, 'formato AB:CD aceite');
    await assert.rejects(createPinnedFetch({ fingerprint: other.fingerprint })(`${srv.origin}/x`), (e) => e.code === 'CERT_PIN_MISMATCH');
    assert.equal(srv.seen.requests, 2, 'so os 2 pedidos com pin certo chegaram; o do pin errado nao');
    await assert.rejects(fetch(`${srv.origin}/x`), /fetch failed|self.signed|certificate/i, 'self-signed nao e aceite por CA/por omissao');
    await assert.rejects(createPinnedFetch({ fingerprint: real.fingerprint })('http://127.0.0.1:1/x'), (e) => e.code === 'HTTP_DOWNGRADE');
    await assert.rejects(createPinnedFetch({ fingerprint: real.fingerprint })(`${redir.origin}/x`), (e) => e.code === 'REDIRECT_REJECTED');
    await assert.rejects(createPinnedFetch({ fingerprint: expired.fingerprint })(`${old.origin}/x`), (e) => e.code === 'CERT_EXPIRED');
    assert.equal(old.seen.bytes, 0, 'certificado expirado: nada enviado');
    assert.throws(() => createPinnedFetch({ fingerprint: 'abc' }), (e) => e.code === 'INVALID_FINGERPRINT');
    assert.equal(normalizeFingerprint(real.fingerprint.slice(0, 63)), null);
  } finally {
    srv.close(); redir.close(); old.close();
  }
});

test('MITM/servidor falso: o pairing code NUNCA e enviado a um servidor com outro certificado; sem estado parcial', async () => {
  const realFp = (await generateServerCertificate()).fingerprint; // fingerprint que o admin deu (do Server verdadeiro)
  const evil = await generateServerCertificate();
  const fake = await fakeServer({ cert: evil.certPem, key: evil.keyPem });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'posly-mitm-'));
  try {
    const store = createStationIdentityStore({ userDataPath: dir, safeStorage: fakeSafeStorage() });
    await assert.rejects(store.pair({ serverUrl: fake.origin, code: '12345678', expectedFingerprint: realFp }), (e) => e.code === 'CERT_PIN_MISMATCH');
    assert.equal(fake.seen.bytes, 0, 'nenhum byte de aplicacao (nem o codigo) chegou ao servidor falso');
    assert.equal(fake.seen.requests, 0);
    assert.deepEqual(fs.readdirSync(dir), [], 'sem identidade parcial');
    // sem fingerprint fora de banda (TOFU) recusa-se antes de qualquer ligacao
    await assert.rejects(store.pair({ serverUrl: fake.origin, code: '12345678' }), (e) => e.code === 'FINGERPRINT_REQUIRED');
    await assert.rejects(store.pair({ serverUrl: 'http://127.0.0.1:9', code: '12345678', expectedFingerprint: realFp }), (e) => e.code === 'HTTP_DOWNGRADE');
    assert.equal(fake.seen.bytes, 0);
  } finally {
    fake.close();
  }
});

test('token de pairing: POSLY-PAIR-1.<codigo>.<fingerprint> (fora de banda); formatos invalidos recusados', () => {
  const fp = crypto.randomBytes(32).toString('hex');
  const tok = `POSLY-PAIR-1.12345678.${Buffer.from(fp, 'hex').toString('base64url')}`;
  assert.deepEqual(parsePairingToken(tok), { code: '12345678', fingerprint: fp });
  for (const bad of ['12345678', 'POSLY-PAIR-1.1234.abc', `POSLY-PAIR-2.12345678.${Buffer.from(fp, 'hex').toString('base64url')}`, '']) assert.equal(parsePairingToken(bad), null);
});

test('Store Server real: HTTPS+pin na LAN, HTTP so no loopback, fingerprint estavel no restart, certificado trocado bloqueia a Station', { skip: !lanIp && 'sem IPv4 LAN' }, async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'posly-tls-e2e-'));
  const userData = path.join(tmp, 'server');
  fs.mkdirSync(userData, { recursive: true });
  const dbPath = path.join(tmp, 'database.db');
  const TENANT = 'tenant-e2e-tls';
  const lic = gen({ v2: true, payload: { license_id: 'lic-tls', tenant_id: TENANT, machine_id: MACHINE, name: 'Loja TLS', store_id: 'store-tls', max_stations_per_store: 5 } });
  fs.writeFileSync(path.join(userData, 'offline-license.json'), JSON.stringify(lic.envelope));
  const port = 5200 + Math.floor(Math.random() * 90);
  const spawnServer = () => {
    const env = {
      ...process.env, POS_API_PORT: String(port), NODE_ENV: 'development', POS_DB_PATH: dbPath, POS_USER_DATA_PATH: userData, DEFAULT_TENANT_ID: TENANT,
      POS_API_BIND: '0.0.0.0', POS_LAN_ACCESS: '1', POS_TLS_ALLOW_PLAINTEXT_DEV: '1', POS_DEV_OFFLINE_LICENSE_KEY_ID: lic.keyId, POS_DEV_OFFLINE_LICENSE_PUBLIC_KEY: lic.publicKeyPem,
    };
    for (const k of ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'POS_DEVICE_AUTH_BRIDGE_URL', 'POS_LICENSE_HMAC_SECRET', 'TRUST_PROXY']) delete env[k];
    const c = spawn(process.execPath, [path.join(repoRoot, 'api', 'server.js')], { cwd: repoRoot, env, stdio: ['ignore', 'pipe', 'pipe'] });
    c.stdout.on('data', () => {});
    c.stderr.on('data', () => {});
    return c;
  };
  const LOCAL = `http://127.0.0.1:${port}`;
  const LAN = `https://${lanIp}:${port}`;
  const waitUp = async () => {
    for (let i = 0; i < 120; i += 1) {
      try { if ((await fetch(`${LOCAL}/health`)).ok) return; } catch { /* a arrancar */ }
      await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error('servidor nao arrancou');
  };
  const local = async (method, target, { body, token } = {}) => {
    const res = await fetch(LOCAL + target, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const json = await res.json().catch(() => ({}));
    return { status: res.status, json, data: json.data ?? null };
  };
  const adminLogin = async () => {
    for (let i = 0; i < 15; i += 1) {
      const t = (await local('POST', '/auth/login', { body: { userId: 'admin-local', enteredPin: '1234' } })).json.token;
      if (t) return t;
      await new Promise((r) => setTimeout(r, 1000));
    }
    throw new Error('login');
  };

  let child = spawnServer();
  try {
    await waitUp();
    assert.equal((await local('POST', '/setup/license/install-offline-license', { body: { offline_license: lic.envelope, machine_id: MACHINE } })).status, 200);
    assert.equal((await local('POST', '/setup/admin-password', { body: { pin: '1234' } })).status, 200);
    let admin = await adminLogin();
    const mkPairing = async (name) => (await local('POST', '/stations/pairings', { token: admin, body: { name, role: 'caixa' } })).data;

    // fingerprint mostrada ao admin (fora de banda) = a do certificado realmente servido
    const p1 = await mkPairing('Caixa TLS');
    const FP = normalizeFingerprint(p1.certificate_fingerprint);
    assert.ok(FP && p1.short_fingerprint && p1.pairing_token);
    assert.deepEqual(parsePairingToken(p1.pairing_token), { code: p1.code, fingerprint: FP });
    const probe = await probeUnpinned(`${LAN}/station/discover`);
    assert.equal(probe.status, 200);
    assert.equal(probe.fingerprint, FP, 'o servidor apresenta o certificado cuja fingerprint o admin viu');
    assert.deepEqual(Object.keys(probe.json.data).sort(), ['accepts_pairing', 'app', 'port', 'protocol']);

    // LAN: HTTP recusado (sem HTTP paralelo); loopback: HTTP continua a funcionar
    await assert.rejects(new Promise((resolve, reject) => { http.get(`http://${lanIp}:${port}/health`, { timeout: 3000 }, resolve).on('error', reject).on('timeout', function onTimeout() { this.destroy(new Error('timeout')); }); }), /ECONNREFUSED|ECONNRESET|timeout|socket hang up/i, 'HTTP na LAN nao responde');
    assert.equal((await local('GET', '/health')).status, 200);

    // pairing com o token (pin + codigo) e uso normal sobre HTTPS
    const dirA = path.join(tmp, 'A');
    fs.mkdirSync(dirA, { recursive: true });
    const ssA = fakeSafeStorage();
    const storeA = createStationIdentityStore({ userDataPath: dirA, safeStorage: ssA });
    const tok = parsePairingToken(p1.pairing_token);
    const rA = await storeA.pair({ serverUrl: LAN, code: tok.code, expectedFingerprint: tok.fingerprint });
    const meta = JSON.parse(fs.readFileSync(path.join(dirA, IDENTITY_FILE), 'utf8'));
    assert.equal(meta.server_fingerprint, FP);
    const cA = createStationClient({ identityStore: storeA });
    const call = async (client, method, target, { body, token } = {}) => {
      const r = await client.request({ url: LAN + target, method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? Buffer.from(JSON.stringify(body)) : null });
      let json = {};
      try { json = JSON.parse(r.body.toString('utf8')); } catch { /* nao JSON */ }
      return { status: r.status, json };
    };
    const login = await call(cA, 'POST', '/auth/login', { body: { userId: 'admin-local', enteredPin: '1234' } });
    assert.equal(login.status, 200);
    assert.equal((await call(cA, 'GET', '/produtos', { token: login.json.token })).status, 200);
    // descoberta nao altera a fingerprint persistida
    const before = fs.readFileSync(path.join(dirA, IDENTITY_FILE), 'utf8');
    await probeUnpinned(`${LAN}/station/discover`);
    assert.equal(fs.readFileSync(path.join(dirA, IDENTITY_FILE), 'utf8'), before);

    // fingerprint adulterada localmente -> bloqueia (e nao envia nada); sem fingerprint / URL http -> identidade inutilizavel
    const idFile = path.join(dirA, IDENTITY_FILE);
    const orig = JSON.parse(before);
    fs.writeFileSync(idFile, JSON.stringify({ ...orig, server_fingerprint: crypto.randomBytes(32).toString('hex') }));
    await assert.rejects(call(cA, 'GET', '/auth/login-users'), (e) => e.code === 'CERT_PIN_MISMATCH');
    fs.writeFileSync(idFile, JSON.stringify({ ...orig, server_fingerprint: undefined }));
    await assert.rejects(call(cA, 'GET', '/auth/login-users'), (e) => e.code === 'STATION_NOT_PAIRED');
    fs.writeFileSync(idFile, JSON.stringify({ ...orig, server_url: orig.server_url.replace('https://', 'http://') }));
    await assert.rejects(call(cA, 'GET', '/auth/login-users'), (e) => e.code === 'STATION_NOT_PAIRED' || e.code === 'HTTP_DOWNGRADE');
    fs.writeFileSync(idFile, before);
    assert.equal((await call(cA, 'GET', '/auth/login-users')).status, 200, 'restaurada volta a funcionar');

    // restart do Server: MESMA fingerprint (certificado persistente) e a Station continua a autenticar
    child.kill();
    await new Promise((r) => child.once('exit', r));
    child = spawnServer();
    await waitUp();
    admin = await adminLogin();
    assert.equal(normalizeFingerprint((await mkPairing('Depois do restart')).certificate_fingerprint), FP);
    assert.equal((await call(cA, 'GET', '/auth/login-users')).status, 200);

    // certificado substituido (Server novo/reset explicito): a Station BLOQUEIA, sem auto-accept
    child.kill();
    await new Promise((r) => child.once('exit', r));
    fs.rmSync(path.join(userData, 'tls'), { recursive: true, force: true });
    child = spawnServer();
    await waitUp();
    admin = await adminLogin();
    const p3 = await mkPairing('Novo certificado');
    const FP2 = normalizeFingerprint(p3.certificate_fingerprint);
    assert.notEqual(FP2, FP);
    await assert.rejects(call(cA, 'GET', '/auth/login-users'), (e) => e.code === 'CERT_PIN_MISMATCH', 'certificado trocado: bloqueada');
    // procedimento explicito: reset da confianca + novo pairing com a NOVA fingerprint (nova identidade)
    storeA.clear();
    const rA2 = await createStationIdentityStore({ userDataPath: dirA, safeStorage: ssA }).pair({ serverUrl: LAN, code: p3.code, expectedFingerprint: FP2 });
    assert.notEqual(rA2.stationId, rA.stationId);
  } finally {
    child.kill();
  }
});
