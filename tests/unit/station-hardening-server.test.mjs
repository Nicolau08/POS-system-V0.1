/**
 * Etapa 1G.3.5 - Station/LAN hardening no Store Server REAL (POS_API_BIND=0.0.0.0, pedidos pelo IP LAN, TRUST_PROXY=true
 * de proposito). Sem Internet/cloud. Salta se a maquina nao tiver IPv4 LAN.
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawn, spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { createPinnedFetch } from '../../electron/station/pinnedHttps.js';
import { fileURLToPath } from 'node:url';
import { getLocalMachineId } from '../../lib/licensing/localMachineId.js';
import { createStationIdentityStore } from '../../electron/station/stationIdentity.js';
import { createStationClient } from '../../electron/station/stationClient.js';
import { getStationEntitlement } from '../../api/services/stationEntitlement.service.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const lcDir = path.join(repoRoot, 'license-console');
const lanIp = Object.values(os.networkInterfaces()).flat().find((i) => i && i.family === 'IPv4' && !i.internal)?.address;
const opts = { skip: !lanIp && 'sem IPv4 LAN nesta maquina' };
const TENANT = 'tenant-e2e-hardening';
const STORE_NAME = 'Loja Segredo Lda';
const MACHINE = getLocalMachineId();
const port = 5000 + Math.floor(Math.random() * 90);

function fakeSafeStorage({ secret = crypto.randomBytes(32) } = {}) {
  const state = { available: true };
  return {
    state,
    isEncryptionAvailable: () => state.available,
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

test('Store binding da licenca v2: maquina errada e Store errada nunca habilitam Stations (sem cloud)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'posly-bind-'));
  const lic = gen({ v2: true, payload: { license_id: 'l', tenant_id: 't', machine_id: 'maquina-do-Server-A', store_id: 'store-A', max_stations_per_store: 5 } });
  fs.writeFileSync(path.join(dir, 'offline-license.json'), JSON.stringify(lic.envelope));
  const resolve = () => lic.publicKeyPem;
  const get = (o) => getStationEntitlement({ userDataPath: dir, resolvePublicKeyPem: resolve, ...o });
  assert.equal(get({ machineId: 'maquina-do-Server-A' }).allowed, true);
  assert.equal(get({ machineId: 'maquina-do-Server-B' }).allowed, false, 'licenca de outra maquina');
  assert.equal(get({ machineId: 'maquina-do-Server-A', expectedStoreId: 'store-A' }).allowed, true);
  assert.equal(get({ machineId: 'maquina-do-Server-A', expectedStoreId: 'store-B' }).allowed, false, 'Server configurado para a Store B');
});

test('Store Server em LAN: discovery minimo, matriz de endpoints, spoof, chaves retiradas, estados e fail closed', opts, async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'posly-hard-e2e-'));
  const userData = path.join(tmp, 'server');
  fs.mkdirSync(userData, { recursive: true });
  const dbPath = path.join(tmp, 'database.db');
  const lic = gen({ v2: true, payload: { license_id: 'lic-hard', tenant_id: TENANT, machine_id: MACHINE, name: STORE_NAME, store_id: 'store-hard', max_stations_per_store: 5 } });
  fs.writeFileSync(path.join(userData, 'offline-license.json'), JSON.stringify(lic.envelope));
  const env = {
    ...process.env, POS_API_PORT: String(port), NODE_ENV: 'development', POS_DB_PATH: dbPath, POS_USER_DATA_PATH: userData, DEFAULT_TENANT_ID: TENANT,
    POS_API_BIND: '0.0.0.0', POS_LAN_ACCESS: '1', POS_TLS_ALLOW_PLAINTEXT_DEV: '1', TRUST_PROXY: 'true', POS_DEV_OFFLINE_LICENSE_KEY_ID: lic.keyId, POS_DEV_OFFLINE_LICENSE_PUBLIC_KEY: lic.publicKeyPem,
  };
  for (const k of ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'POS_DEVICE_AUTH_BRIDGE_URL', 'POS_LICENSE_HMAC_SECRET']) delete env[k];
  const child = spawn(process.execPath, [path.join(repoRoot, 'api', 'server.js')], { cwd: repoRoot, env, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', () => {});
  child.stderr.on('data', () => {});
  const LOCAL = `http://127.0.0.1:${port}`;
  const LAN = `https://${lanIp}:${port}`;
  let lanFetch = null; // HTTPS com pin da fingerprint (a que o admin le no Server ao criar o pairing)
  let FP = null;
  const readDb = (sql) => new Promise((resolve, reject) => {
    const sqlite = createRequire(import.meta.url)('@journeyapps/sqlcipher');
    const d = new sqlite.Database(dbPath, sqlite.OPEN_READONLY, (e) => {
      if (e) return reject(e);
      d.all(sql, (err, rows) => { d.close(); return err ? reject(err) : resolve(rows); });
    });
  });
  const plain = async (base, method, target, { body, token, headers = {} } = {}) => {
    const res = await (base === LAN ? lanFetch : fetch)(base + target, {
      method,
      headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json = {};
    try { json = JSON.parse(text); } catch { /* nao JSON */ }
    return { status: res.status, text, json, data: json.data ?? null, code: json.error?.code ?? json.code ?? null };
  };
  const via = async (client, method, target, { body, token, headers = {} } = {}) => {
    const r = await client.request({
      url: LAN + target, method,
      headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
      body: body !== undefined ? Buffer.from(JSON.stringify(body)) : null,
    });
    const text = r.body.toString('utf8');
    let json = {};
    try { json = JSON.parse(text); } catch { /* nao JSON */ }
    return { status: r.status, text, json, data: json.data ?? null, code: json.error?.code ?? json.code ?? null };
  };

  try {
    for (let i = 0; i < 120; i += 1) {
      try { if ((await fetch(`${LOCAL}/health`)).ok) break; } catch { /* a arrancar */ }
      await new Promise((r) => setTimeout(r, 250));
    }
    assert.equal((await plain(LOCAL, 'POST', '/setup/license/install-offline-license', { body: { offline_license: lic.envelope, machine_id: MACHINE } })).status, 200);
    assert.equal((await plain(LOCAL, 'POST', '/setup/admin-password', { body: { pin: '1234' } })).status, 200);
    let adminToken = null;
    for (let i = 0; i < 15 && !adminToken; i += 1) {
      adminToken = (await plain(LOCAL, 'POST', '/auth/login', { body: { userId: 'admin-local', enteredPin: '1234' } })).json.token ?? null;
      if (!adminToken) await new Promise((r) => setTimeout(r, 1000));
    }
    assert.ok(adminToken);

    const mkPair = async (name) => (await plain(LOCAL, 'POST', '/stations/pairings', { token: adminToken, body: { name, role: 'caixa' } })).data;
    const firstPairing = await mkPair('Caixa A');
    FP = firstPairing.certificate_fingerprint;
    lanFetch = createPinnedFetch({ fingerprint: FP });
    // ---- 1. DISCOVERY minimo (nem tenant, nem Store, nem nome da loja, nem licenca)
    const disc = await plain(LAN, 'GET', '/station/discover');
    assert.equal(disc.status, 200);
    assert.deepEqual(Object.keys(disc.data).sort(), ['accepts_pairing', 'app', 'port', 'protocol']);
    for (const secret of [TENANT, STORE_NAME, 'store-hard', 'lic-hard', 'tenant_id', 'store_name', 'version']) assert.equal(disc.text.includes(secret), false, `discovery nao expoe ${secret}`);

    // ---- 2. Stations: pairing + sessao vinculada
    const dirA = path.join(tmp, 'A'); const dirB = path.join(tmp, 'B'); const dirZ = path.join(tmp, 'Z');
    for (const d of [dirA, dirB, dirZ]) fs.mkdirSync(d, { recursive: true });
    const ssA = fakeSafeStorage(); const ssB = fakeSafeStorage();
    const storeA = createStationIdentityStore({ userDataPath: dirA, safeStorage: ssA });
    const rA = await storeA.pair({ serverUrl: LAN, expectedFingerprint: FP, code: firstPairing.code });
    const cA = createStationClient({ identityStore: storeA, allowedUnsignedOrigin: () => LAN });
    const tokA = (await via(cA, 'POST', '/auth/login', { body: { userId: 'admin-local', enteredPin: '1234' } })).json.token;
    assert.ok(tokA);

    // ---- 3. MATRIZ de endpoints (remoto, TRUST_PROXY=true e X-Forwarded-For forjado de proposito)
    const XFF = { 'X-Forwarded-For': '127.0.0.1' };
    // A) publicos necessarios (sem Station)
    for (const [m, t, ok] of [['GET', '/health', [200]], ['GET', '/', [200]], ['GET', '/station/discover', [200]], ['POST', '/station/pair', [400]]]) {
      const r = await plain(LAN, m, t, { body: m === 'POST' ? {} : undefined, headers: XFF });
      assert.ok(ok.includes(r.status), `${m} ${t} -> ${r.status}`);
    }
    // tudo o resto sem Station: 401 STATION_AUTH_REQUIRED (mesmo com XFF=127.0.0.1)
    for (const [m, t] of [['GET', '/saas/tenants'], ['GET', '/stations/server-settings'], ['GET', '/system/logs'], ['GET', '/serial-ports'], ['GET', '/backup/list'], ['GET', '/users'], ['GET', '/reports/sales'], ['GET', '/sync/status'], ['POST', '/customer-display/write'], ['GET', '/print-centers'], ['POST', '/setup/admin-password']]) {
      const r = await plain(LAN, m, t, { body: m === 'POST' ? {} : undefined, token: adminToken, headers: XFF });
      assert.equal(r.status, 401, `${m} ${t}`);
      assert.equal(r.code, 'STATION_AUTH_REQUIRED');
    }
    // B/C/D) Station + Operator (+ admin): permitido com Station assinada e sessao vinculada
    for (const t of ['/produtos', '/stations/server-settings', '/users', '/stations']) assert.equal((await via(cA, 'GET', t, { token: tokA })).status, 200, t);
    assert.equal((await via(cA, 'GET', '/produtos')).status, 401, 'Station sem sessao de operador');
    // E) loopback-only: uma Station admin emparelhada NAO chega (403 LOCAL_ONLY_OPERATION), mesmo com XFF forjado e TRUST_PROXY=true
    const E = [
      ['POST', '/setup/admin-password'], ['POST', '/setup/license/reset-local'], ['POST', '/setup/license/install-offline-license'], ['POST', '/setup/license/sync-registry'], ['POST', '/setup/license/activate'],
      ['POST', '/license/renew'], ['POST', '/auth/admin/reset-pin'],
      ['POST', '/maintenance/reset-database'], ['POST', '/backup/restore'], ['POST', '/backup/create'], ['GET', '/backup/list'], ['GET', '/maintenance/db-encryption-status'],
      ['POST', '/maintenance/db-recovery-key/export'], ['POST', '/maintenance/db-recovery-key/unwrap'], ['POST', '/sync/full-reset'], ['PATCH', '/stations/server-settings'], ['GET', '/saas/tenants'],
    ];
    for (const [m, t] of E) {
      const r = await via(cA, m, t, { body: m === 'GET' ? undefined : {}, token: tokA, headers: XFF });
      assert.equal(r.status, 403, `${m} ${t}`);
      assert.equal(r.code, 'LOCAL_ONLY_OPERATION', `${m} ${t}`);
    }
    // ... e no loopback do proprio Server (admin local) as leituras seguras continuam a funcionar
    assert.equal((await plain(LOCAL, 'GET', '/backup/list', { token: adminToken })).status, 200);
    assert.equal((await plain(LOCAL, 'GET', '/maintenance/db-encryption-status', { token: adminToken })).status, 200);
    assert.equal((await plain(LOCAL, 'PATCH', '/stations/server-settings', { token: adminToken, body: {} })).status, 200);

    // ---- 4. X-Station-* / stationCode forjados: identidade, papel e dono do lock so pela Station autenticada
    const codes = Object.fromEntries((await readDb(`SELECT id, code FROM stations`)).map((r) => [r.id, r.code]));
    assert.equal((await via(cA, 'POST', '/table-locks/claim', { token: tokA, body: { tableKey: 'L1', stationCode: 'caixa-1', station_code: 'x' }, headers: { 'X-Station-Code': 'caixa-1', 'X-Station-Role': 'cozinha', 'X-Station-Id': crypto.randomUUID() } })).status, 200);
    let lock = (await readDb(`SELECT station_code, station_id FROM table_locks WHERE table_key = 'L1'`))[0];
    assert.deepEqual([lock.station_code, lock.station_id], [codes[rA.stationId], rA.stationId]);
    // loopback do Server usa etiqueta local e NUNCA colide com a identidade emparelhada (station_id fica NULL)
    assert.equal((await plain(LOCAL, 'POST', '/table-locks/claim', { token: adminToken, body: { tableKey: 'L2', stationCode: codes[rA.stationId] } })).status, 200);
    lock = (await readDb(`SELECT station_code, station_id FROM table_locks WHERE table_key = 'L2'`))[0];
    assert.deepEqual([lock.station_code, lock.station_id], [codes[rA.stationId], null]);
    // a Station A nao herda um lock do loopback so por ter o mesmo codigo: o dono e outro (sem station_id)
    const rel = await via(cA, 'POST', '/table-locks/release', { token: tokA, body: { tableKey: 'L2', stationCode: codes[rA.stationId] } });
    assert.ok([200, 403, 409].includes(rel.status));
    // sessao do operador nao herda o papel de uma Station pela etiqueta: role de Station so vem da BD (req.station)
    const me = await via(cA, 'GET', '/stations', { token: tokA, headers: { 'X-Station-Role': 'admin' } });
    assert.equal(me.status, 200);

    // ---- 5. chaves retiradas e estados: activo autentica; disabled nao; revogada nunca volta (nem a mesma chave)
    const B1 = createStationIdentityStore({ userDataPath: dirB, safeStorage: ssB });
    const rB = await B1.pair({ serverUrl: LAN, expectedFingerprint: FP, code: (await mkPair('Caixa B')).code });
    const cB = createStationClient({ identityStore: B1 });
    assert.equal((await via(cB, 'GET', '/auth/login-users')).status, 200);
    assert.equal((await plain(LOCAL, 'POST', `/stations/${rB.stationId}/status`, { token: adminToken, body: { status: 'disabled' } })).status, 200);
    assert.equal((await via(cB, 'GET', '/auth/login-users')).status, 401, 'disabled nao autentica');
    // a mesma chave publica nao volta a emparelhar enquanto desactivada nem depois de revogada
    const pubB = B1.load().publicKey;
    const repair = async () => plain(LAN, 'POST', '/station/pair', { body: { code: (await mkPair('Clone B')).code, public_key: pubB, machine_id: 'PC-B' } });
    let r = await repair();
    assert.equal([r.status, r.code].join(':'), '409:PUBLIC_KEY_RETIRED');
    assert.equal((await plain(LOCAL, 'POST', `/stations/${rB.stationId}/status`, { token: adminToken, body: { status: 'active' } })).status, 200);
    assert.equal((await via(cB, 'GET', '/auth/login-users')).status, 200, 'reactivada volta a autenticar');
    assert.equal((await plain(LOCAL, 'POST', `/stations/${rB.stationId}/status`, { token: adminToken, body: { status: 'revoked' } })).status, 200);
    assert.equal((await via(cB, 'GET', '/auth/login-users')).status, 401);
    assert.equal((await plain(LOCAL, 'POST', `/stations/${rB.stationId}/status`, { token: adminToken, body: { status: 'active' } })).status, 409, 'revogada nunca reactiva');
    assert.equal((await plain(LOCAL, 'POST', `/stations/${rB.stationId}/status`, { token: adminToken, body: { status: 'disabled' } })).status, 409);
    assert.equal((await via(cB, 'GET', '/auth/login-users')).status, 401);
    r = await repair();
    assert.equal(r.code, 'PUBLIC_KEY_RETIRED');
    // reinstalacao da Station B: nova chave -> NOVA identidade (station_id diferente)
    fs.rmSync(dirB, { recursive: true, force: true });
    fs.mkdirSync(dirB, { recursive: true });
    const B2 = createStationIdentityStore({ userDataPath: dirB, safeStorage: fakeSafeStorage() });
    const rB2 = await B2.pair({ serverUrl: LAN, expectedFingerprint: FP, code: (await mkPair('Caixa B2')).code });
    assert.notEqual(rB2.stationId, rB.stationId);
    assert.notEqual(B2.load().publicKey, pubB);
    assert.equal((await via(createStationClient({ identityStore: B2 }), 'GET', '/auth/login-users')).status, 200);
    // ficheiro pending orfao (crash a meio do pairing) e limpo no arranque seguinte
    fs.writeFileSync(path.join(dirB, '.station-key.enc.pending'), 'lixo');
    createStationIdentityStore({ userDataPath: dirB, safeStorage: ssB });
    assert.equal(fs.existsSync(path.join(dirB, '.station-key.enc.pending')), false);

    // ---- 6. fail closed no cliente da Station
    const noId = createStationClient({ identityStore: createStationIdentityStore({ userDataPath: dirZ, safeStorage: fakeSafeStorage() }), allowedUnsignedOrigin: () => LAN });
    await assert.rejects(via(noId, 'GET', '/auth/login-users'), (e) => e.code === 'STATION_NOT_PAIRED');
    await assert.rejects(via(noId, 'GET', '/produtos', { token: tokA }), (e) => e.code === 'STATION_NOT_PAIRED');
    assert.equal((await via(noId, 'GET', '/station/discover')).status, 200, 'so descoberta/pairing/health sem identidade');
    ssA.state.available = false; // safeStorage deixa de estar seguro -> identidade inutilizavel, sem fallback
    await assert.rejects(via(cA, 'GET', '/produtos', { token: tokA }), (e) => e.code === 'STATION_NOT_PAIRED');
    ssA.state.available = true;
    await assert.rejects(createStationIdentityStore({ userDataPath: dirZ, safeStorage: fakeSafeStorage() }).pair({ serverUrl: 'ftp://x', expectedFingerprint: FP, code: '12345678' }), (e) => e.code === 'INVALID_SERVER_URL');
    await assert.rejects(createStationIdentityStore({ userDataPath: dirZ, safeStorage: fakeSafeStorage() }).pair({ serverUrl: 'https://user:pw@host', expectedFingerprint: FP, code: '12345678' }), (e) => e.code === 'INVALID_SERVER_URL');
  } finally {
    child.kill();
  }
});
