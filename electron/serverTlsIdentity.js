/**
 * Etapa 1G.3.6 - identidade TLS PERSISTENTE do Store Server (processo main do Electron).
 * Certificado (publico) em claro; chave privada SO cifrada com safeStorage (DPAPI). Sem armazenamento seguro devolve null
 * (a API nao abre a LAN): nunca ha fallback plaintext. Mesmo certificado entre reinicios => fingerprint estavel; so se
 * regenera se os ficheiros faltarem/nao corresponderem (ou explicitamente com resetServerTlsIdentity).
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { certificateFingerprintHex, generateServerCertificate } from '../lib/tls/serverCertificate.js';

const CERT_FILE = 'server-cert.pem';
const KEY_FILE = 'server-key.enc';

function secure(safeStorage) {
  try {
    if (!safeStorage || safeStorage.isEncryptionAvailable() !== true) return false;
    const b = typeof safeStorage.getSelectedStorageBackend === 'function' ? safeStorage.getSelectedStorageBackend() : null;
    return b !== 'basic_text' && b !== 'unknown';
  } catch {
    return false;
  }
}

function atomicWrite(file, content) {
  const tmp = `${file}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(tmp, content);
  fs.renameSync(tmp, file);
}

/** @returns {Promise<{ certPem: string, keyPem: string, fingerprint: string, created: boolean } | null>} */
export async function getOrCreateServerTlsIdentity({ userDataPath, safeStorage }) {
  if (!secure(safeStorage)) return null;
  const dir = path.join(userDataPath, 'tls');
  const certPath = path.join(dir, CERT_FILE);
  const keyPath = path.join(dir, KEY_FILE);
  try {
    const certPem = fs.readFileSync(certPath, 'utf8');
    const keyPem = safeStorage.decryptString(fs.readFileSync(keyPath));
    const certPub = new crypto.X509Certificate(certPem).publicKey.export({ type: 'spki', format: 'der' });
    const keyPub = crypto.createPublicKey(keyPem).export({ type: 'spki', format: 'der' });
    if (certPub.equals(keyPub)) return { certPem, keyPem, fingerprint: certificateFingerprintHex(certPem), created: false };
  } catch {
    /* ausente, ilegivel ou de outro perfil: gera nova identidade */
  }
  fs.mkdirSync(dir, { recursive: true });
  const gen = await generateServerCertificate();
  atomicWrite(keyPath, safeStorage.encryptString(gen.keyPem)); // chave primeiro, so cifrada
  atomicWrite(certPath, gen.certPem);
  return { certPem: gen.certPem, keyPem: gen.keyPem, fingerprint: gen.fingerprint, created: true };
}

/** Reset EXPLICITO (as Stations emparelhadas terao de repetir o pairing: a fingerprint muda). */
export function resetServerTlsIdentity(userDataPath) {
  for (const f of [CERT_FILE, KEY_FILE]) {
    try {
      fs.unlinkSync(path.join(userDataPath, 'tls', f));
    } catch {
      /* ja nao existe */
    }
  }
}
