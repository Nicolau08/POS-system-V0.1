/**
 * Pilot Gate — rlsDiagnostic via HTTP real (processo API real spawnado):
 * confirma que a rota continua a exigir autenticação e que o novo campo
 * responde correctamente em modo offline (sem cloud configurada), sem
 * qualquer chamada de rede. O detalhe da correlação/contagem já está coberto
 * em sync-status-rls-diagnostic.test.mjs (chamada directa do controller).
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function waitForHttp(url, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  return (async () => {
    let lastErr = null;
    while (Date.now() < deadline) {
      try {
        return await fetch(url);
      } catch (err) {
        lastErr = err;
        await new Promise((r) => setTimeout(r, 200));
      }
    }
    throw lastErr || new Error('timeout à espera de ' + url);
  })();
}

function runServer(env, port) {
  let out = '';
  const child = spawn(process.execPath, [path.join(repoRoot, 'api', 'server.js')], {
    cwd: repoRoot,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (d) => (out += d.toString()));
  child.stderr.on('data', (d) => (out += d.toString()));
  const ready = waitForHttp(`http://127.0.0.1:${port}/setup/status`);
  return { child, ready, getLog: () => out };
}

const AUTH_HEADERS = {
  'x-auth-user': JSON.stringify({ id: 'admin-local', role: 'admin' }),
  'Content-Type': 'application/json',
};

test('GET /sync/status: rlsDiagnostic exige auth e funciona offline via HTTP real', async () => {
  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'posly-sync-rls-diag-http-'));
  const dbPath = path.join(userDataPath, 'database.db');
  const port = 6600 + Math.floor(Math.random() * 150);
  const TENANT = 'tenant-sync-rls-diag-http';

  const env = {
    ...process.env,
    POS_DB_PATH: dbPath,
    POS_USER_DATA_PATH: userDataPath,
    POS_API_PORT: String(port),
    NODE_ENV: 'test',
    DEFAULT_TENANT_ID: TENANT,
    AUTH_ALLOW_MOCK_HEADERS: 'true',
  };
  env.SUPABASE_URL = '';
  env.NEXT_PUBLIC_SUPABASE_URL = '';
  env.SUPABASE_ANON_KEY = '';
  env.SUPABASE_SERVICE_ROLE_KEY = '';
  delete env.POS_DB_ENCRYPTION;
  delete env.POS_DB_ENCRYPTION_KEY;
  delete env.AUTH_ALLOW_LEGACY_LOCAL;

  const server = runServer(env, port);
  try {
    await server.ready;
    await new Promise((r) => setTimeout(r, 400));

    // auth required
    const unauthRes = await fetch(`http://127.0.0.1:${port}/sync/status`, { method: 'GET' });
    assert.equal(unauthRes.status, 401);

    // offline works — sem cloud configurada, zero rede, resposta ainda inclui rlsDiagnostic bem formado.
    const statusRes = await fetch(`http://127.0.0.1:${port}/sync/status`, { headers: AUTH_HEADERS });
    assert.equal(statusRes.status, 200);
    const payload = await statusRes.json();
    const data = payload?.data ?? payload;

    assert.equal(data.cloud_configured, false);
    assert.equal(data.online, false);
    assert.equal(data.mode, 'offline_only');

    assert.ok(data.rlsDiagnostic);
    assert.deepEqual(data.rlsDiagnostic.category, {
      items: 0,
      totalAttempts: 0,
      firstAttempt: null,
      lastAttempt: null,
      sameRlsErrorAttempts: 0,
    });
    assert.deepEqual(data.rlsDiagnostic.product, {
      items: 0,
      totalAttempts: 0,
      firstAttempt: null,
      lastAttempt: null,
    });
    assert.ok(data.byType, 'byType existente continua presente ao lado do novo campo');
    assert.ok(data.tenantDiagnostic, 'tenantDiagnostic existente continua presente ao lado do novo campo');
  } finally {
    server.child.kill('SIGKILL');
    try {
      fs.rmSync(userDataPath, { recursive: true, force: true });
    } catch {
      // Windows pode manter um handle breve depois de matar o processo filho.
    }
  }
});
