import { URL, fileURLToPath } from 'url';
import crypto from 'crypto';
import path from 'path';
import dotenv from 'dotenv';
import { all, get, run } from './dbUtils.js';
import { isUuidString, requireProductCloudId } from './cloudIdUtils.js';
import { logSyncError, logSyncOperation } from './syncLogger.js';
import { logError, logEvent, logWarn } from './utils/logger.js';
import { ensureHashedPin, verifyPinAgainstStored, isBcryptHash } from './pinAuth.js';
import { consolidateActiveAdmins } from './services/user.service.js';
import { getDeviceSupabase, isDeviceAuthAvailable } from './deviceAuth/deviceSupabaseClient.js';
import { classifySyncError, isRetryableWithoutPenalty, isDefinitive, SYNC_ERROR_KIND } from './deviceAuth/deviceSyncErrors.js';
import { toPgBoolean, fromPgBoolean } from './deviceAuth/pgBoolean.js';
import {
  collectLedgerGroups,
  collectOpeningGroups,
  computeReconciliation,
  ensureStockLedgerTables,
  markMovementPulled,
  recordLedgerResults,
  recordZeroOpenings,
  SYNCABLE as STOCK_LEDGER_SYNCABLE_LIST,
} from './stockLedgerSync.js';
import { applyStoreProductRows } from './services/storeCatalog.service.js';
import { refreshProductStockCache, upsertWarehouseStockDelta } from './repositories/warehouses.repository.js';
import {
  applyCloudCancellation,
  applyRemoteTransfers,
  collectPendingTransfers,
  markPushed,
} from './services/storeTransfers.service.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({
  path: path.resolve(__dirname, '../.env'),
});
// Etapa 1F.2 (itens 6/32/33): o novo caminho de sync usa Device JWT + anon key
// — nunca SUPABASE_SERVICE_ROLE_KEY (ver getSupabase() abaixo). O log confirma
// isto no arranque: se SUPABASE_ANON_KEY estiver ausente, getSupabase() devolve
// null e o sync fica pausado (nunca cai para service_role).
console.log('[SYNC ENV CHECK]', {
  url: process.env.SUPABASE_URL,
  anonKey: !!(process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
});

const MAX_RETRIES = 5;
const DEFAULT_INTERVAL_MS = Number(process.env.SYNC_INTERVAL_MS ?? 10000);
const MAX_ITEMS_PER_CYCLE = Number(process.env.SYNC_BATCH_SIZE ?? 25);
const LOCK_TIMEOUT_MS = Number(process.env.SYNC_LOCK_TIMEOUT_MS ?? 60000);
const PARALLEL_WORKERS = Math.min(5, Math.max(1, Number(process.env.SYNC_PARALLEL_WORKERS ?? 5)));

function requirePayloadTenantId(payload, contextLabel) {
  const tenantId = String(payload?.tenant_id ?? '').trim();
  if (tenantId) return tenantId;
  throw new Error(`Missing tenant_id in ${contextLabel}`);
}

function requireTenantId(tenantCandidate, contextLabel) {
  const tenantId = String(tenantCandidate ?? '').trim();
  if (tenantId && tenantId !== '__missing_tenant__') return tenantId;
  throw new Error(`Missing tenant_id in ${contextLabel}`);
}

async function listSyncTenantIds() {
  // Instalação single-tenant (POS local / dev-tenant): nunca misturar outros tenants no mesmo SQLite.
  // Ordem tem de coincidir com listLoginUsers() (user.service.js) — DEFAULT_TENANT_ID primeiro —
  // senão um .env.local que só defina uma das duas variáveis faz o sync e o ecrã de login
  // resolverem tenants diferentes em silêncio.
  const installationTenantId = String(
    process.env.DEFAULT_TENANT_ID || process.env.POS_DEV_TENANT || ''
  ).trim();
  if (installationTenantId) return [installationTenantId];

  if (await tableExists('tenants')) {
    const rows = await all(
      `SELECT id
       FROM tenants
       WHERE TRIM(COALESCE(id, '')) <> ''
       ORDER BY id ASC`
    );
    const fromTenants = (rows ?? []).map((row) => String(row?.id ?? '').trim()).filter(Boolean);
    if (fromTenants.length > 0) return fromTenants;
  }

  if (await tableExists('users')) {
    const rows = await all(
      `SELECT DISTINCT tenant_id
       FROM users
       WHERE TRIM(COALESCE(tenant_id, '')) <> ''
       ORDER BY tenant_id ASC`
    );
    const fromUsers = (rows ?? []).map((row) => String(row?.tenant_id ?? '').trim()).filter(Boolean);
    if (fromUsers.length > 0) return fromUsers;
  }

  throw new Error('No tenants found for sync processing');
}

// Etapa 1F.2 (item 7): getSupabase() é agora o ÚNICO ponto de acesso a
// Supabase deste ficheiro, e devolve sempre o cliente autenticado por Device
// JWT (api/deviceAuth/deviceSupabaseClient.js) — nunca o cliente legado
// privilegiado de api/supabaseClient.js (esse continua a existir fisicamente,
// usado só por api/stockController.js, fora do escopo desta etapa; nunca é
// importado aqui). Sem fallback: se o Device JWT não estiver disponível, cada
// função que chama getSupabase() recebe null e pausa (mesmo padrão de sempre
// nesta base de código), nunca tenta service_role.
function getSupabase() {
  return getDeviceSupabase();
}

let timer = null;
// Pausa explícita do operador (Pilot Gate — prova isolada de Device Auth):
// parar só o setInterval não chega, porque users.controller.js e POST /sync/run
// também chamam os ciclos directamente. Enquanto verdadeiro, os 3 pontos de
// entrada (full/pull/queue) devolvem já no topo, antes de qualquer log, rede,
// revive ou acesso à fila.
let operatorPaused = false;
let isRunning = false;
let isPullRunning = false;
let isFullResetRunning = false;
let lastConnectivityState = null;
let lastConnectivityCheckAt = 0;
let lastConnectivityResult = false;

function isNetworkOfflineError(error) {
  const code = String(error?.code ?? error?.cause?.code ?? '').toUpperCase();
  const message = String(error?.message ?? '').toLowerCase();
  const causeMessage = String(error?.cause?.message ?? '').toLowerCase();
  return (
    code === 'ENOTFOUND' ||
    code === 'ECONNREFUSED' ||
    code === 'ETIMEDOUT' ||
    message.includes('enotfound') ||
    message.includes('econnrefused') ||
    message.includes('fetch failed') ||
    message.includes('networkerror') ||
    message.includes('internet_check_timeout') ||
    causeMessage.includes('enotfound') ||
    causeMessage.includes('econnrefused') ||
    causeMessage.includes('fetch failed')
  );
}

function getBackoffMs(retries) {
  const safeRetries = Math.max(0, Number(retries) || 0);
  const baseSeconds = Math.min(300, 5 * 2 ** safeRetries);
  const jitter = Math.floor(Math.random() * 1000);
  return baseSeconds * 1000 + jitter;
}

function createSummary() {
  return {
    processed: 0,
    success: 0,
    failed: 0,
    dead: 0,
    skipped: false,
    reason: null,
  };
}

function createPullSummary() {
  return {
    processed: 0,
    inserted: 0,
    updated: 0,
    skipped: 0,
    conflicts: 0,
    stock_inserted: 0,
    stock_reconciled: 0,
    skippedEntities: [],
    skipped: false,
    reason: null,
  };
}

function normalizeNonEmptyText(value) {
  const normalized = String(value ?? '').trim();
  if (!normalized) return null;
  const lowered = normalized.toLowerCase();
  if (lowered === 'null' || lowered === 'undefined') return null;
  return normalized;
}

async function isInternetAvailable() {
  const now = Date.now();
  if (now - lastConnectivityCheckAt < 2000) {
    return lastConnectivityResult;
  }

  const timeoutMs = 3000;
  const baseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://www.google.com';
  let probeUrl = 'https://www.google.com';
  try {
    const parsed = new URL(baseUrl);
    probeUrl = parsed.origin;
  } catch {
    probeUrl = 'https://www.google.com';
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(new Error('internet_check_timeout')), timeoutMs);
    try {
      // Any HTTP response means network is reachable.
      await fetch(probeUrl, {
        method: 'HEAD',
        cache: 'no-store',
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }
    lastConnectivityResult = true;
    lastConnectivityCheckAt = Date.now();
    return true;
  } catch (error) {
    if (!isNetworkOfflineError(error)) {
      console.warn('[sync][connectivity] probe failed with non-network error', {
        message: String(error?.message ?? error),
      });
    }
    lastConnectivityResult = false;
    lastConnectivityCheckAt = Date.now();
    return false;
  }
}

async function logConnectivityTransition(isOnline, context = {}) {
  if (lastConnectivityState === isOnline) return;
  lastConnectivityState = isOnline;
  if (!isOnline) {
    await logSyncOperation('connectivity-offline', context, 'Ligação à cloud perdida — ciclos de sync em pausa', {
      level: 'warn',
    });
  } else {
    await logSyncOperation('connectivity-online', context, 'Ligação à cloud restabelecida — ciclos de sync retomados');
  }
}

function normalizeTimestamp(value) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

// Utilizadores que o push ignora por politica/estado: registar UMA vez por processo (nunca em cada ciclo de 10s).
const skippedUserPushLogged = new Set();
async function logSkippedUserPushOnce(type, cloudUserId, message) {
  const key = `${type}:${cloudUserId}`;
  if (skippedUserPushLogged.has(key)) return;
  skippedUserPushLogged.add(key);
  await logSyncOperation(type, { cloud_user_id: cloudUserId }, message, { level: 'info' });
}

function isRemoteNewer(remoteTs, localTs) {
  const remote = normalizeTimestamp(remoteTs);
  const local = normalizeTimestamp(localTs);
  if (!remote) return false;
  if (!local) return true;
  return new Date(remote).getTime() > new Date(local).getTime();
}

function toSafeString(value) {
  return value != null ? String(value) : null;
}

function isUUID(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(value || '').trim()
  );
}

async function resolveCustomerUUID(id, tenantId) {
  if (!id) return null;
  const normalized = String(id).trim();
  if (isUUID(normalized)) return normalized;
  const scopedTenantId = requireTenantId(tenantId, 'resolveCustomerUUID');
  const row = await get(
    `SELECT cloud_id
     FROM clientes
     WHERE id = ?
       AND tenant_id = ?
     LIMIT 1`,
    [Number(normalized), scopedTenantId]
  );
  const cloudId = row?.cloud_id ? String(row.cloud_id).trim() : null;
  return cloudId && isUUID(cloudId) ? cloudId : null;
}

async function ensureCustomerSynced(selectedCustomerId, tenantId) {
  const customerUUID = await resolveCustomerUUID(selectedCustomerId, tenantId);
  if (!customerUUID && selectedCustomerId) {
    await logSyncOperation(
      'sync-customer-mapping-invalid',
      { tenant_id: tenantId, selected_customer_id: selectedCustomerId },
      'Mapeamento de cliente inválido ao sincronizar',
      { level: 'warn' },
    );
  }
  return customerUUID;
}

async function getLastSyncAt(syncId) {
  const row = await get(`SELECT last_sync_at FROM sync_state WHERE id = ?`, [syncId]);
  return row?.last_sync_at ?? '1970-01-01T00:00:00.000Z';
}

async function setLastSyncAt(syncId, lastSyncAt) {
  const safeTs = normalizeTimestamp(lastSyncAt) || new Date().toISOString();
  await run(
    `INSERT INTO sync_state (id, last_sync_at)
     VALUES (?, ?)
     ON CONFLICT(id) DO UPDATE SET last_sync_at = excluded.last_sync_at`,
    [syncId, safeTs]
  );
}

async function fetchUpdatedRows(table, fields, lastSyncAt, timestampField = 'updated_at', tenantId = null) {
  const supabase = getSupabase();
  if (!supabase) return [];
  const pageSize = 500;
  let page = 0;
  const rows = [];
  const tenantScopedTables = ['categories', 'products', 'customers', 'users', 'orders', 'order_items', 'stock_movements', 'store_products', 'device_stock_transfers'];
  const normalizedTable = String(table);
  const scopedTenantId =
    tenantScopedTables.includes(normalizedTable) ? requireTenantId(tenantId, `fetchUpdatedRows:${normalizedTable}`) : null;
  while (true) {
    const from = page * pageSize;
    const to = from + pageSize - 1;
    let query = supabase.from(table).select(fields).gt(timestampField, lastSyncAt).order(timestampField, { ascending: true });
    if (scopedTenantId) {
      query = query.eq('tenant_id', scopedTenantId);
    }
    let { data, error } = await query.range(from, to);
    if (error && (String(error.message || '').includes('column') || String(error.code || '') === '42703') && timestampField !== 'created_at') {
      query = supabase.from(table).select(fields).gt('created_at', lastSyncAt).order('created_at', { ascending: true });
      if (scopedTenantId) {
        query = query.eq('tenant_id', scopedTenantId);
      }
      ({ data, error } = await query.range(from, to));
    }
    if (error) throw error;
    const chunk = data ?? [];
    rows.push(...chunk);
    if (chunk.length < pageSize) break;
    page += 1;
  }
  return rows;
}

async function fetchAllRows(table, fields, orderByField = 'created_at', tenantId = null) {
  const supabase = getSupabase();
  if (!supabase) return [];
  const pageSize = 500;
  let page = 0;
  const rows = [];
  const tenantScopedTables = ['categories', 'products', 'customers', 'users', 'orders', 'order_items', 'stock_movements'];
  const normalizedTable = String(table);
  const scopedTenantId =
    tenantScopedTables.includes(normalizedTable) ? requireTenantId(tenantId, `fetchAllRows:${normalizedTable}`) : null;
  while (true) {
    const from = page * pageSize;
    const to = from + pageSize - 1;
    let query = supabase.from(table).select(fields);
    if (scopedTenantId) {
      query = query.eq('tenant_id', scopedTenantId);
    }
    if (orderByField) {
      query = query.order(orderByField, { ascending: true });
    }
    let { data, error } = await query.range(from, to);
    if (error && orderByField === 'updated_at') {
      query = supabase.from(table).select(fields).order('created_at', { ascending: true });
      if (scopedTenantId) {
        query = query.eq('tenant_id', scopedTenantId);
      }
      ({ data, error } = await query.range(from, to));
    }
    if (error) throw error;
    const chunk = data ?? [];
    rows.push(...chunk);
    if (chunk.length < pageSize) break;
    page += 1;
  }
  return rows;
}

async function tableExists(tableName) {
  const row = await get(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`, [tableName]);
  return Boolean(row?.name);
}

async function loadCategoryTombstoneSets(tenantId) {
  if (!(await tableExists('deleted_category_tombstones'))) {
    return { cloudIds: new Set(), names: new Set() };
  }
  const scopedTenantId = requireTenantId(tenantId, 'loadCategoryTombstoneSets');
  const tombstones = await all(
    `SELECT cloud_id, name
     FROM deleted_category_tombstones
     WHERE tenant_id = ?`,
    [scopedTenantId]
  );
  const cloudIds = new Set(
    (tombstones ?? []).map((item) => String(item?.cloud_id ?? '').trim()).filter(Boolean)
  );
  const names = new Set(
    (tombstones ?? []).map((item) => String(item?.name ?? '').trim().toLowerCase()).filter(Boolean)
  );
  return { cloudIds, names };
}

function isRemoteCategoryTombstoned(row, tombstoneCloudIds, tombstoneNames) {
  const remoteCloudId = String(row?.id ?? '').trim();
  const remoteName = String(row?.name ?? '').trim().toLowerCase();
  return (
    (remoteCloudId && tombstoneCloudIds.has(remoteCloudId)) ||
    (remoteName && tombstoneNames.has(remoteName))
  );
}

/** Remove local category rows that the user explicitly deleted (tombstones). Stops cloud pull from resurrecting them. */
async function purgeLocalCategoriesMatchingTombstones(tenantId) {
  if (!(await tableExists('deleted_category_tombstones'))) return;
  const scopedTenantId = requireTenantId(tenantId, 'purgeLocalCategoriesMatchingTombstones');
  const tombstones = await all(
    `SELECT cloud_id, name
     FROM deleted_category_tombstones
     WHERE tenant_id = ?`,
    [scopedTenantId]
  );
  for (const t of tombstones ?? []) {
    const cid = String(t?.cloud_id ?? '').trim();
    const nm = String(t?.name ?? '').trim();
    if (cid) {
      await run(`DELETE FROM categories WHERE tenant_id = ? AND cloud_id = ?`, [scopedTenantId, cid]);
    }
    if (nm) {
      await run(`DELETE FROM categories WHERE tenant_id = ? AND LOWER(TRIM(COALESCE(name, ''))) = LOWER(?)`, [scopedTenantId, nm]);
    }
  }
}

async function mapCategoryIdFromCloud(cloudCategoryId, tenantId) {
  if (!cloudCategoryId) return null;
  const scopedTenantId = requireTenantId(tenantId, 'mapCategoryIdFromCloud');
  const local = await get(
    `SELECT id
     FROM categories
     WHERE cloud_id = ?
       AND tenant_id = ?
     LIMIT 1`,
    [String(cloudCategoryId), scopedTenantId]
  );
  return local?.id ?? null;
}

async function mapCategoryCloudIdFromLocal(localCategoryId, tenantId) {
  const localIdNumber = Number(localCategoryId);
  if (!Number.isFinite(localIdNumber)) return null;
  const scopedTenantId = requireTenantId(tenantId, 'mapCategoryCloudIdFromLocal');
  const row = await get(
    `SELECT cloud_id
     FROM categories
     WHERE id = ?
       AND tenant_id = ?
     LIMIT 1`,
    [localIdNumber, scopedTenantId]
  );
  const cloudId = row?.cloud_id ? String(row.cloud_id).trim() : '';
  return cloudId || null;
}

async function mapProductIdFromCloud(cloudProductId, tenantId) {
  if (!cloudProductId) return null;
  const scopedTenantId = requireTenantId(tenantId, 'mapProductIdFromCloud');
  const local = await get(
    `SELECT id
     FROM products
     WHERE cloud_id = ?
       AND tenant_id = ?
     LIMIT 1`,
    [String(cloudProductId), scopedTenantId]
  );
  return local?.id ?? null;
}

/** Copia os itens de uma encomenda da cloud para os itens locais de `localOrderId`. */
async function pullOrderItemsForLocalOrder(supabase, cloudOrderId, localOrderId, tenantId) {
  // Etapa 1F.2: `updated_at`/`unit_cost`/`cogs_total` removidos do SELECT —
  // não existem em order_items no baseline novo (só id, tenant_id, order_id,
  // product_id, product_name, quantity, price, discount_amount, created_at —
  // ver 20260915000700_sales.sql). Colunas legadas de um schema cloud diferente.
  const { data: cloudItems, error } = await supabase
    .from('order_items')
    .select('id,product_id,product_name,quantity,price,discount_amount,created_at')
    .eq('order_id', cloudOrderId);
  if (error) throw error;
  for (const item of cloudItems || []) {
    const localProductId = await mapProductIdFromCloud(item.product_id, tenantId);
    const createdAt = normalizeTimestamp(item.created_at) || new Date().toISOString();
    await run(
      `INSERT INTO order_items
        (id, order_id, tenant_id, product_id, product_name, quantity, price, discount_amount, created_at, updated_at, cloud_id, unit_cost, cogs_total)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        crypto.randomUUID(),
        String(localOrderId),
        tenantId,
        localProductId != null ? String(localProductId) : String(item.product_id ?? ''),
        String(item.product_name ?? 'Item'),
        Number(item.quantity ?? 0),
        Number(item.price ?? 0),
        Number(item.discount_amount ?? 0),
        createdAt,
        createdAt,
        String(item.id ?? ''),
        0,
        0,
      ],
    );
  }
}

