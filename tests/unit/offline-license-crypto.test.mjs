/**
 * Etapa 1F.5a — testes de criptografia da licença offline Ed25519.
 *
 * Interoperabilidade REAL (item 39): o fixture é gerado por um subprocesso
 * REAL do license-console (lib/licensing/offlineLicense.ts, o mesmo código
 * do emissor em produção), nunca reimplementado à mão aqui. Se a
 * canonicalização ou o formato do envelope alguma vez divergirem entre os
 * dois lados, este teste falha — é a prova mais forte possível sem correr o
 * emissor real contra Postgres.
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { verifyOfflineLicense, canonicalize, OFFLINE_LICENSE_VERSION } from '../../lib/licensing/offlineLicense.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const licenseConsoleDir = path.join(repoRoot, 'license-console');
const fixtureScript = path.join(licenseConsoleDir, 'scripts', 'gen-offline-license-fixture.mjs');

/** Invoca o gerador REAL do license-console como subprocesso. */
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

test('interop real: envelope assinado pelo license-console real -> VALID no verificador do POS', () => {
  const fixture = genFixture();
  const result = verifyOfflineLicense(fixture.envelope, resolverFor(fixture.keyId, fixture.publicKeyPem), {
    machineId: fixture.envelope.payload.machine_id,
  });
  assert.equal(result.ok, true);
  assert.equal(result.kind, 'VALID');
  assert.deepEqual(result.payload, fixture.envelope.payload);
});

test('payload tamper (campo muda depois de assinado) -> INVALID_SIGNATURE', () => {
  const fixture = genFixture();
  const tampered = {
    ...fixture.envelope,
    payload: { ...fixture.envelope.payload, plan: 'PRO' },
  };
  const result = verifyOfflineLicense(tampered, resolverFor(fixture.keyId, fixture.publicKeyPem), {
    machineId: fixture.envelope.payload.machine_id,
  });
  assert.equal(result.ok, false);
  assert.equal(result.kind, 'INVALID_SIGNATURE');
});

test('signature tamper (byte da assinatura alterado) -> INVALID_SIGNATURE', () => {
  const fixture = genFixture();
  const sigBuf = Buffer.from(fixture.envelope.signature, 'base64url');
  sigBuf[0] ^= 0xff;
  const tampered = { ...fixture.envelope, signature: sigBuf.toString('base64url') };
  const result = verifyOfflineLicense(tampered, resolverFor(fixture.keyId, fixture.publicKeyPem), {
    machineId: fixture.envelope.payload.machine_id,
  });
  assert.equal(result.ok, false);
  assert.equal(result.kind, 'INVALID_SIGNATURE');
});

test('wrong public key (chave correcta existe mas devolve outra) -> INVALID_SIGNATURE', () => {
  const fixture = genFixture();
  const otherKeyPair = crypto.generateKeyPairSync('ed25519');
  const wrongPublicKeyPem = otherKeyPair.publicKey.export({ type: 'spki', format: 'pem' });
  const result = verifyOfflineLicense(fixture.envelope, resolverFor(fixture.keyId, wrongPublicKeyPem), {
    machineId: fixture.envelope.payload.machine_id,
  });
  assert.equal(result.ok, false);
  assert.equal(result.kind, 'INVALID_SIGNATURE');
});

test('unknown key_id (resolver não conhece este key_id) -> UNKNOWN_KEY, fail closed', () => {
  const fixture = genFixture();
  const result = verifyOfflineLicense(fixture.envelope, () => null, {
    machineId: fixture.envelope.payload.machine_id,
  });
  assert.equal(result.ok, false);
  assert.equal(result.kind, 'UNKNOWN_KEY');
});

test('wrong machine (payload.machine_id != máquina local) -> WRONG_MACHINE', () => {
  const fixture = genFixture({ payload: { machine_id: 'machine-A' } });
  const result = verifyOfflineLicense(fixture.envelope, resolverFor(fixture.keyId, fixture.publicKeyPem), {
    machineId: 'machine-B',
  });
  assert.equal(result.ok, false);
  assert.equal(result.kind, 'WRONG_MACHINE');
});

test('expired (expires_at no passado) -> EXPIRED, mas payload continua devolvido', () => {
  const fixture = genFixture({
    payload: { issued_at: '2020-01-01T00:00:00.000Z', expires_at: '2020-02-01T00:00:00.000Z' },
  });
  const result = verifyOfflineLicense(fixture.envelope, resolverFor(fixture.keyId, fixture.publicKeyPem), {
    machineId: fixture.envelope.payload.machine_id,
  });
  assert.equal(result.ok, false);
  assert.equal(result.kind, 'EXPIRED');
  assert.ok(result.payload, 'payload deve continuar acessível mesmo expirada (para UX/diagnóstico)');
});

