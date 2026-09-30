/**
 * Etapa 1G.4 Fase 3C.2 — Backoffice Stock: ajuste manual + contagem. Reutiliza a
 * RPC/ledger da 3C.1 (backoffice_create_stock_movement estendida com p_type) + a nova
 * backoffice_set_stock_count (delta calculado sempre no servidor, sob advisory lock).
 * Device JWT real + Postgres real + SQLite local real para o cenário obrigatório.
 *
 * Requer env: POSLY_1G4F_ISSUER_URL, POSLY_1G4F_ADMIN_TOKEN, POSLY_1G4F_SUPABASE_URL,
 *   POSLY_1G4F_ANON_KEY, POSLY_1G4F_SERVICE_ROLE_KEY.
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, before, after, mock } from 'node:test';
import { createClient } from '@supabase/supabase-js';

const E = (k) => process.env[`POSLY_1G4F_${k}`] || '';
const run = Boolean(E('ISSUER_URL') && E('ADMIN_TOKEN') && E('SUPABASE_URL') && E('ANON_KEY') && E('SERVICE_ROLE_KEY'));
const opts = { skip: !run && 'defina POSLY_1G4F_*' };

mock.module('electron', {
  exports: {
    safeStorage: {
      isEncryptionAvailable: () => true,
      encryptString: (s) => Buffer.concat([Buffer.from('FAKEENC:'), Buffer.from(s, 'utf8')]),
      decryptString: (b) => Buffer.from(b).subarray(8).toString('utf8'),
    },
  },
});

const svc = run ? createClient(E('SUPABASE_URL'), E('SERVICE_ROLE_KEY'), { auth: { persistSession: false } }) : null;
const uuid = () => crypto.randomUUID();
const rand = () => crypto.randomBytes(4).toString('hex');
const PASSWORD = 'Senha!Teste123';

async function post(p, body, admin = true) {
  const res = await fetch(`${E('ISSUER_URL')}${p}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(admin ? { Authorization: `Bearer ${E('ADMIN_TOKEN')}` } : {}) },
    body: JSON.stringify(body),
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}
const pushWh = (cl, id, name, isDefault = false) =>
  cl.rpc('sync_upsert_warehouse', { p_id: id, p_name: name, p_code: null, p_is_default: isDefault, p_is_active: true });

async function bootstrapRawDevice(tenantId, licenseId, storeId) {
  const tok = await post('/api/license-issuer/device/activation-tokens', { tenant_id: tenantId, license_id: licenseId, store_id: storeId });
  const boot = await post('/api/license-issuer/device/bootstrap', { activation_token: tok.data.activation_token, machine_id: `m-1g4f-${rand()}` }, false);
  assert.equal(boot.status, 200, JSON.stringify(boot.data));
  return {
    deviceId: boot.data.device_id,
    client: createClient(E('SUPABASE_URL'), E('ANON_KEY'), { global: { headers: { Authorization: `Bearer ${boot.data.access_token}` } }, auth: { persistSession: false } }),
  };
}
async function mkAuthUser(email) {
  const { data, error } = await svc.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
  assert.equal(error, null, JSON.stringify(error));
  return data.user.id;
}
async function signIn(email) {
  const anonClient = createClient(E('SUPABASE_URL'), E('ANON_KEY'), { auth: { persistSession: false } });
  const { data, error } = await anonClient.auth.signInWithPassword({ email, password: PASSWORD });
  assert.equal(error, null, JSON.stringify(error));
  return createClient(E('SUPABASE_URL'), E('ANON_KEY'), { global: { headers: { Authorization: `Bearer ${data.session.access_token}` } }, auth: { persistSession: false } });
}
const cloudWarehouseQty = async (warehouseId, productId) =>
  Number((await svc.from('warehouse_stock').select('quantity').eq('warehouse_id', warehouseId).eq('product_id', productId)).data?.[0]?.quantity ?? 0);

const c = {};
let dbUtils;
let syncService;
let wh;
let led;
let deviceAuthClient;

before(async () => {
  if (!run) return;
  const tenantId = `itest-1g4f-${rand()}`;
  await post('/api/license-issuer/tenants', { id: tenantId, name: 'T1G4F' });
  const lic = await post('/api/license-issuer/licenses', { tenant_id: tenantId, plan: 'PRO', commerce_type: 'retalho', max_devices: 20 });
  c.tenantId = tenantId;
  c.licenseId = lic.data.license.id;
  const mkStore = async (n) => (await post('/api/license-issuer/stores', { tenant_id: tenantId, license_id: c.licenseId, name: n })).data.store.id;
  c.storeA = await mkStore('Loja A (1G4F)');
  c.storeX = await mkStore('Loja X (1G4F)');

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'posly-1g4f-live-'));
  process.env.POS_DB_PATH = path.join(tmpDir, 'database.db');
  process.env.DEFAULT_TENANT_ID = tenantId;
  process.env.SUPABASE_URL = E('SUPABASE_URL');
  process.env.SUPABASE_ANON_KEY = E('ANON_KEY');
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;

  const { startDeviceAuthBridge, stopDeviceAuthBridge } = await import('../../electron/deviceAuth/deviceAuthBridge.js');
  c.stopBridge = stopDeviceAuthBridge;
  deviceAuthClient = await import('../../electron/deviceAuth/deviceAuthClient.js');
  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'posly-1g4f-live-electron-'));
  const tokA = await post('/api/license-issuer/device/activation-tokens', { tenant_id: tenantId, license_id: c.licenseId, store_id: c.storeA });
  const bootA = await deviceAuthClient.bootstrapDevice({ activationToken: tokA.data.activation_token, machineId: 'machine-1g4f-A', userDataPath, issuerBaseUrl: E('ISSUER_URL') });
  assert.equal(bootA.ok, true, JSON.stringify(bootA));
  c.userDataPath = userDataPath;
  c.tmpDir = tmpDir;

  const bridge = await startDeviceAuthBridge({ userDataPath, issuerBaseUrl: E('ISSUER_URL') });
  process.env.POS_DEVICE_AUTH_BRIDGE_URL = bridge.url;
  process.env.POS_DEVICE_AUTH_BRIDGE_SECRET = bridge.secret;
  process.env.POS_DEVICE_ID = bootA.deviceId;

  dbUtils = await import('../../api/dbUtils.js');
  syncService = await import('../../api/syncService.js');
  wh = await import('../../api/services/warehouseStock.service.js');
  led = await import('../../api/stockLedgerSync.js');

  const deviceB = await bootstrapRawDevice(tenantId, c.licenseId, c.storeA);
  const deviceX = await bootstrapRawDevice(tenantId, c.licenseId, c.storeX);

  const now = new Date().toISOString();
  // Dois produtos independentes: um para o teste de RPC/concorrência, outro só para o
  // cenário obrigatório 120->105->90 (nunca partilhar saldo entre os dois testes).
  c.productCloudId = uuid();
  assert.equal((await svc.from('products').insert({ id: c.productCloudId, tenant_id: tenantId, name: 'Produto 1G4F', price: 10 })).error, null);
  await dbUtils.run(`INSERT INTO products (cloud_id, tenant_id, name, price, cost, stock_quantity, created_at, updated_at) VALUES (?, ?, 'Produto 1G4F', 10, 0, 0, ?, ?)`, [c.productCloudId, tenantId, now, now]);
  c.productLocalId = (await dbUtils.get(`SELECT id FROM products WHERE cloud_id = ?`, [c.productCloudId])).id;

  c.productCloudId2 = uuid();
  assert.equal((await svc.from('products').insert({ id: c.productCloudId2, tenant_id: tenantId, name: 'Produto 1G4F (E2E)', price: 10 })).error, null);
  await dbUtils.run(`INSERT INTO products (cloud_id, tenant_id, name, price, cost, stock_quantity, created_at, updated_at) VALUES (?, ?, 'Produto 1G4F (E2E)', 10, 0, 0, ?, ?)`, [c.productCloudId2, tenantId, now, now]);
  c.productLocalId2 = (await dbUtils.get(`SELECT id FROM products WHERE cloud_id = ?`, [c.productCloudId2])).id;

  c.whA1 = uuid();
  await dbUtils.run(`INSERT INTO warehouses (id, tenant_id, name, is_default, is_active, created_at, updated_at) VALUES (?, ?, 'Principal 1G4F', 1, 1, ?, ?)`, [c.whA1, tenantId, now, now]);
  assert.equal((await pushWh(deviceB.client, c.whA1, 'Principal 1G4F', true)).error, null);
  c.whX1 = uuid();
  assert.equal((await pushWh(deviceX.client, c.whX1, 'Principal X 1G4F', true)).error, null);

  c.ownerEmail = `owner-1g4f-${rand()}@test.local`;
  const ownerId = await mkAuthUser(c.ownerEmail);
  assert.equal((await svc.from('backoffice_users').insert({ user_id: ownerId, tenant_id: tenantId, role: 'owner' })).error, null);

  // store_operator só de A — storeX é do MESMO tenant (owner teria acesso legítimo por
  // ser dono do tenant inteiro); para testar "Store forjada/não autorizada" a sério
  // precisa de um papel realmente limitado, nunca de um owner.
  c.opEmail = `op-1g4f-${rand()}@test.local`;
  const opId = await mkAuthUser(c.opEmail);
  assert.equal((await svc.from('backoffice_users').insert({ user_id: opId, tenant_id: tenantId, role: 'store_operator' })).error, null);
  assert.equal((await svc.from('backoffice_user_stores').insert({ user_id: opId, tenant_id: tenantId, store_id: c.storeA })).error, null);
});

after(() => {
  if (!run) return;
  try {
    c.stopBridge?.();
  } catch {
    // ignore
  }
  delete process.env.POS_DEVICE_AUTH_BRIDGE_URL;
  delete process.env.POS_DEVICE_AUTH_BRIDGE_SECRET;
  delete process.env.POS_DEVICE_ID;
  for (const dir of [c.userDataPath, c.tmpDir]) {
    if (!dir) continue;
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  }
});

test('RPC: type inválido bloqueado; Store/Warehouse forjados bloqueados; duas contagens concorrentes nunca corrompem o saldo', opts, async () => {
  const owner = await signIn(c.ownerEmail);

  const forgedType = await owner.rpc('backoffice_create_stock_movement', { p_store_id: c.storeA, p_warehouse_id: c.whA1, p_product_id: c.productCloudId, p_quantity: 1, p_idempotency_key: `k-${uuid()}`, p_type: 'sale' });
  assert.match(forgedType.error.message, /movement_type_not_allowed/);
  const forgedOpening = await owner.rpc('backoffice_create_stock_movement', { p_store_id: c.storeA, p_warehouse_id: c.whA1, p_product_id: c.productCloudId, p_quantity: 1, p_idempotency_key: `k-${uuid()}`, p_type: 'transfer_out' });
  assert.match(forgedOpening.error.message, /movement_type_not_allowed/);

  const forgedWh = await owner.rpc('backoffice_set_stock_count', { p_store_id: c.storeA, p_warehouse_id: c.whX1, p_product_id: c.productCloudId, p_target_quantity: 10, p_idempotency_key: `k-${uuid()}` });
  assert.match(forgedWh.error.message, /warehouse_not_in_store/);
  // store_operator só atribuído a A — storeX é do mesmo tenant mas nunca lhe foi
  // atribuída, ao contrário de um owner (que teria acesso legítimo ao tenant inteiro).
  const op = await signIn(c.opEmail);
  const forgedStore = await op.rpc('backoffice_set_stock_count', { p_store_id: c.storeX, p_warehouse_id: c.whX1, p_product_id: c.productCloudId, p_target_quantity: 10, p_idempotency_key: `k-${uuid()}` });
  assert.match(forgedStore.error.message, /store_not_authorized/);

  // duas contagens concorrentes para o MESMO alvo — nunca corrompe, nunca duplica
  const target = 42;
  const [ra, rb] = await Promise.all([
    owner.rpc('backoffice_set_stock_count', { p_store_id: c.storeA, p_warehouse_id: c.whA1, p_product_id: c.productCloudId, p_target_quantity: target, p_idempotency_key: `race-a-${uuid()}` }),
    owner.rpc('backoffice_set_stock_count', { p_store_id: c.storeA, p_warehouse_id: c.whA1, p_product_id: c.productCloudId, p_target_quantity: target, p_idempotency_key: `race-b-${uuid()}` }),
  ]);
  assert.equal(ra.error, null, JSON.stringify(ra.error));
  assert.equal(rb.error, null, JSON.stringify(rb.error));
  const statuses = [ra.data[0].out_status, rb.data[0].out_status].sort();
  assert.deepEqual(statuses, ['inserted', 'no_change']);
  assert.equal(await cloudWarehouseQty(c.whA1, c.productCloudId), target, 'saldo final = alvo, exactamente, nunca duplicado');
});

test('cenário obrigatório: 120 -> ajuste -15 -> 105 -> sync local 105; contagem 90 -> 90; retry/restart -> 90; reconciliação = 0', opts, async () => {
  await wh.applyWarehouseDelta({ tenantId: c.tenantId, warehouseId: c.whA1, productId: c.productLocalId2, delta: 120, movementType: 'restock', referenceId: `RESTOCK:1g4f:${uuid()}` });
  await syncService.processSyncQueueCycle();
  await syncService.processPullSyncCycle();
  assert.equal(await cloudWarehouseQty(c.whA1, c.productCloudId2), 120);

  const owner = await signIn(c.ownerEmail);

  // --- ajuste -15 ---
  const adjKey = `adj-${uuid()}`;
  const adj = await owner.rpc('backoffice_create_stock_movement', { p_store_id: c.storeA, p_warehouse_id: c.whA1, p_product_id: c.productCloudId2, p_quantity: -15, p_idempotency_key: adjKey, p_type: 'adjustment' });
  assert.equal(adj.error, null, JSON.stringify(adj.error));
  assert.equal(adj.data[0].out_status, 'inserted');
  assert.equal(await cloudWarehouseQty(c.whA1, c.productCloudId2), 105);

  await syncService.processPullSyncCycle();
  assert.equal(await wh.getWarehouseQuantity(c.whA1, c.productLocalId2, c.tenantId), 105, 'sync local reflecte o ajuste');

  // --- contagem para 90 ---
  const countKey = `count-${uuid()}`;
  const count = await owner.rpc('backoffice_set_stock_count', { p_store_id: c.storeA, p_warehouse_id: c.whA1, p_product_id: c.productCloudId2, p_target_quantity: 90, p_idempotency_key: countKey });
  assert.equal(count.error, null, JSON.stringify(count.error));
  assert.equal(count.data[0].out_status, 'inserted');
  assert.equal(Number(count.data[0].out_delta), -15);
  assert.equal(await cloudWarehouseQty(c.whA1, c.productCloudId2), 90);

  await syncService.processPullSyncCycle();
  assert.equal(await wh.getWarehouseQuantity(c.whA1, c.productLocalId2, c.tenantId), 90, 'sync local reflecte a contagem');

  // --- retry (mesmas chaves) + restart (cursor local rebobinado) ---
  const adjRetry = await owner.rpc('backoffice_create_stock_movement', { p_store_id: c.storeA, p_warehouse_id: c.whA1, p_product_id: c.productCloudId2, p_quantity: -15, p_idempotency_key: adjKey, p_type: 'adjustment' });
  assert.equal(adjRetry.data[0].out_status, 'duplicate');
  const countRetry = await owner.rpc('backoffice_set_stock_count', { p_store_id: c.storeA, p_warehouse_id: c.whA1, p_product_id: c.productCloudId2, p_target_quantity: 90, p_idempotency_key: countKey });
  assert.equal(countRetry.data[0].out_status, 'duplicate');
  assert.equal(await cloudWarehouseQty(c.whA1, c.productCloudId2), 90, 'retries na cloud nunca duplicam');

  await dbUtils.run(`UPDATE sync_state SET last_sync_at = '1970-01-01T00:00:00.000Z' WHERE id = ?`, [`cloud:stock_movements:${c.tenantId}`]);
  await syncService.processPullSyncCycle();
  assert.equal(await wh.getWarehouseQuantity(c.whA1, c.productLocalId2, c.tenantId), 90, 'restart/replay do pull continua 90 — nunca duplica localmente');

  // Nota: os ciclos de pull acima também absorvem/convergem o produto do teste anterior
  // (productCloudId) pela mesma via — é o comportamento correcto (reconciliação real, à
  // escala da Store), por isso aqui não se filtra por produto.
  const cloudRows = (await svc.from('warehouse_stock').select('warehouse_id,product_id,quantity').eq('store_id', c.storeA)).data;
  const rec = await led.computeReconciliation({ tenantId: c.tenantId, cloudRows });
  assert.equal(rec.divergent_count, 0, JSON.stringify(rec.divergent));
});
