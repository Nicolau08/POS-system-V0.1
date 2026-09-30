/**
 * Etapa 1F.5b (item 12/13) — registo de chaves públicas: a chave de
 * dev/teste nunca pode ficar activa num build empacotado (NODE_ENV=production
 * ou POS_APP_MODE=pos), mesmo que as env vars estejam presentes.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  resolveDevOfflineLicensePublicKeyPem,
  resolveOfflineLicensePublicKeyPem,
  resolveEmbeddedOfflineLicensePublicKeyPem,
} from '../../lib/licensing/offlineLicensePublicKeys.js';

const ORIGINAL = {
  nodeEnv: process.env.NODE_ENV,
  appMode: process.env.POS_APP_MODE,
  devKeyId: process.env.POS_DEV_OFFLINE_LICENSE_KEY_ID,
  devPem: process.env.POS_DEV_OFFLINE_LICENSE_PUBLIC_KEY,
};

function restore() {
  for (const [envVar, value] of [
    ['NODE_ENV', ORIGINAL.nodeEnv],
    ['POS_APP_MODE', ORIGINAL.appMode],
    ['POS_DEV_OFFLINE_LICENSE_KEY_ID', ORIGINAL.devKeyId],
    ['POS_DEV_OFFLINE_LICENSE_PUBLIC_KEY', ORIGINAL.devPem],
  ]) {
    if (value === undefined) delete process.env[envVar];
    else process.env[envVar] = value;
  }
}

const SAMPLE_PEM = '-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=\n-----END PUBLIC KEY-----\n';

test('resolveDevOfflineLicensePublicKeyPem: dev (NODE_ENV=development) -> devolve a chave configurada', () => {
  process.env.NODE_ENV = 'development';
  delete process.env.POS_APP_MODE;
  process.env.POS_DEV_OFFLINE_LICENSE_KEY_ID = 'dev-key-1';
  process.env.POS_DEV_OFFLINE_LICENSE_PUBLIC_KEY = SAMPLE_PEM;
  try {
    assert.equal(resolveDevOfflineLicensePublicKeyPem('dev-key-1'), SAMPLE_PEM.trim());
  } finally {
    restore();
  }
});

test('resolveDevOfflineLicensePublicKeyPem: NODE_ENV=production -> SEMPRE null, mesmo com env vars presentes', () => {
  process.env.NODE_ENV = 'production';
  delete process.env.POS_APP_MODE;
  process.env.POS_DEV_OFFLINE_LICENSE_KEY_ID = 'dev-key-1';
  process.env.POS_DEV_OFFLINE_LICENSE_PUBLIC_KEY = SAMPLE_PEM;
  try {
    assert.equal(resolveDevOfflineLicensePublicKeyPem('dev-key-1'), null);
  } finally {
    restore();
  }
});

test('resolveDevOfflineLicensePublicKeyPem: POS_APP_MODE=pos (build empacotado) -> SEMPRE null, mesmo em NODE_ENV=development', () => {
  process.env.NODE_ENV = 'development';
  process.env.POS_APP_MODE = 'pos';
  process.env.POS_DEV_OFFLINE_LICENSE_KEY_ID = 'dev-key-1';
  process.env.POS_DEV_OFFLINE_LICENSE_PUBLIC_KEY = SAMPLE_PEM;
  try {
    assert.equal(resolveDevOfflineLicensePublicKeyPem('dev-key-1'), null);
  } finally {
    restore();
  }
});

test('resolveDevOfflineLicensePublicKeyPem: key_id não coincide -> null (fail closed)', () => {
  process.env.NODE_ENV = 'development';
  delete process.env.POS_APP_MODE;
  process.env.POS_DEV_OFFLINE_LICENSE_KEY_ID = 'dev-key-1';
  process.env.POS_DEV_OFFLINE_LICENSE_PUBLIC_KEY = SAMPLE_PEM;
  try {
    assert.equal(resolveDevOfflineLicensePublicKeyPem('outro-key'), null);
  } finally {
    restore();
  }
});

test('resolveOfflineLicensePublicKeyPem: sem nenhuma chave (embarcada vazia, sem env dev) -> null', () => {
  process.env.NODE_ENV = 'development';
  delete process.env.POS_DEV_OFFLINE_LICENSE_KEY_ID;
  delete process.env.POS_DEV_OFFLINE_LICENSE_PUBLIC_KEY;
  try {
    assert.equal(resolveOfflineLicensePublicKeyPem('qualquer-key'), null);
  } finally {
    restore();
  }
});

test('resolveEmbeddedOfflineLicensePublicKeyPem: registo de produção está vazio por agora (sem chave de lançamento ainda emitida)', () => {
  assert.equal(resolveEmbeddedOfflineLicensePublicKeyPem('offline-2026-01'), null);
});
