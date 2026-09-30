/**
 * Etapa 1F.6 (item 24) — device-auth.json corrompido/DPAPI indisponível:
 * nunca crashar o arranque, nunca aceitar dados inválidos como credencial
 * real. safeStorage é mockado (inevitável fora do Electron real), mas a
 * lógica de decrypt->parse->validate testada é o código real de produção.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, mock } from 'node:test';

let encryptionAvailable = true;
mock.module('electron', {
  exports: {
    safeStorage: {
      isEncryptionAvailable: () => encryptionAvailable,
      encryptString: (s) => Buffer.concat([Buffer.from('FAKEENC:'), Buffer.from(s, 'utf8')]),
      decryptString: (b) => {
        const buf = Buffer.from(b);
        if (!buf.subarray(0, 8).equals(Buffer.from('FAKEENC:'))) {
          throw new Error('decrypt failed: not encrypted by this instance');
        }
        return buf.subarray(8).toString('utf8');
      },
    },
  },
});

const { readDeviceAuthState, writeDeviceAuthState } = await import('../../electron/deviceAuth/deviceAuthStorage.js');

test('device-auth.json: ficheiro com bytes que não decifram (item 24) -> unreadable, nunca crash', () => {
  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'posly-1f6-devauth-corrupt-'));
  fs.writeFileSync(path.join(userDataPath, 'device-auth.json'), Buffer.from([0x01, 0x02, 0x03, 0x04, 0x05]));
  const result = readDeviceAuthState(userDataPath);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'unreadable');
  fs.rmSync(userDataPath, { recursive: true, force: true });
});

test('device-auth.json: decifra mas JSON inválido (item 24) -> unreadable, nunca crash', () => {
  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'posly-1f6-devauth-badjson-'));
  fs.writeFileSync(path.join(userDataPath, 'device-auth.json'), Buffer.concat([Buffer.from('FAKEENC:'), Buffer.from('{nao e json valido')]));
  const result = readDeviceAuthState(userDataPath);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'unreadable');
  fs.rmSync(userDataPath, { recursive: true, force: true });
});

test('device-auth.json: decifra, é JSON válido, mas faltam campos obrigatórios (item 24) -> unreadable, nunca aceite como credencial real', () => {
  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'posly-1f6-devauth-incomplete-'));
  fs.writeFileSync(
    path.join(userDataPath, 'device-auth.json'),
    Buffer.concat([Buffer.from('FAKEENC:'), Buffer.from(JSON.stringify({ deviceId: 'x' }))]),
  );
  const result = readDeviceAuthState(userDataPath);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'unreadable');
  fs.rmSync(userDataPath, { recursive: true, force: true });
});

test('device-auth.json: DPAPI/safeStorage indisponível ao ESCREVER (item 24) -> nunca grava plaintext, devolve erro claro', () => {
  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'posly-1f6-devauth-nodpapi-'));
  encryptionAvailable = false;
  try {
    const result = writeDeviceAuthState(userDataPath, { deviceId: 'd1', refreshToken: 'segredo-real-nunca-pode-ir-para-disco', refreshTokenExpiresAt: null });
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'secure_storage_unavailable');
    assert.equal(fs.existsSync(path.join(userDataPath, 'device-auth.json')), false, 'NUNCA deve existir um ficheiro com o refresh token em plaintext');
  } finally {
    encryptionAvailable = true;
    fs.rmSync(userDataPath, { recursive: true, force: true });
  }
});
