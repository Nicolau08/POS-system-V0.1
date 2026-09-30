/**
 * Etapa 1G.3.4 - identidade da Station (processo MAIN do Electron). A chave privada Ed25519:
 *  - nasce aqui, nunca sai do processo main (o renderer so pede "faz este pedido" via IPC, nunca "da-me a chave");
 *  - so e guardada cifrada com safeStorage (DPAPI no Windows). Sem armazenamento seguro -> FALHA FECHADA (sem fallback plaintext);
 *  - station-runtime.json e station-identity.json guardam apenas dados NAO secretos (station_id, chave publica, URL do servidor).
 * Pairing sem estado parcial: a chave e cifrada e escrita num ficheiro "pending" ANTES de contactar o Server; so depois de o
 * Server responder 201 e que se promove (rename atomico) e se escreve o station-identity.json (a sua existencia = commit).
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { normalizeFingerprint } from '../../lib/tls/serverCertificate.js';
import { createPinnedFetch } from './pinnedHttps.js';

export const IDENTITY_FILE = 'station-identity.json';
export const KEY_FILE = 'station-key.enc';
const PENDING_KEY_FILE = '.station-key.enc.pending';

export class StationIdentityError extends Error {
  constructor(code, message, extra = {}) {
    super(message);
    this.name = 'StationIdentityError';
    this.code = code;
    Object.assign(this, extra);
  }
}

/** So https://host[:porta] (1G.3.6: nunca HTTP); sem credenciais, caminho, query ou fragmento. */
export function normalizeServerOrigin(input) {
  let u;
  try {
    u = new URL(String(input ?? '').trim());
  } catch {
    throw new StationIdentityError('INVALID_SERVER_URL', 'URL do servidor inválida.');
  }
  if (u.protocol === 'http:') {
    throw new StationIdentityError('HTTP_DOWNGRADE', 'HTTP recusado: o servidor tem de ser https:// (certificado fixado por fingerprint).');
  }
  if (u.protocol !== 'https:' || u.username || u.password) {
    throw new StationIdentityError('INVALID_SERVER_URL', 'URL do servidor inválida.');
  }
  return u.origin;
}

/** Token de pairing dado pelo admin: POSLY-PAIR-1.<8 digitos>.<fingerprint sha256 base64url>. Devolve {code, fingerprint} ou null. */
export function parsePairingToken(input) {
  const m = /^POSLY-PAIR-1\.(\d{8})\.([A-Za-z0-9_-]{43})$/.exec(String(input ?? '').trim());
  if (!m) return null;
  const fingerprint = Buffer.from(m[2], 'base64url').toString('hex');
  return normalizeFingerprint(fingerprint) ? { code: m[1], fingerprint } : null;
}

