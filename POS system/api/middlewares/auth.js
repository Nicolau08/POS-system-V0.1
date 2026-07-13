import db, { getOrCreateDefaultTenantId } from '../database.js';
import crypto from 'crypto';
import { sendError } from '../utils/response.js';

const LOCALHOSTS = new Set(['127.0.0.1', '::1', 'localhost']);
const isProduction = String(process.env.NODE_ENV ?? 'development').toLowerCase() === 'production';

function parseAuthorizationHeader(req) {
  const raw = String(req.headers?.authorization ?? '').trim();
  if (!raw.toLowerCase().startsWith('bearer ')) return null;
  return raw.slice(7).trim();
}

function resolveBearerUserId(tokenRaw) {
  const token = String(tokenRaw ?? '').trim();
  if (!token) return '';

  const secret = String(process.env.AUTH_BEARER_SHARED_SECRET ?? '').trim();
  const allowPlainBearer = String(process.env.AUTH_ALLOW_PLAIN_BEARER ?? (isProduction ? 'false' : 'true')).toLowerCase() === 'true';

  if (secret) {
    const [userIdPart, signaturePart] = token.split('.');
    const userId = String(userIdPart ?? '').trim();
    const signature = String(signaturePart ?? '').trim();
    if (!userId || !signature) return '';
    const expected = crypto.createHmac('sha256', secret).update(userId).digest('hex');
    const provided = Buffer.from(signature);
    const expectedBuf = Buffer.from(expected);
    if (provided.length !== expectedBuf.length) return '';
    if (!crypto.timingSafeEqual(provided, expectedBuf)) return '';
    return userId;
  }

  if (!allowPlainBearer) return '';
  return token;
}

function parseMockHeader(req) {
  const allowMockHeaders = String(process.env.AUTH_ALLOW_MOCK_HEADERS ?? (isProduction ? 'false' : 'true')).toLowerCase() === 'true';
  if (!allowMockHeaders) return null;
  const raw = req.headers?.['x-auth-user'];
  if (!raw) return null;

  try {
    const parsed = JSON.parse(String(raw));
    if (!parsed || typeof parsed !== 'object') return null;
    return {
      id: parsed.id ? String(parsed.id).trim() : '',
      role: parsed.role ? String(parsed.role).trim() : '',
      name: parsed.name ? String(parsed.name).trim() : '',
      tenant_id: parsed.tenant_id
        ? String(parsed.tenant_id).trim()
        : parsed.tenantId
          ? String(parsed.tenantId).trim()
          : '',
    };
  } catch {
    return null;
  }
}

function isLocalRequest(req) {
  const forwarded = String(req.headers?.['x-forwarded-for'] ?? '').split(',')[0].trim();
  const remote = String(req.socket?.remoteAddress ?? '').trim();
  const candidate = forwarded || remote;
  if (!candidate) return false;
  if (candidate.startsWith('::ffff:')) {
    return LOCALHOSTS.has(candidate.replace('::ffff:', ''));
  }
  return LOCALHOSTS.has(candidate);
}

async function getFallbackLegacyUser(req) {
  const allowLegacy = String(process.env.AUTH_ALLOW_LEGACY_LOCAL ?? (isProduction ? 'false' : 'true')).toLowerCase() !== 'false';
  if (!allowLegacy) return null;
  if (!isLocalRequest(req)) return null;
  const defaultTenantId = await getOrCreateDefaultTenantId();

  return {
    id: 'legacy-local-admin',
    name: 'Legacy Local Admin',
    role: 'admin',
    access_level: 9,
    active: true,
    tenant_id: defaultTenantId,
    source: 'legacy-local',
  };
}

function mapUserRow(row, source = 'database') {
  return {
    id: String(row.id),
    name: String(row.name ?? ''),
    role: String(row.role ?? 'user'),
    access_level: Number(row.access_level ?? 0),
    active: Number(row.active ?? 1) !== 0,
    tenant_id: String(row.tenant_id ?? ''),
    source,
  };
}

