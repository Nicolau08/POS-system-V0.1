/**
 * Pilot Gate — plano (dry-run) da reparação one-time tenant-1 → tenant real do piloto.
 *
 * PURAMENTE ANALÍTICO: esta função nunca escreve. Recebe um `query` já filtrado por
 * assertReadOnlySql() (ver api/services/localTenantMap.service.js) e devolve um objecto de
 * plano — nenhuma linha é alterada, nenhum mapeamento é persistido na BD alvo (fica só em
 * memória / no objecto devolvido; quem chama decide se o serializa para um FICHEIRO à parte).
 *
 * Desenho: cada tabela tenant_id descoberta dinamicamente tem de estar em TABLE_REGISTRY.
 * Uma tabela descoberta que NÃO esteja registada é FALHA DURA (cobertura de referência
 * incompleta) — nunca tratada como "provavelmente seguro migrar". Isto é o que torna a
 * cobertura "dinamicamente verificada" em vez de uma lista à mão que pode ficar desactualizada.
 *
 * Estratégias por tabela (ver relatório de desenho — "PILOT REPAIR TABLE PLAN"):
 *  - MIGRATE: sem chave natural (tenant_id, X) — renomear tenant_id nunca colide.
 *  - NATURAL_KEY_MERGE: índice UNIQUE(tenant_id, keyCols) já imposto pelo próprio schema —
 *    uma colisão aqui é uma correspondência exacta e determinística.
 *  - FUZZY_MERGE_OR_MIGRATE: correspondência por nome/telefone SEM índice único a garanti-la —
 *    qualquer candidato encontrado fica SEMPRE requiresHumanDecision (nunca auto-decidido).
 *  - DEPENDENT_MIGRATE: segue o tenant_id da tabela-mãe (order_items/orders, sale_payments/vendas,
 *    stock_layer_consumptions/stock_layers, etc.) — nunca decide por si.
 *  - SPECIAL_*: lógica dedicada (fila, sync_state, licenças, admin-local, armazéns, ledger,
 *    contador de talões, singleton de catálogo, z_reports).
 *  - DELETE_LEGACY_SEED: sem significado de negócio (checkout_idempotency).
 *  - KEEP_AS_HISTORY: nunca reescrito (app_logs, sync_logs).
 */

import { columnsOf, discoverTenantTables, LEGACY_PLACEHOLDER_TENANT, sanitizeTenantId } from './localTenantMap.service.js';
import { buildDedupeKey, buildSyncRef } from '../syncQueueKeys.js';

export const TABLE_REGISTRY = Object.freeze({
  categories: { strategy: 'NATURAL_KEY_MERGE', keyCols: ['name'] },
  deleted_category_tombstones: { strategy: 'MIGRATE' },
  tax_rates: { strategy: 'NATURAL_KEY_MERGE', keyCols: ['code'] },
  products: { strategy: 'FUZZY_MERGE_OR_MIGRATE', keyCols: ['name'] },
  product_bom_lines: { strategy: 'DEPENDENT_MIGRATE', dependsOn: 'products' },
  sync_queue: { strategy: 'SPECIAL_QUEUE' },
  sync_logs: { strategy: 'KEEP_AS_HISTORY' },
  store_products: { strategy: 'NATURAL_KEY_MERGE', keyCols: ['product_cloud_id'], compositePk: ['tenant_id', 'product_cloud_id'] },
  stock_transfers: { strategy: 'MIGRATE' },
  store_catalog_state: { strategy: 'SPECIAL_SINGLETON' },
  checkout_idempotency: { strategy: 'DELETE_LEGACY_SEED' },
  pos_open_drafts: { strategy: 'MIGRATE', compositePk: ['tenant_id', 'user_id'] },
  pos_table_orders: { strategy: 'MIGRATE', compositePk: ['tenant_id', 'table_key'] },
  kitchen_tickets: { strategy: 'MIGRATE' },
  kitchen_ticket_seq: { strategy: 'SPECIAL_COUNTER', counterCol: 'last_number' },
  cash_sessions: { strategy: 'MIGRATE', warnOpenStatus: true },
  cash_withdrawals: { strategy: 'DEPENDENT_MIGRATE', dependsOn: 'cash_sessions' },
  cash_movements: { strategy: 'DEPENDENT_MIGRATE', dependsOn: 'cash_sessions' },
  z_reports: { strategy: 'SPECIAL_Z_REPORTS', keyCols: ['z_number'] },
  stock_movements: { strategy: 'SPECIAL_LEDGER' },
  orders: { strategy: 'MIGRATE' },
  order_items: { strategy: 'DEPENDENT_MIGRATE', dependsOn: 'orders' },
  payment_methods: { strategy: 'NATURAL_KEY_MERGE', keyCols: ['code'] },
  clientes: { strategy: 'FUZZY_MERGE_OR_MIGRATE', keyCols: ['phone'] },
  vendas: { strategy: 'MIGRATE' },
  sale_payments: { strategy: 'DEPENDENT_MIGRATE', dependsOn: 'vendas' },
  locations: { strategy: 'NATURAL_KEY_MERGE', keyCols: ['name'] },
  warehouses: { strategy: 'SPECIAL_WAREHOUSE', keyCols: ['name'] },
  warehouse_stock: { strategy: 'SPECIAL_STOCK_CACHE', compositePk: ['warehouse_id', 'product_id'] },
  party_credits: { strategy: 'MIGRATE' },
  stock_layers: { strategy: 'DEPENDENT_MIGRATE', dependsOn: 'warehouses' },
  stock_layer_consumptions: { strategy: 'DEPENDENT_MIGRATE', dependsOn: 'stock_layers' },
  // uq_location_tables_tenant_name é a restrição mais estrita real (nome único por tenant, não só por location) — a chave de colisão tem de reflectir essa, não a UNIQUE(tenant_id, location_id, name) mais larga.
  location_tables: { strategy: 'NATURAL_KEY_MERGE', keyCols: ['name'] },
  print_centers: { strategy: 'NATURAL_KEY_MERGE', keyCols: ['name'] },
  print_center_categories: { strategy: 'DEPENDENT_MIGRATE', dependsOn: 'print_centers', compositePk: ['print_center_id', 'category_id'] },
  licenses: { strategy: 'SPECIAL_LICENSE' },
  users: { strategy: 'SPECIAL_USERS' },
  stations: { strategy: 'NATURAL_KEY_MERGE', keyCols: ['code'] },
  app_logs: { strategy: 'KEEP_AS_HISTORY' },
});