function atomicWrite(file, content) {
  const tmp = `${file}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(tmp, content);
  fs.renameSync(tmp, file);
}

/**
 * @param {{ userDataPath: string, safeStorage: { isEncryptionAvailable: () => boolean, encryptString: (s: string) => Buffer, decryptString: (b: Buffer) => string, getSelectedStorageBackend?: () => string } }} deps
 */
export function createStationIdentityStore({ userDataPath, safeStorage }) {
  const identityPath = path.join(userDataPath, IDENTITY_FILE);
  const keyPath = path.join(userDataPath, KEY_FILE);
  const pendingPath = path.join(userDataPath, PENDING_KEY_FILE);

  function isSecureStorageAvailable() {
    try {
      if (!safeStorage || safeStorage.isEncryptionAvailable() !== true) return false;
      // Linux: "basic_text" = chave em claro; nunca aceitar como protecao
      const backend = typeof safeStorage.getSelectedStorageBackend === 'function' ? safeStorage.getSelectedStorageBackend() : null;
      return backend !== 'basic_text' && backend !== 'unknown';
    } catch {
      return false;
    }
  }

  function cleanupPending() {
    try {
      fs.unlinkSync(pendingPath);
    } catch {
      /* nao existe */
    }
  }

  /** @returns {{ stationId: string, publicKey: string, serverUrl: string, privateKey: crypto.KeyObject } | null} */
  function load() {
    try {
      const meta = JSON.parse(fs.readFileSync(identityPath, 'utf8'));
      if (meta?.version !== 1 || !meta.station_id || !meta.public_key || !meta.server_url) return null;
      // 1G.3.6: identidade sem pin valido ou com URL http (persistida/forjada) e inutilizavel -> falha fechada
      if (!String(meta.server_url).startsWith('https://') || !normalizeFingerprint(meta.server_fingerprint)) return null;
      if (!isSecureStorageAvailable()) return null;
      const privateB64 = safeStorage.decryptString(fs.readFileSync(keyPath));
      const privateKey = crypto.createPrivateKey({ key: Buffer.from(privateB64, 'base64'), format: 'der', type: 'pkcs8' });
      const derived = crypto.createPublicKey(privateKey).export({ type: 'spki', format: 'der' }).toString('base64url');
      if (derived !== meta.public_key) return null; // ficheiros trocados/corrompidos: nunca assina com chave que nao corresponde
      return {
        stationId: String(meta.station_id).toLowerCase(),
        publicKey: meta.public_key,
        serverUrl: meta.server_url,
        serverFingerprint: normalizeFingerprint(meta.server_fingerprint),
        privateKey,
      };
    } catch {
      return null; // copiado para outro perfil (decifra falha), corrompido ou ausente
    }
  }

  async function pair({ serverUrl, code, expectedFingerprint, machineId = null, fetchImpl = null }) {
    if (!isSecureStorageAvailable()) {
      throw new StationIdentityError('SECURE_STORAGE_UNAVAILABLE', 'Armazenamento seguro indisponível: não é possível guardar a identidade da Station.');
    }
    if (load()) throw new StationIdentityError('ALREADY_PAIRED', 'Esta Station já está emparelhada. Remova a identidade antes de emparelhar de novo.');
    const origin = normalizeServerOrigin(serverUrl);
    // a confianca no Server existe ANTES de enviar o codigo: fingerprint fornecida fora de banda pelo admin (sem TOFU)
    const pin = normalizeFingerprint(expectedFingerprint);
    if (!pin) throw new StationIdentityError('FINGERPRINT_REQUIRED', 'Fingerprint do certificado do servidor obrigatória para emparelhar.');
    const doFetch = fetchImpl ?? createPinnedFetch({ fingerprint: pin });
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
    const privateB64 = privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64');
    const publicB64 = publicKey.export({ type: 'spki', format: 'der' }).toString('base64url');

    // cifra e VERIFICA a leitura antes de gastar o pairing no Server
    fs.mkdirSync(userDataPath, { recursive: true });
    const encrypted = safeStorage.encryptString(privateB64);
    if (safeStorage.decryptString(encrypted) !== privateB64) {
      throw new StationIdentityError('SECURE_STORAGE_UNAVAILABLE', 'Armazenamento seguro inconsistente.');
    }
    fs.writeFileSync(pendingPath, encrypted);

    let res;
    let json = null;
    try {
      res = await doFetch(`${origin}/station/pair`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: String(code ?? '').trim(), public_key: publicB64, machine_id: machineId }),
      });
      json = await res.json().catch(() => null);
    } catch (err) {
      cleanupPending();
      // pin/certificado/downgrade/redirect: o codigo de pairing NAO chegou ao servidor (o pin valida antes de qualquer escrita)
      if (err?.code && /^(CERT_|HTTP_DOWNGRADE|REDIRECT_|INVALID_FINGERPRINT)/.test(err.code)) throw new StationIdentityError(err.code, err.message);
      throw new StationIdentityError('SERVER_UNREACHABLE', `Sem ligação ao servidor: ${err instanceof Error ? err.message : String(err)}`);
    }
    const data = json?.data ?? json;
    if (res.status !== 201 || !data?.station_id) {
      cleanupPending();
      throw new StationIdentityError('PAIRING_REJECTED', String(json?.error?.message ?? json?.message ?? 'Emparelhamento recusado.'), {
        status: res.status,
        serverCode: json?.error?.code ?? json?.code ?? null,
      });
    }
    try {
      fs.renameSync(pendingPath, keyPath); // 1) chave
      atomicWrite(
        identityPath,
        JSON.stringify(
          {
            version: 1,
            station_id: String(data.station_id).toLowerCase(),
            public_key: publicB64,
            server_url: origin,
            server_fingerprint: pin,
            station_code: data.code ?? null,
            name: data.name ?? null,
            role: data.role ?? null,
            paired_at: data.paired_at ?? new Date().toISOString(),
          },
          null,
          2
        )
      ); // 2) commit
    } catch (err) {
      cleanupPending();
      throw new StationIdentityError(
        'PERSIST_FAILED',
        `Emparelhada no servidor mas a identidade não foi guardada (${err instanceof Error ? err.message : err}). Revogue esta Station no servidor.`,
        { stationId: data.station_id }
      );
    }
    return { stationId: String(data.station_id).toLowerCase(), serverUrl: origin };
  }

  function status() {
    let meta = null;
    try {
      meta = JSON.parse(fs.readFileSync(identityPath, 'utf8'));
    } catch {
      /* sem identidade */
    }
    return {
      secureStorage: isSecureStorageAvailable(),
      paired: Boolean(meta?.station_id) && load() !== null,
      stationId: meta?.station_id ?? null,
      serverUrl: meta?.server_url ?? null,
      serverFingerprint: meta?.server_fingerprint ?? null,
      stationCode: meta?.station_code ?? null,
      name: meta?.name ?? null,
      role: meta?.role ?? null,
    };
  }

  function clear() {
    for (const f of [identityPath, keyPath, pendingPath]) {
      try {
        fs.unlinkSync(f);
      } catch {
        /* ja nao existe */
      }
    }
  }

  cleanupPending(); // pendentes orfaos de um crash a meio
  return { isSecureStorageAvailable, pair, load, status, clear };
}
