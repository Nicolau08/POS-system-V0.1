/**
 * Segredo HMAC para tokens Bearer — persistido por instalação (junto à BD).
 * Em produção nunca usa fallback fixo conhecido.
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const isProduction = String(process.env.NODE_ENV ?? 'development').toLowerCase() === 'production';

let cachedSecret = null;

function resolveSecretFilePath() {
  if (process.env.POS_DB_PATH) {
    return path.join(path.dirname(path.resolve(String(process.env.POS_DB_PATH))), 'auth-hmac.secret');
  }
  const apiDir = path.dirname(fileURLToPath(import.meta.url));
  return path.join(apiDir, '..', 'auth-hmac.secret');
}

function readPersistedSecret() {
  try {
    const filePath = resolveSecretFilePath();
    const raw = fs.readFileSync(filePath, 'utf8').trim();
    return raw || null;
  } catch {
    return null;
  }
}

function persistSecret(secret) {
  const filePath = resolveSecretFilePath();
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `${secret}\n`, { encoding: 'utf8', mode: 0o600 });
  } catch (err) {
    console.warn('[authSecret] não foi possível gravar segredo:', err?.message || err);
  }
}

/**
 * Resolve o segredo HMAC (env → ficheiro → gerar novo).
 * Nunca devolve o literal antigo `posly-dev-lan-bearer-secret`.
 */
export function resolveAuthHmacSecret() {
  if (cachedSecret) return cachedSecret;

  const fromEnv = String(
    process.env.AUTH_BEARER_SHARED_SECRET || process.env.POS_AUTH_HMAC_SECRET || '',
  ).trim();
  if (fromEnv && fromEnv !== 'posly-dev-lan-bearer-secret') {
    cachedSecret = fromEnv;
    return cachedSecret;
  }

  const fromFile = readPersistedSecret();
  if (fromFile) {
    cachedSecret = fromFile;
    process.env.POS_AUTH_HMAC_SECRET = fromFile;
    return cachedSecret;
  }

  const generated = crypto.randomBytes(32).toString('hex');
  persistSecret(generated);
  cachedSecret = generated;
  process.env.POS_AUTH_HMAC_SECRET = generated;
  if (isProduction) {
    console.info('[authSecret] Gerado novo POS_AUTH_HMAC_SECRET persistido junto à base de dados.');
  }
  return cachedSecret;
}

/** TTL dos tokens Bearer (segundos). Default 12h. */
export function resolveBearerTtlSeconds() {
  const raw = Number(process.env.AUTH_BEARER_TTL_SECONDS ?? 12 * 60 * 60);
  if (!Number.isFinite(raw) || raw < 300) return 12 * 60 * 60;
  return Math.floor(raw);
}

/**
 * IP do cliente sem confiar em X-Forwarded-For (salvo TRUST_PROXY=true).
 */
export function getClientIp(req) {
  const trustProxy = String(process.env.TRUST_PROXY ?? 'false').toLowerCase() === 'true';
  if (trustProxy) {
    const forwarded = String(req.headers?.['x-forwarded-for'] ?? '').split(',')[0].trim();
    if (forwarded) return forwarded.replace(/^::ffff:/i, '');
  }
  return String(req.socket?.remoteAddress ?? '')
    .trim()
    .replace(/^::ffff:/i, '');
}

export function isLoopbackIp(candidate) {
  const normalized = String(candidate ?? '')
    .trim()
    .replace(/^::ffff:/i, '');
  return new Set(['127.0.0.1', '::1', 'localhost']).has(normalized);
}
