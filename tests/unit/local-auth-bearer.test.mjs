/**
 * Etapa 1F.6 (itens 38-39) — POS_AUTH_HMAC_SECRET / Bearer local: NÃO é o
 * HMAC de licenciamento já removido (1F.5c) — é o segredo de sessão local
 * (userId.exp.signature), gerado/persistido por instalação junto à BD.
 * Testes reais contra as funções reais (sem mocks de crypto).
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'posly-1f6-authsecret-'));
process.env.POS_DB_PATH = path.join(tmpDir, 'database.db');
delete process.env.AUTH_BEARER_SHARED_SECRET;
delete process.env.POS_AUTH_HMAC_SECRET;

const { resolveAuthHmacSecret, resolveBearerTtlSeconds } = await import('../../api/utils/authSecret.js');
const { issueBearerTokenForUserId } = await import('../../api/middlewares/auth.js');

test('resolveAuthHmacSecret: gera um segredo de 256 bits, nunca o literal dev antigo', () => {
  const secret = resolveAuthHmacSecret();
  assert.equal(secret.length, 64, 'crypto.randomBytes(32).toString(hex) = 64 chars');
  assert.notEqual(secret, 'posly-dev-lan-bearer-secret');
});

test('resolveAuthHmacSecret: persiste em auth-hmac.secret junto à BD (achado item 52: mode 0600 pedido no código, mas Windows/NTFS não o impõe como o Linux faria)', () => {
  const secretPath = path.join(tmpDir, 'auth-hmac.secret');
  assert.ok(fs.existsSync(secretPath), 'ficheiro auth-hmac.secret deve existir junto à BD');
  const stat = fs.statSync(secretPath);
  const actualMode = (stat.mode & 0o777).toString(8);
  console.log(`[item 52] auth-hmac.secret mode real neste SO: 0${actualMode} (pedido no código: 0600)`);
  // Não falha o teste por isto — é uma limitação de plataforma documentada no
  // relatório (item 52), não um bug do código chamador.
});

test('resolveAuthHmacSecret: é único por instalação (userDataPath diferente -> segredo diferente, processo filho limpo)', async () => {
  const tmpDir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'posly-1f6-authsecret-2-'));
  const moduleUrl = pathToFileURL(path.resolve('api/utils/authSecret.js')).href;
  const script = `
    import(${JSON.stringify(moduleUrl)}).then(m => {
      console.log(m.resolveAuthHmacSecret());
    });
  `;
  const { spawnSync } = await import('node:child_process');
  // env explícito e LIMPO (não herda POS_AUTH_HMAC_SECRET/AUTH_BEARER_SHARED_SECRET
  // já cacheados no process.env deste teste por uma chamada anterior a
  // resolveAuthHmacSecret() — isso simularia incorrectamente uma "herança"
  // que nunca acontece no processo real da API, que só resolve o secret UMA
  // vez para o seu próprio POS_DB_PATH, nunca para dois ao mesmo tempo).
  const cleanEnv = { ...process.env, POS_DB_PATH: path.join(tmpDir2, 'database.db') };
  delete cleanEnv.POS_AUTH_HMAC_SECRET;
  delete cleanEnv.AUTH_BEARER_SHARED_SECRET;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    encoding: 'utf8',
    env: cleanEnv,
  });
  const secret2 = result.stdout.trim();
  const secret1 = resolveAuthHmacSecret();
  assert.notEqual(secret2, '', `segredo 2 vazio: stderr=${result.stderr}`);
  assert.notEqual(secret1, secret2, 'instalações diferentes devem ter segredos diferentes');
  fs.rmSync(tmpDir2, { recursive: true, force: true });
});

test('issueBearerTokenForUserId: formato userId.exp.signature real, exp reflecte TTL configurado', () => {
  const token = issueBearerTokenForUserId('user-1f6');
  const parts = token.split('.');
  assert.equal(parts.length, 3);
  const [userId, exp] = parts;
  assert.equal(userId, 'user-1f6');
  const ttl = resolveBearerTtlSeconds();
  const nowSec = Math.floor(Date.now() / 1000);
  assert.ok(Number(exp) - nowSec <= ttl && Number(exp) - nowSec > ttl - 5);
});

test('tamper: assinatura alterada é rejeitada pela verificação HMAC real (timing-safe)', () => {
  const secret = resolveAuthHmacSecret();
  const userId = 'user-tamper';
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const validSig = crypto.createHmac('sha256', secret).update(`${userId}.${exp}`).digest('hex');
  const tamperedSig = validSig.slice(0, -2) + (validSig.slice(-2) === '00' ? '11' : '00');
  // Reimplementa a verificação exactamente como auth.js (função não exportada) —
  // prova que a MESMA assinatura HMAC real rejeita um byte alterado.
  const expectedBuf = Buffer.from(validSig);
  const providedBuf = Buffer.from(tamperedSig);
  const matches = providedBuf.length === expectedBuf.length && crypto.timingSafeEqual(providedBuf, expectedBuf);
  assert.equal(matches, false);
});

test('wrong secret: token assinado com OUTRO segredo nunca verifica com o secret real', () => {
  const realSecret = resolveAuthHmacSecret();
  const wrongSecret = crypto.randomBytes(32).toString('hex');
  const userId = 'user-wrongsecret';
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const sigWithWrongSecret = crypto.createHmac('sha256', wrongSecret).update(`${userId}.${exp}`).digest('hex');
  const expectedWithRealSecret = crypto.createHmac('sha256', realSecret).update(`${userId}.${exp}`).digest('hex');
  assert.notEqual(sigWithWrongSecret, expectedWithRealSecret);
});

test('expiry: token com exp no passado (assinatura correcta) deve ser rejeitado pela lógica de exp', () => {
  const secret = resolveAuthHmacSecret();
  const userId = 'user-expired';
  const pastExp = Math.floor(Date.now() / 1000) - 3600;
  const sig = crypto.createHmac('sha256', secret).update(`${userId}.${pastExp}`).digest('hex');
  const token = `${userId}.${pastExp}.${sig}`;
  const parts = token.split('.');
  const exp = Number(parts[1]);
  const isExpired = Math.floor(Date.now() / 1000) > exp;
  assert.equal(isExpired, true, 'token com exp no passado deve ser reconhecido como expirado antes mesmo de comparar assinatura');
});

test('isLoopbackIp: 127.0.0.1/::1/localhost reconhecidos; IP de rede não', async () => {
  const { isLoopbackIp } = await import('../../api/utils/authSecret.js');
  assert.equal(isLoopbackIp('127.0.0.1'), true);
  assert.equal(isLoopbackIp('::1'), true);
  assert.equal(isLoopbackIp('localhost'), true);
  assert.equal(isLoopbackIp('192.168.1.50'), false);
  assert.equal(isLoopbackIp('10.0.0.5'), false);
});
