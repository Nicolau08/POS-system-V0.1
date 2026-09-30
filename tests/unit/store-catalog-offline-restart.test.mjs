/**
 * Pilot Gate offline — regressão do caminho COMPLETO real (F: restart):
 * processo API real spawnado, HTTP real (não chamada directa de serviço),
 * catálogo por Store já inicializado (simula um pull anterior, mesmo vazio,
 * exactamente o estado real encontrado na VM), criar produto 100% offline
 * via POST /produtos, confirmar que aparece em GET /produtos?store_available=1
 * — e que continua a aparecer depois de matar e reabrir o processo API
 * ("fechar e reabrir" a app) apontado para a MESMA BD.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function waitForHttp(url, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  return (async () => {
    let lastErr = null;
    while (Date.now() < deadline) {
      try {
        return await fetch(url);
      } catch (err) {
        lastErr = err;
        await new Promise((r) => setTimeout(r, 200));
      }
    }
    throw lastErr || new Error('timeout à espera de ' + url);
  })();
}

function runServer(env, port) {
  let out = '';
  const child = spawn(process.execPath, [path.join(repoRoot, 'api', 'server.js')], {
    cwd: repoRoot,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (d) => (out += d.toString()));
  child.stderr.on('data', (d) => (out += d.toString()));
  const ready = waitForHttp(`http://127.0.0.1:${port}/setup/status`);
  return { child, ready, getLog: () => out };
}

const AUTH_HEADERS = { 'x-auth-user': JSON.stringify({ id: 'admin-local', role: 'admin' }), 'Content-Type': 'application/json' };

test('produto criado offline continua vendável após restart do processo API (mesma BD)', async () => {
  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'posly-store-catalog-restart-'));
  const dbPath = path.join(userDataPath, 'database.db');
  // Faixa 5500-5649: nunca colide com outras faixas de testes spawn-based (ver
  // comentário equivalente em offline-license-tenant-resolution-restart.test.mjs)
  // nem com a faixa 5300-5449 usada por esse mesmo ficheiro.
  const port1 = 5500 + Math.floor(Math.random() * 150);
  const TENANT = 'tenant-store-catalog-restart';
  const baseEnv = {
    ...process.env,
    POS_DB_PATH: dbPath,
    POS_USER_DATA_PATH: userDataPath,
    NODE_ENV: 'test',
    DEFAULT_TENANT_ID: TENANT,
    AUTH_ALLOW_MOCK_HEADERS: 'true',
  };
  delete baseEnv.POS_DB_ENCRYPTION;
  delete baseEnv.POS_DB_ENCRYPTION_KEY;

  try {
    const server1 = runServer({ ...baseEnv, POS_API_PORT: String(port1) }, port1);
    await server1.ready;
    await new Promise((r) => setTimeout(r, 400));

    // A) simula um pull anterior (mesmo vazio) que já inicializou o catálogo por Store —
    // exactamente o estado real da VM antes do produto ser criado offline.
    const initRes = await fetch(`http://127.0.0.1:${port1}/produtos?store_available=1`, { headers: AUTH_HEADERS });
    assert.equal(initRes.status, 200);

    // B) criar produto 100% offline via HTTP real (não chamada directa de função).
    const createRes = await fetch(`http://127.0.0.1:${port1}/produtos`, {
      method: 'POST',
      headers: AUTH_HEADERS,
      body: JSON.stringify({ name: 'Produto Restart Offline', price: 12 }),
    });
    const createData = await createRes.json();
    assert.equal(createRes.status, 200, `criação falhou: ${JSON.stringify(createData)}`);

    // D) aparece logo na grelha vendável, no mesmo processo.
    const sameProcessRes = await fetch(`http://127.0.0.1:${port1}/produtos?store_available=1`, { headers: AUTH_HEADERS });
    const sameProcessData = await sameProcessRes.json();
    const sameProcessRows = Array.isArray(sameProcessData) ? sameProcessData : sameProcessData?.data ?? [];
    assert.ok(
      sameProcessRows.some((p) => p.name === 'Produto Restart Offline'),
      'produto deve aparecer na grelha vendável logo após criar, no mesmo processo',
    );

    server1.child.kill('SIGKILL');
    await new Promise((r) => setTimeout(r, 400));

    // F) "fechar e reabrir": processo NOVO, MESMA BD.
    const port2 = port1 + 1;
    const server2 = runServer({ ...baseEnv, POS_API_PORT: String(port2) }, port2);
    await server2.ready;
    await new Promise((r) => setTimeout(r, 400));

    const restartRes = await fetch(`http://127.0.0.1:${port2}/produtos?store_available=1`, { headers: AUTH_HEADERS });
    const restartData = await restartRes.json();
    const restartRows = Array.isArray(restartData) ? restartData : restartData?.data ?? [];
    assert.ok(
      restartRows.some((p) => p.name === 'Produto Restart Offline'),
      'REGRESSÃO: produto criado offline desapareceu da grelha vendável depois de reiniciar o processo API',
    );

    server2.child.kill('SIGKILL');
  } finally {
    try {
      fs.rmSync(userDataPath, { recursive: true, force: true });
    } catch {
      // Windows pode manter um handle breve depois de matar o processo filho.
    }
  }
});
