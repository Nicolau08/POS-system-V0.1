/**
 * Etapa 1F.2 — infraestrutura do novo caminho de sync via Device JWT:
 * mapeamento boolean SQLite<->Postgres (item 17), classificação de erros
 * (item 23), e a ponte Electron<->API (itens 26-31), incluindo o cliente do
 * lado da API (single-flight local + never-fallback).
 */
import assert from 'node:assert/strict';
import { test, mock } from 'node:test';
import {
  toPgBoolean,
  fromPgBoolean,
} from '../../api/deviceAuth/pgBoolean.js';
import {
  classifySyncError,
  isRetryableWithoutPenalty,
  isDefinitive,
  DeviceAuthUnavailableError,
  SYNC_ERROR_KIND,
} from '../../api/deviceAuth/deviceSyncErrors.js';

// ---------------------------------------------------------------------------
// item 17 — mapeamento boolean explícito.
// ---------------------------------------------------------------------------

test('toPgBoolean: 0 -> false, 1 -> true (SQLite -> Postgres, direcção de push)', () => {
  assert.equal(toPgBoolean(0), false);
  assert.equal(toPgBoolean(1), true);
  assert.equal(toPgBoolean(false), false);
  assert.equal(toPgBoolean(true), true);
  assert.equal(toPgBoolean('0'), false);
  assert.equal(toPgBoolean('1'), true);
  assert.equal(toPgBoolean(null), false);
  assert.equal(toPgBoolean(undefined), false);
});

test('fromPgBoolean: false -> 0, true -> 1 (Postgres -> SQLite, direcção de pull)', () => {
  assert.equal(fromPgBoolean(false), 0);
  assert.equal(fromPgBoolean(true), 1);
  assert.equal(fromPgBoolean(0), 0);
  assert.equal(fromPgBoolean(1), 1);
  assert.equal(fromPgBoolean(null), 0);
  assert.equal(fromPgBoolean(undefined), 0);
});

// ---------------------------------------------------------------------------
// item 23 — classificação de erros do novo sync.
// ---------------------------------------------------------------------------

test('classifySyncError: DeviceAuthUnavailableError -> AUTH_TEMPORARY, nunca penaliza retry', () => {
  const kind = classifySyncError(new DeviceAuthUnavailableError());
  assert.equal(kind, SYNC_ERROR_KIND.AUTH_TEMPORARY);
  assert.equal(isRetryableWithoutPenalty(kind), true);
  assert.equal(isDefinitive(kind), false);
});

test('classifySyncError: falha de rede -> NETWORK, nunca penaliza retry', () => {
  const err = new TypeError('fetch failed');
  err.cause = { code: 'ECONNREFUSED' };
  const kind = classifySyncError(err);
  assert.equal(kind, SYNC_ERROR_KIND.NETWORK);
  assert.equal(isRetryableWithoutPenalty(kind), true);
});

test('classifySyncError: device_revoked -> DEVICE_REVOKED', () => {
  const kind = classifySyncError(new Error('device_revoked'));
  assert.equal(kind, SYNC_ERROR_KIND.DEVICE_REVOKED);
  assert.equal(isRetryableWithoutPenalty(kind), false);
  assert.equal(isDefinitive(kind), false);
});

test('classifySyncError: license_suspended/license_expired -> LICENSE_SUSPENDED', () => {
  assert.equal(classifySyncError(new Error('license_suspended')), SYNC_ERROR_KIND.LICENSE_SUSPENDED);
  assert.equal(classifySyncError(new Error('license_expired')), SYNC_ERROR_KIND.LICENSE_SUSPENDED);
});

test('classifySyncError: tenant_suspended/tenant_not_found -> TENANT_SUSPENDED', () => {
  assert.equal(classifySyncError(new Error('tenant_suspended')), SYNC_ERROR_KIND.TENANT_SUSPENDED);
  assert.equal(classifySyncError(new Error('tenant_not_found')), SYNC_ERROR_KIND.TENANT_SUSPENDED);
});

