/**
 * Pilot Gate — diagnóstico seguro da fila de sync (achado real: 13 pendentes
 * sem visibilidade de tipo). GET /sync/status ganhou "byType": contagens por
 * status+type (pending/failed/dead), SEM nunca expor sync_queue.data (o
 * payload/negócio: nomes, preços, clientes). Processo API real spawnado,
 * HTTP real (não chamada directa de controller) — cobre também a exigência
 * de autenticação existente na rota.
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

const AUTH_HEADERS = {
  'x-auth-user': JSON.stringify({ id: 'admin-local', role: 'admin' }),
  'Content-Type': 'application/json',
};

const CATEGORY_NAME = 'Categoria Diagnostico ByType QzX9';
const PRODUCT_NAME_1 = 'Produto Diagnostico ByType QzX9-A';
const PRODUCT_NAME_2 = 'Produto Diagnostico ByType QzX9-B';

test('GET /sync/status: byType agrupado por status+type, correcto, offline funciona, exige auth, sem dados de negócio', async () => {
  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'posly-sync-bytype-'));
  const dbPath = path.join(userDataPath, 'database.db');
  const port = 6000 + Math.floor(Math.random() * 150);
  const TENANT = 'tenant-sync-status-bytype';

  const env = {
    ...process.env,
    POS_DB_PATH: dbPath,
    POS_USER_DATA_PATH: userDataPath,
    POS_API_PORT: String(port),
    NODE_ENV: 'test',
    DEFAULT_TENANT_ID: TENANT,
    AUTH_ALLOW_MOCK_HEADERS: 'true',
  };
  // Nunca configurar cloud neste teste — prova "offline funciona" sem qualquer rede/sync
  // real. Usar string vazia (não `delete`): o processo spawnado recarrega .env.local no
  // arranque, e loadEnvFile() nunca sobrepõe uma chave já presente no ambiente herdado
  // (mesmo vazia) — só assim fica garantido que o .env.local real do repo não repõe
  // SUPABASE_URL/ANON_KEY para este teste.
  env.SUPABASE_URL = '';
  env.NEXT_PUBLIC_SUPABASE_URL = '';
  env.SUPABASE_ANON_KEY = '';
  env.SUPABASE_SERVICE_ROLE_KEY = '';
  delete env.POS_DB_ENCRYPTION;
  delete env.POS_DB_ENCRYPTION_KEY;
  // Nunca activar o fallback legado — para a chamada sem credenciais ter de facto de falhar.
  delete env.AUTH_ALLOW_LEGACY_LOCAL;

  const server = runServer(env, port);
  try {
    await server.ready;
    await new Promise((r) => setTimeout(r, 400));

    // 4) endpoint exige autenticação — sem qualquer credencial deve ser recusado.
    const unauthRes = await fetch(`http://127.0.0.1:${port}/sync/status`, { method: 'GET' });
    assert.equal(unauthRes.status, 401, 'GET /sync/status sem credenciais deve continuar a exigir autenticação (401)');

    // Semear 1 categoria + 2 produtos reais via HTTP (nunca chamada directa de função) —
    // cada criação enfileira exactamente 1 linha em sync_queue.
    const catRes = await fetch(`http://127.0.0.1:${port}/categorias`, {
      method: 'POST',
      headers: AUTH_HEADERS,
      body: JSON.stringify({ name: CATEGORY_NAME }),
    });
    assert.equal(catRes.status, 200, `criação de categoria falhou: ${await catRes.text()}`);

    for (const name of [PRODUCT_NAME_1, PRODUCT_NAME_2]) {
      const prodRes = await fetch(`http://127.0.0.1:${port}/produtos`, {
        method: 'POST',
        headers: AUTH_HEADERS,
        body: JSON.stringify({ name, price: 10 }),
      });
      assert.equal(prodRes.status, 200, `criação de produto falhou: ${await prodRes.text()}`);
    }

    const statusRes = await fetch(`http://127.0.0.1:${port}/sync/status`, { headers: AUTH_HEADERS });
    assert.equal(statusRes.status, 200);
    const statusPayload = await statusRes.json();
    const data = statusPayload?.data ?? statusPayload;
    const rawBody = JSON.stringify(statusPayload);

    // 1) totais continuam correctos.
    assert.equal(data.pending, 3, 'total pendente deve reflectir exactamente os 3 itens semeados');
    assert.equal(data.total_pending, 3);
    assert.equal(data.failed, 0);

    // 2) contagens agrupadas correctas — só type -> count, nunca a linha inteira.
    assert.deepEqual(data.byType.pending, { category: 1, product: 2 });
    assert.deepEqual(data.byType.failed, {});
    assert.deepEqual(data.byType.dead, {});

    // 3) offline funciona: sem cloud configurada, o endpoint continua a responder
    // correctamente, sem tentar nenhuma sonda de rede real (isolamento já confirmado
    // no teste sync-status-offline.test.mjs; aqui confirmamos que o byType também
    // funciona neste modo).
    assert.equal(data.cloud_configured, false);
    assert.equal(data.online, false);
    assert.equal(data.mode, 'offline_only');

    // 5) nunca expor sync_queue.data / payload de negócio — nem os nomes reais
    // usados para semear os dados devem aparecer na resposta.
    assert.ok(!rawBody.includes(CATEGORY_NAME), 'a resposta nunca deve conter o nome da categoria (payload de negócio)');
    assert.ok(!rawBody.includes(PRODUCT_NAME_1), 'a resposta nunca deve conter o nome do produto (payload de negócio)');
    assert.ok(!rawBody.includes(PRODUCT_NAME_2), 'a resposta nunca deve conter o nome do produto (payload de negócio)');
    assert.ok(!('payload' in data), 'a resposta nunca deve incluir a coluna payload/data da fila');
  } finally {
    server.child.kill('SIGKILL');
    try {
      fs.rmSync(userDataPath, { recursive: true, force: true });
    } catch {
      // Windows pode manter um handle breve depois de matar o processo filho.
    }
  }
});
