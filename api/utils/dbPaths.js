/**
 * Caminhos canónicos da BD SQLite POSly.
 * Nome do ficheiro: database.db (legado: pos.db — migrado one-shot).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

export const DATABASE_FILE_NAME = 'database.db';
export const LEGACY_DATABASE_FILE_NAME = 'pos.db';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const API_DIR = path.resolve(__dirname, '..');

/**
 * Resolve o path absoluto da BD.
 * - POS_DB_PATH se definido (pode apontar para database.db ou path completo)
 * - senão api/database.db
 */
export function resolveDatabasePath() {
  if (process.env.POS_DB_PATH) {
    return path.resolve(String(process.env.POS_DB_PATH));
  }
  return path.join(API_DIR, DATABASE_FILE_NAME);
}

/**
 * Resolve pasta de backups por defeito (junto à pasta data, ou POS_BACKUP_DIR).
 */
export function resolveBackupsDir(databasePath = resolveDatabasePath()) {
  if (process.env.POS_BACKUP_DIR) {
    return path.resolve(String(process.env.POS_BACKUP_DIR));
  }
  const dataDir = path.dirname(path.resolve(databasePath));
  // …/data/database.db → …/backups ; api/database.db → project/backups
  if (path.basename(dataDir).toLowerCase() === 'data') {
    return path.join(path.dirname(dataDir), 'backups');
  }
  return path.resolve(API_DIR, '..', 'backups');
}

function renameIfExists(fromPath, toPath) {
  if (!fs.existsSync(fromPath)) return false;
  if (fs.existsSync(toPath)) return false;
  fs.renameSync(fromPath, toPath);
  return true;
}

/**
 * One-shot: pos.db (+ wal/shm) → database.db no mesmo directório.
 * Se ambos existem, mantém database.db e não apaga pos.db.
 * @returns {{ path: string, migrated: boolean, warning?: string }}
 */
export function migrateLegacyDatabaseFile(targetPath = resolveDatabasePath()) {
  const resolved = path.resolve(targetPath);
  const dir = path.dirname(resolved);
  const base = path.basename(resolved);

  // Se POS_DB_PATH já aponta para pos.db legado, migrar para database.db no mesmo sítio
  // e actualizar expectativa: quem chama deve usar o path devolvido.
  let canonicalPath = resolved;
  if (base === LEGACY_DATABASE_FILE_NAME) {
    canonicalPath = path.join(dir, DATABASE_FILE_NAME);
  } else if (base !== DATABASE_FILE_NAME && !process.env.POS_DB_PATH) {
    canonicalPath = path.join(dir, DATABASE_FILE_NAME);
  }

  const legacyPath = path.join(dir, LEGACY_DATABASE_FILE_NAME);
  const newPath = path.join(dir, DATABASE_FILE_NAME);

  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    // ignore
  }

  if (fs.existsSync(newPath) && fs.existsSync(legacyPath)) {
    console.warn(
      `[database] Existem ${DATABASE_FILE_NAME} e ${LEGACY_DATABASE_FILE_NAME} em ${dir}. A usar ${DATABASE_FILE_NAME}.`,
    );
    return {
      path: newPath,
      migrated: false,
      warning: 'both_exist',
    };
  }

  let migrated = false;
  if (!fs.existsSync(newPath) && fs.existsSync(legacyPath)) {
    migrated = renameIfExists(legacyPath, newPath);
    renameIfExists(`${legacyPath}-wal`, `${newPath}-wal`);
    renameIfExists(`${legacyPath}-shm`, `${newPath}-shm`);
    if (migrated) {
      console.log(`[database] Migrado ${LEGACY_DATABASE_FILE_NAME} → ${DATABASE_FILE_NAME}`);
    }
  }

  return { path: newPath, migrated };
}

/**
 * Path da BD após migração legado (usar antes de abrir sqlite).
 */
export function resolveDatabasePathAfterMigration() {
  const preferred = resolveDatabasePath();

  if (process.env.POS_DB_PATH) {
    const envPath = path.resolve(String(process.env.POS_DB_PATH));
    const base = path.basename(envPath);
    if (base === LEGACY_DATABASE_FILE_NAME) {
      const { path: migratedPath } = migrateLegacyDatabaseFile(envPath);
      return migratedPath;
    }
    // database.db ou nome custom (testes): migrar pos.db no mesmo dir se existir
    migrateLegacyDatabaseFile(path.join(path.dirname(envPath), DATABASE_FILE_NAME));
    return envPath;
  }

  const { path: migratedPath } = migrateLegacyDatabaseFile(preferred);
  return migratedPath;
}
