/**
 * Etapa 1G.4 (Fase 1 do Backoffice) — Cloud -> Store Server: pull de stock_movements
 * PASSA a aplicar ao stock local (antes era no-op — ver syncStockMovementsFromCloud em
 * api/syncService.js). Device JWT REAL, ponte Device Auth REAL, SQLite local REAL,
 * Postgres REAL (supabase/). Só o módulo nativo `electron` (safeStorage) é
 * mockado — inevitável fora do runtime Electron real (mesmo padrão de
 * device-sync-live.integration.test.mjs).
 *
 * Prova, contra o Postgres real:
 *  - movimento PRÓPRIO a voltar da cloud: nunca reaplica a quantidade, confirma via
 *    stock_ledger_sync (NUNCA em stock_movements.cloud_id — achado real: essa coluna já
 *    é usada localmente como chave interna das camadas de custo FIFO de transferências,
 *    nunca corresponde ao id real da cloud; ver comentário no teste correspondente);
 *  - movimento de OUTRO Device (mesma Store): aplica exactamente uma vez;
 *  - movimento de Backoffice (device_id NULL, fixture controlado — Fase 1 não cria RPC
 *    de Backoffice ainda): aplica exactamente uma vez;
 *  - cenário obrigatório: local 100 -> venda offline -5 (95) -> Backoffice +20 na cloud
 *    enquanto offline -> reconnect -> local=115, cloud=115, reconciliação=0;
 *  - retry/duplicado nunca duplica stock;
 *  - Warehouse/Store errada nunca aplica (armazém de OUTRA Store nunca existe localmente);
 *  - transferência Warehouse->Warehouse originada no Backoffice aplica os dois lados
 *    exactamente uma vez, sem regressão do mecanismo existente (Store->Store não é
 *    tocado por esta etapa — ver store-transfers-live.integration.test.mjs).
 *
 * Requer env: POSLY_1G4_ISSUER_URL, POSLY_1G4_ADMIN_TOKEN, POSLY_1G4_SUPABASE_URL,
 *   POSLY_1G4_ANON_KEY, POSLY_1G4_SERVICE_ROLE_KEY. Sem eles, os testes são saltados.
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, before, after, mock } from 'node:test';
import { createClient } from '@supabase/supabase-js';

const E = (k) => process.env[`POSLY_1G4_${k}`] || '';
const run = Boolean(E('ISSUER_URL') && E('ADMIN_TOKEN') && E('SUPABASE_URL') && E('ANON_KEY') && E('SERVICE_ROLE_KEY'));
const opts = { skip: !run && 'defina POSLY_1G4_*' };

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

async function post(p, body, admin = true) {
  const res = await fetch(`${E('ISSUER_URL')}${p}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(admin ? { Authorization: `Bearer ${E('ADMIN_TOKEN')}` } : {}) },
    body: JSON.stringify(body),
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

// Device "de fora" (sem SQLite local próprio) — só para chamar RPCs directamente, a
// simular outro Device da mesma Store, ou um Device de outra Store.
async function bootstrapRawDevice(tenantId, licenseId, storeId) {
  const tok = await post('/api/license-issuer/device/activation-tokens', { tenant_id: tenantId, license_id: licenseId, store_id: storeId });
  assert.equal(tok.status, 200, JSON.stringify(tok.data));
  const boot = await post('/api/license-issuer/device/bootstrap', { activation_token: tok.data.activation_token, machine_id: `m-1g4-${crypto.randomBytes(3).toString('hex')}` }, false);
  assert.equal(boot.status, 200, JSON.stringify(boot.data));
  return {
    deviceId: boot.data.device_id,
    client: createClient(E('SUPABASE_URL'), E('ANON_KEY'), {
      global: { headers: { Authorization: `Bearer ${boot.data.access_token}` } },
      auth: { persistSession: false },
    }),
  };
}

const pushWh = (cl, id, name, isDefault = false) =>
  cl.rpc('sync_upsert_warehouse', { p_id: id, p_name: name, p_code: null, p_is_default: isDefault, p_is_active: true });

// Fixture de um movimento "Backoffice" — Fase 1 não cria RPC/UI de Backoffice ainda
// (autorizado explicitamente: usar fixture controlado inserido pelo cliente de
// verificação com service_role, nunca pelo caminho do device/POS).
async function insertBackofficeMovement({ tenantId, storeId, warehouseId, productCloudId, type, quantity, referenceId }) {
  const { error } = await svc.from('stock_movements').insert({
    tenant_id: tenantId,
    store_id: storeId,
    warehouse_id: warehouseId,
    product_id: productCloudId,
    type,
    quantity,
    reference_id: referenceId,
    device_id: null,
    created_at: new Date().toISOString(),
  });
  assert.equal(error, null, JSON.stringify(error));
}

const cloudWarehouseQty = async (warehouseId, productCloudId) =>
  Number((await svc.from('warehouse_stock').select('quantity').eq('warehouse_id', warehouseId).eq('product_id', productCloudId)).data?.[0]?.quantity ?? 0);

const c = {};
let dbUtils;
let syncService;
let wh;
let led;
let deviceAuthClient;

before(async () => {
  if (!run) return;

  const tenantId = `itest-1g4-${crypto.randomBytes(3).toString('hex')}`;
  await post('/api/license-issuer/tenants', { id: tenantId, name: 'T1G4' });
  const lic = await post('/api/license-issuer/licenses', { tenant_id: tenantId, plan: 'PRO', commerce_type: 'retalho', max_devices: 20 });
  c.tenantId = tenantId;
  c.licenseId = lic.data.license.id;
  const mkStore = async (n) => (await post('/api/license-issuer/stores', { tenant_id: tenantId, license_id: c.licenseId, name: n })).data.store.id;
  c.storeA = await mkStore('Loja A (1G4)');
  c.storeX = await mkStore('Loja X (1G4, outra Store)');

  // --- deviceA: identidade REAL local (camada Electron), é o Store Server sob teste ---
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'posly-1g4-live-'));
  process.env.POS_DB_PATH = path.join(tmpDir, 'database.db');
  process.env.DEFAULT_TENANT_ID = tenantId;
  process.env.SUPABASE_URL = E('SUPABASE_URL');
  process.env.SUPABASE_ANON_KEY = E('ANON_KEY');
  delete process.env.SUPABASE_SERVICE_ROLE_KEY; // nunca visível ao caminho do device.

  const { startDeviceAuthBridge, stopDeviceAuthBridge } = await import('../../electron/deviceAuth/deviceAuthBridge.js');
  c.stopBridge = stopDeviceAuthBridge;
  deviceAuthClient = await import('../../electron/deviceAuth/deviceAuthClient.js');
  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'posly-1g4-live-electron-'));
  const tokA = await post('/api/license-issuer/device/activation-tokens', { tenant_id: tenantId, license_id: c.licenseId, store_id: c.storeA });
  const bootA = await deviceAuthClient.bootstrapDevice({ activationToken: tokA.data.activation_token, machineId: 'machine-1g4-A', userDataPath, issuerBaseUrl: E('ISSUER_URL') });
  assert.equal(bootA.ok, true, JSON.stringify(bootA));
  c.deviceAId = bootA.deviceId;
  c.userDataPath = userDataPath;
  c.tmpDir = tmpDir;

  const bridge = await startDeviceAuthBridge({ userDataPath, issuerBaseUrl: E('ISSUER_URL') });
  c.bridge = bridge;
  process.env.POS_DEVICE_AUTH_BRIDGE_URL = bridge.url;
  process.env.POS_DEVICE_AUTH_BRIDGE_SECRET = bridge.secret;
  // Etapa 1G.4: exactamente o que electron/main.js passa ao processo API real.
  process.env.POS_DEVICE_ID = bootA.deviceId;

  dbUtils = await import('../../api/dbUtils.js');
  syncService = await import('../../api/syncService.js');
  wh = await import('../../api/services/warehouseStock.service.js');
  led = await import('../../api/stockLedgerSync.js');

  // --- deviceB: OUTRO Device da MESMA Store A (só RPC directa, sem SQLite próprio) ---
  c.deviceB = await bootstrapRawDevice(tenantId, c.licenseId, c.storeA);
  // --- deviceX: Device de OUTRA Store (X) — para "Store/Warehouse errada nunca aplica" ---
  c.deviceX = await bootstrapRawDevice(tenantId, c.licenseId, c.storeX);

  // --- produto real (cloud + local, mesmo par cloud_id<->id local) ---
  c.productCloudId = uuid();
  const { error: prodErr } = await svc.from('products').insert({ id: c.productCloudId, tenant_id: tenantId, name: 'Produto 1G4', price: 10 });
  assert.equal(prodErr, null, JSON.stringify(prodErr));
  const now = new Date().toISOString();
  await dbUtils.run(
    `INSERT INTO products (cloud_id, tenant_id, name, price, cost, stock_quantity, created_at, updated_at) VALUES (?, ?, 'Produto 1G4', 10, 0, 0, ?, ?)`,
    [c.productCloudId, tenantId, now, now]
  );
  c.productLocalId = (await dbUtils.get(`SELECT id FROM products WHERE cloud_id = ?`, [c.productCloudId])).id;

  // --- armazéns de A: whA1 (default) e whA2 (segundo, para a transferência) — locais e
  // publicados na cloud pelo deviceB (mesma Store A, mesmo mecanismo real de
  // syncWarehousesToCloud: id local === id cloud) ---
  c.whA1 = uuid();
  c.whA2 = uuid();
  await dbUtils.run(`INSERT INTO warehouses (id, tenant_id, name, is_default, is_active, created_at, updated_at) VALUES (?, ?, 'Principal 1G4', 1, 1, ?, ?)`, [c.whA1, tenantId, now, now]);
  await dbUtils.run(`INSERT INTO warehouses (id, tenant_id, name, is_default, is_active, created_at, updated_at) VALUES (?, ?, 'Secundário 1G4', 0, 1, ?, ?)`, [c.whA2, tenantId, now, now]);
  for (const [id, n, d] of [[c.whA2, 'Secundário 1G4', false], [c.whA1, 'Principal 1G4', true]]) {
    assert.equal((await pushWh(c.deviceB.client, id, n, d)).error, null);
  }

  // --- armazém de X (outra Store), publicado pelo deviceX — nunca existe no SQLite de A ---
  c.whX1 = uuid();
  assert.equal((await pushWh(c.deviceX.client, c.whX1, 'Principal X 1G4', true)).error, null);
});

after(() => {
  if (!run) return;
  // A ponte é um servidor HTTP local (porta efémera) — sem fechar, o processo nunca
  // sai sozinho (foi exactamente isto que causou um "hang" aparente ao escrever este
  // teste: todas as assertions já tinham passado, só faltava fechar este handle).
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
      // best-effort: o ficheiro SQLite pode continuar brevemente bloqueado no Windows
    }
  }
});

test('próprio movimento a voltar da cloud: nunca reaplica a quantidade; confirma via stock_ledger_sync; reconciliação = 0', opts, async () => {
  const referenceId = `RESTOCK:1g4:${uuid()}`;
  await wh.applyWarehouseDelta({ tenantId: c.tenantId, warehouseId: c.whA1, productId: c.productLocalId, delta: 100, movementType: 'restock', referenceId, cost: 5 });
  assert.equal(await wh.getWarehouseQuantity(c.whA1, c.productLocalId, c.tenantId), 100);

  const pushSummary = await syncService.processSyncQueueCycle();
  assert.equal(pushSummary.skipped, false, JSON.stringify(pushSummary));

  const cloudRowBefore = await svc.from('stock_movements').select('id,device_id,quantity').eq('reference_id', referenceId).maybeSingle();
  assert.equal(cloudRowBefore.data?.device_id, c.deviceAId, 'a cloud grava o device_id do PRÓPRIO chamador (nunca aceite do payload)');
  assert.equal(Number(cloudRowBefore.data?.quantity), 100);

  // Nota (achado real desta etapa): stock_movements.cloud_id local NÃO é "ainda não
  // ligado" — applyWarehouseDelta auto-gera aí um UUID local em TODO movimento (é a
  // chave interna que costLayersForMovement usa para as camadas de custo FIFO de uma
  // transferência; nunca corresponde ao id real da cloud, que a RPC gera sempre por si
  // própria). Por isso o pull NUNCA escreve nesta coluna — a confirmação de "já
  // sincronizado" é só via stock_ledger_sync (verificado abaixo).
  const localBefore = await dbUtils.get(`SELECT id, cloud_id FROM stock_movements WHERE tenant_id = ? AND reference_id = ?`, [c.tenantId, referenceId]);
  assert.ok(localBefore.cloud_id, 'já tem o UUID local auto-gerado por applyWarehouseDelta (nunca o da cloud)');
  assert.notEqual(localBefore.cloud_id, cloudRowBefore.data.id, 'confirma que são identidades DIFERENTES por desenho — nunca comparar/ligar estes dois valores');

  const pullSummary = await syncService.processPullSyncCycle();
  assert.equal(pullSummary.reason, null, JSON.stringify(pullSummary));

  // NUNCA reaplicado: o saldo continua exactamente 100 (não 200).
  assert.equal(await wh.getWarehouseQuantity(c.whA1, c.productLocalId, c.tenantId), 100);

  const localAfter = await dbUtils.get(`SELECT id, cloud_id FROM stock_movements WHERE tenant_id = ? AND reference_id = ?`, [c.tenantId, referenceId]);
  assert.equal(localAfter.id, localBefore.id, 'é a MESMA linha local, não uma segunda');
  assert.equal(localAfter.cloud_id, localBefore.cloud_id, 'o pull nunca mexe nesta coluna para um movimento próprio');

  const ledgerSync = await dbUtils.get(`SELECT status FROM stock_ledger_sync WHERE movement_id = ?`, [localAfter.id]);
  assert.equal(ledgerSync?.status, 'synced', 'é assim que o pull confirma "já sincronizado" para um movimento próprio');

  const cloudRows = (await svc.from('warehouse_stock').select('warehouse_id,product_id,quantity').eq('store_id', c.storeA)).data;
  const rec = await led.computeReconciliation({ tenantId: c.tenantId, cloudRows });
  assert.equal(rec.divergent_count, 0, JSON.stringify(rec.divergent));
});

test('cenário obrigatório: 100 -> venda offline -5 (95) -> Backoffice +20 na cloud enquanto offline -> reconnect -> local=115, cloud=115, reconciliação=0', opts, async () => {
  assert.equal(await wh.getWarehouseQuantity(c.whA1, c.productLocalId, c.tenantId), 100, 'parte do estado convergido do teste anterior');

  // --- OFFLINE: venda local (nunca passa pelo ledger sync — 'sale' não é SYNCABLE) ---
  const saleRef = `SALE:offline-1g4:${c.productLocalId}`;
  await wh.applyWarehouseDelta({ tenantId: c.tenantId, warehouseId: c.whA1, productId: c.productLocalId, delta: -5, movementType: 'sale', referenceId: saleRef });
  assert.equal(await wh.getWarehouseQuantity(c.whA1, c.productLocalId, c.tenantId), 95, 'venda offline aplicada imediatamente ao stock local');

  // --- ENQUANTO OFFLINE: Backoffice lança +20 directamente na cloud (fixture) ---
  const boRef = `backoffice:1g4:${uuid()}`;
  await insertBackofficeMovement({ tenantId: c.tenantId, storeId: c.storeA, warehouseId: c.whA1, productCloudId: c.productCloudId, type: 'restock', quantity: 20, referenceId: boRef });
  assert.equal(await cloudWarehouseQty(c.whA1, c.productCloudId), 120, 'cloud reflecte só o +20 do Backoffice por agora (100 anterior + 20)');
  // Divergência genuína e esperada enquanto "offline": cloud=120, local=95.
  {
    const cloudRows = (await svc.from('warehouse_stock').select('warehouse_id,product_id,quantity').eq('store_id', c.storeA)).data;
    const rec = await led.computeReconciliation({ tenantId: c.tenantId, cloudRows });
    assert.equal(rec.divergent_count, 1);
    assert.equal(rec.divergent[0].diff, -25, 'local(95) - cloud(120) = -25, reportada, nada corrigido');
  }

  // --- RECONNECT: a venda offline sincroniza para a cloud (via a MESMA identidade de
  // deviceA, RPC real create_order_with_items — o caminho real de uma venda) ---
  const deviceAToken = await deviceAuthClient.getValidAccessToken({ userDataPath: c.userDataPath, issuerBaseUrl: E('ISSUER_URL') });
  assert.ok(deviceAToken, 'deviceA consegue um access token válido ao reconectar');
  const deviceAClient = createClient(E('SUPABASE_URL'), E('ANON_KEY'), { global: { headers: { Authorization: `Bearer ${deviceAToken}` } }, auth: { persistSession: false } });
  const sale = await deviceAClient.rpc('create_order_with_items', {
    order_data: { local_sale_id: `sale-1g4-${uuid()}`, total: 50, subtotal: 50, doc_type: 'VD', warehouse_id: c.whA1 },
    items: [{ product_id: c.productCloudId, product_name: 'Produto 1G4', quantity: 5, price: 10 }],
  });
  assert.equal(sale.error, null, JSON.stringify(sale.error));
  assert.equal(await cloudWarehouseQty(c.whA1, c.productCloudId), 115, 'cloud converge para 115 assim que a venda offline sincroniza (120 - 5)');

  // --- RECONNECT: pull aplica o +20 do Backoffice ao stock local exactamente uma vez ---
  const pullSummary = await syncService.processPullSyncCycle();
  assert.equal(pullSummary.reason, null, JSON.stringify(pullSummary));
  assert.equal(await wh.getWarehouseQuantity(c.whA1, c.productLocalId, c.tenantId), 115, 'local converge para 115 (95 + 20 do Backoffice)');

  const boLocal = await dbUtils.get(`SELECT id, movement_type, quantity FROM stock_movements WHERE tenant_id = ? AND reference_id = ?`, [c.tenantId, boRef]);
  assert.ok(boLocal, 'o movimento do Backoffice existe localmente após o pull');
  assert.equal(Number(boLocal.quantity), 20);
  const boLedgerSync = await dbUtils.get(`SELECT status FROM stock_ledger_sync WHERE movement_id = ?`, [boLocal.id]);
  assert.equal(boLedgerSync?.status, 'pulled', 'aplicado pelo caminho "device diferente/Backoffice", não pelo caminho "próprio"');

  const cloudRows = (await svc.from('warehouse_stock').select('warehouse_id,product_id,quantity').eq('store_id', c.storeA)).data;
  const rec = await led.computeReconciliation({ tenantId: c.tenantId, cloudRows });
  assert.equal(rec.divergent_count, 0, JSON.stringify(rec.divergent));
});

test('retry/duplicado: repetir o pull (cursor rebobinado) nunca duplica stock nem linhas locais', opts, async () => {
  const before = await wh.getWarehouseQuantity(c.whA1, c.productLocalId, c.tenantId);
  const countBefore = (await dbUtils.get(`SELECT COUNT(*) AS n FROM stock_movements WHERE tenant_id = ?`, [c.tenantId])).n;

  // Rebobina o cursor do pull de stock_movements para antes de tudo — simula um
  // restart que perdeu o cursor em memória, ou um retry do mesmo ciclo.
  await dbUtils.run(`UPDATE sync_state SET last_sync_at = '1970-01-01T00:00:00.000Z' WHERE id = ?`, [`cloud:stock_movements:${c.tenantId}`]);

  const pullSummary = await syncService.processPullSyncCycle();
  assert.equal(pullSummary.reason, null, JSON.stringify(pullSummary));

  assert.equal(await wh.getWarehouseQuantity(c.whA1, c.productLocalId, c.tenantId), before, 'retry do pull nunca reaplica nem duplica');
  const countAfter = (await dbUtils.get(`SELECT COUNT(*) AS n FROM stock_movements WHERE tenant_id = ?`, [c.tenantId])).n;
  assert.equal(countAfter, countBefore, 'nenhuma linha local nova (UNIQUE(cloud_id) protege o "device diferente"; a mesma linha é reencontrada no caso "próprio")');
});

test('movimento de OUTRO Device (mesma Store): aplica exactamente uma vez', opts, async () => {
  const before = await wh.getWarehouseQuantity(c.whA1, c.productLocalId, c.tenantId);
  const ref = `r-1g4-deviceB-${uuid()}`;
  const r = await c.deviceB.client.rpc('sync_stock_movements', {
    p_groups: [[{ reference_id: ref, type: 'restock', quantity: 7, product_id: c.productCloudId, warehouse_id: c.whA1, created_at: new Date().toISOString() }]],
  });
  assert.equal(r.error, null, JSON.stringify(r.error));
  assert.equal(r.data?.[0]?.out_status, 'inserted');
  const cloudRow = await svc.from('stock_movements').select('device_id').eq('reference_id', ref).maybeSingle();
  assert.equal(cloudRow.data.device_id, c.deviceB.deviceId, 'a cloud grava o device_id de quem chamou (deviceB), nunca o de A');

  await syncService.processPullSyncCycle();
  assert.equal(await wh.getWarehouseQuantity(c.whA1, c.productLocalId, c.tenantId), before + 7);

  const local = await dbUtils.get(`SELECT id FROM stock_movements WHERE tenant_id = ? AND reference_id = ?`, [c.tenantId, ref]);
  const ledgerSync = await dbUtils.get(`SELECT status FROM stock_ledger_sync WHERE movement_id = ?`, [local.id]);
  assert.equal(ledgerSync?.status, 'pulled', 'aplicado pelo caminho "device diferente", nunca pelo caminho "próprio"');
});

test('Warehouse/Store errada nunca aplica: movimento de outra Store nunca toca no stock local', opts, async () => {
  const before = await wh.getWarehouseQuantity(c.whA1, c.productLocalId, c.tenantId);

  // Produto próprio de X (nunca existe localmente em A) — reforça que o isolamento
  // também protege por produto, não só por armazém.
  const productX = uuid();
  await svc.from('products').insert({ id: productX, tenant_id: c.tenantId, name: 'Produto X 1G4', price: 1 });

  const ref = `backoffice:1g4-storeX:${uuid()}`;
  await insertBackofficeMovement({ tenantId: c.tenantId, storeId: c.storeX, warehouseId: c.whX1, productCloudId: productX, type: 'restock', quantity: 999, referenceId: ref });

  await syncService.processPullSyncCycle();

  assert.equal(await wh.getWarehouseQuantity(c.whA1, c.productLocalId, c.tenantId), before, 'stock de A nunca é tocado por um movimento de X');
  const localCount = await dbUtils.get(`SELECT COUNT(*) AS n FROM stock_movements WHERE tenant_id = ? AND reference_id = ?`, [c.tenantId, ref]);
  assert.equal(Number(localCount.n), 0, 'o movimento de X nunca é gravado localmente em A (o armazém de X não existe no SQLite de A)');
});

test('transferência Warehouse->Warehouse originada no Backoffice: aplica os dois lados exactamente uma vez', opts, async () => {
  const before1 = await wh.getWarehouseQuantity(c.whA1, c.productLocalId, c.tenantId);
  const before2 = await wh.getWarehouseQuantity(c.whA2, c.productLocalId, c.tenantId);
  const pairRef = `backoffice-transfer:1g4:${uuid()}`;
  await insertBackofficeMovement({ tenantId: c.tenantId, storeId: c.storeA, warehouseId: c.whA1, productCloudId: c.productCloudId, type: 'transfer_out', quantity: -3, referenceId: `${pairRef}:out` });
  await insertBackofficeMovement({ tenantId: c.tenantId, storeId: c.storeA, warehouseId: c.whA2, productCloudId: c.productCloudId, type: 'transfer_in', quantity: 3, referenceId: `${pairRef}:in` });

  await syncService.processPullSyncCycle();

  assert.equal(await wh.getWarehouseQuantity(c.whA1, c.productLocalId, c.tenantId), before1 - 3);
  assert.equal(await wh.getWarehouseQuantity(c.whA2, c.productLocalId, c.tenantId), before2 + 3);

  // Repetir o pull (mesmo cursor já avançado, nada de novo) não duplica.
  await syncService.processPullSyncCycle();
  assert.equal(await wh.getWarehouseQuantity(c.whA1, c.productLocalId, c.tenantId), before1 - 3);
  assert.equal(await wh.getWarehouseQuantity(c.whA2, c.productLocalId, c.tenantId), before2 + 3);
});
