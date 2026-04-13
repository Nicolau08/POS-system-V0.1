import { URL, fileURLToPath } from 'url';
import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';
import path from 'path';
import dotenv from 'dotenv';
import { all, get, run } from './dbUtils.js';
import { isUuidString, requireProductCloudId } from './cloudIdUtils.js';
import { logSyncError } from './syncLogger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({
  path: path.resolve(__dirname, '../.env'),
});
console.log('[SYNC ENV CHECK]', {
  url: process.env.SUPABASE_URL,
  key: !!process.env.SUPABASE_SERVICE_ROLE_KEY
});

const MAX_RETRIES = 5;
const DEFAULT_INTERVAL_MS = Number(process.env.SYNC_INTERVAL_MS ?? 10000);
const MAX_ITEMS_PER_CYCLE = Number(process.env.SYNC_BATCH_SIZE ?? 25);
const LOCK_TIMEOUT_MS = Number(process.env.SYNC_LOCK_TIMEOUT_MS ?? 60000);
const PARALLEL_WORKERS = Math.min(5, Math.max(1, Number(process.env.SYNC_PARALLEL_WORKERS ?? 5)));

function getSupabase() {
  const supabaseUrl =
    process.env.SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    '';

  const supabaseKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    '';

  if (!supabaseUrl || !supabaseKey) return null;

  return createClient(supabaseUrl, supabaseKey);
}

let timer = null;
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

function logConnectivityTransition(isOnline, context = {}) {
  if (lastConnectivityState === isOnline) return;
  lastConnectivityState = isOnline;
  if (!isOnline) {
    console.warn('[sync][connectivity] offline - pausing sync cycles', context);
  } else {
    console.log('[sync][connectivity] online - resuming sync cycles', context);
  }
}

function normalizeTimestamp(value) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
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

async function resolveCustomerUUID(id) {
  if (!id) return null;
  const normalized = String(id).trim();
  if (isUUID(normalized)) return normalized;
  const row = await get(`SELECT cloud_id FROM clientes WHERE id = ? LIMIT 1`, [Number(normalized)]);
  const cloudId = row?.cloud_id ? String(row.cloud_id).trim() : null;
  return cloudId && isUUID(cloudId) ? cloudId : null;
}

