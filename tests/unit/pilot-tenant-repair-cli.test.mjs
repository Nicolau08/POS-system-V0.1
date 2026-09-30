/**
 * Pilot Gate — Fase A1: CLI api/scripts/pilot-tenant-repair.mjs, via processo real (spawn), contra uma
 * BD real (schema completo de database.js). Prova: (1) o ficheiro da BD alvo fica byte-a-byte idêntico
 * antes/depois de um --dry-run; (2) --apply é recusado ANTES de qualquer ligação (ficheiro nem tocado);
 * (3) correr sem --dry-run também é recusado; (4) o relatório mostra SAFE_TO_APPLY e o exit code reflecte.
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const cliPath = path.join(repoRoot, 'api', 'scripts', 'pilot-tenant-repair.mjs');

function sha256(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function buildFixtureDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'posly-pilot-repair-cli-'));
  const dbPath = path.join(dir, 'database.db');
  const builderScript = path.join(dir, 'build-fixture.mjs');
  fs.writeFileSync(
    builderScript,
    `
import db from ${JSON.stringify(pathToFileUrl(path.join(repoRoot, 'api', 'database.js')))};
const run = (sql, params = []) => new Promise((res, rej) => db.run(sql, params, function onRun(e) { e ? rej(e) : res(this); }));
const all = (sql, params = []) => new Promise((res, rej) => db.all(sql, params, (e, r) => (e ? rej(e) : res(r))));
const deadline = Date.now() + 8000;
for (;;) {
  try { await all('SELECT id FROM users LIMIT 1'); break; }
  catch (e) { if (Date.now() > deadline) throw e; await new Promise((r) => setTimeout(r, 100)); }
}
await run("CREATE TABLE IF NOT EXISTS licenses (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, license_key TEXT, plan TEXT, expires_at TEXT, active INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now')), machine_id TEXT, activated_at TEXT)");
await run("INSERT INTO licenses (id, tenant_id, license_key, active, activated_at) VALUES ('lic-cli', 'pilot-cli-tenant-000001', 'REAL-CLI', 1, datetime('now'))");
await new Promise((resolve) => setTimeout(resolve, 400));
await new Promise((resolve) => db.close(resolve));
`,
    'utf8',
  );
  const build = spawnSync(process.execPath, [builderScript], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: { ...process.env, POS_DB_PATH: dbPath, DEFAULT_TENANT_ID: 'tenant-1' },
  });
  if (build.status !== 0) {
    throw new Error(`fixture build failed: ${build.stderr || build.stdout}`);
  }
  return { dir, dbPath };
}

function pathToFileUrl(p) {
  return pathToFileURL(p).href;
}

function runCli(args) {
  return spawnSync(process.execPath, [cliPath, ...args], { cwd: repoRoot, encoding: 'utf8' });
}

test('--apply é recusado sem tocar no ficheiro da BD (nem abre ligação)', () => {
  const { dir, dbPath } = buildFixtureDb();
  try {
    const before = sha256(dbPath);
    const mtimeBefore = fs.statSync(dbPath).mtimeMs;
    const res = runCli(['--apply', '--db', dbPath]);
    assert.notEqual(res.status, 0);
    assert.match(res.stderr, /--apply não existe/);
    assert.equal(sha256(dbPath), before);
    assert.equal(fs.statSync(dbPath).mtimeMs, mtimeBefore);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('sem --dry-run (e sem --apply) é recusado, ficheiro intocado', () => {
  const { dir, dbPath } = buildFixtureDb();
  try {
    const before = sha256(dbPath);
    const res = runCli(['--db', dbPath]);
    assert.notEqual(res.status, 0);
    assert.match(res.stderr, /Uso: node/);
    assert.equal(sha256(dbPath), before);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('--dry-run: ficheiro da BD alvo byte-a-byte idêntico antes/depois; relatório mostra SAFE_TO_APPLY', () => {
  const { dir, dbPath } = buildFixtureDb();
  try {
    const before = sha256(dbPath);
    // -wal pode legitimamente passar de "inexistente" a "0 bytes" só por o SQLite abrir uma ligação
    // read-only a uma BD em journal_mode=WAL (ver comentário em pilot-tenant-repair.mjs); um -wal de
    // 0 bytes não contém nenhuma frame de escrita — por isso comparamos o TAMANHO, não a mera presença.
    const walSizeBefore = fs.existsSync(`${dbPath}-wal`) ? fs.statSync(`${dbPath}-wal`).size : 0;
    const jsonOut = path.join(dir, 'plan.json');

    const res = runCli(['--dry-run', '--db', dbPath, '--json', jsonOut]);

    assert.equal(sha256(dbPath), before, 'o ficheiro principal da BD nunca muda com --dry-run');
    const walSizeAfter = fs.existsSync(`${dbPath}-wal`) ? fs.statSync(`${dbPath}-wal`).size : 0;
    assert.equal(walSizeAfter, walSizeBefore, 'o -wal continua com zero frames de escrita reais depois do --dry-run');
    assert.match(res.stdout, /SAFE_TO_APPLY: (YES|NO)/);
    assert.match(res.stdout, /db_content_unchanged \(main db \+ wal, byte-a-byte\): true/);
    assert.match(res.stdout, /query_only_pragma: ON/);
    assert.match(res.stdout, /assertReadOnlySql: ON/);

    assert.ok(fs.existsSync(jsonOut));
    const plan = JSON.parse(fs.readFileSync(jsonOut, 'utf8'));
    assert.equal(plan.fingerprint.before.db, plan.fingerprint.after.db);
    assert.equal(typeof plan.plan.SAFE_TO_APPLY, 'boolean');
    assert.equal(plan.plan.pilot_tenant, 'pilot-cl');

    const safe = /SAFE_TO_APPLY: YES/.test(res.stdout);
    assert.equal(res.status, safe ? 0 : 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('BD inexistente falha de forma clara, sem criar nada', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'posly-pilot-repair-missing-'));
  try {
    const missing = path.join(dir, 'nope.db');
    const res = runCli(['--dry-run', '--db', missing]);
    assert.notEqual(res.status, 0);
    assert.match(res.stderr, /não existe/);
    assert.ok(!fs.existsSync(missing), 'nunca cria a BD que faltava');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
