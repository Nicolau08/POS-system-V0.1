/**
 * Pilot Gate — evidência de tentativas RLS (achado real: 3 categorias + 2
 * produtos "dead" com erro "new row violates row-level security policy").
 * GET /sync/status ganhou "rlsDiagnostic": correlaciona sync_logs com itens
 * `dead` de category/product via queue_id, mas só devolve contagens e
 * timestamps — nunca queue_id, tenant_id, payload ou a mensagem de erro em
 * si. sameRlsErrorAttempts distingue especificamente erros de RLS de outros
 * erros (ex.: unique constraint) que também possam ter ficado registados.
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, before } from 'node:test';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'posly-sync-rls-diag-'));
process.env.POS_DB_PATH = path.join(tmpDir, 'database.db');
process.env.DEFAULT_TENANT_ID = 'tenant-rls-diag';
delete process.env.SUPABASE_URL;
delete process.env.NEXT_PUBLIC_SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;

const TENANT = 'tenant-rls-diag';

const db = (await import('../../api/database.js')).default;
const { getSyncStatus } = await import('../../api/controllers/sync.controller.js');

const runDb = (sql, params = []) => new Promise((res, rej) => db.run(sql, params, function onRun(e) { e ? rej(e) : res(this); }));
const allDb = (sql, params = []) => new Promise((res, rej) => db.all(sql, params, (e, r) => (e ? rej(e) : res(r))));

async function ready() {
  const deadline = Date.now() + 8000;
  for (;;) {
    try {
      await allDb('SELECT id FROM sync_queue LIMIT 1');
      await allDb('SELECT id FROM sync_logs LIMIT 1');
      return;
    } catch (e) {
      if (Date.now() > deadline) throw e;
      await new Promise((r) => setTimeout(r, 100));
    }
  }
}

function fakeRes() {
  const res = { statusCode: 200, body: null };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (payload) => { res.body = payload; return res; };
  return res;
}

const RLS_ERROR_MESSAGE = 'new row violates row-level security policy for table categories';
const OTHER_ERROR_MESSAGE = 'duplicate key value violates unique constraint "categories_name_key"';
const SECRET_PAYLOAD_MARKER = 'nome-nunca-deve-sair-na-resposta-rls';

let categoryQueueId;
let productQueueId;

before(async () => {
  await ready();

  const catInsert = await runDb(
    `INSERT INTO sync_queue (tenant_id, type, data, status, created_at, updated_at)
     VALUES (?, 'category', ?, 'dead', ?, ?)`,
    [TENANT, JSON.stringify({ tenant_id: TENANT, name: SECRET_PAYLOAD_MARKER }), '2026-09-27T08:00:00.000Z', '2026-09-27T08:20:00.000Z'],
  );
  categoryQueueId = catInsert.lastID;

  const prodInsert = await runDb(
    `INSERT INTO sync_queue (tenant_id, type, data, status, created_at, updated_at)
     VALUES (?, 'product', ?, 'dead', ?, ?)`,
    [TENANT, JSON.stringify({ tenant_id: TENANT, name: SECRET_PAYLOAD_MARKER }), '2026-09-27T08:05:00.000Z', '2026-09-27T08:20:00.000Z'],
  );
  productQueueId = prodInsert.lastID;

  // Um item pendente "normal" (não deve entrar nas contagens — só dead conta).
  await runDb(
    `INSERT INTO sync_queue (tenant_id, type, data, status, created_at, updated_at)
     VALUES (?, 'category', ?, 'pending', ?, ?)`,
    [TENANT, JSON.stringify({ tenant_id: TENANT }), '2026-09-27T09:00:00.000Z', '2026-09-27T09:00:00.000Z'],
  );

  // 3 tentativas para a categoria: 2 com erro RLS, 1 com erro diferente (unique constraint).
  const categoryAttempts = [
    { created_at: '2026-09-27T08:00:10.000Z', error: RLS_ERROR_MESSAGE },
    { created_at: '2026-09-27T08:10:00.000Z', error: OTHER_ERROR_MESSAGE },
    { created_at: '2026-09-27T08:20:00.000Z', error: RLS_ERROR_MESSAGE },
  ];
  for (const attempt of categoryAttempts) {
    await runDb(
      `INSERT INTO sync_logs (queue_id, tenant_id, type, payload, error_message, created_at)
       VALUES (?, ?, 'category', ?, ?, ?)`,
      [categoryQueueId, TENANT, JSON.stringify({ tenant_id: TENANT, name: SECRET_PAYLOAD_MARKER }), attempt.error, attempt.created_at],
    );
  }

  // 2 tentativas para o produto (mensagens quaisquer — product não distingue "same RLS").
  const productAttempts = [
    { created_at: '2026-09-27T08:05:10.000Z', error: 'insert or update on table "products" violates foreign key constraint' },
    { created_at: '2026-09-27T08:15:00.000Z', error: 'insert or update on table "products" violates foreign key constraint' },
  ];
  for (const attempt of productAttempts) {
    await runDb(
      `INSERT INTO sync_logs (queue_id, tenant_id, type, payload, error_message, created_at)
       VALUES (?, ?, 'product', ?, ?, ?)`,
      [productQueueId, TENANT, JSON.stringify({ tenant_id: TENANT, name: SECRET_PAYLOAD_MARKER }), attempt.error, attempt.created_at],
    );
  }
});

test('rlsDiagnostic: conta tentativas múltiplas, primeiro/último timestamp e só erros RLS correctamente', async () => {
  const res = fakeRes();
  await getSyncStatus({ tenantId: TENANT }, res);
  const data = res.body?.data ?? res.body;

  assert.equal(data.rlsDiagnostic.category.items, 1, 'só 1 categoria dead, mesmo com 3 tentativas registadas');
  assert.equal(data.rlsDiagnostic.category.totalAttempts, 3);
  assert.equal(data.rlsDiagnostic.category.sameRlsErrorAttempts, 2, 'só as 2 tentativas com erro RLS, nunca a de unique constraint');
  assert.equal(data.rlsDiagnostic.category.firstAttempt, '2026-09-27T08:00:10.000Z');
  assert.equal(data.rlsDiagnostic.category.lastAttempt, '2026-09-27T08:20:00.000Z');

  assert.equal(data.rlsDiagnostic.product.items, 1);
  assert.equal(data.rlsDiagnostic.product.totalAttempts, 2);
  assert.equal(data.rlsDiagnostic.product.firstAttempt, '2026-09-27T08:05:10.000Z');
  assert.equal(data.rlsDiagnostic.product.lastAttempt, '2026-09-27T08:15:00.000Z');
  assert.ok(!('sameRlsErrorAttempts' in data.rlsDiagnostic.product), 'product não tem sameRlsErrorAttempts, conforme o formato pedido');
});

test('rlsDiagnostic nunca expõe queue_id, tenant_id, payload ou a mensagem de erro em si', async () => {
  const res = fakeRes();
  await getSyncStatus({ tenantId: TENANT }, res);
  const data = res.body?.data ?? res.body;
  // Isola só o novo campo — `last_error` (campo pré-existente, fora do âmbito
  // deste pedido) já expõe payload/mensagem por desenho antigo e não deve
  // contaminar esta asserção, que é especificamente sobre rlsDiagnostic.
  const rawRlsDiagnostic = JSON.stringify(data.rlsDiagnostic);

  assert.ok(!rawRlsDiagnostic.includes(String(categoryQueueId)) || String(categoryQueueId).length < 2, 'queue_id nunca deve aparecer em rlsDiagnostic');
  assert.ok(!rawRlsDiagnostic.includes(SECRET_PAYLOAD_MARKER), 'nome/payload de negócio nunca deve aparecer em rlsDiagnostic');
  assert.ok(!rawRlsDiagnostic.includes(RLS_ERROR_MESSAGE), 'a mensagem de erro em si nunca deve aparecer em rlsDiagnostic — só a contagem');
  assert.ok(!rawRlsDiagnostic.includes(OTHER_ERROR_MESSAGE));
  assert.ok(!rawRlsDiagnostic.includes(TENANT), 'o tenant_id nunca deve aparecer em rlsDiagnostic');
});

test('byType e tenantDiagnostic existentes continuam inalterados', async () => {
  const res = fakeRes();
  await getSyncStatus({ tenantId: TENANT }, res);
  const data = res.body?.data ?? res.body;

  assert.ok(data.byType);
  assert.ok(data.tenantDiagnostic);
  assert.equal(data.byType.dead.category, 1);
  assert.equal(data.byType.dead.product, 1);
  assert.equal(data.byType.pending.category, 1);
  assert.deepEqual(data.tenantDiagnostic.categories, { current: 0, other: 0 });
});
