/**
 * Etapa 1G.3.6 - HTTPS com PIN da fingerprint do certificado do Server (Node `tls`/`https` padrao; sem protocolo proprio).
 *  - NUNCA se confia numa CA publica nem se aceita "qualquer certificado": rejectUnauthorized:false e usado SO para poder ler o
 *    certificado apresentado, que e comparado (tempo constante) com a fingerprint esperada ANTES de o socket ser entregue ao
 *    pedido — nenhum byte da aplicacao (codigo de pairing, PIN, Bearer, assinaturas) sai antes de o pin validar;
 *  - certificado expirado ou nao valido ainda -> recusado (sem auto-accept); fingerprint diferente -> recusado;
 *  - so https: (HTTP = downgrade recusado); redirects sao recusados (nunca se segue para outro host/origem).
 */
import crypto from 'crypto';
import https from 'https';
import net from 'net';
import tls from 'tls';
import { normalizeFingerprint } from '../../lib/tls/serverCertificate.js';

export class PinnedTlsError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'PinnedTlsError';
    this.code = code;
  }
}

function checkPeerCertificate(socket, expectedHex, now) {
  const peer = socket.getPeerCertificate(true);
  if (!peer?.raw) throw new PinnedTlsError('CERT_MISSING', 'O servidor não apresentou certificado.');
  const actual = crypto.createHash('sha256').update(peer.raw).digest();
  const expected = Buffer.from(expectedHex, 'hex');
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) {
    throw new PinnedTlsError('CERT_PIN_MISMATCH', 'Certificado do servidor diferente do emparelhado (possível servidor falso ou certificado substituído).');
  }
  const x509 = new crypto.X509Certificate(peer.raw);
  const t = now();
  if (t < Date.parse(x509.validFrom) || t > Date.parse(x509.validTo)) {
    throw new PinnedTlsError('CERT_EXPIRED', 'Certificado do servidor fora do prazo de validade: é preciso repetir o emparelhamento.');
  }
  return actual.toString('hex');
}

/** Agent que so entrega o socket depois de a fingerprint validar. */
export function createPinnedAgent({ fingerprint, now = Date.now }) {
  const pin = normalizeFingerprint(fingerprint);
  if (!pin) throw new PinnedTlsError('INVALID_FINGERPRINT', 'Fingerprint do servidor inválida.');
  const agent = new https.Agent({ keepAlive: false });
  agent.createConnection = (options, callback) => {
    const host = options.hostname || options.host;
    const socket = tls.connect({
      host,
      port: Number(options.port) || 443,
      servername: net.isIP(host) ? undefined : host,
      rejectUnauthorized: false, // so para ler o certificado; o pin abaixo e a unica decisao de confianca
      minVersion: 'TLSv1.2',
    });
    let done = false;
    const finish = (err) => {
      if (done) return;
      done = true;
      if (err) {
        socket.destroy();
        callback(err);
      } else callback(null, socket);
    };
    socket.once('secureConnect', () => {
      try {
        checkPeerCertificate(socket, pin, now);
      } catch (e) {
        return finish(e);
      }
      return finish(null);
    });
    socket.once('error', (e) => finish(e));
    return undefined;
  };
  return agent;
}

function toFetchLike(res, chunks) {
  const body = Buffer.concat(chunks);
  const headers = Object.entries(res.headers).map(([k, v]) => [k, Array.isArray(v) ? v.join(', ') : String(v)]);
  return {
    status: res.statusCode ?? 0,
    ok: (res.statusCode ?? 0) >= 200 && (res.statusCode ?? 0) < 300,
    text: async () => body.toString('utf8'),
    headers: { entries: () => headers[Symbol.iterator]() },
    arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
    json: async () => JSON.parse(body.toString('utf8')),
  };
}

function requestOnce(url, { method, headers, body, agent, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request(
      { protocol: 'https:', hostname: u.hostname, port: u.port || 443, path: u.pathname + u.search, method, headers, agent },
      (res) => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode ?? 0)) {
          res.resume();
          req.destroy();
          return reject(new PinnedTlsError('REDIRECT_REJECTED', 'Redirect recusado (nunca se segue para outra origem).'));
        }
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve(toFetchLike(res, chunks)));
        res.on('error', reject);
      }
    );
    req.setTimeout(timeoutMs, () => req.destroy(new PinnedTlsError('TIMEOUT', 'Tempo esgotado a contactar o servidor.')));
    req.on('error', reject);
    if (body && body.length) req.write(body);
    req.end();
  });
}

/** fetch-like com pin: `createPinnedFetch({ fingerprint })(url, { method, headers, body })`. Apenas https. */
export function createPinnedFetch({ fingerprint, now = Date.now, timeoutMs = 30_000 }) {
  const agent = createPinnedAgent({ fingerprint, now });
  return async (url, init = {}) => {
    const u = new URL(url);
    if (u.protocol !== 'https:') throw new PinnedTlsError('HTTP_DOWNGRADE', 'HTTP recusado: a Station só fala com o servidor por HTTPS com certificado fixado.');
    const body = init.body == null ? null : Buffer.isBuffer(init.body) ? init.body : Buffer.from(init.body);
    return requestOnce(url, { method: String(init.method ?? 'GET').toUpperCase(), headers: init.headers ?? {}, body, agent, timeoutMs });
  };
}

/**
 * Descoberta (NAO confiavel): GET sem credenciais nem dados; le o certificado apresentado so para o admin poder comparar a
 * fingerprint. Nunca decide confianca, nunca envia pairing code/PIN/Bearer e nunca altera a fingerprint persistida.
 * @returns {Promise<{ status: number, json: any, fingerprint: string }>}
 */
export function probeUnpinned(url, { timeoutMs = 1500 } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    if (u.protocol !== 'https:') return reject(new PinnedTlsError('HTTP_DOWNGRADE', 'HTTP recusado.'));
    let fingerprint = null;
    const agent = new https.Agent({ keepAlive: false });
    agent.createConnection = (options, callback) => {
      const s = tls.connect({ host: options.hostname || options.host, port: Number(options.port) || 443, rejectUnauthorized: false, minVersion: 'TLSv1.2' });
      s.once('secureConnect', () => {
        const raw = s.getPeerCertificate(true)?.raw;
        fingerprint = raw ? crypto.createHash('sha256').update(raw).digest('hex') : null;
        callback(null, s);
      });
      s.once('error', (e) => callback(e));
      return undefined;
    };
    const req = https.request({ hostname: u.hostname, port: u.port || 443, path: u.pathname + u.search, method: 'GET', agent }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        let json = null;
        try {
          json = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        } catch {
          /* nao JSON */
        }
        resolve({ status: res.statusCode ?? 0, json, fingerprint });
      });
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end();
  });
}
