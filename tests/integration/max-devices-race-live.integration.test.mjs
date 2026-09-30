/**
 * Etapa 1F.6 (item 33) — race real: licença com max_devices=1, DOIS activation
 * tokens válidos distintos, bootstrap disparado em SIMULTÂNEO (Promise.all)
 * contra license-console+Postgres reais. Só UM pode vencer; nunca os dois.
 *
 * Requer env: POSLY_1F6C_ISSUER_URL, POSLY_1F6C_TOKEN_A, POSLY_1F6C_TOKEN_B.
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, mock } from 'node:test';

const ISSUER_URL = process.env.POSLY_1F6C_ISSUER_URL || '';
const TOKEN_A = process.env.POSLY_1F6C_TOKEN_A || '';
const TOKEN_B = process.env.POSLY_1F6C_TOKEN_B || '';
const shouldRun = Boolean(ISSUER_URL && TOKEN_A && TOKEN_B);

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

test(
  'max_devices=1: dois bootstraps simultâneos com tokens distintos -> só UM vence',
  { skip: !shouldRun && 'defina POSLY_1F6C_*' },
  async () => {
    const udA = fs.mkdtempSync(path.join(os.tmpdir(), 'posly-1f6-race-A-'));
    const udB = fs.mkdtempSync(path.join(os.tmpdir(), 'posly-1f6-race-B-'));

    const [resA, resB] = await Promise.all([
      bootstrapDevice({ activationToken: TOKEN_A, machineId: 'machine-1f6-race-A', userDataPath: udA, issuerBaseUrl: ISSUER_URL }),
      bootstrapDevice({ activationToken: TOKEN_B, machineId: 'machine-1f6-race-B', userDataPath: udB, issuerBaseUrl: ISSUER_URL }),
    ]);

    console.log('[item 33] resultado A:', JSON.stringify(resA));
    console.log('[item 33] resultado B:', JSON.stringify(resB));

    const winners = [resA, resB].filter((r) => r.ok === true);
    const losers = [resA, resB].filter((r) => r.ok === false);
    assert.equal(winners.length, 1, `esperava exactamente 1 vencedor, veio ${winners.length}`);
    assert.equal(losers.length, 1, `esperava exactamente 1 perdedor, veio ${losers.length}`);
    assert.equal(losers[0].code, 'max_devices_reached', `perdedor devia falhar com max_devices_reached, veio: ${JSON.stringify(losers[0])}`);

    fs.rmSync(udA, { recursive: true, force: true });
    fs.rmSync(udB, { recursive: true, force: true });
  },
);
