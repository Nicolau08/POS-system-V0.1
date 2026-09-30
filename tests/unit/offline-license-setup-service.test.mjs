/**
 * Etapa 1F.5b — installOfflineLicenseState (api/services/setup.service.js):
 * revalida a assinatura no servidor (defesa em profundidade — nunca confia
 * cegamente no Electron, mesmo sendo IPC local), persiste tenant/licença/
 * admin/app_setup_state, e é idempotente por device (item 19). Usa SQLite
 * temporário real (POS_DB_PATH), mesmo padrão de tests/unit/table-order-conflict.test.mjs.
 * Chave pública via o mecanismo de dev/teste (item 12), nunca hardcoded.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { test, before, after } from 'node:test';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const licenseConsoleDir = path.join(repoRoot, 'license-console');
const fixtureScript = path.join(licenseConsoleDir, 'scripts', 'gen-offline-license-fixture.mjs');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'posly-offline-license-setup-'));
const dbPath = path.join(tmpDir, 'pos-test.db');
process.env.POS_DB_PATH = dbPath;
process.env.POS_USER_DATA_PATH = tmpDir;
process.env.DEFAULT_TENANT_ID = 'tenant-test-unit';
process.env.NODE_ENV = 'test';
delete process.env.POS_APP_MODE;

function genFixture(overrides = {}) {
  const result = spawnSync(
    process.execPath,
    ['--experimental-strip-types', fixtureScript, JSON.stringify(overrides)],
    { cwd: licenseConsoleDir, encoding: 'utf8' },
  );
  assert.equal(result.status, 0, `gerador de fixture falhou: ${result.stderr}`);
  return JSON.parse(result.stdout);
}

// Uma única chave dev fixa para toda a suite — evita reconfigurar env a cada teste.
const devFixtureKeyPair = genFixture();
process.env.POS_DEV_OFFLINE_LICENSE_KEY_ID = devFixtureKeyPair.keyId;
process.env.POS_DEV_OFFLINE_LICENSE_PUBLIC_KEY = devFixtureKeyPair.publicKeyPem;

const { installOfflineLicenseState, readFirstRunStatus } = await import('../../api/services/setup.service.js');
const db = (await import('../../api/database.js')).default;

const runDbRaw = (sql) => new Promise((resolve) => db.run(sql, [], () => resolve()));
const getDb = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row ?? null);
    });
  });

// A tabela `licenses` NÃO faz parte de api/schema/*.js (orquestrado por
// database.js) — é criada como fallback lazy em api/server.js (module-load,
// fora do escopo desta etapa). Um teste que importa só setup.service.js
// (sem arrancar o server.js completo) precisa replicar esse mesmo bootstrap
// aqui, ou a tabela simplesmente não existe.
before(async () => {
  await runDbRaw(`
    CREATE TABLE IF NOT EXISTS licenses (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      license_key TEXT,
      plan TEXT,
      expires_at TEXT,
      active INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  await runDbRaw(`ALTER TABLE licenses ADD COLUMN serial_number TEXT`);
  await runDbRaw(`ALTER TABLE licenses ADD COLUMN machine_id TEXT`);
  await runDbRaw(`ALTER TABLE licenses ADD COLUMN activated_at TEXT`);
  // database.js semeia 'admin-local' de forma assíncrona (schema/bootstrap.js,
  // db.get(COUNT) -> INSERT sem ON CONFLICT) desacoplada da resolução do
  // import — dar-lhe tempo de assentar antes dos nossos próprios inserts,
  // para não colidir com essa seed em voo (pré-existente, fora do escopo
  // desta etapa).
  await new Promise((resolve) => setTimeout(resolve, 300));
});

after(() => {
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

function makeEnvelope(overrides = {}) {
  return genFixture({
    keyId: devFixtureKeyPair.keyId,
    reuseKeyPair: { privateKeyPem: devFixtureKeyPair.privateKeyPem, publicKeyPem: devFixtureKeyPair.publicKeyPem },
    payload: { machine_id: 'machine-unit-test', tenant_id: 'tenant-offline-1', license_id: 'license-offline-1', ...overrides },
  }).envelope;
}

test('installOfflineLicenseState: envelope válido -> persiste tenant/licença/admin/app_setup_state', async () => {
  const envelope = makeEnvelope();
  const result = await installOfflineLicenseState(envelope, { machineId: 'machine-unit-test' });
  assert.equal(result.success, true);
  assert.equal(result.tenantId, 'tenant-offline-1');
  assert.equal(result.licenseId, 'license-offline-1');

  const tenant = await getDb(`SELECT id, name FROM tenants WHERE id = ?`, ['tenant-offline-1']);
  assert.ok(tenant);

  const license = await getDb(`SELECT id, active, machine_id FROM licenses WHERE tenant_id = ?`, ['tenant-offline-1']);
  assert.ok(license);
  assert.equal(Number(license.active), 1);
  assert.equal(license.machine_id, 'machine-unit-test');

  const admin = await getDb(`SELECT id, pin, access_level FROM users WHERE tenant_id = ? AND role='admin'`, ['tenant-offline-1']);
  assert.ok(admin);
  assert.equal(admin.pin, '', 'admin sem PIN — configurado depois no ecrã de login, mesmo padrão do modo serial');

  const setupState = await getDb(`SELECT license_activated, setup_completed FROM app_setup_state WHERE id = 1`);
  assert.equal(Number(setupState.license_activated), 1);
  assert.equal(Number(setupState.setup_completed), 1);

  const status = await readFirstRunStatus();
  assert.equal(status.licenseActivated, true);
  assert.equal(status.isSetupComplete, true);
});

test('installOfflineLicenseState: assinatura inválida -> rejeitado, NUNCA persiste nada', async () => {
  const envelope = makeEnvelope({ tenant_id: 'tenant-tampered-attempt' });
  envelope.payload.plan = 'PRO'; // adulterado depois de assinado
  const result = await installOfflineLicenseState(envelope, { machineId: 'machine-unit-test' });
  assert.equal(result.error !== undefined, true);
  assert.equal(result.status, 400);

  const tenant = await getDb(`SELECT id FROM tenants WHERE id = ?`, ['tenant-tampered-attempt']);
  assert.equal(tenant, null);
});

test('installOfflineLicenseState: wrong machine -> rejeitado', async () => {
  const envelope = makeEnvelope({ tenant_id: 'tenant-wrong-machine', machine_id: 'machine-real' });
  const result = await installOfflineLicenseState(envelope, { machineId: 'machine-DIFERENTE' });
  assert.equal(result.kind, 'WRONG_MACHINE');
});

test('installOfflineLicenseState: idempotente — re-emitir para o MESMO tenant/license/machine nunca duplica linhas', async () => {
  const envelope1 = makeEnvelope({ tenant_id: 'tenant-idempotent', license_id: 'license-idempotent' });
  const r1 = await installOfflineLicenseState(envelope1, { machineId: 'machine-unit-test' });
  assert.equal(r1.success, true);

  // Segunda emissão (issued_at diferente, mesmo tenant/license/machine).
  const envelope2 = makeEnvelope({ tenant_id: 'tenant-idempotent', license_id: 'license-idempotent' });
  const r2 = await installOfflineLicenseState(envelope2, { machineId: 'machine-unit-test' });
  assert.equal(r2.success, true);

  const tenantRows = await new Promise((resolve, reject) => {
    db.all(`SELECT id FROM tenants WHERE id = 'tenant-idempotent'`, [], (err, rows) => (err ? reject(err) : resolve(rows)));
  });
  assert.equal(tenantRows.length, 1, 'nunca cria um segundo tenant para a mesma re-emissão');

  const licenseRows = await new Promise((resolve, reject) => {
    db.all(`SELECT id FROM licenses WHERE tenant_id = 'tenant-idempotent'`, [], (err, rows) => (err ? reject(err) : resolve(rows)));
  });
  assert.equal(licenseRows.length, 1, 'nunca cria uma segunda licença para a mesma re-emissão');
});
