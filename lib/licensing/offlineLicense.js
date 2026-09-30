import crypto from 'crypto';
import { getLocalMachineId } from './localMachineId.js';

/**
 * Verificador Ed25519 da licença offline (Etapa 1F.5a) — substitui
 * gradualmente o modelo HMAC simétrico (signMachineLicense.js). O POS NUNCA
 * possui a chave privada — só chaves públicas (offlineLicensePublicKeys.js),
 * que não são segredo.
 *
 * A canonicalização (`canonicalize`) e o formato do envelope são uma cópia
 * BYTE-A-BYTE deliberada de license-console/lib/licensing/offlineLicense.ts
 * (Etapa 1E.6) — qualquer divergência entre os dois faria toda licença
 * assinada pelo emissor real falhar a verificar aqui. Ver
 * tests/unit/offline-license-crypto.test.mjs para o vector de interop gerado
 * pelo signer real do license-console e verificado por este módulo.
 */

export const OFFLINE_LICENSE_VERSION = 1;
/**
 * v2 (Etapa 1G.3.1): payload ASSINADO com `license_version: 2`, `store_id` e `max_stations_per_store` (inteiro >= 0, ou null =
 * ilimitado, SO quando a chave esta explicitamente presente). Ausencia da chave NUNCA significa ilimitado.
 */
export const OFFLINE_LICENSE_VERSION_V2 = 2;
export const MAX_STATIONS_PER_STORE_CEILING = 10000;

/** @returns {string | null} mensagem de erro, ou null se os campos v2 estao validos */
export function validatePayloadV2Fields(payload) {
  if (payload.license_version !== 2) return 'license_version deve ser 2.';
  if (typeof payload.store_id !== 'string' || !payload.store_id.trim()) return 'store_id em falta.';
  if (!Object.prototype.hasOwnProperty.call(payload, 'max_stations_per_store') || payload.max_stations_per_store === undefined) {
    return 'max_stations_per_store em falta (ausência nunca significa ilimitado).';
  }
  const m = payload.max_stations_per_store;
  if (m !== null && !(typeof m === 'number' && Number.isInteger(m) && m >= 0 && m <= MAX_STATIONS_PER_STORE_CEILING)) {
    return 'max_stations_per_store inválido (inteiro >= 0 ou null).';
  }
  return null;
}

