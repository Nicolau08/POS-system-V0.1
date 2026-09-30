/**
 * Etapa 1G.3.4 - cliente HTTP assinado da Station (processo MAIN). Ponto UNICO por onde passam os pedidos Station->Server:
 * gera timestamp + nonce, monta o canonical request v1 com o helper PARTILHADO (lib/stationAuth), assina Ed25519 e envia os
 * headers da 1G.3.3. O corpo assinado e exactamente o Buffer transmitido. Relogio: em STATION_CLOCK_SKEW usa server_time para
 * um offset em memoria e repete UMA vez (novo nonce, nova assinatura); o relogio do Windows nunca e alterado.
 */
import { signStationRequest } from '../../lib/stationAuth/stationRequestSigning.js';
import { StationIdentityError } from './stationIdentity.js';
import { createPinnedFetch, probeUnpinned } from './pinnedHttps.js';

const stripStationHeaders = (headers) => {
  const out = {};
  for (const [k, v] of Object.entries(headers ?? {})) {
    if (!/^x-station-/i.test(k)) out[k] = v; // o chamador nunca escolhe identidade/etiqueta
  }
  return out;
};
const PUBLIC_UNSIGNED = new Set(['GET /station/discover', 'POST /station/pair', 'GET /health', 'GET /']);
const findHeader = (headers, name) => {
  const key = Object.keys(headers).find((k) => k.toLowerCase() === name);
  return key ? String(headers[key]) : '';
};

export function createStationClient({ identityStore, fetchImpl = null, now = () => Date.now(), allowedUnsignedOrigin = null }) {
  let offsetMs = 0;
  const pinnedByFp = new Map();
  const pinnedFor = (fp) => {
    if (fetchImpl) return fetchImpl; // injectavel em testes
    if (!pinnedByFp.has(fp)) pinnedByFp.set(fp, createPinnedFetch({ fingerprint: fp }));
    return pinnedByFp.get(fp);
  };

  async function send(u, method, headers, body, identity) {
    let outHeaders = headers;
    if (identity) {
      const sig = signStationRequest({
        privateKey: identity.privateKey,
        stationId: identity.stationId,
        method,
        target: u.pathname + u.search,
        body: body ?? Buffer.alloc(0),
        authorization: findHeader(headers, 'authorization'),
        timestamp: Math.floor((now() + offsetMs) / 1000),
      });
      outHeaders = { ...headers, ...sig };
    }
    const res = await pinnedFor(identity.serverFingerprint)(u.href, { method, headers: outHeaders, body: body && body.length ? body : undefined });
    const buf = Buffer.from(await res.arrayBuffer());
    return { status: res.status, headers: [...res.headers.entries()], body: buf };
  }

  async function request({ url, method = 'GET', headers = {}, body = null }) {
    const u = new URL(url);
    const m = String(method).toUpperCase();
    if (u.protocol !== 'https:') throw new StationIdentityError('HTTP_DOWNGRADE', 'HTTP recusado: só HTTPS com certificado fixado.');
    const identity = identityStore.load();
    if (identity && u.origin !== new URL(identity.serverUrl).origin) {
      throw new StationIdentityError('STATION_ORIGIN_MISMATCH', 'Pedido para um servidor diferente daquele a que a Station está emparelhada.');
    }
    if (!identity) {
      // sem identidade valida (nao emparelhada, safeStorage indisponivel, ficheiros invalidos): so descoberta/pairing/health
      const publicOnly = allowedUnsignedOrigin && u.origin === allowedUnsignedOrigin() && PUBLIC_UNSIGNED.has(`${m} ${u.pathname}`);
      if (!publicOnly || m !== 'GET') throw new StationIdentityError('STATION_NOT_PAIRED', 'Station sem identidade válida: pedido bloqueado (falha fechada).');
      // descoberta/health sem identidade: NAO confiavel, sem credenciais nem dados; le so o certificado apresentado
      const p = await probeUnpinned(u.href);
      return { status: p.status, headers: [['x-observed-cert-fingerprint', p.fingerprint ?? '']], body: Buffer.from(JSON.stringify(p.json ?? {})) };
    }
    const clean = stripStationHeaders(headers);
    const buf = body == null ? null : Buffer.isBuffer(body) ? body : Buffer.from(body);
    let res = await send(u, m, clean, buf, identity);
    if (identity && res.status === 401) {
      let parsed = null;
      try {
        parsed = JSON.parse(res.body.toString('utf8'));
      } catch {
        /* corpo nao JSON */
      }
      const code = parsed?.error?.code ?? parsed?.code;
      const serverTime = Number(parsed?.data?.server_time ?? parsed?.error?.data?.server_time);
      if (code === 'STATION_CLOCK_SKEW' && Number.isFinite(serverTime)) {
        offsetMs = serverTime * 1000 - now();
        res = await send(u, m, clean, buf, identity); // UMA repeticao: novo nonce + nova assinatura
      }
    }
    return res;
  }

  return { request, getOffsetMs: () => offsetMs };
}