/**
 * Traz para a BD local o histórico de documentos (vendas 'VD', faturas 'FT', etc.) que já
 * existe na cloud para este tenant — ex: uma instalação nova/reinstalada, ou um segundo
 * terminal, que ativa uma licença de um tenant já usado noutro lado. Sem isto, a geração
 * local do próximo número de documento não tinha visibilidade sobre este histórico (ver
 * fetchCloudTakenDocumentNumbers, que resolve o mesmo problema do lado do push).
 *
 * Só insere — nunca apaga nem sobrescreve um documento local já existente — e nunca mexe
 * em stock (isso já é sincronizado à parte via products/stock_movements).
 */
async function syncOrdersFromCloud(summary, tenantId) {
  const scopedTenantId = requireTenantId(tenantId, 'syncOrdersFromCloud');
  const supabase = getSupabase();
  if (!supabase) return summary;

  const syncId = `cloud:orders:${scopedTenantId}`;
  const lastSyncAt = await getLastSyncAt(syncId);
  const rows = await fetchUpdatedRows(
    'orders',
    'id,customer_id,table_number,total,subtotal,tax,discount,payment_method,received_amount,change_amount,status,created_at,doc_type,document_number,local_sale_id,tenant_id,updated_at',
    lastSyncAt,
    'updated_at',
    scopedTenantId,
  );
  let maxTs = lastSyncAt;

  for (const row of rows) {
    const remoteTs = normalizeTimestamp(row.updated_at || row.created_at) || new Date().toISOString();
    if (isRemoteNewer(remoteTs, maxTs)) maxTs = remoteTs;
    summary.processed += 1;

    const docType = String(row.doc_type || 'VD').trim().toUpperCase();
    const documentNumber = String(row.document_number || '').trim();
    const createdAt = normalizeTimestamp(row.created_at) || remoteTs;
    if (!documentNumber) {
      summary.skipped += 1;
      continue;
    }

    try {
      if (docType === 'VD') {
        const match = /^[A-Z]+\/(\d{4})\/(\d+)$/.exec(documentNumber);
        if (!match) {
          summary.skipped += 1;
          continue;
        }
        const [, year, sequenceRaw] = match;
        const sequence = parseInt(sequenceRaw, 10);

        const existing = await get(
          `SELECT id FROM vendas
            WHERE tenant_id = ?
              AND UPPER(COALESCE(doc_type, 'VD')) = 'VD'
              AND CAST(COALESCE(doc_sequence, id) AS INTEGER) = ?
              AND strftime('%Y', data) = ?
            LIMIT 1`,
          [scopedTenantId, sequence, year],
        );
        if (existing?.id) {
          summary.skipped += 1;
          continue;
        }

        const insertResult = await run(
          `INSERT INTO vendas
            (total, data, doc_type, doc_sequence, status, customer_id, customer_name, payment_method, user_id, user_name, tenant_id, register_code)
           VALUES (?, ?, 'VD', ?, ?, ?, NULL, ?, NULL, NULL, ?, NULL)`,
          [
            Number(row.total ?? 0),
            createdAt,
            sequence,
            row.status ?? 'completed',
            row.customer_id ?? null,
            row.payment_method ?? null,
            scopedTenantId,
          ],
        );
        const localOrderId = insertResult?.lastID;
        if (!localOrderId) {
          summary.skipped += 1;
          continue;
        }
        await pullOrderItemsForLocalOrder(supabase, row.id, localOrderId, scopedTenantId);
        summary.inserted += 1;
      } else {
        const existing = await get(
          `SELECT id FROM orders WHERE tenant_id = ? AND document_number = ? LIMIT 1`,
          [scopedTenantId, documentNumber],
        );
        if (existing?.id) {
          summary.skipped += 1;
          continue;
        }

        const localOrderId = String(row.id);
        await run(
          `INSERT INTO orders
            (id, customer_id, tenant_id, table_number, total, subtotal, tax, discount, payment_method,
             received_amount, change_amount, status, local_sale_id, doc_type, document_number, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            localOrderId,
            row.customer_id ?? null,
            scopedTenantId,
            row.table_number ?? null,
            Number(row.total ?? 0),
            Number(row.subtotal ?? 0),
            Number(row.tax ?? 0),
            Number(row.discount ?? 0),
            row.payment_method ?? null,
            row.received_amount ?? null,
            row.change_amount ?? null,
            row.status ?? null,
            row.local_sale_id ?? null,
            docType,
            documentNumber,
            createdAt,
            remoteTs,
          ],
        );
        await pullOrderItemsForLocalOrder(supabase, row.id, localOrderId, scopedTenantId);
        summary.inserted += 1;
      }
    } catch (error) {
      summary.errors = (summary.errors ?? 0) + 1;
      await logSyncError({ type: 'pull-orders-row', payload: { document_number: documentNumber, doc_type: docType }, error });
    }
  }

  await setLastSyncAt(syncId, maxTs);
  return summary;
}

/**
 * Garante que a categoria local existe na cloud antes de upsert de produto.
 * Evita 23503 products_category_id_fkey quando o produto sobe antes do item category na fila.
 */
async function ensureLocalCategoryOnCloud(localCategoryId, tenantId, seen = new Set()) {
  const localIdNumber = Number(localCategoryId);
  if (!Number.isFinite(localIdNumber)) return null;
  if (seen.has(localIdNumber)) return null;
  seen.add(localIdNumber);

  const scopedTenantId = requireTenantId(tenantId, 'ensureLocalCategoryOnCloud');
  const row = await get(
    `SELECT id, cloud_id, name, parent_id, color, updated_at
     FROM categories
     WHERE id = ?
       AND tenant_id = ?
     LIMIT 1`,
    [localIdNumber, scopedTenantId]
  );
  if (!row) return null;

  const cloudId = row.cloud_id ? String(row.cloud_id).trim() : '';
  if (!isUuidString(cloudId)) return null;

  if (row.parent_id != null) {
    await ensureLocalCategoryOnCloud(row.parent_id, scopedTenantId, seen);
  }

  await syncCategory({
    id: row.id,
    cloud_id: cloudId,
    name: row.name,
    parent_id: row.parent_id,
    color: row.color,
    updated_at: row.updated_at,
    tenant_id: scopedTenantId,
    deleted: false,
  });

  return cloudId;
}

async function resolveProductCloudId(localProductId, tenantId) {
  const effectiveTenantId = requireTenantId(tenantId, 'resolveProductCloudId');
  const row = await get(
    `SELECT cloud_id
     FROM products
     WHERE id = ?
       AND tenant_id = ?
       AND COALESCE(deleted, 0) = 0
     LIMIT 1`,
    [Number(localProductId), effectiveTenantId]
  );
  const cid = row?.cloud_id;
  if (!cid || !isUuidString(String(cid))) return null;
  return String(cid).trim();
}

async function syncCategoriesFromCloud(summary, tenantId) {
  const scopedTenantId = requireTenantId(tenantId, 'syncCategoriesFromCloud');
  const syncId = `cloud:categories:${scopedTenantId}`;
  const lastSyncAt = await getLastSyncAt(syncId);
  const rows = await fetchUpdatedRows(
    'categories',
    'id,tenant_id,name,parent_id,color,updated_at,created_at',
    lastSyncAt,
    'updated_at',
    scopedTenantId
  );
  const { cloudIds: tombstoneCloudIds, names: tombstoneNames } = await loadCategoryTombstoneSets(scopedTenantId);
  await purgeLocalCategoriesMatchingTombstones(scopedTenantId);
  let maxTs = lastSyncAt;

  for (const row of rows) {
    if (isRemoteCategoryTombstoned(row, tombstoneCloudIds, tombstoneNames)) {
      summary.skipped += 1;
      continue;
    }
    const remoteTs = normalizeTimestamp(row.updated_at || row.created_at) || new Date().toISOString();
    if (isRemoteNewer(remoteTs, maxTs)) maxTs = remoteTs;
    const existing = await get(
      `SELECT id, updated_at, name
       FROM categories
       WHERE tenant_id = ?
         AND (cloud_id = ? OR name = ?)
       LIMIT 1`,
      [scopedTenantId, String(row.id), row.name]
    );

    const parentLocalId = await mapCategoryIdFromCloud(row.parent_id, scopedTenantId);
    summary.processed += 1;
    if (!existing) {
      try {
        await run(
          `INSERT INTO categories (name, parent_id, cloud_id, updated_at, tenant_id, color) VALUES (?, ?, ?, ?, ?, ?)`,
          [row.name, parentLocalId, String(row.id), remoteTs, scopedTenantId, row.color ? String(row.color) : null]
        );
        summary.inserted += 1;
      } catch (insertErr) {
        const isUniqueNameError =
          String(insertErr?.code ?? '') === 'SQLITE_CONSTRAINT' &&
          String(insertErr?.message ?? '').includes('UNIQUE constraint failed: categories.name');
        if (!isUniqueNameError) throw insertErr;

        // Recover from duplicate-name collisions by binding the remote cloud_id
        // to the existing local category with same normalized name.
        const byName = await get(
          `SELECT id, updated_at
           FROM categories
           WHERE tenant_id = ?
             AND LOWER(TRIM(COALESCE(name, ''))) = LOWER(TRIM(?))
           LIMIT 1`,
          [scopedTenantId, String(row.name ?? '')]
        );
        if (!byName?.id) throw insertErr;

        await run(
          `UPDATE categories
           SET name = ?, parent_id = ?, cloud_id = ?, updated_at = ?, color = ?
           WHERE id = ?
             AND tenant_id = ?`,
          [row.name, parentLocalId, String(row.id), remoteTs, row.color ? String(row.color) : null, Number(byName.id), scopedTenantId]
        );
        summary.updated += 1;
      }
      continue;
    }

    if (!isRemoteNewer(remoteTs, existing.updated_at)) {
      summary.skipped += 1;
      continue;
    }

    await run(
      `UPDATE categories
       SET name = ?, parent_id = ?, cloud_id = ?, updated_at = ?, color = ?
       WHERE id = ?
         AND tenant_id = ?`,
      [row.name, parentLocalId, String(row.id), remoteTs, row.color ? String(row.color) : null, existing.id, scopedTenantId]
    );
    summary.updated += 1;
  }

  // Reconcile deletions from cloud: remove local categories that no longer exist remotely.
  // This prevents categories deleted locally->cloud from being resurrected on pull.
  // IMPORTANT: never delete locals that still have outbound sync pending/failed — that
  // deletes freshly created groups before they reach the cloud (or after a failed push).
  try {
    const remoteRows = await fetchAllRows('categories', 'id', 'id', scopedTenantId);
    const remoteIds = new Set((remoteRows ?? []).map((item) => String(item.id)));
    const localCategories = await all(
      `SELECT id, cloud_id
       FROM categories
       WHERE tenant_id = ?
         AND cloud_id IS NOT NULL
         AND TRIM(cloud_id) <> ''`,
      [scopedTenantId]
    );

    let pendingCloudIds = new Set();
    try {
      const pendingRows = await all(
        `SELECT data
         FROM sync_queue
         WHERE tenant_id = ?
           AND type = 'category'
           AND status IN ('pending', 'failed', 'dead', 'processing')`,
        [scopedTenantId]
      );
      pendingCloudIds = new Set(
        (pendingRows || [])
          .map((row) => {
            try {
              const payload = typeof row.data === 'string' ? JSON.parse(row.data) : row.data;
              return payload?.cloud_id ? String(payload.cloud_id).trim() : '';
            } catch {
              return '';
            }
          })
          .filter(Boolean)
      );
    } catch {
      pendingCloudIds = new Set();
    }

    const toDelete = (localCategories ?? []).filter((item) => {
      const cid = String(item.cloud_id);
      if (remoteIds.has(cid)) return false;
      if (pendingCloudIds.has(cid)) return false;
      return true;
    });
    // Evitar wipe: se a cloud ainda não tem categorias deste tenant, não apagar locals.
    if (remoteIds.size === 0 && toDelete.length > 0) {
      await logSyncOperation(
        'pull-categories-delete-skip',
        { tenant_id: scopedTenantId, pending_deletes: toDelete.length },
        'skipped category reconcile delete because cloud has zero categories for tenant'
      );
    } else {
      for (const item of toDelete) {
        const removeResult = await run(`DELETE FROM categories WHERE id = ? AND tenant_id = ?`, [
          Number(item.id),
          scopedTenantId,
        ]);
        if (Number(removeResult?.changes ?? 0) > 0) {
          summary.updated += 1;
        }
      }
    }
  } catch (deleteSyncError) {
    await logSyncOperation(
      'pull-categories-delete-skip',
      { reason: String(deleteSyncError?.message || deleteSyncError) },
      'failed to reconcile deleted categories from cloud'
    );
  }

  await purgeLocalCategoriesMatchingTombstones(scopedTenantId);

  if (rows.length > 0) {
    await setLastSyncAt(syncId, maxTs);
    await logSyncOperation(
      'pull-categories',
      { tenant_id: scopedTenantId, count: rows.length, last_sync_at: maxTs },
      'categories synced from cloud'
    );
  }
}

async function syncProductsFromCloud(summary, tenantId) {
  const scopedTenantId = requireTenantId(tenantId, 'syncProductsFromCloud');
  const syncId = `cloud:products:${scopedTenantId}`;
  const lastSyncAt = await getLastSyncAt(syncId);
  const rows = await fetchUpdatedRows(
    'products',
    // Etapa 1F.2: `image_url` removido — não existe no baseline novo
    // (supabase/migrations/20260915000300_catalog.sql), só
    // `image`. Mantinha-se no código antigo por causa de um schema legado
    // diferente; o novo caminho de sync (device JWT) só fala com o baseline novo.
    'id,tenant_id,code,name,category_id,barcode,cost,price,tax,final_price,active,unit,description,age_restriction,is_service,default_quantity,stock_quantity,min_stock,color,image,local_id,deleted,created_at,updated_at',
    lastSyncAt,
    'updated_at',
    scopedTenantId
  );
  let maxTs = lastSyncAt;

  for (const row of rows) {
    const remoteTs = normalizeTimestamp(row.updated_at || row.created_at) || new Date().toISOString();
    if (isRemoteNewer(remoteTs, maxTs)) maxTs = remoteTs;
    const categoryLocalId = await mapCategoryIdFromCloud(row.category_id, scopedTenantId);
    const existing = await get(
      `SELECT id, updated_at, image, track_lot
       FROM products
       WHERE cloud_id = ?
         AND tenant_id = ?
       LIMIT 1`,
      [String(row.id), scopedTenantId]
    );
    summary.processed += 1;

    const remoteImageRaw = row.image ?? row.image_url ?? null;
    const normalizedRemoteImage = typeof remoteImageRaw === 'string' ? remoteImageRaw.trim() : remoteImageRaw;
    const mappedImage = normalizedRemoteImage || existing?.image || null;

    // track_lot é local-first até a coluna existir de forma fiável na cloud.
    const remoteHasTrackLot = Object.prototype.hasOwnProperty.call(row, 'track_lot') && row.track_lot != null;
    const trackLotValue = remoteHasTrackLot
      ? row.track_lot === true || Number(row.track_lot) === 1
        ? 1
        : 0
      : Number(existing?.track_lot ?? 0) === 1
        ? 1
        : 0;

    const mapped = {
      cloud_id: String(row.id),
      code: row.code == null ? null : Number(row.code),
      name: row.name,
      category_id: categoryLocalId,
      barcode: row.barcode ?? null,
      cost: Number(row.cost ?? 0),
      price: Number(row.price ?? 0),
      tax: Number(row.tax ?? 0),
      final_price: Number(row.final_price ?? row.price ?? 0),
      active: row.active === false ? 0 : 1,
      unit: row.unit ?? 'un',
      description: row.description ?? null,
      age_restriction: row.age_restriction == null ? null : Number(row.age_restriction),
      is_service: row.is_service ? 1 : 0,
      default_quantity: row.default_quantity === false ? 0 : 1,
      track_lot: trackLotValue,
      stock_quantity: Number(row.stock_quantity ?? 0),
      min_stock: Number(row.min_stock ?? 0),
      color: row.color ?? null,
      image: mappedImage,
      // Etapa 1F.2 (item 17): mapeamento explícito Postgres BOOLEAN -> SQLite 0/1.
      deleted: fromPgBoolean(row.deleted),
      tenant_id: scopedTenantId,
      created_at: normalizeTimestamp(row.created_at) || remoteTs,
      updated_at: remoteTs,
    };

    if (!existing) {
      await run(
        `INSERT INTO products
          (cloud_id, tenant_id, code, name, category_id, barcode, cost, price, tax, final_price, active, unit, description, age_restriction, is_service, default_quantity, track_lot, stock_quantity, min_stock, color, image, deleted, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          mapped.cloud_id,
          mapped.tenant_id,
          mapped.code,
          mapped.name,
          mapped.category_id,
          mapped.barcode,
          mapped.cost,
          mapped.price,
          mapped.tax,
          mapped.final_price,
          mapped.active,
          mapped.unit,
          mapped.description,
          mapped.age_restriction,
          mapped.is_service,
          mapped.default_quantity,
          mapped.track_lot,
          mapped.stock_quantity,
          mapped.min_stock,
          mapped.color,
          mapped.image,
          mapped.deleted,
          mapped.created_at,
          mapped.updated_at,
        ]
      );
      summary.inserted += 1;
      continue;
    }

    if (!isRemoteNewer(remoteTs, existing.updated_at)) {
      summary.skipped += 1;
      continue;
    }

    // Stock é local-first (inventário rápido / entradas / vendas locais).
    // Nunca sobrescrever stock_quantity no pull do catálogo da cloud.
    await run(
      `UPDATE products SET
        code = ?, name = ?, category_id = ?, barcode = ?, cost = ?, price = ?, tax = ?, final_price = ?, active = ?, unit = ?,
        description = ?, age_restriction = ?, is_service = ?, default_quantity = ?, track_lot = ?, min_stock = ?, color = ?, image = ?, deleted = ?, tenant_id = ?, updated_at = ?
       WHERE id = ?`,
      [
        mapped.code,
        mapped.name,
        mapped.category_id,
        mapped.barcode,
        mapped.cost,
        mapped.price,
        mapped.tax,
        mapped.final_price,
        mapped.active,
        mapped.unit,
        mapped.description,
        mapped.age_restriction,
        mapped.is_service,
        mapped.default_quantity,
        mapped.track_lot,
        mapped.min_stock,
        mapped.color,
        mapped.image,
        mapped.deleted,
        mapped.tenant_id,
        mapped.updated_at,
        existing.id,
      ]
    );
    summary.updated += 1;
  }

  if (rows.length > 0) {
    await setLastSyncAt(syncId, maxTs);
    await logSyncOperation(
      'pull-products',
      { tenant_id: scopedTenantId, count: rows.length, last_sync_at: maxTs },
      'products synced from cloud'
    );
  }

  // Stock reconciliation from cloud intentionally disabled.
  // Local POS owns stock_quantity (inventário rápido, entradas WH/IN, vendas).
}

async function syncCustomersFromCloud(summary, tenantId) {
  const scopedTenantId = requireTenantId(tenantId, 'syncCustomersFromCloud');
  const syncId = `cloud:customers:${scopedTenantId}`;
  const lastSyncAt = await getLastSyncAt(syncId);
  const rows = await fetchUpdatedRows(
    'customers',
    'id,name,phone,email,address,tenant_id,updated_at,created_at',
    lastSyncAt,
    'updated_at',
    scopedTenantId
  );
  let maxTs = lastSyncAt;

  for (const row of rows) {
    const remoteTs = normalizeTimestamp(row.updated_at || row.created_at) || new Date().toISOString();
    if (isRemoteNewer(remoteTs, maxTs)) maxTs = remoteTs;
    const existing = await get(
      `SELECT id, updated_at
       FROM clientes
       WHERE cloud_id = ?
         AND tenant_id = ?
       LIMIT 1`,
      [String(row.id), scopedTenantId]
    );
    summary.processed += 1;

    const mappedPhone = row.phone == null ? '' : String(row.phone);
    if (!existing) {
      await run(
        `INSERT INTO clientes (name, phone, email, address, cloud_id, tenant_id, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [row.name, mappedPhone, row.email ?? null, row.address ?? null, String(row.id), scopedTenantId, remoteTs]
      );
      summary.inserted += 1;
      continue;
    }

    if (!isRemoteNewer(remoteTs, existing.updated_at)) {
      summary.skipped += 1;
      continue;
    }

    await run(
      `UPDATE clientes
       SET name = ?, phone = ?, email = ?, address = ?, cloud_id = ?, tenant_id = ?, updated_at = ?
       WHERE id = ?
         AND tenant_id = ?`,
      [
        row.name,
        mappedPhone,
        row.email ?? null,
        row.address ?? null,
        String(row.id),
        scopedTenantId,
        remoteTs,
        existing.id,
        scopedTenantId,
      ]
    );
    summary.updated += 1;
  }

  if (rows.length > 0) {
    await setLastSyncAt(syncId, maxTs);
    await logSyncOperation(
      'pull-customers',
      { tenant_id: scopedTenantId, count: rows.length, last_sync_at: maxTs },
      'customers synced from cloud'
    );
  }
}

async function syncUsersFromCloud(summary, tenantId) {
  const supabase = getSupabase();
  const scopedTenantId = requireTenantId(tenantId, 'syncUsersFromCloud');
  if (!supabase) {
    summary.skippedEntities.push('users');
    return;
  }
  const syncId = `cloud:users:${scopedTenantId}`;
  const lastSyncAt = await getLastSyncAt(syncId);
  const isInitialPull = lastSyncAt === '1970-01-01T00:00:00.000Z';
  let rows = [];
  let error = null;

  if (isInitialPull) {
    ({ data: rows, error } = await supabase
      .from('users')
      .select('*')
      .eq('tenant_id', scopedTenantId)
      .order('created_at', { ascending: true }));
  } else {
    ({ data: rows, error } = await supabase
      .from('users')
      .select('*')
      .eq('tenant_id', scopedTenantId)
      .or(`updated_at.gt.${lastSyncAt},updated_at.is.null`)
      .order('updated_at', { ascending: true, nullsFirst: true }));
    if (error && String(error.code || '') === '42703') {
      ({ data: rows, error } = await supabase
        .from('users')
        .select('*')
        .eq('tenant_id', scopedTenantId)
        .or(`created_at.gt.${lastSyncAt},created_at.is.null`)
        .order('created_at', { ascending: true, nullsFirst: true }));
    }
  }
  if (error) {
    summary.skippedEntities.push('users');
    await logSyncOperation('pull-users-skip', { reason: error.message }, 'users table unavailable for pull sync');
    return;
  }

  console.log(`[sync][users] fetched ${Number((rows ?? []).length)} user(s) from Supabase (initial=${isInitialPull})`);

  let maxTs = lastSyncAt;
  for (const row of rows ?? []) {
    const cloudUserId = normalizeNonEmptyText(row.id);
    if (!cloudUserId) {
      summary.conflicts += 1;
      await logSyncOperation(
        'pull-users-conflict',
        { cloud_user_id: row?.id ?? null },
        'cloud user skipped because id is missing'
      );
      continue;
    }

    const remoteTs = normalizeTimestamp(row.updated_at ?? row.created_at) || new Date().toISOString();
    if (isRemoteNewer(remoteTs, maxTs)) maxTs = remoteTs;
    const existing = await get(
      `SELECT rowid AS rid, id, cloud_id, pin, updated_at
       FROM users
       WHERE cloud_id = ?
         AND tenant_id = ?
       LIMIT 1`,
      [cloudUserId, scopedTenantId]
    );
    summary.processed += 1;
    // Etapa 1F.2 (item 12): coluna cloud é `pin_hash` (nunca `pin`/`password`
    // legados). Validação estrita com o MESMO isBcryptHash() real do POS —
    // nunca aceitar/re-hashear algo que não seja já um hash bcrypt genuíno
    // (ao contrário de ensureHashedPin, que re-hashearia silenciosamente
    // qualquer coisa que não pareça um hash — errado aqui: seria mascarar
    // dados corrompidos/adulterados como válidos).
    const incomingPinRaw = row.pin_hash ?? null;
    const incomingPin = incomingPinRaw != null && isBcryptHash(incomingPinRaw) ? String(incomingPinRaw) : null;
    if (incomingPinRaw != null && !incomingPin) {
      summary.conflicts += 1;
      await logSyncOperation(
        'pull-users-invalid-pin-hash',
        { tenant_id: scopedTenantId, cloud_user_id: cloudUserId }, // nunca o valor em si
        'Utilizador da cloud ignorado: pin_hash não é um hash bcrypt válido',
        { level: 'error' },
      );
      continue;
    }

    if (!existing) {
      const incomingRole = String(row.role ?? 'cashier').trim().toLowerCase();
      const incomingName = String(row.name ?? 'Administrador').trim() || 'Administrador';
      if (incomingRole === 'admin') {
        // Liga ao admin local (mesmo sem cloud_id vazio): evita 2.º «Administrador» após sync.
        const orphanAdmin = await get(
          `SELECT rowid AS rid, id, pin, cloud_id
           FROM users
           WHERE tenant_id = ?
             AND active = 1
             AND LOWER(COALESCE(role, '')) = 'admin'
             AND (
               cloud_id IS NULL OR TRIM(COALESCE(cloud_id, '')) = ''
               OR LOWER(TRIM(COALESCE(name, ''))) = LOWER(?)
             )
           ORDER BY
             CASE
               WHEN cloud_id IS NULL OR TRIM(COALESCE(cloud_id, '')) = '' THEN 0
               ELSE 1
             END,
             CASE
               WHEN id = 'admin-local' THEN 0
               WHEN id = 'admin-1' THEN 1
               ELSE 2
             END,
             CASE
               WHEN LOWER(TRIM(COALESCE(name, ''))) = LOWER(?) THEN 0
               ELSE 1
             END,
             COALESCE(access_level, 0) DESC
           LIMIT 1`,
          [scopedTenantId, incomingName, incomingName],
        );
        if (orphanAdmin?.rid != null) {
          const shouldUpdatePin =
            (!orphanAdmin.pin || String(orphanAdmin.pin).trim() === '') && incomingPin;
          await run(
            `UPDATE users
             SET cloud_id = ?,
                 name = COALESCE(NULLIF(TRIM(name), ''), ?),
                 role = 'admin',
                 access_level = CASE WHEN COALESCE(access_level, 0) > 9 THEN access_level ELSE 9 END,
                 pin = ?,
                 updated_at = ?
             WHERE rowid = ?
               AND tenant_id = ?`,
            [
              cloudUserId,
              incomingName,
              shouldUpdatePin ? String(incomingPin) : orphanAdmin.pin,
              remoteTs,
              orphanAdmin.rid,
              scopedTenantId,
            ],
          );
          summary.updated += 1;
          await logSyncOperation(
            'pull-users-linked-admin',
            { tenant_id: scopedTenantId, cloud_user_id: cloudUserId, local_user_id: orphanAdmin.id },
            `Admin da cloud ${cloudUserId} ligado ao utilizador local ${orphanAdmin.id}`,
          );
          continue;
        }
      }

      if (!incomingPin) {
        summary.conflicts += 1;
        await logSyncOperation(
          'pull-users-conflict',
          { cloud_user_id: row.id },
          'new cloud user skipped because secret credential field is missing'
        );
        continue;
      }

      await run(
        `INSERT INTO users (id, name, role, pin, access_level, active, tenant_id, cloud_id, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          cloudUserId,
          incomingRole === 'admin' ? incomingName : (row.name ?? 'User'),
          row.role ?? 'cashier',
          String(incomingPin),
          incomingRole === 'admin' ? 9 : Number(row.access_level ?? 0),
          1,
          scopedTenantId,
          cloudUserId,
          remoteTs,
        ]
      );
      summary.inserted += 1;
      await logSyncOperation(
        'pull-users-inserted',
        { tenant_id: scopedTenantId, cloud_user_id: cloudUserId },
        `Utilizador ${cloudUserId} inserido a partir da cloud`,
      );
      continue;
    }

    const normalizedExistingId = normalizeNonEmptyText(existing.id);
    const normalizedExistingCloudId = normalizeNonEmptyText(existing.cloud_id);
    const shouldRepairIdentity = !normalizedExistingId || normalizedExistingCloudId !== cloudUserId;

    if (!isRemoteNewer(remoteTs, existing.updated_at) && !shouldRepairIdentity) {
      summary.skipped += 1;
      continue;
    }

    const shouldUpdatePin = (!existing.pin || String(existing.pin).trim() === '') && incomingPin;
    const nextPin = shouldUpdatePin ? String(incomingPin) : existing.pin;
    if (!shouldUpdatePin && incomingPin && String(incomingPin) !== String(existing.pin)) {
      const sameCredential =
        incomingPinRaw != null ? (await verifyPinAgainstStored(incomingPinRaw, existing.pin)).valid : false;
      if (!sameCredential) {
        summary.conflicts += 1;
        await logSyncOperation(
          'pull-users-conflict',
          { user_id: normalizedExistingId ?? null, cloud_user_id: cloudUserId },
          'user credential not overwritten because local pin already exists'
        );
      }
    }

    const nextLocalId = normalizedExistingId ?? cloudUserId;
    const updateResult = await run(
      `UPDATE users
       SET id = ?, name = ?, role = ?, pin = ?, tenant_id = ?, cloud_id = ?, updated_at = ?
       WHERE rowid = ?
         AND tenant_id = ?`,
      [
        nextLocalId,
        row.name ?? 'User',
        row.role ?? 'cashier',
        nextPin,
        scopedTenantId,
        cloudUserId,
        remoteTs,
        existing.rid,
        scopedTenantId,
      ]
    );
    if (Number(updateResult?.changes ?? 0) > 0) {
      summary.updated += 1;
      await logSyncOperation(
        'pull-users-updated',
        { tenant_id: scopedTenantId, cloud_user_id: cloudUserId, local_user_id: nextLocalId },
        `Utilizador ${cloudUserId} actualizado a partir da cloud`,
      );
    } else {
      summary.skipped += 1;
      await logSyncOperation(
        'pull-users-update-skip',
        { tenant_id: scopedTenantId, cloud_user_id: cloudUserId },
        `Actualização do utilizador ${cloudUserId} não aplicou alterações`,
        { level: 'warn' },
      );
    }
  }

  // Handle deletions from cloud: remove local users that no longer exist remotely.
  try {
    const { data: remoteIdRows, error: remoteIdError } = await supabase.from('users').select('id').eq('tenant_id', scopedTenantId);
    if (remoteIdError) {
      throw remoteIdError;
    }

    const remoteIds = new Set((remoteIdRows ?? []).map((item) => String(item.id)));
    const localUsers = await all(
      `SELECT rowid AS rid, id, cloud_id, updated_at
       FROM users
       WHERE cloud_id IS NOT NULL
         AND TRIM(cloud_id) <> ''
         AND tenant_id = ?`,
      [scopedTenantId]
    );
    const localUsersToDelete = (localUsers ?? [])
      .filter((item) => {
        if (String(item?.id ?? '').trim() === 'admin-local') return false;
        if (remoteIds.has(String(item.cloud_id))) return false;
        // During the initial pull, we treat the cloud as the source of truth.
        if (isInitialPull) return true;
        // Avoid deleting local users that were created/updated after the last successful pull.
        // This prevents deleting "pending" local users that haven't been pushed yet.
        if (!item.updated_at) return false;
        return String(item.updated_at) <= String(lastSyncAt);
      });

    const removedLocalIds = [];
    for (const localUser of localUsersToDelete) {
      const removeResult = await run(
        `DELETE FROM users
         WHERE rowid = ?
           AND tenant_id = ?
           AND COALESCE(is_system, 0) = 0`,
        [localUser.rid, scopedTenantId]
      );
      if (Number(removeResult?.changes ?? 0) > 0) {
        removedLocalIds.push(localUser.id ?? localUser.cloud_id ?? String(localUser.rid));
      }
    }

    if (removedLocalIds.length > 0) {
      summary.updated += removedLocalIds.length;
      await logSyncOperation(
        'pull-users-delete',
        { removed_local_ids: removedLocalIds, count: removedLocalIds.length },
        'local users removed because they no longer exist in cloud'
      );
    }
  } catch (deleteSyncError) {
    await logSyncOperation(
      'pull-users-delete-skip',
      { reason: String(deleteSyncError?.message || deleteSyncError) },
      'failed to reconcile deleted users from cloud'
    );
  }

  if ((rows ?? []).length > 0) {
    await setLastSyncAt(syncId, maxTs);
    await logSyncOperation(
      'pull-users',
      { tenant_id: scopedTenantId, count: rows.length, last_sync_at: maxTs },
      'users synced from cloud'
    );
  }

  try {
    await consolidateActiveAdmins(scopedTenantId);
  } catch (consolidateError) {
    await logSyncOperation(
      'pull-users-consolidate-admins-failed',
      { tenant_id: scopedTenantId, reason: String(consolidateError?.message ?? consolidateError) },
      'Falha ao consolidar administradores duplicados após pull',
      { level: 'warn' },
    );
  }
}

async function syncUsersToCloud(summary, tenantId) {
  const supabase = getSupabase();
  const scopedTenantId = requireTenantId(tenantId, 'syncUsersToCloud');
  if (!supabase) {
    summary.skipped = true;
    summary.reason = 'missing_supabase';
    return summary;
  }

  const online = await isInternetAvailable();
  if (!online) {
    summary.skipped = true;
    summary.reason = 'offline';
    return summary;
  }

  const now = new Date().toISOString();

  // Dedupe local users to prevent generating/pushing multiple cloud users
  // with identical credentials (commonly happens when local ids are invalid).
  // Admins com o mesmo nome são reduzidos a um (evita vários «Administrador»).
  try {
    await consolidateActiveAdmins(scopedTenantId);
  } catch (consolidateError) {
    await logSyncOperation(
      'push-users-consolidate-admins-failed',
      { tenant_id: scopedTenantId, reason: String(consolidateError?.message ?? consolidateError) },
      'Falha ao consolidar administradores duplicados antes do push',
      { level: 'warn' },
    );
  }

  const localUsers = await all(
    `SELECT rowid AS rid, id, name, role, pin, cloud_id, tenant_id, updated_at, active, is_system, access_level
     FROM users
     WHERE tenant_id = ?
       AND active = 1`,
    [scopedTenantId]
  );
  const users = Array.isArray(localUsers) ? localUsers : [];
  if (users.length === 0) return summary;

  // Dedupe local users to prevent generating/pushing multiple cloud users
  // with identical credentials (commonly happens when local ids are invalid).
  const dedupeMap = new Map(); // key -> kept rid
  const ridsToDelete = [];
  for (const u of users) {
    const nameKey = String(u?.name ?? '').trim().toLowerCase();
    const roleKey = String(u?.role ?? '').trim().toLowerCase();
    const pinKey = String(u?.pin ?? '').trim();
    // Admins: dedupe só por nome+role (PINs diferentes não devem gerar vários na cloud).
    const key =
      roleKey === 'admin' ? `${nameKey}::${roleKey}` : `${nameKey}::${roleKey}::${pinKey}`;
    const rid = Number(u?.rid);
    if (!Number.isFinite(rid)) continue;
    if (!dedupeMap.has(key)) {
      dedupeMap.set(key, rid);
    } else {
      ridsToDelete.push(rid);
    }
  }

  if (ridsToDelete.length > 0) {
    const placeholders = ridsToDelete.map(() => '?').join(', ');
    await run(
      `DELETE FROM users
       WHERE rowid IN (${placeholders})
         AND COALESCE(is_system, 0) = 0`,
      ridsToDelete
    );
    summary.processed += ridsToDelete.length;
    // Remove deleted entries from the working set.
    const keepRids = new Set(dedupeMap.values());
    for (let i = users.length - 1; i >= 0; i -= 1) {
      if (!keepRids.has(Number(users[i]?.rid))) users.splice(i, 1);
    }
    summary.skipped = false;
  }

  // Ensure every local user has a valid cloud_id (uuid) so the Supabase `users.id` (uuid) can be upserted.
  for (const u of users) {
    const localCloudId = (u?.cloud_id ?? '').toString().trim();
    if (!localCloudId || !isUUID(localCloudId)) {
      const nextCloudId = crypto.randomUUID();
      await run(
        `UPDATE users
         SET cloud_id = ?, updated_at = ?
         WHERE rowid = ?`,
        [nextCloudId, now, Number(u.rid)]
      );
      u.cloud_id = nextCloudId;
    }
  }

  const cloudIds = [...new Set(users.map((u) => String(u.cloud_id).trim()).filter(Boolean))];
  const { data: remoteRows, error: remoteError } = await supabase
    .from('users')
    .select('id,updated_at')
    .eq('tenant_id', scopedTenantId)
    .in('id', cloudIds);

  if (remoteError) throw remoteError;

  const remoteById = new Map((remoteRows ?? []).map((r) => [String(r.id), r]));

  // Only upsert when missing remotely or when local is newer than remote.
  const toUpsert = [];
  for (const u of users) {
    const cloudId = String(u.cloud_id).trim();
    if (!cloudId) continue;

    const remote = remoteById.get(cloudId);
    const localUpdatedAt = u.updated_at ?? now;
    const shouldSkip = remote && isRemoteNewer(remote.updated_at, localUpdatedAt);

    if (shouldSkip) continue;

    toUpsert.push({ cloudId, user: u });
  }

  // Etapa 1F.2 (item 18): o novo caminho nunca faz upsert directo em `users`
  // (a RLS/GRANT de 1E.8 nem concede INSERT/UPDATE directo) — passa sempre
  // pela RPC sync_upsert_user (SECURITY DEFINER), que já valida bcrypt e
  // bloqueia escalonamento de privilégio (Etapa 1E.9) no servidor. Aqui,
  // ANTES de chamar a RPC, validamos com o MESMO isBcryptHash() real do POS
  // (api/pinAuth.js) — nunca enviar um PIN que não pareça um hash bcrypt.
  for (const { cloudId, user: u } of toUpsert) {
    // Politica 1E.9/1F.6.1: um Device JWT nunca cria/promove utilizadores elevados na cloud (a RPC recusa com
    // privilege_escalation_denied). Nao tentar em cada ciclo: o admin e gerido pelo licenciamento, nao por este canal.
    const isElevatedUser = Number(u.access_level ?? 0) >= 9 || String(u.role ?? '').trim().toLowerCase() === 'admin';
    if (isElevatedUser) {
      await logSkippedUserPushOnce('push-users-elevated-skipped', cloudId, 'Utilizador elevado (admin) nao e enviado para a cloud por politica de seguranca');
      continue;
    }
    summary.processed += 1;
    if (!isBcryptHash(u.pin)) {
      // Sem PIN definido (ex.: antes da configuracao inicial) ou legado por converter: estado normal, nao e uma falha do sync.
      summary.processed -= 1;
      await logSkippedUserPushOnce('push-users-pin-pending', cloudId, 'Utilizador sem PIN bcrypt ainda: fica local ate o PIN ser definido');
      continue;
    }
    try {
      const { error: rpcError } = await supabase.rpc('sync_upsert_user', {
        p_id: cloudId,
        p_name: u.name ?? 'User',
        p_role: u.role ?? 'cashier',
        p_access_level: Number(u.access_level ?? 0),
        p_pin_hash: u.pin,
        p_active: toPgBoolean(u.active ?? 1),
      });
      if (rpcError) {
        summary.failed += 1;
        await logSyncOperation('push-users-failed', { tenant_id: scopedTenantId, cloud_user_id: cloudId }, rpcError.message);
      } else {
        summary.success += 1;
      }
    } catch (error) {
      summary.failed += 1;
      await logSyncOperation(
        'push-users-exception',
        { tenant_id: scopedTenantId, cloud_user_id: cloudId },
        String(error?.message ?? error)
      );
    }
  }

  // Etapa 1F.2 (item 18): reconciliação por DELETE do fluxo antigo (apagar
  // remotos ausentes localmente / duplicados por nome) REMOVIDA do novo
  // caminho — a RLS/GRANT de 1E.8 não concede DELETE em `users` a
  // `authenticated` (bateria sempre em 42501, RLS_DENIED). Decisão explícita
  // e documentada (mesmo espírito do item 16 para customers/categories):
  // utilizadores removidos localmente deixam de ser sincronizados, mas NUNCA
  // são apagados na cloud por este caminho.

  return summary;
}

// Etapa 1G.4 (Fase 1 do Backoffice): a identidade do PRÓPRIO Device, para o pull de
// stock_movements distinguir "movimento que eu próprio enviei" (nunca reaplicar a
// quantidade) de "movimento de outro Device/Backoffice" (aplicar exactamente uma vez).
// Vem do processo Electron (electron/main.js), que a lê da identidade Device Auth já
// protegida por safeStorage — nunca um armazenamento paralelo. device_id não é segredo
// (já viaja em claro no JWT que este próprio processo envia à cloud).
function resolveOwnDeviceId() {
  const raw = String(process.env.POS_DEVICE_ID ?? '').trim();
  return raw || null;
}

// Mesmo conjunto que o push usa (stockLedgerSync.js) — nunca duplicar a lista de tipos.
const STOCK_LEDGER_SYNCABLE_TYPES = new Set(STOCK_LEDGER_SYNCABLE_LIST);

async function logSkippedStockPullOnce(type, tenantId, message) {
  const key = `${type}:${tenantId}`;
  if (skippedUserPushLogged.has(key)) return;
  skippedUserPushLogged.add(key);
  await logSyncOperation(type, { tenant_id: tenantId }, message, { level: 'warn' });
}

async function syncStockMovementsFromCloud(summary, tenantId) {
  const scopedTenantId = requireTenantId(tenantId, 'syncStockMovementsFromCloud');
  // Achado real (Fase 3D): esta função escreve em stock_ledger_sync directamente (sem
  // passar por markMovementPulled, que é quem normalmente garante a tabela), e só o lado
  // do PUSH (collectLedgerGroups/collectOpeningGroups) a criava — um Store Server cujo
  // primeiro ciclo de sync fosse um PULL (nunca tinha havido nada para empurrar antes)
  // falhava com "no such table: stock_ledger_sync". idempotente (CREATE TABLE IF NOT
  // EXISTS), sem custo real chamar sempre.
  await ensureStockLedgerTables();

  // Falha fechada: sem saber a NOSSA PRÓPRIA identidade de Device não há como distinguir
  // com segurança "é meu" de "é de outro" — nunca aplicar stock às cegas nesse caso.
  // Nunca deveria acontecer com o sync já autenticado (o próprio push precisa do mesmo
  // Device Auth), mas o processo API podia arrancar sem Electron (ex.: `api:dev` isolado).
  const myDeviceId = resolveOwnDeviceId();
  if (!myDeviceId) {
    await logSkippedStockPullOnce(
      'pull-stock-device-id-missing',
      scopedTenantId,
      'POS_DEVICE_ID indisponível no processo API: pull de stock_movements suspenso até a identidade do device estar disponível (fail closed)'
    );
    return;
  }

  const syncId = `cloud:stock_movements:${scopedTenantId}`;
  const lastSyncAt = await getLastSyncAt(syncId);
  const rows = await fetchUpdatedRows(
    'stock_movements',
    'id,tenant_id,product_id,type,quantity,reference_id,created_at,warehouse_id,device_id',
    lastSyncAt,
    'created_at',
    scopedTenantId
  );
  let maxTs = lastSyncAt;

  for (const row of rows) {
    const createdTs = normalizeTimestamp(row.created_at) || new Date().toISOString();
    if (isRemoteNewer(createdTs, maxTs)) maxTs = createdTs;

    // 'sale' e 'opening' NÃO fazem parte desta reconciliação: 'sale' já é reflectido
    // localmente no momento da venda e reconciliado pelo pull de orders/order_items
    // (reference_id local 'SALE:<local_sale_id>:<produto>' nunca bate com o formato
    // cloud 'order:<order_id>' — não são o mesmo identificador, então procurar por
    // (produto,tipo,reference_id) aqui nunca encontraria o movimento local, mesmo sendo
    // sempre "próprio"). 'opening' é sintético (derivado do saldo local no momento do
    // push, nunca guardado como linha local) — reaplicá-lo duplicaria o saldo que já lhe
    // deu origem. Ambos avançam o cursor (maxTs já actualizado acima) sem log por evento
    // (frequência de uma venda, mesmo critério de ruído do resto deste ficheiro).
    if (!STOCK_LEDGER_SYNCABLE_TYPES.has(String(row.type))) {
      summary.stockNotApplicable = (summary.stockNotApplicable ?? 0) + 1;
      continue;
    }

    summary.processed += 1;
    const localProduct = await get(
      `SELECT id
       FROM products
       WHERE cloud_id = ?
         AND tenant_id = ?
         AND COALESCE(deleted, 0) = 0
       LIMIT 1`,
      [String(row.product_id), scopedTenantId]
    );
    if (!localProduct?.id) {
      summary.conflicts += 1;
      await logSyncOperation(
        'pull-stock-conflict',
        { tenant_id: scopedTenantId, movement_id: row.id, product_id: row.product_id },
        'stock movement skipped because local product mapping was not found'
      );
      continue;
    }

    const rowDeviceId = row.device_id ? String(row.device_id) : null;

    if (rowDeviceId && rowDeviceId === myDeviceId) {
      // CASO 1 (movimento próprio a voltar da cloud): NUNCA reaplicar a quantidade —
      // localizar o movimento local pela mesma identidade determinística que já é
      // UNIQUE dos dois lados (product/type/reference_id — ver uq_stock_movements_local_ref
      // local e stock_movements_tenant_product_type_ref_key na cloud) e confirmar no
      // stock_ledger_sync (nunca em stock_movements.cloud_id — ver nota abaixo). Sem
      // heurística: se não encontrar de forma inequívoca, reporta e não mexe em nada.
      const localMovement = await get(
        `SELECT id, cloud_id
         FROM stock_movements
         WHERE tenant_id = ? AND product_id = ? AND movement_type = ? AND reference_id = ?
         LIMIT 1`,
        [scopedTenantId, Number(localProduct.id), row.type, row.reference_id]
      );
      if (!localMovement?.id) {
        summary.conflicts += 1;
        await logSyncOperation(
          'pull-stock-own-device-unmatched',
          { tenant_id: scopedTenantId, movement_id: row.id, type: row.type, reference_id: row.reference_id },
          'Movimento do próprio device voltou da cloud mas não foi encontrado localmente por (produto,tipo,reference_id) — NÃO aplicado; requer investigação, nunca heurística',
          { level: 'error' }
        );
        continue;
      }
      // NÃO ligar/sobrescrever aqui stock_movements.cloud_id: auditoria confirmou que essa
      // coluna já tem outro dono para movimentos criados localmente — applyWarehouseDelta
      // (api/services/warehouseStock.service.js) auto-gera aí um UUID local em CADA
      // movimento (não só nos que vêm do pull), usado como chave interna estável para as
      // camadas de custo FIFO consumidas numa transferência (stock_layer_consumptions.
      // stock_movement_id, lido por costLayersForMovement em stockLedgerSync.js) — nunca
      // corresponde ao id real da cloud (a RPC sync_stock_movements gera sempre o seu
      // próprio id, nunca aceita um id do payload). Sobrescrever esse valor aqui
      // partiria essa chave interna e perderia o custo FIFO da próxima transferência
      // pushed. "vincular cloud_id quando aplicável": aqui NÃO é aplicável — confirma-se
      // a sincronização só via stock_ledger_sync, que é o registo correcto para isto.
      await run(
        `INSERT OR REPLACE INTO stock_ledger_sync (movement_id, status, error, updated_at) VALUES (?, 'synced', NULL, ?)`,
        [localMovement.id, new Date().toISOString()]
      );
      summary.stockAck = (summary.stockAck ?? 0) + 1;
      continue;
    }

    // CASO 2 (device diferente) / CASO 3 (device_id NULL = Backoffice/sistema): aplicar
    // exactamente uma vez. "Warehouse errada nunca aplica": este Store Server só tem
    // localmente os armazéns da SUA Store (o id é o mesmo local/cloud — ver
    // syncWarehousesToCloud/insertWarehouse); se o armazém do movimento não existe aqui,
    // pertence a outra Store e nunca é aplicado (não há como "adivinhar" o armazém certo).
    const localWarehouse = row.warehouse_id
      ? await get(`SELECT id FROM warehouses WHERE id = ? AND tenant_id = ?`, [String(row.warehouse_id), scopedTenantId])
      : null;
    if (!localWarehouse?.id) {
      summary.conflicts += 1;
      await logSyncOperation(
        'pull-stock-foreign-warehouse',
        { tenant_id: scopedTenantId, movement_id: row.id, warehouse_id: row.warehouse_id },
        'Movimento de stock ignorado: o armazém não existe neste Store Server (pertence a outra Store) — nunca aplicado'
      );
      continue;
    }

    let applied = false;
    try {
      await run('BEGIN IMMEDIATE TRANSACTION');
      const result = await run(
        `INSERT OR IGNORE INTO stock_movements
          (cloud_id, tenant_id, product_id, movement_type, quantity, reference_id, warehouse_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          String(row.id),
          scopedTenantId,
          Number(localProduct.id),
          row.type,
          Number(row.quantity ?? 0),
          row.reference_id,
          String(row.warehouse_id),
          createdTs,
          createdTs,
        ]
      );
      if (result.changes > 0) {
        await upsertWarehouseStockDelta(
          String(row.warehouse_id),
          Number(localProduct.id),
          scopedTenantId,
          Number(row.quantity ?? 0),
          createdTs
        );
        await refreshProductStockCache(Number(localProduct.id), scopedTenantId, createdTs);
        await run(
          `INSERT OR REPLACE INTO stock_ledger_sync (movement_id, status, error, updated_at)
           SELECT id, 'pulled', NULL, ? FROM stock_movements WHERE cloud_id = ?`,
          [new Date().toISOString(), String(row.id)]
        );
        applied = true;
      }
      await run('COMMIT');
    } catch (err) {
      try {
        await run('ROLLBACK');
      } catch {
        // ignore
      }
      throw err;
    }
    if (applied) {
      summary.stock_inserted += 1;
      summary.inserted += 1;
    } else {
      // já existia localmente (cloud_id UNIQUE) — retry/duplicado, nada a fazer
      summary.stockDuplicate = (summary.stockDuplicate ?? 0) + 1;
    }
  }

  if (rows.length > 0) {
    await setLastSyncAt(syncId, maxTs);
    await logSyncOperation(
      'pull-stock-movements',
      { tenant_id: scopedTenantId, count: rows.length, last_sync_at: maxTs },
      'stock movements synced'
    );
  }
}

async function processPullSyncCycle() {
  if (operatorPaused) {
    const paused = createPullSummary();
    paused.skipped = true;
    paused.reason = 'paused_by_operator';
    return paused;
  }
  const supabase = getSupabase();

  console.log('[DEBUG PULL CHECK]', {
    onlineCheckWillRun: true
  });

  const summary = createPullSummary();
  if (isPullRunning) {
    summary.skipped = true;
    summary.reason = 'pull_sync_already_running';
    return summary;
  }
  isPullRunning = true;

  try {
    const online = await isInternetAvailable();
    logConnectivityTransition(online, { cycle: 'pull' });
    // Etapa 1F.2 (item 8/22): pré-voo de device auth ANTES de tentar qualquer
    // tabela — pausa o ciclo inteiro de forma limpa (SYNC PAUSED) em vez de
    // deixar cada chamada individual falhar com DeviceAuthUnavailableError.
    // Nunca afecta venda/login/impressão/stock local — só esta pull.
    const deviceAuthOk = supabase ? await isDeviceAuthAvailable() : false;
    console.log('[DEBUG PULL STATUS]', {
      online,
      hasSupabase: !!supabase,
      deviceAuthOk,
    });
    if (!online || !supabase || !deviceAuthOk) {
      summary.skipped = true;
      summary.reason = !supabase ? 'missing_supabase' : !online ? 'offline' : 'device_auth_unavailable';
      return summary;
    }

    const tenantIds = await listSyncTenantIds();
    for (const tenantId of tenantIds) {
      await syncCategoriesFromCloud(summary, tenantId);
      await syncProductsFromCloud(summary, tenantId);
      await syncStoreProductsFromCloud(summary, tenantId);
      await syncTransfersFromCloud(summary, tenantId);
      await syncCustomersFromCloud(summary, tenantId);
      await syncUsersFromCloud(summary, tenantId);
      // tenant_profile é só local (SQLite): nunca existiu na cloud, por isso não há pull dele.
      await syncStockMovementsFromCloud(summary, tenantId);
      await syncOrdersFromCloud(summary, tenantId);
    }
  } catch (error) {
    await logSyncError({
      type: 'pull-cycle',
      payload: null,
      error,
    });
    summary.skipped = true;
    summary.reason = 'pull_cycle_error';
  } finally {
    isPullRunning = false;
  }

  return summary;
}

async function processFullSyncCycle() {
  if (operatorPaused) {
    const pausedPull = createPullSummary();
    pausedPull.skipped = true;
    pausedPull.reason = 'paused_by_operator';
    const pausedPush = createSummary();
    pausedPush.skipped = true;
    pausedPush.reason = 'paused_by_operator';
    return { push: pausedPush, pull: pausedPull };
  }
  // Pull first so deletions from Supabase are applied to local SQLite
  // before we push local state back to Supabase in the same cycle.
  const pull = await processPullSyncCycle();

  const pushSummary = createSummary();
  const usersPush = createSummary();
  const tenantIds = await listSyncTenantIds();
  for (const tenantId of tenantIds) {
    const perTenantSummary = createSummary();
    await syncUsersToCloud(perTenantSummary, tenantId);
    usersPush.processed += Number(perTenantSummary.processed ?? 0);
    usersPush.success += Number(perTenantSummary.success ?? 0);
    usersPush.failed += Number(perTenantSummary.failed ?? 0);
    usersPush.dead += Number(perTenantSummary.dead ?? 0);
    usersPush.skipped = Boolean(usersPush.skipped || perTenantSummary.skipped);
    if (!usersPush.reason && perTenantSummary.reason) usersPush.reason = perTenantSummary.reason;
  }
  const queuePush = await processSyncQueueCycle();

  const push = {
    processed: Number(usersPush?.processed ?? 0) + Number(queuePush?.processed ?? 0),
    success: Number(usersPush?.success ?? 0) + Number(queuePush?.success ?? 0),
    failed: Number(usersPush?.failed ?? 0) + Number(queuePush?.failed ?? 0),
    dead: Number(usersPush?.dead ?? 0) + Number(queuePush?.dead ?? 0),
    skipped: Boolean(usersPush?.skipped || queuePush?.skipped),
    reason: usersPush?.reason ?? queuePush?.reason ?? null,
  };

  return { push, pull };
}

/**
 * LEGACY / DEAD CODE — a remover numa refactorização futura.
 * Sem chamadores: é só exportada, e a rota POST /sync/full-reset (runFullResetSync) responde 501
 * (Etapa 1F.3). Este desenho apaga dados locais (orders/order_items/stock_movements/...) antes de
 * repovoar a partir de um snapshot da cloud, pelo que perderia vendas ainda não sincronizadas, e
 * usa colunas do schema antigo (users.pin/password, products.image_url) que a baseline não tem.
 * Não reactivar sem redesenho; não usar como referência para novo código.
 */
async function fullSyncFromCloud(tenantId) {
  const supabase = getSupabase();
  const scopedTenantId = requireTenantId(tenantId, 'fullSyncFromCloud');
  if (isFullResetRunning) {
    return { success: false, skipped: true, reason: 'full_reset_already_running' };
  }
  if (isRunning || isPullRunning) {
    return { success: false, skipped: true, reason: 'sync_cycle_in_progress' };
  }

  isFullResetRunning = true;
  const startedAt = new Date().toISOString();
  const summary = {
    success: false,
    started_at: startedAt,
    finished_at: null,
    deleted: {},
    inserted: {},
  };

  try {
    const online = await isInternetAvailable();
    if (!online || !supabase) {
      return { success: false, skipped: true, reason: 'offline_or_missing_supabase' };
    }

    await logSyncOperation('full-reset-start', { tenant_id: scopedTenantId, started_at: startedAt }, 'manual full reset started');

    const [categoriesRaw, products, customers, users, stockMovements, orders, orderItems] = await Promise.all([
      fetchAllRows('categories', 'id,tenant_id,name,parent_id,color,updated_at,created_at', 'created_at', scopedTenantId),
      fetchAllRows(
        'products',
        'id,tenant_id,code,name,category_id,barcode,cost,price,tax,final_price,active,unit,description,age_restriction,is_service,default_quantity,stock_quantity,min_stock,color,image,image_url,deleted,created_at,updated_at',
        'created_at',
        scopedTenantId
      ),
      fetchAllRows('customers', 'id,name,phone,email,address,tenant_id,updated_at,created_at', 'created_at', scopedTenantId),
      fetchAllRows('users', 'id,name,role,pin,password,tenant_id,updated_at,created_at', 'created_at', scopedTenantId),
      fetchAllRows('stock_movements', 'id,tenant_id,product_id,type,quantity,reference_id,created_at', 'created_at', scopedTenantId),
      fetchAllRows(
        'orders',
        'id,customer_id,table_number,total,subtotal,tax,discount,payment_method,received_amount,change_amount,status,local_sale_id,doc_type,document_number,tenant_id,created_at,updated_at',
        'created_at',
        scopedTenantId
      ),
      fetchAllRows(
        'order_items',
        'id,tenant_id,order_id,product_id,product_name,quantity,price,discount_amount,created_at,updated_at',
        'created_at',
        scopedTenantId
      ),
    ]);

    const { cloudIds: fullResetTombstoneCloudIds, names: fullResetTombstoneNames } = await loadCategoryTombstoneSets(scopedTenantId);
    const categories = (categoriesRaw ?? []).filter(
      (row) => !isRemoteCategoryTombstoned(row, fullResetTombstoneCloudIds, fullResetTombstoneNames)
    );

    const localImageByCloudId = new Map();
    const localTrackLotByCloudId = new Map();
    if (await tableExists('products')) {
      const localImages = await all(
        `SELECT cloud_id, image, track_lot
         FROM products
         WHERE cloud_id IS NOT NULL
           AND tenant_id = ?`,
        [scopedTenantId]
      );
      for (const row of localImages ?? []) {
        const cloudId = String(row?.cloud_id ?? '').trim();
        if (!cloudId) continue;
        const image = typeof row?.image === 'string' ? row.image.trim() : '';
        if (image) localImageByCloudId.set(cloudId, image);
        if (Number(row?.track_lot ?? 0) === 1) localTrackLotByCloudId.set(cloudId, 1);
      }
    }

    await run('BEGIN IMMEDIATE TRANSACTION');
    try {
      const clearOrder = ['stock_movements', 'order_items', 'orders', 'products', 'categories', 'customers', 'clientes', 'users'];
      const tenantScopedClear = new Set(['stock_movements', 'order_items', 'orders', 'products', 'categories', 'customers', 'clientes', 'users']);
      for (const tableName of clearOrder) {
        if (!(await tableExists(tableName))) continue;
        let result;
        if (tenantScopedClear.has(tableName)) {
          result = await run(`DELETE FROM ${tableName} WHERE tenant_id = ?`, [scopedTenantId]);
        } else {
          result = await run(`DELETE FROM ${tableName}`);
        }
        summary.deleted[tableName] = Number(result?.changes ?? 0);
      }

      const categoryMap = new Map();
      for (const row of categories) {
        const result = await run(
          `INSERT OR REPLACE INTO categories (name, parent_id, cloud_id, updated_at, tenant_id, color)
           VALUES (?, NULL, ?, ?, ?, ?)`,
          [
            row.name,
            String(row.id),
            normalizeTimestamp(row.updated_at || row.created_at) || new Date().toISOString(),
            scopedTenantId,
            row.color ? String(row.color) : null,
          ]
        );
        let localId = result?.lastID;
        if (!localId) {
          const existing = await get(
            `SELECT id
             FROM categories
             WHERE cloud_id = ?
               AND tenant_id = ?
             LIMIT 1`,
            [String(row.id), scopedTenantId]
          );
          localId = existing?.id;
        }
        if (localId) categoryMap.set(String(row.id), Number(localId));
      }
      for (const row of categories) {
        if (!row.parent_id) continue;
        const localId = categoryMap.get(String(row.id));
        const parentId = categoryMap.get(String(row.parent_id)) ?? null;
        if (!localId) continue;
        await run(`UPDATE categories SET parent_id = ? WHERE id = ? AND tenant_id = ?`, [parentId, localId, scopedTenantId]);
      }
      summary.inserted.categories = categories.length;

      const productMap = new Map();
      for (const row of products) {
        const categoryLocalId = row.category_id ? categoryMap.get(String(row.category_id)) ?? null : null;
        const cloudId = String(row.id);
        const remoteImage = row.image ?? row.image_url ?? null;
        const normalizedRemoteImage = typeof remoteImage === 'string' ? remoteImage.trim() : remoteImage;
        const imageValue = normalizedRemoteImage || localImageByCloudId.get(cloudId) || null;
        const result = await run(
          `INSERT OR REPLACE INTO products
            (cloud_id, tenant_id, code, name, category_id, barcode, cost, price, tax, final_price, active, unit, description, age_restriction, is_service, default_quantity, track_lot, stock_quantity, min_stock, color, image, deleted, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            cloudId,
            scopedTenantId,
            row.code == null ? null : Number(row.code),
            row.name,
            categoryLocalId,
            row.barcode ?? null,
            Number(row.cost ?? 0),
            Number(row.price ?? 0),
            Number(row.tax ?? 0),
            Number(row.final_price ?? row.price ?? 0),
            row.active === false ? 0 : 1,
            row.unit ?? 'un',
            row.description ?? null,
            row.age_restriction == null ? null : Number(row.age_restriction),
            row.is_service ? 1 : 0,
            row.default_quantity === false ? 0 : 1,
            Object.prototype.hasOwnProperty.call(row, 'track_lot') && row.track_lot != null
              ? row.track_lot === true || Number(row.track_lot) === 1
                ? 1
                : 0
              : localTrackLotByCloudId.get(cloudId) === 1
                ? 1
                : 0,
            Number(row.stock_quantity ?? 0),
            Number(row.min_stock ?? 0),
            row.color ?? null,
            imageValue,
            Number(row.deleted ?? 0) === 1 || row.deleted === true ? 1 : 0,
            normalizeTimestamp(row.created_at) || new Date().toISOString(),
            normalizeTimestamp(row.updated_at || row.created_at) || new Date().toISOString(),
          ]
        );
        let localId = result?.lastID;
        if (!localId) {
          const existing = await get(
            `SELECT id
             FROM products
             WHERE cloud_id = ?
               AND tenant_id = ?
             LIMIT 1`,
            [String(row.id), scopedTenantId]
          );
          localId = existing?.id;
        }
        if (localId) productMap.set(String(row.id), Number(localId));
      }
      summary.inserted.products = products.length;

      for (const row of customers) {
        await run(
          `INSERT OR REPLACE INTO clientes (name, phone, email, address, cloud_id, tenant_id, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            row.name,
            row.phone == null ? '' : String(row.phone),
            row.email ?? null,
            row.address ?? null,
            String(row.id),
            scopedTenantId,
            normalizeTimestamp(row.updated_at || row.created_at) || new Date().toISOString(),
          ]
        );
      }
      summary.inserted.customers = customers.length;

      for (const row of users) {
        const cloudUserId = normalizeNonEmptyText(row.id);
        if (!cloudUserId) continue;
        const pin = row.pin ?? row.password ?? '';
        if (!pin) continue;
        const hashedPin = await ensureHashedPin(pin);
        await run(
          `INSERT OR REPLACE INTO users (id, name, role, pin, tenant_id, cloud_id, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            cloudUserId,
            row.name ?? 'User',
            row.role ?? 'cashier',
            hashedPin,
            scopedTenantId,
            cloudUserId,
            normalizeTimestamp(row.updated_at || row.created_at) || new Date().toISOString(),
          ]
        );
      }
      summary.inserted.users = users.length;

      for (const row of stockMovements) {
        const localProductId = productMap.get(String(row.product_id));
        if (!localProductId) continue;
        await run(
          `INSERT OR REPLACE INTO stock_movements (cloud_id, tenant_id, product_id, movement_type, quantity, reference_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            String(row.id),
            scopedTenantId,
            Number(localProductId),
            row.type,
            Number(row.quantity ?? 0),
            row.reference_id ?? `cloud:${row.id}`,
            normalizeTimestamp(row.created_at) || new Date().toISOString(),
            normalizeTimestamp(row.created_at) || new Date().toISOString(),
          ]
        );
        await markMovementPulled(row.id);
      }
      summary.inserted.stock_movements = stockMovements.length;

      if (await tableExists('orders')) {
        for (const row of orders) {
          await run(
            `INSERT OR REPLACE INTO orders
              (id, customer_id, table_number, total, subtotal, tax, discount, payment_method, received_amount, change_amount, status, local_sale_id, doc_type, document_number, tenant_id, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              String(row.id),
              row.customer_id ? String(row.customer_id) : null,
              row.table_number ?? null,
              Number(row.total ?? 0),
              Number(row.subtotal ?? 0),
              Number(row.tax ?? 0),
              Number(row.discount ?? 0),
              row.payment_method ?? null,
              row.received_amount == null ? null : Number(row.received_amount),
              row.change_amount == null ? null : Number(row.change_amount),
              row.status ?? null,
              row.local_sale_id ?? null,
              row.doc_type ?? null,
              row.document_number ?? null,
              scopedTenantId,
              normalizeTimestamp(row.created_at) || new Date().toISOString(),
              normalizeTimestamp(row.updated_at || row.created_at) || new Date().toISOString(),
            ]
          );
        }
      }
      summary.inserted.orders = orders.length;

      if (await tableExists('order_items')) {
        for (const row of orderItems) {
          const lineId = String(row.id);
          await run(
            `INSERT OR REPLACE INTO order_items
              (id, tenant_id, order_id, product_id, product_name, quantity, price, discount_amount, created_at, updated_at, cloud_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              lineId,
              scopedTenantId,
              String(row.order_id),
              row.product_id ? String(row.product_id) : null,
              row.product_name ?? 'Produto',
              Number(row.quantity ?? 0),
              Number(row.price ?? 0),
              Number(row.discount_amount ?? 0),
              normalizeTimestamp(row.created_at) || new Date().toISOString(),
              normalizeTimestamp(row.updated_at || row.created_at) || new Date().toISOString(),
              lineId,
            ]
          );
        }
      }
      summary.inserted.order_items = orderItems.length;

      await run(
        `INSERT INTO sync_state (id, last_sync_at)
         VALUES (?, ?)
         ON CONFLICT(id) DO UPDATE SET last_sync_at = excluded.last_sync_at`,
        [`cloud:full_reset:${scopedTenantId}`, new Date().toISOString()]
      );

      await run('COMMIT');
      summary.success = true;
      summary.finished_at = new Date().toISOString();
    } catch (innerError) {
      await run('ROLLBACK');
      throw innerError;
    }

    await logSyncOperation('full-reset-complete', { ...summary, tenant_id: scopedTenantId }, 'manual full reset completed');
    return summary;
  } catch (error) {
    await logSyncError({
      type: 'full-reset',
      payload: summary,
      error,
    });
    return {
      success: false,
      skipped: false,
      reason: 'full_reset_error',
      error: error.message,
      started_at: startedAt,
      finished_at: new Date().toISOString(),
    };
  } finally {
    isFullResetRunning = false;
  }
}

function isPermanentError(error) {
  const message = String(error?.message ?? '').toLowerCase();
  const code = String(error?.code ?? '');
  if (code === 'DOCUMENT_NUMBER_TAKEN' || error?.permanent === true) {
    return true;
  }
  // Etapa 1F.2 (item 23): RLS/GRANT negou (42501) — o novo código nunca devia
  // ter tentado esta escrita (ex.: um DELETE sem GRANT); retry nunca resolve.
  if (isDefinitive(classifySyncError(error))) {
    return true;
  }
  // Unique / duplicate conflicts: use normal retries (idempotent sale sync, data fixes),
  // except número de documento de outra venda (tratado em DOCUMENT_NUMBER_TAKEN).
  if (message.includes('duplicate key') || message.includes('unique constraint')) {
    return false;
  }
  // FK em falta (ex.: produto antes da categoria) — pode recuperar no ciclo seguinte.
  if (code === '23503' || message.includes('foreign key constraint')) {
    return false;
  }
  // Schema bigint vs UUID — syncService tenta omitir FK; se ainda falhar, deixa re-tentar.
  if (isBigintUuidTypeError(error)) {
    return false;
  }
  return (
    message.includes('invalid') ||
    message.includes('violates') ||
    message.includes('null value') ||
    message.includes('unsupported sync type')
  );
}

/** Postgres 22P02 when a UUID string is sent to a bigint column (schema legado na cloud). */
function isBigintUuidTypeError(error) {
  const code = String(error?.code ?? '');
  const message = String(error?.message ?? '');
  return code === '22P02' && /bigint/i.test(message) && /[0-9a-f]{8}-[0-9a-f]{4}-/i.test(message);
}

function isMissingColumnError(error) {
  const blob = `${error?.message ?? ''} ${error?.code ?? ''} ${error?.details ?? ''}`;
  return /PGRST204|schema cache|could not find/i.test(blob);
}

function isDuplicateSaleError(error) {
  const code = String(error?.code ?? '');
  const message = String(error?.message ?? '').toLowerCase();
  const details = String(error?.details ?? '').toLowerCase();
  const hint = String(error?.hint ?? '').toLowerCase();
  return (
    (code === '23505' &&
      (
        message.includes('local_sale_id') ||
        details.includes('local_sale_id') ||
        message.includes('orders_local_sale_id_key') ||
        details.includes('orders_local_sale_id_key') ||
        hint.includes('local_sale_id')
      )) ||
    (message.includes('duplicate') && message.includes('local_sale_id')) ||
    details.includes('local_sale_id') ||
    message.includes('orders_local_sale_id_key') ||
    details.includes('orders_local_sale_id_key')
  );
}

function isDocumentNumberUniqueViolation(error) {
  const code = String(error?.code ?? '');
  const message = String(error?.message ?? '').toLowerCase();
  const details = String(error?.details ?? '').toLowerCase();
  if (code !== '23505') return false;
  return (
    message.includes('document_number') ||
    details.includes('document_number') ||
    message.includes('idx_orders_tenant_document_number_unique') ||
    details.includes('idx_orders_tenant_document_number_unique')
  );
}

async function idempotentDocumentNumberConflict(supabase, tenantId, localSaleId, documentNumber) {
  const doc = documentNumber == null ? '' : String(documentNumber).trim();
  if (!doc) return { sameSale: false, takenByOther: false };
  const { data: row, error } = await supabase
    .from('orders')
    .select('id, local_sale_id')
    .eq('tenant_id', tenantId)
    .eq('document_number', doc)
    .maybeSingle();
  if (error) throw error;
  if (!row) return { sameSale: false, takenByOther: false };
  if (String(row.local_sale_id ?? '') === String(localSaleId)) {
    return { sameSale: true, takenByOther: false };
  }
  return { sameSale: false, takenByOther: true };
}

/**
 * Números já usados na cloud para este tenant/tipo/ano — sem isto, uma instalação cuja
 * BD local não tem o histórico completo (ex: segundo terminal, reinstalação, ou uma BD
 * de dev/teste activada com uma licença de um tenant já usado noutro sítio) só vê os
 * números que ELA PRÓPRIA já criou localmente, e continua a colidir com o que já existe
 * na cloud mesmo depois de "reatribuir" (a reatribuição antiga só verificava a BD local).
 */
async function fetchCloudTakenDocumentNumbers(supabase, tenantId, docType, year) {
  const taken = new Set();
  if (!supabase) return taken;
  try {
    const { data, error } = await supabase
      .from('orders')
      .select('document_number')
      .eq('tenant_id', tenantId)
      .ilike('document_number', `${docType}/${year}/%`);
    if (error) throw error;
    for (const row of data || []) {
      const doc = String(row?.document_number ?? '').trim().toUpperCase();
      if (doc) taken.add(doc);
    }
  } catch (error) {
    logWarn('Não consegui consultar números de documento já usados na cloud — a reatribuir só com base local', {
      module: 'syncService',
      action: 'fetchCloudTakenDocumentNumbers',
      tenant_id: tenantId,
      doc_type: docType,
      error: error instanceof Error ? error.message : String(error),
    });
  }
  return taken;
}

/** Reatribui o próximo número livre deste tenant (local + cloud) quando a cloud já o tem noutra venda. */
async function reallocateLocalSaleDocumentNumber(payload, tenantId) {
  const localSaleId = String(payload?.local_sale_id ?? payload?.id ?? '').trim();
  const docType = String(payload?.docType ?? payload?.usedDocType ?? 'VD').trim().toUpperCase() || 'VD';
  if (!localSaleId) return null;

  const saleRow = await get(
    `SELECT id, doc_type, doc_sequence, data, tenant_id
       FROM vendas
      WHERE tenant_id = ?
        AND (CAST(id AS TEXT) = ? OR CAST(id AS TEXT) = ?)
      LIMIT 1`,
    [tenantId, localSaleId, String(payload?.id ?? '')],
  );
  if (!saleRow?.id) return null;

  const saleDateForYear = new Date(saleRow.data || payload.saleTimestamp || Date.now());
  const year = Number.isFinite(saleDateForYear.getFullYear())
    ? saleDateForYear.getFullYear()
    : new Date().getFullYear();
  const cloudTaken = await fetchCloudTakenDocumentNumbers(getSupabase(), tenantId, docType, year);
  let cloudMax = 0;
  for (const doc of cloudTaken) {
    const match = /\/(\d+)$/.exec(doc);
    if (match) cloudMax = Math.max(cloudMax, parseInt(match[1], 10));
  }

  const localMax = Number(
    (
      await get(
        `SELECT COALESCE(MAX(COALESCE(doc_sequence, id)), 0) AS next
           FROM vendas
          WHERE UPPER(COALESCE(doc_type, 'VD')) = ?
            AND tenant_id = ?`,
        [docType, tenantId],
      )
    )?.next ?? 0,
  );

  let candidate = Math.max(localMax, cloudMax) + 1;

  for (let attempt = 0; attempt < 80; attempt += 1) {
    const candidateDoc = `${docType}/${year}/${String(candidate).padStart(4, '0')}`;
    if (cloudTaken.has(candidateDoc.toUpperCase())) {
      candidate += 1;
      continue;
    }
    const takenLocal = await get(
      `SELECT 1 AS ok
         FROM vendas
        WHERE tenant_id = ?
          AND UPPER(COALESCE(doc_type, 'VD')) = ?
          AND CAST(COALESCE(doc_sequence, id) AS INTEGER) = ?
          AND CAST(id AS TEXT) <> CAST(? AS TEXT)
        LIMIT 1`,
      [tenantId, docType, candidate, saleRow.id],
    );
    if (!takenLocal) break;
    candidate += 1;
  }

  const usedDocumentNumber = `${docType}/${year}/${String(candidate).padStart(4, '0')}`;

  await run(`UPDATE vendas SET doc_sequence = ? WHERE id = ? AND tenant_id = ?`, [
    candidate,
    saleRow.id,
    tenantId,
  ]);

  payload.usedSequence = candidate;
  payload.usedDocType = docType;
  payload.usedDocumentNumber = usedDocumentNumber;
  payload.docType = docType;

  logWarn(`Documento local reatribuído para ${usedDocumentNumber}`, {
    module: 'syncService',
    action: 'reallocateLocalSaleDocumentNumber',
    event: 'sync.sale_doc_renumbered',
    tenant_id: tenantId,
    local_sale_id: localSaleId,
    document_number: usedDocumentNumber,
  });

  return { usedSequence: candidate, usedDocumentNumber, usedDocType: docType };
}

function validatePayload(type, payload) {
  if (!payload || typeof payload !== 'object') {
    return { valid: false, reason: 'Payload ausente ou invalido' };
  }

  if (type === 'sale') {
    if (!Number.isFinite(Number(payload.total))) return { valid: false, reason: 'Sale total invalido' };
    if (!Array.isArray(payload.cart) || payload.cart.length === 0) return { valid: false, reason: 'Sale cart vazio' };
    if (!payload.local_sale_id) return { valid: false, reason: 'Sale local_sale_id ausente' };
    return { valid: true };
  }

  if (type === 'product') {
    if (Number(payload.deleted ?? 0) === 1 || payload.deleted === true) {
      if (!payload.cloud_id || !isUuidString(String(payload.cloud_id))) {
        return { valid: false, reason: 'Product delete requer cloud_id UUID valido' };
      }
      return { valid: true };
    }
    if (!payload.cloud_id || !isUuidString(String(payload.cloud_id))) {
      return { valid: false, reason: 'Product requer cloud_id UUID valido para sync' };
    }
    if (payload.id == null || !payload.name || !Number.isFinite(Number(payload.price))) {
      return { valid: false, reason: 'Product requer id, name e price validos' };
    }
    return { valid: true };
  }

  if (type === 'customer') {
    if (payload.deleted && payload.id != null) return { valid: true };
    if (payload.id == null || !payload.name || !payload.phone) {
      return { valid: false, reason: 'Customer requer id, name e phone' };
    }
    return { valid: true };
  }

  if (type === 'category') {
    if (Number(payload.deleted ?? 0) === 1 || payload.deleted === true) {
      const hasCloudId = payload.cloud_id && isUuidString(String(payload.cloud_id));
      const hasName = String(payload.name ?? '').trim().length > 0;
      if (!hasCloudId && !hasName) {
        return { valid: false, reason: 'Category delete requer cloud_id UUID valido ou name' };
      }
      return { valid: true };
    }
    if (!payload.cloud_id || !isUuidString(String(payload.cloud_id))) {
      return { valid: false, reason: 'Category requer cloud_id UUID valido para sync' };
    }
    if (!String(payload.name ?? '').trim()) {
      return { valid: false, reason: 'Category requer name valido' };
    }
    return { valid: true };
  }

  return { valid: false, reason: `Unsupported sync type: ${type}` };
}

function parseQueuePayload(row) {
  try {
    return JSON.parse(row.data);
  } catch (error) {
    throw new Error(`Invalid queue JSON payload: ${error.message}`);
  }
}

async function toOrderPayload(sale, tenantId) {
  const paymentMethod = sale.payment_method ?? sale.paymentMethod ?? null;
  const receivedAmount = sale.received_amount ?? sale.receivedAmount ?? null;
  const changeAmount = sale.change_amount ?? sale.change ?? 0;
  const discount = sale.discount ?? sale.totalDiscount ?? 0;
  const customerUUID = await resolveCustomerUUID(sale.selectedCustomerId);

  if (sale.selectedCustomerId && !customerUUID) {
    await logSyncOperation(
      'push-sale-invalid-customer-id',
      { tenant_id: tenantId, selected_customer_id: sale.selectedCustomerId },
      'customer_id inválido ao preparar venda para a cloud — a gravar como null',
      { level: 'warn' },
    );
  }

  const docType = String(sale.docType ?? '').trim().toUpperCase() || null;
  const isProforma = docType === 'FP';
  const normalizedStatus = String(sale.paymentStatus ?? sale.status ?? 'completed').trim().toLowerCase();
  const mappedStatus = isProforma
    ? 'pending'
    : normalizedStatus === 'pending' || normalizedStatus === 'cancelled'
      ? normalizedStatus
      : 'completed';

  return {
    local_sale_id: String(sale.local_sale_id ?? sale.id),
    total: Number(sale.total ?? 0),
    subtotal: Number(sale.subtotal ?? sale.total ?? 0),
    tax: Number(sale.tax ?? 0),
    discount: Number(discount),
    customer_id: customerUUID,
    table_number: toSafeString(sale.selectedTableId),
    station_code: toSafeString(sale.station_code),
    warehouse_id: sale.warehouse_id && isUuidString(String(sale.warehouse_id)) ? String(sale.warehouse_id).trim() : null,
    doc_type: docType,
    document_number: sale.usedDocumentNumber ?? null,
    payment_method: isProforma ? null : paymentMethod,
    received_amount: isProforma ? null : receivedAmount,
    change_amount: isProforma ? 0 : Number(changeAmount ?? 0),
    status: mappedStatus,
    tenant_id: requireTenantId(sale.tenant_id ?? tenantId, 'toOrderPayload'),
    created_at: sale.saleTimestamp,
  };
}

async function resolveCloudProductIdForSaleItem(supabase, item, candidateCloudId, tenantId) {
  const normalizedCloudId =
    candidateCloudId && isUuidString(String(candidateCloudId)) ? String(candidateCloudId).trim() : null;

  if (normalizedCloudId) {
    const { data, error } = await supabase
      .from('products')
      .select('id')
      .eq('id', normalizedCloudId)
      .eq('tenant_id', tenantId)
      .maybeSingle();
    if (error) throw error;
    if (data?.id) return String(data.id);
  }

  const localId = Number(item?.id);
  if (Number.isFinite(localId)) {
    const { data: byLocalId, error: byLocalIdError } = await supabase
      .from('products')
      .select('id')
      .eq('tenant_id', tenantId)
      .or(`local_id.eq.${localId},local_id.eq.${String(localId)}`)
      .maybeSingle();
    if (byLocalIdError) throw byLocalIdError;
    if (byLocalId?.id && isUuidString(String(byLocalId.id))) {
      await run(`UPDATE products SET cloud_id = ? WHERE id = ? AND tenant_id = ?`, [
        String(byLocalId.id),
        localId,
        tenantId,
      ]);
      return String(byLocalId.id);
    }
  }

  const productName = String(item?.name ?? '').trim();
  if (productName) {
    const normalizeName = (value) =>
      String(value ?? '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim()
        .toLowerCase();

    const { data: byNameRows, error: byNameError } = await supabase
      .from('products')
      .select('id,name')
      .eq('tenant_id', tenantId)
      .eq('deleted', 0)
      .ilike('name', productName);
    if (byNameError) throw byNameError;

    const targetName = normalizeName(productName);
    const byName =
      (Array.isArray(byNameRows) ? byNameRows : []).find(
        (row) => normalizeName(row?.name) === targetName && isUuidString(String(row?.id))
      ) ??
      (Array.isArray(byNameRows) ? byNameRows : []).find((row) => isUuidString(String(row?.id))) ??
      null;

    if (byName?.id) {
      if (Number.isFinite(localId)) {
        await run(`UPDATE products SET cloud_id = ? WHERE id = ? AND tenant_id = ?`, [
          String(byName.id),
          localId,
          tenantId,
        ]);
      }
      return String(byName.id);
    }
  }

  if (Number.isFinite(localId)) {
    const localProduct = await get(
      `SELECT id, cloud_id, name, price, stock_quantity, min_stock, active, deleted, tenant_id
       FROM products
       WHERE id = ?
         AND tenant_id = ?
         AND COALESCE(deleted, 0) = 0
       LIMIT 1`,
      [localId, tenantId]
    );
    if (localProduct?.id) {
      const localProductTenantId = requireTenantId(localProduct.tenant_id ?? tenantId, 'resolveCloudProductIdForSaleItem');
      if (localProductTenantId !== tenantId) {
        throw new Error(`Cross-tenant product mapping blocked for local product ${localId}`);
      }
      const ensuredCloudId =
        localProduct.cloud_id && isUuidString(String(localProduct.cloud_id))
          ? String(localProduct.cloud_id).trim()
          : crypto.randomUUID();

      const mapped = {
        id: ensuredCloudId,
        name: String(localProduct.name ?? ''),
        price: Number(localProduct.price ?? 0),
        min_stock: Number(localProduct.min_stock ?? 0),
        active: Number(localProduct.active ?? 1) !== 0,
        // Etapa 1F.2 (item 17): mesmo mapeamento explícito boolean usado em syncProduct().
        deleted: toPgBoolean(localProduct.deleted),
        tenant_id: localProductTenantId,
        updated_at: new Date().toISOString(),
      };
      const { error: upsertError } = await supabase.from('products').upsert(mapped, { onConflict: 'id' });
      if (upsertError) throw upsertError;
      await run(`UPDATE products SET cloud_id = ? WHERE id = ? AND tenant_id = ?`, [
        ensuredCloudId,
        localId,
        tenantId,
      ]);
      return ensuredCloudId;
    }
  }

  return null;
}

async function toOrderItemsPayload(sale, supabase, tenantId) {
  const cart = Array.isArray(sale.cart) ? sale.cart : [];
  const items = [];
  for (const item of cart) {
    const qty = Number(item?.quantity ?? 0);
    if (!Number.isFinite(qty) || qty <= 0) {
      await logSyncOperation(
        'push-sale-blocked-invalid-item',
        { tenant_id: tenantId, item, reason: 'invalid quantity' },
        'Venda bloqueada: item com quantidade inválida',
        { level: 'error' },
      );
      throw new Error('Sale sync blocked: invalid item');
    }

    let cloudId =
      item?.cloud_id && isUuidString(String(item.cloud_id)) ? String(item.cloud_id).trim() : null;
    const localId = Number(item?.id);
    if (!cloudId && Number.isFinite(localId)) {
      cloudId = await resolveProductCloudId(localId, tenantId);
    }
    cloudId = await resolveCloudProductIdForSaleItem(supabase, item, cloudId, tenantId);
    if (!cloudId) {
      await logSyncOperation(
        'push-sale-blocked-invalid-item',
        { tenant_id: tenantId, item, reason: 'invalid product_id' },
        'Venda bloqueada: item sem product_id válido',
        { level: 'error' },
      );
      throw new Error('Sale sync blocked: invalid item');
    }
    if (!isUuidString(cloudId)) {
      await logSyncOperation(
        'push-sale-blocked-invalid-item',
        { tenant_id: tenantId, item, reason: 'invalid product_id' },
        'Venda bloqueada: item com product_id que não é UUID',
        { level: 'error' },
      );
      throw new Error('Sale sync blocked: invalid item');
    }

    const productName = String(item?.name ?? '').trim();
    if (!productName) {
      await logSyncOperation(
        'push-sale-blocked-invalid-item',
        { tenant_id: tenantId, item, reason: 'empty name' },
        'Venda bloqueada: item sem nome',
        { level: 'error' },
      );
      throw new Error('Sale sync blocked: invalid item');
    }

    items.push({
      product_id: cloudId,
      product_name: productName,
      quantity: qty,
      price: Number(item?.price ?? 0),
      discount_amount: Number(item?.discount ?? 0),
    });
  }
  if (items.length === 0) {
    await logSyncOperation(
      'push-sale-blocked-invalid-item',
      { tenant_id: tenantId, item: null, reason: 'empty cart' },
      'Venda bloqueada: carrinho sem itens válidos',
      { level: 'error' },
    );
    throw new Error('Sale sync blocked: invalid item');
  }
  return items;
}

// Armazéns locais (id UUID estável = id cloud) espelhados na Store do device. A Store nunca vem do
// cliente: a RPC deriva-a do Device JWT e rejeita ids de outra Store.
async function pushWarehouseRow(supabase, row) {
  const { error } = await supabase.rpc('sync_upsert_warehouse', {
    p_id: String(row.id),
    p_name: String(row.name ?? ''),
    p_code: row.code == null ? null : String(row.code),
    p_is_default: Number(row.is_default ?? 0) === 1,
    p_is_active: Number(row.is_active ?? 1) !== 0,
  });
  if (error) throw error;
}

async function ensureWarehouseSynced(supabase, warehouseId, tenantId) {
  if (!warehouseId || !isUuidString(String(warehouseId))) return;
  const row = await get(`SELECT id, name, code, is_default, is_active FROM warehouses WHERE id = ? AND tenant_id = ?`, [
    String(warehouseId),
    tenantId,
  ]);
  if (!row) return;
  await pushWarehouseRow(supabase, row);
}

let lastWarehouseFingerprint = null;
async function syncWarehousesToCloud() {
  const supabase = getSupabase();
  if (!supabase) return { synced: 0 };
  const rows = await all(
    `SELECT id, tenant_id, name, code, is_default, is_active FROM warehouses ORDER BY is_default ASC, created_at ASC`
  );
  const valid = rows.filter((row) => isUuidString(String(row.id)));
  const fingerprint = JSON.stringify(valid.map((r) => [r.id, r.name, r.code, r.is_default, r.is_active]));
  if (fingerprint === lastWarehouseFingerprint) return { synced: 0 };
  for (const row of valid) await pushWarehouseRow(supabase, row);
  lastWarehouseFingerprint = fingerprint;
  return { synced: valid.length };
}

const LEDGER_RPC_CHUNK = 100;
const RECONCILE_INTERVAL_MS = 10 * 60 * 1000;
let lastReconcileAt = 0;

async function pushLedgerChunks(supabase, groups, index, { opening = false } = {}) {
  const totals = { synced: 0, duplicate: 0, conflict: 0, rejected: 0, retry: 0 };
  for (let i = 0; i < groups.length; i += LEDGER_RPC_CHUNK) {
    const chunk = groups.slice(i, i + LEDGER_RPC_CHUNK);
    const { data, error } = await supabase.rpc('sync_stock_movements', { p_groups: chunk });
    if (error) throw error;
    const rows = Array.isArray(data) ? data : [];
    const part = await recordLedgerResults(rows, { index, opening });
    for (const k of Object.keys(totals)) totals[k] += part[k];
    for (const r of rows) {
      if (r.out_status === 'conflict' || r.out_status === 'rejected') {
        await logSyncOperation(
          'push-stock-movement-not-applied',
          { reference_id: r.out_reference_id, type: r.out_type, status: r.out_status, error: r.out_error },
          'Movimento de stock não aplicado na cloud (registado; não é repetido nem corrigido em silêncio)',
          { level: 'error' },
        );
      }
    }
  }
  return totals;
}

// Movimentos não-venda + saldo de abertura -> ledger cloud (Store/Warehouse derivados do Device no servidor).
async function syncStockLedgerToCloud() {
  const supabase = getSupabase();
  if (!supabase) return { pushed: 0 };
  let pushed = 0;
  for (const tenantId of await listSyncTenantIds()) {
    const opening = await collectOpeningGroups({ tenantId });
    await recordZeroOpenings(opening.zero);
    if (opening.groups.length > 0) {
      const t = await pushLedgerChunks(supabase, opening.groups, opening.index, { opening: true });
      pushed += t.synced;
    }
    const ledger = await collectLedgerGroups({ tenantId });
    if (ledger.groups.length > 0) {
      const t = await pushLedgerChunks(supabase, ledger.groups, ledger.index);
      pushed += t.synced;
    }
  }
  return { pushed };
}

// Compara saldo local vs ledger cloud por produto+armazém. Só reporta; nunca corrige.
async function reconcileStockWithCloud() {
  const supabase = getSupabase();
  if (!supabase) throw new Error('Supabase client unavailable');
  const reports = [];
  for (const tenantId of await listSyncTenantIds()) {
    const cloudRows = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase
        .from('warehouse_stock')
        .select('warehouse_id,product_id,quantity')
        .eq('tenant_id', tenantId)
        .range(from, from + 999);
      if (error) throw error;
      cloudRows.push(...(data ?? []));
      if (!data || data.length < 1000) break;
    }
    const pendingSalesRow = await get(
      `SELECT COUNT(*) AS n FROM sync_queue WHERE tenant_id = ? AND type = 'sale' AND status IN ('pending', 'failed')`,
      [tenantId]
    );
    const report = await computeReconciliation({ tenantId, cloudRows, pendingSales: Number(pendingSalesRow?.n ?? 0) });
    if (report.divergent_count > 0) {
      await logSyncOperation(
        'stock-reconcile-divergence',
        { tenant_id: tenantId, divergent_count: report.divergent_count, pending_sync: report.pending_sync, sample: report.divergent.slice(0, 20) },
        'Divergência entre saldo local e ledger cloud (reportada; nenhum saldo foi alterado)',
        { level: 'warn' },
      );
    }
    reports.push({ tenant_id: tenantId, ...report });
  }
  lastReconcileAt = Date.now();
  return reports;
}

// Transferencias Store -> Store: a cloud arbitra; erros PERMANENTES compensam localmente (nunca apagam), os
// transitorios (rede/auth) propagam-se e voltam a tentar no proximo ciclo.
const TRANSFER_PERMANENT = /^(transfer_[a-z_]+|warehouse_not_in_store|item_[a-z_]+|items_required|received_items_[a-z_]+)$/;

async function syncTransfersToCloud(client = null) {
  const supabase = client ?? getSupabase();
  if (!supabase) return { pushed: 0 };
  let pushed = 0;
  for (const tenantId of await listSyncTenantIds()) {
    const { dispatch, receive } = await collectPendingTransfers(tenantId);
    for (const d of dispatch) {
      const { data, error } = await supabase.rpc('transfer_dispatch', { p_transfer: d.payload });
      if (error) {
        if (!TRANSFER_PERMANENT.test(String(error.message ?? ''))) throw error;
        await logSyncOperation('push-transfer-dispatch-rejected', { id: d.id, error: error.message }, 'Despacho recusado pela cloud (stock local reposto por movimento compensatório)', { level: 'error' });
        await applyCloudCancellation(d.id, 'out', tenantId, { reason: error.message, rejected: true });
        continue;
      }
      const status = (Array.isArray(data) ? data[0] : data)?.out_status;
      if (status === 'cancelled') await applyCloudCancellation(d.id, 'out', tenantId);
      else await markPushed(d.id, 'out', tenantId, 'synced');
      pushed += 1;
    }
    for (const r of receive) {
      const { data, error } = await supabase.rpc('transfer_receive', { p_id: r.id, p_to_warehouse: r.to_warehouse_id, p_items: r.items });
      if (error) {
        if (!TRANSFER_PERMANENT.test(String(error.message ?? ''))) throw error;
        await logSyncOperation('push-transfer-receive-rejected', { id: r.id, error: error.message }, 'Recepção recusada pela cloud (crédito local revertido por movimento compensatório)', { level: 'error' });
        await applyCloudCancellation(r.id, 'in', tenantId, { reason: error.message, rejected: true });
        continue;
      }
      const status = (Array.isArray(data) ? data[0] : data)?.out_status;
      if (status === 'cancelled') await applyCloudCancellation(r.id, 'in', tenantId);
      else await markPushed(r.id, 'in', tenantId, 'synced');
      pushed += 1;
    }
  }
  return { pushed };
}

async function syncTransfersFromCloud(summary, tenantId) {
  const supabase = getSupabase();
  const scopedTenantId = requireTenantId(tenantId, 'syncTransfersFromCloud');
  const syncId = `cloud:transfers:${scopedTenantId}`;
  const lastSyncAt = await getLastSyncAt(syncId);
  const rows = await fetchUpdatedRows(
    'device_stock_transfers',
    'id,direction,from_store_id,to_store_id,from_warehouse_id,to_warehouse_id,status,note,has_divergence,cancel_reason,created_at,dispatched_at,received_at,cancelled_at,updated_at',
    lastSyncAt,
    'updated_at',
    scopedTenantId
  );
  if (rows.length === 0) return;
  const { data: items, error } = await supabase
    .from('stock_transfer_items')
    .select('transfer_id,product_id,qty_requested,qty_sent,qty_received,cost_layers')
    .in('transfer_id', rows.map((r) => r.id));
  if (error) throw error;
  const byTransfer = new Map();
  for (const i of items ?? []) {
    const k = String(i.transfer_id);
    byTransfer.set(k, [...(byTransfer.get(k) ?? []), i]);
  }
  const res = await applyRemoteTransfers(scopedTenantId, rows, byTransfer);
  summary.processed += rows.length;
  // se algum produto mestre ainda nao chegou, nao avanca o watermark (volta a tentar)
  if (res.incomplete === 0) {
    let maxTs = lastSyncAt;
    for (const r of rows) {
      const ts = normalizeTimestamp(r.updated_at) || new Date().toISOString();
      if (isRemoteNewer(ts, maxTs)) maxTs = ts;
    }
    await setLastSyncAt(syncId, maxTs);
  }
  await logSyncOperation('pull-transfers', { tenant_id: scopedTenantId, count: rows.length, ...res }, 'transferências sincronizadas');
}

// Cancelamento pos-dispatch: so via cloud (exige ligacao). O resultado e aplicado localmente com movimento compensatorio.
async function cancelTransferViaCloud(transferId, reason = null) {
  const supabase = getSupabase();
  if (!supabase) throw Object.assign(new Error('Supabase client unavailable'), { code: 'SYNC_UNAVAILABLE' });
  const tenantId = requireTenantId((await listSyncTenantIds())[0], 'cancelTransferViaCloud');
  const { data, error } = await supabase.rpc('transfer_cancel', { p_id: String(transferId), p_reason: reason });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (row?.out_status === 'cancelled') await applyCloudCancellation(transferId, 'out', tenantId, { reason });
  return { status: row?.out_status, applied: Boolean(row?.out_applied) };
}

async function syncSaleAtomically(payload, options = {}) {
  const supabase = getSupabase();
  if (!supabase) {
    throw new Error('Supabase client unavailable');
  }
  if (!payload || !Number.isFinite(Number(payload.total))) {
    throw new Error('Invalid sale payload');
  }
  const tenantId = requirePayloadTenantId(payload, 'sale sync');
  const localSaleId = String(payload.local_sale_id);
  const alreadyRenumbered = Boolean(options.renumbered || payload._docRenumbered);

  const { data: existingOrder, error: existingError } = await supabase
    .from('orders')
    .select('id')
    .eq('local_sale_id', localSaleId)
    .eq('tenant_id', tenantId)
    .maybeSingle();

  if (existingError) throw existingError;
  if (existingOrder?.id) return;

  console.log('[SYNC] Sale payload:', payload);
  const ensuredCustomerId = payload.selectedCustomerId ? await ensureCustomerSynced(payload.selectedCustomerId, tenantId) : null;
  const order_data = await toOrderPayload({
    ...payload,
    selectedCustomerId: ensuredCustomerId,
  }, tenantId);
  const items = await toOrderItemsPayload(payload, supabase, tenantId);
  // Pilot Gate POS/Dinheiro: breakdown real por tender, gravado localmente em
  // sale_payments no momento da venda (payload.paymentTenders) — nunca reconstruído aqui
  // a partir de payment_method. Ausente/vazio (venda antiga, antes desta etapa) = a RPC
  // trata como venda sem breakdown, igual ao fallback local.
  const paymentsPayload = Array.isArray(payload.paymentTenders)
    ? payload.paymentTenders
        .filter((p) => p && p.method && Number.isFinite(Number(p.amount)))
        .map((p) => ({
          method: String(p.method),
          amount: Number(p.amount),
          tendered_amount: p.tendered_amount == null ? null : Number(p.tendered_amount),
        }))
    : [];
  // O armazém usado pela venda tem de existir na Store cloud antes da RPC (a RPC valida-o contra a Store do device).
  await ensureWarehouseSynced(supabase, order_data.warehouse_id, tenantId);

  console.log('[SALE SYNC] sending:', {
    order_data,
    items,
    itemCount: items.length,
    paymentCount: paymentsPayload.length,
  });

  const start = Date.now();
  const { data: result, error: rpcError } = await supabase.rpc('create_order_with_items', {
    order_data,
    items,
    payments: paymentsPayload.length > 0 ? paymentsPayload : null,
  });
  const duration = Date.now() - start;
  console.log('[SALE SYNC TIME]', `${duration}ms`);

  console.log('[SALE SYNC RESULT]', {
    data: result,
    error: rpcError,
    success: !rpcError,
  });

  if (!rpcError && (result == null || (Array.isArray(result) && result.length === 0))) {
    await logSyncOperation(
      'push-sale-rpc-empty-result',
      { tenant_id: tenantId, local_sale_id: localSaleId, item_count: items.length },
      'RPC create_order_with_items não devolveu dados para a venda',
      { level: 'warn' },
    );
  }

  if (rpcError) {
    if (isDuplicateSaleError(rpcError)) return;
    if (isDocumentNumberUniqueViolation(rpcError)) {
      const conflict = await idempotentDocumentNumberConflict(
        supabase,
        tenantId,
        localSaleId,
        order_data.document_number,
      );
      if (conflict.sameSale) return;
      if (conflict.takenByOther && !alreadyRenumbered) {
        const reallocated = await reallocateLocalSaleDocumentNumber(payload, tenantId);
        if (reallocated?.usedDocumentNumber) {
          return syncSaleAtomically(
            { ...payload, ...reallocated, _docRenumbered: true },
            { renumbered: true },
          );
        }
      }
      const taken = new Error(
        conflict.takenByOther
          ? `Número de documento ${String(order_data.document_number ?? '').trim()} já está na cloud noutra venda`
          : `Número de documento ${String(order_data.document_number ?? '').trim()} já existe na cloud`,
      );
      taken.code = 'DOCUMENT_NUMBER_TAKEN';
      taken.permanent = true;
      throw taken;
    }
    throw rpcError;
  }

  // Stock cloud = ledger (stock_movements) escrito pela RPC; nunca se compara nem se escreve products.stock_quantity.
}

// Produto criado/empurrado por este Device fica activo na Store (trigger cloud): espelha ja o estado, sem esperar
// pelo proximo pull (nao inicializa o catalogo por Store).
async function mirrorStoreProductFromCloud(supabase, productCloudId, tenantId) {
  try {
    const { data, error } = await supabase
      .from('store_products')
      .select('product_id,status,price_override,min_stock,updated_at')
      .eq('product_id', productCloudId)
      .limit(1);
    if (error || !data?.length) return;
    await applyStoreProductRows(tenantId, data);
  } catch {
    // o proximo pull de store_products repoe o estado
  }
}

// Pull de store_products: o RLS limita as linhas a Store do Device. Nunca apaga nada localmente.
async function syncStoreProductsFromCloud(summary, tenantId) {
  const scopedTenantId = requireTenantId(tenantId, 'syncStoreProductsFromCloud');
  const syncId = `cloud:store_products:${scopedTenantId}`;
  const lastSyncAt = await getLastSyncAt(syncId);
  const rows = await fetchUpdatedRows(
    'store_products',
    'product_id,store_id,status,price_override,min_stock,updated_at',
    lastSyncAt,
    'updated_at',
    scopedTenantId
  );
  let maxTs = lastSyncAt;
  for (const row of rows) {
    const ts = normalizeTimestamp(row.updated_at) || new Date().toISOString();
    if (isRemoteNewer(ts, maxTs)) maxTs = ts;
  }
  const { applied } = await applyStoreProductRows(scopedTenantId, rows, { initialize: true });
  summary.processed += applied;
  if (rows.length > 0) {
    await setLastSyncAt(syncId, maxTs);
    await logSyncOperation('pull-store-products', { tenant_id: scopedTenantId, count: rows.length }, 'store_products sincronizado');
  }
}

// Configuracao de um produto NA Store deste Device (status/price_override/min_stock). Governada pela cloud:
// exige ligacao; o estado devolvido e espelhado localmente.
async function pushStoreProductConfig(localProductId, config = {}) {
  const supabase = getSupabase();
  if (!supabase) throw Object.assign(new Error('Supabase client unavailable'), { code: 'SYNC_UNAVAILABLE' });
  const tenantId = requireTenantId((await listSyncTenantIds())[0], 'pushStoreProductConfig');
  const product = await get(`SELECT cloud_id FROM products WHERE id = ? AND tenant_id = ?`, [Number(localProductId), tenantId]);
  if (!product?.cloud_id) throw Object.assign(new Error('Produto ainda não sincronizado com a cloud'), { code: 'PRODUCT_NOT_SYNCED' });
  const cfg = {};
  for (const k of ['status', 'price_override', 'min_stock']) if (Object.prototype.hasOwnProperty.call(config ?? {}, k)) cfg[k] = config[k];
  const { data, error } = await supabase.rpc('set_store_product', { p_product_id: String(product.cloud_id), p_config: cfg });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  await applyStoreProductRows(tenantId, [
    { product_id: String(product.cloud_id), status: row?.out_status, price_override: row?.out_price_override, min_stock: row?.out_min_stock, updated_at: new Date().toISOString() },
  ]);
  return { status: row?.out_status, price_override: row?.out_price_override, min_stock: row?.out_min_stock, created: Boolean(row?.out_created) };
}

async function syncProduct(payload) {
  const supabase = getSupabase();
  if (!supabase) {
    throw new Error('Supabase client unavailable');
  }
  const cloudId = requireProductCloudId(payload.cloud_id, 'product upsert');
  const tenantId = requirePayloadTenantId(payload, 'product sync');
  // Categoria tem de existir na cloud antes do produto (FK products_category_id_fkey).
  const categoryCloudId =
    payload.category_id != null
      ? (await ensureLocalCategoryOnCloud(payload.category_id, tenantId)) ??
        (await mapCategoryCloudIdFromLocal(payload.category_id, tenantId))
      : null;
  // Always bump updated_at on push so local inventário / entradas ganham à cloud stale.
  const updatedAt = new Date().toISOString();
  // Etapa 1F.2 (item 17): products.deleted é BOOLEAN no Postgres — nunca
  // depender de coerção implícita de um 0/1 cru.
  const isDeleted = toPgBoolean(payload.deleted);

  const mapped = {
    id: cloudId,
    local_id: payload.id != null ? Number(payload.id) : null,
    code: payload.code == null ? null : Number(payload.code),
    name: payload.name ?? '',
    category_id: categoryCloudId,
    barcode: payload.barcode ?? null,
    cost: Number(payload.cost ?? 0),
    price: Number(payload.price ?? 0),
    tax: Number(payload.tax ?? 0),
    final_price: Number(payload.final_price ?? payload.price ?? 0),
    min_stock: Number(payload.min_stock ?? 0),
    active: isDeleted ? false : payload.active === false ? false : true,
    unit: payload.unit ?? 'un',
    description: payload.description ?? null,
    age_restriction: payload.age_restriction == null ? null : Number(payload.age_restriction),
    is_service: payload.is_service ? true : false,
    default_quantity: payload.default_quantity === false ? false : true,
    track_lot: payload.track_lot === true || payload.trackLot === true || Number(payload.track_lot) === 1,
    color: payload.color ?? null,
    image: payload.image ?? null,
    deleted: isDeleted,
    tenant_id: tenantId,
    updated_at: updatedAt,
  };
  if (mapped.local_id != null && !Number.isFinite(mapped.local_id)) {
    mapped.local_id = null;
  }
  if (mapped.code != null && !Number.isFinite(mapped.code)) {
    mapped.code = null;
  }

  const upsertProduct = async (body) => {
    const { error } = await supabase.from('products').upsert(body, { onConflict: 'id' });
    return error;
  };

  let error = await upsertProduct(mapped);
  if (error) {
    const msg = String(error.message || error.details || '');
    // Cloud ainda sem coluna track_lot: repetir sem o campo.
    if (/track_lot/i.test(msg)) {
      const { track_lot: _omit, ...withoutTrackLot } = mapped;
      error = await upsertProduct(withoutTrackLot);
    }
  }
  if (error && isMissingColumnError(error) && mapped.local_id != null) {
    const { local_id: _omit, ...withoutLocalId } = mapped;
    error = await upsertProduct(withoutLocalId);
  }
  if (error && isBigintUuidTypeError(error) && mapped.category_id != null) {
    const { category_id: _omit, ...withoutCategory } = mapped;
    error = await upsertProduct(withoutCategory);
    if (!error) {
      await logSyncOperation(
        'push-product-category-id-omitted',
        { tenant_id: tenantId, cloud_id: mapped.id },
        'category_id omitido no push — coluna na cloud não aceita UUID. Aplique supabase/migrations/20260915000300_catalog.sql (categories.parent_id UUID) e confirme products.category_id UUID.',
        { level: 'warn' },
      );
      return;
    }
  }
  if (error) {
    throw error;
  }
  await mirrorStoreProductFromCloud(supabase, cloudId, tenantId);
}

async function syncCategory(payload) {
  const supabase = getSupabase();
  if (!supabase) {
    throw new Error('Supabase client unavailable');
  }

  const tenantId = requirePayloadTenantId(payload, 'category sync');
  const cloudId = payload?.cloud_id ? String(payload.cloud_id).trim() : '';
  const isDeleted = toPgBoolean(payload.deleted);
  if (!isUUID(cloudId)) {
    if (!isDeleted) {
      throw new Error('Invalid category cloud_id');
    }
  }

  if (isDeleted) {
    // Etapa 1F.2 (item 15): DELETE continua proibido no novo caminho — a RLS/
    // GRANT de 1E.8 não concede DELETE em `categories` a `authenticated`
    // (bateria sempre em 42501). `categories` também não tem ainda coluna de
    // soft-delete (deleted_at/active) no baseline novo. Decisão explícita e
    // documentada (item 16, mesmo tratamento aplicado a categories): a
    // eliminação fica pendente/ignorada nesta etapa, nunca contornando RLS.
    await logSyncOperation(
      'push-category-delete-unsupported',
      { tenant_id: tenantId, cloud_id: cloudId || null },
      'Eliminação de categoria não suportada no novo caminho (sem coluna de soft-delete ainda) — ignorada, não repetida indefinidamente',
      { level: 'warn' },
    );
    return;
  }

  const parentCloudId = await mapCategoryCloudIdFromLocal(payload?.parent_id, tenantId);
  const mapped = {
    id: cloudId,
    tenant_id: tenantId,
    name: String(payload?.name ?? '').trim(),
    parent_id: parentCloudId,
    color: payload?.color ? String(payload.color).trim() : null,
    updated_at: normalizeTimestamp(payload?.updated_at) || new Date().toISOString(),
  };
  if (!mapped.name) {
    throw new Error('Category name is required');
  }

  const upsertCategory = async (body) => {
    const { error } = await supabase.from('categories').upsert(body, { onConflict: 'id' });
    return error;
  };

  let error = await upsertCategory(mapped);
  // Cloud sem coluna color ainda: repetir sem color para não bloquear criação local.
  if (
    error &&
    mapped.color != null &&
    /color|PGRST204|schema cache/i.test(String(error.message ?? '') + String(error.code ?? '') + String(error.details ?? ''))
  ) {
    const { color: _omit, ...withoutColor } = mapped;
    error = await upsertCategory(withoutColor);
  }
  // parent_id bigint legado na cloud: omitir hierarquia até migration UUID.
  if (error && isBigintUuidTypeError(error) && mapped.parent_id != null) {
    const { parent_id: _omit, ...withoutParent } = mapped;
    error = await upsertCategory(withoutParent);
    if (!error) {
      await logSyncOperation(
        'push-category-parent-id-omitted',
        { tenant_id: tenantId, cloud_id: mapped.id },
        'parent_id omitido no push — coluna na cloud não aceita UUID. Aplique supabase/migrations/20260915000300_catalog.sql (categories.parent_id UUID)',
        { level: 'warn' },
      );
      return;
    }
  }
  if (!error) return;

  // Compat: schema antigo com UNIQUE(name) global, ou conflito no mesmo tenant.
  // Se já existe "Comida" neste tenant, reutiliza a linha e actualiza.
  const isDuplicateName =
    error.code === '23505' && /categories_name|uq_categories_tenant_name/i.test(String(error.message ?? ''));
  if (!isDuplicateName) throw error;

  const { data: existing, error: findErr } = await supabase
    .from('categories')
    .select('id')
    .eq('tenant_id', tenantId)
    .ilike('name', mapped.name)
    .maybeSingle();
  if (findErr) throw findErr;
  if (existing?.id) {
    const updateBody = {
      name: mapped.name,
      parent_id: mapped.parent_id,
      color: mapped.color,
      updated_at: mapped.updated_at,
    };
    let { error: updateErr } = await supabase
      .from('categories')
      .update(updateBody)
      .eq('tenant_id', tenantId)
      .eq('id', existing.id);
    if (
      updateErr &&
      mapped.color != null &&
      /color|PGRST204|schema cache/i.test(String(updateErr.message ?? '') + String(updateErr.code ?? ''))
    ) {
      const { color: _omit, ...withoutColor } = updateBody;
      ({ error: updateErr } = await supabase
        .from('categories')
        .update(withoutColor)
        .eq('tenant_id', tenantId)
        .eq('id', existing.id));
    }
    if (updateErr && isBigintUuidTypeError(updateErr) && updateBody.parent_id != null) {
      const { parent_id: _omit, ...withoutParent } = updateBody;
      ({ error: updateErr } = await supabase
        .from('categories')
        .update(withoutParent)
        .eq('tenant_id', tenantId)
        .eq('id', existing.id));
    }
    if (updateErr) throw updateErr;
    return;
  }

  throw new Error(
    `${error.message}. Aplique supabase/migrations/20260915000300_catalog.sql (categories_tenant_name_key) para permitir o mesmo nome de grupo em lojas diferentes.`,
  );
}

async function syncCustomer(payload) {
  const supabase = getSupabase();
  if (!supabase) {
    throw new Error('Supabase client unavailable');
  }
  const cloudId = payload?.cloud_id ? String(payload.cloud_id).trim() : '';
  const tenantId = requirePayloadTenantId(payload, 'customer sync');
  if (!isUUID(cloudId)) {
    throw new Error('Invalid customer cloud_id');
  }
  if (payload.deleted) {
    // Etapa 1F.2 (item 16): o POS local faz hard DELETE de clientes, mas o
    // novo caminho NUNCA o propaga para a cloud — a RLS/GRANT de 1E.8 não
    // concede DELETE em `customers` a `authenticated`, e o baseline ainda não
    // tem `deleted_at`/`active`. Em vez de inventar uma solução silenciosa
    // (ex.: contornar RLS, ou reabrir DELETE), a eliminação fica
    // explicitamente pendente/ignorada nesta etapa, documentada aqui, até
    // existir uma migration própria de soft-delete.
    await logSyncOperation(
      'push-customer-delete-unsupported',
      { tenant_id: tenantId, cloud_id: cloudId },
      'Eliminação de cliente não suportada no novo caminho (sem coluna de soft-delete ainda) — ignorada, não repetida indefinidamente',
      { level: 'warn' },
    );
    return;
  }

  const mapped = {
    id: cloudId,
    name: payload.name,
    phone: payload.phone,
    email: payload.email ?? null,
    address: payload.address ?? null,
    tenant_id: tenantId,
  };
  const { error } = await supabase.from('customers').upsert(mapped, { onConflict: 'id' });
  if (error) throw error;
}

async function processQueueItem(row) {
  const supabase = getSupabase();
  if (!supabase) return;

  let payload = null;
  let tenantId = null;
  try {
    payload = parseQueuePayload(row);
    tenantId = requireTenantId(row.tenant_id ?? payload?.tenant_id, `processQueueItem:${row.type}`);
    payload.tenant_id = tenantId;
    console.log('[QUEUE] processing:', {
      id: row.id,
      type: row.type,
      tenant_id: tenantId,
      cloud_id: payload?.cloud_id ?? null,
      entity_id: payload?.id ?? null,
    });
    if (row.type === 'stock') {
      await run(
        `UPDATE sync_queue
         SET status = 'synced', updated_at = ?, synced_at = ?, lock_token = NULL, locked_at = NULL
         WHERE id = ?
           AND tenant_id = ?`,
        [new Date().toISOString(), new Date().toISOString(), row.id, tenantId]
      );
      await logSyncOperation('stock-sync-disabled', payload, 'stock queue item ignored; sales now sync stock via create_order_with_items');
      return 'success';
    }
    if (row.type === 'sale' && !payload.local_sale_id) {
      payload.local_sale_id = `legacy-${row.id}`;
      await run(`UPDATE sync_queue SET data = ?, updated_at = ? WHERE id = ? AND tenant_id = ?`, [
        JSON.stringify(payload),
        new Date().toISOString(),
        row.id,
        tenantId,
      ]);
    }
    if (row.type === 'product' && payload && !(Number(payload.deleted ?? 0) === 1 || payload.deleted === true) && payload.id != null && !payload.cloud_id) {
      const fromDb = await get(
        `SELECT cloud_id
         FROM products
         WHERE id = ?
           AND tenant_id = ?
           AND COALESCE(deleted, 0) = 0
         LIMIT 1`,
        [Number(payload.id), tenantId]
      );
      if (fromDb?.cloud_id) payload.cloud_id = String(fromDb.cloud_id).trim();
    }
    const validation = validatePayload(row.type, payload);
    if (!validation.valid) {
      throw new Error(validation.reason);
    }

    if (row.type === 'sale') {
      await syncSaleAtomically(payload);
    } else if (row.type === 'product') {
      await syncProduct(payload);
    } else if (row.type === 'category') {
      await syncCategory(payload);
    } else if (row.type === 'customer') {
      await syncCustomer(payload);
    } else {
      throw new Error(`Unsupported sync type: ${row.type}`);
    }

    await run(
      `UPDATE sync_queue
       SET status = 'synced', updated_at = ?, synced_at = ?, lock_token = NULL, locked_at = NULL
       WHERE id = ?
         AND tenant_id = ?`,
      [new Date().toISOString(), new Date().toISOString(), row.id, tenantId]
    );
    await logSyncOperation(
      'queue-item-success',
      { tenant_id: tenantId, queue_id: row.id, type: row.type },
      `Item da fila sincronizado com sucesso (${row.type})`,
    );
    return 'success';
  } catch (error) {
    await logSyncError({
      queueId: row.id,
      type: row.type,
      payload: { tenant_id: tenantId },
      error,
    });
    // Etapa 1F.2 (item 22/23): DeviceAuthUnavailableError (bridge em baixo,
    // refresh a falhar por rede, access token ainda não obtido) tratado
    // exactamente como um erro de rede — nunca consome retries, nunca marca
    // failed/dead. O item continua pending/retry; o PRÓXIMO ciclo tenta de novo.
    if (isNetworkOfflineError(error) || isRetryableWithoutPenalty(classifySyncError(error))) {
      await run(
        `UPDATE sync_queue
         SET lock_token = NULL, locked_at = NULL, updated_at = ?
         WHERE id = ?
           AND tenant_id = ?`,
        [new Date().toISOString(), row.id, tenantId]
      );
      return 'offline';
    }
    const permanent = isPermanentError(error);
    const nextRetries = permanent ? MAX_RETRIES : Number(row.retries ?? 0) + 1;
    const isDead = nextRetries >= MAX_RETRIES;
    const nextRetryAt = isDead ? null : new Date(Date.now() + getBackoffMs(nextRetries)).toISOString();
    const nextStatus = isDead ? 'dead' : 'failed';

    await run(
      `UPDATE sync_queue
       SET status = ?, retries = ?, next_retry_at = ?, updated_at = ?, lock_token = NULL, locked_at = NULL
       WHERE id = ?
         AND tenant_id = ?`,
      [nextStatus, nextRetries, nextRetryAt, new Date().toISOString(), row.id, tenantId]
    );

    await logSyncError({
      queueId: row.id,
      type: row.type,
      payload,
      error,
    });
    return isDead ? 'dead' : 'failed';
  }
}

async function claimQueueItem(rowId, tenantId, lockToken) {
  const lockCutoff = new Date(Date.now() - LOCK_TIMEOUT_MS).toISOString();
  const result = await run(
    `UPDATE sync_queue
     SET lock_token = ?, locked_at = ?, updated_at = ?
     WHERE id = ?
       AND tenant_id = ?
       AND retries < ?
       AND (status = 'pending' OR status = 'failed')
       AND (lock_token IS NULL OR locked_at IS NULL OR locked_at <= ?)`,
    [lockToken, new Date().toISOString(), new Date().toISOString(), rowId, tenantId, MAX_RETRIES, lockCutoff]
  );
  return result.changes > 0;
}

async function fetchClaimedItem(rowId, tenantId, lockToken) {
  return get(
    `SELECT id, tenant_id, type, data, status, retries, created_at, next_retry_at, lock_token, locked_at, sync_ref
     FROM sync_queue
     WHERE id = ? AND tenant_id = ? AND lock_token = ?`,
    [rowId, tenantId, lockToken]
  );
}

async function processSyncQueueCycle() {
  if (operatorPaused) {
    const paused = createSummary();
    paused.skipped = true;
    paused.reason = 'paused_by_operator';
    return paused;
  }
  const supabase = getSupabase();

  console.log('[DEBUG QUEUE START]', {
    hasSupabaseInstance: !!supabase
  });

  console.log('[DEBUG SUPABASE]', {
    url: process.env.SUPABASE_URL,
    anonKey: !!process.env.SUPABASE_ANON_KEY,
    supabaseInstance: !!supabase
  });

  const summary = createSummary();
  if (isRunning) {
    summary.skipped = true;
    summary.reason = 'sync_already_running';
    return summary;
  }
  isRunning = true;

  try {
    const online = await isInternetAvailable();
    const queueStats = await get(
      `SELECT
         SUM(CASE WHEN status IN ('pending', 'failed') THEN 1 ELSE 0 END) AS active,
         SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed
       FROM sync_queue`
    );
    const activeQueue = Number(queueStats?.active ?? 0);
    const failedQueue = Number(queueStats?.failed ?? 0);
    logConnectivityTransition(online, { cycle: 'queue', activeQueue, failedQueue });
    console.log('[DEBUG QUEUE STATUS]', {
      online,
      hasSupabase: !!supabase
    });
    if (!supabase) {
      summary.skipped = true;
      summary.reason = 'missing_supabase';
      return summary;
    }

    if (!online) {
      console.log('[sync][queue] skipped: offline', {
        queue_size: activeQueue,
        failed_attempts: failedQueue,
      });
      summary.skipped = true;
      summary.reason = 'offline';
      return summary;
    }

    // Etapa 1F.2 (item 8/22): mesmo pré-voo de device auth do pull — pausa a
    // fila inteira sem tocar em nenhum item (nunca consome retries, nunca
    // marca nada como failed/dead por causa de uma indisponibilidade de auth).
    const deviceAuthOk = await isDeviceAuthAvailable();
    if (!deviceAuthOk) {
      console.log('[sync][queue] skipped: device_auth_unavailable', {
        queue_size: activeQueue,
        failed_attempts: failedQueue,
      });
      summary.skipped = true;
      summary.reason = 'device_auth_unavailable';
      return summary;
    }

    // Itens mortos por FK (produto antes da categoria) voltam a pending — agora com ensure-category.
    try {
      await run(
        `UPDATE sync_queue
         SET status = 'pending', retries = 0, next_retry_at = NULL,
             lock_token = NULL, locked_at = NULL, updated_at = ?
         WHERE status = 'dead'
           AND type IN ('product', 'category')`,
        [new Date().toISOString()],
      );
    } catch (reviveErr) {
      await logSyncOperation(
        'queue-revive-dead-catalog-failed',
        { reason: String(reviveErr?.message ?? reviveErr) },
        'Falha ao repor itens mortos (product/category) como pending',
        { level: 'warn' },
      );
    }

    try {
      await syncWarehousesToCloud();
      await syncStockLedgerToCloud();
      await syncTransfersToCloud();
      if (Date.now() - lastReconcileAt > RECONCILE_INTERVAL_MS) await reconcileStockWithCloud();
    } catch (whErr) {
      await logSyncOperation(
        'push-warehouses-or-ledger-failed',
        { reason: String(whErr?.message ?? whErr) },
        'Falha ao sincronizar armazéns/movimentos de stock locais para a cloud',
        { level: 'warn' },
      );
    }

    const rows = await all(
      `SELECT id, tenant_id
       FROM sync_queue
       WHERE (status = 'pending' OR status = 'failed')
         AND retries < ?
         AND (next_retry_at IS NULL OR next_retry_at <= ?)
         AND (lock_token IS NULL OR locked_at IS NULL OR locked_at <= ?)
       ORDER BY
         CASE type
           WHEN 'category' THEN 0
           WHEN 'customer' THEN 1
           WHEN 'product' THEN 2
           WHEN 'sale' THEN 3
           ELSE 4
         END,
         created_at ASC
       LIMIT ?`,
      [MAX_RETRIES, new Date().toISOString(), new Date(Date.now() - LOCK_TIMEOUT_MS).toISOString(), MAX_ITEMS_PER_CYCLE]
    );

    if (rows.length === 0) {
      console.log('[sync][queue] no items to sync', {
        queue_size: activeQueue,
        failed_attempts: failedQueue,
      });
      return {
        ...summary,
        skipped: false,
        reason: 'no_items_to_sync'
      };
    }

    let offlineDetected = false;

    const worker = async () => {
      while (rows.length > 0) {
        if (offlineDetected) return;
        const next = rows.shift();
        if (!next) return;
        const tenantId = requireTenantId(next.tenant_id, 'processSyncQueueCycle');

        const lockToken = crypto.randomUUID();
        const claimed = await claimQueueItem(next.id, tenantId, lockToken);
        if (!claimed) continue;

        const claimedRow = await fetchClaimedItem(next.id, tenantId, lockToken);
        if (!claimedRow) continue;
        const result = await processQueueItem(claimedRow);
        if (result === 'offline') {
          offlineDetected = true;
          logConnectivityTransition(false, { cycle: 'queue', reason: 'network_error_during_item' });
          console.log('[sync][queue] skipped: offline during processing', {
            queue_size: activeQueue,
            failed_attempts: failedQueue,
          });
          return;
        }
        summary.processed += 1;
        if (result === 'success') summary.success += 1;
        else if (result === 'dead') summary.dead += 1;
        else summary.failed += 1;
      }
    };

    const workers = [];
    const workerCount = Math.min(PARALLEL_WORKERS, rows.length);
    for (let i = 0; i < workerCount; i += 1) {
      workers.push(worker());
    }
    await Promise.all(workers);
    if (offlineDetected) {
      summary.skipped = true;
      summary.reason = 'offline';
      return summary;
    }
  } catch (error) {
    if (isNetworkOfflineError(error) || isRetryableWithoutPenalty(classifySyncError(error))) {
      logConnectivityTransition(false, { cycle: 'queue', reason: 'network_error_in_cycle' });
      summary.skipped = true;
      summary.reason = 'offline';
      return summary;
    }
    await logSyncError({
      type: 'queue-cycle',
      payload: null,
      error,
    });
    summary.skipped = true;
    summary.reason = 'queue_cycle_error';
  } finally {
    isRunning = false;
  }
  return summary;
}

function isCloudSyncConfigured() {
  return Boolean(getSupabase());
}

function isSyncServiceActive() {
  return Boolean(timer);
}

function startSyncService() {
  if (timer) return;

  const supabase = getSupabase();
  if (!supabase) {
    logWarn('sync_offline_only_boot', {
      event: 'sync.offline_only',
      message: 'Serviço de sync não iniciado — credenciais Supabase em falta',
      module: 'sync',
      action: 'startSyncService',
      reason: 'SUPABASE_URL / SUPABASE_ANON_KEY não configurados',
    });
    void logSyncOperation(
      'offline_only_boot',
      { reason: 'supabase_not_configured' },
      'Sync cloud desactivado: SUPABASE_URL / SUPABASE_ANON_KEY não configurados no processo da API',
      { level: 'warn' },
    );
    return;
  }
  // Nota (Etapa 1F.2): getSupabase() acima só confirma URL+anon key — não
  // confirma que há um Device JWT obtenível AGORA (isso é dinâmico, pode
  // mudar horas depois do arranque). Por isso o timer arranca de qualquer
  // forma; cada ciclo (processPullSyncCycle/processSyncQueueCycle) faz o seu
  // próprio pré-voo isDeviceAuthAvailable() e pausa-se sozinho se for preciso.

  timer = setInterval(() => {
    processFullSyncCycle().catch((error) => {
      logError('sync_cycle_crashed', {
        event: 'sync.cycle_crashed',
        message: `Ciclo de sync falhou: ${error?.message ?? error}`,
        module: 'sync',
        action: 'processFullSyncCycle',
        reason: 'Excepção não tratada no intervalo do sync',
        error,
      });
    });
  }, DEFAULT_INTERVAL_MS);

  processFullSyncCycle().catch((error) => {
    logError('sync_initial_cycle_failed', {
      event: 'sync.initial_cycle_failed',
      message: `Ciclo inicial de sync falhou: ${error?.message ?? error}`,
      module: 'sync',
      action: 'processFullSyncCycle',
      reason: 'Primeiro ciclo após arranque da API',
      error,
    });
  });

  logEvent(
    'info',
    'sync.service_started',
    `Serviço de sincronismo iniciado (intervalo ${DEFAULT_INTERVAL_MS}ms)`,
    {
      source: 'api',
      module: 'sync',
      action: 'startSyncService',
      reason: 'API pronta e Supabase configurado',
      interval_ms: DEFAULT_INTERVAL_MS,
      batch_size: MAX_ITEMS_PER_CYCLE,
    },
  );
}

function stopSyncService() {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
}

/** Pausa explícita: timer parado + gate nos 3 ciclos. Idempotente. */
function pauseSyncService() {
  operatorPaused = true;
  stopSyncService();
}

/** Retoma: levanta o gate e volta a arrancar o timer (nunca cria um 2.º — startSyncService já é idempotente). */
function resumeSyncService() {
  operatorPaused = false;
  startSyncService();
}

/** Estado real (nunca inferido): timer vivo, pausa explícita, ciclo em curso. */
function getSyncRuntimeState() {
  return {
    sync_active: Boolean(timer),
    paused_by_operator: operatorPaused,
    cycle_running: isRunning || isPullRunning,
  };
}

export {
  startSyncService,
  stopSyncService,
  pauseSyncService,
  resumeSyncService,
  getSyncRuntimeState,
  processSyncQueueCycle,
  processPullSyncCycle,
  processFullSyncCycle,
  fullSyncFromCloud,
  isInternetAvailable,
  isCloudSyncConfigured,
  isSyncServiceActive,
  reconcileStockWithCloud,
  pushStoreProductConfig,
  cancelTransferViaCloud,
  syncTransfersToCloud,
};
