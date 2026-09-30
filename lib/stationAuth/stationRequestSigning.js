/**
 * Etapa 1G.3.3 - Station Request Signing v1 (formato UNICO; usado pelo Server para verificar e por qualquer cliente para assinar).
 * Sem criptografia propria: Ed25519 nativo do Node sobre bytes deterministicos.
 *
 * Headers (nenhum e confiavel ate a assinatura validar):
 *   X-Station-Auth-Version: 1
 *   X-Station-Id:           UUID gerado pelo Server no pairing
 *   X-Station-Timestamp:    inteiro, segundos Unix UTC
 *   X-Station-Nonce:        base64url (>= 16 bytes aleatorios; 22..64 chars)
 *   X-Station-Signature:    base64url(Ed25519(private_key, canonical_bytes))
 *
 * Canonical string v1 (UTF-8, campos separados por "\n", SEM "\n" final):
 *   POSLY-STATION-REQ-V1
 *   <station_id>
 *   <timestamp>
 *   <nonce>
 *   <METHOD em maiusculas>
 *   <path>                 caminho EXACTO recebido (sem query, percent-encoding preservado, sem normalizar/decodificar)
 *   <query>                query string EXACTA recebida (sem "?"; vazia se nao existir). NAO se reordena nem decodifica: a ordem
 *                          de chaves repetidas (a=1&a=2) pode ser semantica, logo o que se assina e o que o servidor recebe.
 *   <sha256_hex(body)>     SHA-256 dos BYTES exactos do corpo transmitido (nunca de JSON reserializado); corpo vazio -> hash de ""
 *   <sha256_hex(Authorization)>  SHA-256 do valor exacto do header Authorization do operador ("" se ausente) - liga o pedido
 *                          ao Bearer do operador sem misturar as duas autenticacoes.
 */
import crypto from 'crypto';

export const STATION_AUTH_VERSION = '1';
export const STATION_AUTH_DOMAIN = 'POSLY-STATION-REQ-V1';
export const STATION_AUTH_WINDOW_SECONDS = 120;
export const STATION_HEADERS = Object.freeze({
  version: 'x-station-auth-version',
  id: 'x-station-id',
  timestamp: 'x-station-timestamp',
  nonce: 'x-station-nonce',
  signature: 'x-station-signature',
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NONCE_RE = /^[A-Za-z0-9_-]{22,64}$/;
const SIG_RE = /^[A-Za-z0-9_-]{86}$/; // Ed25519 = 64 bytes -> 86 chars base64url
const METHOD_RE = /^[A-Z]{3,10}$/;

const sha256Hex = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

export const isValidStationId = (v) => typeof v === 'string' && UUID_RE.test(v);
export const isValidNonce = (v) => typeof v === 'string' && NONCE_RE.test(v);
export const isValidSignature = (v) => typeof v === 'string' && SIG_RE.test(v);
export const generateNonce = () => crypto.randomBytes(18).toString('base64url');

/** Separa o alvo do pedido em path e query EXACTOS (a partir de req.originalUrl / URL do pedido). */
export function splitRequestTarget(target) {
  const raw = String(target ?? '');
  const i = raw.indexOf('?');
  return i === -1 ? { path: raw, query: '' } : { path: raw.slice(0, i), query: raw.slice(i + 1) };
}

/** @returns {Buffer} bytes canonicos (ou lanca se algum campo for ambiguo) */
export function buildCanonicalRequest({ stationId, timestamp, nonce, method, path, query = '', body = Buffer.alloc(0), authorization = '' }) {
  const ts = String(timestamp);
  const m = String(method ?? '').toUpperCase();
  if (!isValidStationId(String(stationId))) throw new Error('station_id invalido');
  if (!/^\d{1,12}$/.test(ts)) throw new Error('timestamp invalido');
  if (!isValidNonce(String(nonce))) throw new Error('nonce invalido');
  if (!METHOD_RE.test(m)) throw new Error('metodo invalido');
  const p = String(path ?? '');
  if (!p.startsWith('/') || /[\r\n]/.test(p)) throw new Error('path invalido');
  const q = String(query ?? '');
  if (/[\r\n]/.test(q)) throw new Error('query invalida');
  const bodyBytes = Buffer.isBuffer(body) ? body : Buffer.from(String(body ?? ''), 'utf8');
  const auth = String(authorization ?? '');
  if (/[\r\n]/.test(auth)) throw new Error('authorization invalido');
  return Buffer.from(
    [STATION_AUTH_DOMAIN, String(stationId).toLowerCase(), ts, nonce, m, p, q, sha256Hex(bodyBytes), sha256Hex(Buffer.from(auth, 'utf8'))].join('\n'),
    'utf8'
  );
}

/** Assina um pedido (lado da Station). `privateKey` = KeyObject ou PEM/DER pkcs8; nunca sai da Station. */
export function signStationRequest({ privateKey, stationId, method, target, body, authorization = '', timestamp = Math.floor(Date.now() / 1000), nonce = generateNonce() }) {
  const { path, query } = splitRequestTarget(target);
  const bytes = buildCanonicalRequest({ stationId, timestamp, nonce, method, path, query, body, authorization });
  const key = typeof privateKey === 'object' && privateKey?.type === 'private' ? privateKey : crypto.createPrivateKey(privateKey);
  const signature = crypto.sign(null, bytes, key).toString('base64url');
  return {
    'X-Station-Auth-Version': STATION_AUTH_VERSION,
    'X-Station-Id': String(stationId).toLowerCase(),
    'X-Station-Timestamp': String(timestamp),
    'X-Station-Nonce': nonce,
    'X-Station-Signature': signature,
  };
}

/** Verifica a assinatura (lado do Server) com a chave publica SPKI DER base64url guardada no pairing. */
export function verifyStationSignature({ publicKeySpkiB64, canonicalBytes, signature }) {
  try {
    const key = crypto.createPublicKey({ key: Buffer.from(publicKeySpkiB64, 'base64url'), format: 'der', type: 'spki' });
    if (key.asymmetricKeyType !== 'ed25519') return false;
    return crypto.verify(null, canonicalBytes, key, Buffer.from(signature, 'base64url'));
  } catch {
    return false;
  }
}
