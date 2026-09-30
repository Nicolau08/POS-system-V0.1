/**
 * Etapa 1F.6 (itens 6-7) — E2E real contra license-console+Postgres reais
 * (supabase/): reutilização de activation token, token malformado,
 * inexistente e expirado devem falhar todos de forma FECHADA, sem criar um
 * segundo device. Usa o MESMO electron/deviceAuth/deviceAuthClient.js real
 * já usado pelos outros testes de integração desta etapa (só 'electron'
 * safeStorage é mockado, nunca a rede/Postgres).
 *
 * Requer env: POSLY_1F6_ISSUER_URL, POSLY_1F6_TENANT_ID, POSLY_1F6_REUSE_TOKEN,
 *   POSLY_1F6_EXPIRED_TOKEN. Sem eles, salta.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, mock } from 'node:test';

const ISSUER_URL = process.env.POSLY_1F6_ISSUER_URL || '';
const TENANT_ID = process.env.POSLY_1F6_TENANT_ID || '';
const REUSE_TOKEN = process.env.POSLY_1F6_REUSE_TOKEN || '';
const EXPIRED_TOKEN = process.env.POSLY_1F6_EXPIRED_TOKEN || '';
const shouldRun = Boolean(ISSUER_URL && REUSE_TOKEN && EXPIRED_TOKEN);

mock.module('electron', {
  exports: {
    safeStorage: {
      isEncryptionAvailable: () => true,
      encryptString: (s) => Buffer.concat([Buffer.from('FAKEENC:'), Buffer.from(s, 'utf8')]),
      decryptString: (b) => Buffer.from(b).subarray(8).toString('utf8'),
    },
  },
});

const { bootstrapDevice } = await import('../../electron/deviceAuth/deviceAuthClient.js');

function freshUserData() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'posly-1f6-tok-'));
}

test(
  'activation token: reutilização do MESMO token (já consumido) falha, nunca cria segundo device',
  { skip: !shouldRun && 'defina POSLY_1F6_*' },
  async () => {
    const ud1 = freshUserData();
    const first = await bootstrapDevice({
      activationToken: REUSE_TOKEN,
      machineId: 'machine-1f6-reuse-A',
      userDataPath: ud1,
      issuerBaseUrl: ISSUER_URL,
    });
    assert.equal(first.ok, true, `primeiro bootstrap (consumo real do token) falhou: ${JSON.stringify(first)}`);
    const firstDeviceId = first.deviceId;

    const ud2 = freshUserData();
    const second = await bootstrapDevice({
      activationToken: REUSE_TOKEN,
      machineId: 'machine-1f6-reuse-B',
      userDataPath: ud2,
      issuerBaseUrl: ISSUER_URL,
    });
    assert.equal(second.ok, false, `reutilização do token deveria FALHAR, mas devolveu: ${JSON.stringify(second)}`);
    assert.notEqual(second.deviceId, firstDeviceId);
    console.log('[item 6] reuse result:', JSON.stringify(second));

    fs.rmSync(ud1, { recursive: true, force: true });
    fs.rmSync(ud2, { recursive: true, force: true });
  },
);

test(
  'activation token: malformado (string arbitrária) falha fechado',
  { skip: !shouldRun && 'defina POSLY_1F6_*' },
  async () => {
    const ud = freshUserData();
    const result = await bootstrapDevice({
      activationToken: 'nao-e-um-token-valido-!!!@@@',
      machineId: 'machine-1f6-malformed',
      userDataPath: ud,
      issuerBaseUrl: ISSUER_URL,
    });
    assert.equal(result.ok, false);
    console.log('[item 7] malformed token result:', JSON.stringify(result));
    fs.rmSync(ud, { recursive: true, force: true });
  },
);

test(
  'activation token: inexistente (bem formado mas nunca emitido) falha fechado',
  { skip: !shouldRun && 'defina POSLY_1F6_*' },
  async () => {
    const ud = freshUserData();
    const fakeToken = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');
    const result = await bootstrapDevice({
      activationToken: fakeToken,
      machineId: 'machine-1f6-inexistent',
      userDataPath: ud,
      issuerBaseUrl: ISSUER_URL,
    });
    assert.equal(result.ok, false);
    console.log('[item 7] inexistent token result:', JSON.stringify(result));
    fs.rmSync(ud, { recursive: true, force: true });
  },
);

test(
  'activation token: expirado (ttl_seconds=2, já ultrapassado) falha fechado',
  { skip: !shouldRun && 'defina POSLY_1F6_*' },
  async () => {
    const ud = freshUserData();
    const result = await bootstrapDevice({
      activationToken: EXPIRED_TOKEN,
      machineId: 'machine-1f6-expired',
      userDataPath: ud,
      issuerBaseUrl: ISSUER_URL,
    });
    assert.equal(result.ok, false);
    console.log('[item 7] expired token result:', JSON.stringify(result));
    fs.rmSync(ud, { recursive: true, force: true });
  },
);
