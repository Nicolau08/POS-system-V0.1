/**
 * Pilot Gate — prova isolada de Device Auth: handlers de pausa/refresh-only/
 * sonda só-leitura. syncService.js e a ponte de token estão mockados com
 * contadores, para provar chamadas exactas: refresh-only nunca corre ciclos de
 * sync, a sonda nunca refresca (só usa o token JÁ em cache), ambos são
 * rejeitados enquanto o sync não estiver garantidamente em pausa, e nada
 * devolve token/claims/conteúdo de linhas.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, beforeEach, after, mock } from 'node:test';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'posly-sync-pause-controls-'));
process.env.POS_DB_PATH = path.join(tmpDir, 'database.db');
process.env.DEFAULT_TENANT_ID = 'tenant-pause-controls';
process.env.SUPABASE_URL = 'http://supabase.test';
process.env.SUPABASE_ANON_KEY = 'anon-key-test';
delete process.env.SUPABASE_SERVICE_ROLE_KEY;

const CACHED_TOKEN = 'cached.runtime.jwt-SECRET-MARKER';
const ROW_ID_SECRET = 'row-id-secret-marker-123';

const svc = {
  calls: { processFullSyncCycle: 0, pause: 0, resume: 0 },
  state: { sync_active: true, paused_by_operator: false, cycle_running: false },
};
mock.module('../../api/syncService.js', {
  exports: {
    processFullSyncCycle: async () => { svc.calls.processFullSyncCycle += 1; return { push: {}, pull: {} }; },
    isCloudSyncConfigured: () => true,
    isInternetAvailable: async () => true,
    isSyncServiceActive: () => svc.state.sync_active,
    reconcileStockWithCloud: async () => {},
    pushStoreProductConfig: async () => {},
    pauseSyncService: () => {
      svc.calls.pause += 1;
      svc.state.paused_by_operator = true;
      svc.state.sync_active = false;
    },
    resumeSyncService: () => {
      svc.calls.resume += 1;
      svc.state.paused_by_operator = false;
      svc.state.sync_active = true;
    },
    getSyncRuntimeState: () => ({ ...svc.state }),
  },
});

const bridge = { refreshCalls: 0, cachedCalls: 0, refreshToken: 'fresh.runtime.jwt', cachedToken: CACHED_TOKEN, configured: true };
mock.module('../../api/deviceAuth/deviceAuthBridgeClient.js', {
  exports: {
    isDeviceAuthBridgeConfigured: () => bridge.configured,
    getDeviceAuthDiagnosticViaBridge: async () => null,
    getDeviceAccessTokenViaBridge: async () => { bridge.refreshCalls += 1; return bridge.refreshToken; },
    getDeviceAccessTokenCachedOnlyViaBridge: async () => { bridge.cachedCalls += 1; return bridge.cachedToken; },
  },
});

const { pauseSync, deviceAuthRefreshOnly, deviceAuthReadonlyProbe } = await import('../../api/controllers/sync.controller.js');

const originalFetch = globalThis.fetch;
let fetchCalls = [];
let fetchResponder = null;

function fakeRes() {
  const res = { statusCode: 200, body: null };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (payload) => { res.body = payload; return res; };
  return res;
}
const REQ = { user: { id: 'admin-local', role: 'admin', tenant_id: 'tenant-pause-controls' } };

beforeEach(() => {
  svc.calls = { processFullSyncCycle: 0, pause: 0, resume: 0 };
  svc.state = { sync_active: true, paused_by_operator: false, cycle_running: false };
  bridge.refreshCalls = 0;
  bridge.cachedCalls = 0;
  bridge.configured = true;
  bridge.cachedToken = CACHED_TOKEN;
  fetchCalls = [];
  fetchResponder = () => new Response(JSON.stringify([{ id: ROW_ID_SECRET }]), { status: 200, headers: { 'content-type': 'application/json' } });
  globalThis.fetch = async (input, init = {}) => {
    fetchCalls.push({ url: String(input), headers: new Headers(init.headers) });
    return fetchResponder();
  };
});
after(() => { globalThis.fetch = originalFetch; });

function pauseNow() {
  svc.state = { sync_active: false, paused_by_operator: true, cycle_running: false };
}

test('pause: devolve o estado real (sync_active=false) e é idempotente', async () => {
  const r1 = fakeRes();
  await pauseSync(REQ, r1);
  assert.equal(r1.statusCode, 200);
  assert.deepEqual(r1.body.data, { sync_active: false, paused_by_operator: true, cycle_running: false });

  const r2 = fakeRes();
  await pauseSync(REQ, r2);
  assert.equal(r2.statusCode, 200);
  assert.deepEqual(r2.body.data, r1.body.data);
  assert.equal(svc.calls.processFullSyncCycle, 0, 'pausar nunca corre um ciclo');
});

test('refresh-only: REJEITADO enquanto o sync está activo (sem pausa) — nunca toca na ponte', async () => {
  const res = fakeRes();
  await deviceAuthRefreshOnly(REQ, res);
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.error.code, 'SYNC_NOT_PAUSED');
  assert.equal(res.body.data.reason, 'sync_not_paused');
  assert.equal(bridge.refreshCalls, 0);
});

test('refresh-only: REJEITADO se o timer ainda está vivo ou há ciclo em curso, mesmo com a flag de pausa', async () => {
  svc.state = { sync_active: true, paused_by_operator: true, cycle_running: false };
  let res = fakeRes();
  await deviceAuthRefreshOnly(REQ, res);
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.data.reason, 'sync_timer_active');

  svc.state = { sync_active: false, paused_by_operator: true, cycle_running: true };
  res = fakeRes();
  await deviceAuthRefreshOnly(REQ, res);
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.data.reason, 'sync_cycle_running');
  assert.equal(bridge.refreshCalls, 0);
});

test('refresh-only em pausa: chama a ponte EXACTAMENTE 1 vez, devolve só {ok}, nunca corre ciclos, nunca devolve o token', async () => {
  pauseNow();
  const res = fakeRes();
  await deviceAuthRefreshOnly(REQ, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.data, { ok: true });
  assert.equal(bridge.refreshCalls, 1);
  assert.equal(bridge.cachedCalls, 0);
  assert.equal(svc.calls.processFullSyncCycle, 0);
  assert.equal(fetchCalls.length, 0, 'nenhum pedido Supabase');
  assert.ok(!JSON.stringify(res.body).includes('fresh.runtime.jwt'));
});

test('refresh-only: ok=false quando a ponte não devolve token (nunca lança)', async () => {
  pauseNow();
  bridge.refreshToken = null;
  const res = fakeRes();
  await deviceAuthRefreshOnly(REQ, res);
  assert.deepEqual(res.body.data, { ok: false });
  bridge.refreshToken = 'fresh.runtime.jwt';
});

test('sonda: REJEITADA enquanto o sync está activo — sem ponte, sem rede', async () => {
  const res = fakeRes();
  await deviceAuthReadonlyProbe(REQ, res);
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.error.code, 'SYNC_NOT_PAUSED');
  assert.equal(bridge.cachedCalls, 0);
  assert.equal(bridge.refreshCalls, 0);
  assert.equal(fetchCalls.length, 0);
});

test('sonda em pausa: usa SÓ o token em cache (0 refresh), 1 pedido GET categories id limit 1, devolve só probe_success/status/row_count', async () => {
  pauseNow();
  const res = fakeRes();
  await deviceAuthReadonlyProbe(REQ, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.data, { probe_success: true, status: 200, row_count: 1 });

  assert.equal(bridge.refreshCalls, 0, 'a sonda NUNCA refresca');
  assert.equal(bridge.cachedCalls, 1);
  assert.equal(svc.calls.processFullSyncCycle, 0);

  assert.equal(fetchCalls.length, 1, 'um único pedido');
  const call = fetchCalls[0];
  assert.match(call.url, /\/rest\/v1\/categories\?select=id&limit=1$/);
  assert.equal(call.headers.get('authorization'), `Bearer ${CACHED_TOKEN}`, 'exactamente o token em cache');
  assert.equal(call.headers.get('apikey'), 'anon-key-test');

  const raw = JSON.stringify(res.body);
  assert.ok(!raw.includes(CACHED_TOKEN), 'nunca devolve o token');
  assert.ok(!raw.includes(ROW_ID_SECRET), 'nunca devolve conteúdo de linhas');
});

test('sonda sem token em cache: 409 DEVICE_TOKEN_NOT_CACHED, NUNCA refresca, sem rede', async () => {
  pauseNow();
  bridge.cachedToken = null;
  const res = fakeRes();
  await deviceAuthReadonlyProbe(REQ, res);
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.error.code, 'DEVICE_TOKEN_NOT_CACHED');
  assert.equal(bridge.refreshCalls, 0);
  assert.equal(fetchCalls.length, 0);
});

test('sonda: resposta de erro do Supabase (401) -> probe_success=false, status=401, row_count=null', async () => {
  pauseNow();
  fetchResponder = () => new Response(JSON.stringify({ code: 'PGRST301', message: 'JWT invalid' }), { status: 401, headers: { 'content-type': 'application/json' } });
  const res = fakeRes();
  await deviceAuthReadonlyProbe(REQ, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.data, { probe_success: false, status: 401, row_count: null });
  assert.ok(!JSON.stringify(res.body).includes('JWT invalid'), 'nunca devolve a mensagem de erro');
});
