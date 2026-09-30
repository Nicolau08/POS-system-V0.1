/**
 * Etapa 1F.5b — OfflineLicenseClient (electron/deviceAuth/offlineLicenseClient.js):
 * HTTP (contra um servidor HTTP local descartável, nunca a rede real),
 * storage atómica, e "nunca confia no storage" (revalida sempre ao carregar).
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  requestOfflineLicense,
  installOfflineLicense,
  getOfflineLicenseState,
  clearOfflineLicense,
  resolveOfflineLicensePath,
} from '../../electron/deviceAuth/offlineLicenseClient.js';
import { isDeviceActivationTokenInput, normalizeDeviceActivationTokenInput } from '../../lib/licensing/deviceActivationToken.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const licenseConsoleDir = path.join(repoRoot, 'license-console');
const fixtureScript = path.join(licenseConsoleDir, 'scripts', 'gen-offline-license-fixture.mjs');

function genFixture(overrides = {}) {
  const result = spawnSync(
    process.execPath,
    ['--experimental-strip-types', fixtureScript, JSON.stringify(overrides)],
    { cwd: licenseConsoleDir, encoding: 'utf8' },
  );
  assert.equal(result.status, 0, `gerador de fixture falhou: ${result.stderr}`);
  return JSON.parse(result.stdout);
}

function resolverFor(keyId, publicKeyPem) {
  return (kid) => (kid === keyId ? publicKeyPem : null);
}

function tmpUserDataDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'posly-1f5b-offline-license-'));
}

// --- deviceActivationToken.js ---

test('isDeviceActivationTokenInput: aceita um token real de 43 chars base64url', () => {
  const token = 'A'.repeat(43); // formato válido genérico
  assert.equal(isDeviceActivationTokenInput(token), true);
});

test('isDeviceActivationTokenInput: rejeita token de reactivação (12 dígitos)', () => {
  assert.equal(isDeviceActivationTokenInput('123456789012'), false);
});

test('isDeviceActivationTokenInput: rejeita formato de série (X_XXXXXXXX)', () => {
  assert.equal(isDeviceActivationTokenInput('D_9L6WAKYU'), false);
});

test('isDeviceActivationTokenInput: rejeita comprimento errado', () => {
  assert.equal(isDeviceActivationTokenInput('A'.repeat(42)), false);
  assert.equal(isDeviceActivationTokenInput('A'.repeat(44)), false);
});

test('normalizeDeviceActivationTokenInput: apara espaços', () => {
  const token = 'B'.repeat(43);
  assert.equal(normalizeDeviceActivationTokenInput(`  ${token}  `), token);
});

// --- installOfflineLicense / getOfflineLicenseState (storage + reverificação) ---

test('installOfflineLicense: envelope real e válido -> escreve ficheiro e devolve VALID', () => {
  const fixture = genFixture();
  const userDataPath = tmpUserDataDir();
  try {
    const result = installOfflineLicense({
      envelope: fixture.envelope,
      userDataPath,
      resolvePublicKeyPem: resolverFor(fixture.keyId, fixture.publicKeyPem),
      machineId: fixture.envelope.payload.machine_id,
    });
    assert.equal(result.ok, true);
    assert.equal(result.kind, 'VALID');
    assert.ok(fs.existsSync(resolveOfflineLicensePath(userDataPath)));
  } finally {
    fs.rmSync(userDataPath, { recursive: true, force: true });
  }
});

test('installOfflineLicense: envelope inválido (wrong machine) -> NUNCA escreve ficheiro', () => {
  const fixture = genFixture({ payload: { machine_id: 'machine-A' } });
  const userDataPath = tmpUserDataDir();
  try {
    const result = installOfflineLicense({
      envelope: fixture.envelope,
      userDataPath,
      resolvePublicKeyPem: resolverFor(fixture.keyId, fixture.publicKeyPem),
      machineId: 'machine-B',
    });
    assert.equal(result.ok, false);
    assert.equal(result.kind, 'WRONG_MACHINE');
    assert.equal(fs.existsSync(resolveOfflineLicensePath(userDataPath)), false, 'nunca deve escrever um envelope que falhou a verificar');
  } finally {
    fs.rmSync(userDataPath, { recursive: true, force: true });
  }
});

test('getOfflineLicenseState: ficheiro ausente -> MISSING', () => {
  const userDataPath = tmpUserDataDir();
  try {
    const result = getOfflineLicenseState({
      userDataPath,
      resolvePublicKeyPem: () => null,
      machineId: 'machine-x',
    });
    assert.equal(result.ok, false);
    assert.equal(result.kind, 'MISSING');
  } finally {
    fs.rmSync(userDataPath, { recursive: true, force: true });
  }
});

test('getOfflineLicenseState: ficheiro corrompido (não-JSON) -> MALFORMED', () => {
  const userDataPath = tmpUserDataDir();
  try {
    fs.writeFileSync(resolveOfflineLicensePath(userDataPath), 'isto nao e json{{{', 'utf8');
    const result = getOfflineLicenseState({
      userDataPath,
      resolvePublicKeyPem: () => null,
      machineId: 'machine-x',
    });
    assert.equal(result.ok, false);
    assert.equal(result.kind, 'MALFORMED');
  } finally {
    fs.rmSync(userDataPath, { recursive: true, force: true });
  }
});

test('getOfflineLicenseState: instalado válido -> lido de volta como VALID (nunca confia em cache, reverifica)', () => {
  const fixture = genFixture();
  const userDataPath = tmpUserDataDir();
  try {
    installOfflineLicense({
      envelope: fixture.envelope,
      userDataPath,
      resolvePublicKeyPem: resolverFor(fixture.keyId, fixture.publicKeyPem),
      machineId: fixture.envelope.payload.machine_id,
    });
    const result = getOfflineLicenseState({
      userDataPath,
      resolvePublicKeyPem: resolverFor(fixture.keyId, fixture.publicKeyPem),
      machineId: fixture.envelope.payload.machine_id,
    });
    assert.equal(result.ok, true);
    assert.equal(result.kind, 'VALID');
    assert.equal(result.payload.tenant_id, fixture.envelope.payload.tenant_id);
  } finally {
    fs.rmSync(userDataPath, { recursive: true, force: true });
  }
});

test('getOfflineLicenseState: ficheiro adulterado DEPOIS de instalado (tamper attack, item 25) -> INVALID_SIGNATURE', () => {
  const fixture = genFixture();
  const userDataPath = tmpUserDataDir();
  try {
    installOfflineLicense({
      envelope: fixture.envelope,
      userDataPath,
      resolvePublicKeyPem: resolverFor(fixture.keyId, fixture.publicKeyPem),
      machineId: fixture.envelope.payload.machine_id,
    });
    const licensePath = resolveOfflineLicensePath(userDataPath);
    const onDisk = JSON.parse(fs.readFileSync(licensePath, 'utf8'));
    onDisk.payload.plan = 'PRO'; // editar manualmente (ex.: no Bloco de Notas)
    fs.writeFileSync(licensePath, JSON.stringify(onDisk, null, 2), 'utf8');

    const result = getOfflineLicenseState({
      userDataPath,
      resolvePublicKeyPem: resolverFor(fixture.keyId, fixture.publicKeyPem),
      machineId: fixture.envelope.payload.machine_id,
    });
    assert.equal(result.ok, false);
    assert.equal(result.kind, 'INVALID_SIGNATURE');
  } finally {
    fs.rmSync(userDataPath, { recursive: true, force: true });
  }
});

test('copy attack (item 26): mesmo ficheiro válido copiado para OUTRA máquina -> WRONG_MACHINE', () => {
  const fixture = genFixture();
  const userDataPathA = tmpUserDataDir();
  const userDataPathB = tmpUserDataDir();
  try {
    installOfflineLicense({
      envelope: fixture.envelope,
      userDataPath: userDataPathA,
      resolvePublicKeyPem: resolverFor(fixture.keyId, fixture.publicKeyPem),
      machineId: fixture.envelope.payload.machine_id, // PC A: máquina certa
    });
    // Copia byte-a-byte o mesmo ficheiro para o "PC B".
    fs.copyFileSync(resolveOfflineLicensePath(userDataPathA), resolveOfflineLicensePath(userDataPathB));

    const resultOnA = getOfflineLicenseState({
      userDataPath: userDataPathA,
      resolvePublicKeyPem: resolverFor(fixture.keyId, fixture.publicKeyPem),
      machineId: fixture.envelope.payload.machine_id,
    });
    assert.equal(resultOnA.ok, true, 'PC A (máquina correcta) continua VALID');

    const resultOnB = getOfflineLicenseState({
      userDataPath: userDataPathB,
      resolvePublicKeyPem: resolverFor(fixture.keyId, fixture.publicKeyPem),
      machineId: 'machine-PC-B-diferente',
    });
    assert.equal(resultOnB.ok, false);
    assert.equal(resultOnB.kind, 'WRONG_MACHINE');
  } finally {
    fs.rmSync(userDataPathA, { recursive: true, force: true });
    fs.rmSync(userDataPathB, { recursive: true, force: true });
  }
});

test('unknown key_id (item 27): licença assinada com key_id não presente no POS -> FAIL CLOSED, nunca busca a chave ao servidor', () => {
  const fixture = genFixture({ keyId: 'key-nunca-registada-no-pos' });
  const userDataPath = tmpUserDataDir();
  try {
    const result = installOfflineLicense({
      envelope: fixture.envelope,
      userDataPath,
      resolvePublicKeyPem: () => null, // POS não conhece este key_id
      machineId: fixture.envelope.payload.machine_id,
    });
    assert.equal(result.ok, false);
    assert.equal(result.kind, 'UNKNOWN_KEY');
    assert.equal(fs.existsSync(resolveOfflineLicensePath(userDataPath)), false);
  } finally {
    fs.rmSync(userDataPath, { recursive: true, force: true });
  }
});

test('installOfflineLicense: envelope já expirado -> nunca instalado (EXPIRED antes de qualquer escrita, item 24)', () => {
  const fixture = genFixture({
    payload: { issued_at: '2020-01-01T00:00:00.000Z', expires_at: '2020-02-01T00:00:00.000Z' },
  });
  const userDataPath = tmpUserDataDir();
  try {
    const result = installOfflineLicense({
      envelope: fixture.envelope,
      userDataPath,
      resolvePublicKeyPem: resolverFor(fixture.keyId, fixture.publicKeyPem),
      machineId: fixture.envelope.payload.machine_id,
    });
    assert.equal(result.ok, false);
    assert.equal(result.kind, 'EXPIRED');
    assert.equal(fs.existsSync(resolveOfflineLicensePath(userDataPath)), false);
  } finally {
    fs.rmSync(userDataPath, { recursive: true, force: true });
  }
});

test('clearOfflineLicense: remove o ficheiro sem lançar erro se já não existir', () => {
  const userDataPath = tmpUserDataDir();
  try {
    clearOfflineLicense(userDataPath); // nao existe ainda — nao deve lançar
    const fixture = genFixture();
    installOfflineLicense({
      envelope: fixture.envelope,
      userDataPath,
      resolvePublicKeyPem: resolverFor(fixture.keyId, fixture.publicKeyPem),
      machineId: fixture.envelope.payload.machine_id,
    });
    assert.ok(fs.existsSync(resolveOfflineLicensePath(userDataPath)));
    clearOfflineLicense(userDataPath);
    assert.equal(fs.existsSync(resolveOfflineLicensePath(userDataPath)), false);
  } finally {
    fs.rmSync(userDataPath, { recursive: true, force: true });
  }
});

// --- requestOfflineLicense (HTTP contra servidor local descartável) ---

function withLocalServer(handler, testFn) {
  return async () => {
    const server = http.createServer(handler);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();
    try {
      await testFn(`http://127.0.0.1:${port}`);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  };
}

test(
  'requestOfflineLicense: servidor devolve envelope real -> ok:true com o envelope',
  withLocalServer(
    (req, res) => {
      assert.equal(req.headers.authorization, 'Bearer meu-jwt-de-teste');
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ offline_license: { version: 1, key_id: 'k1', payload: {}, signature: 'sig' } }));
    },
    async (baseUrl) => {
      const result = await requestOfflineLicense({ accessToken: 'meu-jwt-de-teste', issuerBaseUrl: baseUrl });
      assert.equal(result.ok, true);
      assert.equal(result.envelope.key_id, 'k1');
    },
  ),
);

test(
  'requestOfflineLicense: servidor devolve 403 (licença suspensa) -> ok:false com o code',
  withLocalServer(
    (req, res) => {
      res.writeHead(403, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'Licença não está activa.', code: 'license_suspended' }));
    },
    async (baseUrl) => {
      const result = await requestOfflineLicense({ accessToken: 'jwt', issuerBaseUrl: baseUrl });
      assert.equal(result.ok, false);
      assert.equal(result.code, 'license_suspended');
      assert.equal(result.status, 403);
    },
  ),
);

test('requestOfflineLicense: sem issuerBaseUrl -> erro claro, nunca lança excepção', async () => {
  const result = await requestOfflineLicense({ accessToken: 'jwt', issuerBaseUrl: '' });
  assert.equal(result.ok, false);
  assert.equal(result.kind, 'NO_ISSUER');
});

test('requestOfflineLicense: sem accessToken -> erro claro, nunca chega a fazer o pedido', async () => {
  const result = await requestOfflineLicense({ accessToken: '', issuerBaseUrl: 'http://127.0.0.1:1' });
  assert.equal(result.ok, false);
  assert.equal(result.kind, 'NO_TOKEN');
});