test('classifySyncError: 42501 / permission denied -> RLS_DENIED, definitivo', () => {
  const err = new Error('permission denied for table users');
  err.code = '42501';
  const kind = classifySyncError(err);
  assert.equal(kind, SYNC_ERROR_KIND.RLS_DENIED);
  assert.equal(isDefinitive(kind), true);
  assert.equal(isRetryableWithoutPenalty(kind), false);
});

test('classifySyncError: null value / violates -> VALIDATION, definitivo', () => {
  const kind = classifySyncError(new Error('null value in column "name" violates not-null constraint'));
  assert.equal(kind, SYNC_ERROR_KIND.VALIDATION);
  assert.equal(isDefinitive(kind), true);
});

test('classifySyncError: erro desconhecido -> SERVER (nem retry-sem-penalização nem definitivo)', () => {
  const kind = classifySyncError(new Error('something truly unexpected'));
  assert.equal(kind, SYNC_ERROR_KIND.SERVER);
  assert.equal(isRetryableWithoutPenalty(kind), false);
  assert.equal(isDefinitive(kind), false);
});

// ---------------------------------------------------------------------------
// itens 26-31 — ponte Electron -> API (servidor real, loopback, efémero).
// ---------------------------------------------------------------------------

mock.module('electron', { exports: { safeStorage: { isEncryptionAvailable: () => true } } });
mock.module('../../electron/deviceAuth/deviceAuthClient.js', {
  exports: {
    getValidAccessToken: async () => globalThis.__testBridgeAccessToken ?? null,
    // Pilot Gate — diagnóstico de runtime (device-auth-runtime-diagnostic.test.mjs
    // testa peekDeviceAuthDiagnostic() a sério; aqui só precisa de existir para
    // deviceAuthBridge.js poder importar o módulo mockado sem rebentar.
    peekDeviceAuthDiagnostic: () => ({ credentials_present: false }),
    peekValidAccessToken: () => null,
  },
});

const { startDeviceAuthBridge, stopDeviceAuthBridge } = await import('../../electron/deviceAuth/deviceAuthBridge.js');

test('deviceAuthBridge: bind só em 127.0.0.1, porta efémera (nunca fixa)', async () => {
  globalThis.__testBridgeAccessToken = 'token-x';
  const { url, secret } = await startDeviceAuthBridge({ userDataPath: '/tmp/x', issuerBaseUrl: 'http://issuer.local' });
  try {
    assert.match(url, /^http:\/\/127\.0\.0\.1:\d+\/access-token$/);
    assert.ok(secret.length >= 32, 'segredo deve ser suficientemente longo (32 bytes hex = 64 chars)');
  } finally {
    stopDeviceAuthBridge();
  }
});

test('deviceAuthBridge: pedido sem Authorization -> 401, nunca devolve o token', async () => {
  globalThis.__testBridgeAccessToken = 'token-secreto';
  const { url } = await startDeviceAuthBridge({ userDataPath: '/tmp/x', issuerBaseUrl: 'http://issuer.local' });
  try {
    const res = await fetch(url, { method: 'POST', body: '{}' });
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.ok, false);
    assert.equal(JSON.stringify(body).includes('token-secreto'), false);
  } finally {
    stopDeviceAuthBridge();
  }
});

test('deviceAuthBridge: segredo errado -> 401', async () => {
  globalThis.__testBridgeAccessToken = 'token-secreto';
  const { url } = await startDeviceAuthBridge({ userDataPath: '/tmp/x', issuerBaseUrl: 'http://issuer.local' });
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: 'Bearer segredo-errado' },
      body: '{}',
    });
    assert.equal(res.status, 401);
  } finally {
    stopDeviceAuthBridge();
  }
});

test('deviceAuthBridge: GET é rejeitado (só POST é aceite — item 30)', async () => {
  const { url, secret } = await startDeviceAuthBridge({ userDataPath: '/tmp/x', issuerBaseUrl: 'http://issuer.local' });
  try {
    const res = await fetch(url, { method: 'GET', headers: { Authorization: `Bearer ${secret}` } });
    assert.equal(res.status, 404);
  } finally {
    stopDeviceAuthBridge();
  }
});

