/**
 * Pilot Gate — GET /sync/local-tenant-map (diagnóstico só-leitura). Chamada directa do handler contra uma BD
 * temporária real (schema completo de database.js): classificação legacy/cloud/other/empty, duas identidades
 * cloud separadas (Device JWT em cache vs. licença activa), sanitização de ids, sem segredos, e PROVA de
 * zero escritas (total_changes + hash lógico de todas as tabelas + hash dos ficheiros da BD + audit_logs).
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, before } from 'node:test';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'posly-local-tenant-map-'));
const dbPath = path.join(tmpDir, 'database.db');
process.env.POS_DB_PATH = dbPath;
process.env.DEFAULT_TENANT_ID = 'tenant-1';
delete process.env.SUPABASE_URL;
delete process.env.NEXT_PUBLIC_SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;

const LEGACY = 'tenant-1';
const CLOUD = 'c0ffee00-1111-2222-3333-444455556666'; // tenant real do piloto (licença)
const OTHER = 'deadbeef-9999-8888-7777-666655554444';
const JWT_ONLY = 'f00dcafe-aaaa-bbbb-cccc-ddddeeeeffff'; // tenant do Device JWT, diferente da licença

const db = (await import('../../api/database.js')).default;
const { createLocalTenantMapHandler } = await import('../../api/controllers/sync.controller.js');
const { assertReadOnlySql, createReadOnlyQuery, buildLocalTenantMap, sanitizeTenantId } = await import(
  '../../api/services/localTenantMap.service.js'
);

const runDb = (sql, params = []) => new Promise((res, rej) => db.run(sql, params, function onRun(e) { e ? rej(e) : res(this); }));
const allDb = (sql, params = []) => new Promise((res, rej) => db.all(sql, params, (e, r) => (e ? rej(e) : res(r))));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => new Date().toISOString();

function fakeRes() {
  const res = { statusCode: 200, body: null };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (payload) => { res.body = payload; return res; };
  return res;
}

function fakeJwt(claims) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'ES256', kid: 'k1' })}.${b64(claims)}.sig-nunca-deve-sair`;
}

async function callHandler({ token, tenantId = LEGACY, calls } = {}) {
  const handler = createLocalTenantMapHandler({
    query: createReadOnlyQuery(db),
    getCachedDeviceToken: async () => {
      if (calls) calls.count += 1;
      return token ?? null;
    },
  });
  const res = fakeRes();
  await handler({ tenantId, user: { id: 'admin-local', tenant_id: tenantId } }, res);
  return res;
}

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

/** Hash lógico de TODAS as tabelas (conteúdo por rowid) + hash dos ficheiros da BD. */
async function dbFingerprint() {
  const tables = await allDb(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`);
  const h = crypto.createHash('sha256');
  for (const { name } of tables) {
    let rows;
    try {
      rows = await allDb(`SELECT * FROM "${name}" ORDER BY rowid`);
    } catch {
      rows = await allDb(`SELECT * FROM "${name}"`);
    }
    h.update(name).update(JSON.stringify(rows));
  }
  const fileHash = crypto.createHash('sha256');
  for (const suffix of ['', '-wal']) {
    const p = dbPath + suffix;
    if (fs.existsSync(p)) fileHash.update(fs.readFileSync(p));
  }
  const [{ c }] = await allDb('SELECT total_changes() AS c');
  const [{ n }] = await allDb('SELECT COUNT(*) AS n FROM audit_logs');
  return { logical: h.digest('hex'), files: fileHash.digest('hex'), totalChanges: c, auditRows: n };
}

before(async () => {
  await ready();
});

test('licenses ausente (BD ainda sem tabela): não falha, licença desconhecida', async () => {
  const res = await callHandler();
  assert.equal(res.statusCode, 200);
  const data = res.body.data;
  assert.equal(data.license_tenant.known, false);
  assert.equal(data.licenses.present, false);
  assert.equal(data.device_jwt_tenant.available, false);
  assert.equal(data.classification_reference, 'none');
});

test('semeia BD do piloto: operador em tenant-1, licença/JWT no tenant real', async () => {
  await runDb(`CREATE TABLE IF NOT EXISTS licenses (
    id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, license_key TEXT, plan TEXT, expires_at TEXT, active INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now')), serial_number TEXT, machine_id TEXT, activated_at TEXT)`);
  await runDb(`INSERT INTO licenses (id, tenant_id, license_key, plan, expires_at, active, activated_at) VALUES (?, ?, ?, ?, ?, 1, ?)`,
    ['license-real', CLOUD, 'SECRET-LICENSE-KEY-XYZ', 'PRO', '2099-01-01T00:00:00.000Z', now()]);
  await runDb(`INSERT INTO licenses (id, tenant_id, license_key, plan, expires_at, active) VALUES (?, ?, 'AUTO', 'BASIC', NULL, 1)`,
    ['license-auto', LEGACY]);
  await runDb(`INSERT INTO licenses (id, tenant_id, license_key, plan, expires_at, active) VALUES (?, ?, 'OLD', 'PRO', '2001-01-01T00:00:00.000Z', 1)`,
    ['license-old', OTHER]);

  for (const [name, tenant] of [['CatLegacy Q7z', LEGACY], ['CatCloud Q7z', CLOUD], ['CatOther Q7z', OTHER]]) {
    await runDb(`INSERT INTO categories (name, cloud_id, tenant_id, updated_at) VALUES (?, ?, ?, ?)`, [name, crypto.randomUUID(), tenant, now()]);
  }
  await runDb(`INSERT INTO products (name, cloud_id, tenant_id, price, created_at, updated_at) VALUES (?, ?, ?, 10, ?, ?)`,
    ['ProdLegacy Q7z', crypto.randomUUID(), LEGACY, now(), now()]);
  await runDb(`INSERT INTO products (name, cloud_id, tenant_id, price, created_at, updated_at) VALUES (?, ?, ?, 10, ?, ?)`,
    ['ProdLegacy2 Q7z', crypto.randomUUID(), LEGACY, now(), now()]);

  const queue = [
    // [row tenant, type, status, payload tenant, dedupe_key, sync_ref]
    [LEGACY, 'product', 'pending', LEGACY, `${LEGACY}:product:1`, `${LEGACY}:product:1`],
    [LEGACY, 'product', 'dead', CLOUD, `${LEGACY}:product:2`, `${CLOUD}:product:2`], // payload/sync_ref desalinhados
    [LEGACY, 'sale', 'pending', LEGACY, null, `${LEGACY}:sale:9`],
    [CLOUD, 'category', 'synced', CLOUD, `${CLOUD}:category:1`, `${CLOUD}:category:1`],
    [CLOUD, 'category', 'failed', LEGACY, `${LEGACY}:category:3`, `${CLOUD}:category:3`], // payload + dedupe desalinhados
    [OTHER, 'customer', 'pending', null, 'sem-dois-pontos', null], // payload sem tenant, dedupe não parseável
  ];
  for (const [t, type, status, payloadTenant, dedupe, ref] of queue) {
    const data = payloadTenant ? { tenant_id: payloadTenant, name: 'nome-de-negocio-nunca-sai' } : { name: 'nome-de-negocio-nunca-sai' };
    await runDb(`INSERT INTO sync_queue (tenant_id, type, data, dedupe_key, sync_ref, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [t, type, JSON.stringify(data), dedupe, ref, status, now(), now()]);
  }
  await runDb(`INSERT INTO sync_queue (tenant_id, type, data, status, created_at, updated_at) VALUES (?, 'sale', 'isto-nao-e-json', 'pending', ?, ?)`, [LEGACY, now(), now()]);

  for (const id of [`cloud:products:${LEGACY}`, `cloud:categories:${CLOUD}`, `cloud:orders:${CLOUD}`, `cloud:users:${OTHER}`, 'formato-desconhecido']) {
    await runDb(`INSERT OR REPLACE INTO sync_state (id, last_sync_at) VALUES (?, ?)`, [id, now()]);
  }
  await sleep(500); // deixa assentar qualquer escrita assíncrona de arranque antes das provas de zero escritas
});

test('mapa: classes por tabela, tabelas mistas, users/admin-local, licenças, fila e sync_state', async () => {
  const res = await callHandler({ token: fakeJwt({ tenant_id: CLOUD, role: 'authenticated' }) });
  assert.equal(res.statusCode, 200);
  const d = res.body.data;

  assert.equal(d.read_only, true);
  assert.deepEqual(d.device_jwt_tenant, { available: true, reason: null, id: CLOUD.slice(0, 8), class: 'cloud_match' });
  assert.equal(d.license_tenant.id, CLOUD.slice(0, 8));
  assert.equal(d.license_tenant.active_real_license_tenants, 2, 'real+antiga (não conta AUTO nem tenant-1)');
  assert.equal(d.identities_match, true);
  assert.equal(d.classification_reference, 'device_jwt');
  assert.deepEqual(d.request_tenant, { class: 'legacy_placeholder', id: 'tenant-1' });

  assert.equal(d.tables.categories.cloud_match, 1);
  assert.equal(d.tables.categories.other, 1);
  assert.equal(d.tables.products.legacy_placeholder, 2);
  assert.equal(d.tables.products.mixed_legacy_and_cloud, false);
  assert.equal(d.tables.categories.mixed_legacy_and_cloud, d.tables.categories.legacy_placeholder > 0, 'categories: legacy (seed de bootstrap ou não) + cloud');
  assert.ok(d.tables_by_pattern.legacy_only.includes('products'));
  assert.ok(d.tables.categories.device_jwt_match === 1 && d.tables.categories.license_match === 1);

  assert.equal(d.users.present, true);
  assert.equal(d.users.admin_local.class, 'legacy_placeholder');
  assert.equal(d.users.admin_local.tenant, 'tenant-1');
  assert.ok(d.users.by_class.legacy_placeholder.total >= 1);

  assert.equal(d.licenses.by_class.cloud_match.total, 1);
  assert.deepEqual(d.licenses.by_class.cloud_match.by_type, { PRO: 1 });
  assert.deepEqual(d.licenses.by_class.cloud_match.by_status, { active: 1 });
  assert.equal(d.licenses.by_class.legacy_placeholder.auto_seed, 1);
  assert.deepEqual(d.licenses.by_class.other.by_status, { expired: 1 });

  const q = d.sync_queue;
  assert.equal(q.by_class.legacy_placeholder.total, 4); // 3 + 1 payload não-JSON
  assert.deepEqual(q.by_class.legacy_placeholder.by_status, { pending: 3, dead: 1 });
  assert.deepEqual(q.by_class.cloud_match.by_type, { category: 2 });
  assert.equal(q.by_class.other.total, 1);
  assert.equal(q.mismatches.payload_tenant_mismatch.total, 2);
  assert.equal(q.mismatches.payload_tenant_mismatch.by_row_class.legacy_placeholder, 1);
  assert.equal(q.mismatches.payload_tenant_mismatch.by_row_class.cloud_match, 1);
  assert.equal(q.mismatches.payload_tenant_missing.total, 1);
  assert.equal(q.mismatches.payload_invalid_json.total, 1);
  assert.equal(q.mismatches.dedupe_key_mismatch.total, 2, 'category (cloud com dedupe legacy) + chave não parseável');
  assert.equal(q.mismatches.sync_ref_mismatch.total, 1, 'só o produto legacy com sync_ref do tenant cloud');
  assert.equal(q.mismatches.sync_ref_mismatch.by_row_class.legacy_placeholder, 1);
  assert.equal(q.payload_tenant_class_by_row_class.legacy_placeholder.cloud_match, 1);

  assert.equal(d.sync_state.present, true);
  assert.equal(d.sync_state.unparsed, 1);
  assert.equal(d.sync_state.by_class.legacy_placeholder.total, 1);
  assert.deepEqual(d.sync_state.by_class.cloud_match.by_entity, { categories: 1, orders: 1 });
  assert.equal(d.sync_state.by_class.other.total, 1);

  const ids = Object.fromEntries(d.tenant_ids.map((e) => [`${e.id}|${e.class}`, e]));
  assert.ok(ids['tenant-1|legacy_placeholder']);
  assert.ok(ids[`${CLOUD.slice(0, 8)}|cloud_match`]);
  assert.ok(ids[`${OTHER.slice(0, 8)}|other`]);
});

test('Device JWT e licença são identidades separadas (discordam); sem token cai para a licença', async () => {
  const differing = (await callHandler({ token: fakeJwt({ tenant_id: JWT_ONLY }) })).body.data;
  assert.equal(differing.device_jwt_tenant.id, JWT_ONLY.slice(0, 8));
  assert.equal(differing.license_tenant.id, CLOUD.slice(0, 8));
  assert.equal(differing.identities_match, false);
  assert.equal(differing.classification_reference, 'device_jwt');
  // referência = JWT → nenhuma linha local é cloud_match, mas as linhas da licença continuam contadas à parte.
  assert.equal(differing.tables.categories.cloud_match, 0);
  assert.equal(differing.tables.categories.license_match, 1);
  assert.equal(differing.tables.categories.device_jwt_match, 0);

  const noToken = (await callHandler({ token: null })).body.data;
  assert.deepEqual(noToken.device_jwt_tenant, { available: false, reason: 'device_token_not_cached', id: null, class: null });
  assert.equal(noToken.identities_match, null);
  assert.equal(noToken.classification_reference, 'license');
  assert.equal(noToken.tables.categories.cloud_match, 1);

  const noClaim = (await callHandler({ token: fakeJwt({ role: 'authenticated' }) })).body.data;
  assert.equal(noClaim.device_jwt_tenant.reason, 'tenant_claim_missing');
});

test('nunca expõe ids completos, license_key, JWT, payloads ou nomes de negócio', async () => {
  const token = fakeJwt({ tenant_id: CLOUD });
  const raw = JSON.stringify((await callHandler({ token })).body);
  for (const secret of [CLOUD, OTHER, JWT_ONLY, 'SECRET-LICENSE-KEY-XYZ', token, 'sig-nunca-deve-sair', 'nome-de-negocio-nunca-sai', 'isto-nao-e-json', 'Q7z']) {
    assert.ok(!raw.includes(secret), `a resposta não pode conter "${secret}"`);
  }
  assert.equal(sanitizeTenantId(CLOUD), CLOUD.slice(0, 8));
  assert.equal(sanitizeTenantId('  TENANT-1 '), 'tenant-1');
  assert.equal(sanitizeTenantId(''), null);
});

test('PROVA zero escritas: total_changes, hash lógico, hash de ficheiros e audit_logs iguais antes/depois', async () => {
  const before = await dbFingerprint();
  const calls = { count: 0 };
  for (const token of [fakeJwt({ tenant_id: CLOUD }), null, fakeJwt({ tenant_id: JWT_ONLY })]) {
    const res = await callHandler({ token, calls });
    assert.equal(res.statusCode, 200);
  }
  await sleep(300);
  const after = await dbFingerprint();
  assert.equal(calls.count, 3, 'só o provider de token em cache (sem refresh) é chamado, 1x por pedido');
  assert.equal(after.totalChanges, before.totalChanges, 'total_changes() inalterado');
  assert.equal(after.logical, before.logical, 'conteúdo lógico de todas as tabelas inalterado');
  assert.equal(after.files, before.files, 'ficheiros da BD (db + wal) byte a byte inalterados');
  assert.equal(after.auditRows, before.auditRows, 'nenhuma escrita em audit_logs');
});

test('SQL só-leitura: rejeita escritas, DDL, PRAGMA, ATTACH e múltiplos statements', () => {
  const bad = [
    `INSERT INTO users (id) VALUES ('x')`,
    `UPDATE users SET active = 0`,
    `DELETE FROM sync_queue`,
    `REPLACE INTO sync_state (id) VALUES ('x')`,
    `DROP TABLE users`,
    `CREATE TABLE t (a)`,
    `ALTER TABLE users ADD COLUMN x TEXT`,
    `PRAGMA journal_mode = DELETE`,
    `ATTACH DATABASE 'x.db' AS x`,
    `VACUUM`,
    `BEGIN`,
    `WITH x AS (SELECT 1) DELETE FROM users`,
    `WITH x AS (SELECT 1) INSERT INTO users SELECT * FROM x`,
    `SELECT 1; DELETE FROM users`,
    `SELECT 1; SELECT 2`,
    `/* SELECT */ DELETE FROM users`,
    `SELECT load_extension('x')`,
    ``,
    `   `,
  ];
  for (const sql of bad) assert.throws(() => assertReadOnlySql(sql), /read_only_sql/, `deveria rejeitar: ${sql}`);
  assert.throws(() => assertReadOnlySql(null), /read_only_sql/);

  const good = [
    `SELECT 1`,
    `SELECT 1;`,
    `SELECT name FROM pragma_table_info('users')`,
    `SELECT created_at, updated_at FROM "update"`,
    `SELECT 'delete; drop table x' AS s`,
    `WITH x AS (SELECT 1 AS a) SELECT a FROM x`,
    `SELECT tenant_id, COUNT(*) FROM "products" GROUP BY tenant_id -- insert into`,
  ];
  for (const sql of good) assert.doesNotThrow(() => assertReadOnlySql(sql), `deveria aceitar: ${sql}`);
});

test('createReadOnlyQuery: SQL de escrita nunca chega ao handle da BD', async () => {
  const seen = [];
  const spy = { all: (sql, params, cb) => { seen.push(sql); cb(null, []); } };
  const query = createReadOnlyQuery(spy);
  await query('SELECT 1');
  assert.throws(() => query(`DELETE FROM users`), /read_only_sql_violation/);
  assert.throws(() => query(`UPDATE users SET pin = ''`), /read_only_sql_violation/);
  assert.deepEqual(seen, ['SELECT 1']);

  // buildLocalTenantMap com um `query` que tenta escrever falha fechado (o handler devolve 500, sem escrever).
  const evil = createReadOnlyQuery(spy);
  const wrapped = (sql, p) => evil(sql.startsWith('SELECT name FROM pragma') ? `DELETE FROM users` : sql, p);
  await assert.rejects(buildLocalTenantMap({ query: wrapped }), /read_only_sql_violation/);
  assert.ok(seen.every((s) => /^\s*SELECT/i.test(s)));
});

test('falha interna devolve 500 sem detalhe (o erro é registado pelo logger normal, não pelo mapa)', async () => {
  const handler = createLocalTenantMapHandler({
    query: async () => { throw new Error('boom com detalhe interno'); },
    getCachedDeviceToken: async () => null,
  });
  const res = fakeRes();
  await handler({ tenantId: LEGACY }, res);
  assert.equal(res.statusCode, 500);
  assert.ok(!JSON.stringify(res.body).includes('boom'));
});
