/**
 * Etapa 1G.3.6 - identidade TLS do Store Server: certificado auto-assinado EC P-256 (sem CA publica) e a sua fingerprint
 * SHA-256. A confianca NAO vem do certificado em si mas do PIN da fingerprint (ver electron/station/pinnedHttps.js).
 * Geracao delegada a biblioteca `selfsigned` (X.509 nao e coisa para escrever a mao); nenhum protocolo criptografico proprio.
 */
import crypto from 'crypto';
import selfsigned from 'selfsigned';

export const SERVER_CERT_VALIDITY_DAYS = 5 * 365;

/** SHA-256 do DER do certificado, hex minusculo (64 chars). Aceita PEM, DER (Buffer) ou X509Certificate. */
export function certificateFingerprintHex(cert) {
  const x509 = cert instanceof crypto.X509Certificate ? cert : new crypto.X509Certificate(cert);
  return crypto.createHash('sha256').update(x509.raw).digest('hex');
}

/** "AB:CD:..." para mostrar ao admin; normalizeFingerprint() aceita qualquer formato razoavel. */
export function formatFingerprint(hex) {
  return String(hex).toUpperCase().match(/.{2}/g).join(':');
}
export function shortFingerprint(hex) {
  return String(hex).toUpperCase().slice(0, 12).match(/.{4}/g).join('-');
}

/** @returns {string | null} 64 hex minusculos, ou null se nao for uma fingerprint SHA-256 valida */
export function normalizeFingerprint(input) {
  const s = String(input ?? '').replace(/[\s:-]/g, '').toLowerCase();
  return /^[0-9a-f]{64}$/.test(s) ? s : null;
}

/** @returns {Promise<{ certPem: string, keyPem: string, fingerprint: string }>} */
export async function generateServerCertificate({ commonName = 'posly-store-server', now = new Date(), validityDays = SERVER_CERT_VALIDITY_DAYS } = {}) {
  const notAfterDate = new Date(now.getTime() + validityDays * 24 * 3600 * 1000);
  const pems = await selfsigned.generate([{ name: 'commonName', value: commonName }], {
    keyType: 'ec',
    curve: 'P-256',
    algorithm: 'sha256',
    notBeforeDate: new Date(now.getTime() - 5 * 60 * 1000),
    notAfterDate,
    extensions: [
      { name: 'basicConstraints', cA: false },
      { name: 'keyUsage', digitalSignature: true },
      { name: 'extKeyUsage', serverAuth: true },
    ],
  });
  return { certPem: pems.cert, keyPem: pems.private, fingerprint: certificateFingerprintHex(pems.cert) };
}
