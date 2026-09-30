/**
 * Etapa 1G.3.2 - Station Pairing no Store Server (100% offline; sem cloud, sem service_role).
 *
 * Identidade da Station = station_id (UUID gerado AQUI) + chave publica Ed25519 (a privada nunca sai da Station).
 * machine_id e apenas metadata. X-Station-Code nao e prova de identidade.
 *
 * Garantias sem transaccoes multi-statement (a ligacao SQLite e partilhada, por isso cada passo critico e UMA
 * instrucao atomica):
 *  - uso unico: UPDATE compare-and-set em station_pairings (used_at IS NULL ...) — so um pedido "queima" o pairing;
 *  - limite de Stations: INSERT ... SELECT ... WHERE (contagem de activas) < max, numa unica instrucao — dois
 *    pairings a disputar o ultimo slot dao exactamente 1 Station;
 *  - chave publica unica entre activas: indice unico parcial (uq_stations_active_pubkey);
 *  - se o INSERT falhar (limite / chave duplicada) o pairing e "des-queimado" (CAS inverso); se o processo morrer
 *    a meio, o pairing fica queimado sem Station (falha segura: o admin gera outro).
 * O codigo (8 digitos) nunca e guardado nem registado em claro: so scrypt com salt por pairing.
 */
import crypto from 'crypto';
import { promisify } from 'util';
import db, { getOrCreateDefaultTenantId } from '../database.js';
import { HttpError } from '../utils/response.js';
import { logAudit } from '../utils/logger.js';
import { ensureStationTables } from './station.service.js';
import { getStationEntitlement } from './stationEntitlement.service.js';
import { canPairAnotherStation, STATION_ENTITLEMENT_REASON } from '../../lib/licensing/stationEntitlement.js';
import { formatFingerprint, shortFingerprint } from '../../lib/tls/serverCertificate.js';
import { getServerTlsFingerprint } from '../utils/serverTls.js';

const scrypt = promisify(crypto.scrypt);

export const PAIRING_TTL_MS = 10 * 60 * 1000;
export const PAIRING_MAX_ATTEMPTS = 5;
const MAX_ACTIVE_PAIRINGS = 5;
const ROLES = new Set(['caixa', 'garcom', 'consulta', 'cozinha']);
const NO_LIMIT = 1_000_000_000;

const runDb = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) return reject(err);
      resolve(this);
    });
  });
const getDb = (sql, params = []) =>
  new Promise((resolve, reject) => db.get(sql, params, (e, r) => (e ? reject(e) : resolve(r ?? null))));
const allDb = (sql, params = []) =>
  new Promise((resolve, reject) => db.all(sql, params, (e, r) => (e ? reject(e) : resolve(r ?? []))));

const text = (v) => String(v ?? '').trim();
const nowIso = () => new Date().toISOString();

// --- rate limit por IP (em memoria; tentativas de pairing sao raras e curtas) ---
const RL_WINDOW_MS = 10 * 60 * 1000;
const RL_PER_IP = 10;
const RL_GLOBAL = 60;
const hits = new Map();
let globalHits = [];
export function resetPairingRateLimit() {
  hits.clear();
  globalHits = [];
}
function rateLimitOrThrow(ip) {
  const now = Date.now();
  const key = text(ip) || 'unknown';
  const list = (hits.get(key) ?? []).filter((t) => now - t < RL_WINDOW_MS);
  globalHits = globalHits.filter((t) => now - t < RL_WINDOW_MS);
  if (list.length >= RL_PER_IP || globalHits.length >= RL_GLOBAL) {
    throw new HttpError(429, 'Demasiadas tentativas de emparelhamento. Tente mais tarde.', 'PAIRING_RATE_LIMITED');
  }
  list.push(now);
  globalHits.push(now);
  hits.set(key, list);
}

