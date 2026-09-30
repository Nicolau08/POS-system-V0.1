/**
 * Etapa 1G.3.3 - E2E do Store Server REAL em LAN: os pedidos "remotos" vao para o IP LAN da propria maquina (o socket
 * deixa de ser loopback), sem Internet/cloud. Prova: gate global, login remoto so com Station, propagacao do station_id
 * autenticado (table lock + venda), revogacao imediata, replay e restart. Salta se a maquina nao tiver IPv4 LAN.
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
import { signStationRequest } from '../../lib/stationAuth/stationRequestSigning.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const lcDir = path.join(repoRoot, 'license-console');
const lanIp = Object.values(os.networkInterfaces()).flat().find((i) => i && i.family === 'IPv4' && !i.internal)?.address;
const opts = { skip: !lanIp && 'sem IPv4 LAN nesta maquina' };
const TENANT = 'tenant-e2e-stationauth';
const MACHINE = getLocalMachineId();
const port = 4800 + Math.floor(Math.random() * 90);

function gen(o) {
  const r = spawnSync(process.execPath, ['--experimental-strip-types', path.join(lcDir, 'scripts', 'gen-offline-license-fixture.mjs'), JSON.stringify(o)], { cwd: lcDir, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}

test('Store Server em LAN: gate, login remoto, table lock, venda, revogacao, replay e restart', opts, async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'posly-auth-e2e-'));
  const userData = path.join(tmp, 'userData');
  fs.mkdirSync(userData, { recursive: true });
  const dbPath = path.join(tmp, 'database.db');
  const lic = gen({ v2: true, payload: { license_id: 'lic-auth', tenant_id: TENANT, machine_id: MACHINE, name: 'Loja Auth', store_id: 'store-auth', max_stations_per_store: 3 } });
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
  const waitUp = async () => {
    const deadline = Date.now() + 30000;
    for (;;) {
      try { if ((await fetch(`${LOCAL}/health`)).ok) return; } catch { /* a arrancar */ }
      if (Date.now() > deadline) throw new Error('servidor nao arrancou');
      await new Promise((r) => setTimeout(r, 250));
    }
  };
  const http = async (base, method, target, { body, token, headers = {}, signWith } = {}) => {
    const raw = body === undefined ? undefined : JSON.stringify(body);
    const sig = signWith ? signStationRequest({ privateKey: signWith.privateKey, stationId: signWith.id, method, target, body: raw === undefined ? Buffer.alloc(0) : Buffer.from(raw), authorization: token ? `Bearer ${token}` : '' }) : {};
    const res = await (base === LAN ? lanFetch : fetch)(base + target, {
      method,
      headers: { ...(raw !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...sig, ...headers },
      body: raw,
    });
    const json = await res.json().catch(() => ({}));
    return { status: res.status, json, data: json.data ?? null, code: json.error?.code ?? json.code ?? null, headers: sig, raw };
  };
  const readDb = (sql) => new Promise((resolve, reject) => {
    const sqlite = createRequire(import.meta.url)('@journeyapps/sqlcipher');
    const d = new sqlite.Database(dbPath, sqlite.OPEN_READONLY, (e) => {
      if (e) return reject(e);
      d.all(sql, (err, rows) => { d.close(); return err ? reject(err) : resolve(rows); });
    });
  });

  let child = spawnServer();
  try {
    await waitUp();
    assert.equal((await http(LOCAL, 'POST', '/setup/license/install-offline-license', { body: { offline_license: lic.envelope, machine_id: MACHINE } })).status, 200);
    assert.equal((await http(LOCAL, 'POST', '/setup/admin-password', { body: { pin: '1234' } })).status, 200);
    let login = { status: 0 };
    for (let i = 0; i < 15 && login.status !== 200; i += 1) {
      login = await http(LOCAL, 'POST', '/auth/login', { body: { userId: 'admin-local', enteredPin: '1234' } });
      if (login.status !== 200) await new Promise((r) => setTimeout(r, 1000));
    }
    const rawLogin = await (await fetch(`${LOCAL}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: 'admin-local', enteredPin: '1234' }) })).json();
    const adminToken = rawLogin.token;
    assert.ok(adminToken, 'login loopback');

    // pairing (admin, loopback) + emparelhar A PARTIR DA LAN (endpoint publico, sem assinatura)
    const p = await http(LOCAL, 'POST', '/stations/pairings', { token: adminToken, body: { name: 'Caixa Remota', role: 'caixa' } });
    assert.equal(p.status, 201, JSON.stringify(p));
    FP = p.data.certificate_fingerprint;
    assert.ok(FP, 'o Server mostra a fingerprint do certificado ao criar o pairing');
    lanFetch = createPinnedFetch({ fingerprint: FP });
    const kp = crypto.generateKeyPairSync('ed25519');
    const paired = await http(LAN, 'POST', '/station/pair', { body: { code: p.data.code, public_key: kp.publicKey.export({ type: 'spki', format: 'der' }).toString('base64url'), machine_id: 'PC-REMOTO' } });
    assert.equal(paired.status, 201, JSON.stringify(paired));
    const S = { id: paired.data.station_id, privateKey: kp.privateKey, code: paired.data.code };

    // remoto SEM assinatura: tudo protegido falha, incluindo login, lista de utilizadores e setup
    for (const [m, t] of [['GET', '/auth/login-users'], ['POST', '/auth/login'], ['GET', '/stations'], ['GET', '/setup/status'], ['POST', '/setup/admin-password'], ['GET', '/produtos']]) {
      const r = await http(LAN, m, t, { body: m === 'POST' ? { userId: 'admin-local', enteredPin: '1234' } : undefined, token: adminToken });
      assert.equal(r.status, 401, `${m} ${t}`);
      assert.equal(r.code, 'STATION_AUTH_REQUIRED');
    }
    // publicos: health e descoberta
    assert.equal((await http(LAN, 'GET', '/health')).status, 200);
    assert.notEqual((await http(LAN, 'GET', '/station/discover')).status, 401);
    // cabecalhos de etiqueta forjados nao servem de identidade
    assert.equal((await http(LAN, 'GET', '/auth/login-users', { headers: { 'X-Station-Code': S.code, 'X-Station-Role': 'admin', 'X-Station-Id': S.id } })).status, 401);
    // X-Forwarded-For nao transforma remoto em local
    assert.equal((await http(LAN, 'GET', '/auth/login-users', { headers: { 'X-Forwarded-For': '127.0.0.1' } })).status, 401);

    // remoto COM assinatura: login-users, login e chamadas protegidas
    assert.equal((await http(LAN, 'GET', '/auth/login-users', { signWith: S })).status, 200);
    const remoteLogin = await http(LAN, 'POST', '/auth/login', { body: { userId: 'admin-local', enteredPin: '1234' }, signWith: S });
    assert.equal(remoteLogin.status, 200, JSON.stringify(remoteLogin));
    const remoteToken = remoteLogin.json.token; // Bearer do operador VINCULADO a esta Station (1G.3.4)
    assert.ok(remoteToken);
    assert.equal(remoteToken.split('.').length, 4, 'token vinculado: userId.exp.stationId.sig');
    // Bearer emitido no loopback (nao vinculado) nunca autentica a partir de uma Station
    assert.equal((await http(LAN, 'GET', '/produtos', { token: adminToken, signWith: S })).status, 401);
    // Bearer vinculado nao serve no loopback
    assert.equal((await http(LOCAL, 'GET', '/produtos', { token: remoteToken })).status, 401);
    const signedGet = await http(LAN, 'GET', '/produtos', { token: remoteToken, signWith: S });
    assert.equal(signedGet.status, 200);
    // replay do MESMO pedido assinado (capturado) -> 401
    const replay = await lanFetch(`${LAN}/produtos`, { headers: { Authorization: `Bearer ${remoteToken}`, ...signedGet.headers } });
    assert.equal(replay.status, 401);
    // o mesmo Bearer sem assinatura da Station: 401 (Operator Auth sozinha nao basta fora do loopback)
    assert.equal((await http(LAN, 'GET', '/produtos', { token: remoteToken })).status, 401);

    // table lock: o posto assumido vem da assinatura, nao do corpo/cabecalho
    const claim = await http(LAN, 'POST', '/table-locks/claim', { token: remoteToken, signWith: S, body: { tableKey: 'M1', stationCode: 'caixa-outra' }, headers: { 'X-Station-Code': 'caixa-outra' } });
    assert.equal(claim.status, 200, JSON.stringify(claim));
    const locks = (await readDb(`SELECT station_code FROM table_locks WHERE table_key = 'M1'`));
    assert.equal(locks[0].station_code, S.code);

    // venda: station_id autenticado gravado; venda no loopback fica sem station_id
    const prod = await http(LOCAL, 'POST', '/produtos', { token: adminToken, body: { name: 'Produto Auth', price: 10, stock_quantity: 50 } });
    assert.equal(prod.status, 200, JSON.stringify(prod));
    const pid = prod.data?.id;
    const sale = { total: 10, docType: 'VD', paymentMethod: 'dinheiro', cart: [{ id: pid, name: 'Produto Auth', quantity: 1, price: 10 }] };
    assert.equal((await http(LAN, 'POST', '/vendas', { token: remoteToken, signWith: S, body: sale, headers: { 'X-Station-Code': 'forjado' } })).status, 200);
    assert.equal((await http(LOCAL, 'POST', '/vendas', { token: adminToken, body: sale })).status, 200);
    const vendas = await readDb(`SELECT station_id, register_code FROM vendas ORDER BY id`);
    assert.deepEqual(vendas.map((v) => v.station_id), [S.id, null]);
    assert.equal(vendas[0].register_code, S.code);

    // revogacao: no pedido seguinte
    assert.equal((await http(LOCAL, 'POST', `/stations/${S.id}/status`, { token: adminToken, body: { status: 'revoked' } })).status, 200);
    assert.equal((await http(LAN, 'GET', '/auth/login-users', { signWith: S })).status, 401);

    // restart: o replay capturado continua rejeitado e o loopback continua funcional
    child.kill();
    await new Promise((r) => child.once('exit', r));
    child = spawnServer();
    await waitUp();
    assert.equal((await lanFetch(`${LAN}/produtos`, { headers: { Authorization: `Bearer ${remoteToken}`, ...signedGet.headers } })).status, 401);
    assert.equal((await http(LOCAL, 'GET', '/produtos', { token: adminToken })).status, 200);
  } finally {
    child.kill();
  }
});
