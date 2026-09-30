/**
 * Pilot Gate offline (achado real numa instalação piloto): um produto criado
 * localmente (Store Server 100% offline) ficava invisível na grelha do POS
 * assim que `store_catalog_state` já estivesse inicializado (mesmo por um
 * pull vazio) — o produto recebe cloud_id logo na criação, mas nunca tinha
 * linha em store_products (essa só vinha de sync, que nunca corre offline).
 *
 * Correcção (Desenho B, aprovado): createProduct() cria products +
 * store_products (status=active) na MESMA transacção — o produto nasce já
 * pertencente a esta Store, sem depender de cloud_id/cloud_synced_at nem de
 * qualquer ciclo de sync. Backfill idempotente (api/schema/bootstrap.js)
 * cobre instalações já existentes com produtos órfãos — mas só activa
 * produtos com prova de origem LOCAL (entrada em sync_queue), nunca um
 * produto só puxado da cloud (mestre partilhado do tenant, pode pertencer a
 * outra Store).
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'posly-store-catalog-offline-'));
process.env.POS_DB_PATH = path.join(tmpDir, 'database.db');
process.env.DEFAULT_TENANT_ID = 'tenant-store-catalog-offline';

const db = (await import('../../api/database.js')).default;
const cat = await import('../../api/services/storeCatalog.service.js');
const { createProduct, listProducts } = await import('../../api/services/product.service.js');

const T = 'tenant-store-catalog-offline';
const ACTOR = { id: 'admin-local', tenant_id: T, role: 'admin' };
const now = () => new Date().toISOString();
const runDb = (sql, p = []) => new Promise((res, rej) => db.run(sql, p, function onRun(e) { e ? rej(e) : res(this); }));
const allDb = (sql, p = []) => new Promise((res, rej) => db.all(sql, p, (e, r) => (e ? rej(e) : res(r))));
const getDb = (sql, p = []) => new Promise((res, rej) => db.get(sql, p, (e, r) => (e ? rej(e) : res(r ?? null))));

/** Re-executa a MESMA lógica de backfill de api/schema/bootstrap.js (H: idempotência). */
async function runBackfillAgain() {
  return runDb(
    `INSERT OR IGNORE INTO store_products (tenant_id, product_cloud_id, status, updated_at)
     SELECT p.tenant_id, p.cloud_id, 'active', ?
     FROM products p
     WHERE p.cloud_id IS NOT NULL
       AND TRIM(p.cloud_id) != ''
       AND NOT EXISTS (
         SELECT 1 FROM store_products sp
         WHERE sp.tenant_id = p.tenant_id AND sp.product_cloud_id = p.cloud_id
       )
       AND EXISTS (
         SELECT 1 FROM sync_queue sq
         WHERE sq.tenant_id = p.tenant_id AND sq.type = 'product' AND sq.dedupe_key = p.tenant_id || ':product:' || p.id
       )`,
    [now()],
  );
}

async function ready() {
  const deadline = Date.now() + 8000;
  for (;;) {
    try {
      await allDb('SELECT 1 FROM store_products LIMIT 1');
      await allDb('SELECT 1 FROM store_catalog_state LIMIT 1');
      await allDb('SELECT 1 FROM sync_queue LIMIT 1');
      return;
    } catch (e) {
      if (Date.now() > deadline) throw e;
      await new Promise((r) => setTimeout(r, 100));
    }
  }
}

test('A) store_catalog_state já inicializado (simula pull anterior, mesmo vazio)', async () => {
  await ready();
  await runDb(`INSERT OR IGNORE INTO store_catalog_state (tenant_id, initialized_at) VALUES (?, ?)`, [T, now()]);
  const state = await getDb(`SELECT 1 AS ok FROM store_catalog_state WHERE tenant_id = ?`, [T]);
  assert.ok(state, 'precondição: catálogo por Store já inicializado antes de criar o produto offline');
});

test('B+C) criar produto OFFLINE -> products + store_products(active) criados atomicamente', async () => {
  const result = await createProduct({ name: 'Produto Offline', price: 10 }, ACTOR);
  assert.equal(result.success, true);
  const sp = await getDb(
    `SELECT status FROM store_products WHERE tenant_id = ? AND product_cloud_id = ?`,
    [T, result.cloud_id],
  );
  assert.ok(sp, 'store_products deve existir logo após createProduct, sem esperar por sync');
  assert.equal(sp.status, 'active');
});