const quoteIdent = (name) => `"${String(name).replace(/"/g, '""')}"`;

function pkColumnsFor(table, cfg, allColumns) {
  if (cfg.compositePk) return cfg.compositePk;
  if (allColumns.has('id')) return ['id'];
  throw new Error(`pilot_repair_no_pk_resolved: ${table}`);
}

async function primaryKeyOf(query, table) {
  const rows = await query(`SELECT name, pk FROM pragma_table_info(?) WHERE pk > 0 ORDER BY pk`, [table]);
  return rows.map((r) => String(r.name));
}

function rowKey(row, cols) {
  return cols.map((c) => String(row[c] ?? '')).join('\u0000');
}
function pkValue(row, pkCols) {
  return pkCols.length === 1 ? row[pkCols[0]] : pkCols.map((c) => row[c]);
}

/** Estratégias sem colisão possível (chave primária global ou UUID) — conta só linhas. */
async function planPlainMigrate(query, table) {
  const [{ n }] = await query(`SELECT COUNT(*) AS n FROM ${quoteIdent(table)} WHERE tenant_id = ?`, [LEGACY_PLACEHOLDER_TENANT]);
  return { strategy: 'MIGRATE', rowsAffected: Number(n) || 0, decisions: [], blockers: [] };
}

/** MIGRATE com PK composta que INCLUI tenant_id: uma colisão é possível no resto da PK. */
async function planCompositeMigrate(query, table, cfg, pilotTenant) {
  const nonTenantPk = cfg.compositePk.filter((c) => c !== 'tenant_id');
  const legacyRows = await query(
    `SELECT ${cfg.compositePk.map(quoteIdent).join(', ')} FROM ${quoteIdent(table)} WHERE tenant_id = ?`,
    [LEGACY_PLACEHOLDER_TENANT],
  );
  const blockers = [];
  const decisions = [];
  for (const row of legacyRows) {
    const legacyPk = pkValue(row, cfg.compositePk);
    let existing = [];
    if (pilotTenant) {
      const where = nonTenantPk.map((c) => `${quoteIdent(c)} = ?`).join(' AND ');
      const params = [pilotTenant, ...nonTenantPk.map((c) => row[c])];
      existing = await query(`SELECT 1 AS x FROM ${quoteIdent(table)} WHERE tenant_id = ? AND ${where} LIMIT 1`, params);
    }
    if (existing.length) {
      decisions.push({ pk: legacyPk, decision: 'REQUIRES_HUMAN_DECISION' });
      blockers.push({ table, kind: 'composite_pk_collision', pk: legacyPk });
    } else {
      decisions.push({ pk: legacyPk, decision: 'MIGRATE' });
    }
  }
  return { strategy: cfg.strategy, rowsAffected: legacyRows.length, decisions, blockers };
}

