/**
 * Chave de encriptação da BD (256-bit), protegida com Electron safeStorage (DPAPI no Windows).
 * Nunca pedida ao operador; só injectada no processo API local via env.
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { safeStorage } from 'electron';

export const DB_ENCRYPTION_KEY_FILE = 'db-encryption.key';

/**
 * @param {string} userDataPath
 * @returns {{ keyHex: string, created: boolean, storage: 'safeStorage' | 'plaintext-fallback' }}
 */
export function getOrCreateDbEncryptionKey(userDataPath) {
  const keyPath = path.join(userDataPath, DB_ENCRYPTION_KEY_FILE);
  const encryptionAvailable = safeStorage.isEncryptionAvailable();

  if (fs.existsSync(keyPath)) {
    const raw = fs.readFileSync(keyPath);
    if (encryptionAvailable) {
      try {
        const keyHex = safeStorage.decryptString(raw);
        if (/^[0-9a-fA-F]{64}$/.test(keyHex)) {
          return { keyHex: keyHex.toLowerCase(), created: false, storage: 'safeStorage' };
        }
      } catch (err) {
        // Pode ser ficheiro legado plaintext — tentar abaixo
        console.warn(
          '[electron] Falha a desencriptar db-encryption.key; a tentar leitura directa:',
          err?.message ?? err,
        );
      }
    }
    const asText = raw.toString('utf8').trim();
    if (/^[0-9a-fA-F]{64}$/.test(asText)) {
      // Migrar para safeStorage se disponível
      if (encryptionAvailable) {
        try {
          const encrypted = safeStorage.encryptString(asText.toLowerCase());
          fs.writeFileSync(keyPath, encrypted);
          return {
            keyHex: asText.toLowerCase(),
            created: false,
            storage: 'safeStorage',
          };
        } catch {
          // keep plaintext fallback
        }
      }
      return {
        keyHex: asText.toLowerCase(),
        created: false,
        storage: 'plaintext-fallback',
      };
    }
    throw new Error(
      'Ficheiro db-encryption.key inválido ou ilegível neste PC. A BD encriptada não pode ser aberta noutro computador sem a chave original.',
    );
  }

  const keyHex = crypto.randomBytes(32).toString('hex');
  fs.mkdirSync(userDataPath, { recursive: true });

  if (encryptionAvailable) {
    const encrypted = safeStorage.encryptString(keyHex);
    fs.writeFileSync(keyPath, encrypted);
    return { keyHex, created: true, storage: 'safeStorage' };
  }

  // Fallback raro (ex.: ambiente sem DPAPI): gravar hex com permissões mínimas possíveis
  fs.writeFileSync(keyPath, `${keyHex}\n`, { encoding: 'utf8', mode: 0o600 });
  console.warn(
    '[electron] safeStorage indisponível — chave da BD guardada em plaintext em db-encryption.key. BitLocker recomendado.',
  );
  return { keyHex, created: true, storage: 'plaintext-fallback' };
}
