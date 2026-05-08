import crypto from 'crypto';
import { logInfo } from '../utils/logger.js';
import { sendError } from '../utils/response.js';

const SENSITIVE_HEADERS = new Set(['authorization', 'cookie', 'x-auth-user', 'x-user-id']);

function getClientIp(req) {
  const forwarded = String(req.headers?.['x-forwarded-for'] ?? '').split(',')[0].trim();
  const remote = String(req.socket?.remoteAddress ?? '').trim();
  return forwarded || remote || 'unknown';
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
    logInfo('http_request', {
      request_id: requestId,
      method: req.method,
      path: req.originalUrl,
      status_code: res.statusCode,
      duration_ms: durationMs,
      ip: getClientIp(req),
      user_id: req.user?.id ?? null,
      tenant_id: req.tenantId ?? req.user?.tenant_id ?? null,
    });
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
  return (req, res, next) => {
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
}