/** NATURAL_KEY_MERGE / FUZZY_MERGE_OR_MIGRATE: casa por keyCols; devolve mapeamento legacyPk→targetPk. */
async function planKeyedMerge(query, table, cfg, pilotTenant, { fuzzy }) {
  const allColumns = await columnsOf(query, table);
  const pkCols = await primaryKeyOf(query, table);
  const keyCols = cfg.keyCols;
  const selectCols = [...new Set([...pkCols, ...keyCols])].map(quoteIdent).join(', ');

  const legacyRows = await query(`SELECT ${selectCols} FROM ${quoteIdent(table)} WHERE tenant_id = ?`, [LEGACY_PLACEHOLDER_TENANT]);
  const pilotRows = pilotTenant
    ? await query(`SELECT ${selectCols} FROM ${quoteIdent(table)} WHERE tenant_id = ?`, [pilotTenant])
    : [];

  const pilotByKey = new Map();
  for (const row of pilotRows) pilotByKey.set(rowKey(row, keyCols), row);

  const decisions = [];
  const idMap = [];
  const blockers = [];
  let migrateCount = 0;
  let mergeCount = 0;

  for (const row of legacyRows) {
    const match = pilotByKey.get(rowKey(row, keyCols));
    const legacyPk = pkValue(row, pkCols);
    if (match) {
      const targetPk = pkValue(match, pkCols);
      mergeCount += 1;
      idMap.push({ legacyPk, targetPk, keyValues: keyCols.map((c) => row[c]) });
      const decision = fuzzy ? 'REQUIRES_HUMAN_DECISION' : 'MERGE';
      decisions.push({ pk: legacyPk, targetPk, decision, matchedOn: keyCols });
      if (fuzzy) {
        blockers.push({ table, kind: 'fuzzy_merge_candidate', legacyPk, targetPk, matchedOn: keyCols });
      }
    } else {
      migrateCount += 1;
      decisions.push({ pk: legacyPk, decision: 'MIGRATE' });
    }
  }

  return {
    strategy: cfg.strategy,
    rowsAffected: legacyRows.length,
    migrateCount,
    mergeCount,
    idMap,
    decisions,
    blockers,
  };
}

async function planDependentMigrate(query, table, cfg) {
  if (cfg.compositePk) return planCompositeMigrateNoTenant(query, table, cfg);
  return { ...(await planPlainMigrate(query, table)), strategy: 'DEPENDENT_MIGRATE', dependsOn: cfg.dependsOn };
}

/** DEPENDENT_MIGRATE com PK composta que NÃO inclui tenant_id (ex.: print_center_categories) — sem colisão de tenant possível ali; só reporta contagem. */
async function planCompositeMigrateNoTenant(query, table, cfg) {
  const [{ n }] = await query(`SELECT COUNT(*) AS n FROM ${quoteIdent(table)} WHERE tenant_id = ?`, [LEGACY_PLACEHOLDER_TENANT]);
  return { strategy: 'DEPENDENT_MIGRATE', dependsOn: cfg.dependsOn, rowsAffected: Number(n) || 0, decisions: [], blockers: [] };
}

async function planDeleteLegacySeed(query, table) {
  const [{ n }] = await query(`SELECT COUNT(*) AS n FROM ${quoteIdent(table)} WHERE tenant_id = ?`, [LEGACY_PLACEHOLDER_TENANT]);
  return { strategy: 'DELETE_LEGACY_SEED', rowsAffected: Number(n) || 0, decisions: [], blockers: [] };
}

async function planKeepAsHistory(query, table) {
  const [{ n }] = await query(`SELECT COUNT(*) AS n FROM ${quoteIdent(table)} WHERE tenant_id = ?`, [LEGACY_PLACEHOLDER_TENANT]);
  return { strategy: 'KEEP_AS_HISTORY', rowsAffected: Number(n) || 0, decisions: [], blockers: [] };
}

async function planWarehouses(query, pilotTenant) {
  const base = await planKeyedMerge(query, 'warehouses', { keyCols: ['name'], strategy: 'SPECIAL_WAREHOUSE' }, pilotTenant, { fuzzy: false });
  const legacyDefault = await query(`SELECT id, name FROM warehouses WHERE tenant_id = ? AND is_default = 1`, [LEGACY_PLACEHOLDER_TENANT]);
  const pilotDefault = pilotTenant ? await query(`SELECT id, name FROM warehouses WHERE tenant_id = ? AND is_default = 1`, [pilotTenant]) : [];
  const blockers = [...base.blockers];
  if (legacyDefault.length && pilotDefault.length && legacyDefault[0].name !== pilotDefault[0].name) {
    blockers.push({
      table: 'warehouses',
      kind: 'two_default_warehouses',
      detail: 'tenant-1 e o tenant do piloto têm armazéns is_default=1 com nomes diferentes — não se fundem automaticamente.',
    });
  }
  return { ...base, blockers };
}

