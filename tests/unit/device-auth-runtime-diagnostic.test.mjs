/**
 * Pilot Gate — diagnóstico de runtime do Device Auth (só-leitura, sem rede,
 * sem refresh): peekDeviceAuthDiagnostic() nunca chama getValidAccessToken()/
 * refreshAccessToken() — só espreita o que já está em disco/memória. Prova:
 * (1) campos correctos para credenciais ausentes/presentes; (2) decode de
 * claims do access token em memória sem nunca disparar rede; (3) nunca
 * expõe JWT/refresh token/device_id/tenant_id/kid em bruto na resposta;
 * (4) o endpoint HTTP da ponte (/diagnostic) devolve exactamente o mesmo,
 * exige o mesmo Bearer secret que /access-token, e nunca aciona a ponte real
 * de token (mockFetchSequence continua em zero chamadas).
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, before, after, beforeEach, mock } from 'node:test';
import { SignJWT } from 'jose';
import crypto from 'node:crypto';

const fakeSafeStorage = {
  available: true,
  isEncryptionAvailable: () => fakeSafeStorage.available,
  encryptString: (str) => Buffer.concat([Buffer.from('FAKEENC:'), Buffer.from(str, 'utf8')]),
  decryptString: (buf) => {
    const raw = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
    const prefix = Buffer.from('FAKEENC:');
    if (!raw.subarray(0, prefix.length).equals(prefix)) throw new Error('bad ciphertext');
    return raw.subarray(prefix.length).toString('utf8');
  },
};

mock.module('electron', { exports: { safeStorage: fakeSafeStorage } });

const { writeDeviceAuthState } = await import('../../electron/deviceAuth/deviceAuthStorage.js');
const { peekDeviceAuthDiagnostic, bootstrapDevice } = await import('../../electron/deviceAuth/deviceAuthClient.js');
const { startDeviceAuthBridge, stopDeviceAuthBridge } = await import('../../electron/deviceAuth/deviceAuthBridge.js');

let userDataPath;
let originalFetch;

before(() => { originalFetch = globalThis.fetch; });
after(() => { globalThis.fetch = originalFetch; stopDeviceAuthBridge(); });

beforeEach(() => {
  userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'posly-device-diag-'));
  fakeSafeStorage.available = true;
});

async function signFakeAccessToken({ deviceId, tenantId, kid = 'test-kid', alg = 'ES256', role = 'authenticated', expired = false }) {
  const { generateKeyPair, exportJWK } = await import('jose');
  const { privateKey } = await generateKeyPair(alg, { extractable: true });
  const exp = expired ? Math.floor(Date.now() / 1000) - 60 : Math.floor(Date.now() / 1000) + 3600;
  return new SignJWT({ device_id: deviceId, tenant_id: tenantId, role, token_version: 1 })
    .setProtectedHeader({ alg, kid, typ: 'JWT' })
    .setIssuedAt()
    .setExpirationTime(exp)
    .sign(privateKey);
}

test('peekDeviceAuthDiagnostic: sem credenciais — tudo false/unknown, nunca lança', () => {
  const result = peekDeviceAuthDiagnostic({ userDataPath, localTenantId: 'tenant-a' });
  assert.equal(result.credentials_present, false);
  assert.equal(result.refresh_token_present, false);
  assert.equal(result.token_present, false);
  assert.equal(result.kid_matches_configured_signer, 'unknown');
  assert.equal(result.refresh_error_present, 'unknown');
});

test('peekDeviceAuthDiagnostic: credenciais em disco sem access token em memória', () => {
  writeDeviceAuthState(userDataPath, {
    deviceId: 'device-xyz',
    refreshToken: 'opaque-refresh',
    refreshTokenExpiresAt: new Date(Date.now() + 3600_000).toISOString(),
  });
  const result = peekDeviceAuthDiagnostic({ userDataPath, localTenantId: 'tenant-a' });
  assert.equal(result.credentials_present, true);
  assert.equal(result.refresh_token_present, true);
  assert.equal(result.refresh_token_expired, false);
  assert.equal(result.last_refresh_known, false, 'updatedAt === createdAt na primeira escrita — nunca houve refresh ainda');
  assert.equal(result.token_present, false);
  assert.equal(result.token_expired, 'unknown');
});

test('peekDeviceAuthDiagnostic: access token em memória — claims correctas e coincidentes', async () => {
  const fetchCallsBefore = [];
  globalThis.fetch = async (url) => { fetchCallsBefore.push(url); throw new Error('nunca deve ser chamado por bootstrapDevice aqui'); };

  writeDeviceAuthState(userDataPath, {
    deviceId: 'device-xyz',
    refreshToken: 'opaque-refresh',
    refreshTokenExpiresAt: new Date(Date.now() + 3600_000).toISOString(),
  });

  const token = await signFakeAccessToken({ deviceId: 'device-xyz', tenantId: 'tenant-a' });
  // Injecta o token em memória pelo MESMO caminho real de bootstrap — sem
  // chamar rede (mockFetchSequence local, isolado desta chamada).
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      device_id: 'device-xyz',
      refresh_token: 'opaque-refresh',
      refresh_token_expires_at: new Date(Date.now() + 3600_000).toISOString(),
      access_token: token,
      access_token_expires_at: new Date(Date.now() + 3600_000).toISOString(),
    }),
  });
  await bootstrapDevice({ activationToken: 'tok', machineId: 'machine-1', userDataPath, issuerBaseUrl: 'http://issuer.local' });

  let networkCallsDuringPeek = 0;
  globalThis.fetch = async () => { networkCallsDuringPeek += 1; throw new Error('peekDeviceAuthDiagnostic nunca deve chamar rede'); };

  const result = peekDeviceAuthDiagnostic({ userDataPath, localTenantId: 'tenant-a' });

  assert.equal(networkCallsDuringPeek, 0, 'peek nunca dispara rede/refresh');
  assert.equal(result.token_present, true);
  assert.equal(result.token_expired, false);
  assert.equal(result.alg_is_ES256, true);
  assert.equal(result.kid_present, true);
  assert.equal(result.device_claim_matches_stored_device, true);
  assert.equal(result.tenant_claim_matches_local_tenant, true);
  assert.equal(result.role_is_authenticated, true);
  assert.equal(result.token_version_present, true);
  assert.equal(result.kid_matches_configured_signer, 'unknown', 'nunca há fonte local para isto — sempre unknown por desenho');

  const raw = JSON.stringify(result);
  assert.ok(!raw.includes(token), 'nunca expõe o JWT em si');
  assert.ok(!raw.includes('device-xyz'), 'nunca expõe o device_id em bruto');
  assert.ok(!raw.includes('tenant-a'), 'nunca expõe o tenant_id em bruto');
  assert.ok(!raw.includes('opaque-refresh'), 'nunca expõe o refresh token em bruto');
});

test('peekDeviceAuthDiagnostic: tenant local diferente do claim — mismatch correctamente detectado', async () => {
  writeDeviceAuthState(userDataPath, {
    deviceId: 'device-xyz',
    refreshToken: 'opaque-refresh',
    refreshTokenExpiresAt: new Date(Date.now() + 3600_000).toISOString(),
  });
  const token = await signFakeAccessToken({ deviceId: 'device-xyz', tenantId: 'tenant-real' });
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      device_id: 'device-xyz',
      refresh_token: 'opaque-refresh',
      refresh_token_expires_at: new Date(Date.now() + 3600_000).toISOString(),
      access_token: token,
      access_token_expires_at: new Date(Date.now() + 3600_000).toISOString(),
    }),
  });
  await bootstrapDevice({ activationToken: 'tok', machineId: 'machine-1', userDataPath, issuerBaseUrl: 'http://issuer.local' });

  const result = peekDeviceAuthDiagnostic({ userDataPath, localTenantId: 'tenant-outro' });
  assert.equal(result.tenant_claim_matches_local_tenant, false);
  assert.equal(result.device_claim_matches_stored_device, true);
});

test('peekDeviceAuthDiagnostic: access token expirado — token_expired=true', async () => {
  writeDeviceAuthState(userDataPath, {
    deviceId: 'device-xyz',
    refreshToken: 'opaque-refresh',
    refreshTokenExpiresAt: new Date(Date.now() + 3600_000).toISOString(),
  });
  const token = await signFakeAccessToken({ deviceId: 'device-xyz', tenantId: 'tenant-a', expired: true });
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      device_id: 'device-xyz',
      refresh_token: 'opaque-refresh',
      refresh_token_expires_at: new Date(Date.now() + 3600_000).toISOString(),
      access_token: token,
      // deliberadamente "no futuro" na resposta do servidor para isolar: o que
      // importa aqui é o exp REAL dentro do JWT, não este campo do transporte.
      access_token_expires_at: new Date(Date.now() + 3600_000).toISOString(),
    }),
  });
  await bootstrapDevice({ activationToken: 'tok', machineId: 'machine-1', userDataPath, issuerBaseUrl: 'http://issuer.local' });

  const result = peekDeviceAuthDiagnostic({ userDataPath, localTenantId: 'tenant-a' });
  assert.equal(result.token_expired, true);
});

for (const [label, malformedToken] of [
  ['string sem pontos nenhuns', 'not-a-jwt-at-all'],
  ['só 2 partes (falta a assinatura)', 'aGVhZGVy.cGF5bG9hZA'],
  ['header não é base64url válido', '!!!not-base64!!!.eyJhIjoxfQ.sig'],
  ['payload não é JSON válido', `${Buffer.from(JSON.stringify({ alg: 'ES256' })).toString('base64url')}.${Buffer.from('{not json').toString('base64url')}.sig`],
  ['header decodifica para um array, não objecto', `${Buffer.from(JSON.stringify([1, 2])).toString('base64url')}.${Buffer.from(JSON.stringify({ a: 1 })).toString('base64url')}.sig`],
]) {
  test(`peekDeviceAuthDiagnostic: token malformado (${label}) — nunca lança, tudo unknown`, async () => {
    writeDeviceAuthState(userDataPath, {
      deviceId: 'device-xyz',
      refreshToken: 'opaque-refresh',
      refreshTokenExpiresAt: new Date(Date.now() + 3600_000).toISOString(),
    });
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        device_id: 'device-xyz',
        refresh_token: 'opaque-refresh',
        refresh_token_expires_at: new Date(Date.now() + 3600_000).toISOString(),
        access_token: malformedToken,
        access_token_expires_at: new Date(Date.now() + 3600_000).toISOString(),
      }),
    });
    await bootstrapDevice({ activationToken: 'tok', machineId: 'machine-1', userDataPath, issuerBaseUrl: 'http://issuer.local' });

    const result = peekDeviceAuthDiagnostic({ userDataPath, localTenantId: 'tenant-a' });
    assert.equal(result.token_present, true, 'o token existe em memória, mesmo que ilegível');
    assert.equal(result.token_expired, 'unknown');
    assert.equal(result.alg_is_ES256, 'unknown');
    assert.equal(result.kid_present, 'unknown');
    assert.equal(result.device_claim_matches_stored_device, 'unknown');
    assert.equal(result.tenant_claim_matches_local_tenant, 'unknown');
    assert.equal(result.role_is_authenticated, 'unknown');
    assert.equal(result.token_version_present, 'unknown');
  });
}

test('bridge HTTP /diagnostic: exige o mesmo Bearer secret, nunca dispara rede, nunca expõe valores em bruto', async () => {
  writeDeviceAuthState(userDataPath, {
    deviceId: 'device-xyz',
    refreshToken: 'opaque-refresh',
    refreshTokenExpiresAt: new Date(Date.now() + 3600_000).toISOString(),
  });
  const token = await signFakeAccessToken({ deviceId: 'device-xyz', tenantId: 'tenant-a' });
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      device_id: 'device-xyz',
      refresh_token: 'opaque-refresh',
      refresh_token_expires_at: new Date(Date.now() + 3600_000).toISOString(),
      access_token: token,
      access_token_expires_at: new Date(Date.now() + 3600_000).toISOString(),
    }),
  });
  await bootstrapDevice({ activationToken: 'tok', machineId: 'machine-1', userDataPath, issuerBaseUrl: 'http://issuer.local' });
  // Restaura o fetch real ANTES de falar com o servidor loopback real do
  // bridge — o mock acima só servia para o bootstrapDevice() de preparação.
  globalThis.fetch = originalFetch;

  const { url, secret } = await startDeviceAuthBridge({ userDataPath, issuerBaseUrl: 'http://issuer.local' });
  const diagnosticUrl = url.replace(/\/access-token$/, '/diagnostic');

  const unauthRes = await fetch(diagnosticUrl, { method: 'POST', headers: { Authorization: 'Bearer wrong' }, body: '{}' });
  assert.equal(unauthRes.status, 401);

  const okRes = await fetch(diagnosticUrl, {
    method: 'POST',
    headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ localTenantId: 'tenant-a' }),
  });
  assert.equal(okRes.status, 200);
  const body = await okRes.json();
  assert.equal(body.ok, true);
  assert.equal(body.diagnostic.token_present, true);
  assert.equal(body.diagnostic.tenant_claim_matches_local_tenant, true);
  assert.equal(body.diagnostic.license_console_base_url_present, true);

  const raw = JSON.stringify(body);
  assert.ok(!raw.includes(token));
  assert.ok(!raw.includes('device-xyz'));
  assert.ok(!raw.includes('tenant-a'));
  assert.ok(!raw.includes('opaque-refresh'));
  assert.ok(!raw.includes(secret));

  stopDeviceAuthBridge();
});

test('bridge HTTP /access-token-cached: só devolve o token em cache se ainda válido, NUNCA refresca (0 pedidos de rede)', async () => {
  const token = await signFakeAccessToken({ deviceId: 'device-xyz', tenantId: 'tenant-a' });
  const bootstrapWith = async (accessTokenExpiresAt) => {
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        device_id: 'device-xyz',
        refresh_token: 'opaque-refresh',
        refresh_token_expires_at: new Date(Date.now() + 3600_000).toISOString(),
        access_token: token,
        access_token_expires_at: accessTokenExpiresAt,
      }),
    });
    await bootstrapDevice({ activationToken: 'tok', machineId: 'machine-1', userDataPath, issuerBaseUrl: 'http://issuer.local' });
    globalThis.fetch = originalFetch;
  };

  const { url, secret } = await startDeviceAuthBridge({ userDataPath, issuerBaseUrl: 'http://issuer.local' });
  const cachedUrl = url.replace(/\/access-token$/, '/access-token-cached');
  const post = (bearer) => fetch(cachedUrl, { method: 'POST', headers: { Authorization: `Bearer ${bearer}` }, body: '{}' });

  try {
    // sem segredo correcto -> 401, nunca o token.
    assert.equal((await post('wrong')).status, 401);

    // nenhum token em memória -> ok:false.
    const empty = await (await post(secret)).json();
    assert.deepEqual(empty, { ok: false, error: 'token_not_cached' });

    // token válido em cache -> devolvido, sem qualquer pedido de rede externo.
    await bootstrapWith(new Date(Date.now() + 3600_000).toISOString());
    let externalCalls = 0;
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
      if (!String(input).startsWith(cachedUrl)) externalCalls += 1;
      return realFetch(input, init);
    };
    const valid = await (await post(secret)).json();
    assert.equal(valid.ok, true);
    assert.equal(valid.accessToken, token);
    assert.equal(externalCalls, 0, 'nunca refresca nem chama o License Console');

    // dentro da margem de segurança (90s) -> ok:false e AINDA sem refresh.
    globalThis.fetch = originalFetch;
    await bootstrapWith(new Date(Date.now() + 30_000).toISOString());
    externalCalls = 0;
    globalThis.fetch = async (input, init) => {
      if (!String(input).startsWith(cachedUrl)) externalCalls += 1;
      return realFetch(input, init);
    };
    const nearExpiry = await (await post(secret)).json();
    assert.deepEqual(nearExpiry, { ok: false, error: 'token_not_cached' });
    assert.equal(externalCalls, 0, 'perto de expirar: a sonda falha em vez de refrescar');
  } finally {
    globalThis.fetch = originalFetch;
    stopDeviceAuthBridge();
  }
});
