/**
 * Etapa 1G.4 Fase 3C.1 — Backoffice Stock: consulta + entrada. Sem service_role em
 * nenhum caminho de escrita/leitura do Backoffice — só a nova RPC
 * backoffice_create_stock_movement (SECURITY DEFINER), que devolve à ledger existente
 * (Fase 1) exactamente como o Device faria. Device JWT real + Postgres real +
 * SQLite local real para o cenário E2E obrigatório.
 *
 * Requer env: POSLY_1G4E_ISSUER_URL, POSLY_1G4E_ADMIN_TOKEN, POSLY_1G4E_SUPABASE_URL,
 *   POSLY_1G4E_ANON_KEY, POSLY_1G4E_SERVICE_ROLE_KEY.
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, before, after, mock } from 'node:test';
import { createClient } from '@supabase/supabase-js';

const E = (k) => process.env[`POSLY_1G4E_${k}`] || '';
const run = Boolean(E('ISSUER_URL') && E('ADMIN_TOKEN') && E('SUPABASE_URL') && E('ANON_KEY') && E('SERVICE_ROLE_KEY'));
const opts = { skip: !run && 'defina POSLY_1G4E_*' };

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
  const boot = await post('/api/license-issuer/device/bootstrap', { activation_token: tok.data.activation_token, machine_id: `m-1g4e-${rand()}` }, false);
  assert.equal(boot.status, 200, JSON.stringify(boot.data));
  return {
    deviceId: boot.data.device_id,
    client: createClient(E('SUPABASE_URL'), E('ANON_KEY'), {
      global: { headers: { Authorization: `Bearer ${boot.data.access_token}` } },
      auth: { persistSession: false },
    }),
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
  return createClient(E('SUPABASE_URL'), E('ANON_KEY'), {
    global: { headers: { Authorization: `Bearer ${data.session.access_token}` } },
    auth: { persistSession: false },
  });
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
  const tenantId = `itest-1g4e-${rand()}`;
  await post('/api/license-issuer/tenants', { id: tenantId, name: 'T1G4E' });
  const lic = await post('/api/license-issuer/licenses', { tenant_id: tenantId, plan: 'PRO', commerce_type: 'retalho', max_devices: 20 });
  c.tenantId = tenantId;
  c.licenseId = lic.data.license.id;
  const mkStore = async (n) => (await post('/api/license-issuer/stores', { tenant_id: tenantId, license_id: c.licenseId, name: n })).data.store.id;
  c.storeA = await mkStore('Loja A (1G4E)');
  c.storeX = await mkStore('Loja X (1G4E, outra Store)');

  // --- deviceA: identidade REAL local — é o Store Server sob teste ---
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'posly-1g4e-live-'));
  process.env.POS_DB_PATH = path.join(tmpDir, 'database.db');
  process.env.DEFAULT_TENANT_ID = tenantId;
  process.env.SUPABASE_URL = E('SUPABASE_URL');
  process.env.SUPABASE_ANON_KEY = E('ANON_KEY');
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;

  const { startDeviceAuthBridge, stopDeviceAuthBridge } = await import('../../electron/deviceAuth/deviceAuthBridge.js');
  c.stopBridge = stopDeviceAuthBridge;
  deviceAuthClient = await import('../../electron/deviceAuth/deviceAuthClient.js');
  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'posly-1g4e-live-electron-'));
  const tokA = await post('/api/license-issuer/device/activation-tokens', { tenant_id: tenantId, license_id: c.licenseId, store_id: c.storeA });
  const bootA = await deviceAuthClient.bootstrapDevice({ activationToken: tokA.data.activation_token, machineId: 'machine-1g4e-A', userDataPath, issuerBaseUrl: E('ISSUER_URL') });
  assert.equal(bootA.ok, true, JSON.stringify(bootA));
  c.deviceAId = bootA.deviceId;
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

  const deviceB = await bootstrapRawDevice(tenantId, c.licenseId, c.storeA); // só para publicar o armazém
  const deviceX = await bootstrapRawDevice(tenantId, c.licenseId, c.storeX);

  const now = new Date().toISOString();
  // Dois produtos independentes: um para o teste de fronteiras RLS/RPC, outro só para o
  // cenário obrigatório 100->120 (nunca partilhar saldo entre os dois testes).
  c.productCloudId = uuid();
  assert.equal((await svc.from('products').insert({ id: c.productCloudId, tenant_id: tenantId, name: 'Produto 1G4E', price: 10 })).error, null);
  await dbUtils.run(`INSERT INTO products (cloud_id, tenant_id, name, price, cost, stock_quantity, created_at, updated_at) VALUES (?, ?, 'Produto 1G4E', 10, 0, 0, ?, ?)`, [c.productCloudId, tenantId, now, now]);
  c.productLocalId = (await dbUtils.get(`SELECT id FROM products WHERE cloud_id = ?`, [c.productCloudId])).id;

  c.productCloudId2 = uuid();
  assert.equal((await svc.from('products').insert({ id: c.productCloudId2, tenant_id: tenantId, name: 'Produto 1G4E (E2E)', price: 10 })).error, null);
  await dbUtils.run(`INSERT INTO products (cloud_id, tenant_id, name, price, cost, stock_quantity, created_at, updated_at) VALUES (?, ?, 'Produto 1G4E (E2E)', 10, 0, 0, ?, ?)`, [c.productCloudId2, tenantId, now, now]);
  c.productLocalId2 = (await dbUtils.get(`SELECT id FROM products WHERE cloud_id = ?`, [c.productCloudId2])).id;

  c.whA1 = uuid();
  await dbUtils.run(`INSERT INTO warehouses (id, tenant_id, name, is_default, is_active, created_at, updated_at) VALUES (?, ?, 'Principal 1G4E', 1, 1, ?, ?)`, [c.whA1, tenantId, now, now]);
  assert.equal((await pushWh(deviceB.client, c.whA1, 'Principal 1G4E', true)).error, null);

  c.whX1 = uuid();
  assert.equal((await pushWh(deviceX.client, c.whX1, 'Principal X 1G4E', true)).error, null);

  // Backoffice: owner (Tenant inteiro) e store_operator (só storeA)
  c.ownerEmail = `owner-1g4e-${rand()}@test.local`;
  c.opEmail = `op-1g4e-${rand()}@test.local`;
  const ownerId = await mkAuthUser(c.ownerEmail);
  const opId = await mkAuthUser(c.opEmail);
  await svc.from('backoffice_users').insert([
    { user_id: ownerId, tenant_id: tenantId, role: 'owner' },
    { user_id: opId, tenant_id: tenantId, role: 'store_operator' },
  ]);
  const { error: assignErr } = await svc.from('backoffice_user_stores').insert({ user_id: opId, tenant_id: tenantId, store_id: c.storeA });
  assert.equal(assignErr, null);
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

test('RLS/RPC: owner cria entrada válida; store_operator só na Store atribuída; Tenant/Store/Warehouse forjados bloqueados', opts, async () => {
  const owner = await signIn(c.ownerEmail);
  const op = await signIn(c.opEmail);

  const r1 = await owner.rpc('backoffice_create_stock_movement', {
    p_store_id: c.storeA,
    p_warehouse_id: c.whA1,
    p_product_id: c.productCloudId,
    p_quantity: 5,
    p_idempotency_key: `k-${uuid()}`,
  });
  assert.equal(r1.error, null, JSON.stringify(r1.error));
  assert.equal(r1.data[0].out_status, 'inserted');

  // Warehouse de outra Store (X) nunca aceite, mesmo indicando a Store correcta (A)
  const forgedWh = await owner.rpc('backoffice_create_stock_movement', {
    p_store_id: c.storeA,
    p_warehouse_id: c.whX1,
    p_product_id: c.productCloudId,
    p_quantity: 5,
    p_idempotency_key: `k-${uuid()}`,
  });
  assert.match(forgedWh.error.message, /warehouse_not_in_store/);

  // store_operator não atribuído à Store X
  const opForgedStore = await op.rpc('backoffice_create_stock_movement', {
    p_store_id: c.storeX,
    p_warehouse_id: c.whX1,
    p_product_id: c.productCloudId,
    p_quantity: 5,
    p_idempotency_key: `k-${uuid()}`,
  });
  assert.match(opForgedStore.error.message, /store_not_authorized/);

  // store_operator na Store atribuída (A) — permitido
  const opOk = await op.rpc('backoffice_create_stock_movement', {
    p_store_id: c.storeA,
    p_warehouse_id: c.whA1,
    p_product_id: c.productCloudId,
    p_quantity: 3,
    p_idempotency_key: `k-${uuid()}`,
  });
  assert.equal(opOk.error, null, JSON.stringify(opOk.error));

  // quantidade inválida
  const badQty = await owner.rpc('backoffice_create_stock_movement', {
    p_store_id: c.storeA,
    p_warehouse_id: c.whA1,
    p_product_id: c.productCloudId,
    p_quantity: -1,
    p_idempotency_key: `k-${uuid()}`,
  });
  assert.match(badQty.error.message, /quantity_must_be_positive/);

  // retry com a MESMA chave de idempotência: duplicate, nunca duplica
  const key = `k-${uuid()}`;
  const first = await owner.rpc('backoffice_create_stock_movement', { p_store_id: c.storeA, p_warehouse_id: c.whA1, p_product_id: c.productCloudId, p_quantity: 7, p_idempotency_key: key });
  const retry = await owner.rpc('backoffice_create_stock_movement', { p_store_id: c.storeA, p_warehouse_id: c.whA1, p_product_id: c.productCloudId, p_quantity: 7, p_idempotency_key: key });
  assert.equal(first.data[0].out_status, 'inserted');
  assert.equal(retry.data[0].out_status, 'duplicate');
  assert.equal(retry.data[0].out_id, first.data[0].out_id);

  const { data: rows } = await svc.from('stock_movements').select('id').eq('tenant_id', c.tenantId).eq('reference_id', `backoffice:${key}`);
  assert.equal(rows.length, 1, 'nunca duplica na cloud');

  // leitura: store_operator nunca lê stock_movements de X
  const { data: readX } = await op.from('stock_movements').select('id').eq('store_id', c.storeX);
  assert.equal((readX ?? []).length, 0);
});

test('cenário obrigatório: local 100 -> Backoffice entrada +20 -> cloud 120 -> sync Store Server -> local 120 -> retry/restart -> continua 120 -> reconciliação = 0', opts, async () => {
  await wh.applyWarehouseDelta({ tenantId: c.tenantId, warehouseId: c.whA1, productId: c.productLocalId2, delta: 100, movementType: 'restock', referenceId: `RESTOCK:1g4e:${uuid()}` });
  assert.equal(await wh.getWarehouseQuantity(c.whA1, c.productLocalId2, c.tenantId), 100);
  const pushSummary = await syncService.processSyncQueueCycle();
  assert.equal(pushSummary.skipped, false, JSON.stringify(pushSummary));
  await syncService.processPullSyncCycle(); // liga o cloud_id/ack do próprio movimento — estado convergido
  assert.equal(await cloudWarehouseQty(c.whA1, c.productCloudId2), 100);

  // --- Backoffice regista entrada de +20 ---
  const owner = await signIn(c.ownerEmail);
  const idemKey = `e2e-${uuid()}`;
  const entry = await owner.rpc('backoffice_create_stock_movement', {
    p_store_id: c.storeA,
    p_warehouse_id: c.whA1,
    p_product_id: c.productCloudId2,
    p_quantity: 20,
    p_idempotency_key: idemKey,
  });
  assert.equal(entry.error, null, JSON.stringify(entry.error));
  assert.equal(entry.data[0].out_status, 'inserted');
  assert.equal(await cloudWarehouseQty(c.whA1, c.productCloudId2), 120, 'cloud reflecte a entrada imediatamente');

  // --- sync Store Server: pull aplica exactamente uma vez ---
  await syncService.processPullSyncCycle();
  assert.equal(await wh.getWarehouseQuantity(c.whA1, c.productLocalId2, c.tenantId), 120, 'local converge para 120');

  const local = await dbUtils.get(`SELECT id FROM stock_movements WHERE tenant_id = ? AND reference_id = ?`, [c.tenantId, `backoffice:${idemKey}`]);
  assert.ok(local, 'o movimento do Backoffice existe localmente');
  const ledgerSync = await dbUtils.get(`SELECT status FROM stock_ledger_sync WHERE movement_id = ?`, [local.id]);
  assert.equal(ledgerSync?.status, 'pulled');

  // --- retry (mesma chave, RPC de novo) + restart (cursor local rebobinado) ---
  const retryEntry = await owner.rpc('backoffice_create_stock_movement', {
    p_store_id: c.storeA,
    p_warehouse_id: c.whA1,
    p_product_id: c.productCloudId2,
    p_quantity: 20,
    p_idempotency_key: idemKey,
  });
  assert.equal(retryEntry.data[0].out_status, 'duplicate');
  assert.equal(await cloudWarehouseQty(c.whA1, c.productCloudId2), 120, 'retry na cloud nunca duplica');

  await dbUtils.run(`UPDATE sync_state SET last_sync_at = '1970-01-01T00:00:00.000Z' WHERE id = ?`, [`cloud:stock_movements:${c.tenantId}`]);
  await syncService.processPullSyncCycle();
  assert.equal(await wh.getWarehouseQuantity(c.whA1, c.productLocalId2, c.tenantId), 120, 'restart/replay do pull continua 120 — nunca duplica localmente');

  // Nota: os ciclos de pull acima são por Tenant, não por produto — também absorvem os
  // movimentos Backoffice do teste anterior (productCloudId), convergindo-os localmente
  // pela mesma via. É o comportamento correcto (reconciliação real, à escala da Store),
  // por isso aqui NÃO se filtra por produto.
  const cloudRows = (await svc.from('warehouse_stock').select('warehouse_id,product_id,quantity').eq('store_id', c.storeA)).data;
  const rec = await led.computeReconciliation({ tenantId: c.tenantId, cloudRows });
  assert.equal(rec.divergent_count, 0, JSON.stringify(rec.divergent));
});