async function planZReports(query, pilotTenant) {
  return planKeyedMerge(query, 'z_reports', { keyCols: ['z_number'], strategy: 'SPECIAL_Z_REPORTS' }, pilotTenant, { fuzzy: true });
}

async function planLedger(query, productIdMap) {
  const legacyRows = await query(
    `SELECT id, product_id, movement_type, reference_id FROM stock_movements WHERE tenant_id = ?`,
    [LEGACY_PLACEHOLDER_TENANT],
  );
  const remap = new Map(productIdMap.map((m) => [String(m.legacyPk), m.targetPk]));
  const decisions = [];
  const blockers = [];
  for (const row of legacyRows) {
    const mappedProductId = remap.has(String(row.product_id)) ? remap.get(String(row.product_id)) : row.product_id;
    const collision = await query(
      `SELECT 1 AS x FROM stock_movements WHERE product_id = ? AND movement_type = ? AND reference_id = ? LIMIT 1`,
      [mappedProductId, row.movement_type, row.reference_id],
    );
    if (collision.length) {
      decisions.push({ pk: row.id, decision: 'REQUIRES_HUMAN_DECISION', mappedProductId });
      blockers.push({ table: 'stock_movements', kind: 'ledger_unique_ref_collision', pk: row.id, mappedProductId, movementType: row.movement_type, referenceId: row.reference_id });
    } else {
      decisions.push({ pk: row.id, decision: 'MIGRATE', mappedProductId });
    }
  }
  return { strategy: 'SPECIAL_LEDGER', rowsAffected: legacyRows.length, decisions, blockers };
}

async function planStockCache(query, warehouseIdMap, productIdMap) {
  const rows = await query(`SELECT warehouse_id, product_id, quantity FROM warehouse_stock WHERE tenant_id = ?`, [LEGACY_PLACEHOLDER_TENANT]);
  const whRemap = new Map(warehouseIdMap.map((m) => [String(m.legacyPk), m.targetPk]));
  const prodRemap = new Map(productIdMap.map((m) => [String(m.legacyPk), m.targetPk]));
  let toRecompute = 0;
  let toRename = 0;
  const blockers = [];
  for (const row of rows) {
    const mappedWh = whRemap.has(String(row.warehouse_id)) ? whRemap.get(String(row.warehouse_id)) : row.warehouse_id;
    const mappedProduct = prodRemap.has(String(row.product_id)) ? prodRemap.get(String(row.product_id)) : row.product_id;
    const existing = await query(
      `SELECT 1 AS x FROM warehouse_stock WHERE warehouse_id = ? AND product_id = ? AND tenant_id != ? LIMIT 1`,
      [mappedWh, mappedProduct, LEGACY_PLACEHOLDER_TENANT],
    );
    if (existing.length) toRecompute += 1;
    else toRename += 1;
  }
  return {
    strategy: 'SPECIAL_STOCK_CACHE',
    rowsAffected: rows.length,
    toRename,
    toRecomputeFromLedger: toRecompute,
    note: 'warehouse_stock nunca é renomeado por si — recomputa-se de stock_layers/stock_movements (ver WAREHOUSE STOCK AUTHORITY); esta fase só reporta a contagem de pares que precisarão de recomputo.',
    decisions: [],
    blockers,
  };
}

