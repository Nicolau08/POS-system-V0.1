/**
 * Etapa 1G.4 Fase 3C.3 — Backoffice: Transferências. Warehouse->Warehouse (RPC nova,
 * backoffice_transfer_stock) + Store->Store (transfer_dispatch/receive/cancel
 * ADAPTADAS — mesma máquina de estados, mesmas regras, só a resolução de
 * tenant/store/device passa a aceitar sessão humana via p_store_id). Sem service_role em
 * nenhum caminho de escrita/leitura do Backoffice.
 *
 * Requer env: POSLY_1G4G_ISSUER_URL, POSLY_1G4G_ADMIN_TOKEN, POSLY_1G4G_SUPABASE_URL,
 *   POSLY_1G4G_ANON_KEY, POSLY_1G4G_SERVICE_ROLE_KEY.
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, before, after, mock } from 'node:test';
import { createClient } from '@supabase/supabase-js';

const E = (k) => process.env[`POSLY_1G4G_${k}`] || '';
const run = Boolean(E('ISSUER_URL') && E('ADMIN_TOKEN') && E('SUPABASE_URL') && E('ANON_KEY') && E('SERVICE_ROLE_KEY'));
const opts = { skip: !run && 'defina POSLY_1G4G_*' };

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
  const boot = await post('/api/license-issuer/device/bootstrap', { activation_token: tok.data.activation_token, machine_id: `m-1g4g-${rand()}` }, false);
  assert.equal(boot.status, 200, JSON.stringify(boot.data));
  return { client: createClient(E('SUPABASE_URL'), E('ANON_KEY'), { global: { headers: { Authorization: `Bearer ${boot.data.access_token}` } }, auth: { persistSession: false } }) };
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
  const tenantId = `itest-1g4g-${rand()}`;
  await post('/api/license-issuer/tenants', { id: tenantId, name: 'T1G4G' });
  const lic = await post('/api/license-issuer/licenses', { tenant_id: tenantId, plan: 'PRO', commerce_type: 'retalho', max_devices: 20 });
  c.tenantId = tenantId;
  c.licenseId = lic.data.license.id;
  const mkStore = async (n) => (await post('/api/license-issuer/stores', { tenant_id: tenantId, license_id: c.licenseId, name: n })).data.store.id;
  c.storeA = await mkStore('Loja A (1G4G)');
  c.storeB = await mkStore('Loja B (1G4G)');
  c.storeX = await mkStore('Loja X (1G4G)');

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'posly-1g4g-live-'));
  process.env.POS_DB_PATH = path.join(tmpDir, 'database.db');
  process.env.DEFAULT_TENANT_ID = tenantId;
  process.env.SUPABASE_URL = E('SUPABASE_URL');
  process.env.SUPABASE_ANON_KEY = E('ANON_KEY');
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;

  const { startDeviceAuthBridge, stopDeviceAuthBridge } = await import('../../electron/deviceAuth/deviceAuthBridge.js');
  c.stopBridge = stopDeviceAuthBridge;
  deviceAuthClient = await import('../../electron/deviceAuth/deviceAuthClient.js');
  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'posly-1g4g-live-electron-'));
  const tokA = await post('/api/license-issuer/device/activation-tokens', { tenant_id: tenantId, license_id: c.licenseId, store_id: c.storeA });
  const bootA = await deviceAuthClient.bootstrapDevice({ activationToken: tokA.data.activation_token, machineId: 'machine-1g4g-A', userDataPath, issuerBaseUrl: E('ISSUER_URL') });
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
  const deviceStoreB = await bootstrapRawDevice(tenantId, c.licenseId, c.storeB);
  const deviceX = await bootstrapRawDevice(tenantId, c.licenseId, c.storeX);

  const now = new Date().toISOString();
  c.productCloudId = uuid();
  assert.equal((await svc.from('products').insert({ id: c.productCloudId, tenant_id: tenantId, name: 'Produto 1G4G', price: 10 })).error, null);
  await dbUtils.run(`INSERT INTO products (cloud_id, tenant_id, name, price, cost, stock_quantity, created_at, updated_at) VALUES (?, ?, 'Produto 1G4G', 10, 0, 0, ?, ?)`, [c.productCloudId, tenantId, now, now]);
  c.productLocalId = (await dbUtils.get(`SELECT id FROM products WHERE cloud_id = ?`, [c.productCloudId])).id;

  c.whA1 = uuid();
  c.whA2 = uuid();
  await dbUtils.run(`INSERT INTO warehouses (id, tenant_id, name, is_default, is_active, created_at, updated_at) VALUES (?, ?, 'A1', 1, 1, ?, ?)`, [c.whA1, tenantId, now, now]);
  await dbUtils.run(`INSERT INTO warehouses (id, tenant_id, name, is_default, is_active, created_at, updated_at) VALUES (?, ?, 'A2', 0, 1, ?, ?)`, [c.whA2, tenantId, now, now]);
  for (const [id, n, d] of [[c.whA2, 'A2', false], [c.whA1, 'A1', true]]) {
    assert.equal((await pushWh(deviceB.client, id, n, d)).error, null);
  }
  c.whB1 = (await svc.from('warehouses').select('id').eq('store_id', c.storeB).eq('is_default', true).single()).data.id;
  c.whX1 = uuid();
  assert.equal((await pushWh(deviceX.client, c.whX1, 'X1', true)).error, null);

  c.ownerEmail = `owner-1g4g-${rand()}@test.local`;
  const ownerId = await mkAuthUser(c.ownerEmail);
  assert.equal((await svc.from('backoffice_users').insert({ user_id: ownerId, tenant_id: tenantId, role: 'owner' })).error, null);

  // store_operator só de A — para provar as restrições de Store→Store (não pode
  // despachar de B, não pode receber em X).
  c.opAEmail = `op-a-1g4g-${rand()}@test.local`;
  const opAId = await mkAuthUser(c.opAEmail);
  assert.equal((await svc.from('backoffice_users').insert({ user_id: opAId, tenant_id: tenantId, role: 'store_operator' })).error, null);
  assert.equal((await svc.from('backoffice_user_stores').insert({ user_id: opAId, tenant_id: tenantId, store_id: c.storeA })).error, null);
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

test('Warehouse->Warehouse: A1 100 -> A2 30 = 70/30 (total 100); retry sem duplicar; sync local correcto; Store/Warehouse forjado bloqueado', opts, async () => {
  await wh.applyWarehouseDelta({ tenantId: c.tenantId, warehouseId: c.whA1, productId: c.productLocalId, delta: 100, movementType: 'restock', referenceId: `RESTOCK:1g4g:${uuid()}` });
  await syncService.processSyncQueueCycle();
  await syncService.processPullSyncCycle();
  assert.equal(await cloudWarehouseQty(c.whA1, c.productCloudId), 100);

  const owner = await signIn(c.ownerEmail);
  const key = `wh-${uuid()}`;
  const r1 = await owner.rpc('backoffice_transfer_stock', { p_store_id: c.storeA, p_from_warehouse_id: c.whA1, p_to_warehouse_id: c.whA2, p_product_id: c.productCloudId, p_quantity: 30, p_idempotency_key: key });
  assert.equal(r1.error, null, JSON.stringify(r1.error));
  assert.equal(r1.data[0].out_status, 'transferred');
  assert.equal(await cloudWarehouseQty(c.whA1, c.productCloudId), 70);
  assert.equal(await cloudWarehouseQty(c.whA2, c.productCloudId), 30);
  assert.equal((await cloudWarehouseQty(c.whA1, c.productCloudId)) + (await cloudWarehouseQty(c.whA2, c.productCloudId)), 100, 'conservação: o total nunca muda');

  const retry = await owner.rpc('backoffice_transfer_stock', { p_store_id: c.storeA, p_from_warehouse_id: c.whA1, p_to_warehouse_id: c.whA2, p_product_id: c.productCloudId, p_quantity: 30, p_idempotency_key: key });
  assert.equal(retry.data[0].out_status, 'duplicate');
  assert.equal(await cloudWarehouseQty(c.whA1, c.productCloudId), 70, 'retry nunca duplica');

  await syncService.processPullSyncCycle();
  assert.equal(await wh.getWarehouseQuantity(c.whA1, c.productLocalId, c.tenantId), 70, 'sync local reflecte a origem');
  assert.equal(await wh.getWarehouseQuantity(c.whA2, c.productLocalId, c.tenantId), 30, 'sync local reflecte o destino');

  const forgedWh = await owner.rpc('backoffice_transfer_stock', { p_store_id: c.storeA, p_from_warehouse_id: c.whA1, p_to_warehouse_id: c.whX1, p_product_id: c.productCloudId, p_quantity: 1, p_idempotency_key: `k-${uuid()}` });
  assert.match(forgedWh.error.message, /warehouse_not_in_store/);

  const op = await signIn(c.opAEmail);
  const forgedStore = await op.rpc('backoffice_transfer_stock', { p_store_id: c.storeX, p_from_warehouse_id: c.whX1, p_to_warehouse_id: c.whX1, p_product_id: c.productCloudId, p_quantity: 1, p_idempotency_key: `k-${uuid()}` });
  assert.match(forgedStore.error.message, /store_not_authorized/);

  const cloudRows = (await svc.from('warehouse_stock').select('warehouse_id,product_id,quantity').eq('store_id', c.storeA)).data;
  const rec = await led.computeReconciliation({ tenantId: c.tenantId, cloudRows });
  assert.equal(rec.divergent_count, 0, JSON.stringify(rec.divergent));
});

test('Store->Store: A→B via Backoffice — dispatch debita A; antes do receive B não recebe; receive autorizado credita B; retry sem duplicar; cancel conforme regra existente; conservação + reconciliação = 0', opts, async () => {
  const owner = await signIn(c.ownerEmail);
  const op = await signIn(c.opAEmail); // só Store A

  // Produto e saldo inicial só na cloud (fixture, service_role) — este teste só exercita
  // as RPCs directamente via sessão do Backoffice, nunca o pull local (esse já está
  // coberto pelo teste de Warehouse->Warehouse acima).
  const productAB = uuid();
  assert.equal((await svc.from('products').insert({ id: productAB, tenant_id: c.tenantId, name: 'Produto AB 1G4G', price: 5 })).error, null);
  assert.equal(
    (await svc.from('stock_movements').insert({ tenant_id: c.tenantId, store_id: c.storeA, warehouse_id: c.whA1, product_id: productAB, type: 'restock', quantity: 100, reference_id: `seed:${uuid()}`, device_id: null })).error,
    null
  );

  const totalBefore = (await cloudWarehouseQty(c.whA1, productAB)) + (await cloudWarehouseQty(c.whB1, productAB));

  // store_operator de A NÃO pode despachar de B (não atribuído)
  const opForgedFrom = await op.rpc('transfer_dispatch', { p_transfer: { id: uuid(), from_warehouse_id: c.whA1, to_store_id: c.storeA, items: [{ product_id: productAB, qty: 1 }] }, p_store_id: c.storeB });
  assert.match(opForgedFrom.error.message, /store_not_authorized/);

  // dispatch A -> B (owner, Tenant inteiro)
  const transferId = uuid();
  const dispatch = await owner.rpc('transfer_dispatch', {
    p_transfer: { id: transferId, from_warehouse_id: c.whA1, to_store_id: c.storeB, items: [{ product_id: productAB, qty: 12 }] },
    p_store_id: c.storeA,
  });
  assert.equal(dispatch.error, null, JSON.stringify(dispatch.error));
  assert.equal(dispatch.data[0].out_status, 'dispatched');

  const { data: seedInA } = await svc.from('stock_movements').select('quantity').eq('reference_id', `transfer:${transferId}:${productAB}:out`).single();
  assert.equal(Number(seedInA.quantity), -12, 'origem debitada no dispatch');

  // antes do receive, B ainda não tem o produto creditado
  assert.equal(await cloudWarehouseQty(c.whB1, productAB), 0, 'destino não recebe antes do receive');

  // retry do MESMO dispatch (mesmo id) é idempotente — devolve already_exists, nunca debita 2x
  const dispatchRetry = await owner.rpc('transfer_dispatch', {
    p_transfer: { id: transferId, from_warehouse_id: c.whA1, to_store_id: c.storeB, items: [{ product_id: productAB, qty: 12 }] },
    p_store_id: c.storeA,
  });
  assert.equal(dispatchRetry.data[0].out_already_exists, true);

  // store_operator de A não pode receber em B (não atribuído)
  const opForgedReceive = await op.rpc('transfer_receive', { p_id: transferId, p_to_warehouse: c.whB1, p_items: [{ product_id: productAB, qty_received: 12 }], p_store_id: c.storeB });
  assert.match(opForgedReceive.error.message, /store_not_authorized/);

  // receive autorizado (owner, Tenant inteiro cobre B também)
  const receive = await owner.rpc('transfer_receive', { p_id: transferId, p_to_warehouse: c.whB1, p_items: [{ product_id: productAB, qty_received: 12 }], p_store_id: c.storeB });
  assert.equal(receive.error, null, JSON.stringify(receive.error));
  assert.equal(receive.data[0].out_status, 'received');
  assert.equal(await cloudWarehouseQty(c.whB1, productAB), 12, 'destino creditado após o receive');

  // retry do receive é idempotente (nunca credita 2x)
  const receiveRetry = await owner.rpc('transfer_receive', { p_id: transferId, p_to_warehouse: c.whB1, p_items: [{ product_id: productAB, qty_received: 12 }], p_store_id: c.storeB });
  assert.equal(receiveRetry.data[0].out_applied, false);
  assert.equal(await cloudWarehouseQty(c.whB1, productAB), 12, 'retry do receive nunca duplica');

  const totalAfter = (await cloudWarehouseQty(c.whA1, productAB)) + (await cloudWarehouseQty(c.whB1, productAB));
  assert.equal(totalAfter, totalBefore, 'conservação: o total nunca muda (débito em A = crédito em B)');

  // cancel: já 'received' -> a regra existente recusa (só cancela a partir de 'dispatched')
  const cancelAfterReceived = await owner.rpc('transfer_cancel', { p_id: transferId, p_reason: 'teste', p_store_id: c.storeA });
  assert.equal(cancelAfterReceived.data[0].out_applied, false);
  assert.equal(cancelAfterReceived.data[0].out_status, 'received', 'estado inalterado — regra existente preservada');

  // Segunda transferência, cancelada ANTES do receive: prova o movimento compensatório.
  const transferId2 = uuid();
  const dispatch2 = await owner.rpc('transfer_dispatch', {
    p_transfer: { id: transferId2, from_warehouse_id: c.whA1, to_store_id: c.storeB, items: [{ product_id: productAB, qty: 5 }] },
    p_store_id: c.storeA,
  });
  assert.equal(dispatch2.data[0].out_status, 'dispatched');
  const beforeCancelA = await cloudWarehouseQty(c.whA1, productAB);
  const cancel2 = await owner.rpc('transfer_cancel', { p_id: transferId2, p_reason: 'engano', p_store_id: c.storeA });
  assert.equal(cancel2.data[0].out_status, 'cancelled');
  assert.equal(await cloudWarehouseQty(c.whA1, productAB), beforeCancelA + 5, 'movimento compensatório devolve o stock à origem');

  // Nota: computeReconciliation (local vs cloud) não se aplica aqui de propósito — este
  // produto é deliberadamente cloud-only (o pull local já está coberto pelo teste de
  // Warehouse->Warehouse acima); "reconciliação" para Store->Store significa o ledger
  // cloud em si ficar conservado, já provado pelas asserções de conservação acima
  // (totalAfter === totalBefore, e o compensatório devolvendo exactamente o despachado).
});
