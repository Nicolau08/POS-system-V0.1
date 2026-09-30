/**
 * Etapa 1F.4 (item 3) — scripts/inject-pos-build-secrets.mjs NUNCA pode
 * escrever SUPABASE_SERVICE_ROLE_KEY em electron/.build-secrets.json, mesmo
 * que a variável exista no ambiente da máquina de build. Corre o script real
 * (mesmo caminho que electron-dist usa) como subprocesso.
 *
 * O script real lê sempre <repoRoot>/.env e <repoRoot>/.env.local (este
 * último com override:true) e escreve sempre em
 * <repoRoot>/electron/.build-secrets.json — não há forma de o redireccionar
 * sem alterar o próprio script. Para não arriscar misturar segredos reais
 * do dev nem deixar o repo sujo: faz backup de .env/.env.local/
 * electron/.build-secrets.json antes de cada teste, escreve versões vazias/
 * de teste, corre o script, verifica, e restaura tudo em `finally` (mesmo
 * padrão de backup/restore usado nos testes de integração reais desta
 * etapa/1F.2/1F.3 para supabase/config.toml).
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const CANARY = 'SUPER_SECRET_TEST_VALUE';

const scriptPath = path.join(repoRoot, 'scripts', 'inject-pos-build-secrets.mjs');
const envPath = path.join(repoRoot, '.env');
const envLocalPath = path.join(repoRoot, '.env.local');
const buildSecretsPath = path.join(repoRoot, 'electron', '.build-secrets.json');

function readIfExists(p) {
  try {
    return fs.readFileSync(p, 'utf8');
  } catch {
    return null;
  }
}

function restore(p, contents) {
  if (contents === null) {
    try {
      fs.rmSync(p, { force: true });
    } catch {
      // ignore
    }
  } else {
    fs.writeFileSync(p, contents, 'utf8');
  }
}

function runInjector(extraEnv) {
  const originalEnv = readIfExists(envPath);
  const originalEnvLocal = readIfExists(envLocalPath);
  const originalBuildSecrets = readIfExists(buildSecretsPath);

  // .env/.env.local isolados e inofensivos — evita que segredos reais do
  // dev influenciem o teste (o script dá override:true a .env.local).
  fs.writeFileSync(envPath, '', 'utf8');
  fs.writeFileSync(envLocalPath, '', 'utf8');

  try {
    const baseEnv = { ...process.env };
    delete baseEnv.POS_LICENSE_HMAC_SECRET;
    delete baseEnv.LICENSE_HMAC_SECRET;
    const env = {
      ...baseEnv,
      POS_LICENSE_ISSUER_BASE_URL: '',
      SUPABASE_URL: 'https://example-test.supabase.co',
      SUPABASE_ANON_KEY: 'anon-test-key',
      ...extraEnv,
    };
    const result = spawnSync(process.execPath, [scriptPath], { cwd: repoRoot, env, encoding: 'utf8' });
    const rawAfter = readIfExists(buildSecretsPath);
    return { result, rawAfter };
  } finally {
    restore(envPath, originalEnv);
    restore(envLocalPath, originalEnvLocal);
    restore(buildSecretsPath, originalBuildSecrets);
  }
}

test('injector: SUPABASE_SERVICE_ROLE_KEY=canary no ambiente -> nunca aparece em .build-secrets.json nem no output', () => {
  const { result, rawAfter } = runInjector({ SUPABASE_SERVICE_ROLE_KEY: CANARY });

  assert.equal(result.status, 0, `injector deve terminar com sucesso: stderr=${result.stderr}`);
  assert.ok(rawAfter, '.build-secrets.json deve ter sido gerado');
  assert.equal(rawAfter.includes(CANARY), false, 'o valor canary NUNCA pode aparecer no ficheiro gerado');
  assert.equal(rawAfter.includes('SUPABASE_SERVICE_ROLE_KEY'), false, 'o campo SUPABASE_SERVICE_ROLE_KEY nao pode sequer existir');

  const parsed = JSON.parse(rawAfter);
  assert.equal('SUPABASE_SERVICE_ROLE_KEY' in parsed, false);
  assert.equal(parsed.SUPABASE_URL, 'https://example-test.supabase.co');
  assert.equal(parsed.SUPABASE_ANON_KEY, 'anon-test-key');

  const stdoutErr = `${result.stdout}${result.stderr}`;
  assert.equal(stdoutErr.includes(CANARY), false, 'o valor canary nunca deve aparecer em stdout/stderr do injector');
  assert.ok(stdoutErr.includes('ignorada de propósito'), 'deve avisar que a variável foi ignorada de propósito');
});

test('injector: sem SUPABASE_SERVICE_ROLE_KEY no ambiente -> payload igualmente sem o campo', () => {
  const { result, rawAfter } = runInjector({ SUPABASE_SERVICE_ROLE_KEY: '' });

  assert.equal(result.status, 0, `injector deve terminar com sucesso: stderr=${result.stderr}`);
  const parsed = JSON.parse(rawAfter);
  assert.equal('SUPABASE_SERVICE_ROLE_KEY' in parsed, false);
});

const HMAC_CANARY = 'HMAC_CANARY_MUST_NOT_PACKAGE_TEST_VALUE';

test('injector: POS_LICENSE_HMAC_SECRET=canary no ambiente -> nunca aparece em .build-secrets.json nem no output (Etapa 1F.5c)', () => {
  const { result, rawAfter } = runInjector({ POS_LICENSE_HMAC_SECRET: HMAC_CANARY });

  assert.equal(result.status, 0, `injector deve terminar com sucesso: stderr=${result.stderr}`);
  assert.ok(rawAfter, '.build-secrets.json deve ter sido gerado');
  assert.equal(rawAfter.includes(HMAC_CANARY), false, 'o valor canary HMAC NUNCA pode aparecer no ficheiro gerado');
  assert.equal(rawAfter.includes('POS_LICENSE_HMAC_SECRET'), false, 'o campo POS_LICENSE_HMAC_SECRET nao pode sequer existir');

  const parsed = JSON.parse(rawAfter);
  assert.equal('POS_LICENSE_HMAC_SECRET' in parsed, false);

  const stdoutErr = `${result.stdout}${result.stderr}`;
  assert.equal(stdoutErr.includes(HMAC_CANARY), false, 'o valor canary HMAC nunca deve aparecer em stdout/stderr do injector');
  assert.ok(stdoutErr.includes('ignorada de propósito'), 'deve avisar que a variável foi ignorada de propósito');
});

test('injector: sem POS_LICENSE_HMAC_SECRET no ambiente -> build continua a funcionar (já não é obrigatório)', () => {
  const { result, rawAfter } = runInjector({});
  assert.equal(result.status, 0, `injector deve terminar com sucesso mesmo sem HMAC: stderr=${result.stderr}`);
  const parsed = JSON.parse(rawAfter);
  assert.equal('POS_LICENSE_HMAC_SECRET' in parsed, false);
});

test('injector: DUAL CANARY (item 35) — SUPABASE_SERVICE_ROLE_KEY e POS_LICENSE_HMAC_SECRET envenenados ao mesmo tempo -> ambos ausentes', () => {
  const { result, rawAfter } = runInjector({
    SUPABASE_SERVICE_ROLE_KEY: CANARY,
    POS_LICENSE_HMAC_SECRET: HMAC_CANARY,
  });

  assert.equal(result.status, 0, `injector deve terminar com sucesso: stderr=${result.stderr}`);
  assert.equal(rawAfter.includes(CANARY), false);
  assert.equal(rawAfter.includes(HMAC_CANARY), false);
  const parsed = JSON.parse(rawAfter);
  assert.equal('SUPABASE_SERVICE_ROLE_KEY' in parsed, false);
  assert.equal('POS_LICENSE_HMAC_SECRET' in parsed, false);
});