/** RFC 8785-like: chaves de objecto ordenadas recursivamente; ordem de arrays preservada. */
export function canonicalize(value) {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => canonicalize(v)).join(',')}]`;
  }
  const keys = Object.keys(value).sort();
  const parts = keys.map((k) => `${JSON.stringify(k)}:${canonicalize(value[k])}`);
  return `{${parts.join(',')}}`;
}

function canonicalBytes(version, keyId, payload) {
  return Buffer.from(canonicalize({ version, key_id: keyId, payload }), 'utf8');
}

/**
 * @typedef {'VALID'|'EXPIRED'|'INVALID_SIGNATURE'|'UNKNOWN_KEY'|'WRONG_MACHINE'|'WRONG_STORE'|'MALFORMED'|'UNSUPPORTED_VERSION'} OfflineLicenseVerifyKind
 */

/**
 * Verifica um envelope de licença offline.
 * @param {unknown} envelope
 * @param {(keyId: string) => string | null} resolvePublicKeyPem
 * @param {{ machineId?: string, skipMachineBinding?: boolean, expectedStoreId?: string }} [opts]
 * @returns {{ ok: boolean, kind: OfflineLicenseVerifyKind, error: string, payload?: object, licenseVersion?: 1 | 2 }}
 */
export function verifyOfflineLicense(envelope, resolvePublicKeyPem, opts = {}) {
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) {
    return { ok: false, kind: 'MALFORMED', error: 'Envelope de licença offline inválido.' };
  }
  const rec = envelope;

  // A versão determina o algoritmo esperado — nunca aceitar um "alg" livre
  // vindo do próprio envelope. Uma versão desconhecida é rejeitada sem sequer
  // tentar verificar com Ed25519.
  if (rec.version !== OFFLINE_LICENSE_VERSION && rec.version !== OFFLINE_LICENSE_VERSION_V2) {
    return { ok: false, kind: 'UNSUPPORTED_VERSION', error: 'Versão de licença offline não suportada.' };
  }

  const keyId = String(rec.key_id ?? '').trim();
  if (!keyId) return { ok: false, kind: 'MALFORMED', error: 'key_id em falta.' };

  const signature = String(rec.signature ?? '').trim();
  if (!signature) return { ok: false, kind: 'MALFORMED', error: 'Assinatura em falta.' };

  const payload = rec.payload;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { ok: false, kind: 'MALFORMED', error: 'Payload em falta.' };
  }
  const requiredFields = ['license_id', 'tenant_id', 'machine_id', 'issued_at', 'expires_at'];
  for (const field of requiredFields) {
    if (!String(payload[field] ?? '').trim()) {
      return { ok: false, kind: 'MALFORMED', error: `Campo obrigatório em falta: ${field}.` };
    }
  }

  const publicKeyPem = resolvePublicKeyPem(keyId);
  if (!publicKeyPem) {
    return { ok: false, kind: 'UNKNOWN_KEY', error: 'Chave pública desconhecida para este key_id.' };
  }

  let publicKey;
  try {
    publicKey = crypto.createPublicKey(publicKeyPem);
  } catch {
    return { ok: false, kind: 'UNKNOWN_KEY', error: 'Chave pública inválida.' };
  }

  const licenseVersion = rec.version;
  const bytes = canonicalBytes(licenseVersion, keyId, payload);
  let signatureValid = false;
  try {
    signatureValid = crypto.verify(null, bytes, publicKey, Buffer.from(signature, 'base64url'));
  } catch {
    signatureValid = false;
  }
  if (!signatureValid) {
    return { ok: false, kind: 'INVALID_SIGNATURE', error: 'Assinatura da licença offline inválida (adulterada ou chave errada).' };
  }

  // Campos v2 SO depois de a assinatura provar que vieram do emissor (nunca se lê um limite de payload nao assinado).
  if (licenseVersion === OFFLINE_LICENSE_VERSION_V2) {
    const invalid = validatePayloadV2Fields(payload);
    if (invalid) return { ok: false, kind: 'MALFORMED', error: invalid };
  }

  // Machine binding (item 16): nunca confiar em machine_id fornecido pela UI —
  // sempre comparado contra o machine_id LOCAL real (localMachineId.js).
  if (!opts.skipMachineBinding) {
    const localMachineId = String(opts.machineId ?? getLocalMachineId()).trim();
    const payloadMachineId = String(payload.machine_id ?? '').trim();
    if (!localMachineId || payloadMachineId !== localMachineId) {
      return { ok: false, kind: 'WRONG_MACHINE', error: 'Esta licença offline pertence a outra máquina.' };
    }
  }

  // Store binding (v2): a licença pertence ao Store Server dessa Store. Só compara quando o chamador conhece a Store
  // real do device (ex.: vinda do Device Auth); nunca a partir de dados não assinados.
  if (licenseVersion === OFFLINE_LICENSE_VERSION_V2 && opts.expectedStoreId != null) {
    if (String(opts.expectedStoreId).trim() !== String(payload.store_id).trim()) {
      return { ok: false, kind: 'WRONG_STORE', error: 'Esta licença offline pertence a outra Store.' };
    }
  }

  // Expiração (item 17): relógio local, nunca consulta cloud — offline significa offline.
  const expMs = Date.parse(String(payload.expires_at ?? ''));
  const expired = !Number.isFinite(expMs) || Date.now() > expMs;
  if (expired) {
    return { ok: false, kind: 'EXPIRED', error: 'Licença offline expirada.', payload, licenseVersion };
  }

  return { ok: true, kind: 'VALID', error: '', payload, licenseVersion };
}