async function planSyncQueue(query, pilotTenant, idMaps) {
  const rows = await query(
    `SELECT id, tenant_id, type, data, status, dedupe_key, sync_ref FROM sync_queue WHERE tenant_id = ?`,
    [LEGACY_PLACEHOLDER_TENANT],
  );
  const remapFor = (type) => {
    if (type === 'product') return idMaps.products;
    if (type === 'category') return idMaps.categories;
    if (type === 'customer') return idMaps.clientes;
    return [];
  };

  const decisions = [];
  const blockers = [];
  const byType = {};
  const byStatus = {};

  for (const row of rows) {
    byType[row.type] = (byType[row.type] ?? 0) + 1;
    byStatus[row.status] = (byStatus[row.status] ?? 0) + 1;

    let payload;
    let payloadValid = true;
    try {
      payload = JSON.parse(row.data);
    } catch {
      payloadValid = false;
      payload = null;
    }
    if (!payloadValid) {
      decisions.push({ pk: row.id, decision: 'REQUIRES_HUMAN_DECISION', reason: 'payload_invalid_json' });
      blockers.push({ table: 'sync_queue', kind: 'payload_invalid_json', pk: row.id });
      continue;
    }

    const map = remapFor(row.type);
    const legacyEntityId = payload?.id;
    const mappedMatch = map.find((m) => String(m.legacyPk) === String(legacyEntityId));
    const newPayload = { ...payload, tenant_id: pilotTenant };
    if (mappedMatch) newPayload.id = mappedMatch.targetPk;

    const newDedupeKey = buildDedupeKey(row.type, newPayload, pilotTenant);
    const newSyncRef = buildSyncRef(row.type, newPayload, pilotTenant);

    let refCollision = false;
    if (newSyncRef) {
      const existing = await query(
        `SELECT 1 AS x FROM sync_queue WHERE tenant_id = ? AND sync_ref = ? AND status IN ('pending','failed','dead') LIMIT 1`,
        [pilotTenant, newSyncRef],
      );
      refCollision = existing.length > 0;
    }

    if (refCollision) {
      decisions.push({ pk: row.id, decision: 'REQUIRES_HUMAN_DECISION', reason: 'sync_ref_collision', newSyncRef });
      blockers.push({ table: 'sync_queue', kind: 'sync_ref_active_collision', pk: row.id, newSyncRef });
    } else {
      decisions.push({
        pk: row.id,
        decision: 'REWRITE_KEEP_DEAD',
        statusUnchanged: row.status,
        newTenantId: pilotTenant,
        remappedEntityId: mappedMatch ? mappedMatch.targetPk : null,
        newDedupeKey,
        newSyncRef,
      });
    }
  }

  return {
    strategy: 'SPECIAL_QUEUE',
    rowsAffected: rows.length,
    byType,
    byStatus,
    allStatusesPreservedAsDead: rows.every((r) => r.status === 'dead'),
    decisions,
    blockers,
  };
}

async function planSyncState(query, pilotTenant) {
  const rows = await query(`SELECT id, last_sync_at FROM sync_state WHERE id LIKE ?`, [`%:${LEGACY_PLACEHOLDER_TENANT}`]);
  const decisions = [];
  for (const row of rows) {
    const m = /^cloud:([a-z_]+):(.*)$/i.exec(String(row.id));
    if (!m || m[2].toLowerCase() !== LEGACY_PLACEHOLDER_TENANT) continue;
    const entity = m[1];
    const pilotRow = pilotTenant ? await query(`SELECT id FROM sync_state WHERE id = ?`, [`cloud:${entity}:${pilotTenant}`]) : [];
    decisions.push({
      pk: row.id,
      decision: pilotRow.length ? 'DELETE_REDUNDANT_CURSOR' : 'RENAME_TO_PILOT_CURSOR',
      entity,
    });
  }
  return { strategy: 'SPECIAL_SYNC_STATE', rowsAffected: rows.length, decisions, blockers: [] };
}

async function planStoreCatalogState(query, pilotTenant) {
  const legacy = await query(`SELECT tenant_id, initialized_at FROM store_catalog_state WHERE tenant_id = ?`, [LEGACY_PLACEHOLDER_TENANT]);
  if (!legacy.length) return { strategy: 'SPECIAL_SINGLETON', rowsAffected: 0, decisions: [], blockers: [] };
  const pilotRow = pilotTenant ? await query(`SELECT tenant_id FROM store_catalog_state WHERE tenant_id = ?`, [pilotTenant]) : [];
  return {
    strategy: 'SPECIAL_SINGLETON',
    rowsAffected: legacy.length,
    decisions: [{ pk: LEGACY_PLACEHOLDER_TENANT, decision: pilotRow.length ? 'DELETE_LEGACY_SEED' : 'RENAME_TO_PILOT' }],
    blockers: [],
  };
}

async function planKitchenTicketSeq(query, pilotTenant) {
  const legacy = await query(`SELECT tenant_id, last_number FROM kitchen_ticket_seq WHERE tenant_id = ?`, [LEGACY_PLACEHOLDER_TENANT]);
  if (!legacy.length) return { strategy: 'SPECIAL_COUNTER', rowsAffected: 0, decisions: [], blockers: [] };
  const pilotRow = pilotTenant ? await query(`SELECT last_number FROM kitchen_ticket_seq WHERE tenant_id = ?`, [pilotTenant]) : [];
  const decision = pilotRow.length
    ? { pk: LEGACY_PLACEHOLDER_TENANT, decision: 'MERGE_TAKE_MAX', legacyValue: legacy[0].last_number, pilotValue: pilotRow[0].last_number }
    : { pk: LEGACY_PLACEHOLDER_TENANT, decision: 'RENAME_TO_PILOT' };
  return { strategy: 'SPECIAL_COUNTER', rowsAffected: legacy.length, decisions: [decision], blockers: [] };
}

