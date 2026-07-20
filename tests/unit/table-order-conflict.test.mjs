/**
 * Contrato TABLE_ORDER_CONFLICT — saveSharedTableOrder com expectedUpdatedAt.
 * Usa SQLite temporário (POS_DB_PATH) isolado da base de desenvolvimento.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, before, after } from 'node:test';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'posly-table-orders-'));
const dbPath = path.join(tmpDir, 'pos-test.db');
process.env.POS_DB_PATH = dbPath;
process.env.DEFAULT_TENANT_ID = 'tenant-test-unit';

const { saveSharedTableOrder } = await import('../../api/services/pos-table-orders.service.js');
const { HttpError } = await import('../../api/utils/response.js');

const actor = { id: 'u1', name: 'Teste', tenant_id: 'tenant-test-unit' };
const tableKey = 'mesa-1';

before(async () => {
  // Garante schema de tenants (via getOrCreateDefaultTenantId no serviço)
  await saveSharedTableOrder(
    tableKey,
    {
      cart: [{ id: 'p1', name: 'Água', price: 10, quantity: 1, category: 'Geral' }],
      docType: 'VD',
    },
    actor,
  );
});

after(() => {
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

test('expectedUpdatedAt correcto → upsert OK com novo updatedAt', async () => {
  const first = await saveSharedTableOrder(
    tableKey,
    {
      cart: [{ id: 'p1', name: 'Água', price: 10, quantity: 2, category: 'Geral' }],
      docType: 'VD',
    },
    actor,
  );
  assert.ok(first.updatedAt);
  const second = await saveSharedTableOrder(
    tableKey,
    {
      cart: [{ id: 'p1', name: 'Água', price: 10, quantity: 3, category: 'Geral' }],
      docType: 'VD',
      expectedUpdatedAt: first.updatedAt,
    },
    actor,
  );
  assert.ok(second.updatedAt);
  assert.notEqual(second.updatedAt, first.updatedAt);
  assert.equal(second.order?.cart?.[0]?.quantity, 3);
});

test('expectedUpdatedAt stale → 409 TABLE_ORDER_CONFLICT com data.order', async () => {
  const current = await saveSharedTableOrder(
    tableKey,
    {
      cart: [{ id: 'p1', name: 'Água', price: 10, quantity: 5, category: 'Geral' }],
      docType: 'VD',
    },
    actor,
  );

  await assert.rejects(
    () =>
      saveSharedTableOrder(
        tableKey,
        {
          cart: [{ id: 'p1', name: 'Água', price: 10, quantity: 99, category: 'Geral' }],
          docType: 'VD',
          expectedUpdatedAt: '2000-01-01T00:00:00.000Z',
        },
        actor,
      ),
    (err) => {
      assert.ok(err instanceof HttpError);
      assert.equal(err.status, 409);
      assert.equal(err.code, 'TABLE_ORDER_CONFLICT');
      assert.equal(err.data?.order?.cart?.[0]?.quantity, 5);
      assert.equal(err.data?.order?.updatedAt, current.updatedAt);
      return true;
    },
  );
});

test('sem expectedUpdatedAt → overwrite permitido (last-write-wins)', async () => {
  const before = await saveSharedTableOrder(
    tableKey,
    {
      cart: [{ id: 'p1', name: 'Água', price: 10, quantity: 1, category: 'Geral' }],
      docType: 'VD',
    },
    actor,
  );
  const afterOverwrite = await saveSharedTableOrder(
    tableKey,
    {
      cart: [{ id: 'p2', name: 'Sumo', price: 20, quantity: 1, category: 'Geral' }],
      docType: 'VD',
      // sem expectedUpdatedAt
    },
    actor,
  );
  assert.ok(afterOverwrite.updatedAt);
  assert.notEqual(afterOverwrite.updatedAt, before.updatedAt);
  assert.equal(afterOverwrite.order?.cart?.[0]?.id, 'p2');
});

test('carrinho vazio → clear sem conflito quando expected coincide', async () => {
  const seeded = await saveSharedTableOrder(
    tableKey,
    {
      cart: [{ id: 'p1', name: 'Água', price: 10, quantity: 1, category: 'Geral' }],
      docType: 'VD',
    },
    actor,
  );
  const cleared = await saveSharedTableOrder(
    tableKey,
    {
      cart: [],
      docType: 'VD',
      expectedUpdatedAt: seeded.updatedAt,
    },
    actor,
  );
  assert.equal(cleared.cleared, true);
  assert.equal(cleared.order, null);
});
