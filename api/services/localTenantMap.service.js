/**
 * Pilot Gate — mapa só-leitura dos tenant_id presentes na BD local (GET /sync/local-tenant-map).
 *
 * Contexto: o operador/dados locais podem estar em 'tenant-1' (placeholder legado) enquanto a licença
 * activa e o Device JWT pertencem ao tenant real do piloto. Este módulo só MEDE isso; nunca corrige nada.
 *
 * Garantias:
 *  - Zero escritas: todo o SQL passa por assertReadOnlySql() (só SELECT/WITH de um único statement, sem
 *    keywords de escrita/DDL/PRAGMA) antes de chegar ao handle da BD.
 *  - Sem refresh: o tenant do Device JWT vem só do token JÁ em cache no Electron (injectado como
 *    `getCachedDeviceToken`, na prática getDeviceAccessTokenCachedOnlyViaBridge). Nunca /access-token.
 *  - Sem registry/licença/auditoria: só lê a BD local.
 *  - Sem conteúdo de negócio nem segredos: a saída só tem contagens, nomes de tabelas/entidades/tipos/estados
 *    e tenant ids sanitizados ('tenant-1' ou os 8 primeiros caracteres). Nunca license_key, JWT, payloads, PINs.
 *
 * Duas identidades cloud SEPARADAS: `device_jwt_tenant` (claim tenant_id do JWT em cache) e `license_tenant`
 * (licença activa real na BD). Classes: legacy_placeholder ('tenant-1'), cloud_match, other, empty, onde
 * cloud_match compara com a referência: Device JWT se em cache, senão a licença (ver classification_reference).
 */

export const LEGACY_PLACEHOLDER_TENANT = 'tenant-1';
export const TENANT_CLASSES = ['legacy_placeholder', 'cloud_match', 'other', 'empty'];

const FORBIDDEN_SQL_KEYWORDS =
  /\b(insert|update|delete|replace|drop|create|alter|attach|detach|pragma|vacuum|reindex|analyze|begin|commit|rollback|savepoint|release|load_extension)\b/i;

/** Remove comentários, strings e identificadores entre aspas para a verificação de keywords. */
function stripQuotedAndComments(sql) {
  return String(sql)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n]*/g, ' ')
    .replace(/'(?:[^']|'')*'/g, "''")
    .replace(/"(?:[^"]|"")*"/g, '""')
    .replace(/`[^`]*`/g, '``')
    .replace(/\[[^\]]*\]/g, '[]');
}

/** Lança se o SQL não for um único SELECT/WITH só-leitura. */
export function assertReadOnlySql(sql) {
  if (typeof sql !== 'string' || !sql.trim()) throw new Error('read_only_sql_required');
  let stripped = stripQuotedAndComments(sql).trim();
  if (stripped.endsWith(';')) stripped = stripped.slice(0, -1).trim();
  if (stripped.includes(';')) throw new Error('read_only_sql_violation: multiple statements');
  if (!/^(select|with)\b/i.test(stripped)) throw new Error('read_only_sql_violation: only SELECT/WITH allowed');
  const forbidden = stripped.match(FORBIDDEN_SQL_KEYWORDS);
  if (forbidden) throw new Error(`read_only_sql_violation: forbidden keyword "${forbidden[1].toLowerCase()}"`);
}

/** Envolve um handle sqlite3-style (db.all) e só deixa passar SQL só-leitura. */
export function createReadOnlyQuery(dbHandle) {
  return function query(sql, params = []) {
    assertReadOnlySql(sql);
    return new Promise((resolve, reject) => {
      dbHandle.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows ?? [])));
    });
  };
}

const quoteIdent = (name) => `"${String(name).replace(/"/g, '""')}"`;
const safeLabel = (value, max = 40) => String(value ?? '').trim().slice(0, max);
const bump = (obj, key, n = 1) => {
  obj[key] = (obj[key] ?? 0) + Number(n);
};
const emptyClassCounts = () => ({ legacy_placeholder: 0, cloud_match: 0, other: 0, empty: 0 });

export function createTenantClassifier(cloudTenantId) {
  const cloud = String(cloudTenantId ?? '').trim();
  return function classify(tenantId) {
    const id = String(tenantId ?? '').trim();
    if (!id) return 'empty';
    if (id.toLowerCase() === LEGACY_PLACEHOLDER_TENANT) return 'legacy_placeholder';
    if (cloud && id === cloud) return 'cloud_match';
    return 'other';
  };
}

