import fs from 'fs/promises';
import { constants as fsConstants, existsSync } from 'fs';
import path from 'path';
import {
  closeDatabase,
  getDatabasePath,
  default as db,
} from '../database.js';
import {
  DATABASE_FILE_NAME,
  resolveBackupsDir,
  resolveDatabasePathAfterMigration,
} from './dbPaths.js';

const dbPath = getDatabasePath() || resolveDatabasePathAfterMigration();
const backupsDir = resolveBackupsDir(dbPath);

const BACKUP_FILE_PATTERN = /^backup-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}\.db$/;
const PRE_RESTORE_PATTERN = /^pre-restore-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}\.db$/;
/** Intervalo por defeito: 1h — adequado a POS (perda máxima ~1h se falhar o disco). */
const DEFAULT_INTERVAL_HOURS = 1;
/** Retenção: 48 cópias horárias ≈ 2 dias (mais as manuais/pre-restore). */
const DEFAULT_RETENTION = 48;

let activeCriticalOperations = 0;

const runDb = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) return reject(err);
      resolve(this);
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

const ensureBackupsDir = async () => {
  await fs.mkdir(backupsDir, { recursive: true });
};

const validateBackupFileName = (backupFile) => {
  const normalized = String(backupFile ?? '').trim();
  if (!normalized) throw new Error('backupFile obrigatorio');
  if (path.basename(normalized) !== normalized) {
    throw new Error('nome de backup invalido');
  }
  if (!BACKUP_FILE_PATTERN.test(normalized) && !PRE_RESTORE_PATTERN.test(normalized)) {
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
  const parsed = Number(process.env.BACKUP_INTERVAL_HOURS ?? DEFAULT_INTERVAL_HOURS);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_INTERVAL_HOURS;
  return parsed;
}

export function getBackupIntervalMs() {
  return getBackupIntervalHours() * 60 * 60 * 1000;
}

export function getBackupRetentionCount() {
  const parsed = Number(process.env.BACKUP_RETENTION_COUNT ?? DEFAULT_RETENTION);
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_RETENTION;
  return Math.floor(parsed);
}

export function getBackupsDirectory() {
  return backupsDir;
}

export function getLiveDatabasePath() {
  return dbPath;
}

async function pruneOldBackups() {
  const retention = getBackupRetentionCount();
  const entries = await fs.readdir(backupsDir, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && BACKUP_FILE_PATTERN.test(entry.name))
    .map((entry) => entry.name)
    .sort((a, b) => b.localeCompare(a));

  const toDelete = files.slice(retention);
  for (const fileName of toDelete) {
    try {
      await fs.unlink(path.join(backupsDir, fileName));
    } catch {
      // ignore
    }
  }
  return { kept: files.length - toDelete.length, deleted: toDelete.length };
}

export async function createBackup(options = {}) {
  const prefix = options.prefix === 'pre-restore' ? 'pre-restore' : 'backup';
  await ensureBackupsDir();
  let fileName = `${prefix}-${formatBackupTimestamp(new Date())}.db`;
  let filePath = path.join(backupsDir, fileName);

  // Evitar colisão no mesmo minuto
  if (existsSync(filePath)) {
    fileName = `${prefix}-${formatBackupTimestamp(new Date())}-${Date.now()}.db`;
    filePath = path.join(backupsDir, fileName);
  }

  try {
    await runDb('PRAGMA wal_checkpoint(FULL)');
  } catch {
    // Se a BD já estiver fechada, continuar com cópia do ficheiro
  }

  await fs.copyFile(dbPath, filePath, fsConstants.COPYFILE_EXCL);

  if (prefix === 'backup') {
    await pruneOldBackups();
  }

  return {
    fileName,
    filePath,
    createdAt: new Date().toISOString(),
    backupsDir,
  };
}

export async function listBackups() {
  await ensureBackupsDir();
  const entries = await fs.readdir(backupsDir, { withFileTypes: true });
  const files = entries
    .filter(
      (entry) =>
        entry.isFile() &&
        (BACKUP_FILE_PATTERN.test(entry.name) || PRE_RESTORE_PATTERN.test(entry.name)),
    )
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
        kind: PRE_RESTORE_PATTERN.test(fileName) ? 'pre-restore' : 'backup',
      };
    }),
  );

  return enriched;
}

/**
 * Restauro por substituição do ficheiro database.db.
 * Fecha a BD, troca o ficheiro e indica requiresRestart (reabrir processo API).
 */
export async function restoreBackup(backupFile) {
  if (hasCriticalOperations()) {
    throw new Error('Existem operações críticas em curso. Tente novamente dentro de momentos.');
  }

  const fileName = validateBackupFileName(backupFile);
  await ensureBackupsDir();
  const backupPath = path.join(backupsDir, fileName);
  await fs.access(backupPath);

  // Cópia de segurança da BD actual antes de restaurar
  const safety = await createBackup({ prefix: 'pre-restore' });

  try {
    await runDb('PRAGMA wal_checkpoint(FULL)');
  } catch {
    // ignore
  }

  await closeDatabase();

  const livePath = dbPath;
  const walPath = `${livePath}-wal`;
  const shmPath = `${livePath}-shm`;

  // Remover WAL/SHM para não misturar estado antigo
  for (const side of [walPath, shmPath]) {
    try {
      await fs.unlink(side);
    } catch {
      // ignore
    }
  }

  const tempLive = `${livePath}.restoring`;
  try {
    await fs.copyFile(backupPath, tempLive);
    await fs.rename(tempLive, livePath);
  } catch (error) {
    try {
      await fs.unlink(tempLive);
    } catch {
      // ignore
    }
    throw error;
  }

  return {
    fileName,
    filePath: backupPath,
    restoredAt: new Date().toISOString(),
    safetyBackup: safety.fileName,
    databaseFile: DATABASE_FILE_NAME,
    requiresRestart: true,
  };
}

/**
 * True se deve correr backup no arranque (sem backups ou último mais velho que o intervalo).
 */
export async function shouldRunStartupBackup() {
  try {
    const list = await listBackups();
    const regular = list.filter((b) => b.kind === 'backup');
    if (regular.length === 0) return true;
    const newest = regular[0];
    const ageMs = Date.now() - new Date(newest.createdAt).getTime();
    return ageMs >= getBackupIntervalMs();
  } catch {
    return true;
  }
}
