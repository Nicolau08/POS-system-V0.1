/**
 * Encriptação SQLCipher da BD (chave via POS_DB_ENCRYPTION_KEY).
 * Sem chave (dev sem Electron): BD permanece plaintext com sqlite3.
 */
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

export const ENCRYPTION_MARKER_FILE = '.database-encryption.json';

const HEX_KEY_RE = /^[0-9a-fA-F]{64}$/;

export function getDbEncryptionKey() {
  const disabled = String(process.env.POS_DB_ENCRYPTION ?? '1').trim() === '0';
  if (disabled) return null;

  const raw = String(process.env.POS_DB_ENCRYPTION_KEY ?? '').trim();
  if (!raw) return null;
  if (!HEX_KEY_RE.test(raw)) {
    throw new Error(
      'POS_DB_ENCRYPTION_KEY inválida: esperado 64 caracteres hexadecimais (256-bit).',
    );
  }
  return raw.toLowerCase();
}

export function encryptionMarkerPath(databasePath) {
  return path.join(path.dirname(path.resolve(databasePath)), ENCRYPTION_MARKER_FILE);
}

export function readEncryptionMarker(databasePath) {
  const markerPath = encryptionMarkerPath(databasePath);
  if (!fs.existsSync(markerPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(markerPath, 'utf8'));
  } catch {
    return null;
  }
}

export function isMarkedEncrypted(databasePath) {
  const marker = readEncryptionMarker(databasePath);
  return marker?.encrypted === true;
}

export function writeEncryptionMarker(databasePath) {
  const markerPath = encryptionMarkerPath(databasePath);
  fs.writeFileSync(
    markerPath,
    `${JSON.stringify(
      {
        encrypted: true,
        cipher: 'sqlcipher',
        version: 1,
        migratedAt: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
}

function toSqlPath(filePath) {
  return path.resolve(filePath).replace(/\\/g, '/');
}

function loadSqlCipher() {
  // API compatível com node-sqlite3
  return require('@journeyapps/sqlcipher');
}

function runAsync(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) return reject(err);
      resolve(this);
    });
  });
}

function getAsync(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)));
  });
}

function closeAsync(db) {
  return new Promise((resolve, reject) => {
    db.close((err) => (err ? reject(err) : resolve()));
  });
}

/**
 * Verifica se o ficheiro parece SQLite plaintext (cabeçalho "SQLite format 3").
 */
export function looksLikePlaintextSqlite(databasePath) {
  if (!fs.existsSync(databasePath)) return false;
  try {
    const fd = fs.openSync(databasePath, 'r');
    const buf = Buffer.alloc(16);
    fs.readSync(fd, buf, 0, 16, 0);
    fs.closeSync(fd);
    return buf.toString('utf8', 0, 15) === 'SQLite format 3';
  } catch {
    return false;
  }
}

/**
 * Migra database.db plaintext → SQLCipher (sqlcipher_export), one-shot.
 */
export async function migratePlaintextToSqlCipher(databasePath, key) {
  const resolved = path.resolve(databasePath);
  if (!fs.existsSync(resolved)) {
    return { migrated: false, reason: 'missing' };
  }
  if (isMarkedEncrypted(resolved) && !looksLikePlaintextSqlite(resolved)) {
    return { migrated: false, reason: 'already_encrypted' };
  }
  if (!looksLikePlaintextSqlite(resolved)) {
    // Já não é plaintext legível — assumir encriptado
    if (!isMarkedEncrypted(resolved)) {
      writeEncryptionMarker(resolved);
    }
    return { migrated: false, reason: 'not_plaintext' };
  }

  const sqlcipher = loadSqlCipher();
  const tempEnc = `${resolved}.encrypting`;
  const walPath = `${resolved}-wal`;
  const shmPath = `${resolved}-shm`;

  for (const side of [tempEnc, `${tempEnc}-wal`, `${tempEnc}-shm`]) {
    try {
      if (fs.existsSync(side)) fs.unlinkSync(side);
    } catch {
      // ignore
    }
  }

  const db = new sqlcipher.Database(resolved);
  try {
    // Checkpoint se houver WAL
    try {
      await runAsync(db, 'PRAGMA wal_checkpoint(FULL)');
    } catch {
      // ignore
    }
    await runAsync(
      db,
      `ATTACH DATABASE '${toSqlPath(tempEnc)}' AS encrypted KEY '${key}'`,
    );
    await getAsync(db, "SELECT sqlcipher_export('encrypted') AS r");
    await runAsync(db, 'DETACH DATABASE encrypted');
  } finally {
    await closeAsync(db);
  }

  if (!fs.existsSync(tempEnc) || fs.statSync(tempEnc).size < 100) {
    throw new Error('Falha na migração SQLCipher: ficheiro encriptado inválido.');
  }

  const backupPlain = `${resolved}.pre-encrypt-backup`;
  try {
    if (fs.existsSync(backupPlain)) fs.unlinkSync(backupPlain);
    fs.renameSync(resolved, backupPlain);
  } catch (err) {
    try {
      fs.unlinkSync(tempEnc);
    } catch {
      // ignore
    }
    throw err;
  }

  try {
    fs.renameSync(tempEnc, resolved);
  } catch (err) {
    // Tentar reverter
    try {
      if (fs.existsSync(backupPlain)) fs.renameSync(backupPlain, resolved);
    } catch {
      // ignore
    }
    throw err;
  }

  for (const side of [walPath, shmPath]) {
    try {
      if (fs.existsSync(side)) fs.unlinkSync(side);
    } catch {
      // ignore
    }
  }

  writeEncryptionMarker(resolved);

  try {
    fs.unlinkSync(backupPlain);
  } catch {
    console.warn(
      `[database] Migração SQLCipher OK; backup plaintext residual: ${backupPlain}`,
    );
  }

  console.log('[database] Migrado database.db plaintext → SQLCipher');
  return { migrated: true };
}

/**
 * Abre ligação SQLite: sqlcipher+chave se POS_DB_ENCRYPTION_KEY; senão sqlite3.
 */
export async function openSqliteDatabase(databasePath) {
  const key = getDbEncryptionKey();
  const resolved = path.resolve(databasePath);

  if (!key) {
    const sqlite3Import = require('sqlite3');
    const sqlite3 = sqlite3Import.verbose();
    const db = new sqlite3.Database(resolved);
    db.configure('busyTimeout', 15000);
    try {
      db.run('PRAGMA busy_timeout = 15000');
    } catch {
      // ignore
    }
    return { db, encrypted: false, path: resolved };
  }

  await migratePlaintextToSqlCipher(resolved, key);

  const sqlcipher = loadSqlCipher();
  const db = new sqlcipher.Database(resolved);
  db.configure('busyTimeout', 15000);

  await runAsync(db, `PRAGMA key = '${key}'`);
  try {
    await runAsync(db, 'PRAGMA busy_timeout = 15000');
  } catch {
    // ignore
  }
  // Validar chave / ficheiro
  try {
    await getAsync(db, 'SELECT count(*) AS c FROM sqlite_master');
  } catch (err) {
    await closeAsync(db).catch(() => {});
    throw new Error(
      `Falha ao abrir BD encriptada (chave incorrecta ou ficheiro corrompido): ${err.message}`,
    );
  }

  if (!isMarkedEncrypted(resolved)) {
    writeEncryptionMarker(resolved);
  }

  console.log('[database] SQLCipher activo (chave via POS_DB_ENCRYPTION_KEY)');
  return { db, encrypted: true, path: resolved };
}