export async function resolveUserFromRequest(req) {
  const mockHeaderUser = parseMockHeader(req);
  const allowHeaderUserId = String(process.env.AUTH_ALLOW_HEADER_USER_ID ?? (isProduction ? 'false' : 'true')).toLowerCase() === 'true';
  const headerUserId = allowHeaderUserId ? String(req.headers?.['x-user-id'] ?? '').trim() : '';
  const bearerUserId = resolveBearerUserId(parseAuthorizationHeader(req));
  const resolvedUserId = mockHeaderUser?.id || headerUserId || bearerUserId || '';

  if (!resolvedUserId) return getFallbackLegacyUser(req);

  const dbUser = await new Promise((resolve, reject) => {
    db.get(
      `SELECT id, name, role, access_level, active, tenant_id
       FROM users
       WHERE id = ?
       LIMIT 1`,
      [resolvedUserId],
      (err, row) => {
        if (err) return reject(err);
        resolve(row ?? null);
      }
    );
  });

  if (!dbUser) {
    // Nunca permite "usuario fantasma" em producao.
    if (!isProduction && mockHeaderUser?.role) {
      const fallbackTenantId = mockHeaderUser.tenant_id || (await getOrCreateDefaultTenantId());
      return {
        id: resolvedUserId,
        name: mockHeaderUser.name || resolvedUserId,
        role: mockHeaderUser.role,
        access_level: mockHeaderUser.role === 'admin' ? 9 : 0,
        active: true,
        tenant_id: fallbackTenantId,
        source: 'mock-header',
      };
    }
    return null;
  }

  const mapped = mapUserRow(dbUser);
  if (!mapped.tenant_id) return null;
  if (mockHeaderUser?.role) {
    mapped.role = String(mockHeaderUser.role).trim() || mapped.role;
    mapped.access_level = mapped.role === 'admin' ? Math.max(mapped.access_level, 9) : mapped.access_level;
    if (mockHeaderUser.tenant_id) {
      mapped.tenant_id = String(mockHeaderUser.tenant_id).trim() || mapped.tenant_id;
    }
    mapped.source = 'database+mock-role';
  }
  return mapped;
}

export async function authenticateUser(req, res, next) {
  try {
    const user = await resolveUserFromRequest(req);
    const tenantId = String(user?.tenant_id ?? '').trim();
    if (!user || user.active === false || !tenantId) {
      return sendError(res, 401, 'Unauthorized', 'UNAUTHORIZED');
    }
    user.tenant_id = tenantId;
    req.user = user;
    req.tenantId = tenantId;
    return next();
  } catch (error) {
    return sendError(res, 500, 'falha ao autenticar utilizador', 'AUTH_FAILED');
  }
}

export function requireRole(role) {
  const expectedRole = String(role ?? '').trim().toLowerCase();
  return (req, res, next) => {
    if (!req.user) return sendError(res, 401, 'Unauthorized', 'UNAUTHORIZED');

    const currentRole = String(req.user.role ?? '').trim().toLowerCase();
    if (currentRole !== expectedRole) {
      return sendError(res, 403, 'Forbidden', 'FORBIDDEN');
    }
    return next();
  };
}

export const requireAdmin = requireRole('admin');

/**
 * Exige access_level >= required_level da regra em permission_rules.
 * Se a regra não existir, usa fallbackRequired (default 0).
 */
export function requirePermission(permissionKey, fallbackRequired = 0) {
  const key = String(permissionKey ?? '').trim();
  return async (req, res, next) => {
    try {
      if (!req.user) return sendError(res, 401, 'Unauthorized', 'UNAUTHORIZED');

      let required = Number(fallbackRequired);
      if (key) {
        const row = await new Promise((resolve, reject) => {
          db.get(
            `SELECT required_level FROM permission_rules WHERE key = ? LIMIT 1`,
            [key],
            (err, result) => (err ? reject(err) : resolve(result ?? null))
          );
        });
        if (row) required = Number(row.required_level ?? fallbackRequired);
      }

      const level = Number(req.user.access_level ?? req.user.accessLevel ?? 0);
      if (!Number.isFinite(level) || level < required) {
        return sendError(
          res,
          403,
          `Sem permissão (${key || 'operacao'}). Nível necessário: ${required}.`,
          'FORBIDDEN'
        );
      }
      return next();
    } catch {
      return sendError(res, 500, 'falha ao validar permissao', 'PERMISSION_CHECK_FAILED');
    }
  };
}
