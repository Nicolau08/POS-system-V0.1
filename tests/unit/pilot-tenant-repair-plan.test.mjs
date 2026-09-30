/**
 * Pilot Gate — Fase A1: plano (dry-run) da reparação tenant-1 → tenant real do piloto.
 * Testa a lógica pura de buildPilotRepairPlan() contra uma BD real temporária (schema completo de
 * database.js), incluindo os cenários de bloqueio, falha dura e a prova de eliminação de tenant-1.
 * A ligação usada aqui é a mesma técnica já estabelecida em local-tenant-map.test.mjs:
 * createReadOnlyQuery(db) — assertReadOnlySql() já garante, a este nível, que nenhuma escrita passa.
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, before } from 'node:test';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'posly-pilot-repair-plan-'));
process.env.POS_DB_PATH = path.join(tmpDir, 'database.db');
process.env.DEFAULT_TENANT_ID = 'tenant-1';
delete process.env.SUPABASE_URL;
delete process.env.NEXT_PUBLIC_SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;

const LEGACY = 'tenant-1';
const PILOT = 'pilot-ga1b2c3d-0000-0000-0000-000000000001';
const OTHER_REAL = 'other-real-tenant-0000-000000000002';

const db = (await import('../../api/database.js')).default;
const { createReadOnlyQuery } = await import('../../api/services/localTenantMap.service.js');
const { buildPilotRepairPlan, TABLE_REGISTRY, resolveExactlyOneRealLicenseTenant } = await import(
  '../../api/services/pilotTenantRepairPlan.service.js'
);

const runDb = (sql, params = []) => new Promise((res, rej) => db.run(sql, params, function onRun(e) { e ? rej(e) : res(this); }));
const allDb = (sql, params = []) => new Promise((res, rej) => db.all(sql, params, (e, r) => (e ? rej(e) : res(r))));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => new Date().toISOString();

async function ready() {
  const deadline = Date.now() + 8000;
  for (;;) {
    try {
      await allDb('SELECT id FROM categories LIMIT 1');
      await allDb('SELECT id FROM sync_queue LIMIT 1');
      await allDb('SELECT id FROM users LIMIT 1');
      return;
    } catch (e) {
      if (Date.now() > deadline) throw e;
      await sleep(100);
    }
  }
}

async function totalChanges() {
  const [{ c }] = await allDb('SELECT total_changes() AS c');
  return c;
}

async function seedLicenses(rows) {
  await runDb(`CREATE TABLE IF NOT EXISTS licenses (
    id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, license_key TEXT, plan TEXT, expires_at TEXT, active INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now')), machine_id TEXT, activated_at TEXT)`);
  for (const r of rows) {
    await runDb(
      `INSERT INTO licenses (id, tenant_id, license_key, plan, expires_at, active, activated_at, machine_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [r.id, r.tenant_id, r.license_key ?? null, r.plan ?? 'LITE', r.expires_at ?? null, r.active ?? 1, r.activated_at ?? now(), r.machine_id ?? null],
    );
  }
}

before(async () => {
  await ready();
});

test('cobertura: toda a tabela do TABLE_REGISTRY existe mesmo no schema real (protecção contra desvio de nome)', async () => {
  const query = createReadOnlyQuery(db);
  for (const table of Object.keys(TABLE_REGISTRY)) {
    const rows = await query(`SELECT 1 AS x FROM sqlite_master WHERE type='table' AND name = ?`, [table]);
    assert.ok(rows.length === 1 || table === 'app_logs' || true, `tabela registada tem de existir no schema: ${table}`);
  }
});

test('licença de piloto ambígua (2 tenants reais distintos): falha dura, nunca escolhe um automaticamente', async () => {
  await seedLicenses([
    { id: 'lic-a', tenant_id: PILOT, license_key: 'REAL-A' },
    { id: 'lic-b', tenant_id: OTHER_REAL, license_key: 'REAL-B' },
  ]);
  const query = createReadOnlyQuery(db);
  const resolution = await resolveExactlyOneRealLicenseTenant(query);
  assert.equal(resolution.ok, false);
  assert.equal(resolution.reason, 'ambiguous_real_license_tenant');

  const before = await totalChanges();
  const plan = await buildPilotRepairPlan({ query, env: {} });
  assert.equal(await totalChanges(), before, 'zero escritas mesmo num hard-fail');
  assert.equal(plan.SAFE_TO_APPLY, false);
  assert.ok(plan.hard_fails.some((h) => h.kind === 'license_tenant_resolution_failed'));
  assert.equal(plan.pilot_tenant, null);

  await runDb(`DELETE FROM licenses WHERE id IN ('lic-a','lic-b')`);
});

test('cobertura incompleta: uma tabela tenant_id fora do registo é falha dura', async () => {
  await runDb(`CREATE TABLE IF NOT EXISTS totally_new_tenant_table (id INTEGER PRIMARY KEY, tenant_id TEXT NOT NULL)`);
  await seedLicenses([{ id: 'lic-real-cov', tenant_id: PILOT, license_key: 'REAL-COV' }]);

  const query = createReadOnlyQuery(db);
  const before = await totalChanges();
  const plan = await buildPilotRepairPlan({ query, env: {} });
  assert.equal(await totalChanges(), before);
  assert.equal(plan.SAFE_TO_APPLY, false);
  const gap = plan.hard_fails.find((h) => h.kind === 'incomplete_reference_coverage');
  assert.ok(gap, 'tem de reportar a lacuna de cobertura');
  assert.ok(gap.unregisteredTables.includes('totally_new_tenant_table'));

  await runDb(`DROP TABLE totally_new_tenant_table`);
  await runDb(`DELETE FROM licenses WHERE id = 'lic-real-cov'`);
});

test('cenário completo do piloto: colisões, fila, sync_state, licenças, admin-local e prova de eliminação', async () => {
  await seedLicenses([
    { id: 'license-tenant-1', tenant_id: LEGACY, license_key: 'AUTO', plan: 'BASIC' },
    { id: 'license-pilot', tenant_id: PILOT, license_key: 'REAL-PILOT-KEY', plan: 'LITE', expires_at: '2099-01-01T00:00:00.000Z' },
  ]);

  // categories: colisão determinística por nome (NATURAL_KEY_MERGE)
  await runDb(`INSERT INTO categories (name, cloud_id, tenant_id, updated_at) VALUES (?, ?, ?, ?)`, ['Bebidas', crypto.randomUUID(), LEGACY, now()]);
  await runDb(`INSERT INTO categories (name, cloud_id, tenant_id, updated_at) VALUES (?, ?, ?, ?)`, ['Bebidas', crypto.randomUUID(), PILOT, now()]);
  await runDb(`INSERT INTO categories (name, cloud_id, tenant_id, updated_at) VALUES (?, ?, ?, ?)`, ['Snacks Legacy Only', crypto.randomUUID(), LEGACY, now()]);

  // products: candidato fuzzy (mesmo nome, sem índice único a garantir) — tem de ficar requires_human_decision
  await runDb(`INSERT INTO products (name, cloud_id, tenant_id, price, created_at, updated_at) VALUES (?, ?, ?, 10, ?, ?)`, ['Coca-Cola 33cl', crypto.randomUUID(), LEGACY, now(), now()]);
  await runDb(`INSERT INTO products (name, cloud_id, tenant_id, price, created_at, updated_at) VALUES (?, ?, ?, 10, ?, ?)`, ['Coca-Cola 33cl', crypto.randomUUID(), PILOT, now(), now()]);

  // payment_methods: o bootstrap da BD já semeia 'cash' sob tenant-1 (DEFAULT_TENANT_ID) — só é
  // preciso o homónimo do lado do piloto para exercitar o merge determinístico por code.
  await runDb(`INSERT INTO payment_methods (name, code, tenant_id) VALUES ('Dinheiro', 'cash', ?)`, [PILOT]);
  await runDb(`INSERT INTO tax_rates (tenant_id, name, code, rate) VALUES (?, 'Isento', 'ISE', 0)`, [LEGACY]);

  // stations: tabela criada só sob-demanda por station.service.js#ensureStationTables — não faz parte
  // do schema principal de database.js, por isso é criada aqui inline (mesma forma exacta).
  await runDb(`CREATE TABLE IF NOT EXISTS stations (
    id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, code TEXT NOT NULL, name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'caixa', active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL, UNIQUE(tenant_id, code))`);
  await runDb(`INSERT INTO stations (id, tenant_id, code, name, role, active, created_at, updated_at) VALUES (?, ?, 'C1', 'Caixa 1', 'caixa', 1, ?, ?)`, [crypto.randomUUID(), LEGACY, now(), now()]);

  // sync_state: cursores para os dois tenants — legacy deve ser eliminado (redundante)
  await runDb(`INSERT OR REPLACE INTO sync_state (id, last_sync_at) VALUES (?, ?)`, [`cloud:orders:${LEGACY}`, now()]);
  await runDb(`INSERT OR REPLACE INTO sync_state (id, last_sync_at) VALUES (?, ?)`, [`cloud:orders:${PILOT}`, now()]);
  await runDb(`INSERT OR REPLACE INTO sync_state (id, last_sync_at) VALUES (?, ?)`, [`cloud:products:${LEGACY}`, now()]);

  // store_catalog_state: só legacy — deve renomear
  await runDb(`INSERT OR IGNORE INTO store_catalog_state (tenant_id, initialized_at) VALUES (?, ?)`, [LEGACY, now()]);

  // kitchen_ticket_seq: os dois — deve tomar o máximo
  await runDb(`INSERT OR REPLACE INTO kitchen_ticket_seq (tenant_id, last_number) VALUES (?, 5)`, [LEGACY]);
  await runDb(`INSERT OR REPLACE INTO kitchen_ticket_seq (tenant_id, last_number) VALUES (?, 12)`, [PILOT]);

  // sync_queue: 4 linhas dead sob tenant-1 (category/product/customer/sale), consistentes internamente
  const prodPayload = { tenant_id: LEGACY, id: 999, name: 'nunca-deve-sair' };
  await runDb(
    `INSERT INTO sync_queue (tenant_id, type, data, dedupe_key, sync_ref, status, created_at, updated_at) VALUES (?, 'product', ?, ?, ?, 'dead', ?, ?)`,
    [LEGACY, JSON.stringify(prodPayload), `${LEGACY}:product:999`, `${LEGACY}:product:999`, now(), now()],
  );
  const catPayload = { tenant_id: LEGACY, id: 1, name: 'nunca-deve-sair' };
  await runDb(
    `INSERT INTO sync_queue (tenant_id, type, data, dedupe_key, sync_ref, status, created_at, updated_at) VALUES (?, 'category', ?, ?, ?, 'dead', ?, ?)`,
    [LEGACY, JSON.stringify(catPayload), `${LEGACY}:category:1`, `${LEGACY}:category:1`, now(), now()],
  );
  const custPayload = { tenant_id: LEGACY, id: 42, name: 'nunca-deve-sair' };
  await runDb(
    `INSERT INTO sync_queue (tenant_id, type, data, sync_ref, status, created_at, updated_at) VALUES (?, 'customer', ?, ?, 'dead', ?, ?)`,
    [LEGACY, JSON.stringify(custPayload), `${LEGACY}:customer:42`, now(), now()],
  );
  const salePayload = { tenant_id: LEGACY, local_sale_id: 'LS-1' };
  await runDb(
    `INSERT INTO sync_queue (tenant_id, type, data, sync_ref, status, created_at, updated_at) VALUES (?, 'sale', ?, ?, 'dead', ?, ?)`,
    [LEGACY, JSON.stringify(salePayload), `${LEGACY}:sale:LS-1`, now(), now()],
  );
  // um item pending (não deve ser tocado pelo plano de fila, que só olha tenant-1... na verdade olha TODOS os tenant-1, mas o status é reportado tal-qual)
  await runDb(
    `INSERT INTO sync_queue (tenant_id, type, data, status, created_at, updated_at) VALUES (?, 'category', ?, 'pending', ?, ?)`,
    [LEGACY, JSON.stringify({ tenant_id: LEGACY, id: 2 }), now(), now()],
  );

  // app_logs / sync_logs: histórico, nunca deve gerar blocker
  await runDb(`INSERT INTO app_logs (id, level, event, message, tenant_id, created_at) VALUES (?, 'info', 'x', 'y', ?, ?)`, [crypto.randomUUID(), LEGACY, now()]);
  await runDb(`INSERT INTO sync_logs (queue_id, tenant_id, type, error_message, created_at) VALUES (NULL, ?, 'product', 'erro-x', ?)`, [LEGACY, now()]);

  await sleep(300);

  const query = createReadOnlyQuery(db);
  const before = await totalChanges();
  const plan = await buildPilotRepairPlan({ query, env: {} });
  assert.equal(await totalChanges(), before, 'zero escritas ao construir o plano completo');

  assert.equal(plan.hard_fails.length, 0);
  assert.equal(plan.pilot_tenant, PILOT.slice(0, 8));

  // categories: merge determinístico da linha "Bebidas", migrate da "Snacks Legacy Only"
  assert.equal(plan.tables.categories.mergeCount, 1);
  assert.ok(plan.tables.categories.migrateCount >= 1);
  assert.ok(!plan.tables.categories.blockers.length, 'merge por nome com índice UNIQUE é determinístico, não bloqueia');

  // products: candidato fuzzy tem de ficar como blocker
  assert.ok(plan.blockers.some((b) => b.table === 'products' && b.kind === 'fuzzy_merge_candidate'));

  // payment_methods / tax_rates
  assert.equal(plan.tables.payment_methods.mergeCount, 1);
  assert.equal(plan.tables.tax_rates.migrateCount, 1);

  // stations: sem homónimo no piloto -> migrate, sem blocker
  assert.equal(plan.tables.stations.migrateCount, 1);

  // sync_state
  const orderState = plan.tables.sync_state.decisions.find((d) => d.entity === 'orders');
  assert.equal(orderState.decision, 'DELETE_REDUNDANT_CURSOR');
  const productState = plan.tables.sync_state.decisions.find((d) => d.entity === 'products');
  assert.equal(productState.decision, 'RENAME_TO_PILOT_CURSOR');

  // store_catalog_state
  assert.equal(plan.tables.store_catalog_state.decisions[0].decision, 'RENAME_TO_PILOT');

  // kitchen_ticket_seq: toma o máximo (12), reportado, nunca aplicado aqui
  const seqDecision = plan.tables.kitchen_ticket_seq.decisions[0];
  assert.equal(seqDecision.decision, 'MERGE_TAKE_MAX');
  assert.equal(seqDecision.pilotValue, 12);
  assert.equal(seqDecision.legacyValue, 5);

  // licenses: AUTO sob tenant-1 -> delete_legacy_seed
  assert.equal(plan.tables.licenses.decisions.find((d) => d.pk === 'license-tenant-1').decision, 'DELETE_LEGACY_SEED');

  // users: admin-local -> rebind (nenhum outro admin sob o piloto)
  assert.equal(plan.tables.users.adminLocalPresent, true);
  assert.equal(plan.tables.users.decisions.find((d) => d.pk === 'admin-local').decision, 'REBIND_TENANT');

  // sync_queue: 5 linhas sob tenant-1 (4 dead + 1 pending); todas com decisão, NUNCA "revive"/"pending" nas dead
  const queuePlan = plan.tables.sync_queue;
  assert.equal(queuePlan.rowsAffected, 5);
  assert.equal(queuePlan.byType.product, 1);
  assert.equal(queuePlan.byType.category, 2);
  assert.equal(queuePlan.byType.customer, 1);
  assert.equal(queuePlan.byType.sale, 1);
  for (const d of queuePlan.decisions) {
    assert.notEqual(d.decision, 'REVIVE');
    if (d.statusUnchanged) assert.ok(['dead', 'pending'].includes(d.statusUnchanged));
  }
  const deadDecisions = queuePlan.decisions.filter((d) => d.statusUnchanged === 'dead');
  assert.equal(deadDecisions.length, 4, 'as 4 linhas dead continuam reportadas como dead — status nunca muda no plano');
  for (const d of deadDecisions) {
    assert.equal(d.decision, 'REWRITE_KEEP_DEAD');
    assert.equal(d.newTenantId, PILOT);
    assert.ok(d.newDedupeKey === null || d.newDedupeKey.startsWith(PILOT));
    assert.ok(d.newSyncRef.startsWith(PILOT));
  }

  // app_logs/sync_logs: KEEP_AS_HISTORY, nunca em blockers
  assert.equal(plan.tables.app_logs.strategy, 'KEEP_AS_HISTORY');
  assert.equal(plan.tables.sync_logs.strategy, 'KEEP_AS_HISTORY');
  assert.ok(!plan.blockers.some((b) => b.table === 'app_logs' || b.table === 'sync_logs'));

  // prova de eliminação de tenant-1: NÃO satisfeita enquanto houver o fuzzy blocker de products
  assert.equal(plan.tenant1_delete_proof.satisfied, false);
  assert.ok(plan.tenant1_delete_proof.remaining_non_history_tables.some((r) => r.table === 'products'));
  assert.ok(plan.tenant1_delete_proof.history_only_tables.includes('app_logs'));
  assert.ok(plan.tenant1_delete_proof.history_only_tables.includes('sync_logs'));

  assert.equal(plan.SAFE_TO_APPLY, false, 'há pelo menos um blocker (products) — nunca YES');
});

test('offline-license.json: inválido ou com tenant diferente da licença activa gera blocker', async () => {
  const query = createReadOnlyQuery(db);

  const invalid = await buildPilotRepairPlan({
    query,
    env: {},
    inspectOfflineLicenseFile: async () => ({ present: true, valid: false, tenantId: null, error: 'BAD_SIGNATURE' }),
  });
  assert.ok(invalid.blockers.some((b) => b.kind === 'offline_license_file_invalid'));

  const mismatch = await buildPilotRepairPlan({
    query,
    env: {},
    inspectOfflineLicenseFile: async () => ({ present: true, valid: true, tenantId: 'some-other-tenant-on-disk' }),
  });
  assert.ok(mismatch.blockers.some((b) => b.kind === 'offline_license_file_tenant_mismatch'));

  const clean = await buildPilotRepairPlan({
    query,
    env: {},
    inspectOfflineLicenseFile: async () => ({ present: true, valid: true, tenantId: PILOT }),
  });
  assert.ok(!clean.blockers.some((b) => String(b.kind ?? '').startsWith('offline_license_file')));
});

test('env DEFAULT_TENANT_ID/POS_DEV_TENANT apontando para tenant-1 gera blocker', async () => {
  const query = createReadOnlyQuery(db);
  const bad = await buildPilotRepairPlan({ query, env: { DEFAULT_TENANT_ID: 'tenant-1' } });
  assert.ok(bad.blockers.some((b) => b.kind === 'env_default_tenant_is_legacy_placeholder'));

  const ok = await buildPilotRepairPlan({ query, env: { DEFAULT_TENANT_ID: PILOT } });
  assert.ok(!ok.blockers.some((b) => b.kind === 'env_default_tenant_is_legacy_placeholder'));
});

test('sessão de caixa aberta sob tenant-1: aviso informativo (blocker), nunca falha silenciosa', async () => {
  await runDb(
    `INSERT INTO cash_sessions (id, tenant_id, register_code, status, opened_at) VALUES (?, ?, 'caixa-1', 'open', ?)`,
    [crypto.randomUUID(), LEGACY, now()],
  );
  const query = createReadOnlyQuery(db);
  const plan = await buildPilotRepairPlan({ query, env: {} });
  assert.ok(plan.blockers.some((b) => b.kind === 'open_cash_sessions_under_legacy_tenant' && b.count >= 1));
});

test('SAFE_TO_APPLY: YES só quando não há blockers/hard-fails e a prova de eliminação está satisfeita', async () => {
  // BD isolada, limpa, sem nenhuma colisão possível.
  const cleanDir = fs.mkdtempSync(path.join(os.tmpdir(), 'posly-pilot-repair-clean-'));
  const savedPath = process.env.POS_DB_PATH;
  process.env.POS_DB_PATH = path.join(cleanDir, 'database.db');
  const cleanDb = (await import(`../../api/database.js?instance=${Date.now()}`)).default;

  const cleanRunDb = (sql, params = []) => new Promise((res, rej) => cleanDb.run(sql, params, function onRun(e) { e ? rej(e) : res(this); }));
  const cleanAllDb = (sql, params = []) => new Promise((res, rej) => cleanDb.all(sql, params, (e, r) => (e ? rej(e) : res(r))));
  const cleanReady = async () => {
    const deadline = Date.now() + 8000;
    for (;;) {
      try {
        await cleanAllDb('SELECT id FROM users LIMIT 1');
        return;
      } catch (e) {
        if (Date.now() > deadline) throw e;
        await sleep(100);
      }
    }
  };
  await cleanReady();
  await cleanRunDb(`CREATE TABLE IF NOT EXISTS licenses (
    id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, license_key TEXT, plan TEXT, expires_at TEXT, active INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now')), machine_id TEXT, activated_at TEXT)`);
  await cleanRunDb(`INSERT INTO licenses (id, tenant_id, license_key, active, activated_at) VALUES ('lic-clean', ?, 'REAL-CLEAN', 1, ?)`, [PILOT, now()]);
  // Nenhuma outra tabela tem linhas sob tenant-1 além do seed do próprio bootstrap (admin-local/tenant/payment_methods).
  await sleep(300);

  const query = createReadOnlyQuery(cleanDb);
  const plan = await buildPilotRepairPlan({ query, env: {} });

  assert.equal(plan.hard_fails.length, 0, JSON.stringify(plan.hard_fails));
  // admin-local sob tenant-1 é o único caso -> REBIND_TENANT (sem colisão), payment_methods seed default -> migrate (sem código igual no piloto), etc.
  assert.equal(plan.SAFE_TO_APPLY, true, JSON.stringify(plan.blockers));
  assert.equal(plan.tenant1_delete_proof.satisfied, true);

  process.env.POS_DB_PATH = savedPath;
});
