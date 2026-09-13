/**
 * Selo AES-GCM da licença local em disco.
 * Humanos só vêem envelope opaco; a app descriptografa e valida HMAC depois.
 * Alterações manuais no Bloco de Notas invalidam o ficheiro.
 */
import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';

const SEAL_VERSION = 1;
const SEAL_ALG = 'aes-256-gcm';
const SEAL_INFO = 'posly-license-seal-v1';

function normalizeText(value) {
  return String(value ?? '').trim();
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
export function isSealedEnvelope(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const env = /** @type {Record<string, unknown>} */ (value);
  return (
    Number(env.v) === SEAL_VERSION &&
    String(env.alg ?? '') === SEAL_ALG &&
    Boolean(normalizeText(env.iv)) &&
    Boolean(normalizeText(env.tag)) &&
    Boolean(normalizeText(env.ciphertext))
  );
}

/**
 * @param {string} raw
 * @returns {boolean}
 */
export function isSealedLicenseRaw(raw) {
  try {
    return isSealedEnvelope(JSON.parse(String(raw ?? '')));
  } catch {
    return false;
  }
}

/**
 * @param {string} secret
 * @param {string} machineId
 * @returns {Buffer}
 */
export function deriveLicenseSealKey(secret, machineId) {
  const ikm = Buffer.from(normalizeText(secret), 'utf8');
  if (!ikm.length) {
    throw new Error('POS_LICENSE_HMAC_SECRET em falta para selar a licença local.');
  }
  const salt = Buffer.from(normalizeText(machineId) || 'unknown-machine', 'utf8');
  const info = Buffer.from(SEAL_INFO, 'utf8');
  return Buffer.from(crypto.hkdfSync('sha256', ikm, salt, info, 32));
}

/**
 * @param {Record<string, unknown>} payload
 * @param {{ secret: string, machineId: string }} opts
 */
export function sealLicensePayload(payload, opts) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('Payload de licença inválido para selar.');
  }
  const secret = normalizeText(opts?.secret);
  const machineId = normalizeText(opts?.machineId);
  const key = deriveLicenseSealKey(secret, machineId);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(SEAL_ALG, key, iv);
  const plaintext = Buffer.from(JSON.stringify(payload), 'utf8');
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    v: SEAL_VERSION,
    alg: SEAL_ALG,
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  };
}

/**
 * @param {string | Record<string, unknown>} rawOrEnvelope
 * @param {{ secret: string, machineId: string }} opts
 * @returns {Record<string, unknown>}
 */
export function unsealLicensePayload(rawOrEnvelope, opts) {
  let envelope = rawOrEnvelope;
  if (typeof rawOrEnvelope === 'string') {
    envelope = JSON.parse(rawOrEnvelope);
  }
  if (!isSealedEnvelope(envelope)) {
    throw new Error('Envelope de licença selada inválido.');
  }
  const env = /** @type {Record<string, string>} */ (envelope);
  const secret = normalizeText(opts?.secret);
  const machineId = normalizeText(opts?.machineId);
  const key = deriveLicenseSealKey(secret, machineId);
  const iv = Buffer.from(env.iv, 'base64');
  const tag = Buffer.from(env.tag, 'base64');
  const ciphertext = Buffer.from(env.ciphertext, 'base64');
  const decipher = crypto.createDecipheriv(SEAL_ALG, key, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  const payload = JSON.parse(plaintext.toString('utf8'));
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('Conteúdo da licença selada inválido.');
  }
  return payload;
}

/**
 * Lê conteúdo do ficheiro: selado ou JSON legado.
 * @returns {{ ok: true, payload: object, sealed: boolean, legacy: boolean } | { ok: false, error: string }}
 */
export function parseLicenseFileContents(raw, opts) {
  const text = String(raw ?? '').trim();
  if (!text) {
    return { ok: false, error: 'Ficheiro de licença vazio.' };
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return {
      ok: false,
      error: 'Licença local adulterada ou ilegível (não é JSON válido).',
    };
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, error: 'Ficheiro de licença inválido.' };
  }

  if (isSealedEnvelope(parsed)) {
    try {
      const payload = unsealLicensePayload(parsed, opts);
      return { ok: true, payload, sealed: true, legacy: false };
    } catch {
      return {
        ok: false,
        error:
          'Licença local adulterada ou ilegível. Só a consola de licenças pode emitir alterações — reactive nesta máquina.',
      };
    }
  }

  // JSON legado em claro (ainda assinado HMAC nos campos críticos).
  return { ok: true, payload: parsed, sealed: false, legacy: true };
}

/**
 * Grava payload como envelope selado (opaco no Bloco de Notas).
 */
export async function writeSealedLicenseFile(licensePath, payload, opts) {
  const target = path.resolve(String(licensePath ?? ''));
  if (!target) throw new Error('Caminho de licença em falta.');
  const envelope = sealLicensePayload(payload, opts);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, `${JSON.stringify(envelope)}\n`, 'utf8');
  return target;
}

/**
 * Lê ficheiro; se legado válido, migra one-shot para selado.
 * @returns {Promise<{ ok: true, payload: object, licensePath: string, migrated: boolean, sealed: boolean } | { ok: false, error: string, licensePath: string }>}
 */
export async function readLicenseFileSealed(licensePath, opts) {
  const target = path.resolve(String(licensePath ?? ''));
  const migrate = opts?.migrate !== false;
  try {
    const raw = await fs.readFile(target, 'utf8');
    const parsed = parseLicenseFileContents(raw, opts);
    if (!parsed.ok) {
      return { ok: false, error: parsed.error, licensePath: target };
    }

    let migrated = false;
    if (migrate && parsed.legacy && normalizeText(opts?.secret)) {
      try {
        await writeSealedLicenseFile(target, parsed.payload, opts);
        migrated = true;
      } catch {
        // Mantém leitura legado se a migração falhar (ex.: disco só-leitura).
      }
    }

    return {
      ok: true,
      payload: parsed.payload,
      licensePath: target,
      migrated,
      sealed: parsed.sealed || migrated,
    };
  } catch (err) {
    if (err && typeof err === 'object' && err.code === 'ENOENT') {
      return {
        ok: false,
        error: 'Licença não encontrada nesta instalação.',
        licensePath: target,
      };
    }
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Falha ao ler licença local.',
      licensePath: target,
    };
  }
}
