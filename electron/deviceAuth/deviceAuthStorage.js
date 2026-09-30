/**
 * Persistência da credencial de device-auth cloud (refresh token opaco +
 * device_id), protegida com Electron safeStorage (DPAPI no Windows) — mesmo
 * padrão de electron/dbEncryptionKey.js.
 *
 * Nunca guarda: activation_token (uso único, nunca persistido — descartado em
 * memória após o bootstrap), access_token (só em memória, ver deviceAuthClient.js).
 *
 * Escrita atómica (tmp + rename) para nunca deixar device_id/refresh_token num
 * estado parcial se o processo morrer a meio da escrita.
 *
 * CORREÇÃO OBRIGATÓRIA (Etapa 1F.2, item 0): ao contrário de
 * dbEncryptionKey.js (que tem um fallback plaintext deliberado — regra desta
 * etapa aplica-se SOMENTE ao Device Auth refresh credential, nunca à chave
 * SQLCipher), este módulo NUNCA escreve nem lê o refresh token em plaintext.
 * Se safeStorage estiver indisponível: bootstrap/refresh simplesmente não
 * persistem a credencial — cloud auth/sync fica indisponível, mas o POS local
 * (login, venda, pagamento, impressão, SQLite, stock, sync_queue) continua
 * normalmente, porque nada no arranque local depende deste módulo.
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { safeStorage } from 'electron';

export const DEVICE_AUTH_FILE = 'device-auth.json';

function statePath(userDataPath) {
  return path.join(userDataPath, DEVICE_AUTH_FILE);
}

function isValidState(state) {
  return (
    state &&
    typeof state === 'object' &&
    typeof state.deviceId === 'string' &&
    state.deviceId.length > 0 &&
    typeof state.refreshToken === 'string' &&
    state.refreshToken.length > 0
  );
}

/**
 * @param {string} userDataPath
 * @returns {{ ok: true, state: object } | { ok: false, reason: 'not_found' | 'unreadable' | 'secure_storage_unavailable' }}
 */
export function readDeviceAuthState(userDataPath) {
  const filePath = statePath(userDataPath);
  if (!fs.existsSync(filePath)) {
    return { ok: false, reason: 'not_found' };
  }

  // Nunca lido como plaintext: um refresh credential só pode existir em disco
  // se tiver sido escrito por safeStorage (ver writeDeviceAuthState). Se
  // safeStorage ficou indisponível ENTRETANTO (ex.: perfil Windows corrompido),
  // o ficheiro existente fica ilegível — nunca tentamos interpretá-lo como
  // JSON em claro (isso reabriria a porta ao plaintext que esta etapa fecha).
  if (!safeStorage.isEncryptionAvailable()) {
    return { ok: false, reason: 'secure_storage_unavailable' };
  }

  const raw = fs.readFileSync(filePath);
  try {
    const json = safeStorage.decryptString(raw);
    const state = JSON.parse(json);
    if (isValidState(state)) {
      return { ok: true, state, storage: 'safeStorage' };
    }
    return { ok: false, reason: 'unreadable' };
  } catch {
    // Ficheiro corrompido, ou escrito noutra máquina sem DPAPI compatível —
    // nunca crashar o arranque do POS por isto.
    return { ok: false, reason: 'unreadable' };
  }
}

/**
 * @param {string} userDataPath
 * @param {{ deviceId: string, refreshToken: string, refreshTokenExpiresAt: string|null, createdAt?: string }} state
 * @returns {{ ok: true, storage: 'safeStorage' } | { ok: false, reason: 'secure_storage_unavailable' }}
 */
export function writeDeviceAuthState(userDataPath, state) {
  if (!isValidState(state)) {
    throw new Error('device_auth_state_invalid');
  }
  // CORREÇÃO 1F.2 item 0: nunca gravar o refresh credential em plaintext.
  // Sem safeStorage, simplesmente não persiste — o chamador (bootstrapDevice/
  // refreshAccessToken) trata isto como "device cloud auth não fica
  // configurado", nunca como erro fatal.
  if (!safeStorage.isEncryptionAvailable()) {
    return { ok: false, reason: 'secure_storage_unavailable' };
  }

  fs.mkdirSync(userDataPath, { recursive: true });
  const filePath = statePath(userDataPath);
  const tmpPath = path.join(userDataPath, `.${DEVICE_AUTH_FILE}.${crypto.randomBytes(6).toString('hex')}.tmp`);

  const toWrite = {
    deviceId: state.deviceId,
    refreshToken: state.refreshToken,
    refreshTokenExpiresAt: state.refreshTokenExpiresAt ?? null,
    createdAt: state.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const payload = safeStorage.encryptString(JSON.stringify(toWrite));

  fs.writeFileSync(tmpPath, payload);
  // rename é atómico no mesmo volume — nunca deixa o ficheiro final a meio de uma escrita.
  fs.renameSync(tmpPath, filePath);

  return { ok: true, storage: 'safeStorage' };
}

/**
 * @param {string} userDataPath
 */
export function clearDeviceAuthState(userDataPath) {
  const filePath = statePath(userDataPath);
  try {
    fs.unlinkSync(filePath);
  } catch (err) {
    if (err?.code !== 'ENOENT') throw err;
  }
}
