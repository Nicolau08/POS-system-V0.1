/**
 * Etapa 1G.3.6 - smoke com ELECTRON REAL (processo main + safeStorage/DPAPI reais), sem UI:
 *   npx electron scripts/electron-station-smoke.mjs      (ou node_modules/electron/dist/electron.exe scripts/electron-station-smoke.mjs)
 * Valida: identidade TLS do Server guardada com safeStorage real (fingerprint estavel entre reinicios), Store Server a
 * servir HTTPS na LAN, pairing da Station com pin, fetch assinado, login, uma venda e restart (Station e Server).
 * Usa userData temporario; nao toca em dados reais. Sai com codigo 0 (ok) ou 1 (falha).
 */
import { app, safeStorage } from 'electron';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'posly-electron-smoke-'));
app.setPath('userData', path.join(tmp, 'electron-userdata'));
const log = (...a) => console.log('[smoke]', ...a);

async function main() {
  await app.whenReady();
  const { getOrCreateServerTlsIdentity } = await import('../electron/serverTlsIdentity.js');
  const { createStationIdentityStore, parsePairingToken } = await import('../electron/station/stationIdentity.js');
  const { createStationClient } = await import('../electron/station/stationClient.js');
  const { getLocalMachineId } = await import('../lib/licensing/localMachineId.js');
  const { normalizeFingerprint } = await import('../lib/tls/serverCertificate.js');

  assert.equal(safeStorage.isEncryptionAvailable(), true, 'safeStorage real disponivel');
  log('safeStorage real:', safeStorage.isEncryptionAvailable(), 'backend:', typeof safeStorage.getSelectedStorageBackend === 'function' ? safeStorage.getSelectedStorageBackend() : 'n/a (Windows DPAPI)');

  const lanIp = Object.values(os.networkInterfaces()).flat().find((i) => i && i.family === 'IPv4' && !i.internal)?.address;
  assert.ok(lanIp, 'IPv4 LAN necessario');
  const serverData = path.join(tmp, 'server');
  fs.mkdirSync(serverData, { recursive: true });

  // 1) identidade TLS do Server via safeStorage REAL (o que o main.js faz antes de arrancar a API)
  const tls1 = await getOrCreateServerTlsIdentity({ userDataPath: serverData, safeStorage });
  assert.ok(tls1 && tls1.created, 'identidade TLS criada');
  const keyFileRaw = fs.readFileSync(path.join(serverData, 'tls', 'server-key.enc'));
  assert.equal(keyFileRaw.includes('PRIVATE KEY'), false, 'chave TLS so cifrada (DPAPI) em disco');
  const tls2 = await getOrCreateServerTlsIdentity({ userDataPath: serverData, safeStorage });
  assert.equal(tls2.fingerprint, tls1.fingerprint, 'fingerprint estavel entre reinicios');

  // 2) Store Server real (processo node) com o certificado injectado, so HTTPS na LAN
  const TENANT = 'tenant-electron-smoke';
  const lcDir = path.join(repoRoot, 'license-console');
  const fx = spawnSync('node', ['--experimental-strip-types', path.join(lcDir, 'scripts', 'gen-offline-license-fixture.mjs'), JSON.stringify({ v2: true, payload: { license_id: 'lic-smoke', tenant_id: TENANT, machine_id: getLocalMachineId(), name: 'Loja Smoke', store_id: 'store-smoke', max_stations_per_store: 3 } })], { cwd: lcDir, encoding: 'utf8' });
  assert.equal(fx.status, 0, fx.stderr);
  const lic = JSON.parse(fx.stdout);
  fs.writeFileSync(path.join(serverData, 'offline-license.json'), JSON.stringify(lic.envelope));
  const port = 5400 + Math.floor(Math.random() * 90);
  const dbPath = path.join(tmp, 'server.db');
  const startServer = async () => {
    const env = {
      ...process.env, ELECTRON_RUN_AS_NODE: undefined, POS_API_PORT: String(port), NODE_ENV: 'development', POS_DB_PATH: dbPath, POS_USER_DATA_PATH: serverData, DEFAULT_TENANT_ID: TENANT,
      POS_API_BIND: '0.0.0.0', POS_LAN_ACCESS: '1', POS_TLS_CERT_PEM: tls1.certPem, POS_TLS_KEY_PEM: tls1.keyPem,
      POS_DEV_OFFLINE_LICENSE_KEY_ID: lic.keyId, POS_DEV_OFFLINE_LICENSE_PUBLIC_KEY: lic.publicKeyPem,
    };
    for (const k of ['ELECTRON_RUN_AS_NODE', 'SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'POS_DEVICE_AUTH_BRIDGE_URL', 'POS_LICENSE_HMAC_SECRET', 'TRUST_PROXY']) delete env[k];
    const c = spawn('node', [path.join(repoRoot, 'api', 'server.js')], { cwd: repoRoot, env, stdio: ['ignore', 'ignore', 'ignore'] });
    for (let i = 0; i < 120; i += 1) {
      try { if ((await fetch(`http://127.0.0.1:${port}/health`)).ok) return c; } catch { /* a arrancar */ }
      await new Promise((r) => setTimeout(r, 250));
    }
    c.kill();
    throw new Error('Store Server nao arrancou');
  };
  const LOCAL = `http://127.0.0.1:${port}`;
  const LAN = `https://${lanIp}:${port}`;
  const local = async (method, target, { body, token } = {}) => {
    const res = await fetch(LOCAL + target, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, json: await res.json().catch(() => ({})) };
  };
  let server = await startServer();
  try {
    assert.equal((await local('POST', '/setup/license/install-offline-license', { body: { offline_license: lic.envelope, machine_id: getLocalMachineId() } })).status, 200);
    assert.equal((await local('POST', '/setup/admin-password', { body: { pin: '1234' } })).status, 200);
    let admin = null;
    for (let i = 0; i < 15 && !admin; i += 1) {
      admin = (await local('POST', '/auth/login', { body: { userId: 'admin-local', enteredPin: '1234' } })).json.token ?? null;
      if (!admin) await new Promise((r) => setTimeout(r, 1000));
    }
    assert.ok(admin, 'login local do Server');

    // 3) pairing com a fingerprint dada pelo admin (fora de banda) e safeStorage REAL na Station
    const pairing = (await local('POST', '/stations/pairings', { token: admin, body: { name: 'Caixa Smoke', role: 'caixa' } })).json.data;
    assert.equal(normalizeFingerprint(pairing.certificate_fingerprint), tls1.fingerprint, 'o Server mostra a fingerprint do certificado que serve');
    const stationDir = path.join(tmp, 'station');
    fs.mkdirSync(stationDir, { recursive: true });
    const store = createStationIdentityStore({ userDataPath: stationDir, safeStorage });
    const tok = parsePairingToken(pairing.pairing_token);
    const paired = await store.pair({ serverUrl: LAN, code: tok.code, expectedFingerprint: tok.fingerprint, machineId: getLocalMachineId() });
    log('pairing ok, station_id', paired.stationId);
    const keyEnc = fs.readFileSync(path.join(stationDir, 'station-key.enc'));
    assert.equal(keyEnc.includes('PRIVATE KEY'), false);

    // 4) fetch assinado sobre HTTPS com pin: login, uma venda, lock
    const client = createStationClient({ identityStore: store });
    const call = async (c, method, target, { body, token } = {}) => {
      const r = await c.request({ url: LAN + target, method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? Buffer.from(JSON.stringify(body)) : null });
      let json = {};
      try { json = JSON.parse(r.body.toString('utf8')); } catch { /* nao JSON */ }
      return { status: r.status, json };
    };
    const login = await call(client, 'POST', '/auth/login', { body: { userId: 'admin-local', enteredPin: '1234' } });
    assert.equal(login.status, 200);
    const token = login.json.token;
    assert.ok(token.includes(paired.stationId), 'sessao vinculada a Station');
    const prod = await local('POST', '/produtos', { token: admin, body: { name: 'Produto Smoke', price: 10, stock_quantity: 10 } });
    const sale = await call(client, 'POST', '/vendas', { token, body: { total: 10, docType: 'VD', paymentMethod: 'dinheiro', cart: [{ id: prod.json.data.id, name: 'Produto Smoke', quantity: 1, price: 10 }] } });
    assert.equal(sale.status, 200, JSON.stringify(sale.json));
    log('venda assinada sobre HTTPS ok');

    // 5) restart: Station (nova instancia do store le a chave via safeStorage) e Server (mesmo certificado)
    const store2 = createStationIdentityStore({ userDataPath: stationDir, safeStorage });
    assert.equal(store2.load()?.stationId, paired.stationId, 'identidade da Station sobrevive ao restart');
    server.kill();
    await new Promise((r) => server.once('exit', r));
    const tls3 = await getOrCreateServerTlsIdentity({ userDataPath: serverData, safeStorage });
    assert.equal(tls3.fingerprint, tls1.fingerprint);
    server = await startServer();
    const again = await call(createStationClient({ identityStore: store2 }), 'GET', '/produtos', { token });
    assert.equal(again.status, 200, 'Station autentica apos restart do Server (mesmo certificado, mesmo pin)');
    log('restart ok');
  } finally {
    server.kill();
  }
}

main().then(
  () => { log('SMOKE OK'); app.exit(0); },
  (err) => { console.error('[smoke] FALHOU:', err?.stack ?? err); app.exit(1); }
);
