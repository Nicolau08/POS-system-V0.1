import fs from 'fs/promises';
import { constants as fsConstants } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import db from '../database.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backupsDir = process.env.POS_BACKUP_DIR
  ? path.resolve(String(process.env.POS_BACKUP_DIR))
  : path.resolve(__dirname, '../../backups');

const dbPath = process.env.POS_DB_PATH
  ? path.resolve(String(process.env.POS_DB_PATH))
  : path.resolve(__dirname, '../pos.db');

const BACKUP_FILE_PATTERN = /^backup-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}\.db$/;

let activeCriticalOperations = 0;

const runDb = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) return reject(err);
      resolve(this);
    });
  });

const allDb = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows ?? []);
    });
  });

const pad2 = (value) => String(value).padStart(2, '0');

const formatBackupTimestamp = (date) => {
  const year = date.getFullYear();
  const month = pad2(date.getMonth() + 1);
  const day = pad2(date.getDate());
  const hour = pad2(date.getHours());
  const minute = pad2(date.getMinutes());
  return `${year}-${month}-${day}-${hour}-${minute}`;
};

const escapeIdentifier = (identifier) => `"${String(identifier).replace(/"/g, '""')}"`;

const ensureBackupsDir = async () => {
  await fs.mkdir(backupsDir, { recursive: true });
};

const validateBackupFileName = (backupFile) => {
  const normalized = String(backupFile ?? '').trim();
  if (!normalized) throw new Error('backupFile obrigatorio');
  if (path.basename(normalized) !== normalized) {
    throw new Error('nome de backup invalido');
  }
  if (!BACKUP_FILE_PATTERN.test(normalized)) {
    throw new Error('formato de backup invalido');
  }
  return normalized;
};

export function beginCriticalOperation() {
  activeCriticalOperations += 1;
}

export function endCriticalOperation() {
  activeCriticalOperations = Math.max(0, activeCriticalOperations - 1);
}

export function getActiveCriticalOperations() {
  return activeCriticalOperations;
}

export function hasCriticalOperations() {
  return activeCriticalOperations > 0;
}

export function getBackupIntervalHours() {
  const parsed = Number(process.env.BACKUP_INTERVAL_HOURS ?? 6);
  if (!Number.isFinite(parsed) || parsed <= 0) return 6;
  return parsed;
}

export function getBackupIntervalMs() {
  return getBackupIntervalHours() * 60 * 60 * 1000;
}

export async function createBackup() {
  await ensureBackupsDir();
  const fileName = `backup-${formatBackupTimestamp(new Date())}.db`;
  const filePath = path.join(backupsDir, fileName);

  await runDb('PRAGMA wal_checkpoint(FULL)');
  await fs.copyFile(dbPath, filePath, fsConstants.COPYFILE_EXCL);

  return {
    fileName,
    filePath,
    createdAt: new Date().toISOString(),
  };
}

export async function listBackups() {
  await ensureBackupsDir();
  const entries = await fs.readdir(backupsDir, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && BACKUP_FILE_PATTERN.test(entry.name))
    .map((entry) => entry.name)
    .sort((a, b) => b.localeCompare(a));

  const enriched = await Promise.all(
    files.map(async (fileName) => {
      const filePath = path.join(backupsDir, fileName);
      const stat = await fs.stat(filePath);
      return {
        fileName,
        filePath,
        sizeBytes: stat.size,
        createdAt: stat.mtime.toISOString(),
      };
    })
  );

  return enriched;
}

export async function restoreBackup(backupFile) {
  const fileName = validateBackupFileName(backupFile);
  await ensureBackupsDir();
  const backupPath = path.join(backupsDir, fileName);

  await fs.access(backupPath);

  await runDb('PRAGMA foreign_keys = OFF');
  try {
    await runDb('BEGIN IMMEDIATE TRANSACTION');
    try {
      await runDb(`ATTACH DATABASE ? AS backup_db`, [backupPath]);

      const backupTables = await allDb(
        `SELECT name
           FROM backup_db.sqlite_master
          WHERE type = 'table'
            AND name NOT LIKE 'sqlite_%'
          ORDER BY name ASC`
      );
      const mainTables = await allDb(
        `SELECT name
           FROM sqlite_master
          WHERE type = 'table'
            AND name NOT LIKE 'sqlite_%'
          ORDER BY name ASC`
      );
      const mainTableSet = new Set((mainTables ?? []).map((row) => String(row.name)));

      for (const row of backupTables ?? []) {
        const tableName = String(row?.name ?? '').trim();
        if (!tableName || !mainTableSet.has(tableName)) continue;
        const escapedTable = escapeIdentifier(tableName);
        await runDb(`DELETE FROM ${escapedTable}`);
        await runDb(`INSERT INTO ${escapedTable} SELECT * FROM backup_db.${escapedTable}`);
      }

      const hasBackupSequence = await allDb(
        `SELECT name FROM backup_db.sqlite_master WHERE type = 'table' AND name = 'sqlite_sequence' LIMIT 1`
      );
      if ((hasBackupSequence ?? []).length > 0) {
        await runDb(`DELETE FROM sqlite_sequence`);
        await runDb(`INSERT INTO sqlite_sequence(name, seq) SELECT name, seq FROM backup_db.sqlite_sequence`);
      }

      await runDb(`DETACH DATABASE backup_db`);
      await runDb('COMMIT');
      return {
        fileName,
        filePath: backupPath,
        restoredAt: new Date().toISOString(),
      };
    } catch (error) {
      try {
        await runDb(`DETACH DATABASE backup_db`);
      } catch {}
      try {
        await runDb('ROLLBACK');
      } catch {}
      throw error;
    }
  } finally {
    await runDb('PRAGMA foreign_keys = ON');
  }
}