test('unsupported version (3; 1 e 2 sao suportadas) -> UNSUPPORTED_VERSION, nunca tenta verificar Ed25519', () => {
  const fixture = genFixture();
  const tampered = { ...fixture.envelope, version: 3 };
  const result = verifyOfflineLicense(tampered, resolverFor(fixture.keyId, fixture.publicKeyPem), {
    machineId: fixture.envelope.payload.machine_id,
  });
  assert.equal(result.ok, false);
  assert.equal(result.kind, 'UNSUPPORTED_VERSION');
});

test('missing signature -> MALFORMED', () => {
  const fixture = genFixture();
  const { signature, ...rest } = fixture.envelope;
  const result = verifyOfflineLicense(rest, resolverFor(fixture.keyId, fixture.publicKeyPem));
  assert.equal(result.ok, false);
  assert.equal(result.kind, 'MALFORMED');
});

test('malformed payload (campo obrigatório em falta) -> MALFORMED', () => {
  const fixture = genFixture();
  const malformed = {
    ...fixture.envelope,
    payload: { ...fixture.envelope.payload, expires_at: undefined },
  };
  delete malformed.payload.expires_at;
  const result = verifyOfflineLicense(malformed, resolverFor(fixture.keyId, fixture.publicKeyPem));
  assert.equal(result.ok, false);
  assert.equal(result.kind, 'MALFORMED');
});

test('envelope não-objecto / null -> MALFORMED (nunca lança excepção)', () => {
  for (const bad of [null, undefined, 'string', 42, [], true]) {
    const result = verifyOfflineLicense(bad, () => null);
    assert.equal(result.ok, false);
    assert.equal(result.kind, 'MALFORMED');
  }
});

test('key rotation: licença assinada com key A verificada por POS com registo {A,B} -> VALID', () => {
  const fixtureA = genFixture({ keyId: 'offline-key-A' });
  const registry = { 'offline-key-A': fixtureA.publicKeyPem };
  // Regista também uma chave B qualquer (simulando rotação em curso).
  const otherPair = crypto.generateKeyPairSync('ed25519');
  registry['offline-key-B'] = otherPair.publicKey.export({ type: 'spki', format: 'pem' });

  const result = verifyOfflineLicense(fixtureA.envelope, (kid) => registry[kid] ?? null, {
    machineId: fixtureA.envelope.payload.machine_id,
  });
  assert.equal(result.ok, true);
  assert.equal(result.kind, 'VALID');
});

test('key rotation: licença assinada com key B, POS com registo {A,B} -> VALID', () => {
  const fixtureB = genFixture({ keyId: 'offline-key-B' });
  const otherPair = crypto.generateKeyPairSync('ed25519');
  const registry = {
    'offline-key-A': otherPair.publicKey.export({ type: 'spki', format: 'pem' }),
    'offline-key-B': fixtureB.publicKeyPem,
  };

  const result = verifyOfflineLicense(fixtureB.envelope, (kid) => registry[kid] ?? null, {
    machineId: fixtureB.envelope.payload.machine_id,
  });
  assert.equal(result.ok, true);
  assert.equal(result.kind, 'VALID');
});

test('key rotation: licença assinada com key B, POS SEM key B no registo -> UNKNOWN_KEY', () => {
  const fixtureB = genFixture({ keyId: 'offline-key-B' });
  const registry = { 'offline-key-A': fixtureB.publicKeyPem }; // só a chave errada
  const result = verifyOfflineLicense(fixtureB.envelope, (kid) => registry[kid] ?? null, {
    machineId: fixtureB.envelope.payload.machine_id,
  });
  assert.equal(result.ok, false);
  assert.equal(result.kind, 'UNKNOWN_KEY');
});

test('canonicalization: objectos com chaves em ordem diferente produzem os MESMOS bytes', () => {
  const a = canonicalize({ b: 1, a: 2, c: [3, 2, 1] });
  const b = canonicalize({ a: 2, c: [3, 2, 1], b: 1 });
  assert.equal(a, b);
  assert.equal(a, '{"a":2,"b":1,"c":[3,2,1]}');
});

test('canonicalization: ordem dos elementos de um array é preservada (não reordenada)', () => {
  assert.equal(canonicalize([3, 1, 2]), '[3,1,2]');
  assert.notEqual(canonicalize([3, 1, 2]), canonicalize([1, 2, 3]));
});

test('OFFLINE_LICENSE_VERSION do POS coincide com o do license-console (1)', () => {
  assert.equal(OFFLINE_LICENSE_VERSION, 1);
});
