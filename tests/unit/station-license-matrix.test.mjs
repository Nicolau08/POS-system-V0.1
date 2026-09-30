/**
 * Etapa 1G.3-FINAL - limites de licenca no Store Server REAL (offline, LAN HTTPS com pin): max=0/1/2/3/null, ultimo slot em
 * concorrencia, v1, expirada, maquina errada, e o comportamento EXACTO das Stations ja activas quando a licenca muda
 * (documenta o comportamento actual; nao inventa politica nova).
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { getLocalMachineId } from '../../lib/licensing/localMachineId.js';
import { createPinnedFetch } from '../../electron/station/pinnedHttps.js';
import { createStationIdentityStore, parsePairingToken } from '../../electron/station/stationIdentity.js';
import { createStationClient } from '../../electron/station/stationClient.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const lcDir = path.join(repoRoot, 'license-console');
const lanIp = Object.values(os.networkInterfaces()).flat().find((i) => i && i.family === 'IPv4' && !i.internal)?.address;
const opts = { skip: !lanIp && 'sem IPv4 LAN' };
const MACHINE = getLocalMachineId();

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
function gen(o) {
  const r = spawnSync(process.execPath, ['--experimental-strip-types', path.join(lcDir, 'scripts', 'gen-offline-license-fixture.mjs'), JSON.stringify(o)], { cwd: lcDir, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}

/** Um Store Server real (BD nova) por cenario. */
async function withServer(name, fn) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `posly-lic-${name}-`));
  const userData = path.join(tmp, 'server');
  fs.mkdirSync(userData, { recursive: true });
  const TENANT = `tenant-lic-${name}`;
  const port = 5700 + Math.floor(Math.random() * 200);
  const base = gen({ v2: true, payload: { license_id: `lic-${name}`, tenant_id: TENANT, machine_id: MACHINE, name: 'Loja Lic', store_id: 'store-lic', max_stations_per_store: null } });
  const licFile = path.join(userData, 'offline-license.json');
  const writeLic = (o) => {
    const f = gen({ ...o, reuseKeyPair: { privateKeyPem: base.privateKeyPem, publicKeyPem: base.publicKeyPem }, keyId: base.keyId });
    fs.writeFileSync(licFile, JSON.stringify(f.envelope));
    return f;
  };
  const v2 = (max, extra = {}) => writeLic({ v2: true, payload: { license_id: `lic-${name}`, tenant_id: TENANT, machine_id: MACHINE, name: 'Loja Lic', store_id: 'store-lic', max_stations_per_store: max, ...extra } });
  const v1 = () => writeLic({ payload: { license_id: `lic-${name}`, tenant_id: TENANT, machine_id: MACHINE, name: 'Loja Lic' } });
  const first = v2(null);
  const env = {
    ...process.env, POS_API_PORT: String(port), NODE_ENV: 'development', POS_DB_PATH: path.join(tmp, 'db.db'), POS_USER_DATA_PATH: userData, DEFAULT_TENANT_ID: TENANT,
    POS_API_BIND: '0.0.0.0', POS_LAN_ACCESS: '1', POS_TLS_ALLOW_PLAINTEXT_DEV: '1', POS_DEV_OFFLINE_LICENSE_KEY_ID: base.keyId, POS_DEV_OFFLINE_LICENSE_PUBLIC_KEY: base.publicKeyPem,
  };
  for (const k of ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'POS_DEVICE_AUTH_BRIDGE_URL', 'POS_LICENSE_HMAC_SECRET', 'TRUST_PROXY']) delete env[k];
  const child = spawn(process.execPath, [path.join(repoRoot, 'api', 'server.js')], { cwd: repoRoot, env, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', () => {});
  child.stderr.on('data', () => {});
  const LOCAL = `http://127.0.0.1:${port}`;
  const LAN = `https://${lanIp}:${port}`;
  try {
    for (let i = 0; i < 120; i += 1) {
      try { if ((await fetch(`${LOCAL}/health`)).ok) break; } catch { /* a arrancar */ }
      await new Promise((r) => setTimeout(r, 250));
    }
    const local = async (method, target, { body, token } = {}) => {
      const res = await fetch(LOCAL + target, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
      const json = await res.json().catch(() => ({}));
      return { status: res.status, json, data: json.data ?? null, code: json.error?.code ?? json.code ?? null };
    };
    assert.equal((await local('POST', '/setup/license/install-offline-license', { body: { offline_license: first.envelope, machine_id: MACHINE } })).status, 200);
    assert.equal((await local('POST', '/setup/admin-password', { body: { pin: '1234' } })).status, 200);
    let admin = null;
    for (let i = 0; i < 15 && !admin; i += 1) {
      admin = (await local('POST', '/auth/login', { body: { userId: 'admin-local', enteredPin: '1234' } })).json.token ?? null;
      if (!admin) await new Promise((r) => setTimeout(r, 1000));
    }
    const mkPairing = (n) => local('POST', '/stations/pairings', { token: admin, body: { name: n, role: 'caixa' } });
    let stationSeq = 0;
    const newStation = async (pairingRes) => {
      const dir = path.join(tmp, `st${(stationSeq += 1)}`);
      fs.mkdirSync(dir, { recursive: true });
      const store = createStationIdentityStore({ userDataPath: dir, safeStorage: fakeSafeStorage() });
      const tok = parsePairingToken(pairingRes.data.pairing_token);
      await store.pair({ serverUrl: LAN, code: tok.code, expectedFingerprint: tok.fingerprint });
      return createStationClient({ identityStore: store });
    };
    const stationCall = async (client, method, target, token) => {
      const r = await client.request({ url: LAN + target, method, headers: token ? { Authorization: `Bearer ${token}` } : {}, body: null });
      let json = {};
      try { json = JSON.parse(r.body.toString('utf8')); } catch { /* nao JSON */ }
      return { status: r.status, json, code: json.error?.code ?? json.code ?? null };
    };
    return await fn({ local, admin: () => admin, mkPairing, newStation, stationCall, v2, v1, LAN, LOCAL, tmp, userData, stationsDb: () => local('GET', '/stations', { token: admin }) });
  } finally {
    child.kill();
  }
}

test('limites offline: max=0 nega; max=1/2/3 permitem exactamente N; null explicito = ilimitado', opts, async () => {
  await withServer('zero', async (s) => {
    s.v2(0);
    const p = await s.mkPairing('Posto X');
    assert.deepEqual([p.status, p.code], [403, 'STATION_LIMIT_ZERO'], JSON.stringify(p.json));
  });
  await withServer('n', async (s) => {
    for (const max of [1, 2, 3]) {
      s.v2(max);
      const active = (await s.stationsDb()).data.filter((x) => x.identity_valid).length;
      for (let i = active; i < max; i += 1) {
        const p = await s.mkPairing(`S${max}-${i}`);
        assert.equal(p.status, 201, `max=${max} i=${i}`);
        await s.newStation(p);
      }
      const extra = await s.mkPairing('extra');
      assert.deepEqual([extra.status, extra.code], [403, 'STATION_LIMIT_REACHED'], `max=${max}`);
      assert.equal((await s.stationsDb()).data.filter((x) => x.identity_valid).length, max);
    }
  });
  await withServer('null', async (s) => {
    s.v2(null);
    for (let i = 0; i < 6; i += 1) {
      const p = await s.mkPairing(`U${i}`);
      assert.equal(p.status, 201);
      await s.newStation(p);
    }
    assert.equal((await s.stationsDb()).data.filter((x) => x.identity_valid).length, 6);
  });
});

test('ultimo slot em concorrencia (HTTPS): dois pairings validos, max=1 -> exactamente uma Station', opts, async () => {
  await withServer('race', async (s) => {
    s.v2(1);
    const [p1, p2] = [await s.mkPairing('R1'), await s.mkPairing('R2')];
    assert.deepEqual([p1.status, p2.status], [201, 201]);
    const res = await Promise.allSettled([s.newStation(p1), s.newStation(p2)]);
    assert.equal(res.filter((r) => r.status === 'fulfilled').length, 1, JSON.stringify(res.map((r) => r.status)));
    assert.equal((await s.stationsDb()).data.filter((x) => x.identity_valid).length, 1);
    const loser = res.find((r) => r.status === 'rejected').reason;
    assert.equal(loser.serverCode, 'STATION_LIMIT_REACHED');
  });
});

test('v1, licenca expirada e maquina errada nunca autorizam novo pairing', opts, async () => {
  await withServer('bad', async (s) => {
    s.v1();
    assert.deepEqual((({ status, code }) => [status, code])(await s.mkPairing('Posto a')), [403, 'LICENSE_V1_NO_STATION_ENTITLEMENT']);
    s.v2(5, { expires_at: new Date(Date.now() - 1000).toISOString() });
    assert.deepEqual((({ status, code }) => [status, code])(await s.mkPairing('Posto b')), [403, 'LICENSE_INVALID']);
    s.v2(5, { machine_id: 'outra-maquina' });
    assert.deepEqual((({ status, code }) => [status, code])(await s.mkPairing('Posto c')), [403, 'LICENSE_INVALID']);
    fs.unlinkSync(path.join(s.userData, 'offline-license.json'));
    assert.deepEqual((({ status, code }) => [status, code])(await s.mkPairing('Posto d')), [403, 'LICENSE_INVALID']);
    s.v2(5);
    assert.equal((await s.mkPairing('Posto ok')).status, 201, 'licenca boa volta a permitir');
  });
});

test('Stations JA activas quando a licenca muda: comportamento actual (documentado)', opts, async () => {
  await withServer('active', async (s) => {
    s.v2(3);
    const clients = [];
    const tokens = [];
    for (let i = 0; i < 3; i += 1) clients.push(await s.newStation(await s.mkPairing(`A${i}`)));
    for (const c of clients) {
      const r = await s.stationCall(c, 'GET', '/auth/login-users');
      assert.equal(r.status, 200);
    }
    // (a) limite REDUZIDO 3 -> 1: as 3 Stations activas continuam a autenticar (o gate de Station nao consulta a licenca);
    //     so novos pairings e reactivacoes ficam bloqueados.
    s.v2(1);
    for (const c of clients) assert.equal((await s.stationCall(c, 'GET', '/auth/login-users')).status, 200);
    assert.equal((await s.mkPairing('novo')).code, 'STATION_LIMIT_REACHED');
    const list = (await s.stationsDb()).data;
    const first = list.find((x) => x.identity_valid);
    assert.equal((await s.local('POST', `/stations/${first.id}/status`, { token: s.admin(), body: { status: 'disabled' } })).status, 200);
    assert.equal((await s.local('POST', `/stations/${first.id}/status`, { token: s.admin(), body: { status: 'active' } })).code, 'STATION_LIMIT_REACHED', 'reactivar acima do limite e recusado');
    // (b) licenca v1 / expirada / removida: as Stations activas continuam a autenticar; pairing/reactivacao bloqueados
    for (const swap of [() => s.v1(), () => s.v2(3, { expires_at: new Date(Date.now() - 1000).toISOString() }), () => fs.unlinkSync(path.join(s.userData, 'offline-license.json'))]) {
      swap();
      const stationStatuses = [];
      for (const c of clients.slice(1)) stationStatuses.push((await s.stationCall(c, 'GET', '/auth/login-users')).status);
      assert.deepEqual(stationStatuses, [200, 200], 'Stations activas nao sao desligadas por mudanca da licenca offline');
      assert.equal((await s.mkPairing('nao')).status, 403);
    }
  });
});
