/**
 * Etapa 1F.6 (itens 27-28) — mecanismo real de backup/restore
 * (api/utils/backup.js), contra uma BD SQLite real temporária. Prova
 * integridade dos dados de negócio após um ciclo backup->alterar->restore.
 * Nunca toca em dados reais de desenvolvimento.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'posly-1f6-backup-'));
process.env.POS_DB_PATH = path.join(tmpDir, 'database.db');
process.env.POS_BACKUP_DIR = path.join(tmpDir, 'backups');
process.env.DEFAULT_TENANT_ID = 'tenant-1f6-backup';

const db = (await import('../../api/database.js')).default;
const { createBackup, listBackups, restoreBackup, getBackupsDirectory } = await import('../../api/utils/backup.js');

const runDb = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) return reject(err);
      resolve(this);
    });
  });
const getDb = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row ?? null)));
  });

test('createBackup: cria cópia real da BD com dados de negócio (users/products/customers/sales/stock/queue)', async () => {
  // Aguarda o bootstrap (schema + seed do admin inicial, que inclui um hash
  // bcrypt assíncrono) terminar mesmo -- em vez de um sleep fixo, faz poll
  // até o utilizador admin seed existir. Um sleep fixo (400ms) podia deixar
  // esse INSERT assíncrono ainda pendente quando o teste seguinte fecha a
  // ligação (restoreBackup -> closeDatabase()), produzindo SQLITE_MISUSE
  // intermitente sob carga (achado real da etapa 1F.6, ver bootstrap.js).
  const deadline = Date.now() + 5000;
  for (;;) {
    const row = await getDb(`SELECT COUNT(*) AS c FROM users`);
    if ((row?.c ?? 0) > 0) break;
    if (Date.now() > deadline) throw new Error('bootstrap não seedou o utilizador admin a tempo');
    await new Promise((r) => setTimeout(r, 50));
  }

  await runDb(
    `INSERT INTO tenants (id, name, created_at) VALUES ('tenant-1f6-backup', 'Loja Backup Teste', datetime('now')) ON CONFLICT(id) DO NOTHING`,
  );
  await runDb(
    `INSERT INTO products (name, price, tenant_id, stock_quantity, created_at, updated_at) VALUES ('Produto Backup', 99.9, 'tenant-1f6-backup', 5, datetime('now'), datetime('now'))`,
  );

  const backup1 = await createBackup();
  assert.ok(backup1.fileName.startsWith('backup-'));
  assert.ok(fs.existsSync(backup1.filePath), 'ficheiro de backup deve existir no disco');
  const backupSize = fs.statSync(backup1.filePath).size;
  assert.ok(backupSize > 0, 'backup não pode estar vazio');

  const listed = await listBackups();
  assert.ok(listed.some((b) => b.fileName === backup1.fileName));
  assert.equal(getBackupsDirectory(), process.env.POS_BACKUP_DIR);
});

test('restoreBackup: dados alterados depois do backup são REVERTIDOS após restore; pre-restore safety backup criado', async () => {
  await runDb(
    `INSERT INTO products (name, price, tenant_id, stock_quantity, created_at, updated_at) VALUES ('Antes do Backup 1F6', 10, 'tenant-1f6-backup', 1, datetime('now'), datetime('now'))`,
  );
  const backup = await createBackup();

  // Altera dados DEPOIS do backup -- isto deve desaparecer após o restore.
  await runDb(
    `INSERT INTO products (name, price, tenant_id, stock_quantity, created_at, updated_at) VALUES ('Depois Do Backup 1F6', 20, 'tenant-1f6-backup', 1, datetime('now'), datetime('now'))`,
  );
  const beforeRestore = await getDb(`SELECT COUNT(*) AS c FROM products WHERE tenant_id = 'tenant-1f6-backup'`);
  assert.ok(beforeRestore.c >= 2);

  const restoreResult = await restoreBackup(backup.fileName);
  assert.equal(restoreResult.requiresRestart, true);
  assert.ok(restoreResult.safetyBackup, 'deve criar uma cópia de segurança pre-restore antes de substituir a BD');

  const backupsAfterRestore = (await listBackups()).filter((b) => b.kind === 'pre-restore');
  assert.ok(backupsAfterRestore.length >= 1, 'deve existir pelo menos um backup pre-restore');

  // Reabre a BD real (o processo real reiniciaria; aqui reabrimos a ligação
  // directamente sobre o ficheiro já substituído, para verificar o conteúdo).
  const sqlite3 = (await import('sqlite3')).default.verbose();
  const reopened = await new Promise((resolve, reject) => {
    const d = new sqlite3.Database(process.env.POS_DB_PATH, (err) => (err ? reject(err) : resolve(d)));
  });
  const afterRestore = await new Promise((resolve, reject) => {
    reopened.get(`SELECT COUNT(*) AS c FROM products WHERE name = 'Depois Do Backup 1F6'`, (err, row) =>
      err ? reject(err) : resolve(row),
    );
  });
  assert.equal(afterRestore.c, 0, 'produto criado DEPOIS do backup não deve existir após o restore');

  const preservedRow = await new Promise((resolve, reject) => {
    reopened.get(`SELECT name FROM products WHERE name = 'Antes do Backup 1F6'`, (err, row) => (err ? reject(err) : resolve(row)));
  });
  assert.equal(preservedRow?.name, 'Antes do Backup 1F6', 'produto criado ANTES do backup deve continuar presente após o restore');

  await new Promise((resolve) => reopened.close(() => resolve()));
});

test('validateBackupFileName (indirecto via restoreBackup): nome de ficheiro com path traversal é rejeitado', async () => {
  await assert.rejects(() => restoreBackup('../../etc/passwd'), /nome de backup invalido|formato de backup invalido/);
  await assert.rejects(() => restoreBackup('../database.db'), /nome de backup invalido|formato de backup invalido/);
});

test('item 28 — achado arquitectural: backup contém SÓ dados de negócio (database.db), NUNCA device-auth.json/offline-license.json/chave SQLCipher', () => {
  // Confirma por leitura do código (api/utils/backup.js) que createBackup()
  // só copia database.db -- credenciais de device/licença ficam noutros
  // ficheiros geridos separadamente, nunca incluídos aqui. Documentado no
  // relatório como distinção deliberada entre "business data backup" e
  // "device credential backup" (item 28).
  const source = fs.readFileSync(path.resolve('api/utils/backup.js'), 'utf8');
  assert.ok(!source.includes('device-auth.json'));
  assert.ok(!source.includes('offline-license.json'));
  assert.ok(!source.includes('db-encryption.key'));
});
