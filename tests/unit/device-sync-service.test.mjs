/**
 * Etapa 1F.2 — syncService.js migrado para Device JWT: pré-voo de device auth
 * (pausa em vez de service_role), users via RPC sync_upsert_user (nunca
 * upsert directo), category/customer DELETE nunca propagado (RLS_DENIED
 * estrutural), products.deleted como boolean real, sales via
 * create_order_with_items. Usa SQLite temporário (POS_DB_PATH) + mock do
 * cliente Supabase por device (node:test mock.module — mesmo padrão de
 * stock-tenant-isolation.test.mjs).
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, before, beforeEach, after, mock } from 'node:test';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'posly-device-sync-'));
const dbPath = path.join(tmpDir, 'pos-test.db');
process.env.POS_DB_PATH = dbPath;
process.env.DEFAULT_TENANT_ID = 'tenant-a';

// --- Fake Supabase por device: query builder + rpc(), com registo de chamadas ---
let fakeTables;
let calls;
let deviceAuthAvailable;

function matchRow(row, filters) {
  return filters.every(([col, val]) => String(row[col]) === String(val));
}

function fakeQueryBuilder(tableName) {
  const filters = [];
  let inFilter = null;
  let single = false;
  let selectCols = null;
  let orderCol = null;
  let insertRows = null;
  let upsertRows = null;
  let deleteMode = false;
  let updateBody = null;

  const api = {
    select(cols) {
      selectCols = cols;
      return api;
    },
    eq(col, val) {
      filters.push([col, val]);
      return api;
    },
    in(col, arr) {
      inFilter = [col, arr];
      return api;
    },
    or() {
      return api;
    },
    // gt/range: o novo código de pull usa isto para paginação/incremental —
    // o fake ignora-os deliberadamente (devolve sempre tudo, sem paginar);
    // os testes usam sempre datasets pequenos e lastSyncAt=epoch.
    gt() {
      return api;
    },
    range() {
      return api;
    },
    order(col) {
      orderCol = col;
      return api;
    },
    ilike(col, val) {
      filters.push([col, val]);
      return api;
    },
    maybeSingle() {
      single = true;
      return api;
    },
    insert(rows) {
      insertRows = Array.isArray(rows) ? rows : [rows];
      calls.push({ table: tableName, op: 'insert', body: insertRows });
      return api;
    },
    upsert(rows) {
      upsertRows = Array.isArray(rows) ? rows : [rows];
      calls.push({ table: tableName, op: 'upsert', body: upsertRows });
      return api;
    },
    update(body) {
      updateBody = body;
      calls.push({ table: tableName, op: 'update', body });
      return api;
    },
    delete() {
      deleteMode = true;
      calls.push({ table: tableName, op: 'delete', filters: [...filters] });
      return api;
    },
    then(resolve, reject) {
      try {
        const table = (fakeTables[tableName] ||= []);
        if (upsertRows) {
          for (const row of upsertRows) {
            const idx = table.findIndex((r) => String(r.id) === String(row.id));
            if (idx >= 0) table[idx] = { ...table[idx], ...row };
            else table.push({ ...row });
          }
          resolve({ data: upsertRows, error: null });
          return;
        }
        if (insertRows) {
          table.push(...insertRows.map((r) => ({ ...r })));
          resolve({ data: insertRows, error: null });
          return;
        }
        if (deleteMode) {
          // Etapa 1F.2: categories/customers/users nunca têm GRANT de DELETE
          // no novo modelo RLS — o fake reflecte isso: qualquer DELETE nestas
          // tabelas devolve 42501, exactamente como o Postgres real faria.
          if (['categories', 'customers', 'users'].includes(tableName)) {
            resolve({ data: null, error: { code: '42501', message: `permission denied for table ${tableName}` } });
            return;
          }
          const remaining = table.filter((r) => !matchRow(r, filters));
          const removed = table.filter((r) => matchRow(r, filters));
          fakeTables[tableName] = remaining;
          resolve({ data: removed, error: null });
          return;
        }
        if (updateBody) {
          let changed = 0;
          for (const row of table) {
            if (matchRow(row, filters)) {
              Object.assign(row, updateBody);
              changed += 1;
            }
          }
          resolve({ data: null, error: null, count: changed });
          return;
        }

        let rows = table.slice();
        for (const [col, val] of filters) rows = rows.filter((r) => String(r[col]) === String(val));
        if (inFilter) {
          const [col, arr] = inFilter;
          const set = new Set(arr.map(String));
          rows = rows.filter((r) => set.has(String(r[col])));
        }
        if (single) {
          resolve({ data: rows[0] ?? null, error: null });
          return;
        }
        resolve({ data: rows, error: null });
      } catch (err) {
        reject(err);
      }
    },
  };
  return api;
}

const fakeDeviceSupabase = {
  from: (table) => fakeQueryBuilder(table),
  rpc: async (name, args) => {
    calls.push({ rpc: name, args });
    if (name === 'sync_upsert_user') {
      if (!args.p_pin_hash || !/^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/.test(args.p_pin_hash)) {
        return { data: null, error: { code: '22023', message: 'pin_hash_must_be_bcrypt' } };
      }
      const table = (fakeTables.users ||= []);
      const idx = table.findIndex((r) => String(r.id) === String(args.p_id));
      const row = { id: args.p_id, name: args.p_name, role: args.p_role, access_level: args.p_access_level, active: args.p_active };
      if (idx >= 0) table[idx] = row;
      else table.push(row);
      return { data: [{ out_id: args.p_id, out_updated_at: new Date().toISOString() }], error: null };
    }
    if (name === 'create_order_with_items') {
      const orders = (fakeTables.orders ||= []);
      const existing = orders.find((o) => String(o.local_sale_id) === String(args.order_data.local_sale_id));
      if (existing) {
        return { data: [{ order_id: existing.id, document_number: existing.document_number, already_exists: true }], error: null };
      }
      const orderId = `order-${orders.length + 1}`;
      orders.push({ id: orderId, local_sale_id: args.order_data.local_sale_id, document_number: `2026/000${orders.length + 1}` });
      return { data: [{ order_id: orderId, document_number: `2026/000${orders.length}`, already_exists: false }], error: null };
    }
    return { data: null, error: { code: 'unknown_rpc', message: `unmocked rpc ${name}` } };
  },
};

mock.module('../../api/deviceAuth/deviceSupabaseClient.js', {
  exports: {
    getDeviceSupabase: () => fakeDeviceSupabase,
    isDeviceAuthAvailable: async () => deviceAuthAvailable,
  },
});

const { run: dbRun, get: dbGet } = await import('../../api/dbUtils.js');
const {
  processPullSyncCycle,
  processSyncQueueCycle,
  processFullSyncCycle,
  isCloudSyncConfigured,
} = await import('../../api/syncService.js');

const REAL_BCRYPT_HASH = '$2b$10$.XXsHStlG.5RpJ3/RhQqCe7MihEQQlS4Wb31Tvtnyu8jyUI5NwoP6';

before(async () => {
  const now = new Date().toISOString();
  await dbRun(
    `INSERT INTO tenants (id, name, created_at) VALUES (?, ?, ?) ON CONFLICT(id) DO NOTHING`,
    ['tenant-a', 'Loja A', now],
  ).catch(() => {});
});

beforeEach(() => {
  fakeTables = {};
  calls = [];
  deviceAuthAvailable = true;
});

after(() => {
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

// ---------------------------------------------------------------------------
// item 32 — prova real: SUPABASE_SERVICE_ROLE_KEY ausente, device auth válido
// -> sync funciona.
// ---------------------------------------------------------------------------

test('isCloudSyncConfigured: true mesmo sem SUPABASE_SERVICE_ROLE_KEY (novo caminho não depende dele)', () => {
  const original = process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  try {
    assert.equal(isCloudSyncConfigured(), true, 'getDeviceSupabase() mockado devolve sempre um cliente — prova que nada aqui lê SERVICE_ROLE_KEY');
  } finally {
    if (original) process.env.SUPABASE_SERVICE_ROLE_KEY = original;
  }
});

// ---------------------------------------------------------------------------
// item 8/22 — pré-voo de device auth: pausa limpa, nunca crash, nunca fallback.
// ---------------------------------------------------------------------------

test('processPullSyncCycle: device auth indisponível -> skipped com razão clara, nenhuma tabela tocada', async () => {
  deviceAuthAvailable = false;
  const summary = await processPullSyncCycle();
  assert.equal(summary.skipped, true);
  assert.equal(summary.reason, 'device_auth_unavailable');
  assert.equal(calls.length, 0, 'nenhuma chamada Supabase deve ter sido feita');
});

test('processSyncQueueCycle: device auth indisponível -> skipped, fila intocada (item 33, prova no-fallback)', async () => {
  deviceAuthAvailable = false;
  const now = new Date().toISOString();
  await dbRun(
    `INSERT INTO sync_queue (tenant_id, type, data, status, retries, created_at, updated_at) VALUES (?, 'product', '{}', 'pending', 0, ?, ?)`,
    ['tenant-a', now, now],
  );
  const summary = await processSyncQueueCycle();
  assert.equal(summary.skipped, true);
  assert.equal(summary.reason, 'device_auth_unavailable');
  const row = await dbGet(`SELECT status, retries FROM sync_queue WHERE tenant_id = 'tenant-a' LIMIT 1`);
  assert.equal(row.status, 'pending', 'item nunca deve ser tocado — nem marcado failed nem consumir retry');
  assert.equal(row.retries, 0);
});

// ---------------------------------------------------------------------------
// item 5 — tenant_profile removido do novo caminho.
// ---------------------------------------------------------------------------

test('processPullSyncCycle: nunca chama a tabela tenant_profile (removida do novo caminho)', async () => {
  await processPullSyncCycle();
  const touchedTenantProfile = calls.some((c) => c.table === 'tenant_profile');
  assert.equal(touchedTenantProfile, false);
});

// ---------------------------------------------------------------------------
// item 17 — products.deleted como boolean real (nunca 0/1 cru) no pull.
// ---------------------------------------------------------------------------

test('processPullSyncCycle: products — deleted boolean da cloud grava correctamente como 0/1 local', async () => {
  const now = new Date().toISOString();
  fakeTables.products = [
    { id: 'cloud-p1', tenant_id: 'tenant-a', name: 'Produto Apagado', deleted: true, active: false, updated_at: now, created_at: now },
    { id: 'cloud-p2', tenant_id: 'tenant-a', name: 'Produto Normal', deleted: false, active: true, updated_at: now, created_at: now },
  ];
  await processPullSyncCycle();
  const p1 = await dbGet(`SELECT deleted FROM products WHERE cloud_id = 'cloud-p1'`);
  const p2 = await dbGet(`SELECT deleted FROM products WHERE cloud_id = 'cloud-p2'`);
  assert.equal(p1.deleted, 1);
  assert.equal(p2.deleted, 0);
});

// ---------------------------------------------------------------------------
// item 12 — pull de users: pin_hash bcrypt-only, nunca plaintext.
// ---------------------------------------------------------------------------

test('processPullSyncCycle: users — pin_hash bcrypt válido é aceite e gravado localmente', async () => {
  const now = new Date().toISOString();
  fakeTables.users = [
    { id: 'cloud-u1', tenant_id: 'tenant-a', name: 'Operador Cloud', role: 'cashier', access_level: 1, pin_hash: REAL_BCRYPT_HASH, active: true, created_at: now, updated_at: now },
  ];
  await processPullSyncCycle();
  const local = await dbGet(`SELECT pin FROM users WHERE cloud_id = 'cloud-u1'`);
  assert.equal(local.pin, REAL_BCRYPT_HASH);
});

test('processPullSyncCycle: users — pin_hash que NÃO é bcrypt é rejeitado, nunca gravado localmente', async () => {
  const now = new Date().toISOString();
  fakeTables.users = [
    { id: 'cloud-u2', tenant_id: 'tenant-a', name: 'Operador Suspeito', role: 'cashier', access_level: 1, pin_hash: '1234', active: true, created_at: now, updated_at: now },
  ];
  const summary = await processPullSyncCycle();
  assert.ok(summary.conflicts >= 1, 'deve ser contado como conflito');
  const local = await dbGet(`SELECT id FROM users WHERE cloud_id = 'cloud-u2'`);
  assert.equal(local ?? null, null, 'nunca deve inserir um utilizador com pin_hash inválido');
});

// ---------------------------------------------------------------------------
// item 18 — push de users: sync_upsert_user RPC, nunca upsert directo; DELETE
// nunca tentado.
// ---------------------------------------------------------------------------

test('processFullSyncCycle: push de users usa a RPC sync_upsert_user, NUNCA .from(\'users\').upsert()', async () => {
  // syncUsersToCloud corre dentro de processFullSyncCycle (varre a tabela
  // `users` directamente), não dentro da fila sync_queue — ao contrário de
  // product/category/customer/sale.
  const now = new Date().toISOString();
  const cloudId = crypto.randomUUID();
  await dbRun(
    `INSERT INTO users (id, name, role, pin, access_level, active, tenant_id, cloud_id, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)`,
    ['cashier-1', 'Caixa Um', 'cashier', REAL_BCRYPT_HASH, 1, 'tenant-a', cloudId, now],
  );
  // Semear a cloud com o MESMO cloud_id (utilizador já sincronizado antes) —
  // senão a reconciliação de deleções do PULL (não tocada nesta etapa, já
  // existia antes de 1F.2) apagaria o utilizador local antes do push correr,
  // por o considerar "já não existe na cloud".
  fakeTables.users = [{ id: cloudId, tenant_id: 'tenant-a', name: 'Caixa Um', role: 'cashier', access_level: 1, pin_hash: REAL_BCRYPT_HASH, active: true, created_at: now, updated_at: now }];
  await processFullSyncCycle();

  // Filtra pelo cloudId deste teste especificamente — a instalação pode ter
  // outros utilizadores locais (ex.: admin seedado pelo schema bootstrap) que
  // também são empurrados no mesmo ciclo; não assumir que é a única chamada.
  const rpcCall = calls.find((c) => c.rpc === 'sync_upsert_user' && c.args.p_id === cloudId);
  assert.ok(rpcCall, 'sync_upsert_user deve ter sido chamada para este utilizador');
  assert.equal(rpcCall.args.p_pin_hash, REAL_BCRYPT_HASH);

  const directUpsert = calls.find((c) => c.table === 'users' && c.op === 'upsert');
  assert.equal(directUpsert, undefined, 'nunca deve fazer upsert directo em users');
});

// ---------------------------------------------------------------------------
// items 15/16 — category/customer DELETE nunca propagado; item continua
// success (não fica preso em retry) porque o novo código nem tenta o DELETE.
// ---------------------------------------------------------------------------

test('processSyncQueueCycle: push de category apagada localmente NUNCA chama categories.delete() na cloud', async () => {
  const now = new Date().toISOString();
  const catCloudId = crypto.randomUUID();
  await dbRun(
    `INSERT INTO sync_queue (tenant_id, type, data, status, retries, created_at, updated_at) VALUES (?, 'category', ?, 'pending', 0, ?, ?)`,
    ['tenant-a', JSON.stringify({ tenant_id: 'tenant-a', cloud_id: catCloudId, name: 'Bebidas', deleted: true }), now, now],
  );
  const summary = await processSyncQueueCycle();
  const deleteCall = calls.find((c) => c.table === 'categories' && c.op === 'delete');
  assert.equal(deleteCall, undefined, 'nunca deve tentar DELETE em categories');
  assert.equal(summary.failed, 0, 'não deve contar como falha — é um no-op documentado');
  const row = await dbGet(`SELECT status FROM sync_queue WHERE tenant_id = 'tenant-a' AND type = 'category'`);
  assert.equal(row.status, 'synced', 'item não deve ficar preso em retry indefinido');
});

test('processSyncQueueCycle: push de customer apagado localmente NUNCA chama customers.delete() na cloud', async () => {
  const now = new Date().toISOString();
  const custCloudId = crypto.randomUUID();
  await dbRun(
    `INSERT INTO sync_queue (tenant_id, type, data, status, retries, created_at, updated_at) VALUES (?, 'customer', ?, 'pending', 0, ?, ?)`,
    ['tenant-a', JSON.stringify({ tenant_id: 'tenant-a', id: 1, cloud_id: custCloudId, name: 'Cliente X', phone: '84', deleted: true }), now, now],
  );
  const summary = await processSyncQueueCycle();
  const deleteCall = calls.find((c) => c.table === 'customers' && c.op === 'delete');
  assert.equal(deleteCall, undefined, 'nunca deve tentar DELETE em customers');
  assert.equal(summary.failed, 0);
  const row = await dbGet(`SELECT status FROM sync_queue WHERE tenant_id = 'tenant-a' AND type = 'customer'`);
  assert.equal(row.status, 'synced');
});

// ---------------------------------------------------------------------------
// item 19 — push de vendas via create_order_with_items com Device JWT.
// ---------------------------------------------------------------------------

test('processSyncQueueCycle: push de venda chama a RPC create_order_with_items (Device JWT)', async () => {
  const now = new Date().toISOString();
  const productCloudId = crypto.randomUUID();
  fakeTables.products = [{ id: productCloudId, tenant_id: 'tenant-a', name: 'Produto Venda', deleted: false }];
  await dbRun(
    `INSERT INTO sync_queue (tenant_id, type, data, status, retries, created_at, updated_at) VALUES (?, 'sale', ?, 'pending', 0, ?, ?)`,
    [
      'tenant-a',
      JSON.stringify({
        tenant_id: 'tenant-a',
        local_sale_id: 'local-sale-1',
        total: 100,
        cart: [{ id: 1, cloud_id: productCloudId, name: 'Produto Venda', quantity: 1, price: 100 }],
        saleTimestamp: now,
      }),
      now,
      now,
    ],
  );
  await processSyncQueueCycle();
  const rpcCall = calls.find((c) => c.rpc === 'create_order_with_items');
  assert.ok(rpcCall, 'create_order_with_items deve ter sido chamada');
  assert.equal(rpcCall.args.order_data.local_sale_id, 'local-sale-1');
});
