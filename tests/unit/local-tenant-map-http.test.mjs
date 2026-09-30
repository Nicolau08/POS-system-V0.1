/**
 * Pilot Gate — GET /sync/local-tenant-map via HTTP real (processo API spawnado) + ponte Device Auth FALSA:
 * auth (401), admin-only (403), loopback-only (middleware + ordem da rota), 200 com Device JWT em cache e
 * PROVA de "sem refresh" (a ponte só recebe /access-token-cached, nunca /access-token) e "sem auditoria/escritas"
 * (audit_logs, sync_logs e sync_queue inalterados, lidos por uma ligação SQLite só-leitura independente).
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(import.meta.url);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const JWT_TENANT = 'abcd1234-5678-90ab-cdef-000000000001';

function fakeJwt(claims) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'ES256' })}.${b64(claims)}.assinatura`;
}

function waitForHttp(url, timeoutMs = 25000) {
  const deadline = Date.now() + timeoutMs;
  return (async () => {
    let lastErr = null;
    while (Date.now() < deadline) {
      try {
        return await fetch(url);
      } catch (err) {
        lastErr = err;
        await sleep(200);
      }
    }
    throw lastErr || new Error('timeout à espera de ' + url);
  })();
}

function readCounts(dbPath) {
  const sqlite3 = require('@journeyapps/sqlcipher');
  return new Promise((resolve, reject) => {
    const conn = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY, (openErr) => {
      if (openErr) return reject(openErr);
      const out = {};
      const tables = ['audit_logs', 'sync_logs', 'sync_queue', 'users', 'licenses'];
      let pending = tables.length;
      for (const t of tables) {
        conn.get(`SELECT COUNT(*) AS n FROM ${t}`, (e, row) => {
          out[t] = e ? null : row.n;
          if (--pending === 0) conn.close(() => resolve(out));
        });
      }
    });
  });
}

const ADMIN = { 'x-auth-user': JSON.stringify({ id: 'admin-local', role: 'admin' }) };
const CASHIER = { 'x-auth-user': JSON.stringify({ id: 'caixa-inexistente', role: 'cashier' }) };

test('HTTP real: auth, admin-only, loopback, sem refresh e sem escritas', async () => {
  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'posly-local-tenant-map-http-'));
  const dbPath = path.join(userDataPath, 'database.db');
  const port = 6450 + Math.floor(Math.random() * 150);

  const bridgeCalls = [];
  const bridgeSecret = 'segredo-de-teste-da-ponte';
  const fakeBridge = http.createServer((req, res) => {
    bridgeCalls.push(`${req.method} ${req.url}`);
    const authorized = req.headers.authorization === `Bearer ${bridgeSecret}`;
    res.writeHead(authorized ? 200 : 401, { 'content-type': 'application/json' });
    if (req.url === '/access-token-cached') {
      res.end(JSON.stringify({ ok: true, accessToken: fakeJwt({ tenant_id: JWT_TENANT, role: 'authenticated' }) }));
    } else {
      // /access-token (refresh) ou /diagnostic: qualquer chamada aqui é uma violação, o teste falha mais abaixo.
      res.end(JSON.stringify({ ok: true, accessToken: fakeJwt({ tenant_id: JWT_TENANT }), diagnostic: {} }));
    }
  });
  await new Promise((r) => fakeBridge.listen(0, '127.0.0.1', r));
  const bridgePort = fakeBridge.address().port;

  const env = {
    ...process.env,
    POS_DB_PATH: dbPath,
    POS_USER_DATA_PATH: userDataPath,
    POS_API_PORT: String(port),
    NODE_ENV: 'test',
    DEFAULT_TENANT_ID: 'tenant-1',
    AUTH_ALLOW_MOCK_HEADERS: 'true',
    SUPABASE_URL: '',
    NEXT_PUBLIC_SUPABASE_URL: '',
    SUPABASE_ANON_KEY: '',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: '',
    SUPABASE_SERVICE_ROLE_KEY: '',
    POS_DEVICE_AUTH_BRIDGE_URL: `http://127.0.0.1:${bridgePort}/access-token`,
    POS_DEVICE_AUTH_BRIDGE_SECRET: bridgeSecret,
  };
  delete env.POS_DB_ENCRYPTION;
  delete env.POS_DB_ENCRYPTION_KEY;
  delete env.AUTH_ALLOW_LEGACY_LOCAL;

  const child = spawn(process.execPath, [path.join(repoRoot, 'api', 'server.js')], {
    cwd: repoRoot,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', () => {});
  child.stderr.on('data', () => {});

  const base = `http://127.0.0.1:${port}`;
  const url = `${base}/sync/local-tenant-map`;

  try {
    await waitForHttp(`${base}/setup/status`);
    await sleep(1500); // deixa assentar as escritas de arranque (seed de licença AUTO, etc.)

    // 401 sem auth; 403 sem ser admin. Nenhum destes chega à ponte.
    assert.equal((await fetch(url)).status, 401);
    assert.equal((await fetch(url, { headers: CASHIER })).status, 403);
    assert.equal(bridgeCalls.length, 0, 'pedidos rejeitados nunca tocam na ponte');

    const before = await readCounts(dbPath);

    // 200 para admin no loopback.
    const res = await fetch(url, { headers: ADMIN });
    assert.equal(res.status, 200);
    const body = await res.json();
    const d = body.data;
    assert.equal(d.read_only, true);
    assert.equal(d.device_jwt_tenant.available, true);
    assert.equal(d.device_jwt_tenant.id, JWT_TENANT.slice(0, 8));
    assert.equal(d.classification_reference, 'device_jwt');
    assert.equal(d.request_tenant.class, 'legacy_placeholder');
    assert.equal(d.users.admin_local.class, 'legacy_placeholder');
    assert.equal(d.license_tenant.known, false, 'só existe a licença AUTO em tenant-1');
    assert.equal(d.identities_match, null);
    assert.ok(d.tables.users && d.tables.sync_queue);
    assert.ok(!JSON.stringify(body).includes(JWT_TENANT), 'o tenant do JWT nunca sai completo');

    // Repetições: continua sem refresh nem escritas.
    await fetch(url, { headers: ADMIN });
    await fetch(url, { headers: ADMIN });
    await sleep(500);

    assert.ok(bridgeCalls.length >= 3, 'a ponte foi consultada');
    assert.ok(
      bridgeCalls.every((c) => c === 'POST /access-token-cached'),
      `só /access-token-cached (nunca /access-token nem /diagnostic): ${JSON.stringify(bridgeCalls)}`,
    );

    const after = await readCounts(dbPath);
    assert.equal(after.audit_logs, before.audit_logs, 'nenhuma linha de auditoria');
    assert.equal(after.sync_logs, before.sync_logs);
    assert.equal(after.sync_queue, before.sync_queue);
    assert.equal(after.users, before.users);
    assert.equal(after.licenses, before.licenses);
  } finally {
    child.kill('SIGKILL');
    fakeBridge.close();
    await sleep(300);
    try {
      fs.rmSync(userDataPath, { recursive: true, force: true });
    } catch {
      // Windows pode manter um handle breve depois de matar o processo filho.
    }
  }
});

test('loopback-only: pedido de socket remoto é 403 antes de auth/handler; a rota tem a ordem de guardas esperada', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'posly-local-tenant-map-route-'));
  process.env.POS_DB_PATH = path.join(tmp, 'database.db');
  const { requireLoopbackOnly } = await import('../../api/middlewares/stationAuth.js');
  const { authenticateUser, requireAdmin } = await import('../../api/middlewares/auth.js');
  const { getLocalTenantMap } = await import('../../api/controllers/sync.controller.js');
  const router = (await import('../../api/routes/sync.routes.js')).default;

  const layer = router.stack.find((l) => l.route?.path === '/local-tenant-map');
  assert.ok(layer, 'rota registada');
  assert.deepEqual(Object.keys(layer.route.methods), ['get'], 'só GET');
  assert.deepEqual(layer.route.stack.map((s) => s.handle), [requireLoopbackOnly, authenticateUser, requireAdmin, getLocalTenantMap]);

  for (const remoteAddress of ['192.168.1.50', '10.0.0.7', '::ffff:203.0.113.9', '2001:db8::1']) {
    let nextCalled = false;
    const res = { code: null, status(c) { this.code = c; return this; }, json() { return this; } };
    requireLoopbackOnly({ socket: { remoteAddress }, headers: { 'x-forwarded-for': '127.0.0.1' } }, res, () => { nextCalled = true; });
    assert.equal(res.code, 403, `remoto ${remoteAddress}`);
    assert.equal(nextCalled, false);
  }
  for (const remoteAddress of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) {
    let nextCalled = false;
    requireLoopbackOnly({ socket: { remoteAddress }, headers: {} }, {}, () => { nextCalled = true; });
    assert.equal(nextCalled, true, `loopback ${remoteAddress}`);
  }
});
