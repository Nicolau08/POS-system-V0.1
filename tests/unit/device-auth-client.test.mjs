/**
 * DeviceAuthClient (Etapa 1F.1) — bootstrap/refresh/storage/offline-first.
 * safeStorage mockado via node:test mock.module (mesmo padrão de
 * stock-tenant-isolation.test.mjs); fetch mockado por teste.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, before, after, beforeEach, mock } from 'node:test';

// safeStorage falso: "encripta" com um prefixo reconhecível (suficiente para
// provar round-trip e simular corrupção/indisponibilidade sem depender do
// Electron real, que não corre em `node --test`).
const fakeSafeStorage = {
  available: true,
  isEncryptionAvailable: () => fakeSafeStorage.available,
  encryptString: (str) => Buffer.concat([Buffer.from('FAKEENC:'), Buffer.from(str, 'utf8')]),
  decryptString: (buf) => {
    const raw = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
    const prefix = Buffer.from('FAKEENC:');
    if (!raw.subarray(0, prefix.length).equals(prefix)) {
      throw new Error('bad ciphertext');
    }
    return raw.subarray(prefix.length).toString('utf8');
  },
};

mock.module('electron', {
  exports: { safeStorage: fakeSafeStorage },
});

const { readDeviceAuthState, writeDeviceAuthState, clearDeviceAuthState } = await import(
  '../../electron/deviceAuth/deviceAuthStorage.js'
);
const {
  bootstrapDevice,
  refreshAccessToken,
  getValidAccessToken,
  getDeviceIdentity,
  clearDeviceCredentials,
  initDeviceAuthNonBlocking,
} = await import('../../electron/deviceAuth/deviceAuthClient.js');

let userDataPath;
let originalFetch;

before(() => {
  originalFetch = globalThis.fetch;
});

after(() => {
  globalThis.fetch = originalFetch;
});

beforeEach(() => {
  userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'posly-device-auth-'));
  fakeSafeStorage.available = true;
});

function mockFetchSequence(responses) {
  let call = 0;
  globalThis.fetch = async (_url, _opts) => {
    const next = responses[Math.min(call, responses.length - 1)];
    call += 1;
    if (next.networkError) {
      throw new Error(next.networkError);
    }
    return {
      ok: next.status < 300,
      status: next.status,
      json: async () => next.body,
    };
  };
  return () => call;
}

test('deviceAuthStorage: grava e lê estado de forma atómica (tmp+rename)', () => {
  writeDeviceAuthState(userDataPath, {
    deviceId: 'dev-1',
    refreshToken: 'rt-1',
    refreshTokenExpiresAt: '2027-01-01T00:00:00.000Z',
  });
  const files = fs.readdirSync(userDataPath);
  assert.ok(!files.some((f) => f.endsWith('.tmp')), 'não deve sobrar ficheiro .tmp');

  const read = readDeviceAuthState(userDataPath);
  assert.equal(read.ok, true);
  assert.equal(read.state.deviceId, 'dev-1');
  assert.equal(read.state.refreshToken, 'rt-1');
});

test('deviceAuthStorage: ficheiro corrompido nunca crasha — devolve unreadable', () => {
  fs.writeFileSync(path.join(userDataPath, 'device-auth.json'), 'lixo-nao-encriptado');
  const read = readDeviceAuthState(userDataPath);
  assert.equal(read.ok, false);
  assert.equal(read.reason, 'unreadable');
});

test('deviceAuthStorage: sem ficheiro — not_found (nunca lança)', () => {
  const read = readDeviceAuthState(userDataPath);
  assert.equal(read.ok, false);
  assert.equal(read.reason, 'not_found');
});

test('bootstrapDevice: sucesso grava device_id+refresh e devolve access token', async () => {
  mockFetchSequence([
    {
      status: 200,
      body: {
        device_id: 'device-abc',
        refresh_token: 'refresh-abc',
        refresh_token_expires_at: '2027-01-01T00:00:00.000Z',
        access_token: 'access-abc',
        access_token_expires_at: new Date(Date.now() + 3600_000).toISOString(),
      },
    },
  ]);

  const result = await bootstrapDevice({
    activationToken: 'ACT-1',
    machineId: 'machine-1',
    userDataPath,
    issuerBaseUrl: 'http://issuer.local',
  });

  assert.equal(result.ok, true);
  assert.equal(result.deviceId, 'device-abc');
  assert.equal(result.accessToken, 'access-abc');

  const stored = readDeviceAuthState(userDataPath);
  assert.equal(stored.ok, true);
  assert.equal(stored.state.deviceId, 'device-abc');
  assert.equal(stored.state.refreshToken, 'refresh-abc');
});

test('bootstrapDevice: token de activação inválido — nada é persistido', async () => {
  mockFetchSequence([{ status: 401, body: { error: 'Credencial inválida.', code: 'invalid_activation' } }]);

  const result = await bootstrapDevice({
    activationToken: 'BAD',
    machineId: 'machine-1',
    userDataPath,
    issuerBaseUrl: 'http://issuer.local',
  });

  assert.equal(result.ok, false);
  assert.equal(result.kind, 'INVALID_REQUEST');
  const stored = readDeviceAuthState(userDataPath);
  assert.equal(stored.ok, false);
});

test('bootstrapDevice: falha de rede — classificada como NETWORK_ERROR, nada persistido', async () => {
  mockFetchSequence([{ networkError: 'ECONNREFUSED' }]);

  const result = await bootstrapDevice({
    activationToken: 'ACT-1',
    machineId: 'machine-1',
    userDataPath,
    issuerBaseUrl: 'http://issuer.local',
  });

  assert.equal(result.ok, false);
  assert.equal(result.kind, 'NETWORK_ERROR');
  assert.equal(readDeviceAuthState(userDataPath).ok, false);
});

test('bootstrapDevice: sem activation_token/machine_id — erro imediato, sem chamar rede', async () => {
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    throw new Error('não deveria ser chamado');
  };
  const result = await bootstrapDevice({
    activationToken: '',
    machineId: 'machine-1',
    userDataPath,
    issuerBaseUrl: 'http://issuer.local',
  });
  assert.equal(result.ok, false);
  assert.equal(called, false);
});

test('refreshAccessToken: sem credenciais guardadas — NO_CREDENTIALS, sem chamar rede', async () => {
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    throw new Error('não deveria ser chamado');
  };
  const result = await refreshAccessToken({ userDataPath, issuerBaseUrl: 'http://issuer.local' });
  assert.equal(result.ok, false);
  assert.equal(result.kind, 'NO_CREDENTIALS');
  assert.equal(called, false);
});

test('refreshAccessToken: sucesso roda o refresh token e actualiza o access token em memória', async () => {
  writeDeviceAuthState(userDataPath, {
    deviceId: 'device-abc',
    refreshToken: 'refresh-old',
    refreshTokenExpiresAt: '2027-01-01T00:00:00.000Z',
  });

  mockFetchSequence([
    {
      status: 200,
      body: {
        access_token: 'access-new',
        access_token_expires_at: new Date(Date.now() + 3600_000).toISOString(),
        refresh_token: 'refresh-new',
        refresh_token_expires_at: '2027-02-01T00:00:00.000Z',
      },
    },
  ]);

  const result = await refreshAccessToken({ userDataPath, issuerBaseUrl: 'http://issuer.local' });
  assert.equal(result.ok, true);
  assert.equal(result.accessToken, 'access-new');

  const stored = readDeviceAuthState(userDataPath);
  assert.equal(stored.state.refreshToken, 'refresh-new', 'refresh token tem de rodar');
  assert.equal(stored.state.deviceId, 'device-abc', 'device_id preservado através da rotação');
});

test('refreshAccessToken: device revogado — limpa a credencial local (exige novo bootstrap)', async () => {
  writeDeviceAuthState(userDataPath, {
    deviceId: 'device-abc',
    refreshToken: 'refresh-old',
    refreshTokenExpiresAt: '2027-01-01T00:00:00.000Z',
  });
  mockFetchSequence([{ status: 403, body: { error: 'Dispositivo revogado.', code: 'device_revoked' } }]);

  const result = await refreshAccessToken({ userDataPath, issuerBaseUrl: 'http://issuer.local' });
  assert.equal(result.ok, false);
  assert.equal(result.kind, 'DEVICE_REVOKED');
  assert.equal(result.requiresReactivation, true);
  assert.equal(readDeviceAuthState(userDataPath).ok, false, 'credencial morta tem de ser apagada');
});

test('refreshAccessToken: refresh token inválido/expirado/replay — limpa a credencial local', async () => {
  for (const code of ['invalid_refresh', 'refresh_expired', 'refresh_replay']) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'posly-device-auth-'));
    writeDeviceAuthState(dir, { deviceId: 'd', refreshToken: 'rt', refreshTokenExpiresAt: null });
    mockFetchSequence([{ status: 401, body: { error: 'x', code } }]);
    const result = await refreshAccessToken({ userDataPath: dir, issuerBaseUrl: 'http://issuer.local' });
    assert.equal(result.ok, false, `code=${code}`);
    assert.equal(readDeviceAuthState(dir).ok, false, `code=${code} deve limpar a credencial`);
  }
});

test('refreshAccessToken: licença/tenant suspenso — NUNCA apaga a credencial (pode reactivar)', async () => {
  writeDeviceAuthState(userDataPath, {
    deviceId: 'device-abc',
    refreshToken: 'refresh-old',
    refreshTokenExpiresAt: '2027-01-01T00:00:00.000Z',
  });
  mockFetchSequence([{ status: 403, body: { error: 'Licença suspensa.', code: 'license_suspended' } }]);

  const result = await refreshAccessToken({ userDataPath, issuerBaseUrl: 'http://issuer.local' });
  assert.equal(result.ok, false);
  assert.equal(result.kind, 'LICENSE_OR_TENANT_SUSPENDED');

  const stored = readDeviceAuthState(userDataPath);
  assert.equal(stored.ok, true, 'credencial tem de sobreviver a uma suspensão');
  assert.equal(stored.state.refreshToken, 'refresh-old', 'refresh token antigo continua válido/guardado');
});

test('refreshAccessToken: falha de rede — NUNCA apaga a credencial local (offline-first)', async () => {
  writeDeviceAuthState(userDataPath, {
    deviceId: 'device-abc',
    refreshToken: 'refresh-old',
    refreshTokenExpiresAt: '2027-01-01T00:00:00.000Z',
  });
  mockFetchSequence([{ networkError: 'ETIMEDOUT' }]);

  const result = await refreshAccessToken({ userDataPath, issuerBaseUrl: 'http://issuer.local' });
  assert.equal(result.ok, false);
  assert.equal(result.kind, 'NETWORK_ERROR');

  const stored = readDeviceAuthState(userDataPath);
  assert.equal(stored.ok, true);
  assert.equal(stored.state.refreshToken, 'refresh-old');
});

test('refreshAccessToken: rate limited / server misconfigured — transitório, nunca apaga', async () => {
  for (const [status, code] of [[429, 'rate_limited'], [503, 'server_misconfigured']]) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'posly-device-auth-'));
    writeDeviceAuthState(dir, { deviceId: 'd', refreshToken: 'rt', refreshTokenExpiresAt: null });
    mockFetchSequence([{ status, body: { error: 'x', code } }]);
    const result = await refreshAccessToken({ userDataPath: dir, issuerBaseUrl: 'http://issuer.local' });
    assert.equal(result.ok, false);
    assert.equal(readDeviceAuthState(dir).ok, true, `code=${code} nunca deve apagar`);
  }
});

test('deviceAuthStorage: ficheiro de safeStorage corrompido pós-bootstrap — refresh trata como NO_CREDENTIALS, nunca crasha', async () => {
  writeDeviceAuthState(userDataPath, { deviceId: 'd', refreshToken: 'rt', refreshTokenExpiresAt: null });
  // Simular corrupção: substituir o ficheiro por bytes que a "desencriptação" rejeita.
  fs.writeFileSync(path.join(userDataPath, 'device-auth.json'), Buffer.from('bytes-invalidos'));

  let called = false;
  globalThis.fetch = async () => {
    called = true;
    throw new Error('não deveria ser chamado');
  };
  const result = await refreshAccessToken({ userDataPath, issuerBaseUrl: 'http://issuer.local' });
  assert.equal(result.ok, false);
  assert.equal(result.kind, 'NO_CREDENTIALS');
  assert.equal(called, false);
});

test('getValidAccessToken: reutiliza o access token em memória enquanto válido (não chama rede outra vez)', async () => {
  const stop = mockFetchSequence([
    {
      status: 200,
      body: {
        device_id: 'device-abc',
        refresh_token: 'refresh-abc',
        refresh_token_expires_at: '2027-01-01T00:00:00.000Z',
        access_token: 'access-abc',
        access_token_expires_at: new Date(Date.now() + 3600_000).toISOString(),
      },
    },
  ]);

  await bootstrapDevice({
    activationToken: 'ACT-1',
    machineId: 'machine-1',
    userDataPath,
    issuerBaseUrl: 'http://issuer.local',
  });
  assert.equal(stop(), 1);

  const token1 = await getValidAccessToken({ userDataPath, issuerBaseUrl: 'http://issuer.local' });
  const token2 = await getValidAccessToken({ userDataPath, issuerBaseUrl: 'http://issuer.local' });
  assert.equal(token1, 'access-abc');
  assert.equal(token2, 'access-abc');
  assert.equal(stop(), 1, 'segunda chamada não deve tocar a rede — token ainda válido em memória');
});

test('getValidAccessToken: token expirado (fora da margem de segurança) força refresh automático', async () => {
  writeDeviceAuthState(userDataPath, {
    deviceId: 'device-abc',
    refreshToken: 'refresh-old',
    refreshTokenExpiresAt: '2027-01-01T00:00:00.000Z',
  });
  mockFetchSequence([
    {
      status: 200,
      body: {
        access_token: 'access-fresh',
        access_token_expires_at: new Date(Date.now() + 3600_000).toISOString(),
        refresh_token: 'refresh-fresh',
        refresh_token_expires_at: '2027-02-01T00:00:00.000Z',
      },
    },
  ]);

  const token = await getValidAccessToken({ userDataPath, issuerBaseUrl: 'http://issuer.local' });
  assert.equal(token, 'access-fresh');
});

test('getValidAccessToken: nenhuma credencial e cloud indisponível — devolve null, nunca lança', async () => {
  globalThis.fetch = async () => {
    throw new Error('offline');
  };
  const token = await getValidAccessToken({ userDataPath, issuerBaseUrl: 'http://issuer.local' });
  assert.equal(token, null);
});

test('restart simulado: novo userDataPath lido do zero recupera a mesma identidade de dispositivo', async () => {
  mockFetchSequence([
    {
      status: 200,
      body: {
        device_id: 'device-restart',
        refresh_token: 'refresh-restart',
        refresh_token_expires_at: '2027-01-01T00:00:00.000Z',
        access_token: 'access-restart',
        access_token_expires_at: new Date(Date.now() + 3600_000).toISOString(),
      },
    },
  ]);
  await bootstrapDevice({
    activationToken: 'ACT-1',
    machineId: 'machine-1',
    userDataPath,
    issuerBaseUrl: 'http://issuer.local',
  });

  // "Restart": ler o estado directamente do disco, como o processo faria ao
  // arrancar de novo (a memória in-process seria recriada do zero; aqui
  // provamos que a persistência em disco é suficiente para reconstituir a
  // identidade sem depender de nada em memória).
  const identity = getDeviceIdentity({ userDataPath });
  assert.equal(identity.hasCredentials, true);
  assert.equal(identity.deviceId, 'device-restart');

  mockFetchSequence([
    {
      status: 200,
      body: {
        access_token: 'access-restart-2',
        access_token_expires_at: new Date(Date.now() + 3600_000).toISOString(),
        refresh_token: 'refresh-restart-2',
        refresh_token_expires_at: '2027-02-01T00:00:00.000Z',
      },
    },
  ]);
  const refreshed = await refreshAccessToken({ userDataPath, issuerBaseUrl: 'http://issuer.local' });
  assert.equal(refreshed.ok, true);
  assert.equal(refreshed.deviceId, 'device-restart', 'mesma identidade de dispositivo após "restart"');
});

test('clearDeviceCredentials: apaga storage e o access token em memória', async () => {
  mockFetchSequence([
    {
      status: 200,
      body: {
        device_id: 'device-abc',
        refresh_token: 'refresh-abc',
        refresh_token_expires_at: '2027-01-01T00:00:00.000Z',
        access_token: 'access-abc',
        access_token_expires_at: new Date(Date.now() + 3600_000).toISOString(),
      },
    },
  ]);
  await bootstrapDevice({
    activationToken: 'ACT-1',
    machineId: 'machine-1',
    userDataPath,
    issuerBaseUrl: 'http://issuer.local',
  });

  clearDeviceCredentials({ userDataPath });
  assert.equal(getDeviceIdentity({ userDataPath }).hasCredentials, false);

  let called = false;
  globalThis.fetch = async () => {
    called = true;
    throw new Error('não deveria ser chamado');
  };
  const token = await getValidAccessToken({ userDataPath, issuerBaseUrl: 'http://issuer.local' });
  assert.equal(token, null);
  assert.equal(called, false, 'sem credenciais, getValidAccessToken nunca deve tentar a rede');
});

test('initDeviceAuthNonBlocking: sem credenciais — nunca lança, nunca chama rede', async () => {
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    throw new Error('não deveria ser chamado');
  };
  const result = await initDeviceAuthNonBlocking({ userDataPath, issuerBaseUrl: 'http://issuer.local' });
  assert.equal(result.attempted, false);
  assert.equal(called, false);
});

test('initDeviceAuthNonBlocking: cloud indisponível com credenciais existentes — nunca lança (offline-first)', async () => {
  writeDeviceAuthState(userDataPath, {
    deviceId: 'device-abc',
    refreshToken: 'refresh-old',
    refreshTokenExpiresAt: '2027-01-01T00:00:00.000Z',
  });
  globalThis.fetch = async () => {
    throw new Error('offline');
  };
  const result = await initDeviceAuthNonBlocking({ userDataPath, issuerBaseUrl: 'http://issuer.local' });
  assert.equal(result.attempted, true);
  assert.equal(result.ok, false);
  // A credencial tem de sobreviver — a próxima tentativa (próximo ciclo/arranque) poderá ter rede.
  assert.equal(readDeviceAuthState(userDataPath).ok, true);
});

// ---------------------------------------------------------------------------
// Etapa 1F.2 item 0 — correção obrigatória: NUNCA persistir o refresh
// credential em plaintext. safeStorage indisponível => device cloud auth
// fica indisponível, mas nunca escreve nem lê nada em claro.
// ---------------------------------------------------------------------------

test('deviceAuthStorage: safeStorage indisponível — writeDeviceAuthState NUNCA grava plaintext', () => {
  fakeSafeStorage.available = false;
  const result = writeDeviceAuthState(userDataPath, {
    deviceId: 'device-no-dpapi',
    refreshToken: 'refresh-no-dpapi-SEGREDO',
    refreshTokenExpiresAt: null,
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'secure_storage_unavailable');

  const filePath = path.join(userDataPath, 'device-auth.json');
  assert.equal(fs.existsSync(filePath), false, 'nenhum ficheiro deve ser criado');
});

test('deviceAuthStorage: safeStorage fica indisponível DEPOIS de já haver credencial — leitura recusa-se a interpretar como plaintext', () => {
  writeDeviceAuthState(userDataPath, { deviceId: 'd', refreshToken: 'rt-secreto', refreshTokenExpiresAt: null });
  fakeSafeStorage.available = false;
  const read = readDeviceAuthState(userDataPath);
  assert.equal(read.ok, false);
  assert.equal(read.reason, 'secure_storage_unavailable');
});

test('bootstrapDevice: safeStorage indisponível — não persiste, não expõe access token, POS local não afectado', async () => {
  fakeSafeStorage.available = false;
  mockFetchSequence([
    {
      status: 200,
      body: {
        device_id: 'device-abc',
        refresh_token: 'refresh-abc-SEGREDO',
        refresh_token_expires_at: '2027-01-01T00:00:00.000Z',
        access_token: 'access-abc-SEGREDO',
        access_token_expires_at: new Date(Date.now() + 3600_000).toISOString(),
      },
    },
  ]);

  const result = await bootstrapDevice({
    activationToken: 'ACT-1',
    machineId: 'machine-1',
    userDataPath,
    issuerBaseUrl: 'http://issuer.local',
  });

  assert.equal(result.ok, false);
  assert.equal(result.kind, 'SECURE_STORAGE_UNAVAILABLE');
  assert.equal(readDeviceAuthState(userDataPath).ok, false);
  // O access token da resposta nunca deve ficar utilizável — reportar
  // ok:false chega, mas confirmamos também que getValidAccessToken não o reutiliza.
  const token = await getValidAccessToken({ userDataPath, issuerBaseUrl: 'http://issuer.local' });
  assert.equal(token, null);
});

test('refreshAccessToken: safeStorage fica indisponível a meio da rotação — credencial antiga (A) sobrevive intacta em disco', async () => {
  writeDeviceAuthState(userDataPath, {
    deviceId: 'device-abc',
    refreshToken: 'refresh-A',
    refreshTokenExpiresAt: '2027-01-01T00:00:00.000Z',
  });
  // safeStorage só fica indisponível DEPOIS do read inicial (que já aconteceu
  // com sucesso) — simula o cenário real do item 0: a resposta HTTP já veio
  // (servidor já rodou A→B), só a GRAVAÇÃO local é que falha.
  globalThis.fetch = async () => {
    fakeSafeStorage.available = false;
    return {
      ok: true,
      status: 200,
      json: async () => ({
        access_token: 'access-B',
        access_token_expires_at: new Date(Date.now() + 3600_000).toISOString(),
        refresh_token: 'refresh-B',
        refresh_token_expires_at: '2027-02-01T00:00:00.000Z',
      }),
    };
  };

  const result = await refreshAccessToken({ userDataPath, issuerBaseUrl: 'http://issuer.local' });
  assert.equal(result.ok, false);
  assert.equal(result.kind, 'SECURE_STORAGE_UNAVAILABLE');

  // A credencial não pode ter sido tocada — nem apagada nem sobrescrita — porque
  // não a conseguimos ler de volta enquanto safeStorage está indisponível.
  fakeSafeStorage.available = true;
  const stillThere = readDeviceAuthState(userDataPath);
  assert.equal(stillThere.ok, true);
  assert.equal(stillThere.state.refreshToken, 'refresh-A', 'a credencial A original nunca foi substituída por B');
});

// ---------------------------------------------------------------------------
// Etapa 1F.2 item 2 — single-flight refresh sob concorrência real.
// ---------------------------------------------------------------------------

test('getValidAccessToken: 5 chamadas concorrentes com token expirado → 1 único pedido HTTP de refresh, todas recebem o mesmo token novo', async () => {
  writeDeviceAuthState(userDataPath, {
    deviceId: 'device-abc',
    refreshToken: 'refresh-old',
    refreshTokenExpiresAt: '2027-01-01T00:00:00.000Z',
  });

  let httpCalls = 0;
  let resolveFetch;
  const fetchStarted = new Promise((resolve) => {
    resolveFetch = resolve;
  });
  globalThis.fetch = async () => {
    httpCalls += 1;
    resolveFetch();
    // Simula latência real de rede — se houvesse uma segunda chamada
    // concorrente sem single-flight, ela dispararia ANTES desta resolver.
    await new Promise((r) => setTimeout(r, 30));
    return {
      ok: true,
      status: 200,
      json: async () => ({
        access_token: 'access-concurrent',
        access_token_expires_at: new Date(Date.now() + 3600_000).toISOString(),
        refresh_token: 'refresh-concurrent',
        refresh_token_expires_at: '2027-02-01T00:00:00.000Z',
      }),
    };
  };

  const calls = Array.from({ length: 5 }, () =>
    getValidAccessToken({ userDataPath, issuerBaseUrl: 'http://issuer.local' }),
  );
  const tokens = await Promise.all(calls);

  assert.equal(httpCalls, 1, 'exactamente 1 pedido HTTP de refresh para 5 chamadas concorrentes');
  for (const token of tokens) {
    assert.equal(token, 'access-concurrent', 'todas as chamadas devolvem o MESMO access token novo');
  }
});

test('getValidAccessToken: chamadas concorrentes a instalações (userDataPath) diferentes NUNCA partilham single-flight', async () => {
  const dirA = fs.mkdtempSync(path.join(os.tmpdir(), 'posly-device-auth-'));
  const dirB = fs.mkdtempSync(path.join(os.tmpdir(), 'posly-device-auth-'));
  writeDeviceAuthState(dirA, { deviceId: 'A', refreshToken: 'rt-A', refreshTokenExpiresAt: '2027-01-01T00:00:00.000Z' });
  writeDeviceAuthState(dirB, { deviceId: 'B', refreshToken: 'rt-B', refreshTokenExpiresAt: '2027-01-01T00:00:00.000Z' });

  // A resposta deriva do PRÓPRIO refresh_token pedido (não de um contador
  // partilhado lido preguiçosamente em json() — isso capturaria o valor
  // errado se as duas chamadas fossem despoletadas antes de qualquer json()
  // ser invocado). Assim cada pedido fica deterministicamente ligado à sua
  // própria resposta, independentemente da ordem de resolução.
  let httpCalls = 0;
  globalThis.fetch = async (_url, opts) => {
    httpCalls += 1;
    const sentRefreshToken = JSON.parse(opts.body).refresh_token;
    return {
      ok: true,
      status: 200,
      json: async () => ({
        access_token: `access-for-${sentRefreshToken}`,
        access_token_expires_at: new Date(Date.now() + 3600_000).toISOString(),
        refresh_token: `refresh-rotated-${sentRefreshToken}`,
        refresh_token_expires_at: '2027-02-01T00:00:00.000Z',
      }),
    };
  };

  const [tokenA, tokenB] = await Promise.all([
    getValidAccessToken({ userDataPath: dirA, issuerBaseUrl: 'http://issuer.local' }),
    getValidAccessToken({ userDataPath: dirB, issuerBaseUrl: 'http://issuer.local' }),
  ]);

  assert.equal(httpCalls, 2, 'instalações diferentes nunca partilham o single-flight — 2 pedidos, um por device');
  assert.equal(tokenA, 'access-for-rt-A');
  assert.equal(tokenB, 'access-for-rt-B');
  assert.notEqual(tokenA, tokenB);
});
