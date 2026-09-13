import crypto from 'crypto';
import { logInfo } from '../utils/logger.js';
import { logError, logWarn } from '../utils/logger.js';
import { sendError } from '../utils/response.js';
import { getClientIp as resolveClientIp } from '../utils/authSecret.js';

const SENSITIVE_HEADERS = new Set(['authorization', 'cookie', 'x-auth-user', 'x-user-id']);

function getClientIp(req) {
  return resolveClientIp(req) || 'unknown';
}

function sanitizeObject(value, depth = 0) {
  if (depth > 8) return value;
  if (Array.isArray(value)) return value.map((item) => sanitizeObject(item, depth + 1));
  if (!value || typeof value !== 'object') {
    if (typeof value === 'string') return value.replace(/\u0000/g, '').trim();
    return value;
  }

  const out = {};
  for (const [key, raw] of Object.entries(value)) {
    if (key === '__proto__' || key === 'prototype' || key === 'constructor') continue;
    out[key] = sanitizeObject(raw, depth + 1);
  }
  return out;
}

export function attachRequestContext(req, res, next) {
  const requestId = crypto.randomUUID();
  const startedAt = Date.now();
  req.requestId = requestId;
  res.setHeader('x-request-id', requestId);
  res.setHeader('x-content-type-options', 'nosniff');
  res.setHeader('x-frame-options', 'DENY');
  res.setHeader('referrer-policy', 'no-referrer');

  res.on('finish', () => {
    const durationMs = Date.now() - startedAt;
    const status = res.statusCode;
    const level = status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info';
    const message =
      status >= 500
        ? `Pedido HTTP falhou no servidor (${req.method} ${req.originalUrl})`
        : status >= 400
          ? `Pedido HTTP rejeitado (${status}) ${req.method} ${req.originalUrl}`
          : `Pedido HTTP concluído ${req.method} ${req.originalUrl}`;

    const meta = {
      event: 'http.request',
      message,
      source: 'api',
      module: 'http',
      action: `${req.method} ${req.originalUrl}`,
      reason:
        status >= 500
          ? 'Erro interno ao processar o pedido'
          : status >= 400
            ? 'Cliente ou autorização impediram o pedido'
            : 'Pedido processado normalmente',
      request_id: requestId,
      method: req.method,
      path: req.originalUrl,
      status_code: status,
      duration_ms: durationMs,
      ip: getClientIp(req),
      who: req.user ?? null,
      user_id: req.user?.id ?? null,
      tenant_id: req.tenantId ?? req.user?.tenant_id ?? null,
    };

    if (level === 'error') logError('http_request', meta);
    else if (level === 'warn') logWarn('http_request', { ...meta, persist: true });
    else logInfo('http_request', { ...meta, persist: false });
  });

  next();
}

export function sanitizeInputMiddleware(req, _res, next) {
  const sanitizedBody = sanitizeObject(req.body);
  const sanitizedQuery = sanitizeObject(req.query);
  const sanitizedParams = sanitizeObject(req.params);

  if (req.body && typeof req.body === 'object' && sanitizedBody && typeof sanitizedBody === 'object') {
    for (const key of Object.keys(req.body)) delete req.body[key];
    Object.assign(req.body, sanitizedBody);
  } else {
    req.body = sanitizedBody;
  }

  if (req.query && typeof req.query === 'object' && sanitizedQuery && typeof sanitizedQuery === 'object') {
    for (const key of Object.keys(req.query)) delete req.query[key];
    Object.assign(req.query, sanitizedQuery);
  }

  if (req.params && typeof req.params === 'object' && sanitizedParams && typeof sanitizedParams === 'object') {
    for (const key of Object.keys(req.params)) delete req.params[key];
    Object.assign(req.params, sanitizedParams);
  }
  next();
}

export function sanitizeRequestHeadersForLogs(req) {
  const headers = {};
  for (const [key, value] of Object.entries(req.headers ?? {})) {
    headers[key] = SENSITIVE_HEADERS.has(String(key).toLowerCase()) ? '[REDACTED]' : value;
  }
  return headers;
}

export function createRateLimiter({
  windowMs = Number(process.env.API_RATE_LIMIT_WINDOW_MS ?? 60_000),
  max = Number(process.env.API_RATE_LIMIT_MAX ?? 300),
} = {}) {
  const buckets = new Map();

  // Chaves não revisitadas (IP/rota que pára de ser usada) ficavam para sempre
  // no Map — varredura periódica remove buckets já expirados.
  function sweep() {
    const now = Date.now();
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= now) buckets.delete(key);
    }
  }

  const sweepTimer = setInterval(sweep, Math.max(windowMs, 30_000));
  if (typeof sweepTimer.unref === 'function') sweepTimer.unref();

  const middleware = (req, res, next) => {
    const ip = getClientIp(req);
    const key = `${ip}:${req.method}:${req.path}`;
    const now = Date.now();
    const current = buckets.get(key);
    if (!current || current.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }

    current.count += 1;
    if (current.count > max) {
      res.setHeader('Retry-After', Math.ceil((current.resetAt - now) / 1000));
      return sendError(res, 429, 'Too many requests');
    }
    return next();
  };

  // Exposto para testes/introspecção — não usado pelo pedido normal.
  middleware.buckets = buckets;
  middleware.sweep = sweep;
  middleware.stop = () => clearInterval(sweepTimer);

  return middleware;
}
