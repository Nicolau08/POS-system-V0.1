/**
 * Logger estruturado do POSly.
 *
 * Cada entrada responde a: O QUÊ (event + message), QUANDO (timestamp),
 * ONDE (source/module/action), PORQUÊ (reason) + contexto (quem, tenant, ids).
 *
 * Variáveis de ambiente:
 *   POS_LOG_LEVEL=debug|info|warn|error   (consola; default: info em dev, warn em prod)
 *   POS_LOG_PERSIST=0|1                   (gravar em SQLite app_logs; default: 1)
 *   POS_LOG_RETENTION_DAYS=30             (limpeza automática; default: 30)
 */
import crypto from 'crypto';
import db from '../database.js';

const LEVEL_RANK = { debug: 10, info: 20, warn: 30, error: 40 };

const REDACT_KEYS = new Set([
  'authorization',
  'password',
  'pin',
  'token',
  'license_key',
  'supabase_service_role_key',
  'cookie',
  'secret',
  'api_key',
  'apikey',
]);

function envFlag(name, defaultValue = false) {
  const raw = process.env[name];
  if (raw == null || raw === '') return defaultValue;
  return !['0', 'false', 'no', 'off'].includes(String(raw).trim().toLowerCase());
}

function resolveConsoleLevel() {
  const raw = String(process.env.POS_LOG_LEVEL ?? '').trim().toLowerCase();
  if (raw && LEVEL_RANK[raw] != null) return raw;
  const isProd = String(process.env.NODE_ENV ?? 'development').toLowerCase() === 'production';
  return isProd ? 'warn' : 'info';
}

const CONSOLE_LEVEL = resolveConsoleLevel();
const PERSIST_ENABLED = envFlag('POS_LOG_PERSIST', true);
const RETENTION_DAYS = Math.max(1, Number(process.env.POS_LOG_RETENTION_DAYS ?? 30) || 30);

let lastPruneAt = 0;

const normalizeMeta = (meta) => {
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return { meta };
  return meta;
};

const normalizeUser = (user) => {
  if (!user || typeof user !== 'object') return null;
  const id = user.id == null ? null : String(user.id).trim() || null;
  const name = user.name == null ? null : String(user.name).trim() || null;
  const role = user.role == null ? null : String(user.role).trim() || null;
  if (!id && !name && !role) return null;
  return { id, name, role };
};

const stringifySafe = (value) => {
  try {
    return JSON.stringify(value);
  } catch {
    return JSON.stringify({ warning: 'unserializable_details' });
  }
};

const redact = (value, depth = 0) => {
  if (depth > 8) return '[MAX_DEPTH]';
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack ? String(value.stack).split('\n').slice(0, 12).join('\n') : undefined,
      code: value.code,
    };
  }
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));
  if (!value || typeof value !== 'object') return value;

  const out = {};
  for (const [key, raw] of Object.entries(value)) {
    if (REDACT_KEYS.has(String(key).toLowerCase())) {
      out[key] = '[REDACTED]';
      continue;
    }
    out[key] = redact(raw, depth + 1);
  }
  return out;
};

function shouldConsole(level) {
  return (LEVEL_RANK[level] ?? 99) >= (LEVEL_RANK[CONSOLE_LEVEL] ?? 20);
}

function shouldPersist(level, metaPersist) {
  if (metaPersist === false) return false;
  if (!PERSIST_ENABLED) return false;
  // debug não vai para BD (ruído); info+ sim (útil em produção)
  return (LEVEL_RANK[level] ?? 99) >= LEVEL_RANK.info;
}

function buildEntry(level, eventOrMessage, meta = {}) {
  const raw = normalizeMeta(meta);
  const event =
    raw.event != null
      ? String(raw.event)
      : String(eventOrMessage ?? 'event')
          .trim()
          .replace(/\s+/g, '_')
          .slice(0, 120) || 'event';

  const message =
    raw.message != null
      ? String(raw.message)
      : String(eventOrMessage ?? event);

  const where = {
    source: raw.source ?? raw.where?.source ?? 'api',
    module: raw.module ?? raw.where?.module ?? null,
    action: raw.action ?? raw.where?.action ?? null,
    ...(raw.where && typeof raw.where === 'object' ? raw.where : {}),
  };

  const who = normalizeUser(raw.who ?? raw.user ?? null);

  const {
    event: _e,
    message: _m,
    source: _s,
    module: _mod,
    action: _a,
    where: _w,
    who: _who,
    user: _u,
    reason: _r,
    why: _why,
    error: _err,
    persist: persistFlag,
    ...contextRest
  } = raw;

  const reason = raw.reason ?? raw.why ?? null;
  const error = raw.error != null ? redact(raw.error) : null;

  return {
    id: crypto.randomUUID(),
    level,
    event,
    message,
    timestamp: new Date().toISOString(),
    where,
    why: reason == null ? null : String(reason),
    who,
    context: redact(contextRest),
    error,
    persist: persistFlag,
  };
}