// --- chave publica Ed25519: SPKI DER (base64/base64url) ou PEM; nunca aceita material privado ---
export function normalizeEd25519PublicKey(input) {
  const raw = text(input);
  if (!raw || raw.length > 4096) throw new HttpError(400, 'Chave pública inválida.', 'INVALID_PUBLIC_KEY');
  if (/PRIVATE/i.test(raw)) throw new HttpError(400, 'Chave privada recusada: envie apenas a chave pública.', 'INVALID_PUBLIC_KEY');
  try {
    const key = raw.includes('BEGIN')
      ? crypto.createPublicKey(raw)
      : crypto.createPublicKey({ key: Buffer.from(raw, 'base64url'), format: 'der', type: 'spki' });
    if (key.asymmetricKeyType !== 'ed25519') throw new Error('not ed25519');
    return key.export({ type: 'spki', format: 'der' }).toString('base64url');
  } catch {
    throw new HttpError(400, 'Chave pública Ed25519 inválida.', 'INVALID_PUBLIC_KEY');
  }
}

async function hashCode(code, saltHex) {
  const derived = await scrypt(String(code), Buffer.from(saltHex, 'hex'), 32);
  return derived.toString('hex');
}

async function resolveTenantId(actorUser) {
  return text(actorUser?.tenant_id) || (await getOrCreateDefaultTenantId());
}

async function countActiveIdentities(tenantId) {
  const row = await getDb(`SELECT COUNT(*) AS n FROM stations WHERE tenant_id = ? AND status = 'active' AND public_key IS NOT NULL`, [tenantId]);
  return Number(row?.n ?? 0);
}

function entitlementOrThrow(entitlement, activeCount) {
  const verdict = canPairAnotherStation(entitlement, activeCount);
  if (verdict.allowed) return;
  const msg = {
    [STATION_ENTITLEMENT_REASON.LICENSE_V1_NO_STATION_ENTITLEMENT]: 'A licença actual não inclui Stations. Reemita/renove a licença para a versão 2.',
    [STATION_ENTITLEMENT_REASON.STATION_LIMIT_ZERO]: 'A licença não permite Stations.',
    [STATION_ENTITLEMENT_REASON.STATION_LIMIT_REACHED]: 'Limite de Stations da licença atingido.',
    [STATION_ENTITLEMENT_REASON.LICENSE_INVALID]: 'Licença offline inválida, expirada ou de outra máquina.',
  }[verdict.reason] ?? 'Emparelhamento não autorizado.';
  throw new HttpError(403, msg, verdict.reason);
}

