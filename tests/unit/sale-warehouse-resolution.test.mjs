/**
 * Etapa 1G.2B.2 - resolução local do armazém da venda (offline-first, sem cloud):
 * Location -> warehouse configurado; senão default da Store; default único; e o
 * payload de sync da venda transporta o armazém usado. BD SQLite real temporária.
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'posly-1g2b2-'));
process.env.POS_DB_PATH = path.join(tmpDir, 'database.db');
process.env.DEFAULT_TENANT_ID = 'tenant-1g2b2';

const db = (await import('../../api/database.js')).default;
const { resolveWarehouseId, ensureDefaultWarehouse } = await import('../../api/services/warehouseStock.service.js');
const { setDefaultWarehouseById } = await import('../../api/services/warehouses.service.js');

const T = 'tenant-1g2b2';
const runDb = (sql, params = []) =>
  new Promise((resolve, reject) => db.run(sql, params, (err) => (err ? reject(err) : resolve())));
const allDb = (sql, params = []) =>
  new Promise((resolve, reject) => db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows))));

async function waitReady() {
  const deadline = Date.now() + 8000;
  for (;;) {
    try {
      await allDb('SELECT 1 FROM warehouses LIMIT 1');
      await allDb('SELECT warehouse_id FROM locations LIMIT 1');
      return;
    } catch (e) {
      if (Date.now() > deadline) throw e;
      await new Promise((r) => setTimeout(r, 100));
    }
  }
}

const now = () => new Date().toISOString();
const addWh = (name) => {
  const id = crypto.randomUUID();
  return runDb(`INSERT INTO warehouses (id, tenant_id, name, code, is_default, is_active, created_at, updated_at) VALUES (?, ?, ?, NULL, 0, 1, ?, ?)`, [id, T, name, now(), now()]).then(() => id);
};
const addLoc = (name, warehouseId) => {
  const id = crypto.randomUUID();
  return runDb(`INSERT INTO locations (id, tenant_id, name, type, active, sort_order, created_at, updated_at, warehouse_id) VALUES (?, ?, ?, 'dining', 1, 0, ?, ?, ?)`, [id, T, name, now(), now(), warehouseId]).then(() => id);
};

test('sem Location -> default; Location Bar -> A2; Restaurante -> A3; Location sem warehouse -> default', async () => {
  await waitReady();
  await ensureDefaultWarehouse(T);
  const [a1] = (await allDb(`SELECT id FROM warehouses WHERE tenant_id = ? AND is_default = 1`, [T])).map((r) => r.id);
  const a2 = await addWh('Bar');
  const a3 = await addWh('Restaurante');
  const bar = await addLoc('Bar', a2);
  const rest = await addLoc('Restaurante', a3);
  const sala = await addLoc('Sala', null);

  assert.equal(await resolveWarehouseId({ tenantId: T }), a1);
  assert.equal(await resolveWarehouseId({ tenantId: T, locationId: bar }), a2);
  assert.equal(await resolveWarehouseId({ tenantId: T, locationId: rest }), a3);
  assert.equal(await resolveWarehouseId({ tenantId: T, locationId: sala }), a1);
});

test('mudar o default A1 -> A3: exactamente 1 default e vendas sem warehouse passam a A3', async () => {
  const wh = await allDb(`SELECT id, name FROM warehouses WHERE tenant_id = ?`, [T]);
  const a3 = wh.find((w) => w.name === 'Restaurante').id;
  await setDefaultWarehouseById(a3, { tenant_id: T });
  const defaults = await allDb(`SELECT id FROM warehouses WHERE tenant_id = ? AND is_default = 1`, [T]);
  assert.deepEqual(defaults.map((d) => d.id), [a3]);
  assert.equal(await resolveWarehouseId({ tenantId: T }), a3);
  // segundo default directo é impossível (índice único parcial)
  const a2 = wh.find((w) => w.name === 'Bar').id;
  await assert.rejects(runDb(`UPDATE warehouses SET is_default = 1 WHERE id = ?`, [a2]));
});

test('warehouse explícito inactivo/inexistente é recusado; Location com warehouse inactivo cai no default', async () => {
  await assert.rejects(resolveWarehouseId({ tenantId: T, explicitWarehouseId: crypto.randomUUID() }));
  const wh = await allDb(`SELECT id, name FROM warehouses WHERE tenant_id = ?`, [T]);
  const a2 = wh.find((w) => w.name === 'Bar').id;
  const a3 = wh.find((w) => w.name === 'Restaurante').id;
  const bar = (await allDb(`SELECT id FROM locations WHERE tenant_id = ? AND name = 'Bar'`, [T]))[0].id;
  await runDb(`UPDATE warehouses SET is_active = 0 WHERE id = ?`, [a2]);
  assert.equal(await resolveWarehouseId({ tenantId: T, locationId: bar }), a3);
});

test('sales.service: o payload de sync da venda inclui warehouse_id e toOrderPayload não confia em store_id', async () => {
  const src = fs.readFileSync(new URL('../../api/services/sales.service.js', import.meta.url), 'utf8');
  assert.match(src, /warehouse_id: saleWarehouseId,\s*\n\s*stockAdjustments/);
  const sync = fs.readFileSync(new URL('../../api/syncService.js', import.meta.url), 'utf8');
  assert.match(sync, /warehouse_id: sale\.warehouse_id && isUuidString/);
  assert.doesNotMatch(sync, /store_id: (sale|payload)\./, 'nenhum store_id do cliente no payload de venda');
  assert.doesNotMatch(sync, /stockDecrementApplied|push-sale-stock-fallback/, 'sem comparação de stock global');
});
