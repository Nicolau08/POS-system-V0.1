/**
 * Pilot Gate — prova isolada de Device Auth via HTTP real (processo API
 * spawnado, timer real de 250ms, Supabase falso local): o timer corre ciclos
 * enquanto activo; depois de POST /sync/pause deixa de haver ciclos (nem o
 * timer, nem POST /sync/run); refresh-only e sonda são rejeitados com o sync
 * activo; retoma repetida mantém UM só timer (cadência ~1 ciclo/intervalo).
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const INTERVAL_MS = 250;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

const AUTH_HEADERS = {
  'x-auth-user': JSON.stringify({ id: 'admin-local', role: 'admin' }),
  'Content-Type': 'application/json',
};

test('HTTP real: pausa pára os ciclos (timer e /sync/run), guardas 409 com sync activo, retoma repetida = um timer', async () => {
  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'posly-sync-pause-http-'));
  const port = 6900 + Math.floor(Math.random() * 150);
  const TENANT = 'tenant-sync-pause-http';

  const fakeSupabase = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('[]');
  });
  await new Promise((r) => fakeSupabase.listen(0, '127.0.0.1', r));
  const fakePort = fakeSupabase.address().port;

  const env = {
    ...process.env,
    POS_DB_PATH: path.join(userDataPath, 'database.db'),
    POS_USER_DATA_PATH: userDataPath,
    POS_API_PORT: String(port),
    NODE_ENV: 'test',
    DEFAULT_TENANT_ID: TENANT,
    AUTH_ALLOW_MOCK_HEADERS: 'true',
    SUPABASE_URL: `http://127.0.0.1:${fakePort}`,
    NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${fakePort}`,
    SUPABASE_ANON_KEY: 'anon-key-test',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key-test',
    SUPABASE_SERVICE_ROLE_KEY: '',
    POS_DEVICE_AUTH_BRIDGE_URL: '',
    POS_DEVICE_AUTH_BRIDGE_SECRET: '',
    SYNC_INTERVAL_MS: String(INTERVAL_MS),
  };
  delete env.POS_DB_ENCRYPTION;
  delete env.POS_DB_ENCRYPTION_KEY;
  delete env.AUTH_ALLOW_LEGACY_LOCAL;

  let out = '';
  const child = spawn(process.execPath, [path.join(repoRoot, 'api', 'server.js')], {
    cwd: repoRoot,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (d) => (out += d.toString()));
  child.stderr.on('data', (d) => (out += d.toString()));

  const base = `http://127.0.0.1:${port}`;
  const cycles = () => (out.match(/\[DEBUG PULL CHECK\]/g) ?? []).length;
  const call = (method, route) => fetch(`${base}${route}`, { method, headers: AUTH_HEADERS });
  const json = async (res) => (await res.json());

  try {
    await waitForHttp(`${base}/setup/status`);

    // 1) sync activo: o timer real corre ciclos.
    let waited = 0;
    while (cycles() < 3 && waited < 10000) { await sleep(200); waited += 200; }
    assert.ok(cycles() >= 3, 'o timer real está a correr ciclos');

    const active = await json(await call('GET', '/sync/status'));
    assert.equal(active.data.sync_active, true);

    // 2) auth exigida; guardas com sync activo.
    const unauth = await fetch(`${base}/sync/pause`, { method: 'POST' });
    assert.equal(unauth.status, 401);

    const refreshWhileActive = await call('POST', '/sync/device-auth-refresh-only');
    assert.equal(refreshWhileActive.status, 409);
    assert.equal((await json(refreshWhileActive)).error.code, 'SYNC_NOT_PAUSED');

    const probeWhileActive = await call('GET', '/sync/device-auth-readonly-probe');
    assert.equal(probeWhileActive.status, 409);
    assert.equal((await json(probeWhileActive)).error.code, 'SYNC_NOT_PAUSED');

    // 3) pausa: estado real e idempotente.
    const pause1 = await call('POST', '/sync/pause');
    assert.equal(pause1.status, 200);
    const pause1Body = await json(pause1);
    assert.equal(pause1Body.data.sync_active, false);
    assert.equal(pause1Body.data.paused_by_operator, true);
    const pause2 = await call('POST', '/sync/pause');
    assert.equal(pause2.status, 200);
    assert.equal((await json(pause2)).data.sync_active, false);

    const pausedStatus = await json(await call('GET', '/sync/status'));
    assert.equal(pausedStatus.data.sync_active, false, '/sync/status também reflecte a pausa real');

    // 4) nenhum ciclo depois da pausa (janela de ~6 intervalos), nem por /sync/run.
    await sleep(800); // deixa terminar um ciclo que estivesse a meio.
    const afterPause = cycles();
    await sleep(1500);
    assert.equal(cycles(), afterPause, 'o timer não corre ciclos depois da pausa');

    const manualRun = await call('POST', '/sync/run');
    assert.equal(manualRun.status, 200);
    const manualBody = await json(manualRun);
    assert.equal(manualBody.data.push.skipped, true);
    assert.equal(manualBody.data.push.reason, 'paused_by_operator');
    await sleep(300);
    assert.equal(cycles(), afterPause, 'POST /sync/run em pausa também não corre ciclo');

    // 5) em pausa, sem ponte de token: refresh-only ok=false; sonda 409 sem token em cache.
    const refreshPaused = await call('POST', '/sync/device-auth-refresh-only');
    assert.equal(refreshPaused.status, 200);
    assert.deepEqual((await json(refreshPaused)).data, { ok: false });
    const probePaused = await call('GET', '/sync/device-auth-readonly-probe');
    assert.equal(probePaused.status, 409);
    assert.equal((await json(probePaused)).error.code, 'DEVICE_TOKEN_NOT_CACHED');
    assert.equal(cycles(), afterPause, 'refresh-only e sonda nunca correm ciclos');

    // 6) retoma (3x): um só timer — cadência ~1 ciclo por intervalo, não o dobro.
    const resume1 = await json(await call('POST', '/sync/resume'));
    assert.equal(resume1.data.sync_active, true);
    await call('POST', '/sync/resume');
    await call('POST', '/sync/resume');
    const resumeStart = cycles();
    await sleep(2400);
    const resumed = cycles() - resumeStart;
    assert.ok(resumed >= 4, `o timer voltou a correr (ciclos=${resumed})`);
    assert.ok(resumed <= 14, `um único timer, não dois (ciclos=${resumed}, esperado ~10)`);

    await call('POST', '/sync/pause');
  } finally {
    child.kill('SIGKILL');
    fakeSupabase.close();
    await sleep(300);
    try {
      fs.rmSync(userDataPath, { recursive: true, force: true });
    } catch {
      // Windows pode manter um handle breve depois de matar o processo filho.
    }
  }
});
