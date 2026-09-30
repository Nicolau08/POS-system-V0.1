/**
 * Etapa 1G.3.3 - authenticateStation: "qual terminal fisico enviou este pedido?" (Operator Auth, separada, responde
 * "qual utilizador opera?"). Assinatura Ed25519 por pedido, anti-replay por nonce persistido, sem Bearer de Station.
 *
 * Origem local: so o SOCKET conta (req.socket.remoteAddress). X-Forwarded-For / TRUST_PROXY / Host nunca podem
 * transformar um pedido remoto em loopback. O bypass loopback e explicito e marca req.stationOrigin = 'loopback'.
 *
 * Ordem de verificacao (nada e escrito antes de a assinatura validar, para nao permitir encher a BD sem credenciais):
 *   formato -> Station existe/active/com chave -> janela de tempo -> corpo bruto disponivel -> assinatura -> nonce (atomico) -> req.station.
 * O req.station vem SEMPRE da BD (code/name/role/store); nenhum header enviado define identidade, papel ou Store.
 */
import db from '../database.js';
import { isLoopbackIp } from '../utils/authSecret.js';
import { sendError } from '../utils/response.js';
import { logWarn } from '../utils/logger.js';
import { ensureStationTables } from '../services/station.service.js';
import {
  STATION_AUTH_VERSION,
  STATION_AUTH_WINDOW_SECONDS,
  STATION_HEADERS,
  buildCanonicalRequest,
  isValidNonce,
  isValidSignature,
  isValidStationId,
  splitRequestTarget,
  verifyStationSignature,
} from '../../lib/stationAuth/stationRequestSigning.js';

const NONCE_TTL_SLACK_SECONDS = 5;
const CLEANUP_INTERVAL_MS = 30 * 1000;
const LAST_SEEN_THROTTLE_MS = 60 * 1000;

// Unicos pedidos remotos sem Station: descoberta, pairing (o proprio meio de obter identidade) e readiness.
const PUBLIC_REMOTE = new Set(['GET /station/discover', 'POST /station/pair', 'GET /health', 'GET /']);

const runDb = (sql, params = []) =>
  new Promise((resolve, reject) => db.run(sql, params, function onRun(err) { return err ? reject(err) : resolve(this); }));
const getDb = (sql, params = []) =>
  new Promise((resolve, reject) => db.get(sql, params, (e, r) => (e ? reject(e) : resolve(r ?? null))));

/** IP do socket (nunca de cabecalhos). */
export function getSocketIp(req) {
  return String(req.socket?.remoteAddress ?? '').trim().replace(/^::ffff:/i, '');
}
export function isLoopbackSocket(req) {
  return isLoopbackIp(getSocketIp(req));
}

/** Operacoes de manutencao do Store Server: so a propria maquina (socket loopback), nunca uma Station remota. */
export function requireLoopbackOnly(req, res, next) {
  if (isLoopbackSocket(req)) return next();
  return sendError(res, 403, 'Operação só disponível no próprio Store Server.', 'LOCAL_ONLY_OPERATION');
}

/** Apaga nonces expirados. Chamado com throttle pelo middleware e directamente nos testes. */
export async function cleanupStationNonces(nowSeconds = Math.floor(Date.now() / 1000)) {
  await ensureStationTables();
  const r = await runDb(`DELETE FROM station_nonces WHERE expires_at < ?`, [nowSeconds]);
  return r.changes;
}

// logs de rejeicao com throttle (um atacante sem credenciais nao pode encher a tabela de logs)
const lastLog = new Map();
function logReject(reason, extra = {}) {
  const now = Date.now();
  if (now - (lastLog.get(reason) ?? 0) < 1000) return;
  lastLog.set(reason, now);
  logWarn('station_auth_rejected', { module: 'stationAuth', reason, ...extra });
}

const one = (v) => (Array.isArray(v) ? null : typeof v === 'string' ? v : null);

/**
 * @param {{ isLoopbackRequest?: (req) => boolean, now?: () => number }} [opts] injectaveis para testes
 */