test('deviceAuthBridge: segredo correcto + POST -> devolve o access token actual', async () => {
  globalThis.__testBridgeAccessToken = 'access-real-123';
  const { url, secret } = await startDeviceAuthBridge({ userDataPath: '/tmp/x', issuerBaseUrl: 'http://issuer.local' });
  try {
    const res = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${secret}` }, body: '{}' });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.accessToken, 'access-real-123');
  } finally {
    stopDeviceAuthBridge();
  }
});

test('deviceAuthBridge: sem token disponível (device auth em baixo) -> ok:false, nunca 500 com detalhe interno', async () => {
  globalThis.__testBridgeAccessToken = null;
  const { url, secret } = await startDeviceAuthBridge({ userDataPath: '/tmp/x', issuerBaseUrl: 'http://issuer.local' });
  try {
    const res = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${secret}` }, body: '{}' });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, false);
    assert.equal(body.error, 'device_auth_unavailable');
  } finally {
    stopDeviceAuthBridge();
  }
});

// ---------------------------------------------------------------------------
// Cliente da ponte do lado da API — single-flight local + config ausente.
// ---------------------------------------------------------------------------

test('deviceAuthBridgeClient: sem POS_DEVICE_AUTH_BRIDGE_URL/_SECRET -> null, nunca tenta rede', async () => {
  delete process.env.POS_DEVICE_AUTH_BRIDGE_URL;
  delete process.env.POS_DEVICE_AUTH_BRIDGE_SECRET;
  const { getDeviceAccessTokenViaBridge, isDeviceAuthBridgeConfigured } = await import(
    `../../api/deviceAuth/deviceAuthBridgeClient.js?t=${Date.now()}-a`
  );
  assert.equal(isDeviceAuthBridgeConfigured(), false);
  const token = await getDeviceAccessTokenViaBridge();
  assert.equal(token, null);
});

test('deviceAuthBridgeClient: single-flight — 5 chamadas concorrentes -> 1 pedido HTTP à ponte', async () => {
  globalThis.__testBridgeAccessToken = 'bridge-token-concurrent';
  const { url, secret } = await startDeviceAuthBridge({ userDataPath: '/tmp/x', issuerBaseUrl: 'http://issuer.local' });
  process.env.POS_DEVICE_AUTH_BRIDGE_URL = url;
  process.env.POS_DEVICE_AUTH_BRIDGE_SECRET = secret;
  try {
    const { getDeviceAccessTokenViaBridge } = await import(
      `../../api/deviceAuth/deviceAuthBridgeClient.js?t=${Date.now()}-b`
    );
    const results = await Promise.all(Array.from({ length: 5 }, () => getDeviceAccessTokenViaBridge()));
    for (const token of results) {
      assert.equal(token, 'bridge-token-concurrent');
    }
  } finally {
    stopDeviceAuthBridge();
    delete process.env.POS_DEVICE_AUTH_BRIDGE_URL;
    delete process.env.POS_DEVICE_AUTH_BRIDGE_SECRET;
  }
});

// ---------------------------------------------------------------------------
// itens 6-7-32-33 — cliente Supabase por device: nunca service_role, nunca
// fallback silencioso.
//
// mock.module só pode ser registado UMA VEZ por especificador neste processo
// de teste — o comportamento é controlado por este estado mutável partilhado,
// nunca por re-registar o mock em cada teste.
// ---------------------------------------------------------------------------

const bridgeClientMockState = { tokenValue: null, calls: 0 };
mock.module('../../api/deviceAuth/deviceAuthBridgeClient.js', {
  exports: {
    getDeviceAccessTokenViaBridge: async () => {
      bridgeClientMockState.calls += 1;
      return bridgeClientMockState.tokenValue;
    },
    isDeviceAuthBridgeConfigured: () => true,
  },
});

test('getDeviceSupabase: sem SUPABASE_URL/ANON_KEY -> null (nunca cria cliente meio-configurado)', async () => {
  const originalUrl = process.env.SUPABASE_URL;
  const originalAnon = process.env.SUPABASE_ANON_KEY;
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_ANON_KEY;
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  bridgeClientMockState.tokenValue = null;
  try {
    const { getDeviceSupabase } = await import(`../../api/deviceAuth/deviceSupabaseClient.js?t=${Date.now()}-c`);
    assert.equal(getDeviceSupabase(), null);
  } finally {
    if (originalUrl) process.env.SUPABASE_URL = originalUrl;
    if (originalAnon) process.env.SUPABASE_ANON_KEY = originalAnon;
  }
});

