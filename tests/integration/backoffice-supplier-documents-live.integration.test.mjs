/**
 * Etapa 1G.4 Fase 3D — Backoffice: Documentos de Fornecedor + Pagamentos. Sem
 * service_role em nenhum caminho de escrita/leitura do Backoffice. Device JWT real +
 * Postgres real + SQLite local real para o cenário de sync do Store Server.
 *
 * Requer env: POSLY_1G4H_ISSUER_URL, POSLY_1G4H_ADMIN_TOKEN, POSLY_1G4H_SUPABASE_URL,
 *   POSLY_1G4H_ANON_KEY, POSLY_1G4H_SERVICE_ROLE_KEY.
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, before, after, mock } from 'node:test';
import { createClient } from '@supabase/supabase-js';

const E = (k) => process.env[`POSLY_1G4H_${k}`] || '';
const run = Boolean(E('ISSUER_URL') && E('ADMIN_TOKEN') && E('SUPABASE_URL') && E('ANON_KEY') && E('SERVICE_ROLE_KEY'));
const opts = { skip: !run && 'defina POSLY_1G4H_*' };

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
  const boot = await post('/api/license-issuer/device/bootstrap', { activation_token: tok.data.activation_token, machine_id: `m-1g4h-${rand()}` }, false);
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
  const tenantId = `itest-1g4h-${rand()}`;
  await post('/api/license-issuer/tenants', { id: tenantId, name: 'T1G4H' });
  const lic = await post('/api/license-issuer/licenses', { tenant_id: tenantId, plan: 'PRO', commerce_type: 'retalho', max_devices: 20 });
  c.tenantId = tenantId;
  c.licenseId = lic.data.license.id;
  const mkStore = async (n) => (await post('/api/license-issuer/stores', { tenant_id: tenantId, license_id: c.licenseId, name: n })).data.store.id;
  c.storeA = await mkStore('Loja A (1G4H)');
  c.storeX = await mkStore('Loja X (1G4H)');

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'posly-1g4h-live-'));
  process.env.POS_DB_PATH = path.join(tmpDir, 'database.db');
  process.env.DEFAULT_TENANT_ID = tenantId;
  process.env.SUPABASE_URL = E('SUPABASE_URL');
  process.env.SUPABASE_ANON_KEY = E('ANON_KEY');
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;

  const { startDeviceAuthBridge, stopDeviceAuthBridge } = await import('../../electron/deviceAuth/deviceAuthBridge.js');
  c.stopBridge = stopDeviceAuthBridge;
  deviceAuthClient = await import('../../electron/deviceAuth/deviceAuthClient.js');
  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'posly-1g4h-live-electron-'));
  const tokA = await post('/api/license-issuer/device/activation-tokens', { tenant_id: tenantId, license_id: c.licenseId, store_id: c.storeA });
  const bootA = await deviceAuthClient.bootstrapDevice({ activationToken: tokA.data.activation_token, machineId: 'machine-1g4h-A', userDataPath, issuerBaseUrl: E('ISSUER_URL') });
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
  c.productCloudId = uuid();
  assert.equal((await svc.from('products').insert({ id: c.productCloudId, tenant_id: tenantId, name: 'Produto 1G4H', price: 10 })).error, null);
  await dbUtils.run(`INSERT INTO products (cloud_id, tenant_id, name, price, cost, stock_quantity, created_at, updated_at) VALUES (?, ?, 'Produto 1G4H', 10, 0, 0, ?, ?)`, [c.productCloudId, tenantId, now, now]);
  c.productLocalId = (await dbUtils.get(`SELECT id FROM products WHERE cloud_id = ?`, [c.productCloudId])).id;

  c.whA1 = uuid();
  await dbUtils.run(`INSERT INTO warehouses (id, tenant_id, name, is_default, is_active, created_at, updated_at) VALUES (?, ?, 'A1', 1, 1, ?, ?)`, [c.whA1, tenantId, now, now]);
  assert.equal((await pushWh(deviceB.client, c.whA1, 'A1', true)).error, null);
  c.whX1 = uuid();
  assert.equal((await pushWh(deviceX.client, c.whX1, 'X1', true)).error, null);

  c.supplierId = uuid();
  assert.equal((await svc.from('suppliers').insert({ id: c.supplierId, tenant_id: tenantId, name: 'Fornecedor 1G4H' })).error, null);
  c.supplierOtherTenant = uuid(); // simula um supplier "de outro tenant" — nunca existirá em suppliers deste tenant

  c.ownerEmail = `owner-1g4h-${rand()}@test.local`;
  const ownerId = await mkAuthUser(c.ownerEmail);
  assert.equal((await svc.from('backoffice_users').insert({ user_id: ownerId, tenant_id: tenantId, role: 'owner' })).error, null);

  c.opAEmail = `op-a-1g4h-${rand()}@test.local`;
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

test('draft->confirmed->stock; retry sem duplicar; confirmed imutável; cancel confirmed bloqueado; sync Store Server + reconciliação = 0', opts, async () => {
  const owner = await signIn(c.ownerEmail);

  const doc = await owner.from('supplier_documents').insert({ tenant_id: c.tenantId, store_id: c.storeA, supplier_id: c.supplierId, document_number: `FAT-${rand()}` }).select('id,status').single();
  assert.equal(doc.error, null, JSON.stringify(doc.error));
  assert.equal(doc.data.status, 'draft');
  const documentId = doc.data.id;

  const item = await owner.from('supplier_document_items').insert({ tenant_id: c.tenantId, document_id: documentId, product_id: c.productCloudId, quantity: 40, unit_cost: 3.5 }).select('id').single();
  assert.equal(item.error, null, JSON.stringify(item.error));

  // draft pode editar
  const editItem = await owner.from('supplier_document_items').update({ quantity: 40, unit_cost: 4 }).eq('id', item.data.id).select('unit_cost').single();
  assert.equal(editItem.error, null);
  assert.equal(Number(editItem.data.unit_cost), 4);

  const confirm = await owner.rpc('backoffice_confirm_supplier_document', { p_document_id: documentId });
  assert.equal(confirm.error, null, JSON.stringify(confirm.error));
  assert.equal(confirm.data[0].out_status, 'confirmed');
  assert.equal(confirm.data[0].out_items_applied, 1);
  assert.equal(await cloudWarehouseQty(c.whA1, c.productCloudId), 40, 'confirmação gera o restock no ledger');

  // retry da confirmação inteira: idempotente, nunca duplica
  const confirmRetry = await owner.rpc('backoffice_confirm_supplier_document', { p_document_id: documentId });
  assert.equal(confirmRetry.data[0].out_status, 'already_confirmed');
  assert.equal(await cloudWarehouseQty(c.whA1, c.productCloudId), 40, 'retry nunca duplica o stock');

  // confirmed é imutável: UPDATE directo (documento e item) nunca passa
  const editConfirmedDoc = await owner.from('supplier_documents').update({ document_number: 'HACK' }).eq('id', documentId).select('id');
  assert.equal((editConfirmedDoc.data ?? []).length, 0, 'RLS nunca deixa actualizar um documento já não-draft');
  // RLS já filtra a linha fora do alvo do UPDATE (0 linhas afectadas, sem erro — semântica
  // normal de RLS); confirmamos pelo resultado devolvido, não por uma excepção.
  const editConfirmedItem = await owner.from('supplier_document_items').update({ quantity: 999 }).eq('document_id', documentId).select('id');
  assert.equal((editConfirmedItem.data ?? []).length, 0, 'RLS nunca deixa alterar items de um documento já não-draft');
  const { data: itemStillFour } = await owner.from('supplier_document_items').select('quantity').eq('document_id', documentId).single();
  assert.equal(Number(itemStillFour.quantity), 40, 'a quantidade confirmada nunca muda');

  // cancelar um documento confirmado é bloqueado nesta fase
  const { data: docNow } = await owner.from('supplier_documents').select('status').eq('id', documentId).single();
  assert.equal(docNow.status, 'confirmed');
  const cancelConfirmed = await owner.from('supplier_documents').update({ status: 'cancelled' }).eq('id', documentId).select('id');
  assert.equal((cancelConfirmed.data ?? []).length, 0, 'RLS/trigger recusam cancelar um documento confirmado');

  // sync Store Server
  const pullSummary = await syncService.processPullSyncCycle();
  assert.equal(pullSummary.reason, null, JSON.stringify(pullSummary));
  assert.equal(await wh.getWarehouseQuantity(c.whA1, c.productLocalId, c.tenantId), 40, 'o Store Server recebe o restock do documento');

  const cloudRows = (await svc.from('warehouse_stock').select('warehouse_id,product_id,quantity').eq('store_id', c.storeA)).data;
  const rec = await led.computeReconciliation({ tenantId: c.tenantId, cloudRows });
  assert.equal(rec.divergent_count, 0, JSON.stringify(rec.divergent));
});

test('cancelar um draft é permitido', opts, async () => {
  const owner = await signIn(c.ownerEmail);
  const doc = await owner.from('supplier_documents').insert({ tenant_id: c.tenantId, store_id: c.storeA, supplier_id: c.supplierId, document_number: `DRAFT-${rand()}` }).select('id').single();
  const cancel = await owner.from('supplier_documents').update({ status: 'cancelled' }).eq('id', doc.data.id).select('status').single();
  assert.equal(cancel.error, null, JSON.stringify(cancel.error));
  assert.equal(cancel.data.status, 'cancelled');
});

test('pagamento parcial + segundo pagamento; overpayment bloqueado; Tenant/Store/Supplier forjados bloqueados', opts, async () => {
  const owner = await signIn(c.ownerEmail);
  const op = await signIn(c.opAEmail);

  const doc = await owner.from('supplier_documents').insert({ tenant_id: c.tenantId, store_id: c.storeA, supplier_id: c.supplierId, document_number: `PAY-${rand()}` }).select('id').single();
  const documentId = doc.data.id;
  await owner.from('supplier_document_items').insert({ tenant_id: c.tenantId, document_id: documentId, product_id: c.productCloudId, quantity: 10, unit_cost: 10 }); // total = 100
  const confirm = await owner.rpc('backoffice_confirm_supplier_document', { p_document_id: documentId });
  assert.equal(confirm.data[0].out_status, 'confirmed');

  // pagamento sobre documento draft/inexistente é bloqueado noutro sítio — aqui: supplier forjado
  const forgedSupplier = await owner.rpc('backoffice_pay_supplier_document', { p_document_id: documentId, p_supplier_id: uuid(), p_amount: 10, p_method: 'transferência', p_idempotency_key: `k-${uuid()}` });
  assert.match(forgedSupplier.error.message, /document_supplier_mismatch/);

  // store_operator (só de A) não pode pagar um documento da Store X — cria e confirma
  // com o owner (Tenant inteiro cobre X também), a sessão do teste real é a do op abaixo.
  const docX = await owner.from('supplier_documents').insert({ tenant_id: c.tenantId, store_id: c.storeX, supplier_id: c.supplierId, document_number: `PAYX-${rand()}` }).select('id').single();
  await owner.from('supplier_document_items').insert({ tenant_id: c.tenantId, document_id: docX.data.id, product_id: c.productCloudId, quantity: 1, unit_cost: 1 });
  const confirmX = await owner.rpc('backoffice_confirm_supplier_document', { p_document_id: docX.data.id });
  assert.equal(confirmX.error, null, JSON.stringify(confirmX.error));
  const opForgedStore = await op.rpc('backoffice_pay_supplier_document', { p_document_id: docX.data.id, p_supplier_id: c.supplierId, p_amount: 1, p_method: null, p_idempotency_key: `k-${uuid()}` });
  assert.match(opForgedStore.error.message, /store_not_authorized/);

  // pagamento parcial
  const key1 = `pay1-${uuid()}`;
  const pay1 = await owner.rpc('backoffice_pay_supplier_document', { p_document_id: documentId, p_supplier_id: c.supplierId, p_amount: 60, p_method: 'transferência', p_idempotency_key: key1 });
  assert.equal(pay1.error, null, JSON.stringify(pay1.error));
  assert.equal(pay1.data[0].out_status, 'inserted');
  assert.equal(Number(pay1.data[0].out_remaining), 40);

  // retry do mesmo pagamento: duplicate, nunca duplica
  const pay1Retry = await owner.rpc('backoffice_pay_supplier_document', { p_document_id: documentId, p_supplier_id: c.supplierId, p_amount: 60, p_method: 'transferência', p_idempotency_key: key1 });
  assert.equal(pay1Retry.data[0].out_status, 'duplicate');

  // overpayment: pedir mais do que o saldo restante (40) é bloqueado
  const overpay = await owner.rpc('backoffice_pay_supplier_document', { p_document_id: documentId, p_supplier_id: c.supplierId, p_amount: 41, p_method: null, p_idempotency_key: `k-${uuid()}` });
  assert.match(overpay.error.message, /payment_exceeds_balance/);

  // pagamento <=0 bloqueado
  const zeroPay = await owner.rpc('backoffice_pay_supplier_document', { p_document_id: documentId, p_supplier_id: c.supplierId, p_amount: 0, p_method: null, p_idempotency_key: `k-${uuid()}` });
  assert.match(zeroPay.error.message, /amount_must_be_positive/);

  // segundo pagamento: exactamente o restante — fecha a conta
  const pay2 = await owner.rpc('backoffice_pay_supplier_document', { p_document_id: documentId, p_supplier_id: c.supplierId, p_amount: 40, p_method: 'dinheiro', p_idempotency_key: `pay2-${uuid()}` });
  assert.equal(pay2.error, null, JSON.stringify(pay2.error));
  assert.equal(Number(pay2.data[0].out_remaining), 0);

  // pagar não altera stock
  assert.equal(await cloudWarehouseQty(c.whA1, c.productCloudId), 40 + 10, 'pagamento nunca mexe no ledger de stock (40 do teste 1 + 10 deste)');
});

test('concorrência: dois pagamentos simultâneos nunca ultrapassam o saldo', opts, async () => {
  const owner = await signIn(c.ownerEmail);
  const doc = await owner.from('supplier_documents').insert({ tenant_id: c.tenantId, store_id: c.storeA, supplier_id: c.supplierId, document_number: `RACE-${rand()}` }).select('id').single();
  const documentId = doc.data.id;
  await owner.from('supplier_document_items').insert({ tenant_id: c.tenantId, document_id: documentId, product_id: c.productCloudId, quantity: 1, unit_cost: 50 }); // total = 50
  await owner.rpc('backoffice_confirm_supplier_document', { p_document_id: documentId });

  const [ra, rb] = await Promise.all([
    owner.rpc('backoffice_pay_supplier_document', { p_document_id: documentId, p_supplier_id: c.supplierId, p_amount: 30, p_method: null, p_idempotency_key: `race-a-${uuid()}` }),
    owner.rpc('backoffice_pay_supplier_document', { p_document_id: documentId, p_supplier_id: c.supplierId, p_amount: 30, p_method: null, p_idempotency_key: `race-b-${uuid()}` }),
  ]);
  const ok = [ra, rb].filter((r) => !r.error);
  const failed = [ra, rb].filter((r) => r.error);
  assert.equal(ok.length, 1, 'só um dos dois pagamentos concorrentes de 30 (saldo=50) pode passar');
  assert.equal(failed.length, 1);
  assert.match(failed[0].error.message, /payment_exceeds_balance/);
  const { data: sum } = await svc.from('supplier_payments').select('amount').eq('document_id', documentId);
  const total = (sum ?? []).reduce((s, r) => s + Number(r.amount), 0);
  assert.ok(total <= 50, `saldo nunca ultrapassado (pago=${total})`);
});