async function ensureCustomerSynced(selectedCustomerId) {
  const customerUUID = await resolveCustomerUUID(selectedCustomerId);
  if (!customerUUID && selectedCustomerId) {
    console.warn('[SYNC WARNING] Invalid customer mapping', { selectedCustomerId });
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

async function logSyncOperation(type, payload, message) {
  try {
    await run(`INSERT INTO sync_logs (queue_id, type, payload, error_message) VALUES (?, ?, ?, ?)`, [
      null,
      type,
      payload == null ? null : JSON.stringify(payload),
      message,
    ]);
  } catch (error) {
    console.error('[sync] failed to persist sync operation log:', error.message);
  }
}

async function fetchUpdatedRows(table, fields, lastSyncAt, timestampField = 'updated_at') {
  const supabase = getSupabase();
  if (!supabase) return [];
  const pageSize = 500;
  let page = 0;
  const rows = [];
  while (true) {
    const from = page * pageSize;
    const to = from + pageSize - 1;
    let query = supabase.from(table).select(fields).gt(timestampField, lastSyncAt).order(timestampField, { ascending: true });
    let { data, error } = await query.range(from, to);
    if (error && (String(error.message || '').includes('column') || String(error.code || '') === '42703') && timestampField !== 'created_at') {
      query = supabase.from(table).select(fields).gt('created_at', lastSyncAt).order('created_at', { ascending: true });
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

async function fetchAllRows(table, fields, orderByField = 'created_at') {
  const supabase = getSupabase();
  if (!supabase) return [];
  const pageSize = 500;
  let page = 0;
  const rows = [];
  while (true) {
    const from = page * pageSize;
    const to = from + pageSize - 1;
    let query = supabase.from(table).select(fields);
    if (orderByField) {
      query = query.order(orderByField, { ascending: true });
    }
    let { data, error } = await query.range(from, to);
    if (error && orderByField === 'updated_at') {
      query = supabase.from(table).select(fields).order('created_at', { ascending: true });
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

async function mapCategoryIdFromCloud(cloudCategoryId) {
  if (!cloudCategoryId) return null;
  const local = await get(`SELECT id FROM categories WHERE cloud_id = ? LIMIT 1`, [String(cloudCategoryId)]);
  return local?.id ?? null;
}

async function mapCategoryCloudIdFromLocal(localCategoryId) {
  const localIdNumber = Number(localCategoryId);
  if (!Number.isFinite(localIdNumber)) return null;
  const row = await get(`SELECT cloud_id FROM categories WHERE id = ? LIMIT 1`, [localIdNumber]);
  const cloudId = row?.cloud_id ? String(row.cloud_id).trim() : '';
  return cloudId || null;
}

async function resolveProductCloudId(localProductId) {
  const row = await get(`SELECT cloud_id FROM products WHERE id = ? LIMIT 1`, [Number(localProductId)]);
  const cid = row?.cloud_id;
  if (!cid || !isUuidString(String(cid))) return null;
  return String(cid).trim();
}

async function syncCategoriesFromCloud(summary) {
  const syncId = 'cloud:categories';
  const lastSyncAt = await getLastSyncAt(syncId);
  const rows = await fetchUpdatedRows('categories', 'id,name,parent_id,updated_at,created_at', lastSyncAt, 'updated_at');
  let maxTs = lastSyncAt;

  for (const row of rows) {
    const remoteTs = normalizeTimestamp(row.updated_at || row.created_at) || new Date().toISOString();
    if (isRemoteNewer(remoteTs, maxTs)) maxTs = remoteTs;
    const existing = await get(`SELECT id, updated_at, name FROM categories WHERE cloud_id = ? OR name = ? LIMIT 1`, [
      String(row.id),
      row.name,
    ]);

    const parentLocalId = await mapCategoryIdFromCloud(row.parent_id);
    summary.processed += 1;
    if (!existing) {
      await run(
        `INSERT INTO categories (name, parent_id, cloud_id, updated_at) VALUES (?, ?, ?, ?)`,
        [row.name, parentLocalId, String(row.id), remoteTs]
      );
      summary.inserted += 1;
      continue;
    }

    if (!isRemoteNewer(remoteTs, existing.updated_at)) {
      summary.skipped += 1;
      continue;
    }

    await run(
      `UPDATE categories
       SET name = ?, parent_id = ?, cloud_id = ?, updated_at = ?
       WHERE id = ?`,
      [row.name, parentLocalId, String(row.id), remoteTs, existing.id]
    );
    summary.updated += 1;
  }

  if (rows.length > 0) {
    await setLastSyncAt(syncId, maxTs);
    await logSyncOperation('pull-categories', { count: rows.length, last_sync_at: maxTs }, 'categories synced from cloud');
  }
}

async function syncProductsFromCloud(summary) {
  const syncId = 'cloud:products';
  const lastSyncAt = await getLastSyncAt(syncId);
  const rows = await fetchUpdatedRows(
    'products',
    'id,code,name,category_id,barcode,cost,price,tax,final_price,active,unit,description,age_restriction,is_service,default_quantity,stock_quantity,min_stock,color,image,image_url,local_id,created_at,updated_at',
    lastSyncAt,
    'updated_at'
  );
  let maxTs = lastSyncAt;

  for (const row of rows) {
    const remoteTs = normalizeTimestamp(row.updated_at || row.created_at) || new Date().toISOString();
    if (isRemoteNewer(remoteTs, maxTs)) maxTs = remoteTs;
    const categoryLocalId = await mapCategoryIdFromCloud(row.category_id);
    const existing = await get(`SELECT id, updated_at, image FROM products WHERE cloud_id = ? LIMIT 1`, [String(row.id)]);
    summary.processed += 1;

    const remoteImageRaw = row.image ?? row.image_url ?? null;
    const normalizedRemoteImage = typeof remoteImageRaw === 'string' ? remoteImageRaw.trim() : remoteImageRaw;
    const mappedImage = normalizedRemoteImage || existing?.image || null;

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
      stock_quantity: Number(row.stock_quantity ?? 0),
      min_stock: Number(row.min_stock ?? 0),
      color: row.color ?? null,
      image: mappedImage,
      created_at: normalizeTimestamp(row.created_at) || remoteTs,
      updated_at: remoteTs,
    };

    if (!existing) {
      await run(
        `INSERT INTO products
          (cloud_id, code, name, category_id, barcode, cost, price, tax, final_price, active, unit, description, age_restriction, is_service, default_quantity, stock_quantity, min_stock, color, image, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          mapped.cloud_id,
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
          mapped.stock_quantity,
          mapped.min_stock,
          mapped.color,
          mapped.image,
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

    await run(
      `UPDATE products SET
        code = ?, name = ?, category_id = ?, barcode = ?, cost = ?, price = ?, tax = ?, final_price = ?, active = ?, unit = ?,
        description = ?, age_restriction = ?, is_service = ?, default_quantity = ?, stock_quantity = ?, min_stock = ?, color = ?, image = ?, updated_at = ?
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
        mapped.stock_quantity,
        mapped.min_stock,
        mapped.color,
        mapped.image,
        mapped.updated_at,
        existing.id,
      ]
    );
    summary.updated += 1;
  }

  if (rows.length > 0) {
    await setLastSyncAt(syncId, maxTs);
    await logSyncOperation('pull-products', { count: rows.length, last_sync_at: maxTs }, 'products synced from cloud');
  }

  // Reconcile stock snapshot from cloud for all mapped products.
  // This handles cases where stock_quantity changed remotely without bumping updated_at.
  const stockRows = await fetchAllRows('products', 'id,stock_quantity,updated_at,created_at', 'updated_at');
  for (const row of stockRows ?? []) {
    const local = await get(`SELECT id, stock_quantity FROM products WHERE cloud_id = ? LIMIT 1`, [String(row.id)]);
    if (!local?.id) continue;
    const remoteStock = Number(row.stock_quantity ?? 0);
    const localStock = Number(local.stock_quantity ?? 0);
    if (remoteStock === localStock) continue;

    const ts = normalizeTimestamp(row.updated_at || row.created_at) || new Date().toISOString();
    await run(
      `UPDATE products
       SET stock_quantity = ?, updated_at = ?
       WHERE id = ?`,
      [remoteStock, ts, Number(local.id)]
    );
    summary.stock_reconciled += 1;
    summary.updated += 1;
    console.log('[sync][products] reconciled stock from cloud', {
      cloud_id: String(row.id),
      local_id: Number(local.id),
      from: localStock,
      to: remoteStock,
    });
  }
}

async function syncCustomersFromCloud(summary) {
  const syncId = 'cloud:customers';
  const lastSyncAt = await getLastSyncAt(syncId);
  const rows = await fetchUpdatedRows('customers', 'id,name,phone,email,address,updated_at,created_at', lastSyncAt, 'updated_at');
  let maxTs = lastSyncAt;

  for (const row of rows) {
    const remoteTs = normalizeTimestamp(row.updated_at || row.created_at) || new Date().toISOString();
    if (isRemoteNewer(remoteTs, maxTs)) maxTs = remoteTs;
    const existing = await get(`SELECT id, updated_at FROM clientes WHERE cloud_id = ? LIMIT 1`, [String(row.id)]);
    summary.processed += 1;

    const mappedPhone = row.phone == null ? '' : String(row.phone);
    if (!existing) {
      await run(
        `INSERT INTO clientes (name, phone, email, address, cloud_id, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [row.name, mappedPhone, row.email ?? null, row.address ?? null, String(row.id), remoteTs]
      );
      summary.inserted += 1;
      continue;
    }

    if (!isRemoteNewer(remoteTs, existing.updated_at)) {
      summary.skipped += 1;
      continue;
    }

    await run(
      `UPDATE clientes SET name = ?, phone = ?, email = ?, address = ?, cloud_id = ?, updated_at = ? WHERE id = ?`,
      [row.name, mappedPhone, row.email ?? null, row.address ?? null, String(row.id), remoteTs, existing.id]
    );
    summary.updated += 1;
  }

  if (rows.length > 0) {
    await setLastSyncAt(syncId, maxTs);
    await logSyncOperation('pull-customers', { count: rows.length, last_sync_at: maxTs }, 'customers synced from cloud');
  }
}

async function syncUsersFromCloud(summary) {
  const supabase = getSupabase();
  if (!supabase) {
    summary.skippedEntities.push('users');
    return;
  }
  const syncId = 'cloud:users';
  const lastSyncAt = await getLastSyncAt(syncId);
  const isInitialPull = lastSyncAt === '1970-01-01T00:00:00.000Z';
  let rows = [];
  let error = null;

  if (isInitialPull) {
    ({ data: rows, error } = await supabase
      .from('users')
      .select('*')
      .order('created_at', { ascending: true }));
  } else {
    ({ data: rows, error } = await supabase
      .from('users')
      .select('*')
      .or(`updated_at.gt.${lastSyncAt},updated_at.is.null`)
      .order('updated_at', { ascending: true, nullsFirst: true }));
    if (error && String(error.code || '') === '42703') {
      ({ data: rows, error } = await supabase
        .from('users')
        .select('*')
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
    const remoteTs = normalizeTimestamp(row.updated_at ?? row.created_at) || new Date().toISOString();
    if (isRemoteNewer(remoteTs, maxTs)) maxTs = remoteTs;
    const existing = await get(`SELECT id, cloud_id, pin, updated_at FROM users WHERE cloud_id = ? LIMIT 1`, [String(row.id)]);
    summary.processed += 1;
    const incomingPin = row.pin ?? row.password ?? null;

    if (!existing) {
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
        `INSERT INTO users (id, name, role, pin, cloud_id, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
        [String(row.id), row.name ?? 'User', row.role ?? 'cashier', String(incomingPin), String(row.id), remoteTs]
      );
      summary.inserted += 1;
      console.log(`[sync][users] inserted cloud_id=${String(row.id)}`);
      continue;
    }

    if (!isRemoteNewer(remoteTs, existing.updated_at)) {
      summary.skipped += 1;
      continue;
    }

    const shouldUpdatePin = (!existing.pin || String(existing.pin).trim() === '') && incomingPin;
    const nextPin = shouldUpdatePin ? String(incomingPin) : existing.pin;
    if (!shouldUpdatePin && incomingPin && String(incomingPin) !== String(existing.pin)) {
      summary.conflicts += 1;
      await logSyncOperation(
        'pull-users-conflict',
        { user_id: existing.id, cloud_user_id: row.id },
        'user credential not overwritten because local pin already exists'
      );
    }

    await run(
      `UPDATE users SET name = ?, role = ?, pin = ?, cloud_id = ?, updated_at = ? WHERE id = ?`,
      [row.name ?? 'User', row.role ?? 'cashier', nextPin, String(row.id), remoteTs, existing.id]
    );
    summary.updated += 1;
    console.log(`[sync][users] updated cloud_id=${String(row.id)} local_id=${existing.id}`);
  }

  // Handle deletions from cloud: remove local users that no longer exist remotely.
  try {
    const { data: remoteIdRows, error: remoteIdError } = await supabase.from('users').select('id');
    if (remoteIdError) {
      throw remoteIdError;
    }

    const remoteIds = new Set((remoteIdRows ?? []).map((item) => String(item.id)));
    const localUsers = await all(
      `SELECT id, cloud_id, updated_at FROM users
       WHERE cloud_id IS NOT NULL AND TRIM(cloud_id) <> ''`
    );
    const localIdsToDelete = (localUsers ?? [])
      .filter((item) => {
        if (remoteIds.has(String(item.cloud_id))) return false;
        // During the initial pull, we treat the cloud as the source of truth.
        if (isInitialPull) return true;
        // Avoid deleting local users that were created/updated after the last successful pull.
        // This prevents deleting "pending" local users that haven't been pushed yet.
        if (!item.updated_at) return false;
        return String(item.updated_at) <= String(lastSyncAt);
      })
      .map((item) => item.id);

    for (const localId of localIdsToDelete) {
      await run(`DELETE FROM users WHERE id = ?`, [localId]);
    }

    if (localIdsToDelete.length > 0) {
      console.log(`[sync][users] removed ${localIdsToDelete.length} local user(s) deleted in cloud`);
      summary.updated += localIdsToDelete.length;
      await logSyncOperation(
        'pull-users-delete',
        { removed_local_ids: localIdsToDelete, count: localIdsToDelete.length },
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
    await logSyncOperation('pull-users', { count: rows.length, last_sync_at: maxTs }, 'users synced from cloud');
  }
}

async function syncUsersToCloud(summary) {
  const supabase = getSupabase();
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

  const localUsers = await all(
    `SELECT rowid AS rid, id, name, role, pin, cloud_id, updated_at
     FROM users`
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
    const key = `${nameKey}::${roleKey}::${pinKey}`;
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
    await run(`DELETE FROM users WHERE rowid IN (${placeholders})`, ridsToDelete);
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

    toUpsert.push({
      id: cloudId,
      cloud_id: cloudId,
      name: u.name ?? 'User',
      role: u.role ?? 'cashier',
      // Supabase schema in your project seems to use `password` (not `pin`).
      password: u.pin ?? '',
      updated_at: now,
    });
  }

  for (const item of toUpsert) {
    summary.processed += 1;
    try {
      const { error: upsertError } = await supabase.from('users').upsert(item, { onConflict: 'id' });
      if (upsertError) {
        summary.failed += 1;
        await logSyncOperation(
          'push-users-failed',
          { cloud_user_id: item.id },
          upsertError.message
        );
      } else {
        summary.success += 1;
      }
    } catch (error) {
      summary.failed += 1;
      await logSyncOperation(
        'push-users-exception',
        { cloud_user_id: item.id },
        String(error?.message ?? error)
      );
    }
  }

  // Reconcile deletions from local -> cloud:
  // delete remote users that are not present in the local cloud_id set.
  try {
    const localDesiredIds = new Set(cloudIds.map((id) => String(id)));
    if (localDesiredIds.size > 0) {
      const { data: remoteIdRows, error: remoteIdError } = await supabase.from('users').select('id');
      if (remoteIdError) throw remoteIdError;

      const remoteIds = (remoteIdRows ?? []).map((r) => String(r.id));
      const toDelete = remoteIds.filter((id) => !localDesiredIds.has(id));

      if (toDelete.length > 0) {
        // Supabase accepts `in()` lists, but keep chunks reasonable.
        const chunkSize = 500;
        for (let i = 0; i < toDelete.length; i += chunkSize) {
          const chunk = toDelete.slice(i, i + chunkSize);
          const { error: delError } = await supabase.from('users').delete().in('id', chunk);
          if (delError) throw delError;
        }

        summary.processed += toDelete.length;
        await logSyncOperation(
          'push-users-delete-missing-local',
          { deleted: toDelete.length },
          'removed remote users missing from local cloud_id set'
        );
      }
    }
  } catch (deleteMissingLocalError) {
    await logSyncOperation(
      'push-users-delete-missing-local-skip',
      { reason: String(deleteMissingLocalError?.message ?? deleteMissingLocalError) },
      'failed to reconcile remote users missing locally'
    );
  }

  // Cleanup: remove remote users by name whose id is not in the desired set.
  // This prevents duplicates caused by previous sync runs with invalid local identifiers.
  try {
    const localNameRoleSet = new Set(
      (users ?? []).map((u) => `${String(u.name ?? '').trim()}::${String(u.role ?? '').trim()}`).filter((k) => !k.startsWith('::'))
    );
    const localDesiredIds = new Set(cloudIds.map((id) => String(id)));

    if (localNameRoleSet.size > 0) {
      const { data: remoteAllRows, error: remoteAllError } = await supabase
        .from('users')
        .select('id,name,role');
      if (remoteAllError) throw remoteAllError;

      const toDelete = (remoteAllRows ?? []).filter((r) => {
        const k = `${String(r.name ?? '').trim()}::${String(r.role ?? '').trim()}`;
        if (!localNameRoleSet.has(k)) return false;
        return !localDesiredIds.has(String(r.id));
      });

      for (const r of toDelete) {
        const { error: delError } = await supabase.from('users').delete().eq('id', r.id);
        if (delError) throw delError;
        summary.processed += 1;
      }

      if (toDelete.length > 0) {
        await logSyncOperation(
          'push-users-cleanup',
          { deleted: toDelete.length },
          'removed remote duplicate users not present in local cloud_id set'
        );
      }
    }
  } catch (cleanupError) {
    await logSyncOperation(
      'push-users-cleanup-skip',
      { reason: String(cleanupError?.message ?? cleanupError) },
      'failed to cleanup remote duplicate users'
    );
  }

  return summary;
}

async function refreshLocalProductStockFromCloud(cloudProductId, localProductId, fallbackTs) {
  const supabase = getSupabase();
  if (!supabase) return;
  const { data, error } = await supabase
    .from('products')
    .select('stock_quantity, updated_at, created_at')
    .eq('id', String(cloudProductId))
    .maybeSingle();
  if (error || !data) return;
  const stock = Number(data.stock_quantity ?? 0);
  const nextTs = normalizeTimestamp(data.updated_at || data.created_at) || fallbackTs || new Date().toISOString();
  console.log('[SYNC STOCK ← CLOUD]', 'localProductId=', localProductId, 'cloudProductId=', cloudProductId, 'stock=', stock);
  await run(
    `UPDATE products
     SET stock_quantity = ?, updated_at = ?
     WHERE id = ?`,
    [stock, nextTs, Number(localProductId)]
  );
}

async function syncStockMovementsFromCloud(summary) {
  const syncId = 'cloud:stock_movements';
  const lastSyncAt = await getLastSyncAt(syncId);
  const rows = await fetchUpdatedRows(
    'stock_movements',
    'id,product_id,type,quantity,reference_id,created_at',
    lastSyncAt,
    'created_at'
  );
  let maxTs = lastSyncAt;

  for (const row of rows) {
    const createdTs = normalizeTimestamp(row.created_at) || new Date().toISOString();
    if (isRemoteNewer(createdTs, maxTs)) maxTs = createdTs;
    summary.processed += 1;
    const localProduct = await get(`SELECT id FROM products WHERE cloud_id = ? LIMIT 1`, [String(row.product_id)]);
    if (!localProduct?.id) {
      summary.conflicts += 1;
      await logSyncOperation(
        'pull-stock-conflict',
        { movement_id: row.id, product_id: row.product_id },
        'stock movement skipped because local product mapping was not found'
      );
      continue;
    }

    const result = await run(
      `INSERT OR IGNORE INTO stock_movements
        (cloud_id, product_id, movement_type, quantity, reference_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [String(row.id), Number(localProduct.id), row.type, Number(row.quantity ?? 0), row.reference_id, createdTs, createdTs]
    );
    if (result.changes > 0) {
      await refreshLocalProductStockFromCloud(row.product_id, localProduct.id, createdTs);
      summary.stock_inserted += 1;
      summary.inserted += 1;
    } else {
      summary.skipped += 1;
    }
  }

  if (rows.length > 0) {
    await setLastSyncAt(syncId, maxTs);
    await logSyncOperation('pull-stock-movements', { count: rows.length, last_sync_at: maxTs }, 'stock movements synced');
  }
}

async function processPullSyncCycle() {
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
    console.log('[DEBUG PULL STATUS]', {
      online,
      hasSupabase: !!supabase
    });
    if (!online || !supabase) {
      summary.skipped = true;
      summary.reason = 'offline_or_missing_supabase';
      return summary;
    }

    await syncCategoriesFromCloud(summary);
    await syncProductsFromCloud(summary);
    await syncCustomersFromCloud(summary);
    await syncUsersFromCloud(summary);
    await syncStockMovementsFromCloud(summary);
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
  // Pull first so deletions from Supabase are applied to local SQLite
  // before we push local state back to Supabase in the same cycle.
  const pull = await processPullSyncCycle();

  const pushSummary = createSummary();
  const usersPush = await syncUsersToCloud(pushSummary);
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

async function fullSyncFromCloud() {
  const supabase = getSupabase();
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

    await logSyncOperation('full-reset-start', { started_at: startedAt }, 'manual full reset started');

    const [categories, products, customers, users, stockMovements, orders, orderItems] = await Promise.all([
      fetchAllRows('categories', 'id,name,parent_id,updated_at,created_at', 'created_at'),
      fetchAllRows(
        'products',
        'id,code,name,category_id,barcode,cost,price,tax,final_price,active,unit,description,age_restriction,is_service,default_quantity,stock_quantity,min_stock,color,image,image_url,created_at,updated_at',
        'created_at'
      ),
      fetchAllRows('customers', 'id,name,phone,email,address,updated_at,created_at', 'created_at'),
      fetchAllRows('users', 'id,name,role,pin,password,updated_at,created_at', 'created_at'),
      fetchAllRows('stock_movements', 'id,product_id,type,quantity,reference_id,created_at', 'created_at'),
      fetchAllRows(
        'orders',
        'id,customer_id,table_number,total,subtotal,tax,discount,payment_method,received_amount,change_amount,status,local_sale_id,doc_type,document_number,created_at,updated_at',
        'created_at'
      ),
      fetchAllRows(
        'order_items',
        'id,order_id,product_id,product_name,quantity,price,discount_amount,created_at,updated_at',
        'created_at'
      ),
    ]);

    const localImageByCloudId = new Map();
    if (await tableExists('products')) {
      const localImages = await all(
        `SELECT cloud_id, image
         FROM products
         WHERE cloud_id IS NOT NULL
           AND TRIM(COALESCE(image, '')) <> ''`
      );
      for (const row of localImages ?? []) {
        const cloudId = String(row?.cloud_id ?? '').trim();
        const image = typeof row?.image === 'string' ? row.image : null;
        if (!cloudId || !image) continue;
        localImageByCloudId.set(cloudId, image);
      }
    }

    await run('BEGIN IMMEDIATE TRANSACTION');
    try {
      const clearOrder = ['stock_movements', 'order_items', 'orders', 'products', 'categories', 'customers', 'clientes', 'users'];
      for (const tableName of clearOrder) {
        if (!(await tableExists(tableName))) continue;
        const result = await run(`DELETE FROM ${tableName}`);
        summary.deleted[tableName] = Number(result?.changes ?? 0);
      }

      const categoryMap = new Map();
      for (const row of categories) {
        const result = await run(
          `INSERT OR REPLACE INTO categories (name, parent_id, cloud_id, updated_at)
           VALUES (?, NULL, ?, ?)`,
          [row.name, String(row.id), normalizeTimestamp(row.updated_at || row.created_at) || new Date().toISOString()]
        );
        let localId = result?.lastID;
        if (!localId) {
          const existing = await get(`SELECT id FROM categories WHERE cloud_id = ? LIMIT 1`, [String(row.id)]);
          localId = existing?.id;
        }
        if (localId) categoryMap.set(String(row.id), Number(localId));
      }
      for (const row of categories) {
        if (!row.parent_id) continue;
        const localId = categoryMap.get(String(row.id));
        const parentId = categoryMap.get(String(row.parent_id)) ?? null;
        if (!localId) continue;
        await run(`UPDATE categories SET parent_id = ? WHERE id = ?`, [parentId, localId]);
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
            (cloud_id, code, name, category_id, barcode, cost, price, tax, final_price, active, unit, description, age_restriction, is_service, default_quantity, stock_quantity, min_stock, color, image, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            cloudId,
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
            Number(row.stock_quantity ?? 0),
            Number(row.min_stock ?? 0),
            row.color ?? null,
            imageValue,
            normalizeTimestamp(row.created_at) || new Date().toISOString(),
            normalizeTimestamp(row.updated_at || row.created_at) || new Date().toISOString(),
          ]
        );
        let localId = result?.lastID;
        if (!localId) {
          const existing = await get(`SELECT id FROM products WHERE cloud_id = ? LIMIT 1`, [String(row.id)]);
          localId = existing?.id;
        }
        if (localId) productMap.set(String(row.id), Number(localId));
      }
      summary.inserted.products = products.length;

      for (const row of customers) {
        await run(
          `INSERT OR REPLACE INTO clientes (name, phone, email, address, cloud_id, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [
            row.name,
            row.phone == null ? '' : String(row.phone),
            row.email ?? null,
            row.address ?? null,
            String(row.id),
            normalizeTimestamp(row.updated_at || row.created_at) || new Date().toISOString(),
          ]
        );
      }
      summary.inserted.customers = customers.length;

      for (const row of users) {
        const pin = row.pin ?? row.password ?? '';
        if (!pin) continue;
        await run(
          `INSERT OR REPLACE INTO users (id, name, role, pin, cloud_id, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [
            String(row.id),
            row.name ?? 'User',
            row.role ?? 'cashier',
            String(pin),
            String(row.id),
            normalizeTimestamp(row.updated_at || row.created_at) || new Date().toISOString(),
          ]
        );
      }
      summary.inserted.users = users.length;

      for (const row of stockMovements) {
        const localProductId = productMap.get(String(row.product_id));
        if (!localProductId) continue;
        await run(
          `INSERT OR REPLACE INTO stock_movements (cloud_id, product_id, movement_type, quantity, reference_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            String(row.id),
            Number(localProductId),
            row.type,
            Number(row.quantity ?? 0),
            row.reference_id ?? `cloud:${row.id}`,
            normalizeTimestamp(row.created_at) || new Date().toISOString(),
            normalizeTimestamp(row.created_at) || new Date().toISOString(),
          ]
        );
      }
      summary.inserted.stock_movements = stockMovements.length;

      if (await tableExists('orders')) {
        for (const row of orders) {
          await run(
            `INSERT OR REPLACE INTO orders
              (id, customer_id, table_number, total, subtotal, tax, discount, payment_method, received_amount, change_amount, status, local_sale_id, doc_type, document_number, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
              (id, order_id, product_id, product_name, quantity, price, discount_amount, created_at, updated_at, cloud_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              lineId,
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
        ['cloud:full_reset', new Date().toISOString()]
      );

      await run('COMMIT');
      summary.success = true;
      summary.finished_at = new Date().toISOString();
    } catch (innerError) {
      await run('ROLLBACK');
      throw innerError;
    }

    await logSyncOperation('full-reset-complete', summary, 'manual full reset completed');
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
  return (
    message.includes('invalid') ||
    message.includes('violates') ||
    message.includes('duplicate key') ||
    message.includes('null value') ||
    message.includes('unsupported sync type')
  );
}

function isDuplicateSaleError(error) {
  const code = String(error?.code ?? '');
  const message = String(error?.message ?? '').toLowerCase();
  return (
    code === '23505' ||
    (message.includes('duplicate') && message.includes('local_sale_id')) ||
    message.includes('orders_local_sale_id_key')
  );
}

function buildExpectedQtyByProduct(items = []) {
  const map = new Map();
  for (const item of items) {
    const productId = String(item?.product_id ?? '').trim();
    if (!productId) continue;
    const qty = Number(item?.quantity ?? 0);
    if (!Number.isFinite(qty) || qty <= 0) continue;
    map.set(productId, Number(map.get(productId) ?? 0) + qty);
  }
  return map;
}

function stockDecrementApplied(beforeRows = [], afterRows = [], expectedQtyByProduct = new Map()) {
  const beforeById = new Map((beforeRows ?? []).map((row) => [String(row.id), Number(row.stock_quantity ?? 0)]));
  const afterById = new Map((afterRows ?? []).map((row) => [String(row.id), Number(row.stock_quantity ?? 0)]));
  for (const [productId, expectedQty] of expectedQtyByProduct.entries()) {
    const before = Number(beforeById.get(productId) ?? NaN);
    const after = Number(afterById.get(productId) ?? NaN);
    if (!Number.isFinite(before) || !Number.isFinite(after)) return false;
    if (before - after + 0.00001 < expectedQty) return false;
  }
  return true;
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
    if (payload.deleted) {
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

  return { valid: false, reason: `Unsupported sync type: ${type}` };
}

function parseQueuePayload(row) {
  try {
    return JSON.parse(row.data);
  } catch (error) {
    throw new Error(`Invalid queue JSON payload: ${error.message}`);
  }
}

async function toOrderPayload(sale) {
  const paymentMethod = sale.payment_method ?? sale.paymentMethod ?? null;
  const receivedAmount = sale.received_amount ?? sale.receivedAmount ?? null;
  const changeAmount = sale.change_amount ?? sale.change ?? 0;
  const discount = sale.discount ?? sale.totalDiscount ?? 0;
  const customerUUID = await resolveCustomerUUID(sale.selectedCustomerId);

  if (sale.selectedCustomerId && !customerUUID) {
    console.warn('[SYNC WARNING] Invalid customer_id, setting to null:', sale.selectedCustomerId);
  }

  const normalizedStatus = String(sale.paymentStatus ?? sale.status ?? 'completed').trim().toLowerCase();
  const mappedStatus =
    normalizedStatus === 'pending' || normalizedStatus === 'cancelled' ? normalizedStatus : 'completed';

  return {
    local_sale_id: String(sale.local_sale_id ?? sale.id),
    total: Number(sale.total ?? 0),
    subtotal: Number(sale.subtotal ?? sale.total ?? 0),
    tax: Number(sale.tax ?? 0),
    discount: Number(discount),
    customer_id: customerUUID,
    table_number: toSafeString(sale.selectedTableId),
    doc_type: sale.docType,
    document_number: sale.usedDocumentNumber ?? null,
    payment_method: paymentMethod,
    received_amount: receivedAmount,
    change_amount: Number(changeAmount ?? 0),
    status: mappedStatus,
    created_at: sale.saleTimestamp,
  };
}

async function resolveCloudProductIdForSaleItem(supabase, item, candidateCloudId) {
  const normalizedCloudId =
    candidateCloudId && isUuidString(String(candidateCloudId)) ? String(candidateCloudId).trim() : null;

  if (normalizedCloudId) {
    const { data, error } = await supabase.from('products').select('id').eq('id', normalizedCloudId).maybeSingle();
    if (error) throw error;
    if (data?.id) return String(data.id);
  }

  const localId = Number(item?.id);
  if (Number.isFinite(localId)) {
    const { data: byLocalId, error: byLocalIdError } = await supabase
      .from('products')
      .select('id')
      .or(`local_id.eq.${localId},local_id.eq.${String(localId)}`)
      .maybeSingle();
    if (byLocalIdError) throw byLocalIdError;
    if (byLocalId?.id && isUuidString(String(byLocalId.id))) {
      await run(`UPDATE products SET cloud_id = ? WHERE id = ?`, [String(byLocalId.id), localId]);
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
        await run(`UPDATE products SET cloud_id = ? WHERE id = ?`, [String(byName.id), localId]);
      }
      return String(byName.id);
    }
  }

  if (Number.isFinite(localId)) {
    const localProduct = await get(
      `SELECT id, cloud_id, name, price, stock_quantity, min_stock, active
       FROM products
       WHERE id = ?
       LIMIT 1`,
      [localId]
    );
    if (localProduct?.id) {
      const ensuredCloudId =
        localProduct.cloud_id && isUuidString(String(localProduct.cloud_id))
          ? String(localProduct.cloud_id).trim()
          : crypto.randomUUID();

      const mapped = {
        id: ensuredCloudId,
        name: String(localProduct.name ?? ''),
        price: Number(localProduct.price ?? 0),
        stock_quantity: Number(localProduct.stock_quantity ?? 0),
        min_stock: Number(localProduct.min_stock ?? 0),
        active: Number(localProduct.active ?? 1) !== 0,
        updated_at: new Date().toISOString(),
      };
      const { error: upsertError } = await supabase.from('products').upsert(mapped, { onConflict: 'id' });
      if (upsertError) throw upsertError;
      await run(`UPDATE products SET cloud_id = ? WHERE id = ?`, [ensuredCloudId, localId]);
      return ensuredCloudId;
    }
  }

  return null;
}

async function toOrderItemsPayload(sale, supabase) {
  const cart = Array.isArray(sale.cart) ? sale.cart : [];
  const items = [];
  for (const item of cart) {
    const qty = Number(item?.quantity ?? 0);
    if (!Number.isFinite(qty) || qty <= 0) {
      console.error('[SALE BLOCKED] invalid item:', {
        item,
        reason: 'invalid quantity',
      });
      throw new Error('Sale sync blocked: invalid item');
    }

    let cloudId =
      item?.cloud_id && isUuidString(String(item.cloud_id)) ? String(item.cloud_id).trim() : null;
    const localId = Number(item?.id);
    if (!cloudId && Number.isFinite(localId)) {
      cloudId = await resolveProductCloudId(localId);
    }
    cloudId = await resolveCloudProductIdForSaleItem(supabase, item, cloudId);
    if (!cloudId) {
      console.error('[SALE BLOCKED] invalid item:', {
        item,
        reason: 'invalid product_id',
      });
      throw new Error('Sale sync blocked: invalid item');
    }
    if (!isUuidString(cloudId)) {
      console.error('[SALE BLOCKED] invalid item:', {
        item,
        reason: 'invalid product_id',
      });
      throw new Error('Sale sync blocked: invalid item');
    }

    const productName = String(item?.name ?? '').trim();
    if (!productName) {
      console.error('[SALE BLOCKED] invalid item:', {
        item,
        reason: 'empty name',
      });
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
    console.error('[SALE BLOCKED] invalid item:', {
      item: null,
      reason: 'invalid quantity',
    });
    throw new Error('Sale sync blocked: invalid item');
  }
  return items;
}

async function syncSaleAtomically(payload) {
  const supabase = getSupabase();
  if (!supabase) {
    throw new Error('Supabase client unavailable');
  }
  if (!payload || !Number.isFinite(Number(payload.total))) {
    throw new Error('Invalid sale payload');
  }
  const localSaleId = String(payload.local_sale_id);

  const { data: existingOrder, error: existingError } = await supabase
    .from('orders')
    .select('id')
    .eq('local_sale_id', localSaleId)
    .maybeSingle();

  if (existingError) throw existingError;
  if (existingOrder?.id) return;

  console.log('[SYNC] Sale payload:', payload);
  const ensuredCustomerId = payload.selectedCustomerId ? await ensureCustomerSynced(payload.selectedCustomerId) : null;
  const order_data = await toOrderPayload({
    ...payload,
    selectedCustomerId: ensuredCustomerId,
  });
  const items = await toOrderItemsPayload(payload, supabase);
  const productIds = [...new Set(items.map((item) => String(item.product_id).trim()).filter(Boolean))];
  const expectedQtyByProduct = buildExpectedQtyByProduct(items);
  const { data: beforeStocks, error: beforeError } = await supabase
    .from('products')
    .select('id,stock_quantity')
    .in('id', productIds);
  if (beforeError) throw beforeError;

  console.log('[SALE SYNC] sending:', {
    order_data,
    items,
    itemCount: items.length,
  });

  const start = Date.now();
  const { data: result, error: rpcError } = await supabase.rpc('create_order_with_items', {
    order_data,
    items,
  });
  const duration = Date.now() - start;
  console.log('[SALE SYNC TIME]', `${duration}ms`);

  console.log('[SALE SYNC RESULT]', {
    data: result,
    error: rpcError,
    success: !rpcError,
  });

  if (!rpcError && (result == null || (Array.isArray(result) && result.length === 0))) {
    console.warn('[SALE WARNING] RPC returned no data', {
      order_data,
      items,
    });
  }

  if (rpcError) {
    if (isDuplicateSaleError(rpcError)) return;
    throw rpcError;
  }

  const { data: afterStocks, error: afterError } = await supabase
    .from('products')
    .select('id,stock_quantity')
    .in('id', productIds);
  if (afterError) throw afterError;

  if (stockDecrementApplied(beforeStocks ?? [], afterStocks ?? [], expectedQtyByProduct)) {
    return;
  }

  console.warn('[SALE WARNING] stock not decremented by RPC, applying fallback update', {
    local_sale_id: localSaleId,
    productCount: productIds.length,
  });

  const currentById = new Map((afterStocks ?? []).map((row) => [String(row.id), Number(row.stock_quantity ?? 0)]));
  for (const [productId, qty] of expectedQtyByProduct.entries()) {
    const currentQty = Number(currentById.get(productId) ?? NaN);
    if (!Number.isFinite(currentQty)) {
      throw new Error(`Sale sync fallback failed: product not found in cloud (${productId})`);
    }
    const nextQty = Math.max(0, currentQty - Number(qty));
    const { error: updateError } = await supabase
      .from('products')
      .update({
        stock_quantity: nextQty,
        updated_at: new Date().toISOString(),
      })
      .eq('id', productId);
    if (updateError) throw updateError;
  }
}

async function syncProduct(payload) {
  const supabase = getSupabase();
  if (!supabase) {
    throw new Error('Supabase client unavailable');
  }
  if (payload.deleted) {
    const cloudId = requireProductCloudId(payload.cloud_id, 'product delete');
    const { error: deleteError } = await supabase.from('products').delete().eq('id', cloudId);
    if (deleteError) throw deleteError;
    return;
  }

  const cloudId = requireProductCloudId(payload.cloud_id, 'product upsert');
  const categoryCloudId = await mapCategoryCloudIdFromLocal(payload.category_id);

  const mapped = {
    id: cloudId,
    local_id: payload.id != null ? Number(payload.id) : null,
    code: payload.code == null ? null : Number(payload.code),
    name: payload.name,
    category_id: categoryCloudId,
    barcode: payload.barcode ?? null,
    cost: Number(payload.cost ?? 0),
    price: Number(payload.price ?? 0),
    tax: Number(payload.tax ?? 0),
    final_price: Number(payload.final_price ?? payload.price ?? 0),
    stock_quantity: Number(payload.stock_quantity ?? 0),
    min_stock: Number(payload.min_stock ?? 0),
    active: payload.active === false ? false : true,
    unit: payload.unit ?? 'un',
    description: payload.description ?? null,
    age_restriction: payload.age_restriction == null ? null : Number(payload.age_restriction),
    is_service: payload.is_service ? true : false,
    default_quantity: payload.default_quantity === false ? false : true,
    color: payload.color ?? null,
    image: payload.image ?? null,
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabase.from('products').upsert(mapped, { onConflict: 'id' });
  if (error) throw error;
}

async function syncCustomer(payload) {
  const supabase = getSupabase();
  if (!supabase) {
    throw new Error('Supabase client unavailable');
  }
  const cloudId = payload?.cloud_id ? String(payload.cloud_id).trim() : '';
  if (!isUUID(cloudId)) {
    throw new Error('Invalid customer cloud_id');
  }
  if (payload.deleted) {
    const { error: deleteError } = await supabase.from('customers').delete().eq('id', cloudId);
    if (deleteError) throw deleteError;
    return;
  }

  const mapped = {
    id: cloudId,
    name: payload.name,
    phone: payload.phone,
    email: payload.email ?? null,
    address: payload.address ?? null,
  };
  const { error } = await supabase.from('customers').upsert(mapped, { onConflict: 'id' });
  if (error) throw error;
}

async function processQueueItem(row) {
  const supabase = getSupabase();
  if (!supabase) return;

  let payload = null;
  try {
    payload = parseQueuePayload(row);
    console.log('[QUEUE] processing:', {
      id: row.id,
      type: row.type,
      payload,
    });
    if (row.type === 'stock') {
      await run(
        `UPDATE sync_queue
         SET status = 'synced', updated_at = ?, synced_at = ?, lock_token = NULL, locked_at = NULL
         WHERE id = ?`,
        [new Date().toISOString(), new Date().toISOString(), row.id]
      );
      await logSyncOperation('stock-sync-disabled', payload, 'stock queue item ignored; sales now sync stock via create_order_with_items');
      return 'success';
    }
    if (row.type === 'sale' && !payload.local_sale_id) {
      payload.local_sale_id = `legacy-${row.id}`;
      await run(`UPDATE sync_queue SET data = ?, updated_at = ? WHERE id = ?`, [JSON.stringify(payload), new Date().toISOString(), row.id]);
    }
    if (row.type === 'product' && payload && !payload.deleted && payload.id != null && !payload.cloud_id) {
      const fromDb = await get(`SELECT cloud_id FROM products WHERE id = ? LIMIT 1`, [Number(payload.id)]);
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
    } else if (row.type === 'customer') {
      await syncCustomer(payload);
    } else {
      throw new Error(`Unsupported sync type: ${row.type}`);
    }

    await run(
      `UPDATE sync_queue
       SET status = 'synced', updated_at = ?, synced_at = ?, lock_token = NULL, locked_at = NULL
       WHERE id = ?`,
      [new Date().toISOString(), new Date().toISOString(), row.id]
    );
    console.log('[QUEUE] success:', {
      id: row.id,
      type: row.type,
    });
    return 'success';
  } catch (error) {
    console.error('[QUEUE] error:', {
      id: row.id,
      type: row.type,
      error,
    });
    if (isNetworkOfflineError(error)) {
      await run(
        `UPDATE sync_queue
         SET lock_token = NULL, locked_at = NULL, updated_at = ?
         WHERE id = ?`,
        [new Date().toISOString(), row.id]
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
       WHERE id = ?`,
      [nextStatus, nextRetries, nextRetryAt, new Date().toISOString(), row.id]
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

async function claimQueueItem(rowId, lockToken) {
  const lockCutoff = new Date(Date.now() - LOCK_TIMEOUT_MS).toISOString();
  const result = await run(
    `UPDATE sync_queue
     SET lock_token = ?, locked_at = ?, updated_at = ?
     WHERE id = ?
       AND retries < ?
       AND (status = 'pending' OR status = 'failed')
       AND (lock_token IS NULL OR locked_at IS NULL OR locked_at <= ?)`,
    [lockToken, new Date().toISOString(), new Date().toISOString(), rowId, MAX_RETRIES, lockCutoff]
  );
  return result.changes > 0;
}

async function fetchClaimedItem(rowId, lockToken) {
  return get(
    `SELECT id, type, data, status, retries, created_at, next_retry_at, lock_token, locked_at, sync_ref
     FROM sync_queue
     WHERE id = ? AND lock_token = ?`,
    [rowId, lockToken]
  );
}

async function processSyncQueueCycle() {
  const supabase = getSupabase();

  console.log('[DEBUG QUEUE START]', {
    hasSupabaseInstance: !!supabase
  });

  console.log('[DEBUG SUPABASE]', {
    url: process.env.SUPABASE_URL,
    serviceKey: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
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

    const rows = await all(
      `SELECT id
       FROM sync_queue
       WHERE (status = 'pending' OR status = 'failed')
         AND retries < ?
         AND (next_retry_at IS NULL OR next_retry_at <= ?)
         AND (lock_token IS NULL OR locked_at IS NULL OR locked_at <= ?)
       ORDER BY created_at ASC
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

        const lockToken = crypto.randomUUID();
        const claimed = await claimQueueItem(next.id, lockToken);
        if (!claimed) continue;

        const claimedRow = await fetchClaimedItem(next.id, lockToken);
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
    if (isNetworkOfflineError(error)) {
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

function startSyncService() {
  if (timer) return;

  const supabase = getSupabase();
  if (!supabase) {
    console.warn('[sync] Supabase credentials not configured. Running offline-only mode.');
    return;
  }

  timer = setInterval(() => {
    processFullSyncCycle().catch((error) => {
      console.error('[sync] cycle crashed:', error.message);
    });
  }, DEFAULT_INTERVAL_MS);

  processFullSyncCycle().catch((error) => {
    console.error('[sync] initial cycle failed:', error.message);
  });

  console.log(`[sync] service started (interval=${DEFAULT_INTERVAL_MS}ms)`);
}

function stopSyncService() {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
}

export {
  startSyncService,
  stopSyncService,
  processSyncQueueCycle,
  processPullSyncCycle,
  processFullSyncCycle,
  fullSyncFromCloud,
  isInternetAvailable,
};
