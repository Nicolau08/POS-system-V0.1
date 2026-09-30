/**
 * Etapa 1G.3.6 - identidade TLS do Store Server no processo da API.
 * A chave privada so entra no processo por uma de duas vias EXPLICITAS:
 *  1) POS_TLS_CERT_PEM + POS_TLS_KEY_PEM injectadas pelo Electron main, que a guarda cifrada com safeStorage (DPAPI);
 *  2) POS_TLS_ALLOW_PLAINTEXT_DEV=1 (so desenvolvimento/testes): ficheiro em <userData>/tls com modo 0600 e aviso no log.
 * Sem nenhuma das duas NAO ha TLS -> a LAN nao arranca (falha fechada). Nunca ha fallback plaintext silencioso.
 * A chave nunca e devolvida por nenhuma API nem escrita em logs.
 */
import fs from 'fs';
import path from 'path';
import { certificateFingerprintHex, generateServerCertificate } from '../../lib/tls/serverCertificate.js';
import { logWarn } from './logger.js';

let cached = null;

export function resetServerTlsCache() {
  cached = null;
}

/** @returns {Promise<{ certPem: string, keyPem: string, fingerprint: string, source: 'electron-safeStorage' | 'dev-plaintext' } | null>} */
export async function loadServerTlsIdentity() {
  if (cached) return cached;
  const envCert = String(process.env.POS_TLS_CERT_PEM ?? '').trim();
  const envKey = String(process.env.POS_TLS_KEY_PEM ?? '').trim();
  if (envCert && envKey) {
    cached = { certPem: envCert, keyPem: envKey, fingerprint: certificateFingerprintHex(envCert), source: 'electron-safeStorage' };
    return cached;
  }
  // nunca em producao (o Electron empacotado forca NODE_ENV=production): a excepcao plaintext so existe em dev/testes
  if (String(process.env.POS_TLS_ALLOW_PLAINTEXT_DEV ?? '') === '1' && String(process.env.NODE_ENV ?? '').toLowerCase() !== 'production') {
    const dir = path.join(String(process.env.POS_USER_DATA_PATH ?? '').trim() || process.cwd(), 'tls');
    const certPath = path.join(dir, 'server-cert.pem');
    const keyPath = path.join(dir, 'server-key.pem');
    if (!fs.existsSync(certPath) || !fs.existsSync(keyPath)) {
      fs.mkdirSync(dir, { recursive: true });
      const gen = await generateServerCertificate();
      fs.writeFileSync(keyPath, gen.keyPem, { mode: 0o600 });
      fs.writeFileSync(certPath, gen.certPem);
    }
    logWarn('tls_dev_plaintext_key', { module: 'serverTls', reason: 'Chave TLS do Server em ficheiro SEM protecao (modo de desenvolvimento explicito)' });
    const certPem = fs.readFileSync(certPath, 'utf8');
    cached = { certPem, keyPem: fs.readFileSync(keyPath, 'utf8'), fingerprint: certificateFingerprintHex(certPem), source: 'dev-plaintext' };
    return cached;
  }
  return null;
}

/** Fingerprint (hex) do certificado em uso, ou null se o TLS nao esta activo. */
export function getServerTlsFingerprint() {
  return cached?.fingerprint ?? null;
}
