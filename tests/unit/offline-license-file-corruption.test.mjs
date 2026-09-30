/**
 * Etapa 1F.6 (itens 22-23) — ficheiro de licença offline apagado/corrompido:
 * nunca deve ser tratado como "activado", nunca deve fazer crash do processo,
 * nunca deve tentar interpretar JSON inválido como se fosse válido.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { getOfflineLicenseState } from '../../electron/deviceAuth/offlineLicenseClient.js';

const resolvePem = () => null;

test('licença offline: ficheiro inexistente (item 22) -> MISSING, nunca "activado"', () => {
  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'posly-1f6-lic-missing-'));
  const result = getOfflineLicenseState({ userDataPath, resolvePublicKeyPem: resolvePem, machineId: 'm1' });
  assert.equal(result.ok, false);
  assert.equal(result.kind, 'MISSING');
  fs.rmSync(userDataPath, { recursive: true, force: true });
});

test('licença offline: JSON truncado a meio (item 23) -> MALFORMED, nunca crash/aceite', () => {
  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'posly-1f6-lic-trunc-'));
  const licensePath = path.join(userDataPath, 'offline-license.json');
  fs.writeFileSync(licensePath, '{"payload":{"tenant_id":"x","expires_at":"2099-01-01T00:00:00.000Z"'); // sem fechar
  const result = getOfflineLicenseState({ userDataPath, resolvePublicKeyPem: resolvePem, machineId: 'm1' });
  assert.equal(result.ok, false);
  assert.equal(result.kind, 'MALFORMED');
  fs.rmSync(userDataPath, { recursive: true, force: true });
});

test('licença offline: bytes aleatórios em vez de JSON (item 23) -> MALFORMED, nunca crash/aceite', () => {
  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'posly-1f6-lic-garbage-'));
  const licensePath = path.join(userDataPath, 'offline-license.json');
  fs.writeFileSync(licensePath, Buffer.from([0x00, 0xff, 0x13, 0x42, 0x99, 0x01, 0x02]));
  const result = getOfflineLicenseState({ userDataPath, resolvePublicKeyPem: resolvePem, machineId: 'm1' });
  assert.equal(result.ok, false);
  assert.equal(result.kind, 'MALFORMED');
  fs.rmSync(userDataPath, { recursive: true, force: true });
});

test('licença offline: assinatura truncada mas JSON válido (item 23) -> INVALID_SIGNATURE, nunca aceite', () => {
  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'posly-1f6-lic-badsig-'));
  const licensePath = path.join(userDataPath, 'offline-license.json');
  const fakeEnvelope = {
    version: 1,
    key_id: 'nonexistent-key',
    payload: {
      tenant_id: 't1',
      license_id: 'l1',
      machine_id: 'm1',
      expires_at: '2099-01-01T00:00:00.000Z',
      issued_at: new Date().toISOString(),
    },
    signature: 'AAAA-nao-e-uma-assinatura-real',
  };
  fs.writeFileSync(licensePath, JSON.stringify(fakeEnvelope));
  const result = getOfflineLicenseState({ userDataPath, resolvePublicKeyPem: resolvePem, machineId: 'm1' });
  assert.equal(result.ok, false);
  assert.notEqual(result.kind, 'VALID');
  fs.rmSync(userDataPath, { recursive: true, force: true });
});
