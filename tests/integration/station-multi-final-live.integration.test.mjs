/**
 * Etapa 1G.3-FINAL - cenario ponta-a-ponta como UM sistema: licenca v2 emitida pelo license-console REAL (Device JWT) ->
 * Store Server (LAN so HTTPS, TRUST_PROXY=true) -> pairing com fingerprint -> Station A e B (Ed25519 + pin) -> Bearer vinculado
 * -> vendas simultaneas/locks/spoof -> restart Station e Server -> revogar A -> Internet ON (Device Auth + Postgres reais):
 * sync sem duplicacao, station_code preservado e reconciliacao do stock.
 * Env: POSLY_F33_ISSUER_URL, _TENANT_ID, _LICENSE_ID, _ACTIVATION_TOKEN, _SUPABASE_URL, _SUPABASE_ANON_KEY,
 *      _SUPABASE_SERVICE_ROLE_KEY, _OFFLINE_PUBLIC_KEY, _OFFLINE_KEY_ID.   Correr com --experimental-test-module-mocks.
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { test, mock } from 'node:test';
import { createClient } from '@supabase/supabase-js';

const E = (k) => process.env[`POSLY_F33_${k}`] || '';
const run = Boolean(E('ISSUER_URL') && E('TENANT_ID') && E('LICENSE_ID') && E('ACTIVATION_TOKEN') && E('SUPABASE_URL') && E('SUPABASE_ANON_KEY') && E('SUPABASE_SERVICE_ROLE_KEY') && E('OFFLINE_PUBLIC_KEY'));
const lanIp = Object.values(os.networkInterfaces()).flat().find((i) => i && i.family === 'IPv4' && !i.internal)?.address;

mock.module('electron', {
  exports: {
    safeStorage: {
      isEncryptionAvailable: () => true,
      encryptString: (s) => Buffer.concat([Buffer.from('FAKEENC:'), Buffer.from(s, 'utf8')]),
      decryptString: (b) => Buffer.from(b).subarray(8).toString('utf8'),
    },
  },
});

const repoRoot = path.resolve(import.meta.dirname, '../..');
function fakeSafeStorage() {
  const secret = crypto.randomBytes(32);
  return {
    isEncryptionAvailable: () => true,
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

test('1G.3-FINAL: Server + Station A/B offline (LAN HTTPS) -> restart -> revogar A -> Internet ON: sync consistente', { skip: (!run || !lanIp) && 'defina POSLY_F33_* e tenha IPv4 LAN' }, async () => {
  const { bootstrapDevice } = await import('../../electron/deviceAuth/deviceAuthClient.js');
  const { requestOfflineLicense, installOfflineLicense } = await import('../../electron/deviceAuth/offlineLicenseClient.js');
  const { startDeviceAuthBridge, stopDeviceAuthBridge } = await import('../../electron/deviceAuth/deviceAuthBridge.js');
  const { getLocalMachineId } = await import('../../lib/licensing/localMachineId.js');
  const { createStationIdentityStore, parsePairingToken } = await import('../../electron/station/stationIdentity.js');
  const { createStationClient } = await import('../../electron/station/stationClient.js');
  const { createPinnedFetch } = await import('../../electron/station/pinnedHttps.js');

  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'posly-f33-'));
  const dbPath = path.join(userData, 'database.db');
  const TENANT = E('TENANT_ID');
  const port = 5500 + Math.floor(Math.random() * 90);
  const LOCAL = `http://127.0.0.1:${port}`;
  const LAN = `https://${lanIp}:${port}`;
  const children = [];
  let bridge = null;
  const resolvePem = (kid) => (kid === E('OFFLINE_KEY_ID') ? E('OFFLINE_PUBLIC_KEY') : null);

  const spawnServer = (extra = {}) => {
    const env = {
      ...process.env, POS_API_PORT: String(port), NODE_ENV: 'development', POS_DB_PATH: dbPath, POS_USER_DATA_PATH: userData, DEFAULT_TENANT_ID: TENANT,
      POS_API_BIND: '0.0.0.0', POS_LAN_ACCESS: '1', POS_TLS_ALLOW_PLAINTEXT_DEV: '1', TRUST_PROXY: 'true',
      POS_DEV_OFFLINE_LICENSE_KEY_ID: E('OFFLINE_KEY_ID'), POS_DEV_OFFLINE_LICENSE_PUBLIC_KEY: E('OFFLINE_PUBLIC_KEY'),
    };
    for (const k of ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'POS_DEVICE_AUTH_BRIDGE_URL', 'POS_DEVICE_AUTH_BRIDGE_SECRET', 'POS_LICENSE_HMAC_SECRET']) delete env[k];
    Object.assign(env, extra);
    const c = spawn(process.execPath, [path.join(repoRoot, 'api', 'server.js')], { cwd: repoRoot, env, stdio: ['ignore', 'pipe', 'pipe'] });
    c.stdout.on('data', () => {});
    c.stderr.on('data', () => {});
    children.push(c);
    return c;
  };
  const waitUp = async () => {
    for (let i = 0; i < 120; i += 1) {
      try { if ((await fetch(`${LOCAL}/health`)).ok) return; } catch { /* a arrancar */ }
      await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error('servidor nao arrancou');
  };
  const kill = async (c) => { c.kill(); await new Promise((r) => c.once('exit', r)); };
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
    throw new Error('login admin');
  };
  const call = async (client, method, target, { body, token, headers = {} } = {}) => {
    const r = await client.request({ url: LAN + target, method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers }, body: body ? Buffer.from(JSON.stringify(body)) : null });
    let json = {};
    try { json = JSON.parse(r.body.toString('utf8')); } catch { /* nao JSON */ }
    return { status: r.status, json, data: json.data ?? null, code: json.error?.code ?? json.code ?? null };
  };
  const readDb = (sql) => new Promise((resolve, reject) => {
    const sqlite = createRequire(import.meta.url)('@journeyapps/sqlcipher');
    const d = new sqlite.Database(dbPath, sqlite.OPEN_READONLY, (e) => {
      if (e) return reject(e);
      d.all(sql, (err, rows) => { d.close(); return err ? reject(err) : resolve(rows); });
    });
  });

  try {
    // ---- 0) TRUST CHAIN: licenca v2 emitida pelo emissor REAL a este device (Store do device, limite explicito)
    const machineId = getLocalMachineId();
    const boot = await bootstrapDevice({ activationToken: E('ACTIVATION_TOKEN'), machineId, userDataPath: userData, issuerBaseUrl: E('ISSUER_URL') });
    assert.equal(boot.ok, true, JSON.stringify(boot));
    const issuance = await requestOfflineLicense({ accessToken: boot.accessToken, issuerBaseUrl: E('ISSUER_URL') });
    assert.equal(issuance.ok, true, JSON.stringify(issuance));
    assert.equal(issuance.envelope.version, 2);
    assert.ok(issuance.envelope.payload.store_id);
    assert.equal(issuance.envelope.payload.max_stations_per_store, null, 'ilimitado EXPLICITO assinado');
    const inst = installOfflineLicense({ envelope: issuance.envelope, userDataPath: userData, resolvePublicKeyPem: resolvePem, machineId });
    assert.equal(inst.ok, true);

    // ---- 1) OFFLINE: Server LAN HTTPS, sem Supabase/bridge
    let server = spawnServer();
    await waitUp();
    assert.equal((await local('POST', '/setup/license/install-offline-license', { body: { offline_license: issuance.envelope, machine_id: machineId } })).status, 200);
    assert.equal((await local('POST', '/setup/admin-password', { body: { pin: '1234' } })).status, 200);
    let admin = await adminLogin();
    const mkPair = async (name) => (await local('POST', '/stations/pairings', { token: admin, body: { name, role: 'caixa' } })).data;
    const [pA, pB] = [await mkPair('Caixa A'), await mkPair('Caixa B')];
    const dirs = { A: path.join(userData, 'stA'), B: path.join(userData, 'stB') };
    for (const d of Object.values(dirs)) fs.mkdirSync(d, { recursive: true });
    const ss = { A: fakeSafeStorage(), B: fakeSafeStorage() };
    const store = (k) => createStationIdentityStore({ userDataPath: dirs[k], safeStorage: ss[k] });
    const rA = await store('A').pair({ serverUrl: LAN, code: parsePairingToken(pA.pairing_token).code, expectedFingerprint: parsePairingToken(pA.pairing_token).fingerprint });
    const rB = await store('B').pair({ serverUrl: LAN, code: parsePairingToken(pB.pairing_token).code, expectedFingerprint: parsePairingToken(pB.pairing_token).fingerprint });
    let cA = createStationClient({ identityStore: store('A') });
    const cB = createStationClient({ identityStore: store('B') });
    const tokA = (await call(cA, 'POST', '/auth/login', { body: { userId: 'admin-local', enteredPin: '1234' } })).json.token;
    const tokB = (await call(cB, 'POST', '/auth/login', { body: { userId: 'admin-local', enteredPin: '1234' } })).json.token;
    assert.ok(tokA && tokB);

    // operator binding (5 casos)
    assert.equal((await call(cA, 'GET', '/produtos', { token: tokA })).status, 200, 'Station A + Bearer A');
    assert.equal((await call(cB, 'GET', '/produtos', { token: tokA })).status, 401, 'Station B + Bearer A');
    const lanPinned = createPinnedFetch({ fingerprint: parsePairingToken(pA.pairing_token).fingerprint });
    assert.equal((await lanPinned(`${LAN}/produtos`, { headers: { Authorization: `Bearer ${tokA}` } })).status, 401, 'sem Station (remoto) + Bearer A');
    assert.equal((await call(cA, 'GET', '/produtos', { token: admin })).status, 401, 'Bearer do loopback numa Station');
    assert.equal((await local('GET', '/produtos', { token: tokA })).status, 401, 'Bearer de Station no loopback');

    // vendas A/B (sequenciais + simultaneas), locks, spoof
    const prod = await local('POST', '/produtos', { token: admin, body: { name: 'Produto F33', price: 10, stock_quantity: 100 } });
    assert.equal(prod.status, 200, JSON.stringify(prod.json));
    const pid = prod.data.id;
    const sale = (q) => ({ total: 10 * q, docType: 'VD', paymentMethod: 'dinheiro', cart: [{ id: pid, name: 'Produto F33', quantity: q, price: 10 }] });
    assert.equal((await call(cA, 'POST', '/vendas', { token: tokA, body: sale(1), headers: { 'X-Station-Code': 'forjado', 'X-Station-Id': rB.stationId } })).status, 200);
    assert.equal((await call(cB, 'POST', '/vendas', { token: tokB, body: sale(2) })).status, 200);
    const burst = await Promise.all([1, 2, 3, 4, 5, 6].map((i) => (i % 2 ? call(cA, 'POST', '/vendas', { token: tokA, body: sale(1) }) : call(cB, 'POST', '/vendas', { token: tokB, body: sale(1) }))));
    assert.ok(burst.every((r) => r.status === 200), JSON.stringify(burst.map((r) => [r.status, r.json])));
    const codes = Object.fromEntries((await readDb(`SELECT id, code FROM stations`)).map((r) => [r.id, r.code]));
    assert.equal((await call(cA, 'POST', '/table-locks/claim', { token: tokA, body: { tableKey: 'F1', stationCode: codes[rB.stationId] } })).status, 200);
    assert.equal((await readDb(`SELECT station_id FROM table_locks WHERE table_key = 'F1'`))[0].station_id, rA.stationId, 'lock no nome da Station autenticada, nunca do corpo');

    // restart da Station A e do Server: continuam
    cA = createStationClient({ identityStore: store('A') });
    assert.equal((await call(cA, 'POST', '/vendas', { token: tokA, body: sale(1) })).status, 200, 'restart da Station A preserva identidade');
    await kill(server);
    server = spawnServer();
    await waitUp();
    admin = await adminLogin();
    assert.equal((await call(cA, 'GET', '/produtos', { token: tokA })).status, 200, 'restart do Server: mesma fingerprint, Station A continua');
    assert.equal((await call(cB, 'POST', '/vendas', { token: tokB, body: sale(1) })).status, 200);
    // A: 5 unid., B: 6 unid.

    // revogar A: A para ja; B continua
    assert.equal((await local('POST', `/stations/${rA.stationId}/status`, { token: admin, body: { status: 'revoked' } })).status, 200);
    assert.equal((await call(cA, 'POST', '/vendas', { token: tokA, body: sale(1) })).status, 401);
    assert.equal((await call(cB, 'POST', '/vendas', { token: tokB, body: sale(1) })).status, 200);
    // 11 vendas (A=5, B=6) e 12 unidades (a 1.a venda de B leva 2)

    // consistencia local (Internet OFF)
    const vendas = await readDb(`SELECT station_id FROM vendas ORDER BY id`);
    const byStation = (id) => vendas.filter((v) => v.station_id === id).length;
    assert.deepEqual([byStation(rA.stationId), byStation(rB.stationId), vendas.filter((v) => !v.station_id).length], [5, 6, 0]);
    const localProd = (await local('GET', '/produtos', { token: admin })).data.find((p) => String(p.id) === String(pid));
    assert.equal(Number(localProd.stock_quantity), 100 - 12, 'stock local = 100 - vendido');
    const queued = await readDb(`SELECT COUNT(*) AS n FROM sync_queue WHERE type = 'sale'`);
    assert.equal(queued[0].n, 11, 'uma entrada de sync por venda (5 de A + 6 de B)');
    await kill(server);

    // ---- 2) INTERNET ON: Device Auth real + Postgres real
    bridge = await startDeviceAuthBridge({ userDataPath: userData, issuerBaseUrl: E('ISSUER_URL') });
    server = spawnServer({ SUPABASE_URL: E('SUPABASE_URL'), SUPABASE_ANON_KEY: E('SUPABASE_ANON_KEY'), POS_DEVICE_AUTH_BRIDGE_URL: bridge.url, POS_DEVICE_AUTH_BRIDGE_SECRET: bridge.secret, SYNC_INTERVAL_MS: '3000000' });
    await waitUp();
    admin = await adminLogin();
    for (let i = 0; i < 3; i += 1) {
      assert.equal((await local('POST', '/sync/run', { token: admin })).status, 200);
      await new Promise((r) => setTimeout(r, 1500));
    }
    const svc = createClient(E('SUPABASE_URL'), E('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });
    const { data: orders } = await svc.from('orders').select('id, station_code, store_id').eq('tenant_id', TENANT);
    assert.equal(orders.length, 11, `11 orders no cloud sem duplicacao (veio ${orders.length})`);
    const cnt = (code) => orders.filter((o) => o.station_code === code).length;
    assert.deepEqual([cnt(codes[rA.stationId]), cnt(codes[rB.stationId])], [5, 6], 'station_code autenticado preservado no cloud (A=5, B=6)');
    assert.equal(orders.some((o) => o.station_code === 'forjado'), false, 'label forjado nunca chegou ao cloud');
    assert.equal(new Set(orders.map((o) => o.store_id)).size, 1, 'todas na Store do device');
    const rec = await local('GET', '/sync/stock-reconciliation', { token: admin });
    assert.equal(rec.status, 200, JSON.stringify(rec.json));
    const reports = rec.data.reports ?? rec.data;
    assert.equal(reports[0].divergent_count, 0, `reconciliacao stock local vs ledger cloud: ${JSON.stringify(reports[0].divergent)}`);
    // idempotencia do sync
    assert.equal((await local('POST', '/sync/run', { token: admin })).status, 200);
    await new Promise((r) => setTimeout(r, 1500));
    assert.equal((await svc.from('orders').select('id', { count: 'exact', head: true }).eq('tenant_id', TENANT)).count, 11);
  } finally {
    for (const c of children) {
      try { c.kill('SIGKILL'); } catch { /* ja terminou */ }
    }
    if (bridge) {
      try { await stopDeviceAuthBridge(bridge); } catch { /* ignore */ }
    }
  }
});
