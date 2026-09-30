/**
 * Pilot Gate — prova isolada de Device Auth, com o syncService REAL e SQLite
 * real: (1) timer — pausa limpa o setInterval, pausa repetida é segura, retoma
 * repetida cria um único timer; (2) o gate de pausa impede QUALQUER ciclo
 * (full/pull/queue), mesmo chamado directamente (como fazem users.controller.js
 * e POST /sync/run), sem rede, sem logs de ciclo, sem tocar na fila; (3) fila
 * de sync (todas as colunas) e sync_logs byte-a-byte iguais depois de
 * pausa + refresh-only + diagnóstico + sonda + ciclos directos.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, before, after, mock } from 'node:test';

const TENANT = 'tenant-pause-real';
const INTERVAL_MS = 12345; // valor único: distingue o timer do sync de qualquer outro setInterval do processo.

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'posly-sync-pause-real-'));
process.env.POS_DB_PATH = path.join(tmpDir, 'database.db');
process.env.DEFAULT_TENANT_ID = TENANT;
process.env.SUPABASE_URL = 'http://supabase.test';
process.env.SUPABASE_ANON_KEY = 'anon-key-test';
process.env.SYNC_INTERVAL_MS = String(INTERVAL_MS);
delete process.env.SUPABASE_SERVICE_ROLE_KEY;

const bridge = { refreshCalls: 0, cachedCalls: 0 };
mock.module('../../api/deviceAuth/deviceAuthBridgeClient.js', {
  exports: {
    isDeviceAuthBridgeConfigured: () => true,
    getDeviceAuthDiagnosticViaBridge: async () => ({ credentials_present: true, token_present: true }),
    getDeviceAccessTokenViaBridge: async () => { bridge.refreshCalls += 1; return 'fresh.runtime.jwt'; },
    getDeviceAccessTokenCachedOnlyViaBridge: async () => { bridge.cachedCalls += 1; return 'cached.runtime.jwt'; },
  },
});

const db = (await import('../../api/database.js')).default;
const svc = await import('../../api/syncService.js');
const controller = await import('../../api/controllers/sync.controller.js');

const runDb = (sql, params = []) => new Promise((res, rej) => db.run(sql, params, function onRun(e) { e ? rej(e) : res(this); }));
const allDb = (sql, params = []) => new Promise((res, rej) => db.all(sql, params, (e, r) => (e ? rej(e) : res(r))));

function fakeRes() {
  const res = { statusCode: 200, body: null };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (payload) => { res.body = payload; return res; };
  return res;
}
const REQ = { tenantId: TENANT, user: { id: 'admin-local', role: 'admin', tenant_id: TENANT } };

async function ready() {
  const deadline = Date.now() + 8000;
  for (;;) {
    try {
      await allDb('SELECT id FROM sync_queue LIMIT 1');
      await allDb('SELECT id FROM sync_logs LIMIT 1');
      return;
    } catch (e) {
      if (Date.now() > deadline) throw e;
      await new Promise((r) => setTimeout(r, 100));
    }
  }
}

const realSetInterval = globalThis.setInterval;
const realClearInterval = globalThis.clearInterval;
const originalFetch = globalThis.fetch;
const originalConsoleLog = console.log;
const intervals = { created: [] };
let fetchCalls = [];
let capturedLogs = [];

function installFakeTimers() {
  globalThis.setInterval = (fn, ms, ...rest) => {
    if (ms !== INTERVAL_MS) return realSetInterval(fn, ms, ...rest);
    const handle = { active: true, fn, ms };
    intervals.created.push(handle);
    return handle;
  };
  globalThis.clearInterval = (handle) => {
    if (handle && typeof handle === 'object' && 'active' in handle) {
      handle.active = false;
      return;
    }
    realClearInterval(handle);
  };
}

const activeSyncTimers = () => intervals.created.filter((h) => h.active).length;

before(async () => {
  await ready();
  installFakeTimers();
  globalThis.fetch = async (input) => {
    const url = String(input);
    fetchCalls.push(url);
    if (url.includes('/rest/v1/categories')) {
      return new Response(JSON.stringify([{ id: 'row-secret' }]), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
  };
});

after(() => {
  svc.pauseSyncService();
  globalThis.setInterval = realSetInterval;
  globalThis.clearInterval = realClearInterval;
  globalThis.fetch = originalFetch;
  console.log = originalConsoleLog;
});

async function seedQueue() {
  const now = '2026-09-27T10:00:00.000Z';
  const rows = [
    ['category', 'dead', 5, null],
    ['category', 'dead', 5, null],
    ['product', 'dead', 5, null],
    ['sale', 'pending', 0, null],
    ['customer', 'pending', 0, null],
    ['product', 'failed', 2, '2026-09-27T12:00:00.000Z'],
    ['sale', 'synced', 0, null],
  ];
  for (const [type, status, retries, nextRetry] of rows) {
    await runDb(
      `INSERT INTO sync_queue (tenant_id, type, data, status, retries, next_retry_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [TENANT, type, JSON.stringify({ tenant_id: TENANT, name: 'x' }), status, retries, nextRetry, now, now],
    );
  }
}

const queueSnapshot = async () =>
  JSON.stringify(await allDb('SELECT * FROM sync_queue ORDER BY id'));
const logsCount = async () => (await allDb('SELECT COUNT(*) AS n FROM sync_logs'))[0].n;

test('timer: retoma repetida cria UM só timer; pausa limpa-o; pausa repetida é segura; retoma volta a criar um', async () => {
  assert.equal(svc.getSyncRuntimeState().sync_active, false, 'nada arrancou ainda');

  svc.resumeSyncService();
  svc.resumeSyncService();
  svc.resumeSyncService();
  assert.equal(intervals.created.length, 1, 'três retomas -> um único setInterval');
  assert.equal(activeSyncTimers(), 1);
  assert.deepEqual(
    { active: svc.getSyncRuntimeState().sync_active, paused: svc.getSyncRuntimeState().paused_by_operator },
    { active: true, paused: false },
  );
  await new Promise((r) => setTimeout(r, 300)); // deixa o ciclo inicial imediato terminar (offline).

  svc.pauseSyncService();
  assert.equal(activeSyncTimers(), 0, 'pausa limpou o timer');
  assert.deepEqual(svc.getSyncRuntimeState(), { sync_active: false, paused_by_operator: true, cycle_running: false });

  svc.pauseSyncService(); // repetida: sem erro, sem novo estado
  assert.equal(activeSyncTimers(), 0);
  assert.deepEqual(svc.getSyncRuntimeState(), { sync_active: false, paused_by_operator: true, cycle_running: false });

  svc.resumeSyncService();
  svc.resumeSyncService();
  assert.equal(intervals.created.length, 2, 'retoma depois da pausa cria exactamente mais um');
  assert.equal(activeSyncTimers(), 1);
  await new Promise((r) => setTimeout(r, 300));

  svc.pauseSyncService();
  assert.equal(activeSyncTimers(), 0);
});

test('pausa: full/pull/queue chamados DIRECTAMENTE saem logo (sem rede, sem logs de ciclo) — cobre users.controller e POST /sync/run', async () => {
  svc.pauseSyncService();
  fetchCalls = [];
  capturedLogs = [];
  console.log = (...args) => { capturedLogs.push(args.map(String).join(' ')); };
  try {
    const full = await svc.processFullSyncCycle();
    const pull = await svc.processPullSyncCycle();
    const queue = await svc.processSyncQueueCycle();

    assert.equal(full.push.skipped, true);
    assert.equal(full.push.reason, 'paused_by_operator');
    assert.equal(full.pull.skipped, true);
    assert.equal(full.pull.reason, 'paused_by_operator');
    assert.equal(pull.reason, 'paused_by_operator');
    assert.equal(queue.reason, 'paused_by_operator');
  } finally {
    console.log = originalConsoleLog;
  }
  assert.deepEqual(fetchCalls, [], 'nenhum pedido de rede');
  assert.deepEqual(capturedLogs.filter((l) => l.includes('[DEBUG') || l.includes('[sync]')), [], 'nenhum log de ciclo');
});

test('fila e sync_logs IGUAIS depois de pausa + refresh-only + diagnóstico + sonda + ciclos directos', async () => {
  await seedQueue();
  svc.pauseSyncService();
  await new Promise((r) => setTimeout(r, 200));

  const queueBefore = await queueSnapshot();
  const logsBefore = await logsCount();
  fetchCalls = [];
  bridge.refreshCalls = 0;
  bridge.cachedCalls = 0;
  capturedLogs = [];
  console.log = (...args) => { capturedLogs.push(args.map(String).join(' ')); };

  try {
    const pauseRes = fakeRes();
    await controller.pauseSync(REQ, pauseRes);
    assert.deepEqual(pauseRes.body.data, { sync_active: false, paused_by_operator: true, cycle_running: false });

    const refreshRes = fakeRes();
    await controller.deviceAuthRefreshOnly(REQ, refreshRes);
    assert.deepEqual(refreshRes.body.data, { ok: true });

    const diagRes = fakeRes();
    await controller.getDeviceAuthDiagnostic(REQ, diagRes);
    assert.equal(diagRes.statusCode, 200);

    const probeRes = fakeRes();
    await controller.deviceAuthReadonlyProbe(REQ, probeRes);
    assert.deepEqual(probeRes.body.data, { probe_success: true, status: 200, row_count: 1 });

    await svc.processFullSyncCycle();
    await svc.processPullSyncCycle();
    await svc.processSyncQueueCycle();
  } finally {
    console.log = originalConsoleLog;
  }

  assert.equal(bridge.refreshCalls, 1, 'exactamente 1 obtenção de token (refresh-only); a sonda não refresca');
  assert.equal(bridge.cachedCalls, 1);
  assert.deepEqual(
    fetchCalls.filter((u) => !u.includes('/rest/v1/categories')),
    [],
    'a única rede tocada é a sonda categories — nenhum probe de conectividade, nenhum push/pull',
  );
  assert.equal(fetchCalls.length, 1);
  assert.deepEqual(capturedLogs.filter((l) => l.includes('[DEBUG') || l.includes('[sync]')), []);

  assert.equal(await queueSnapshot(), queueBefore, 'todas as colunas de sync_queue inalteradas (status, retries, next_retry_at, locks, updated_at)');
  assert.equal(await logsCount(), logsBefore, 'sync_logs sem novas linhas');
});
