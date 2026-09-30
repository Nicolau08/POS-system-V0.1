/**
 * Etapa 1G.3.4 - Station Electron (processo main: identidade + cliente assinado) contra o Store Server REAL em LAN.
 * Duas "Stations" = dois perfis (userData) com safeStorage simulado por perfil (AES-GCM com chave propria do perfil, como o
 * DPAPI: outro perfil nao consegue decifrar). Tudo sem Internet/cloud/service_role. Salta se nao houver IPv4 LAN.
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
import { createStationIdentityStore, IDENTITY_FILE, KEY_FILE } from '../../electron/station/stationIdentity.js';
import { createStationClient } from '../../electron/station/stationClient.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const lcDir = path.join(repoRoot, 'license-console');
const lanIp = Object.values(os.networkInterfaces()).flat().find((i) => i && i.family === 'IPv4' && !i.internal)?.address;
const opts = { skip: !lanIp && 'sem IPv4 LAN nesta maquina' };
const TENANT = 'tenant-e2e-stationclient';
const MACHINE = getLocalMachineId();
const port = 4900 + Math.floor(Math.random() * 90);

/** safeStorage simulado: chave por PERFIL (como DPAPI por utilizador). */
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

test('Station Electron (2 identidades) <-> Store Server real em LAN', opts, async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'posly-client-e2e-'));
  const userData = path.join(tmp, 'server');
  fs.mkdirSync(userData, { recursive: true });
  const dbPath = path.join(tmp, 'database.db');
  const lic = gen({ v2: true, payload: { license_id: 'lic-cli', tenant_id: TENANT, machine_id: MACHINE, name: 'Loja Cli', store_id: 'store-cli', max_stations_per_store: 3 } });
  fs.writeFileSync(path.join(userData, 'offline-license.json'), JSON.stringify(lic.envelope));

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
  let lanFetch = null; // HTTPS com pin da fingerprint (a que o admin le no Server ao criar o pairing)
  let FP = null;
  const child = spawnServer();
  const readDb = (sql) => new Promise((resolve, reject) => {
    const sqlite = createRequire(import.meta.url)('@journeyapps/sqlcipher');
    const d = new sqlite.Database(dbPath, sqlite.OPEN_READONLY, (e) => {
      if (e) return reject(e);
      d.all(sql, (err, rows) => { d.close(); return err ? reject(err) : resolve(rows); });
    });
  });
  const plain = async (base, method, target, { body, token } = {}) => {
    const res = await (base === LAN ? lanFetch : fetch)(base + target, {
      method,
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = await res.json().catch(() => ({}));
    return { status: res.status, json, data: json.data ?? null, code: json.error?.code ?? json.code ?? null };
  };
  // pedido pelo cliente assinado da Station (e o que o renderer faz via IPC station:fetch)
  const viaStation = async (client, method, target, { body, token, headers = {} } = {}) => {
    const r = await client.request({
      url: LAN + target, method,
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
      body: body ? Buffer.from(JSON.stringify(body)) : null,
    });
    const json = (() => { try { return JSON.parse(r.body.toString('utf8')); } catch { return {}; } })();
    return { status: r.status, json, data: json.data ?? null, code: json.error?.code ?? json.code ?? null };
  };

  try {
    // servidor pronto + admin loopback + 2 pairings
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
    const mkPairing = async (name) => (await plain(LOCAL, 'POST', '/stations/pairings', { token: adminToken, body: { name, role: 'caixa' } })).data;
    const [pA, pB] = [await mkPairing('Caixa A'), await mkPairing('Caixa B')];
    FP = pA.certificate_fingerprint;
    lanFetch = createPinnedFetch({ fingerprint: FP });

    // --- perfis das duas Stations (userData + safeStorage por perfil)
    const dirA = path.join(tmp, 'stationA'); const dirB = path.join(tmp, 'stationB'); const dirC = path.join(tmp, 'stationC');
    for (const d of [dirA, dirB, dirC]) fs.mkdirSync(d, { recursive: true });
    const ssA = fakeSafeStorage(); const ssB = fakeSafeStorage(); const ssC = fakeSafeStorage();
    const storeA = () => createStationIdentityStore({ userDataPath: dirA, safeStorage: ssA });
    const storeB = () => createStationIdentityStore({ userDataPath: dirB, safeStorage: ssB });

    // 1) sem armazenamento seguro: falha fechada, nada em disco e o pairing NAO e gasto
    const insecure = createStationIdentityStore({ userDataPath: dirC, safeStorage: fakeSafeStorage({ available: false }) });
    await assert.rejects(insecure.pair({ serverUrl: LAN, expectedFingerprint: FP, code: pA.code }), (e) => e.code === 'SECURE_STORAGE_UNAVAILABLE');
    assert.deepEqual(fs.readdirSync(dirC), []);
    const linuxBasic = createStationIdentityStore({ userDataPath: dirC, safeStorage: { ...fakeSafeStorage(), getSelectedStorageBackend: () => 'basic_text' } });
    await assert.rejects(linuxBasic.pair({ serverUrl: LAN, expectedFingerprint: FP, code: pA.code }), (e) => e.code === 'SECURE_STORAGE_UNAVAILABLE');

    // 2) pairing falhado (codigo errado) nao deixa identidade parcial
    await assert.rejects(storeA().pair({ serverUrl: LAN, expectedFingerprint: FP, code: '00000000' }), (e) => e.code === 'PAIRING_REJECTED' && e.status === 401);
    assert.deepEqual(fs.readdirSync(dirA), [], 'sem ficheiros (nem pending) apos pairing falhado');
    await assert.rejects(storeA().pair({ serverUrl: 'https://127.0.0.1:1', expectedFingerprint: FP, code: pA.code }), (e) => e.code === 'SERVER_UNREACHABLE');
    assert.deepEqual(fs.readdirSync(dirA), []);

    // 3) pairing A e B (chaves e ids distintos); a chave privada nunca esta em claro em disco
    const rA = await storeA().pair({ serverUrl: LAN, expectedFingerprint: FP, code: pA.code, machineId: 'PC-A' });
    const rB = await storeB().pair({ serverUrl: LAN, expectedFingerprint: FP, code: pB.code, machineId: 'PC-B' });
    assert.notEqual(rA.stationId, rB.stationId);
    const idA = storeA().load(); const idB = storeB().load();
    assert.notEqual(idA.publicKey, idB.publicKey);
    const privA = idA.privateKey.export({ type: 'pkcs8', format: 'der' });
    for (const f of [IDENTITY_FILE, KEY_FILE]) {
      const raw = fs.readFileSync(path.join(dirA, f));
      assert.equal(raw.includes(privA.toString('base64')), false, `${f} sem chave privada em claro`);
      assert.equal(raw.includes(privA), false);
    }
    const meta = JSON.parse(fs.readFileSync(path.join(dirA, IDENTITY_FILE), 'utf8'));
    assert.deepEqual(Object.keys(meta).sort(), ['name', 'paired_at', 'public_key', 'role', 'server_fingerprint', 'server_url', 'station_code', 'station_id', 'version']);
    assert.equal((await readDb(`SELECT machine_id FROM stations WHERE id = '${rA.stationId}'`))[0].machine_id, 'PC-A');
    // codigo ja usado: recusado sem identidade
    await assert.rejects(createStationIdentityStore({ userDataPath: dirC, safeStorage: ssC }).pair({ serverUrl: LAN, expectedFingerprint: FP, code: pA.code }), (e) => e.code === 'PAIRING_REJECTED');
    assert.deepEqual(fs.readdirSync(dirC), []);
    await assert.rejects(storeA().pair({ serverUrl: LAN, expectedFingerprint: FP, code: pB.code }), (e) => e.code === 'ALREADY_PAIRED');

    // 4) pedidos assinados automaticos (GET/POST/query/body); login independente por Station
    const cA = createStationClient({ identityStore: storeA() });
    const cB = createStationClient({ identityStore: storeB() });
    assert.equal((await viaStation(cA, 'GET', '/auth/login-users?x=1&y=%C3%A1')).status, 200);
    const loginA = await viaStation(cA, 'POST', '/auth/login', { body: { userId: 'admin-local', enteredPin: '1234' } });
    const loginB = await viaStation(cB, 'POST', '/auth/login', { body: { userId: 'admin-local', enteredPin: '1234' } });
    const [tokA, tokB] = [loginA.json.token, loginB.json.token];
    assert.ok(tokA && tokB && tokA !== tokB);
    assert.ok(tokA.includes(rA.stationId) && tokB.includes(rB.stationId), 'tokens vinculados a cada Station');

    // 5) Operator Session Binding
    assert.equal((await viaStation(cA, 'GET', '/produtos?limit=5', { token: tokA })).status, 200, 'Bearer A + Station A');
    assert.equal((await viaStation(cB, 'GET', '/produtos', { token: tokA })).status, 401, 'Bearer A + Station B');
    assert.equal((await viaStation(cA, 'GET', '/produtos', { token: tokB })).status, 401, 'Bearer B + Station A');
    assert.equal((await plain(LAN, 'GET', '/produtos', { token: tokA })).status, 401, 'Bearer A sem Station');
    assert.equal((await plain(LOCAL, 'GET', '/produtos', { token: tokA })).status, 401, 'Bearer vinculado nao serve no loopback');
    assert.equal((await viaStation(cA, 'GET', '/produtos', { token: adminToken })).status, 401, 'Bearer do loopback (nao vinculado) nao serve numa Station');
    assert.equal((await viaStation(cB, 'GET', '/produtos', { token: tokB })).status, 200, 'B independente');
    // cabecalhos de etiqueta enviados pelo chamador sao removidos pelo cliente (nunca escolhem identidade)
    assert.equal((await viaStation(cA, 'GET', '/produtos', { token: tokA, headers: { 'X-Station-Id': rB.stationId, 'X-Station-Code': 'outra' } })).status, 200);

    // 6) propagacao: vendas e locks pela Station autenticada
    const prod = await plain(LOCAL, 'POST', '/produtos', { token: adminToken, body: { name: 'Produto Cli', price: 10, stock_quantity: 100 } });
    assert.equal(prod.status, 200, JSON.stringify(prod.json));
    const sale = (pid) => ({ total: 10, docType: 'VD', paymentMethod: 'dinheiro', cart: [{ id: pid, name: 'Produto Cli', quantity: 1, price: 10 }] });
    assert.equal((await viaStation(cA, 'POST', '/vendas', { token: tokA, body: sale(prod.data.id), headers: { 'X-Station-Code': 'forjado' } })).status, 200);
    assert.equal((await viaStation(cB, 'POST', '/vendas', { token: tokB, body: sale(prod.data.id) })).status, 200);
    assert.equal((await plain(LOCAL, 'POST', '/vendas', { token: adminToken, body: sale(prod.data.id) })).status, 200);
    const vendas = await readDb(`SELECT station_id FROM vendas ORDER BY id`);
    assert.deepEqual(vendas.map((v) => v.station_id), [rA.stationId, rB.stationId, null]);
    const codes = Object.fromEntries((await readDb(`SELECT id, code FROM stations`)).map((r) => [r.id, r.code]));
    assert.equal((await viaStation(cA, 'POST', '/table-locks/claim', { token: tokA, body: { tableKey: 'M9', stationCode: 'qualquer' } })).status, 200);
    assert.equal((await readDb(`SELECT station_code FROM table_locks WHERE table_key = 'M9'`))[0].station_code, codes[rA.stationId]);
    assert.equal((await viaStation(cB, 'POST', '/table-locks/claim', { token: tokB, body: { tableKey: 'M9', stationCode: codes[rA.stationId] } })).status, 200);
    assert.equal((await readDb(`SELECT station_code FROM table_locks WHERE table_key = 'M9'`))[0].station_code, codes[rB.stationId], 'B nao consegue fingir ser A no lock');

    // 7) setup/manutencao sensivel bloqueado para uma Station emparelhada (mesmo com sessao valida); leitura continua
    for (const [m, t] of [['POST', '/setup/admin-password'], ['POST', '/setup/license/reset-local'], ['POST', '/setup/license/install-offline-license'], ['POST', '/setup/license/sync-registry'], ['POST', '/maintenance/reset-database'], ['POST', '/backup/restore'], ['POST', '/sync/full-reset']]) {
      const r = await viaStation(cA, m, t, { token: tokA, body: { pin: '9999' } });
      assert.equal(r.status, 403, `${m} ${t}`);
      assert.equal(r.code, 'LOCAL_ONLY_OPERATION');
    }
    assert.equal((await viaStation(cA, 'GET', '/setup/status')).status, 200);
    assert.equal((await plain(LOCAL, 'POST', '/setup/license/install-offline-license', { body: { offline_license: lic.envelope, machine_id: MACHINE } })).status, 200, 'loopback continua a poder (idempotente)');

    // 8) restart da Station preserva identidade; perfil copiado sem chave / com outro safeStorage nao autentica
    const reloaded = createStationClient({ identityStore: storeA() });
    assert.equal((await viaStation(reloaded, 'GET', '/produtos', { token: tokA })).status, 200);
    fs.copyFileSync(path.join(dirA, IDENTITY_FILE), path.join(dirC, IDENTITY_FILE)); // so o JSON nao secreto (station-runtime/identity)
    const cC = createStationClient({ identityStore: createStationIdentityStore({ userDataPath: dirC, safeStorage: ssC }), allowedUnsignedOrigin: () => LAN });
    assert.equal(createStationIdentityStore({ userDataPath: dirC, safeStorage: ssC }).load(), null);
    await assert.rejects(viaStation(cC, 'GET', '/auth/login-users'), (e) => e.code === 'STATION_NOT_PAIRED'); // falha fechada (1G.3.5)
    fs.copyFileSync(path.join(dirA, KEY_FILE), path.join(dirC, KEY_FILE)); // chave cifrada copiada para outro perfil
    assert.equal(createStationIdentityStore({ userDataPath: dirC, safeStorage: ssC }).load(), null, 'outro perfil nao decifra');
    // ficheiros trocados (chave de B com identidade de A): recusado
    fs.copyFileSync(path.join(dirB, KEY_FILE), path.join(dirC, KEY_FILE));
    fs.writeFileSync(path.join(dirC, IDENTITY_FILE), fs.readFileSync(path.join(dirA, IDENTITY_FILE)));
    assert.equal(createStationIdentityStore({ userDataPath: dirC, safeStorage: ssB }).load(), null, 'chave nao corresponde a chave publica registada');

    // 9) relogio: STATION_CLOCK_SKEW -> offset em memoria e UMA repeticao com novo nonce/assinatura
    let calls = 0;
    const counting = async (u, init) => { calls += 1; return lanFetch(u, init); };
    const skewed = createStationClient({ identityStore: storeB(), fetchImpl: counting, now: () => Date.now() + 10 * 60 * 1000 });
    const rs = await viaStation(skewed, 'GET', '/produtos', { token: tokB });
    assert.equal(rs.status, 200);
    assert.equal(calls, 2, 'exactamente 1 repeticao');
    assert.ok(Math.abs(skewed.getOffsetMs() + 10 * 60 * 1000) < 5000, 'offset calculado a partir de server_time');
    calls = 0;
    const alwaysSkew = createStationClient({
      identityStore: storeB(),
      fetchImpl: async () => { calls += 1; return new Response(JSON.stringify({ success: false, error: { code: 'STATION_CLOCK_SKEW', data: { server_time: 1 } } }), { status: 401 }); },
    });
    const rsk = await viaStation(alwaysSkew, 'GET', '/produtos', { token: tokB });
    assert.equal(rsk.status, 401);
    assert.equal(calls, 2, 'nunca mais de uma repeticao');

    // 10) revogar A: proximo pedido falha; B nao e afectada; loopback continua
    assert.equal((await plain(LOCAL, 'POST', `/stations/${rA.stationId}/status`, { token: adminToken, body: { status: 'revoked' } })).status, 200);
    assert.equal((await viaStation(cA, 'GET', '/produtos', { token: tokA })).status, 401);
    assert.equal((await viaStation(cB, 'GET', '/produtos', { token: tokB })).status, 200);
    assert.equal((await plain(LOCAL, 'GET', '/produtos', { token: adminToken })).status, 200);

    // 11) pedido para outro servidor com identidade: recusado (nao envia assinaturas para fora)
    await assert.rejects(cB.request({ url: 'https://example.invalid/x', method: 'GET' }), (e) => e.code === 'STATION_ORIGIN_MISMATCH');
  } finally {
    child.kill();
  }
});