/** 'tenant-1' ou os 8 primeiros caracteres; nunca o id completo. */
export function sanitizeTenantId(tenantId) {
  const id = String(tenantId ?? '').trim();
  if (!id) return null;
  if (id.toLowerCase() === LEGACY_PLACEHOLDER_TENANT) return LEGACY_PLACEHOLDER_TENANT;
  return id.slice(0, 8);
}

/** Descodifica só o claim tenant_id do payload de um JWT (sem verificar assinatura — só classificação). */
export function readTenantClaimFromJwt(token) {
  try {
    const parts = String(token ?? '').split('.');
    if (parts.length < 2) return null;
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    const tenant = String(payload?.tenant_id ?? '').trim();
    return tenant || null;
  } catch {
    return null;
  }
}

/** Exportado para reutilização (ex.: api/services/pilotTenantRepairPlan.service.js) — mesma introspecção, nunca duplicada. */
export async function columnsOf(query, table) {
  const rows = await query(`SELECT name FROM pragma_table_info(?)`, [table]);
  return new Set(rows.map((r) => String(r.name)));
}

export async function discoverTenantTables(query) {
  const rows = await query(
    `SELECT DISTINCT m.name AS table_name
     FROM sqlite_master m, pragma_table_info(m.name) p
     WHERE m.type = 'table' AND m.name NOT LIKE 'sqlite_%' AND p.name = 'tenant_id'
     ORDER BY m.name`,
  );
  return rows.map((r) => String(r.table_name));
}

/** Licença activa real (não 'AUTO', não placeholder) — mesma prioridade de tenant.service/setup.service. */
async function resolveLicenseTenant(query) {
  const cols = await columnsOf(query, 'licenses');
  if (!cols.has('tenant_id')) return { tenantId: null, candidates: 0 };
  const stamp = ['activated_at', 'created_at'].filter((c) => cols.has(c));
  const stampExpr = stamp.length ? `datetime(COALESCE(${stamp.join(', ')}, '1970-01-01'))` : `'1970-01-01'`;
  const realFilter = cols.has('license_key') ? `AND COALESCE(license_key, '') != 'AUTO'` : '';
  const activeFilter = cols.has('active') ? `AND active = 1` : '';
  const rows = await query(
    `SELECT tenant_id FROM licenses
     WHERE tenant_id IS NOT NULL AND TRIM(tenant_id) != '' AND LOWER(TRIM(tenant_id)) != ?
       ${activeFilter} ${realFilter}
     ORDER BY ${stampExpr} DESC`,
    [LEGACY_PLACEHOLDER_TENANT],
  );
  const distinct = [...new Set(rows.map((r) => String(r.tenant_id).trim()))];
  return { tenantId: distinct[0] ?? null, candidates: distinct.length };
}

async function mapTables(query, tables, classify, identities) {
  const perTable = {};
  const idSummary = new Map(); // `${label}|${class}` -> { id, class, rows, tables }
  for (const table of tables) {
    const rows = await query(`SELECT tenant_id AS t, COUNT(*) AS n FROM ${quoteIdent(table)} GROUP BY tenant_id`);
    const counts = emptyClassCounts();
    let total = 0;
    let jwtMatch = 0;
    let licenseMatch = 0;
    const seenInTable = new Set();
    for (const row of rows) {
      const cls = classify(row.t);
      const n = Number(row.n ?? 0);
      const id = String(row.t ?? '').trim();
      counts[cls] += n;
      total += n;
      if (id && identities.jwt && id === identities.jwt) jwtMatch += n;
      if (id && identities.license && id === identities.license) licenseMatch += n;
      const label = sanitizeTenantId(row.t);
      const key = `${label}|${cls}`;
      const entry = idSummary.get(key) ?? { id: label, class: cls, rows: 0, tables: 0 };
      entry.rows += n;
      if (!seenInTable.has(key)) {
        seenInTable.add(key);
        entry.tables += 1;
      }
      idSummary.set(key, entry);
    }
    perTable[table] = {
      ...counts,
      total,
      device_jwt_match: jwtMatch,
      license_match: licenseMatch,
      mixed_legacy_and_cloud: counts.legacy_placeholder > 0 && counts.cloud_match > 0,
    };
  }
  return { perTable, tenantIds: [...idSummary.values()].sort((a, b) => b.rows - a.rows) };
}

