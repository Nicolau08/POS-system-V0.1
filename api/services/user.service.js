import db from '../database.js';
import crypto from 'crypto';
import machineIdModule from 'node-machine-id';

const { machineIdSync } = machineIdModule;
import { uuidv4 } from '../cloudIdUtils.js';
import { ensureHashedPin, hashPin, verifyPinAgainstStored } from '../pinAuth.js';
import { logAudit, logError, logInfo } from '../utils/logger.js';
import { requireTenantId } from '../utils/tenant.js';
import {
  parseBooleanFilter,
  parsePagination,
  parseSearchTerm,
  withPaginationPayload,
} from './queryOptions.service.js';

const allDb = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows ?? []);
    });
  });

const runDb = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) return reject(err);
      resolve(this);
    });
  });

const getDb = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row ?? null);
    });
  });

async function resolveTenantId(tenantCandidate) {
  return requireTenantId(tenantCandidate, {
    status: 401,
    message: 'tenant_id ausente para operacao de utilizadores',
  });
}

async function getSetupState() {
  const existing = await getDb(
    `SELECT admin_password_set, license_activated, license_token_hash, license_expires_at
     FROM app_setup_state
     WHERE id = 1
     LIMIT 1`
  );
  if (existing) return existing;
  await runDb(
    `INSERT OR IGNORE INTO app_setup_state (id, admin_password_set, license_activated, updated_at)
     VALUES (1, 0, 0, ?)`,
    [new Date().toISOString()]
  );
  return (
    (await getDb(
      `SELECT admin_password_set, license_activated, license_token_hash, license_expires_at
       FROM app_setup_state
       WHERE id = 1
       LIMIT 1`
    )) ?? { admin_password_set: 0, license_activated: 0, license_token_hash: null, license_expires_at: null }
  );
}

function normalizeNonEmptyText(value) {
  const normalized = String(value ?? '').trim();
  return normalized || '';
}

function hashLicenseToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function parseTimestamp(value) {
  if (value == null) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

function parseIsoTimestampStrict(value) {
  if (typeof value !== 'string') return null;
  const raw = value.trim();
  if (!raw) return null;
  const isoDateTimeRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;
  if (!isoDateTimeRegex.test(raw)) return null;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

export async function authenticateLogin({ userId, enteredPin }) {
  const user = await getDb(
    `SELECT id, name, surname, email, role, access_level, active, pin, tenant_id
     FROM users
     WHERE id = ?
     LIMIT 1`,
    [userId]
  );

  if (!user || Number(user.active ?? 1) === 0) {
    logInfo('login_failed', { user_id: userId, reason: 'invalid_credentials' });
    return { ok: false, reason: 'invalid_credentials' };
  }

  console.log("🔐 LOGIN DEBUG START");
  console.log("USER ID:", userId);
  console.log("PIN RECEBIDO:", JSON.stringify(enteredPin));
  console.log("PIN LENGTH:", String(enteredPin).length);
  console.log("HASH DB:", user.pin);

  const auth = await verifyPinAgainstStored(enteredPin, user.pin);

  console.log("BCRYPT RESULT:", auth);
  if (!auth.valid) {
    logInfo('login_failed', { user_id: userId, reason: 'invalid_credentials' });
    return { ok: false, reason: 'invalid_credentials' };
  }

  if (auth.needsMigration) {
    const upgradedPinHash = await hashPin(enteredPin);
    await runDb(`UPDATE users SET pin = ?, updated_at = ? WHERE id = ?`, [
      upgradedPinHash,
      new Date().toISOString(),
      user.id,
    ]);
  }

  const authenticatedUser = {
    id: String(user.id),
    name: String(user.name ?? ''),
    surname: user.surname == null ? null : String(user.surname),
    email: user.email == null ? null : String(user.email),
    role: String(user.role ?? 'cashier'),
    access_level: Number(user.access_level ?? 0),
    active: Number(user.active ?? 1) !== 0,
    tenant_id: requireTenantId(user.tenant_id, {
      status: 401,
      message: 'utilizador sem tenant_id configurado',
    }),
  };

  await logAudit('USER_LOGIN', authenticatedUser, {
    entity: 'auth',
    entity_id: String(user.id),
    description: 'User login successful',
  });

  return {
    ok: true,
    user: authenticatedUser,
  };
}

export async function listUsers(filters = {}) {
  const pagination = parsePagination(filters);
  const search = parseSearchTerm(filters.search);
  const active = parseBooleanFilter(filters.active);
  const tenantId = await resolveTenantId(filters.actorTenantId);

  const where = [];
  const whereParams = [];
  where.push(`tenant_id = ?`);
  whereParams.push(tenantId);
  if (search) {
    where.push(`(LOWER(COALESCE(name, '')) LIKE LOWER(?) OR LOWER(COALESCE(surname, '')) LIKE LOWER(?) OR LOWER(COALESCE(email, '')) LIKE LOWER(?))`);
    const token = `%${search}%`;
    whereParams.push(token, token, token);
  }
  if (active != null) {
    where.push(`active = ?`);
    whereParams.push(active ? 1 : 0);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const baseSelect = `SELECT id, name, surname, email, role, access_level, active, tenant_id FROM users ${whereSql} ORDER BY name ASC`;

  if (!pagination.hasPagination) {
    return allDb(baseSelect, whereParams);
  }

  const rows = await allDb(`${baseSelect} LIMIT ? OFFSET ?`, [...whereParams, pagination.limit, pagination.offset]);
  const totalRow = await getDb(`SELECT COUNT(*) AS total FROM users ${whereSql}`, whereParams);
  return withPaginationPayload(rows, {
    page: pagination.page,
    limit: pagination.limit,
    total: Number(totalRow?.total ?? 0),
  });
}

export async function createUser(payload = {}, actorUser = null) {
  const now = new Date().toISOString();
  const name = String(payload.name ?? '').trim();
  const surname = payload.surname == null ? null : String(payload.surname).trim();
  const email = payload.email == null ? null : String(payload.email).trim();
  const role = String(payload.role ?? 'cashier').trim();
  const pin = payload.pin ?? payload.password ?? payload.access_code ?? '';
  const accessLevel = payload.access_level ?? payload.accessLevel ?? 0;
  const active = payload.active === false ? 0 : 1;
  const resolvedTenantId = await resolveTenantId(actorUser?.tenant_id);

  if (!name || String(pin) === '') {
    return { error: 'name e pin sao obrigatorios', status: 400 };
  }

  const userId = payload.id && String(payload.id).trim() ? String(payload.id).trim() : uuidv4();
  const hashedPin = await ensureHashedPin(pin);

  await runDb(
    `INSERT INTO users (id, name, surname, email, role, pin, access_level, active, is_system, tenant_id, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      userId,
      name,
      surname || null,
      email || null,
      role,
      hashedPin,
      Number(accessLevel) || 0,
      active,
      0,
      resolvedTenantId,
      now,
    ]
  );

  await logAudit('USER_CREATE', actorUser, {
    entity: 'user',
    entity_id: userId,
    description: 'User account created',
    target_user: {
      id: userId,
      role,
      active: Boolean(active),
    },
  });

  return { success: true, id: userId };
}

export async function updateUser(userId, payload = {}, actorUser = null) {
  const normalizedId = String(userId ?? '').trim();
  if (!normalizedId) return { error: 'id invalido', status: 400 };
  const tenantId = await resolveTenantId(actorUser?.tenant_id);

  const now = new Date().toISOString();
  const updates = [];
  const params = [];

  if (payload.name !== undefined) {
    updates.push('name = ?');
    params.push(String(payload.name ?? '').trim());
  }
  if (payload.surname !== undefined) {
    updates.push('surname = ?');
    params.push(payload.surname == null ? null : String(payload.surname).trim() || null);
  }
  if (payload.email !== undefined) {
    updates.push('email = ?');
    params.push(payload.email == null ? null : String(payload.email).trim() || null);
  }
  if (payload.role !== undefined) {
    updates.push('role = ?');
    params.push(String(payload.role ?? '').trim() || 'cashier');
  }
  if (payload.pin !== undefined || payload.password !== undefined) {
    const pin = payload.pin ?? payload.password;
    if (String(pin ?? '') === '') return { error: 'pin invalido', status: 400 };
    const hashedPin = await ensureHashedPin(pin);
    updates.push('pin = ?');
    params.push(hashedPin);
  }
  if (payload.access_level !== undefined || payload.accessLevel !== undefined) {
    const accessLevel = payload.access_level ?? payload.accessLevel;
    updates.push('access_level = ?');
    params.push(Number(accessLevel) || 0);
  }
  if (payload.active !== undefined) {
    updates.push('active = ?');
    params.push(payload.active === false ? 0 : 1);
  }

  if (updates.length === 0) return { error: 'nenhuma atualizacao informada', status: 400 };

  params.push(now);
  params.push(normalizedId);
  params.push(tenantId);
  const result = await runDb(
    `UPDATE users
     SET ${updates.join(', ')}, updated_at = ?
     WHERE id = ?
       AND tenant_id = ?
       AND COALESCE(is_system, 0) = 0`,
    params
  );
  if (result.changes > 0) {
    await logAudit('USER_UPDATE', actorUser, {
      entity: 'user',
      entity_id: normalizedId,
      description: 'User account updated',
      updated_fields: updates.map((field) => String(field).split('=')[0].trim()),
    });
  }
  return { success: true, updated: result.changes > 0 };
}

export async function deactivateUser(userId, actorUser = null) {
  const normalizedId = String(userId ?? '').trim();
  if (!normalizedId) return { error: 'id invalido', status: 400 };
  const tenantId = await resolveTenantId(actorUser?.tenant_id);
  const result = await runDb(
    `UPDATE users
     SET active = 0, updated_at = ?
     WHERE id = ?
       AND tenant_id = ?
       AND COALESCE(is_system, 0) = 0`,
    [new Date().toISOString(), normalizedId, tenantId]
  );
  if (result.changes > 0) {
    await logAudit('USER_DELETE', actorUser, {
      entity: 'user',
      entity_id: normalizedId,
      description: 'User account deactivated',
    });
  } else {
    logInfo('user_deactivate_skipped', { user_id: normalizedId });
  }
  return { success: true, deactivated: result.changes > 0 };
}

export async function validateAdminPassword(adminPassword, tenantCandidate = null) {
  const tenantId = await resolveTenantId(tenantCandidate);
  const adminUsers = await allDb(
    `SELECT id, pin
     FROM users
     WHERE active = 1
       AND role = 'admin'
       AND tenant_id = ?`,
    [tenantId]
  );

  let validAdminUser = null;
  let shouldUpgradeAdminPin = false;

  for (const row of adminUsers) {
    const auth = await verifyPinAgainstStored(adminPassword, row.pin);
    if (auth.valid) {
      validAdminUser = row;
      shouldUpgradeAdminPin = auth.needsMigration;
      break;
    }
  }

  if (!validAdminUser) {
    logError('admin_password_validation_failed', { reason: 'invalid_password' });
    return null;
  }

  if (shouldUpgradeAdminPin) {
    const upgradedPinHash = await hashPin(adminPassword);
    await runDb(`UPDATE users SET pin = ?, updated_at = ? WHERE id = ?`, [
      upgradedPinHash,
      new Date().toISOString(),
      validAdminUser.id,
    ]);
  }

  return validAdminUser;
}

export async function resetAdminPinToDefault(userId, tenantCandidate = null) {
  const normalizedUserId = String(userId ?? '').trim();
  if (!normalizedUserId) return { error: 'userId invalido', status: 400 };

  const adminUser = await getDb(
    `SELECT id, role, active
     FROM users
     WHERE id = ?
     LIMIT 1`,
    [normalizedUserId]
  );

  if (!adminUser) return { error: 'utilizador nao encontrado', status: 404 };
  if (Number(adminUser.active ?? 1) === 0) return { error: 'utilizador inativo', status: 400 };
  if (String(adminUser.role ?? '').trim().toLowerCase() !== 'admin') {
    return { error: 'apenas utilizadores admin podem ser redefinidos', status: 400 };
  }

  const defaultPin = '1234';
  const hashedPin = await ensureHashedPin(defaultPin);
  await runDb(`UPDATE users SET pin = ?, updated_at = ? WHERE id = ?`, [
    hashedPin,
    new Date().toISOString(),
    normalizedUserId,
  ]);

  return { success: true, userId: normalizedUserId, defaultPin };
}

export async function readSetupStatus() {
  const setup = await getSetupState();
  const adminPasswordSet = Number(setup?.admin_password_set ?? 0) === 1;
  const licenseActivated = Number(setup?.license_activated ?? 0) === 1;
  const licenseExpiresAt = parseTimestamp(setup?.license_expires_at);
  const licenseExpired = Boolean(licenseExpiresAt) && Date.now() > Date.parse(licenseExpiresAt);
  return {
    adminPasswordSet,
    licenseActivated,
    licenseExpiresAt,
    licenseExpired,
    requiresAdminPassword: !adminPasswordSet,
    requiresLicenseActivation: adminPasswordSet && !licenseActivated,
    isSetupComplete: adminPasswordSet && licenseActivated && !licenseExpired,
  };
}

export async function configureInitialAdminPassword(rawPin, tenantCandidate = null) {
  const pin = normalizeNonEmptyText(rawPin);
  if (pin.length < 4) {
    return { error: 'pin deve conter pelo menos 4 caracteres', status: 400 };
  }

  const tenantId = await resolveTenantId(tenantCandidate);
  const now = new Date().toISOString();
  const hashedPin = await ensureHashedPin(pin);
  const adminUserId = 'admin-local';
  await runDb(
    `INSERT INTO users (id, name, surname, email, role, pin, access_level, active, is_system, tenant_id, cloud_id, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       surname = excluded.surname,
       email = excluded.email,
       role = excluded.role,
       pin = excluded.pin,
       access_level = excluded.access_level,
       active = excluded.active,
       is_system = 1,
       tenant_id = excluded.tenant_id,
       cloud_id = NULL,
       updated_at = excluded.updated_at`,
    [adminUserId, 'Admin', null, null, 'admin', hashedPin, 9, 1, 1, tenantId, null, now]
  );

  await runDb(
    `UPDATE app_setup_state
     SET admin_password_set = 1,
         updated_at = ?
     WHERE id = 1`,
    [now]
  );

  return { success: true, userId: adminUserId };
}

export async function activateLicenseWithToken(rawToken, rawExpiresAt = null) {
  const token = normalizeNonEmptyText(rawToken);
  if (token.length < 6) {
    return { error: 'token de licenca invalido', status: 400 };
  }
  const normalizedExpiresAt = parseTimestamp(rawExpiresAt);
  if (rawExpiresAt != null && !normalizedExpiresAt) {
    return { error: 'license_expires_at invalido', status: 400 };
  }

  const setup = await getSetupState();
  if (Number(setup?.admin_password_set ?? 0) !== 1) {
    return { error: 'defina primeiro a senha do admin', status: 400 };
  }

  const now = new Date().toISOString();
  await runDb(
    `UPDATE app_setup_state
     SET license_activated = 1,
         license_token_hash = ?,
         license_expires_at = ?,
         updated_at = ?
     WHERE id = 1`,
    [hashLicenseToken(token), normalizedExpiresAt, now]
  );

  return { success: true };
}

export async function renewLicenseExpiration(rawExpiresAt) {
  const normalizedExpiresAt = parseIsoTimestampStrict(rawExpiresAt);
  if (!normalizedExpiresAt) {
    return { error: 'license_expires_at invalido', status: 400 };
  }

  await runDb(
    `UPDATE app_setup_state
     SET license_expires_at = ?,
         updated_at = ?
     WHERE id = 1`,
    [normalizedExpiresAt, new Date().toISOString()]
  );

  const accessState = await validateLicenseAccess(0);
  return {
    success: true,
    license_expires_at: normalizedExpiresAt,
    licenseExpired: accessState.isExpired,
    effectiveExpiresAt: accessState.effectiveExpiresAt,
  };
}

function isLicenseRowTimeExpired(expiresRaw, gracePeriodMs) {
  if (expiresRaw == null || !String(expiresRaw).trim()) {
    return false;
  }
  const expiresMs = Date.parse(expiresRaw);
  if (Number.isNaN(expiresMs)) {
    return false;
  }
  const graceMs = Math.max(0, Number(gracePeriodMs) || 0);
  return Date.now() > expiresMs + graceMs;
}

export async function validateLicenseAccess(gracePeriodMs = 0, actorUser = null) {
  try {
    const tenantId =
      String(actorUser?.tenant_id ?? '').trim() ||
      'tenant-1'; // fallback obrigatório

    console.log('🔥 VALIDANDO LICENÇA', { tenantId });

    const rows = await allDb(
      `SELECT expires_at, active, machine_id, created_at
       FROM licenses
       WHERE tenant_id = ?
       ORDER BY datetime(COALESCE(created_at, '1970-01-01')) DESC`,
      [tenantId]
    );

    if (!rows.length) {
      console.log('🔥 LICENSE DB RESULT: nenhuma linha para tenant');
      return { isExpired: true };
    }

    const localMachine = machineIdSync({ original: true });

    for (const license of rows) {
      if (Number(license.active ?? 1) !== 1) {
        continue;
      }

      const boundMachine = license.machine_id != null ? String(license.machine_id).trim() : '';
      if (boundMachine && boundMachine !== localMachine) {
        continue;
      }

      const expiresAt = license.expires_at;
      if (!isLicenseRowTimeExpired(expiresAt, gracePeriodMs)) {
        const expiresStr =
          expiresAt != null && String(expiresAt).trim() ? String(expiresAt) : null;
        console.log('🔥 LICENSE OK', { tenantId, expiresStr, machineBound: Boolean(boundMachine) });
        return {
          isExpired: false,
          expiresAt: expiresStr,
          effectiveExpiresAt: expiresStr,
        };
      }
    }

    console.log('🔥 LICENSE DB RESULT: nenhuma licença válida (expirada, inactiva ou outra máquina)');
    return { isExpired: true };
  } catch (err) {
    console.error('❌ license validation error', err);
    return { isExpired: true };
  }
}
