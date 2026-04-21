import crypto from 'crypto';
import db from '../database.js';

const isDevelopment = String(process.env.NODE_ENV ?? 'development').toLowerCase() !== 'production';
const REDACT_KEYS = new Set([
  'authorization',
  'password',
  'pin',
  'token',
  'license_key',
  'supabase_service_role_key',
  'cookie',
]);

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
  if (depth > 8) return value;
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

const emit = (level, message, meta = {}) => {
  const entry = {
    level,
    message: String(message ?? ''),
    timestamp: new Date().toISOString(),
    ...redact(normalizeMeta(meta)),
  };

  if (!isDevelopment && level !== 'error') return;
  const sink = level === 'error' ? console.error : console.log;
  sink(stringifySafe(entry));
};

export function logInfo(message, meta = {}) {
  try {
    emit('info', message, meta);
  } catch {}
}

export function logError(message, meta = {}) {
  try {
    emit('error', message, meta);
  } catch {}
}

export async function logAudit(action, user, details = {}) {
  const safeDetails = details && typeof details === 'object' ? redact(details) : { value: details };
  const safeUser = normalizeUser(user);
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const entity = safeDetails.entity == null ? null : String(safeDetails.entity);
  const entityId = safeDetails.entity_id ?? safeDetails.entityId ?? null;
  const entityIdNormalized = entityId == null ? null : String(entityId);

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
            description: safeDetails.description ?? String(action ?? 'UNKNOWN_ACTION'),
            ...safeDetails,
          }),
          now,
        ],
        (err) => {
          if (err) return reject(err);
          return resolve();
        }
      );
    });

    logInfo('audit_log_recorded', {
      action: String(action ?? 'UNKNOWN_ACTION'),
      user_id: safeUser?.id ?? null,
      entity,
      entity_id: entityIdNormalized,
    });
  } catch (error) {
    logError('audit_log_failed', {
      action: String(action ?? 'UNKNOWN_ACTION'),
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
