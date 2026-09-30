/**
 * OfflineLicenseClient (Etapa 1F.5b, item 6) — responsabilidades separadas,
 * nunca misturadas num único ficheiro gigante:
 *  - HTTP: requestOfflineLicense() — pede o envelope Ed25519 ao license-console,
 *    autenticado com o Device JWT (nunca o admin token, nunca persiste o JWT).
 *  - Crypto: reutiliza lib/licensing/offlineLicense.js (não reimplementado aqui).
 *  - Storage: installOfflineLicense()/loadOfflineLicense() — escrita atómica
 *    (tmp+rename, mesmo padrão de deviceAuthStorage.js), plaintext JSON (item 8:
 *    o envelope não é segredo — adulterar qualquer campo invalida a assinatura
 *    Ed25519; ao contrário do refresh token do Device Auth, safeStorage nunca é
 *    exigido para uma licença válida continuar utilizável).
 *  - Estado estruturado: getOfflineLicenseState() — a UI nunca interpreta
 *    crypto directamente (item 29), só lê o `kind` devolvido aqui.
 *
 * Nunca confia no storage (item 10): loadOfflineLicense() e
 * getOfflineLicenseState() reverificam SEMPRE a assinatura, mesmo para um
 * ficheiro que a própria instalação escreveu momentos antes.
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { verifyOfflineLicense } from '../../lib/licensing/offlineLicense.js';
import { getLocalMachineId } from '../../lib/licensing/localMachineId.js';

export const OFFLINE_LICENSE_FILE = 'offline-license.json';

export function resolveOfflineLicensePath(userDataPath) {
  return path.join(userDataPath, OFFLINE_LICENSE_FILE);
}

/**
 * Pede o envelope ao license-console, autenticado com um Device JWT já
 * válido (item 4: nunca LICENSE_ISSUER_ADMIN_TOKEN; o chamador deve obter o
 * token via getValidAccessToken() antes de chamar isto — este módulo nunca
 * gere refresh, só usa o access token que recebe).
 * @param {{ accessToken: string, issuerBaseUrl: string, timeoutMs?: number }} params
 */
export async function requestOfflineLicense({ accessToken, issuerBaseUrl, timeoutMs = 15000 }) {
  const base = String(issuerBaseUrl ?? '').trim();
  if (!base) return { ok: false, error: 'POS_LICENSE_ISSUER_BASE_URL não configurado.', kind: 'NO_ISSUER' };
  const token = String(accessToken ?? '').trim();
  if (!token) return { ok: false, error: 'Device JWT em falta.', kind: 'NO_TOKEN' };

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${base.replace(/\/$/, '')}/api/license-issuer/device/offline-license`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      signal: ctrl.signal,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return {
        ok: false,
        error: String(data?.error ?? `${res.status} ${res.statusText}`),
        code: data?.code ?? null,
        status: res.status,
        kind: 'ISSUANCE_FAILED',
      };
    }
    if (!data?.offline_license) {
      return { ok: false, error: 'Resposta do servidor de licenças incompleta.', kind: 'ISSUANCE_FAILED' };
    }
    return { ok: true, envelope: data.offline_license };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err), kind: 'NETWORK' };
  } finally {
    clearTimeout(timer);
  }
}

function atomicWriteJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmpPath = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${crypto.randomBytes(6).toString('hex')}.tmp`);
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf8');
  // rename é atómico no mesmo volume — nunca deixa o ficheiro final a meio de uma escrita.
  fs.renameSync(tmpPath, filePath);
}

/**
 * Instala um envelope no disco — SÓ depois de verificado com sucesso (item 3:
 * "a licença só pode ser persistida DEPOIS de assinatura válida; key_id
 * conhecido; machine_id correcto; version suportada; payload válido; não
 * expirada"). Nunca escreve um envelope não verificado.
 * @param {{ envelope: unknown, userDataPath: string, resolvePublicKeyPem: (keyId: string) => string | null, machineId?: string }} params
 */
export function installOfflineLicense({ envelope, userDataPath, resolvePublicKeyPem, machineId }) {
  const verification = verifyOfflineLicense(envelope, resolvePublicKeyPem, { machineId: machineId ?? getLocalMachineId() });
  if (!verification.ok) {
    return { ok: false, kind: verification.kind, error: verification.error };
  }
  const licensePath = resolveOfflineLicensePath(userDataPath);
  atomicWriteJson(licensePath, envelope);
  return { ok: true, kind: 'VALID', payload: verification.payload, licensePath };
}

/**
 * Lê e reverifica SEMPRE (item 10) — nunca assume "se está no ficheiro, já
 * foi verificada". Devolve o mesmo enum estruturado que a UI espera (item 29):
 * VALID | EXPIRED | INVALID_SIGNATURE | UNKNOWN_KEY | WRONG_MACHINE |
 * MALFORMED | UNSUPPORTED_VERSION | MISSING.
 * @param {{ userDataPath: string, resolvePublicKeyPem: (keyId: string) => string | null, machineId?: string }} params
 */
export function getOfflineLicenseState({ userDataPath, resolvePublicKeyPem, machineId }) {
  const licensePath = resolveOfflineLicensePath(userDataPath);
  let raw;
  try {
    raw = fs.readFileSync(licensePath, 'utf8');
  } catch (err) {
    if (err?.code === 'ENOENT') return { ok: false, kind: 'MISSING', error: 'Licença offline não instalada nesta máquina.' };
    return { ok: false, kind: 'MALFORMED', error: 'Falha ao ler licença offline.' };
  }

  let envelope;
  try {
    envelope = JSON.parse(raw);
  } catch {
    return { ok: false, kind: 'MALFORMED', error: 'Licença offline ilegível (não é JSON válido).' };
  }

  const verification = verifyOfflineLicense(envelope, resolvePublicKeyPem, { machineId: machineId ?? getLocalMachineId() });
  if (!verification.ok) {
    return { ok: false, kind: verification.kind, error: verification.error, licensePath };
  }
  return { ok: true, kind: 'VALID', payload: verification.payload, licensePath };
}

export function clearOfflineLicense(userDataPath) {
  const licensePath = resolveOfflineLicensePath(userDataPath);
  try {
    fs.unlinkSync(licensePath);
  } catch (err) {
    if (err?.code !== 'ENOENT') throw err;
  }
}