test('getDeviceSupabase: NUNCA lê SUPABASE_SERVICE_ROLE_KEY (prova no-service-role, item 32/33)', async () => {
  process.env.SUPABASE_URL = 'http://127.0.0.1:54321';
  process.env.SUPABASE_ANON_KEY = 'anon-key-not-secret';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'SERVICE-ROLE-SECRET-SHOULD-NEVER-BE-USED';
  bridgeClientMockState.tokenValue = 'device-jwt-xyz';
  try {
    const moduleSrc = await import('node:fs').then((fs) =>
      fs.readFileSync(new URL('../../api/deviceAuth/deviceSupabaseClient.js', import.meta.url), 'utf8'),
    );
    assert.equal(
      moduleSrc.includes('process.env.SUPABASE_SERVICE_ROLE_KEY'),
      false,
      'o código nunca deve LER process.env.SUPABASE_SERVICE_ROLE_KEY (comentários explicando a exclusão são permitidos)',
    );

    let capturedAuthHeader = null;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, options) => {
      capturedAuthHeader = new Headers(options?.headers).get('Authorization');
      return new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
    try {
      const { getDeviceSupabase } = await import(`../../api/deviceAuth/deviceSupabaseClient.js?t=${Date.now()}-d`);
      const client = getDeviceSupabase();
      assert.ok(client, 'cliente deve ser criado com URL+anon key presentes');
      await client.from('categories').select('id');
      assert.equal(capturedAuthHeader, 'Bearer device-jwt-xyz', 'a única credencial usada é o device JWT — nunca service_role');
      assert.equal(String(capturedAuthHeader).includes('SERVICE-ROLE-SECRET'), false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  } finally {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_ANON_KEY;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  }
});

test('getDeviceSupabase: sem access token disponível -> chamada lança DeviceAuthUnavailableError, NUNCA chega à rede (prova no-fallback, item 33)', async () => {
  process.env.SUPABASE_URL = 'http://127.0.0.1:54321';
  process.env.SUPABASE_ANON_KEY = 'anon-key-not-secret';
  bridgeClientMockState.tokenValue = null;
  try {
    let networkCalled = false;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      networkCalled = true;
      throw new Error('nunca deveria ser chamado');
    };
    try {
      const { getDeviceSupabase } = await import(`../../api/deviceAuth/deviceSupabaseClient.js?t=${Date.now()}-e`);
      const client = getDeviceSupabase();
      const { error } = await client.from('categories').select('id');
      assert.ok(error, 'supabase-js devolve o erro do fetch personalizado em vez de lançar');
      assert.equal(networkCalled, false, 'nunca deve tentar a rede sem token — falha ANTES do fetch real');
    } finally {
      globalThis.fetch = originalFetch;
    }
  } finally {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_ANON_KEY;
  }
});

test('isDeviceAuthAvailable: reflecte disponibilidade real da ponte, com cache curto', async () => {
  process.env.SUPABASE_URL = 'http://127.0.0.1:54321';
  process.env.SUPABASE_ANON_KEY = 'anon-key-not-secret';
  bridgeClientMockState.tokenValue = 'ok-token';
  bridgeClientMockState.calls = 0;
  try {
    const { isDeviceAuthAvailable } = await import(`../../api/deviceAuth/deviceSupabaseClient.js?t=${Date.now()}-f`);
    assert.equal(await isDeviceAuthAvailable(), true);
    bridgeClientMockState.tokenValue = null;
    // Dentro da janela de cache (2s), ainda devolve o valor anterior.
    assert.equal(await isDeviceAuthAvailable(), true);
    assert.equal(bridgeClientMockState.calls, 1, 'segunda chamada dentro da janela de cache não deve tocar a ponte outra vez');
  } finally {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_ANON_KEY;
  }
});
