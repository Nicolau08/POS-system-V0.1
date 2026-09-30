/**
 * Etapa 1G.2B.4 - catalogo por Store (lado local): estado espelhado de store_products, regra de venda NOVA
 * (active / discontinued / fora da Store), comportamento offline (ultimo estado sincronizado) e listagem.
 * BD SQLite real temporária, sem cloud.
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'posly-1g2b4-'));
process.env.POS_DB_PATH = path.join(tmpDir, 'database.db');
process.env.DEFAULT_TENANT_ID = 'tenant-1g2b4';

const db = (await import('../../api/database.js')).default;
const cat = await import('../../api/services/storeCatalog.service.js');
const { listProducts } = await import('../../api/services/product.service.js');

const T = 'tenant-1g2b4';
const now = () => new Date().toISOString();
const runDb = (sql, p = []) => new Promise((res, rej) => db.run(sql, p, (e) => (e ? rej(e) : res())));
const allDb = (sql, p = []) => new Promise((res, rej) => db.all(sql, p, (e, r) => (e ? rej(e) : res(r))));
const ctx = {};

async function ready() {
  const deadline = Date.now() + 8000;
  for (;;) {
    try {
      await allDb('SELECT 1 FROM store_products LIMIT 1');
      await allDb('SELECT 1 FROM store_catalog_state LIMIT 1');
      return;
    } catch (e) {
      if (Date.now() > deadline) throw e;
      await new Promise((r) => setTimeout(r, 100));
    }
  }
}
const addProduct = async (name, cloudId) => {
  await runDb(`INSERT INTO products (cloud_id, tenant_id, name, price, created_at, updated_at) VALUES (?, ?, ?, 5, ?, ?)`, [cloudId, T, name, now(), now()]);
  return (await allDb(`SELECT id FROM products WHERE name = ? AND tenant_id = ?`, [name, T]))[0].id;
};
const cart = (...ids) => ids.map((id) => ({ id, quantity: 1 }));

test('antes do 1.º pull (catálogo por Store não inicializado) tudo é vendável; o espelho isolado não activa o bloqueio', async () => {
  await ready();
  ctx.cP = crypto.randomUUID(); ctx.cD = crypto.randomUUID(); ctx.cX = crypto.randomUUID();
  ctx.P = await addProduct('P', ctx.cP);
  ctx.D = await addProduct('D', ctx.cD);
  ctx.X = await addProduct('X', ctx.cX);
  ctx.L = await addProduct('Local', null);
  assert.deepEqual(await cat.findUnsellableCartItems(cart(ctx.P, ctx.D, ctx.X, ctx.L), T), []);
  await cat.applyStoreProductRows(T, [{ product_id: ctx.cP, status: 'active' }]); // espelho pós-push, sem inicializar
  assert.deepEqual(await cat.findUnsellableCartItems(cart(ctx.X), T), []);
});

test('depois do pull: active vende; sem linha = fora da Store; discontinued bloqueia; produto só-local (sem cloud_id) vende', async () => {
  await cat.applyStoreProductRows(
    T,
    [
      { product_id: ctx.cP, status: 'active', price_override: 7.5, min_stock: 2, updated_at: now() },
      { product_id: ctx.cD, status: 'discontinued', updated_at: now() },
    ],
    { initialize: true }
  );
  const bad = await cat.findUnsellableCartItems(cart(ctx.P, ctx.D, ctx.X, ctx.L), T);
  assert.deepEqual(bad.map((b) => [b.product_id, b.reason]).sort(), [[ctx.D, 'discontinued'], [ctx.X, 'not_in_store']].sort());
});

test('offline: sem novo pull, o último estado sincronizado mantém-se; só depois do pull discontinued bloqueia', async () => {
  // a cloud descontinuou P mas o POS ainda nao recebeu -> continua vendavel
  assert.deepEqual(await cat.findUnsellableCartItems(cart(ctx.P), T), []);
  await cat.applyStoreProductRows(T, [{ product_id: ctx.cP, status: 'discontinued', price_override: 7.5, min_stock: 2, updated_at: now() }]);
  assert.equal((await cat.findUnsellableCartItems(cart(ctx.P), T))[0].reason, 'discontinued');
  // reactivar noutra ronda volta a vender (histórico/stock intactos: só muda o estado)
  await cat.applyStoreProductRows(T, [{ product_id: ctx.cP, status: 'active', price_override: 7.5, min_stock: 2, updated_at: now() }]);
  assert.deepEqual(await cat.findUnsellableCartItems(cart(ctx.P), T), []);
});

test('listagem: store_status/price_override/min_stock por Store; filtro store_available só devolve vendáveis; mestre inactivo é independente', async () => {
  const all = await listProducts({}, { tenant_id: T });
  const by = (name) => all.find((p) => p.name === name);
  assert.equal(by('P').store_status, 'active');
  assert.equal(by('P').store_price_override, 7.5);
  assert.equal(by('P').store_min_stock, 2);
  assert.equal(by('D').store_available, false);
  assert.equal(by('X').store_available, false);
  assert.equal(by('X').store_status, null);
  assert.equal(by('Local').store_available, true);
  const sellable = await listProducts({ store_available: '1' }, { tenant_id: T });
  assert.deepEqual(sellable.map((p) => p.name).sort(), ['Local', 'P']);
  // produto mestre desactivado globalmente (products.active) continua a ser tratado à parte do estado por Store
  await runDb(`UPDATE products SET active = 0 WHERE id = ?`, [ctx.P]);
  const p = (await listProducts({}, { tenant_id: T })).find((x) => x.name === 'P');
  assert.equal(p.active, false);
  assert.equal(p.store_status, 'active');
  assert.equal(p.store_available, true);
});

test('sales.service aplica a regra antes de baixar stock e o POS pede só o catálogo vendável', async () => {
  const sales = fs.readFileSync(new URL('../../api/services/sales.service.js', import.meta.url), 'utf8');
  assert.match(sales, /findUnsellableCartItems\(payload\.cart, tenantId\)/);
  assert.ok(sales.indexOf('findUnsellableCartItems(payload.cart') < sales.indexOf('buildStockAdjustmentsFromCart(payload.cart'));
  const pos = fs.readFileSync(new URL('../../lib/services/posService.ts', import.meta.url), 'utf8');
  assert.match(pos, /fetchJSON\('\/produtos\?store_available=1'\)/);
});