async function mapUsers(query, tables, classify) {
  if (!tables.includes('users')) return { present: false };
  const rows = await query(`SELECT tenant_id AS t, active AS a, COUNT(*) AS n FROM users GROUP BY tenant_id, active`);
  const byClass = {};
  for (const cls of TENANT_CLASSES) byClass[cls] = { total: 0, active: 0 };
  for (const row of rows) {
    const cls = classify(row.t);
    const n = Number(row.n ?? 0);
    byClass[cls].total += n;
    if (Number(row.a ?? 1) !== 0) byClass[cls].active += n;
  }
  const admin = await query(`SELECT tenant_id AS t, active AS a FROM users WHERE id = 'admin-local' LIMIT 1`);
  const adminRow = admin[0];
  return {
    present: true,
    by_class: byClass,
    admin_local: adminRow
      ? { present: true, class: classify(adminRow.t), tenant: sanitizeTenantId(adminRow.t), active: Number(adminRow.a ?? 1) !== 0 }
      : { present: false },
  };
}

async function mapLicenses(query, classify, nowMs) {
  const cols = await columnsOf(query, 'licenses');
  if (!cols.has('tenant_id')) return { present: false };
  const pick = (col, alias, fallback = 'NULL') => (cols.has(col) ? `${col} AS ${alias}` : `${fallback} AS ${alias}`);
  const rows = await query(
    `SELECT tenant_id AS t, ${pick('plan', 'plan')}, ${pick('active', 'active', '1')}, ${pick('expires_at', 'expires_at')},
            ${cols.has('license_key') ? `CASE WHEN license_key = 'AUTO' THEN 1 ELSE 0 END` : '0'} AS is_auto
     FROM licenses`,
  );
  const byClass = {};
  for (const cls of TENANT_CLASSES) byClass[cls] = { total: 0, by_type: {}, by_status: {}, auto_seed: 0 };
  for (const row of rows) {
    const entry = byClass[classify(row.t)];
    entry.total += 1;
    if (Number(row.is_auto) === 1) entry.auto_seed += 1;
    bump(entry.by_type, safeLabel(row.plan) || 'unknown');
    let status = Number(row.active ?? 1) === 1 ? 'active' : 'inactive';
    const exp = row.expires_at ? Date.parse(String(row.expires_at)) : NaN;
    if (status === 'active' && Number.isFinite(exp) && exp < nowMs) status = 'expired';
    bump(entry.by_status, status);
  }
  return { present: true, by_class: byClass };
}

const UNPARSED_KEY_PREFIX = '?unparsed';

async function mapSyncQueue(query, tables, classify) {
  if (!tables.includes('sync_queue')) return { present: false };
  const cols = await columnsOf(query, 'sync_queue');
  // Prefixo (antes do 1.º ':') de dedupe_key/sync_ref — o formato é `${tenant_id}:...` (api/syncQueue.js).
  const prefix = (col) =>
    cols.has(col)
      ? `CASE WHEN ${col} IS NULL OR TRIM(${col}) = '' THEN NULL WHEN instr(${col}, ':') = 0 THEN '${UNPARSED_KEY_PREFIX}' ELSE substr(${col}, 1, instr(${col}, ':') - 1) END`
      : 'NULL';
  const rows = await query(
    `SELECT tenant_id AS t, status AS status, type AS type,
            CASE WHEN json_valid(data) THEN json_extract(data, '$.tenant_id') END AS payload_t,
            CASE WHEN json_valid(data) THEN 1 ELSE 0 END AS payload_valid,
            ${prefix('dedupe_key')} AS dedupe_prefix,
            ${prefix('sync_ref')} AS ref_prefix,
            COUNT(*) AS n
     FROM sync_queue
     GROUP BY tenant_id, status, type, payload_t, payload_valid, dedupe_prefix, ref_prefix`,
  );

  const byClass = {};
  const emptyMismatch = () => ({ total: 0, by_row_class: emptyClassCounts() });
  const mismatches = {
    payload_tenant_mismatch: emptyMismatch(),
    payload_tenant_missing: emptyMismatch(),
    payload_invalid_json: emptyMismatch(),
    dedupe_key_mismatch: emptyMismatch(),
    sync_ref_mismatch: emptyMismatch(),
  };
  const payloadClassByRowClass = {};
  for (const cls of TENANT_CLASSES) {
    byClass[cls] = { total: 0, by_status: {}, by_type: {} };
    payloadClassByRowClass[cls] = emptyClassCounts();
  }
  const flag = (name, rowCls, n) => {
    mismatches[name].total += n;
    mismatches[name].by_row_class[rowCls] += n;
  };

  for (const row of rows) {
    const n = Number(row.n ?? 0);
    const rowTenant = String(row.t ?? '').trim();
    const rowCls = classify(rowTenant);
    const entry = byClass[rowCls];
    entry.total += n;
    bump(entry.by_status, safeLabel(row.status) || 'unknown', n);
    bump(entry.by_type, safeLabel(row.type) || 'unknown', n);

    if (Number(row.payload_valid) !== 1) {
      flag('payload_invalid_json', rowCls, n);
    } else {
      const payloadTenant = String(row.payload_t ?? '').trim();
      if (!payloadTenant) flag('payload_tenant_missing', rowCls, n);
      else if (payloadTenant !== rowTenant) flag('payload_tenant_mismatch', rowCls, n);
      payloadClassByRowClass[rowCls][classify(payloadTenant)] += n;
    }
    if (row.dedupe_prefix != null && row.dedupe_prefix !== rowTenant) flag('dedupe_key_mismatch', rowCls, n);
    if (row.ref_prefix != null && row.ref_prefix !== rowTenant) flag('sync_ref_mismatch', rowCls, n);
  }
  return { present: true, by_class: byClass, payload_tenant_class_by_row_class: payloadClassByRowClass, mismatches };
}

