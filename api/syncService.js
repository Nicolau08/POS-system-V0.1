const dns = require('dns').promises;
const { URL } = require('url');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');
const { all, get, run } = require('./dbUtils');
const { logSyncError } = require('./syncLogger');
const path = require('path');
require('dotenv').config({
  path: path.resolve(__dirname, '../.env')
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
    skippedEntities: [],
    skipped: false,
    reason: null,
  };
}

async function isInternetAvailable() {
    return true;
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
    const localId = Number(row.local_id);
    if (Number.isFinite(localId)) {
      await run(`UPDATE products SET stock_quantity = ? WHERE id = ?`, [Number(row.stock_quantity ?? 0), localId]);
    }

    const remoteTs = normalizeTimestamp(row.updated_at || row.created_at) || new Date().toISOString();
    if (isRemoteNewer(remoteTs, maxTs)) maxTs = remoteTs;
    const categoryLocalId = await mapCategoryIdFromCloud(row.category_id);
    const existing = await get(`SELECT id, updated_at FROM products WHERE cloud_id = ? LIMIT 1`, [String(row.id)]);
    summary.processed += 1;

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
      image: row.image ?? row.image_url ?? null,
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
  let { data: rows, error } = await supabase
    .from('users')
    .select('id,name,role,pin,password,updated_at,created_at')
    .gt('updated_at', lastSyncAt)
    .order('updated_at', { ascending: true });
  if (error && String(error.code || '') === '42703') {
    ({ data: rows, error } = await supabase
      .from('users')
      .select('id,name,role,pin,password,created_at')
      .gt('created_at', lastSyncAt)
      .order('created_at', { ascending: true }));
  }
  if (error) {
    summary.skippedEntities.push('users');
    await logSyncOperation('pull-users-skip', { reason: error.message }, 'users table unavailable for pull sync');
    return;
  }

  let maxTs = lastSyncAt;
  for (const row of rows ?? []) {
    const remoteTs = normalizeTimestamp(row.updated_at ?? row.created_at) || new Date().toISOString();
    if (isRemoteNewer(remoteTs, maxTs)) maxTs = remoteTs;
    const existing = await get(`SELECT id, cloud_id, pin, updated_at FROM users WHERE cloud_id = ? OR id = ? LIMIT 1`, [
      String(row.id),
      String(row.id),
    ]);
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
  }

  if ((rows ?? []).length > 0) {
    await setLastSyncAt(syncId, maxTs);
    await logSyncOperation('pull-users', { count: rows.length, last_sync_at: maxTs }, 'users synced from cloud');
  }
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
    console.log('[DEBUG PULL STATUS]', {
      online,
      hasSupabase: !!supabase
    });
    if (!online || !supabase) {
      summary.skipped = true;
      summary.reason = 'offline_or_missing_supabase';
      return summary;
    }

    await run('BEGIN IMMEDIATE TRANSACTION');
    try {
      await syncCategoriesFromCloud(summary);
      await syncProductsFromCloud(summary);
      await syncCustomersFromCloud(summary);
      await syncUsersFromCloud(summary);
      await syncStockMovementsFromCloud(summary);
      await run('COMMIT');
    } catch (innerError) {
      await run('ROLLBACK');
      throw innerError;
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
  const [push, pull] = await Promise.all([processSyncQueueCycle(), processPullSyncCycle()]);
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
        const result = await run(
          `INSERT OR REPLACE INTO products
            (cloud_id, code, name, category_id, barcode, cost, price, tax, final_price, active, unit, description, age_restriction, is_service, default_quantity, stock_quantity, min_stock, color, image, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            String(row.id),
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
            row.image ?? row.image_url ?? null,
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
          await run(
            `INSERT OR REPLACE INTO order_items
              (id, order_id, product_id, product_name, quantity, price, discount_amount, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              String(row.id),
              String(row.order_id),
              row.product_id ? String(row.product_id) : null,
              row.product_name ?? 'Produto',
              Number(row.quantity ?? 0),
              Number(row.price ?? 0),
              Number(row.discount_amount ?? 0),
              normalizeTimestamp(row.created_at) || new Date().toISOString(),
              normalizeTimestamp(row.updated_at || row.created_at) || new Date().toISOString(),
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
    if (payload.deleted && payload.id != null) return { valid: true };
    if (payload.id == null || !payload.name || !Number.isFinite(Number(payload.price))) {
      return { valid: false, reason: 'Product requer id, name e price validos' };
    }
    return { valid: true };
  }

  if (type === 'stock') {
    if (!Number.isFinite(Number(payload.productId)) || !Number.isFinite(Number(payload.quantity))) {
      return { valid: false, reason: 'Stock requer productId e quantity validos' };
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

function toOrderPayload(sale) {
  return {
    local_sale_id: String(sale.local_sale_id),
    total: Number(sale.total ?? 0),
    subtotal: Number(sale.subtotal ?? sale.total ?? 0),
    tax: Number(sale.tax ?? 0),
    discount: Number(sale.totalDiscount ?? 0),
    customer_id: toSafeString(sale.selectedCustomerId),
    table_number: toSafeString(sale.selectedTableId),
    doc_type: sale.docType,
    document_number: sale.usedDocumentNumber ?? null,
    payment_method: sale.paymentMethod,
    received_amount: sale.receivedAmount || null,
    change_amount: 0,
    status: 'completed',
    created_at: sale.saleTimestamp,
  };
}

async function toOrderItemsPayload(sale) {
  const cart = Array.isArray(sale.cart) ? sale.cart : [];
  return cart.map((item) => ({
    product_id: toSafeString(item?.id),
    product_name: item?.name ?? 'Produto',
    quantity: Number(item?.quantity ?? 0),
    price: Number(item?.price ?? 0),
    discount_amount: Number(item?.discount ?? 0),
  }));
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

  const payloadToSend = toOrderPayload(payload);
  const itemsToSend = await toOrderItemsPayload(payload);

  const { error: rpcError } = await supabase.rpc('create_order_with_items', {
    order_data: payloadToSend,
    items: itemsToSend,
  });

  if (rpcError) {
    if (isDuplicateSaleError(rpcError)) return;
    throw rpcError;
  }
}

async function syncProduct(payload) {
  const supabase = getSupabase();
  if (!supabase) {
    throw new Error('Supabase client unavailable');
  }
  if (payload.deleted && payload.id) {
    const { error: deleteError } = await supabase.from('products').delete().eq('id', Number(payload.id));
    if (deleteError) throw deleteError;
    return;
  }

  const mapped = {
    id: payload.id ? Number(payload.id) : undefined,
    name: payload.name,
    price: Number(payload.price ?? 0),
    stock_quantity: Number(payload.stock_quantity ?? 0),
    min_stock: Number(payload.min_stock ?? 0),
    active: payload.active === false ? false : true,
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabase.from('products').upsert(mapped, { onConflict: 'id' });
  if (error) throw error;
}

async function syncStock(payload, row) {
  const supabase = getSupabase();
  if (!supabase) {
    throw new Error('Supabase client unavailable');
  }
  const productId = Number(payload.productId);
  const delta = Number(payload.quantity ?? 0);
  if (!Number.isFinite(productId) || !Number.isFinite(delta)) {
    throw new Error('Invalid stock payload');
  }

  const movementType =
    payload.movementType === 'adjustment'
      ? 'adjustment'
      : delta >= 0
        ? 'restock'
        : 'adjustment';
  const referenceId = String(payload.referenceId || row?.sync_ref || `stock:${row?.id ?? 'unknown'}`);

  const { error } = await supabase.rpc('record_stock_movement', {
    p_product_id: productId,
    p_type: movementType,
    p_quantity: delta,
    p_reference_id: referenceId,
  });

  if (error) {
    // Gradual migration compatibility: if RPC/table missing, fallback to legacy direct update.
    if (String(error?.code ?? '') === '42883' || String(error?.code ?? '') === '42P01') {
      const { data: current, error: currentError } = await supabase
        .from('products')
        .select('id, stock_quantity')
        .eq('id', productId)
        .single();
      if (currentError) throw currentError;

      const nextStock = Number(current.stock_quantity ?? 0) + delta;
      const { error: updateError } = await supabase
        .from('products')
        .update({ stock_quantity: nextStock, updated_at: new Date().toISOString() })
        .eq('id', productId);
      if (updateError) throw updateError;
      return;
    }
    throw error;
  }
}

async function syncCustomer(payload) {
  const supabase = getSupabase();
  if (!supabase) {
    throw new Error('Supabase client unavailable');
  }
  if (payload.deleted && payload.id) {
    const { error: deleteError } = await supabase.from('customers').delete().eq('id', Number(payload.id));
    if (deleteError) throw deleteError;
    return;
  }

  const mapped = {
    id: payload.id ? Number(payload.id) : undefined,
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
    if (row.type === 'sale' && !payload.local_sale_id) {
      payload.local_sale_id = `legacy-${row.id}`;
      await run(`UPDATE sync_queue SET data = ?, updated_at = ? WHERE id = ?`, [JSON.stringify(payload), new Date().toISOString(), row.id]);
    }
    const validation = validatePayload(row.type, payload);
    if (!validation.valid) {
      throw new Error(validation.reason);
    }

    if (row.type === 'sale') {
      await syncSaleAtomically(payload);
    } else if (row.type === 'product') {
      await syncProduct(payload);
    } else if (row.type === 'stock') {
      await syncStock(payload, row);
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
    return 'success';
  } catch (error) {
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
      return {
        ...summary,
        skipped: false,
        reason: 'no_items_to_sync'
      };
    }

    const worker = async () => {
      while (rows.length > 0) {
        const next = rows.shift();
        if (!next) return;

        const lockToken = crypto.randomUUID();
        const claimed = await claimQueueItem(next.id, lockToken);
        if (!claimed) continue;

        const claimedRow = await fetchClaimedItem(next.id, lockToken);
        if (!claimedRow) continue;
        const result = await processQueueItem(claimedRow);
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
  } catch (error) {
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

module.exports = {
  startSyncService,
  stopSyncService,
  processSyncQueueCycle,
  processPullSyncCycle,
  processFullSyncCycle,
  fullSyncFromCloud,
  isInternetAvailable,
};
