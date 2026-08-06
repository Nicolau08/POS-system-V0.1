/**
 * Empacotamento da chave SQLCipher por instalação (nunca master global).
 * O ficheiro de recuperação fica cifrado com uma senha escolhida no export.
 */
import crypto from 'crypto';
import { getDbEncryptionKey, isMarkedEncrypted } from './dbEncryption.js';
import { getLiveDatabasePath } from './backup.js';

const WRAP_MIN_LENGTH = 8;

export function getDbEncryptionRuntimeStatus() {
  const key = (() => {
    try {
      return getDbEncryptionKey();
    } catch {
      return null;
    }
  })();
  const databasePath = getLiveDatabasePath();
  return {
    encryptionConfigured: Boolean(key),
    databaseMarkedEncrypted: isMarkedEncrypted(databasePath),
    databasePath,
  };
}

export function assertWrapPassword(raw) {
  const password = String(raw ?? '');
  if (password.length < WRAP_MIN_LENGTH) {
    const err = new Error(`A senha do ficheiro de recuperação deve ter pelo menos ${WRAP_MIN_LENGTH} caracteres.`);
    err.status = 400;
    err.code = 'WRAP_PASSWORD_TOO_SHORT';
    throw err;
  }
  return password;
}

/**
 * @param {{ keyHex: string, tenantId: string, exportedBy: string }} payload
 * @param {string} wrapPassword
 */
export function wrapRecoveryKeyPackage(payload, wrapPassword) {
  const password = assertWrapPassword(wrapPassword);
  const keyHex = String(payload?.keyHex ?? '').trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(keyHex)) {
    const err = new Error('Chave de encriptação da BD indisponível neste processo.');
    err.status = 409;
    err.code = 'DB_KEY_UNAVAILABLE';
    throw err;
  }

  const inner = Buffer.from(
    JSON.stringify({
      keyHex,
      tenantId: String(payload.tenantId ?? ''),
      exportedBy: String(payload.exportedBy ?? ''),
      exportedAt: new Date().toISOString(),
    }),
    'utf8',
  );

  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const derived = crypto.scryptSync(password, salt, 32);
  const cipher = crypto.createCipheriv('aes-256-gcm', derived, iv);
  const ciphertext = Buffer.concat([cipher.update(inner), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    v: 1,
    alg: 'aes-256-gcm',
    kdf: 'scrypt',
    purpose: 'posly-db-recovery-key',
    tenantId: String(payload.tenantId ?? ''),
    exportedAt: new Date().toISOString(),
    salt: salt.toString('hex'),
    iv: iv.toString('hex'),
    tag: tag.toString('hex'),
    ciphertext: ciphertext.toString('hex'),
    note: 'Chave da BD desta instalação apenas. Guarde offline. Não partilhe. Não há senha master global.',
  };
}

/**
 * @param {unknown} packageJson
 * @param {string} wrapPassword
 * @returns {{ keyHex: string, tenantId: string, exportedBy: string, exportedAt: string }}
 */
export function unwrapRecoveryKeyPackage(packageJson, wrapPassword) {
  const password = assertWrapPassword(wrapPassword);
  const pkg = packageJson && typeof packageJson === 'object' ? packageJson : null;
  if (!pkg || Number(pkg.v) !== 1 || String(pkg.alg) !== 'aes-256-gcm') {
    const err = new Error('Ficheiro de recuperação inválido ou versão não suportada.');
    err.status = 400;
    err.code = 'RECOVERY_PACKAGE_INVALID';
    throw err;
  }

  const salt = Buffer.from(String(pkg.salt ?? ''), 'hex');
  const iv = Buffer.from(String(pkg.iv ?? ''), 'hex');
  const tag = Buffer.from(String(pkg.tag ?? ''), 'hex');
  const ciphertext = Buffer.from(String(pkg.ciphertext ?? ''), 'hex');
  if (salt.length < 8 || iv.length !== 12 || tag.length !== 16 || ciphertext.length < 1) {
    const err = new Error('Ficheiro de recuperação corrompido.');
    err.status = 400;
    err.code = 'RECOVERY_PACKAGE_CORRUPT';
    throw err;
  }

  try {
    const derived = crypto.scryptSync(password, salt, 32);
    const decipher = crypto.createDecipheriv('aes-256-gcm', derived, iv);
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    const parsed = JSON.parse(plain.toString('utf8'));
    const keyHex = String(parsed?.keyHex ?? '').trim().toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(keyHex)) {
      const err = new Error('Pacote de recuperação sem chave válida.');
      err.status = 400;
      err.code = 'RECOVERY_KEY_MISSING';
      throw err;
    }
    return {
      keyHex,
      tenantId: String(parsed.tenantId ?? pkg.tenantId ?? ''),
      exportedBy: String(parsed.exportedBy ?? ''),
      exportedAt: String(parsed.exportedAt ?? pkg.exportedAt ?? ''),
    };
  } catch (err) {
    if (err?.code) throw err;
    const fail = new Error('Senha do ficheiro incorrecta ou pacote inválido.');
    fail.status = 403;
    fail.code = 'RECOVERY_UNWRAP_FAILED';
    throw fail;
  }
}