async function mapSyncState(query, classify) {
  if (!(await columnsOf(query, 'sync_state')).has('id')) return { present: false };
  const rows = await query(`SELECT id FROM sync_state`);
  const byClass = {};
  for (const cls of TENANT_CLASSES) byClass[cls] = { total: 0, by_entity: {} };
  let unparsed = 0;
  for (const row of rows) {
    // formato escrito por syncService: cloud:<entidade>:<tenant_id>
    const m = /^cloud:([a-z_]+):(.*)$/i.exec(String(row.id ?? ''));
    if (!m) {
      unparsed += 1;
      continue;
    }
    const entry = byClass[classify(m[2])];
    entry.total += 1;
    bump(entry.by_entity, safeLabel(m[1]));
  }
  return { present: true, total: rows.length, unparsed, by_class: byClass };
}

/**
 * @param {{
 *   query: (sql: string, params?: any[]) => Promise<any[]>,
 *   getCachedDeviceToken?: () => Promise<string|null>,
 *   requestTenantId?: string,
 *   now?: () => number,
 * }} deps
 *   `query` tem de ser createReadOnlyQuery(db). `getCachedDeviceToken` NUNCA pode fazer refresh.
 */
export async function buildLocalTenantMap({ query, getCachedDeviceToken, requestTenantId = '', now = () => Date.now() }) {
  const license = await resolveLicenseTenant(query);

  let jwtTenant = null;
  let jwtReason = 'bridge_not_available';
  if (typeof getCachedDeviceToken === 'function') {
    const token = await getCachedDeviceToken();
    if (!token) jwtReason = 'device_token_not_cached';
    else {
      jwtTenant = readTenantClaimFromJwt(token);
      jwtReason = jwtTenant ? null : 'tenant_claim_missing';
    }
  }

  const referenceSource = jwtTenant ? 'device_jwt' : license.tenantId ? 'license' : 'none';
  const referenceTenant = jwtTenant ?? license.tenantId;
  const classify = createTenantClassifier(referenceTenant);
  const tenantTables = await discoverTenantTables(query);
  const { perTable, tenantIds } = await mapTables(query, tenantTables, classify, { jwt: jwtTenant, license: license.tenantId });

  const tablesByPattern = { mixed_legacy_and_cloud: [], legacy_only: [], cloud_only: [] };
  for (const [name, t] of Object.entries(perTable)) {
    if (t.mixed_legacy_and_cloud) tablesByPattern.mixed_legacy_and_cloud.push(name);
    else if (t.legacy_placeholder > 0 && t.cloud_match === 0) tablesByPattern.legacy_only.push(name);
    else if (t.cloud_match > 0 && t.legacy_placeholder === 0) tablesByPattern.cloud_only.push(name);
  }

  return {
    read_only: true,
    generated_at: new Date(now()).toISOString(),
    device_jwt_tenant: {
      available: Boolean(jwtTenant),
      reason: jwtReason,
      id: sanitizeTenantId(jwtTenant),
      class: jwtTenant ? createTenantClassifier(jwtTenant)(jwtTenant) : null,
    },
    license_tenant: {
      known: Boolean(license.tenantId),
      id: sanitizeTenantId(license.tenantId),
      active_real_license_tenants: license.candidates,
    },
    identities_match: jwtTenant && license.tenantId ? jwtTenant === license.tenantId : null,
    classification_reference: referenceSource,
    request_tenant: { class: classify(requestTenantId), id: sanitizeTenantId(requestTenantId) },
    tenant_ids: tenantIds,
    tables: perTable,
    tables_by_pattern: tablesByPattern,
    users: await mapUsers(query, tenantTables, classify),
    licenses: await mapLicenses(query, classify, now()),
    sync_queue: await mapSyncQueue(query, tenantTables, classify),
    sync_state: await mapSyncState(query, classify),
  };
}