async function planLicenses(query) {
  const cols = await columnsOf(query, 'licenses');
  const legacy = await query(`SELECT id, ${cols.has('license_key') ? 'license_key' : 'NULL AS license_key'}, ${cols.has('active') ? 'active' : '1 AS active'}, ${cols.has('machine_id') ? 'machine_id' : 'NULL AS machine_id'} FROM licenses WHERE tenant_id = ?`, [LEGACY_PLACEHOLDER_TENANT]);
  const decisions = [];
  const blockers = [];
  for (const row of legacy) {
    const isAuto = String(row.license_key ?? '') === 'AUTO' || !row.license_key;
    if (isAuto) {
      decisions.push({ pk: row.id, decision: 'DELETE_LEGACY_SEED' });
    } else {
      decisions.push({ pk: row.id, decision: 'REQUIRES_HUMAN_DECISION', reason: 'non_auto_license_under_tenant1' });
      blockers.push({ table: 'licenses', kind: 'non_auto_license_under_legacy_tenant', pk: row.id, active: Number(row.active) === 1, machineId: row.machine_id ?? null });
    }
  }
  return { strategy: 'SPECIAL_LICENSE', rowsAffected: legacy.length, decisions, blockers };
}

async function planUsers(query, pilotTenant) {
  const legacy = await query(`SELECT id, role, tenant_id FROM users WHERE tenant_id = ?`, [LEGACY_PLACEHOLDER_TENANT]);
  const decisions = [];
  const blockers = [];
  const adminLocal = legacy.find((r) => r.id === 'admin-local');
  let otherCount = 0;
  for (const row of legacy) {
    if (row.id === 'admin-local') continue;
    otherCount += 1;
    decisions.push({ pk: row.id, decision: 'MIGRATE' });
  }
  if (adminLocal) {
    const otherPilotAdmin = pilotTenant
      ? await query(`SELECT id FROM users WHERE tenant_id = ? AND LOWER(COALESCE(role,'')) = 'admin' AND id != 'admin-local' LIMIT 1`, [pilotTenant])
      : [];
    if (otherPilotAdmin.length) {
      decisions.push({ pk: 'admin-local', decision: 'REQUIRES_HUMAN_DECISION', reason: 'pilot_tenant_already_has_a_different_admin', otherAdminId: otherPilotAdmin[0].id });
      blockers.push({ table: 'users', kind: 'admin_local_collision', otherAdminId: otherPilotAdmin[0].id });
    } else {
      decisions.push({ pk: 'admin-local', decision: 'REBIND_TENANT' });
    }
  }
  return { strategy: 'SPECIAL_USERS', rowsAffected: legacy.length, adminLocalPresent: Boolean(adminLocal), otherUserRows: otherCount, decisions, blockers };
}

async function checkOpenCashSessions(query) {
  const rows = await query(`SELECT id FROM cash_sessions WHERE tenant_id = ? AND status = 'open'`, [LEGACY_PLACEHOLDER_TENANT]);
  return rows.length;
}

/** Exactamente UM tenant de licença real (não 'AUTO', não tenant-1) — ambíguo é falha dura, nunca uma escolha automática. */
export async function resolveExactlyOneRealLicenseTenant(query) {
  const cols = await columnsOf(query, 'licenses');
  if (!cols.has('tenant_id')) return { ok: false, reason: 'no_licenses_table_or_column', tenantId: null, candidates: [] };
  const activeFilter = cols.has('active') ? 'AND active = 1' : '';
  const realFilter = cols.has('license_key') ? `AND COALESCE(license_key, '') != 'AUTO'` : '';
  const rows = await query(
    `SELECT DISTINCT tenant_id FROM licenses
     WHERE tenant_id IS NOT NULL AND TRIM(tenant_id) != '' AND LOWER(TRIM(tenant_id)) != ?
       ${activeFilter} ${realFilter}
     ORDER BY tenant_id`,
    [LEGACY_PLACEHOLDER_TENANT],
  );
  const distinct = rows.map((r) => String(r.tenant_id).trim());
  if (distinct.length === 0) return { ok: false, reason: 'no_real_license_tenant_found', tenantId: null, candidates: [] };
  if (distinct.length > 1) return { ok: false, reason: 'ambiguous_real_license_tenant', tenantId: null, candidates: distinct.map(sanitizeTenantId) };
  return { ok: true, tenantId: distinct[0], candidates: [sanitizeTenantId(distinct[0])] };
}

/**
 * @param {{
 *   query: (sql: string, params?: any[]) => Promise<any[]>,
 *   inspectOfflineLicenseFile?: () => Promise<{ present: boolean, valid?: boolean, tenantId?: string|null, error?: string }>,
 *   env?: NodeJS.ProcessEnv,
 *   now?: () => number,
 * }} deps
 */
