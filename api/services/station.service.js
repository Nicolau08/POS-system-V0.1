/**
 * Configuração e postos multi-estação (servidor SQLite).
 */
import crypto from 'crypto';
import os from 'os';
import db, { getOrCreateDefaultTenantId } from '../database.js';
import { HttpError } from '../utils/response.js';

const ROLES = new Set(['caixa', 'garcom', 'consulta', 'cozinha']);

const runDb = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) return reject(err);
      resolve(this);
    });
  });

const getDb = (sql, params = [], all = false) =>
  new Promise((resolve, reject) => {
    const cb = (err, result) => {
      if (err) return reject(err);
      resolve(result);
    };
    if (all) db.all(sql, params, cb);
    else db.get(sql, params, cb);
  });

function normalizeText(value) {
  return String(value ?? '').trim();
}

function normalizeRole(value) {
  const raw = normalizeText(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  if (raw === 'garcom' || raw === 'waiter') return 'garcom';
  if (raw === 'consulta' || raw === 'viewer') return 'consulta';
  if (raw === 'cozinha' || raw === 'kitchen' || raw === 'kds') return 'cozinha';
  return 'caixa';
}

export function isLanAccessEnabledFromEnv() {
  const raw = String(process.env.POS_LAN_ACCESS ?? '').trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes';
}

export function isDiscoveryEnabledFromEnv() {
  if (!isLanAccessEnabledFromEnv()) return false;
  const raw = String(process.env.POS_STATION_DISCOVERY ?? '1').trim().toLowerCase();
  return raw !== '0' && raw !== 'false' && raw !== 'off';
}

export async function ensureStationTables() {
  await runDb(`
    CREATE TABLE IF NOT EXISTS stations (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      code TEXT NOT NULL,
      name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'caixa',
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(tenant_id, code)
    )
  `);
  await runDb(`
    CREATE TABLE IF NOT EXISTS station_server_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      lan_access_enabled INTEGER NOT NULL DEFAULT 0,
      discovery_enabled INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL
    )
  `);
  await runDb(`
    INSERT OR IGNORE INTO station_server_settings (id, lan_access_enabled, discovery_enabled, updated_at)
    VALUES (1, 0, 1, datetime('now'))
  `);
  // Etapa 1G.3.2: identidade persistente da Station. Registos legados ficam SEM identidade (public_key NULL,
  // status 'disabled'): sao so configuracao/label ate haver pairing. Nada e apagado nem promovido automaticamente.
  for (const [col, ddl] of [
    ['public_key', 'TEXT'],
    ['status', "TEXT NOT NULL DEFAULT 'disabled'"],
    ['machine_id', 'TEXT'],
    ['store_id', 'TEXT'],
    ['paired_at', 'TEXT'],
    ['last_seen', 'TEXT'],
  ]) {
    try {
      await runDb(`ALTER TABLE stations ADD COLUMN ${col} ${ddl}`);
    } catch (err) {
      if (!String(err?.message || err || '').toLowerCase().includes('duplicate column')) throw err;
    }
  }
  // Etapa 1G.3.5: unicidade em TODOS os estados (nao so activas): uma chave revogada/desactivada nunca volta a emparelhar
  try {
    await runDb(`CREATE UNIQUE INDEX IF NOT EXISTS uq_stations_pubkey_all ON stations(public_key) WHERE public_key IS NOT NULL`);
  } catch {
    // BD de desenvolvimento com duplicados antigos: o indice parcial das activas continua a proteger
  }
  await runDb(`CREATE UNIQUE INDEX IF NOT EXISTS uq_stations_active_pubkey ON stations(public_key) WHERE status = 'active' AND public_key IS NOT NULL`);
  await runDb(`CREATE TRIGGER IF NOT EXISTS trg_stations_status_ins BEFORE INSERT ON stations
    WHEN NEW.status NOT IN ('active', 'disabled', 'revoked')
    BEGIN SELECT RAISE(ABORT, 'stations.status invalido'); END`);
  await runDb(`CREATE TRIGGER IF NOT EXISTS trg_stations_status_upd BEFORE UPDATE OF status ON stations
    WHEN NEW.status NOT IN ('active', 'disabled', 'revoked')
    BEGIN SELECT RAISE(ABORT, 'stations.status invalido'); END`);
  // uma Station revogada nunca volta a active (a revogacao e definitiva; novo pairing = nova identidade)
  await runDb(`CREATE TRIGGER IF NOT EXISTS trg_stations_no_unrevoke BEFORE UPDATE OF status ON stations
    WHEN OLD.status = 'revoked' AND NEW.status <> 'revoked'
    BEGIN SELECT RAISE(ABORT, 'station revogada nao pode ser reactivada'); END`);
  // Etapa 1G.3.3: nonces anti-replay (scoped por station_id; expiram pouco depois da janela e sao limpos)
  await runDb(`
    CREATE TABLE IF NOT EXISTS station_nonces (
      station_id TEXT NOT NULL,
      nonce TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      PRIMARY KEY (station_id, nonce)
    ) WITHOUT ROWID
  `);
  await runDb(`CREATE INDEX IF NOT EXISTS idx_station_nonces_expires ON station_nonces(expires_at)`);
  await runDb(`
    CREATE TABLE IF NOT EXISTS station_pairings (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      code_hash TEXT NOT NULL,
      station_name TEXT NOT NULL,
      station_role TEXT NOT NULL DEFAULT 'caixa',
      expires_at TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 5,
      used_at TEXT,
      created_by TEXT,
      created_at TEXT NOT NULL
    )
  `);
  try {
    await runDb(`ALTER TABLE station_server_settings ADD COLUMN receipt_printer_name TEXT`);
  } catch (err) {
    const msg = String(err?.message || err || '').toLowerCase();
    if (!msg.includes('duplicate column')) {
      // ignore other migrate noise; column may already exist
    }
  }
  await runDb(`
    CREATE TABLE IF NOT EXISTS table_locks (
      tenant_id TEXT NOT NULL,
      table_key TEXT NOT NULL,
      station_code TEXT NOT NULL,
      user_id TEXT,
      user_name TEXT,
      locked_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (tenant_id, table_key)
    )
  `);
  // Etapa 1G.3.5: o dono do lock e a identidade AUTENTICADA (station_id); o loopback do Server (etiqueta local) nunca colide com uma Station emparelhada
  try {
    await runDb(`ALTER TABLE table_locks ADD COLUMN station_id TEXT`);
  } catch (err) {
    if (!String(err?.message || err || '').toLowerCase().includes('duplicate column')) throw err;
  }
}

export async function getServerStationSettings() {
  await ensureStationTables();
  const row = await getDb(
    `SELECT lan_access_enabled, discovery_enabled, receipt_printer_name, updated_at
       FROM station_server_settings WHERE id = 1`,
  );
  const fromDb = {
    lanAccessEnabled: Number(row?.lan_access_enabled ?? 0) === 1,
    discoveryEnabled: Number(row?.discovery_enabled ?? 1) === 1,
    receiptPrinterName: String(row?.receipt_printer_name ?? '').trim() || null,
    updatedAt: row?.updated_at ?? null,
  };
  return {
    ...fromDb,
    effectiveLanAccess: isLanAccessEnabledFromEnv() || fromDb.lanAccessEnabled,
    effectiveDiscovery:
      (isLanAccessEnabledFromEnv() || fromDb.lanAccessEnabled) &&
      (isDiscoveryEnabledFromEnv() || fromDb.discoveryEnabled),
  };
}

export async function updateServerStationSettings(patch = {}) {
  await ensureStationTables();
  const current = await getServerStationSettings();
  const lan =
    patch.lanAccessEnabled != null ? Boolean(patch.lanAccessEnabled) : current.lanAccessEnabled;
  const discovery =
    patch.discoveryEnabled != null ? Boolean(patch.discoveryEnabled) : current.discoveryEnabled;
  const receiptPrinterName =
    patch.receiptPrinterName != null || patch.receipt_printer_name != null
      ? String(patch.receiptPrinterName ?? patch.receipt_printer_name ?? '').trim() || null
      : current.receiptPrinterName;
  const now = new Date().toISOString();
  await runDb(
    `UPDATE station_server_settings
     SET lan_access_enabled = ?, discovery_enabled = ?, receipt_printer_name = ?, updated_at = ?
     WHERE id = 1`,
    [lan ? 1 : 0, discovery ? 1 : 0, receiptPrinterName, now],
  );
  return getServerStationSettings();
}

export function listLocalIpv4Addresses() {
  const nets = os.networkInterfaces();
  const out = [];
  for (const entries of Object.values(nets)) {
    if (!entries) continue;
    for (const net of entries) {
      if (net.family !== 'IPv4' && net.family !== 4) continue;
      if (net.internal) continue;
      out.push(net.address);
    }
  }
  return [...new Set(out)];
}

export async function buildDiscoverPayload() {
  const settings = await getServerStationSettings();
  if (!settings.lanAccessEnabled && !isLanAccessEnabledFromEnv()) {
    return null;
  }
  if (!settings.discoveryEnabled && !isDiscoveryEnabledFromEnv()) {
    return null;
  }
  // Etapa 1G.3.5: so o minimo para a Station encontrar o endpoint. Nunca tenant_id, store_id, nome da loja, versao/licenca.
  // Descoberta NAO e autenticacao: o Server continua a exigir pairing por codigo e pedidos assinados.
  const port = Number(process.env.POS_API_PORT || process.env.PORT || 3001);
  return {
    app: 'posly',
    protocol: 1,
    port,
    accepts_pairing: true,
  };
}

async function resolveTenantId(actorUser) {
  const fromUser = normalizeText(actorUser?.tenant_id);
  if (fromUser) return fromUser;
  return getOrCreateDefaultTenantId();
}

export async function listStations(actorUser = null) {
  await ensureStationTables();
  const tenantId = await resolveTenantId(actorUser);
  const rows = await getDb(
    `SELECT id, tenant_id, code, name, role, active, status, paired_at, last_seen, machine_id,
            CASE WHEN public_key IS NOT NULL THEN 1 ELSE 0 END AS has_identity, created_at, updated_at
     FROM stations WHERE tenant_id = ? ORDER BY code ASC`,
    [tenantId],
    true,
  );
  return (rows || []).map((r) => ({
    id: r.id,
    tenant_id: r.tenant_id,
    code: r.code,
    name: r.name,
    role: normalizeRole(r.role),
    active: Number(r.active) === 1,
    // identidade valida = par de chaves emparelhado e status active; registos legados sao so etiqueta
    status: r.status,
    has_identity: Number(r.has_identity) === 1,
    identity_valid: Number(r.has_identity) === 1 && r.status === 'active',
    machine_id: r.machine_id ?? null, // so metadata
    paired_at: r.paired_at ?? null,
    last_seen: r.last_seen ?? null,
    created_at: r.created_at,
    updated_at: r.updated_at,
  }));
}

export async function upsertStation(payload = {}, actorUser = null) {
  await ensureStationTables();
  const tenantId = await resolveTenantId(actorUser);
  const code = normalizeText(payload.code).toLowerCase().replace(/\s+/g, '-');
  const name = normalizeText(payload.name) || code;
  const role = normalizeRole(payload.role);
  if (!code || code.length < 2) throw new HttpError(400, 'Código do posto inválido.');
  if (!ROLES.has(role)) throw new HttpError(400, 'Papel do posto inválido.');
  const now = new Date().toISOString();
  const existing = await getDb(
    `SELECT id FROM stations WHERE tenant_id = ? AND code = ? LIMIT 1`,
    [tenantId, code],
  );
  const id = existing?.id || crypto.randomUUID();
  const active = payload.active === false ? 0 : 1;
  if (existing) {
    await runDb(
      `UPDATE stations SET name = ?, role = ?, active = ?, updated_at = ? WHERE id = ?`, // nunca toca em public_key/status
      [name, role, active, now, id],
    );
  } else {
    await runDb(
      `INSERT INTO stations (id, tenant_id, code, name, role, active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, tenantId, code, name, role, active, now, now],
    );
  }
  const row = await getDb(`SELECT * FROM stations WHERE id = ?`, [id]);
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    role: normalizeRole(row.role),
    active: Number(row.active) === 1,
  };
}

export async function removeStation(codeRaw, actorUser = null) {
  await ensureStationTables();
  const tenantId = await resolveTenantId(actorUser);
  const code = normalizeText(codeRaw).toLowerCase();
  const existing = await getDb(`SELECT public_key FROM stations WHERE tenant_id = ? AND code = ?`, [tenantId, code]);
  if (existing?.public_key) {
    throw new HttpError(409, 'Station emparelhada não se apaga: revogue-a (a identidade fica registada).');
  }
  await runDb(`DELETE FROM stations WHERE tenant_id = ? AND code = ? AND public_key IS NULL`, [tenantId, code]);
  return { ok: true };
}

/** Permissão: abrir / tomar mesa bloqueada por outro utilizador ou posto. */
const OPEN_OTHER_TABLE_PERMISSION = 'vendas.abrir_mesa_outro';
const OPEN_OTHER_TABLE_FALLBACK_LEVEL = 5;

async function userCanOpenOtherTable(actorUser) {
  if (!actorUser) return false;
  const role = normalizeText(actorUser.role).toLowerCase();
  const level = Number(actorUser.access_level ?? actorUser.accessLevel ?? 0);
  if (role === 'admin' || level >= 9) return true;
  let required = OPEN_OTHER_TABLE_FALLBACK_LEVEL;
  try {
    const row = await getDb(
      `SELECT required_level FROM permission_rules WHERE key = ? LIMIT 1`,
      [OPEN_OTHER_TABLE_PERMISSION],
    );
    if (row && row.required_level != null) required = Number(row.required_level);
  } catch {
    // tabela pode ainda não existir em bases antigas
  }
  return Number.isFinite(level) && level >= required;
}

function lockHeldByLabel(existing) {
  const name = normalizeText(existing?.user_name);
  if (name) return name;
  const code = normalizeText(existing?.station_code);
  return code ? `posto ${code}` : 'outro posto';
}

export async function claimTableLock(payload = {}, actorUser = null) {
  await ensureStationTables();
  const tenantId = await resolveTenantId(actorUser);
  const tableKey = normalizeText(payload.tableKey || payload.table_key || payload.tableNumber);
  // Station autenticada (assinatura): o codigo vem da BD, nunca do corpo. So o loopback do Server usa a etiqueta do corpo.
  const stationCode = actorUser?.station_id
    ? normalizeText(actorUser.station_code)
    : normalizeText(payload.stationCode || payload.station_code) || 'caixa-1';
  if (!tableKey) throw new HttpError(400, 'Mesa obrigatória.');
  const now = new Date().toISOString();
  const userId = actorUser?.id ? String(actorUser.id) : null;
  const userName = actorUser?.name ? String(actorUser.name) : null;

  try {
    await runDb(
      `INSERT INTO table_locks (tenant_id, table_key, station_code, station_id, user_id, user_name, locked_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [tenantId, tableKey, stationCode, actorUser?.station_id ?? null, userId, userName, now, now],
    );
  } catch (err) {
    const msg = String(err?.message ?? err ?? '');
    if (!/UNIQUE|constraint/i.test(msg)) throw err;

    const existing = await getDb(
      `SELECT * FROM table_locks WHERE tenant_id = ? AND table_key = ? LIMIT 1`,
      [tenantId, tableKey],
    );
    if (!existing) throw err;

    // mesma Station: por station_id autenticado; entre etiquetas do loopback (sem id) por codigo. Nunca se cruzam.
    const sameStation = actorUser?.station_id
      ? normalizeText(existing.station_id) === normalizeText(actorUser.station_id)
      : !existing.station_id && normalizeText(existing.station_code) === stationCode;
    const sameUser =
      normalizeText(existing.user_id) &&
      normalizeText(existing.user_id) === normalizeText(actorUser?.id);
    if (!sameStation && !sameUser) {
      const canTakeOver = await userCanOpenOtherTable(actorUser);
      if (!canTakeOver) {
        throw new HttpError(
          409,
          `Mesa ${tableKey} em uso por ${lockHeldByLabel(existing)}.`,
        );
      }
    }
    await runDb(
      `UPDATE table_locks SET station_code = ?, station_id = ?, user_id = ?, user_name = ?, updated_at = ?
       WHERE tenant_id = ? AND table_key = ?`,
      [stationCode, actorUser?.station_id ?? null, userId, userName, now, tenantId, tableKey],
    );
  }

  return getDb(`SELECT * FROM table_locks WHERE tenant_id = ? AND table_key = ?`, [
    tenantId,
    tableKey,
  ]);
}

export async function releaseTableLock(payload = {}, actorUser = null) {
  await ensureStationTables();
  const tenantId = await resolveTenantId(actorUser);
  const tableKey = normalizeText(payload.tableKey || payload.table_key || payload.tableNumber);
  const stationCode = actorUser?.station_id
    ? normalizeText(actorUser.station_code)
    : normalizeText(payload.stationCode || payload.station_code) || normalizeText(actorUser?.station_code);
  if (!tableKey) throw new HttpError(400, 'Mesa obrigatória.');
  const existing = await getDb(
    `SELECT * FROM table_locks WHERE tenant_id = ? AND table_key = ? LIMIT 1`,
    [tenantId, tableKey],
  );
  if (!existing) return { ok: true };
  // Papel do posto: preferir o resolvido na autenticação (BD), não o body do cliente.
  const role = normalizeRole(actorUser?.station_role || payload.role);
  const canForce =
    role === 'caixa' ||
    Number(actorUser?.access_level ?? 0) >= 5 ||
    (await userCanOpenOtherTable(actorUser));
  if (
    stationCode &&
    normalizeText(existing.station_code) !== stationCode &&
    !canForce
  ) {
    throw new HttpError(
      403,
      `Só ${lockHeldByLabel(existing)} (ou quem tem permissão) pode libertar esta mesa.`,
    );
  }
  await runDb(`DELETE FROM table_locks WHERE tenant_id = ? AND table_key = ?`, [
    tenantId,
    tableKey,
  ]);
  return { ok: true };
}

export async function listTableLocks(actorUser = null) {
  await ensureStationTables();
  const tenantId = await resolveTenantId(actorUser);
  return (
    (await getDb(
      `SELECT * FROM table_locks WHERE tenant_id = ? ORDER BY table_key ASC`,
      [tenantId],
      true,
    )) || []
  );
}

export async function isRemoteAuthAllowed() {
  if (isLanAccessEnabledFromEnv()) return true;
  try {
    const s = await getServerStationSettings();
    return Boolean(s.lanAccessEnabled);
  } catch {
    return false;
  }
}
