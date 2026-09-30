/**
 * Pilot Gate — prova do mismatch de tenant (achado real: 3 categorias + 2
 * produtos "dead" por RLS). GET /sync/status ganhou "tenantDiagnostic":
 * contagens current/other para categories/products (tabelas locais) e para
 * itens `dead` de category/product na fila (comparando o tenant_id do
 * PRÓPRIO payload, nunca o resto do payload). Só booleans agregados em
 * COUNT — nunca o tenant_id em si, nunca nomes/ids/payload de negócio.
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, before } from 'node:test';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'posly-sync-tenant-diag-'));
process.env.POS_DB_PATH = path.join(tmpDir, 'database.db');
process.env.DEFAULT_TENANT_ID = 'tenant-diag-current';
delete process.env.SUPABASE_URL;
delete process.env.NEXT_PUBLIC_SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;

const CURRENT = 'tenant-diag-current';
const OTHER = 'tenant-diag-other';

const db = (await import('../../api/database.js')).default;
const { getSyncStatus } = await import('../../api/controllers/sync.controller.js');

const runDb = (sql, params = []) => new Promise((res, rej) => db.run(sql, params, function onRun(e) { e ? rej(e) : res(this); }));
const allDb = (sql, params = []) => new Promise((res, rej) => db.all(sql, params, (e, r) => (e ? rej(e) : res(r))));
const now = () => new Date().toISOString();

async function ready() {
  const deadline = Date.now() + 8000;
  for (;;) {
    try {
      await allDb('SELECT id FROM categories LIMIT 1');
      await allDb('SELECT id FROM sync_queue LIMIT 1');
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

const CATEGORY_CURRENT_NAME = 'Categoria Actual TenantDiag Q7z';
const CATEGORY_OTHER_NAME = 'Categoria Outro Tenant TenantDiag Q7z';
const PRODUCT_CURRENT_NAME = 'Produto Actual TenantDiag Q7z';
const PRODUCT_OTHER_NAME = 'Produto Outro Tenant TenantDiag Q7z';

before(async () => {
  await ready();

  // Categorias/produtos locais: 1 do tenant actual, 1 de "outro" tenant
  // (simula linhas residuais de uma re-activação anterior).
  await runDb(
    `INSERT INTO categories (name, cloud_id, tenant_id, updated_at) VALUES (?, ?, ?, ?)`,
    [CATEGORY_CURRENT_NAME, crypto.randomUUID(), CURRENT, now()],
  );
  await runDb(
    `INSERT INTO categories (name, cloud_id, tenant_id, updated_at) VALUES (?, ?, ?, ?)`,
    [CATEGORY_OTHER_NAME, crypto.randomUUID(), OTHER, now()],
  );
  await runDb(
    `INSERT INTO products (name, cloud_id, tenant_id, price, created_at, updated_at) VALUES (?, ?, ?, 10, ?, ?)`,
    [PRODUCT_CURRENT_NAME, crypto.randomUUID(), CURRENT, now(), now()],
  );
  await runDb(
    `INSERT INTO products (name, cloud_id, tenant_id, price, created_at, updated_at) VALUES (?, ?, ?, 10, ?, ?)`,
    [PRODUCT_OTHER_NAME, crypto.randomUUID(), OTHER, now(), now()],
  );

  // sync_queue: itens "dead" de category/product, um por tenant (payload nunca
  // exposto de volta — só o tenant_id dentro dele é comparado via json_extract).
  const deadRows = [
    { type: 'category', tenant: CURRENT },
    { type: 'category', tenant: OTHER },
    { type: 'product', tenant: OTHER },
    // um item pending "normal" (não deve entrar nas contagens de queueDead).
    { type: 'category', tenant: CURRENT, status: 'pending' },
  ];
  for (const row of deadRows) {
    await runDb(
      `INSERT INTO sync_queue (tenant_id, type, data, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [row.tenant, row.type, JSON.stringify({ tenant_id: row.tenant, name: 'nome-nunca-deve-sair-na-resposta' }), row.status ?? 'dead', now(), now()],
    );
  }
});

test('tenantDiagnostic: categorias/produtos locais classificados correctamente current vs other', async () => {
  const res = fakeRes();
  await getSyncStatus({ tenantId: CURRENT }, res);
  const data = res.body?.data ?? res.body;

  assert.deepEqual(data.tenantDiagnostic.categories, { current: 1, other: 1 });
  assert.deepEqual(data.tenantDiagnostic.products, { current: 1, other: 1 });
});

test('tenantDiagnostic.queueDead: classificado pelo tenant_id do payload, só itens dead', async () => {
  const res = fakeRes();
  await getSyncStatus({ tenantId: CURRENT }, res);
  const data = res.body?.data ?? res.body;

  // 1 category dead do tenant actual, 1 category dead de outro tenant, 1 pending (ignorado).
  assert.deepEqual(data.tenantDiagnostic.queueDead.category, { current: 1, other: 1 });
  // 1 product dead, só de outro tenant.
  assert.deepEqual(data.tenantDiagnostic.queueDead.product, { current: 0, other: 1 });
});

test('nunca expõe tenant_id, nomes ou payload de negócio na resposta', async () => {
  const res = fakeRes();
  await getSyncStatus({ tenantId: CURRENT }, res);
  const rawBody = JSON.stringify(res.body);

  assert.ok(!rawBody.includes(OTHER), 'o tenant_id "outro" nunca deve aparecer na resposta — só a contagem');
  assert.ok(!rawBody.includes(CATEGORY_CURRENT_NAME));
  assert.ok(!rawBody.includes(CATEGORY_OTHER_NAME));
  assert.ok(!rawBody.includes(PRODUCT_CURRENT_NAME));
  assert.ok(!rawBody.includes(PRODUCT_OTHER_NAME));
  assert.ok(!rawBody.includes('nome-nunca-deve-sair-na-resposta'));
  const data = res.body?.data ?? res.body;
  assert.ok(!('payload' in data));
});

test('byType existente continua a funcionar sem alteração', async () => {
  const res = fakeRes();
  await getSyncStatus({ tenantId: CURRENT }, res);
  const data = res.body?.data ?? res.body;

  assert.ok(data.byType, 'byType deve continuar presente');
  assert.equal(data.byType.pending.category, 1, 'o item pending semeado deve continuar a contar em byType como antes');
  // byType continua exactamente como estava: escopado pela coluna sync_queue.tenant_id = tenant
  // do pedido (nunca pelo payload) — por isso o item "dead" de category do OUTRO tenant
  // (coluna tenant_id=OTHER) fica fora desta contagem, tal como já acontecia antes desta alteração.
  assert.equal(data.byType.dead.category, 1);
  assert.equal(data.byType.dead.product ?? 0, 0);
});
