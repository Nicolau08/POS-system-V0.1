/**
 * Integração REAL (Etapa 1F.3, itens 15/16/19) — spawna o processo REAL
 * `api/server.js` (o mesmo que o Electron spawna em produção) contra o
 * Postgres real (supabase/), com SUPABASE_SERVICE_ROLE_KEY AUSENTE
 * do ambiente do processo (teste 1) e depois ENVENENADO com um valor
 * propositadamente inválido (teste 2). Prova: startup PASS, API local PASS,
 * sync automático arranca (startSyncService chamada), stock routes
 * respondem sem crash mesmo sem RLS para o ledger.
 *
 * Requer env: POSLY_1F3_ISSUER_URL, POSLY_1F3_SUPABASE_URL,
 *   POSLY_1F3_SUPABASE_ANON_KEY, POSLY_1F3_ADMIN_TOKEN,
 *   POSLY_1F3_TENANT_ID, POSLY_1F3_LICENSE_ID, POSLY_1F3_STORE_ID.
 * Sem eles, os testes são saltados.
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { test, mock } from 'node:test';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');

const ISSUER_URL = process.env.POSLY_1F3_ISSUER_URL || '';
const SUPABASE_URL = process.env.POSLY_1F3_SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.POSLY_1F3_SUPABASE_ANON_KEY || '';
const ADMIN_TOKEN = process.env.POSLY_1F3_ADMIN_TOKEN || '';
const TENANT_ID = process.env.POSLY_1F3_TENANT_ID || '';
const LICENSE_ID = process.env.POSLY_1F3_LICENSE_ID || '';
const STORE_ID = process.env.POSLY_1F3_STORE_ID || '';
const shouldRun = Boolean(ISSUER_URL && SUPABASE_URL && SUPABASE_ANON_KEY && ADMIN_TOKEN && TENANT_ID && LICENSE_ID);

mock.module('electron', {
  exports: {
    safeStorage: {
      isEncryptionAvailable: () => true,
      encryptString: (s) => Buffer.concat([Buffer.from('FAKEENC:'), Buffer.from(s, 'utf8')]),
      decryptString: (b) => Buffer.from(b).subarray(8).toString('utf8'),
    },
  },
});

async function issueActivationToken() {
  const res = await fetch(`${ISSUER_URL}/api/license-issuer/device/activation-tokens`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${ADMIN_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ tenant_id: TENANT_ID, license_id: LICENSE_ID, store_id: STORE_ID }),
  });
  const data = await res.json();
  assert.ok(data.activation_token, `falha a emitir activation token: ${JSON.stringify(data)}`);
  return data.activation_token;
}

async function waitForHttp(url, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  let lastErr = null;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      return res;
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 300));
    }
  }
  throw lastErr || new Error('timeout');
}

/**
 * @param {{ serviceRoleValue: 'unset' | 'poison', label: string }} params
 */
async function runServerScenario({ serviceRoleValue, label }) {
  const { bootstrapDevice } = await import('../../electron/deviceAuth/deviceAuthClient.js');
  const { startDeviceAuthBridge, stopDeviceAuthBridge } = await import('../../electron/deviceAuth/deviceAuthBridge.js');

  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'posly-1f3-srv-'));
  const dbPath = path.join(userDataPath, 'database.db');
  const activationToken = await issueActivationToken();

  const boot = await bootstrapDevice({
    activationToken,
    machineId: `machine-1f3-${label}`,
    userDataPath,
    issuerBaseUrl: ISSUER_URL,
  });
  assert.equal(boot.ok, true, `bootstrap real falhou (${label}): ${JSON.stringify(boot)}`);

  const bridge = await startDeviceAuthBridge({ userDataPath, issuerBaseUrl: ISSUER_URL });

  const port = 4100 + Math.floor(Math.random() * 500);
  const env = {
    ...process.env,
    POS_API_PORT: String(port),
    POS_DB_PATH: dbPath,
    POS_USER_DATA_PATH: userDataPath,
    NODE_ENV: 'development',
    SUPABASE_URL,
    SUPABASE_ANON_KEY,
    POS_DEVICE_AUTH_BRIDGE_URL: bridge.url,
    POS_DEVICE_AUTH_BRIDGE_SECRET: bridge.secret,
    DEFAULT_TENANT_ID: TENANT_ID,
  };
  delete env.SUPABASE_SERVICE_ROLE_KEY;
  if (serviceRoleValue === 'poison') {
    env.SUPABASE_SERVICE_ROLE_KEY = 'INVALID_SHOULD_NEVER_BE_USED';
  }
  // Confirmação explícita do estado da env var deste processo filho (item 15/16).
  assert.equal(
    serviceRoleValue === 'poison' ? env.SUPABASE_SERVICE_ROLE_KEY : env.SUPABASE_SERVICE_ROLE_KEY,
    serviceRoleValue === 'poison' ? 'INVALID_SHOULD_NEVER_BE_USED' : undefined,
  );

  let stdout = '';
  const child = spawn(process.execPath, [path.join(repoRoot, 'api', 'server.js')], {
    cwd: repoRoot,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (d) => {
    stdout += d.toString();
  });
  child.stderr.on('data', (d) => {
    stdout += d.toString();
  });

  try {
    const health = await waitForHttp(`http://127.0.0.1:${port}/setup/status`, 20000);
    assert.ok(health.status < 500, `API local (${label}) devolveu ${health.status} no arranque — startup FAIL`);

    // Dar tempo ao listen-callback (onde startSyncService() é chamada) para correr.
    await new Promise((r) => setTimeout(r, 1500));

    assert.ok(
      stdout.includes('"sync_supabase_ready"') || stdout.includes('sync.supabase_ready'),
      `(${label}) startSyncService() tem de ter sido chamada mesmo sem SUPABASE_SERVICE_ROLE_KEY válido — log completo:\n${stdout}`,
    );
    assert.equal(
      stdout.includes('"sync_offline_only"'),
      false,
      `(${label}) NÃO devia cair em modo offline-only — isso significaria que ainda depende de SUPABASE_SERVICE_ROLE_KEY`,
    );

    // Stock routes: nunca 500/crash — 401 sem auth é o esperado (authenticateUser).
    const stockRes = await fetch(`http://127.0.0.1:${port}/stock`);
    assert.notEqual(stockRes.status, 500, `(${label}) /stock nunca deve devolver 500`);

    // Nenhum log deve conter o valor "poison" nem qualquer chave real.
    assert.equal(stdout.includes('INVALID_SHOULD_NEVER_BE_USED'), false, `(${label}) valor poison nunca deve aparecer nos logs`);
  } finally {
    child.kill('SIGKILL');
    stopDeviceAuthBridge();
    try {
      fs.rmSync(userDataPath, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }

  return stdout;
}

test(
  'api/server.js real: SUPABASE_SERVICE_ROLE_KEY AUSENTE — startup/API local/sync automático PASS (item 15)',
  { skip: !shouldRun && 'defina POSLY_1F3_* para correr' },
  async () => {
    await runServerScenario({ serviceRoleValue: 'unset', label: 'absent' });
  },
);

test(
  'api/server.js real: SUPABASE_SERVICE_ROLE_KEY ENVENENADO — novo runtime ignora-o, continua a funcionar (item 16)',
  { skip: !shouldRun && 'defina POSLY_1F3_* para correr' },
  async () => {
    await runServerScenario({ serviceRoleValue: 'poison', label: 'poison' });
  },
);