export function createStationGate({ isLoopbackRequest = isLoopbackSocket, now = () => Date.now() } = {}) {
  let cleanupTimer = null;
  let lastCleanup = 0;

  const fail = (res, reason, extra) => {
    logReject(reason, extra);
    return sendError(res, 401, 'Autenticação da Station inválida.', 'STATION_AUTH_FAILED');
  };

  return async function stationGate(req, res, next) {
    try {
      if (req.method === 'OPTIONS') return next(); // preflight CORS: sem corpo nem credenciais
      if (isLoopbackRequest(req)) {
        req.stationOrigin = 'loopback';
        return next();
      }
      req.stationOrigin = 'remote';
      const { path } = splitRequestTarget(req.originalUrl ?? req.url);
      if (PUBLIC_REMOTE.has(`${req.method} ${path}`)) return next();

      const h = req.headers ?? {};
      const version = one(h[STATION_HEADERS.version]);
      const stationId = one(h[STATION_HEADERS.id]);
      const tsRaw = one(h[STATION_HEADERS.timestamp]);
      const nonce = one(h[STATION_HEADERS.nonce]);
      const signature = one(h[STATION_HEADERS.signature]);
      if (!version && !stationId && !signature) {
        logReject('missing_credentials');
        return sendError(res, 401, 'Este pedido exige a identidade da Station.', 'STATION_AUTH_REQUIRED');
      }
      if (version !== STATION_AUTH_VERSION) return fail(res, 'bad_version');
      if (!isValidStationId(stationId ?? '') || !isValidNonce(nonce ?? '') || !isValidSignature(signature ?? '') || !/^\d{1,12}$/.test(tsRaw ?? '')) {
        return fail(res, 'bad_format');
      }
      const id = stationId.toLowerCase();

      await ensureStationTables();
      const st = await getDb(
        `SELECT id, tenant_id, code, name, role, status, public_key, store_id, last_seen FROM stations WHERE id = ?`,
        [id]
      );
      // desconhecida, legada (sem chave), disabled ou revogada: falha ja no pedido seguinte, sem revelar qual
      if (!st || !st.public_key || st.status !== 'active') return fail(res, 'station_not_active', { station_id: id });

      const nowSec = Math.floor(now() / 1000);
      const ts = Number(tsRaw);
      if (Math.abs(nowSec - ts) > STATION_AUTH_WINDOW_SECONDS) {
        logReject('clock_skew', { station_id: id });
        return sendError(res, 401, 'Relógio da Station fora da janela permitida.', 'STATION_CLOCK_SKEW', { server_time: nowSec });
      }

      // corpo EXACTO recebido (express.json verify). Sem corpo bruto disponivel -> falha fechada (nunca hash de JSON reserializado)
      const declaresBody = Number(h['content-length'] ?? 0) > 0 || h['transfer-encoding'] !== undefined;
      let body = Buffer.alloc(0);
      if (declaresBody) {
        if (!Buffer.isBuffer(req.rawBody)) return sendError(res, 400, 'Corpo do pedido não suportado para assinatura.', 'STATION_BODY_UNSUPPORTED');
        body = req.rawBody;
      }
      const target = splitRequestTarget(req.originalUrl ?? req.url);
      let canonical;
      try {
        canonical = buildCanonicalRequest({
          stationId: id, timestamp: ts, nonce, method: req.method, path: target.path, query: target.query, body,
          authorization: typeof h.authorization === 'string' ? h.authorization : '',
        });
      } catch {
        return fail(res, 'bad_canonical', { station_id: id });
      }
      if (!verifyStationSignature({ publicKeySpkiB64: st.public_key, canonicalBytes: canonical, signature })) {
        return fail(res, 'bad_signature', { station_id: id });
      }

      // consumo atomico do nonce (PK station_id+nonce): de dois pedidos identicos so um insere
      try {
        await runDb(`INSERT INTO station_nonces (station_id, nonce, expires_at) VALUES (?, ?, ?)`, [id, nonce, ts + STATION_AUTH_WINDOW_SECONDS + NONCE_TTL_SLACK_SECONDS]);
      } catch (err) {
        if (/UNIQUE|constraint/i.test(String(err?.message ?? ''))) return fail(res, 'replay', { station_id: id });
        throw err;
      }

      req.station = { id: st.id, tenant_id: st.tenant_id, code: st.code, name: st.name, role: st.role, store_id: st.store_id ?? null };

      // last_seen so depois de autenticar, e no maximo 1x/minuto por Station
      const t = now();
      const lastSeenMs = st.last_seen ? Date.parse(st.last_seen) : 0;
      if (!Number.isFinite(lastSeenMs) || t - lastSeenMs >= LAST_SEEN_THROTTLE_MS) {
        runDb(`UPDATE stations SET last_seen = ? WHERE id = ?`, [new Date(t).toISOString(), st.id]).catch(() => {});
      }

      // limpeza de nonces expirados (throttled + temporizador leve): a tabela nunca cresce indefinidamente
      if (t - lastCleanup >= CLEANUP_INTERVAL_MS) {
        lastCleanup = t;
        cleanupStationNonces(nowSec).catch(() => {});
      }
      if (!cleanupTimer) {
        cleanupTimer = setInterval(() => cleanupStationNonces().catch(() => {}), 60 * 1000);
        cleanupTimer.unref?.();
      }
      return next();
    } catch (err) {
      logWarn('station_auth_error', { module: 'stationAuth', reason: 'Erro interno ao autenticar Station', error: err });
      return sendError(res, 500, 'Erro ao autenticar a Station.', 'STATION_AUTH_ERROR');
    }
  };
}

export const authenticateStation = createStationGate();