function emitConsole(entry) {
  if (!shouldConsole(entry.level)) return;
  const sink =
    entry.level === 'error'
      ? console.error
      : entry.level === 'warn'
        ? console.warn
        : console.log;

  // Linha legível + JSON completo na mesma linha (fácil de grep / ingestão)
  const human = `[${entry.timestamp}] ${entry.level.toUpperCase()} ${entry.event} — ${entry.message}`;
  sink(human);
  sink(stringifySafe(entry));
}

function pruneOldLogsIfNeeded() {
  const now = Date.now();
  if (now - lastPruneAt < 60 * 60 * 1000) return;
  lastPruneAt = now;
  const cutoff = new Date(now - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  try {
    db.run(`DELETE FROM app_logs WHERE created_at < ?`, [cutoff], () => {});
  } catch {
    // tabela pode ainda não existir no boot
  }
}

function persistEntry(entry) {
  if (!shouldPersist(entry.level, entry.persist)) return;
  pruneOldLogsIfNeeded();

  const payload = stringifySafe({
    where: entry.where,
    why: entry.why,
    who: entry.who,
    context: entry.context,
    error: entry.error,
  });

  try {
    db.run(
      `INSERT INTO app_logs (
         id, level, event, message, source, module, action, reason,
         user_id, user_name, tenant_id, request_id, entity, entity_id,
         payload_json, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        entry.id,
        entry.level,
        entry.event,
        entry.message,
        entry.where?.source ?? 'api',
        entry.where?.module ?? null,
        entry.where?.action ?? null,
        entry.why,
        entry.who?.id ?? null,
        entry.who?.name ?? null,
        entry.context?.tenant_id ?? entry.context?.tenantId ?? null,
        entry.context?.request_id ?? entry.context?.requestId ?? null,
        entry.context?.entity ?? null,
        entry.context?.entity_id ?? entry.context?.entityId ?? null,
        payload,
        entry.timestamp,
      ],
      () => {},
    );
  } catch {
    // nunca quebrar o fluxo de negócio por causa de log
  }
}

function emit(level, eventOrMessage, meta = {}) {
  try {
    const entry = buildEntry(level, eventOrMessage, meta);
    emitConsole(entry);
    persistEntry(entry);
    return entry;
  } catch {
    return null;
  }
}

/** Evento estruturado completo (preferido). */
export function logEvent(level, event, message, meta = {}) {
  return emit(level, event, { ...normalizeMeta(meta), event, message });
}

export function logDebug(message, meta = {}) {
  return emit('debug', message, meta);
}

export function logInfo(message, meta = {}) {
  return emit('info', message, meta);
}

export function logWarn(message, meta = {}) {
  return emit('warn', message, meta);
}

export function logError(message, meta = {}) {
  const raw = normalizeMeta(meta);
  if (raw.error == null && raw.err != null) {
    raw.error = raw.err;
    delete raw.err;
  }
  return emit('error', message, raw);
}

/**
 * Auditoria de negócio (imutável) em `audit_logs` + espelho em app_logs.
 */
export async function logAudit(action, user, details = {}) {
  const safeDetails = details && typeof details === 'object' ? redact(details) : { value: details };
  const safeUser = normalizeUser(user);
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const entity = safeDetails.entity == null ? null : String(safeDetails.entity);
  const entityId = safeDetails.entity_id ?? safeDetails.entityId ?? null;
  const entityIdNormalized = entityId == null ? null : String(entityId);
  const description =
    safeDetails.description != null
      ? String(safeDetails.description)
      : `Acção de auditoria: ${String(action ?? 'UNKNOWN_ACTION')}`;

  try {
    await new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO audit_logs (id, user_id, action, entity, entity_id, details, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          safeUser?.id ?? null,
          String(action ?? 'UNKNOWN_ACTION'),
          entity,
          entityIdNormalized,
          stringifySafe({
            user: safeUser,
            timestamp: now,
            description,
            ...safeDetails,
          }),
          now,
        ],
        (err) => {
          if (err) return reject(err);
          return resolve();
        },
      );
    });

    logEvent('info', 'audit.recorded', description, {
      source: 'api',
      module: 'audit',
      action: String(action ?? 'UNKNOWN_ACTION'),
      reason: 'Registo de auditoria de negócio',
      who: safeUser,
      entity,
      entity_id: entityIdNormalized,
      user_id: safeUser?.id ?? null,
    });
  } catch (error) {
    logError('audit_log_failed', {
      event: 'audit.failed',
      message: 'Falha ao gravar registo de auditoria',
      module: 'audit',
      action: String(action ?? 'UNKNOWN_ACTION'),
      reason: 'Erro ao inserir em audit_logs',
      error,
    });
  }
}