/** Admin: cria um pairing (codigo de 8 digitos, TTL 10 min, uso unico, 5 tentativas). O codigo so e devolvido aqui. */
export async function createPairing({ name, role, actorUser = null, entitlementProvider = getStationEntitlement } = {}) {
  await ensureStationTables();
  const tenantId = await resolveTenantId(actorUser);
  const stationName = text(name);
  const stationRole = text(role).toLowerCase() || 'caixa';
  if (stationName.length < 2 || stationName.length > 60) throw new HttpError(400, 'Nome do posto inválido.');
  if (!ROLES.has(stationRole)) throw new HttpError(400, 'Papel do posto inválido.');

  // revalida a licenca offline v2 (assinatura/maquina/expiracao) ANTES de criar
  entitlementOrThrow(entitlementProvider(), await countActiveIdentities(tenantId));

  const now = nowIso();
  await runDb(`DELETE FROM station_pairings WHERE expires_at < ?`, [new Date(Date.now() - 24 * 3600 * 1000).toISOString()]);
  const open = await getDb(
    `SELECT COUNT(*) AS n FROM station_pairings WHERE tenant_id = ? AND used_at IS NULL AND expires_at > ? AND attempts < max_attempts`,
    [tenantId, now]
  );
  if (Number(open?.n ?? 0) >= MAX_ACTIVE_PAIRINGS) {
    throw new HttpError(429, 'Demasiados emparelhamentos abertos. Aguarde a expiração ou use os existentes.', 'TOO_MANY_OPEN_PAIRINGS');
  }

  const code = String(crypto.randomInt(0, 100_000_000)).padStart(8, '0');
  const salt = crypto.randomBytes(16).toString('hex');
  const id = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + PAIRING_TTL_MS).toISOString();
  await runDb(
    `INSERT INTO station_pairings (id, tenant_id, code_hash, station_name, station_role, expires_at, attempts, max_attempts, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
    [id, tenantId, `${salt}:${await hashCode(code, salt)}`, stationName, stationRole, expiresAt, PAIRING_MAX_ATTEMPTS, actorUser?.id ? String(actorUser.id) : null, now]
  );
  await logAudit('STATION_PAIRING_CREATED', actorUser, { entity: 'station_pairing', entity_id: id, description: `Pairing criado para "${stationName}"` });
  // Confianca no Server: a fingerprint do certificado TLS chega a Station FORA DE BANDA (admin -> Station), junto do codigo.
  // O token junta as duas coisas para nao haver 64 hex para escrever; a Station verifica-a ANTES de enviar o codigo.
  const fp = getServerTlsFingerprint();
  return {
    pairing_id: id,
    code,
    expires_at: expiresAt,
    station_name: stationName,
    station_role: stationRole,
    certificate_fingerprint: fp ? formatFingerprint(fp) : null,
    short_fingerprint: fp ? shortFingerprint(fp) : null,
    pairing_token: fp ? `POSLY-PAIR-1.${code}.${Buffer.from(fp, 'hex').toString('base64url')}` : null,
  };
}

function slugify(name) {
  return text(name).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'posto';
}

/** Publico (so pairing): consome o codigo e cria a Station. Ver o cabecalho para as garantias de atomicidade. */
export async function consumePairing({ code, publicKey, machineId = null, ip = '', entitlementProvider = getStationEntitlement } = {}) {
  await ensureStationTables();
  rateLimitOrThrow(ip);

  const codeText = text(code);
  if (!/^\d{8}$/.test(codeText)) throw new HttpError(400, 'Código de emparelhamento inválido.', 'INVALID_PAIRING_CODE_FORMAT');
  const normalizedKey = normalizeEd25519PublicKey(publicKey);
  const machine = text(machineId).slice(0, 128) || null; // so metadata

  const entitlement = entitlementProvider();
  const tenantIdFallback = await getOrCreateDefaultTenantId();

  // candidatos: nao usados, nao expirados, com tentativas por gastar. Compara SEMPRE com todos (tempo constante por candidato).
  const now = nowIso();
  const candidates = await allDb(
    `SELECT * FROM station_pairings WHERE used_at IS NULL AND expires_at > ? AND attempts < max_attempts`,
    [now]
  );
  let match = null;
  for (const c of candidates) {
    const [salt, expected] = String(c.code_hash).split(':');
    const got = Buffer.from(await hashCode(codeText, salt), 'hex');
    const want = Buffer.from(expected, 'hex');
    if (got.length === want.length && crypto.timingSafeEqual(got, want) && !match) match = c;
  }
  const generic = () => new HttpError(401, 'Código inválido ou expirado.', 'INVALID_PAIRING');
  if (!match) {
    // um palpite errado gasta uma tentativa de TODOS os pairings abertos (o palpite nao identifica qual visava)
    await runDb(`UPDATE station_pairings SET attempts = attempts + 1 WHERE used_at IS NULL AND expires_at > ? AND attempts < max_attempts`, [nowIso()]);
    throw generic();
  }

  // revalida a licenca e o limite (a licenca pode ter expirado/mudado desde a criacao do pairing)
  entitlementOrThrow(entitlement, await countActiveIdentities(match.tenant_id ?? tenantIdFallback));

  // 1) queimar (CAS): so um pedido concorrente passa
  const burnedAt = nowIso();
  const burn = await runDb(
    `UPDATE station_pairings SET used_at = ? WHERE id = ? AND used_at IS NULL AND expires_at > ? AND attempts < max_attempts`,
    [burnedAt, match.id, burnedAt]
  );
  if (burn.changes !== 1) throw generic();

  const unburn = () => runDb(`UPDATE station_pairings SET used_at = NULL WHERE id = ? AND used_at = ?`, [match.id, burnedAt]);
  const max = entitlement.unlimited ? NO_LIMIT : entitlement.max;
  const stationId = crypto.randomUUID(); // nunca vem da Station
  const baseCode = slugify(match.station_name);
  try {
    for (let i = 0; i < 20; i += 1) {
      const stationCode = i === 0 ? baseCode : `${baseCode}-${i + 1}`;
      try {
        // 2) criar respeitando o limite NUMA so instrucao atomica
        const ins = await runDb(
          `INSERT INTO stations (id, tenant_id, code, name, role, active, status, public_key, machine_id, store_id, paired_at, created_at, updated_at)
           SELECT ?, ?, ?, ?, ?, 1, 'active', ?, ?, ?, ?, ?, ?
           WHERE (SELECT COUNT(*) FROM stations WHERE tenant_id = ? AND status = 'active' AND public_key IS NOT NULL) < ?`,
          [stationId, match.tenant_id, stationCode, match.station_name, match.station_role, normalizedKey, machine, entitlement.storeId ?? null,
           burnedAt, burnedAt, burnedAt, match.tenant_id, max]
        );
        if (ins.changes !== 1) {
          await unburn();
          throw new HttpError(403, 'Limite de Stations da licença atingido.', STATION_ENTITLEMENT_REASON.STATION_LIMIT_REACHED);
        }
        await logAudit('STATION_PAIRED', null, { entity: 'station', entity_id: stationId, description: `Station "${match.station_name}" emparelhada` });
        return { station_id: stationId, code: stationCode, name: match.station_name, role: match.station_role, paired_at: burnedAt };
      } catch (err) {
        if (err instanceof HttpError) throw err;
        const msg = String(err?.message ?? '');
        if (/stations\.public_key|uq_stations_(active_)?pubkey/i.test(msg)) {
          await unburn();
          const prior = await getDb(`SELECT status FROM stations WHERE public_key = ?`, [normalizedKey]);
          if (prior && prior.status !== 'active') {
            throw new HttpError(409, 'Esta chave pública pertence a uma Station desactivada ou revogada; gere uma nova identidade.', 'PUBLIC_KEY_RETIRED');
          }
          throw new HttpError(409, 'Esta chave pública já identifica outra Station activa.', 'PUBLIC_KEY_IN_USE');
        }
        if (/UNIQUE/i.test(msg) && /stations\.(tenant_id|code)/i.test(msg)) continue; // code ocupado -> sufixo
        await unburn();
        throw err;
      }
    }
    await unburn();
    throw new HttpError(409, 'Não foi possível atribuir um código ao posto.', 'STATION_CODE_UNAVAILABLE');
  } finally {
    // sem estado a limpar: os passos criticos sao instrucoes atomicas
  }
}

/** Admin: active <-> disabled <-> revoked. So 'active' conta para o limite; reactivar respeita o limite (atomico). */
export async function setStationStatus(stationId, status, { actorUser = null, entitlementProvider = getStationEntitlement } = {}) {
  await ensureStationTables();
  const tenantId = await resolveTenantId(actorUser);
  const target = text(status).toLowerCase();
  if (!['active', 'disabled', 'revoked'].includes(target)) throw new HttpError(400, 'Estado inválido.');
  const st = await getDb(`SELECT id, status, public_key FROM stations WHERE id = ? AND tenant_id = ?`, [text(stationId), tenantId]);
  if (!st) throw new HttpError(404, 'Station não encontrada.');
  if (!st.public_key) throw new HttpError(409, 'Registo legado sem identidade: só é possível emparelhar de novo.', 'LEGACY_STATION_NO_IDENTITY');
  if (st.status === 'revoked') throw new HttpError(409, 'Station revogada é definitiva.', 'STATION_REVOKED');
  if (target === 'active' && st.status !== 'active') {
    const ent = entitlementProvider();
    entitlementOrThrow(ent, await countActiveIdentities(tenantId));
    const max = ent.unlimited ? NO_LIMIT : ent.max;
    const r = await runDb(
      `UPDATE stations SET status = 'active', updated_at = ?
       WHERE id = ? AND tenant_id = ? AND status = 'disabled'
         AND (SELECT COUNT(*) FROM stations WHERE tenant_id = ? AND status = 'active' AND public_key IS NOT NULL) < ?`,
      [nowIso(), st.id, tenantId, tenantId, max]
    );
    if (r.changes !== 1) throw new HttpError(403, 'Limite de Stations da licença atingido.', STATION_ENTITLEMENT_REASON.STATION_LIMIT_REACHED);
  } else {
    await runDb(`UPDATE stations SET status = ?, updated_at = ? WHERE id = ? AND tenant_id = ?`, [target, nowIso(), st.id, tenantId]);
  }
  await logAudit('STATION_STATUS_CHANGED', actorUser, { entity: 'station', entity_id: st.id, description: `Station -> ${target}` });
  return { id: st.id, status: target };
}