export async function buildPilotRepairPlan({ query, inspectOfflineLicenseFile, env = process.env, now = () => Date.now() }) {
  const hardFails = [];
  const blockers = [];

  // 1) Exactamente um tenant de licença real — ambíguo/ausente é falha dura, nunca escolhido automaticamente.
  const licenseResolution = await resolveExactlyOneRealLicenseTenant(query);
  if (!licenseResolution.ok) {
    hardFails.push({ kind: 'license_tenant_resolution_failed', reason: licenseResolution.reason, candidates: licenseResolution.candidates });
  }
  const pilotTenant = licenseResolution.ok ? licenseResolution.tenantId : null;

  // 2) Cobertura: toda a tabela tenant_id descoberta tem de estar no registo — senão, falha dura.
  const discoveredTables = await discoverTenantTables(query);
  const unregistered = discoveredTables.filter((t) => !TABLE_REGISTRY[t]);
  if (unregistered.length) {
    hardFails.push({ kind: 'incomplete_reference_coverage', unregisteredTables: unregistered });
  }
  const registeredDiscovered = discoveredTables.filter((t) => TABLE_REGISTRY[t]);

  // 3) offline-license.json (ficheiro, fora da BD) — usa a MESMA verificação Ed25519 já existente.
  let offlineLicenseCheck = { present: false, checked: false };
  if (typeof inspectOfflineLicenseFile === 'function') {
    try {
      offlineLicenseCheck = await inspectOfflineLicenseFile();
      offlineLicenseCheck.checked = true;
      if (offlineLicenseCheck.present && offlineLicenseCheck.valid === false) {
        blockers.push({ table: null, kind: 'offline_license_file_invalid', detail: offlineLicenseCheck.error ?? null });
      }
      if (
        offlineLicenseCheck.present &&
        offlineLicenseCheck.valid === true &&
        pilotTenant &&
        offlineLicenseCheck.tenantId &&
        offlineLicenseCheck.tenantId !== pilotTenant
      ) {
        blockers.push({
          table: null,
          kind: 'offline_license_file_tenant_mismatch',
          detail: 'offline-license.json em disco resolve para um tenant diferente da licença activa na BD.',
        });
      }
    } catch (err) {
      offlineLicenseCheck = { present: false, checked: true, error: String(err?.message ?? err) };
    }
  }

  // 4) DEFAULT_TENANT_ID / POS_DEV_TENANT — se apontarem para tenant-1, o placeholder seria recriado no próximo arranque.
  const envDefaultTenant = String(env.DEFAULT_TENANT_ID ?? env.POS_DEV_TENANT ?? '').trim();
  const envCheck = {
    DEFAULT_TENANT_ID: env.DEFAULT_TENANT_ID ?? null,
    POS_DEV_TENANT: env.POS_DEV_TENANT ?? null,
    pointsAtLegacyPlaceholder: envDefaultTenant.toLowerCase() === LEGACY_PLACEHOLDER_TENANT,
  };
  if (envCheck.pointsAtLegacyPlaceholder) {
    blockers.push({ table: null, kind: 'env_default_tenant_is_legacy_placeholder', detail: 'DEFAULT_TENANT_ID/POS_DEV_TENANT aponta para tenant-1 — o placeholder seria recriado no próximo arranque.' });
  }

  if (hardFails.length) {
    return {
      generated_at: new Date(now()).toISOString(),
      pilot_tenant: pilotTenant ? sanitizeTenantId(pilotTenant) : null,
      hard_fails: hardFails,
      blockers,
      tables: {},
      row_count_reconciliation: {},
      tenant1_delete_proof: { satisfied: false, reason: 'hard_fail_before_table_planning' },
      offline_license_check: offlineLicenseCheck,
      env_check: envCheck,
      SAFE_TO_APPLY: false,
    };
  }

  // 5) Plano por tabela — ordem: pivots (categories/products/clientes) primeiro, dependentes depois.
  const tables = {};
  const idMaps = { products: [], categories: [], clientes: [], warehouses: [] };

  tables.categories = await planKeyedMerge(query, 'categories', TABLE_REGISTRY.categories, pilotTenant, { fuzzy: false });
  idMaps.categories = tables.categories.idMap ?? [];

  tables.products = await planKeyedMerge(query, 'products', TABLE_REGISTRY.products, pilotTenant, { fuzzy: true });
  idMaps.products = tables.products.idMap ?? [];

  tables.clientes = await planKeyedMerge(query, 'clientes', TABLE_REGISTRY.clientes, pilotTenant, { fuzzy: true });
  idMaps.clientes = tables.clientes.idMap ?? [];

  tables.warehouses = await planWarehouses(query, pilotTenant);
  idMaps.warehouses = tables.warehouses.idMap ?? [];

  for (const table of registeredDiscovered) {
    if (tables[table]) continue; // já planeado acima (pivot)
    const cfg = TABLE_REGISTRY[table];
    switch (cfg.strategy) {
      case 'MIGRATE':
        tables[table] = cfg.compositePk ? await planCompositeMigrate(query, table, cfg, pilotTenant) : await planPlainMigrate(query, table);
        break;
      case 'DEPENDENT_MIGRATE':
        tables[table] = await planDependentMigrate(query, table, cfg);
        break;
      case 'NATURAL_KEY_MERGE':
        tables[table] = await planKeyedMerge(query, table, cfg, pilotTenant, { fuzzy: false });
        break;
      case 'FUZZY_MERGE_OR_MIGRATE':
        tables[table] = await planKeyedMerge(query, table, cfg, pilotTenant, { fuzzy: true });
        break;
      case 'DELETE_LEGACY_SEED':
        tables[table] = await planDeleteLegacySeed(query, table);
        break;
      case 'KEEP_AS_HISTORY':
        tables[table] = await planKeepAsHistory(query, table);
        break;
      case 'SPECIAL_Z_REPORTS':
        tables[table] = await planZReports(query, pilotTenant);
        break;
      case 'SPECIAL_LEDGER':
        tables[table] = await planLedger(query, idMaps.products);
        break;
      case 'SPECIAL_STOCK_CACHE':
        tables[table] = await planStockCache(query, idMaps.warehouses, idMaps.products);
        break;
      case 'SPECIAL_QUEUE':
        tables[table] = await planSyncQueue(query, pilotTenant, idMaps);
        break;
      case 'SPECIAL_SINGLETON':
        tables[table] = await planStoreCatalogState(query, pilotTenant);
        break;
      case 'SPECIAL_COUNTER':
        tables[table] = await planKitchenTicketSeq(query, pilotTenant);
        break;
      case 'SPECIAL_LICENSE':
        tables[table] = await planLicenses(query);
        break;
      case 'SPECIAL_USERS':
        tables[table] = await planUsers(query, pilotTenant);
        break;
      default:
        hardFails.push({ kind: 'unhandled_strategy', table, strategy: cfg.strategy });
    }
  }

  // sync_state não aparece na descoberta genérica (tenant embutido no id, não numa coluna tenant_id) — planeado à parte.
  tables.sync_state = await planSyncState(query, pilotTenant);

  // Aviso informativo (nunca falha dura): sessões de caixa abertas sob tenant-1.
  const openSessions = await checkOpenCashSessions(query);
  if (openSessions > 0) {
    blockers.push({ table: 'cash_sessions', kind: 'open_cash_sessions_under_legacy_tenant', count: openSessions });
  }

  for (const [table, plan] of Object.entries(tables)) {
    for (const b of plan.blockers ?? []) blockers.push(b);
  }

  // 6) Reconciliação de contagens + prova de eliminação de tenant-1.
  const rowCountReconciliation = {};
  const remainingLegacyTables = [];
  for (const [table, plan] of Object.entries(tables)) {
    const requiresDecisionCount =
      (plan.blockers ?? []).filter((b) => b.table === table).length ||
      (plan.decisions ?? []).filter((d) => d.decision === 'REQUIRES_HUMAN_DECISION').length;
    const keepAsHistory = plan.strategy === 'KEEP_AS_HISTORY' ? plan.rowsAffected : 0;
    const resolved = Math.max(0, plan.rowsAffected - requiresDecisionCount - keepAsHistory);
    rowCountReconciliation[table] = {
      tenant1_rows_before: plan.rowsAffected,
      resolved_by_plan: resolved,
      kept_as_history: keepAsHistory,
      requires_human_decision: requiresDecisionCount,
      tenant1_rows_after_projected: requiresDecisionCount + keepAsHistory,
    };
    if (requiresDecisionCount + keepAsHistory > 0) {
      remainingLegacyTables.push({ table, remaining: requiresDecisionCount + keepAsHistory, isHistory: keepAsHistory > 0 && requiresDecisionCount === 0 });
    }
  }

  const nonHistoryRemaining = remainingLegacyTables.filter((r) => !r.isHistory);
  const tenant1DeleteProof = {
    satisfied: nonHistoryRemaining.length === 0,
    remaining_non_history_tables: nonHistoryRemaining,
    history_only_tables: remainingLegacyTables.filter((r) => r.isHistory).map((r) => r.table),
  };

  const SAFE_TO_APPLY = hardFails.length === 0 && blockers.length === 0 && tenant1DeleteProof.satisfied;

  return {
    generated_at: new Date(now()).toISOString(),
    pilot_tenant: sanitizeTenantId(pilotTenant),
    hard_fails: hardFails,
    blockers,
    tables,
    row_count_reconciliation: rowCountReconciliation,
    tenant1_delete_proof: tenant1DeleteProof,
    offline_license_check: offlineLicenseCheck,
    env_check: envCheck,
    SAFE_TO_APPLY,
  };
}