test('D) GET /produtos?store_available=1 (listProducts) continua mostrando o produto após "refetch"', async () => {
  const sellableBefore = await listProducts({ store_available: '1' }, { tenant_id: T });
  assert.ok(sellableBefore.some((p) => p.name === 'Produto Offline'));
  // "refetch" = nova chamada à mesma query, tal como o POS faz ao voltar o foco.
  const sellableAfter = await listProducts({ store_available: '1' }, { tenant_id: T });
  assert.ok(sellableAfter.some((p) => p.name === 'Produto Offline'), 'não deve desaparecer num refetch');
});

test('E) pull posterior (sincronização real) não duplica nem regride o estado', async () => {
  const product = await getDb(`SELECT cloud_id FROM products WHERE tenant_id = ? AND name = ?`, [T, 'Produto Offline']);
  await cat.applyStoreProductRows(T, [
    { product_id: product.cloud_id, status: 'active', price_override: 9.99, updated_at: now() },
  ]);
  const rows = await allDb(
    `SELECT status, price_override FROM store_products WHERE tenant_id = ? AND product_cloud_id = ?`,
    [T, product.cloud_id],
  );
  assert.equal(rows.length, 1, 'nunca deve haver mais do que uma linha store_products para o mesmo produto');
  assert.equal(rows[0].status, 'active');
  assert.equal(rows[0].price_override, 9.99, 'o pull real deve reconciliar/actualizar a linha pré-semeada, não ignorá-la');
});

test('G) backfill NUNCA activa um produto que só existe por ter sido puxado de outra Store/cloud', async () => {
  const otherStoreCloudId = crypto.randomUUID();
  // Simula syncProductsFromCloud: produto INSERIDO directamente (mestre partilhado do tenant),
  // SEM passar por createProduct/enqueueSync -> nunca fica em sync_queue.
  await runDb(
    `INSERT INTO products (cloud_id, tenant_id, name, price, created_at, updated_at) VALUES (?, ?, ?, 20, ?, ?)`,
    [otherStoreCloudId, T, 'Produto de Outra Store', now(), now()],
  );
  await runBackfillAgain();
  const sp = await getDb(
    `SELECT 1 AS ok FROM store_products WHERE tenant_id = ? AND product_cloud_id = ?`,
    [T, otherStoreCloudId],
  );
  assert.equal(sp, null, 'produto sem prova de origem local (sem sync_queue) nunca deve ser activado pelo backfill');
  const sellable = await listProducts({ store_available: '1' }, { tenant_id: T });
  assert.ok(!sellable.some((p) => p.name === 'Produto de Outra Store'));
});

test('H) backfill corrido 2x continua idempotente (sem duplicar, sem erro)', async () => {
  // Produto "órfão" pré-existente: criado localmente (tem sync_queue) mas sem store_products —
  // simula uma instalação anterior a esta correcção.
  const orphanCloudId = crypto.randomUUID();
  const insert = await runDb(
    `INSERT INTO products (cloud_id, tenant_id, name, price, created_at, updated_at) VALUES (?, ?, ?, 15, ?, ?)`,
    [orphanCloudId, T, 'Produto Órfão Pré-Correcção', now(), now()],
  );
  const orphanId = insert.lastID;
  await runDb(
    `INSERT INTO sync_queue (tenant_id, type, data, dedupe_key, status, created_at, updated_at)
     VALUES (?, 'product', '{}', ?, 'pending', ?, ?)`,
    [T, `${T}:product:${orphanId}`, now(), now()],
  );

  await runBackfillAgain();
  const first = await allDb(`SELECT status FROM store_products WHERE tenant_id = ? AND product_cloud_id = ?`, [T, orphanCloudId]);
  assert.equal(first.length, 1);
  assert.equal(first[0].status, 'active');

  await runBackfillAgain();
  await runBackfillAgain();
  const after = await allDb(`SELECT status FROM store_products WHERE tenant_id = ? AND product_cloud_id = ?`, [T, orphanCloudId]);
  assert.equal(after.length, 1, 'correr o backfill várias vezes nunca duplica a linha');
  assert.equal(after[0].status, 'active');
});
