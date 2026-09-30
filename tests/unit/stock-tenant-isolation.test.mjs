/**
 * GET /stock, /stock/validate, /stock/:productId/current têm de exigir
 * autenticação e nunca devolver dados de outro tenant.
 * Usa SQLite temporário (POS_DB_PATH) + mock do cliente Supabase (node:test mock.module).
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, before, after, mock } from 'node:test';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'posly-stock-isolation-'));
const dbPath = path.join(tmpDir, 'pos-test.db');
process.env.POS_DB_PATH = dbPath;

// --- Fake Supabase: só o subconjunto do query builder usado em stockController.js ---
const FAKE_TABLES = {
  products: [
    { id: 'pA1', tenant_id: 'tenant-a', stock_quantity: 10 },
    { id: 'pA2', tenant_id: 'tenant-a', stock_quantity: -3 },
    { id: 'pB1', tenant_id: 'tenant-b', stock_quantity: 999 },
  ],
  product_stock_ledger: [
    { product_id: 'pA1', stock: 10 },
    { product_id: 'pA2', stock: -5 }, // discrepância proposital (tenant A)
    { product_id: 'pB1', stock: 1 }, // discrepância proposital (tenant B) — não deve aparecer para A
  ],
};

// Etapa 1F.3: liga isto para simular o 42501 REAL que product_stock_ledger/
// recalculate_stock_cache devolvem sob Device JWT (REVOKE ALL ... FROM
// authenticated desde a Etapa 1E.3 — nunca concedido a devices).
let simulateRlsDenied = false;

function fakeQueryBuilder(tableName) {
  const filters = [];
  let inFilter = null;
  let countMode = null;
  let headOnly = false;
  let rangeVal = null;
  let single = false;

  const api = {
    select(_cols, opts) {
      if (opts?.count) countMode = opts.count;
      if (opts?.head) headOnly = true;
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
    order() {
      return api;
    },
    range(from, to) {
      rangeVal = [from, to];
      return api;
    },
    maybeSingle() {
      single = true;
      return api;
    },
    then(resolve, reject) {
      try {
        if (simulateRlsDenied && tableName === 'product_stock_ledger') {
          resolve({ data: null, error: { code: '42501', message: 'permission denied for view product_stock_ledger' } });
          return;
        }
        let rows = (FAKE_TABLES[tableName] || []).slice();
        for (const [col, val] of filters) rows = rows.filter((r) => String(r[col]) === String(val));
        if (inFilter) {
          const [col, arr] = inFilter;
          const set = new Set(arr.map(String));
          rows = rows.filter((r) => set.has(String(r[col])));
        }
        if (countMode) {
          resolve({ data: headOnly ? null : rows, count: rows.length, error: null });
          return;
        }
        if (rangeVal) rows = rows.slice(rangeVal[0], rangeVal[1] + 1);
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

const fakeSupabase = {
  from: (table) => fakeQueryBuilder(table),
  rpc: async (name) => {
    if (simulateRlsDenied && name === 'recalculate_stock_cache') {
      return { data: null, error: { code: '42501', message: `permission denied for function ${name}` } };
    }
    return { data: [{ total_products_checked: 0, mismatches_fixed: 0 }], error: null };
  },
};

// Etapa 1F.3: stockController.js foi migrado do cliente privilegiado
// (api/supabaseClient.js) para o cliente Device JWT
// (api/deviceAuth/deviceSupabaseClient.js) — mock actualizado para a
// dependência real.
mock.module('../../api/deviceAuth/deviceSupabaseClient.js', {
  exports: { getDeviceSupabase: () => fakeSupabase },
});

const { run: dbRun } = await import('../../api/dbUtils.js');
const stockRouter = (await import('../../api/stockController.js')).default;

before(async () => {
  const now = new Date().toISOString();
  await dbRun(
    `INSERT INTO users (id, name, role, pin, access_level, active, tenant_id, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
    ['user-a', 'Operador A', 'user', 'x', 1, 'tenant-a', now],
  );
  await dbRun(
    `INSERT INTO users (id, name, role, pin, access_level, active, tenant_id, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
    ['user-b', 'Operador B', 'user', 'x', 1, 'tenant-b', now],
  );
  await dbRun(
    `INSERT INTO users (id, name, role, pin, access_level, active, tenant_id, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
    ['admin-a', 'Admin A', 'admin', 'x', 9, 'tenant-a', now],
  );
});

after(() => {
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

// --- Harness mínimo: dispara os middlewares de uma rota do router sem servidor HTTP real ---
function findRoute(router, method, routePath) {
  const layer = router.stack.find(
    (l) => l.route && l.route.path === routePath && l.route.methods[method.toLowerCase()],
  );
  if (!layer) throw new Error(`Rota nao encontrada: ${method} ${routePath}`);
  return layer.route.stack.map((l) => l.handle);
}

function makeRes() {
  const res = {
    statusCode: 200,
    body: null,
    status(code) {
      res.statusCode = code;
      return res;
    },
    json(payload) {
      res.body = payload;
      return res;
    },
  };
  return res;
}

async function invoke(router, method, routePath, req) {
  const handlers = findRoute(router, method, routePath);
  const res = makeRes();
  for (const handler of handlers) {
    let calledNext = false;
    let nextErr;
    await new Promise((resolve) => {
      const next = (err) => {
        calledNext = true;
        nextErr = err;
        resolve();
      };
      const maybePromise = handler(req, res, next);
      if (maybePromise && typeof maybePromise.then === 'function') {
        maybePromise.then(() => resolve(), (err) => { nextErr = err; resolve(); });
      } else if (res.body !== null || res.statusCode !== 200) {
        // handler síncrono já respondeu sem chamar next
        resolve();
      }
    });
    if (nextErr) throw nextErr;
    if (!calledNext && res.body !== null) break; // resposta já enviada
  }
  return res;
}

test('GET /stock sem autenticação → 401', async () => {
  const req = { headers: {}, query: {}, params: {} };
  const res = await invoke(stockRouter, 'GET', '/', req);
  assert.equal(res.statusCode, 401);
});

test('GET /stock com utilizador Tenant A → só devolve produtos do Tenant A', async () => {
  const req = { headers: { 'x-user-id': 'user-a' }, query: {}, params: {} };
  const res = await invoke(stockRouter, 'GET', '/', req);
  assert.equal(res.statusCode, 200);
  const ids = res.body.items.map((i) => i.product_id);
  assert.deepEqual(ids.sort(), ['pA1', 'pA2']);
  assert.ok(!ids.includes('pB1'), 'não deve conter produto do tenant B');
});

test('Tenant A não consegue pedir dados do Tenant B via query/header', async () => {
  // Mesmo tentando "forçar" um tenant diferente via query, o tenant vem só do utilizador autenticado.
  const req = {
    headers: { 'x-user-id': 'user-a', 'x-tenant-id': 'tenant-b' },
    query: { tenant_id: 'tenant-b' },
    params: {},
  };
  const res = await invoke(stockRouter, 'GET', '/', req);
  assert.equal(res.statusCode, 200);
  const ids = res.body.items.map((i) => i.product_id);
  assert.ok(!ids.includes('pB1'), 'query/header não pode substituir o tenant autenticado');
});

test('GET /stock/validate respeita o mesmo isolamento de tenant', async () => {
  const reqA = { headers: { 'x-user-id': 'user-a' }, query: {}, params: {} };
  const resA = await invoke(stockRouter, 'GET', '/validate', reqA);
  assert.equal(resA.statusCode, 200);
  assert.equal(resA.body.total_products_checked, 2); // só os 2 produtos do tenant A
  const idsA = resA.body.mismatches.map((m) => m.product_id);
  assert.ok(!idsA.includes('pB1'));

  const reqB = { headers: { 'x-user-id': 'user-b' }, query: {}, params: {} };
  const resB = await invoke(stockRouter, 'GET', '/validate', reqB);
  assert.equal(resB.statusCode, 200);
  assert.equal(resB.body.total_products_checked, 1); // só o produto do tenant B
});

test('GET /stock sem autenticação em /validate também é rejeitado', async () => {
  const req = { headers: {}, query: {}, params: {} };
  const res = await invoke(stockRouter, 'GET', '/validate', req);
  assert.equal(res.statusCode, 401);
});

test('admin continua a conseguir usar /stock normalmente (sem regressão)', async () => {
  const req = { headers: { 'x-user-id': 'admin-a' }, query: {}, params: {} };
  const res = await invoke(stockRouter, 'GET', '/', req);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.items.length, 2);
});

// ---------------------------------------------------------------------------
// Etapa 1F.3: product_stock_ledger/recalculate_stock_cache são RLS-negados a
// `authenticated` desde 1E.3 — sob Device JWT isto é ESPERADO (não uma falha
// de configuração). O controller tem de traduzir 42501 num 503 claro, nunca
// num 500 com detalhe interno do Postgres.
// ---------------------------------------------------------------------------

test('GET /stock: 42501 do ledger (RLS Device JWT) -> 503 claro, nunca 500', async () => {
  simulateRlsDenied = true;
  try {
    const req = { headers: { 'x-user-id': 'user-a' }, query: {}, params: {} };
    const res = await invoke(stockRouter, 'GET', '/', req);
    assert.equal(res.statusCode, 503);
    assert.ok(!/postgres|pg_|internal/i.test(JSON.stringify(res.body)), 'nunca deve vazar detalhe interno do Postgres');
  } finally {
    simulateRlsDenied = false;
  }
});

test('GET /stock/validate: 42501 do ledger -> 503 claro', async () => {
  simulateRlsDenied = true;
  try {
    const req = { headers: { 'x-user-id': 'user-a' }, query: {}, params: {} };
    const res = await invoke(stockRouter, 'GET', '/validate', req);
    assert.equal(res.statusCode, 503);
  } finally {
    simulateRlsDenied = false;
  }
});

test('POST /stock/recalculate: 42501 da RPC (Device JWT) -> 503 claro', async () => {
  simulateRlsDenied = true;
  try {
    const req = { headers: { 'x-user-id': 'admin-a' }, query: {}, params: {}, body: {} };
    const res = await invoke(stockRouter, 'POST', '/recalculate', req);
    assert.equal(res.statusCode, 503);
  } finally {
    simulateRlsDenied = false;
  }
});
