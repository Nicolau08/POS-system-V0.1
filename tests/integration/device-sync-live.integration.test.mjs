/**
 * Integração REAL (Etapa 1F.2, item 34) — o api/syncService.js REAL, com o
 * cliente Supabase por device REAL (api/deviceAuth/deviceSupabaseClient.js,
 * NÃO mockado), a ponte REAL (electron/deviceAuth/deviceAuthBridge.js) e o
 * DeviceAuthClient REAL, todos a falar com um license-console real e um
 * Postgres real (supabase/). Só o módulo nativo `electron` (safeStorage)
 * é mockado — inevitável fora do runtime Electron real.
 *
 * Prova produto push+pull, customer push+pull, user via RPC, venda via RPC,
 * orders pull, stock pull — todos através do Device JWT real, nunca
 * SUPABASE_SERVICE_ROLE_KEY (que nem é lido pelo cliente por device).
 *
 * Requer env: POSLY_1F2_ISSUER_URL, POSLY_1F2_ACTIVATION_TOKEN,
 *   POSLY_1F2_SUPABASE_URL, POSLY_1F2_SUPABASE_ANON_KEY,
 *   POSLY_1F2_SUPABASE_SERVICE_ROLE_KEY (só para SEMEAR/VERIFICAR dados de
 *   teste como um observador externo — nunca usado pelo caminho do device),
 *   POSLY_1F2_TENANT_ID, POSLY_1F2_LICENSE_ID.
 * Sem eles, os testes são saltados — nunca falham a correr no CI normal.
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, mock } from 'node:test';
import { createClient } from '@supabase/supabase-js';

const ISSUER_URL = process.env.POSLY_1F2_ISSUER_URL || '';
const ACTIVATION_TOKEN = process.env.POSLY_1F2_ACTIVATION_TOKEN || '';
const SUPABASE_URL = process.env.POSLY_1F2_SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.POSLY_1F2_SUPABASE_ANON_KEY || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.POSLY_1F2_SUPABASE_SERVICE_ROLE_KEY || '';
const TENANT_ID = process.env.POSLY_1F2_TENANT_ID || '';
const LICENSE_ID = process.env.POSLY_1F2_LICENSE_ID || '';
const shouldRun = Boolean(ISSUER_URL && ACTIVATION_TOKEN && SUPABASE_URL && SUPABASE_ANON_KEY && SUPABASE_SERVICE_ROLE_KEY);

mock.module('electron', {
  exports: {
    safeStorage: {
      isEncryptionAvailable: () => true,
      encryptString: (s) => Buffer.concat([Buffer.from('FAKEENC:'), Buffer.from(s, 'utf8')]),
      decryptString: (b) => Buffer.from(b).subarray(8).toString('utf8'),
    },
  },
});

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'posly-1f2-live-'));
process.env.POS_DB_PATH = path.join(tmpDir, 'pos-test.db');
process.env.DEFAULT_TENANT_ID = TENANT_ID;
process.env.SUPABASE_URL = SUPABASE_URL;
process.env.SUPABASE_ANON_KEY = SUPABASE_ANON_KEY;
delete process.env.SUPABASE_SERVICE_ROLE_KEY; // nunca visível ao caminho do device.

test(
  'Sync real via Device JWT: bootstrap real, ponte real, e produto/categoria/cliente/utilizador/venda contra Postgres real',
  { skip: !shouldRun && 'defina POSLY_1F2_* para correr a integração real' },
  async () => {
    // Cliente de VERIFICAÇÃO/SEMEADURA — externo ao caminho do device, nunca
    // usado por syncService.js (esse só conhece SUPABASE_ANON_KEY, acima).
    const adminSupabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { startDeviceAuthBridge, stopDeviceAuthBridge } = await import('../../electron/deviceAuth/deviceAuthBridge.js');
    const { bootstrapDevice } = await import('../../electron/deviceAuth/deviceAuthClient.js');

    const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'posly-1f2-live-electron-'));
    const boot = await bootstrapDevice({
      activationToken: ACTIVATION_TOKEN,
      machineId: 'machine-1f2-live',
      userDataPath,
      issuerBaseUrl: ISSUER_URL,
    });
    assert.equal(boot.ok, true, `bootstrap real falhou: ${JSON.stringify(boot)}`);

    const bridge = await startDeviceAuthBridge({ userDataPath, issuerBaseUrl: ISSUER_URL });
    // Etapa 1G.4 (Fase 1 do Backoffice): o pull de stock_movements exige saber a própria
    // identidade de Device (fail closed sem isto) — exactamente como electron/main.js
    // fornece ao processo API real, via a mesma identidade Device Auth do bootstrap acima.
    process.env.POS_DEVICE_ID = boot.deviceId;
    process.env.POS_DEVICE_AUTH_BRIDGE_URL = bridge.url;
    process.env.POS_DEVICE_AUTH_BRIDGE_SECRET = bridge.secret;

    const { run: dbRun, get: dbGet } = await import('../../api/dbUtils.js');
    const { processPullSyncCycle, processSyncQueueCycle, processFullSyncCycle } = await import(
      '../../api/syncService.js'
    );

    try {
      // --- PUSH: produto (queue) -----------------------------------------
      const now = new Date().toISOString();
      const productCloudId = crypto.randomUUID();
      await dbRun(
        `INSERT INTO sync_queue (tenant_id, type, data, status, retries, created_at, updated_at) VALUES (?, 'product', ?, 'pending', 0, ?, ?)`,
        [TENANT_ID, JSON.stringify({ tenant_id: TENANT_ID, id: 1, cloud_id: productCloudId, name: 'Produto Real', price: 50, deleted: false }), now, now],
      );
      const pushProductSummary = await processSyncQueueCycle();
      assert.equal(pushProductSummary.skipped, false, JSON.stringify(pushProductSummary));

      const { data: realProduct, error: realProductErr } = await adminSupabase
        .from('products')
        .select('id,name,tenant_id,deleted')
        .eq('id', productCloudId)
        .maybeSingle();
      assert.equal(realProductErr, null);
      assert.ok(realProduct, 'produto tem de existir REALMENTE no Postgres');
      assert.equal(realProduct.tenant_id, TENANT_ID);
      assert.equal(realProduct.deleted, false, 'deleted tem de ser boolean real, não 0/1');

      // --- PUSH: customer (queue) -----------------------------------------
      const customerCloudId = crypto.randomUUID();
      await dbRun(
        `INSERT INTO sync_queue (tenant_id, type, data, status, retries, created_at, updated_at) VALUES (?, 'customer', ?, 'pending', 0, ?, ?)`,
        [TENANT_ID, JSON.stringify({ tenant_id: TENANT_ID, id: 1, cloud_id: customerCloudId, name: 'Cliente Real', phone: '841234567' }), now, now],
      );
      await processSyncQueueCycle();
      const { data: realCustomer } = await adminSupabase.from('customers').select('id,name').eq('id', customerCloudId).maybeSingle();
      assert.ok(realCustomer, 'cliente tem de existir REALMENTE no Postgres');

      // --- PUSH: user via RPC sync_upsert_user -----------------------------
      const userCloudId = crypto.randomUUID();
      const REAL_BCRYPT_HASH = '$2b$10$.XXsHStlG.5RpJ3/RhQqCe7MihEQQlS4Wb31Tvtnyu8jyUI5NwoP6';
      await dbRun(
        `INSERT INTO users (id, name, role, pin, access_level, active, tenant_id, cloud_id, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)`,
        ['cashier-live-1', 'Caixa Real', 'cashier', REAL_BCRYPT_HASH, 1, TENANT_ID, userCloudId, now],
      );
      // Semear a cloud com o MESMO id/timestamp — senão processFullSyncCycle
      // faz PULL antes do push e a reconciliação de deleções do pull (lógica
      // pré-existente, não tocada por 1F.2) apagaria o utilizador local por
      // "já não existir na cloud" antes do push correr.
      const { error: seedUserErr } = await adminSupabase.from('users').insert({
        id: userCloudId,
        tenant_id: TENANT_ID,
        name: 'Caixa Real',
        role: 'cashier',
        access_level: 1,
        pin_hash: REAL_BCRYPT_HASH,
        active: true,
        updated_at: now,
      });
      assert.equal(seedUserErr, null);
      await processFullSyncCycle();
      const { data: realUser } = await adminSupabase.from('users').select('id,pin_hash,tenant_id').eq('id', userCloudId).maybeSingle();
      assert.ok(realUser, 'utilizador tem de existir REALMENTE no Postgres (via RPC, nunca upsert directo)');
      assert.equal(realUser.pin_hash, REAL_BCRYPT_HASH);
      assert.equal(realUser.tenant_id, TENANT_ID);

      // --- PUSH: venda via create_order_with_items -------------------------
      const localSaleId = `live-sale-${crypto.randomUUID()}`;
      await dbRun(
        `INSERT INTO sync_queue (tenant_id, type, data, status, retries, created_at, updated_at) VALUES (?, 'sale', ?, 'pending', 0, ?, ?)`,
        [
          TENANT_ID,
          JSON.stringify({
            tenant_id: TENANT_ID,
            local_sale_id: localSaleId,
            total: 50,
            // docType real (a RPC só atribui document_number quando doc_type
            // vem preenchido — ver 20260915000700_sales.sql) — necessário para
            // o pull de orders a seguir encontrar a linha (syncOrdersFromCloud
            // ignora explicitamente orders sem document_number, lógica
            // pré-existente não tocada por 1F.2). Uso 'FT' (não 'VD') porque o
            // ramo 'VD' do pull espera um formato "LETRAS/ANO/SEQ" por regex
            // (incompatibilidade JÁ CONHECIDA e documentada na migration
            // 20260915000700_sales.sql — a nova RPC gera só "ANO/SEQ", sem
            // prefixo de letras — fora do escopo de 1F.2 corrigir; o ramo
            // não-VD não tem essa exigência de formato).
            docType: 'FT',
            cart: [{ id: 1, cloud_id: productCloudId, name: 'Produto Real', quantity: 1, price: 50 }],
            saleTimestamp: now,
          }),
          now,
          now,
        ],
      );
      const saleSummary = await processSyncQueueCycle();
      assert.equal(saleSummary.skipped, false, JSON.stringify(saleSummary));
      const { data: realOrder } = await adminSupabase.from('orders').select('id,local_sale_id,tenant_id').eq('local_sale_id', localSaleId).maybeSingle();
      assert.ok(realOrder, 'venda tem de existir REALMENTE no Postgres via create_order_with_items');
      const { data: realStockMovement } = await adminSupabase
        .from('stock_movements')
        .select('id,type,quantity')
        .eq('reference_id', `order:${realOrder.id}`)
        .maybeSingle();
      assert.ok(realStockMovement, 'movimento de stock tem de existir REALMENTE (gerado pela RPC)');
      assert.equal(realStockMovement.type, 'sale');
      assert.equal(Number(realStockMovement.quantity), -1);

      // --- PULL: categoria + produto + cliente + orders + stock -----------
      const pullCategoryCloudId = crypto.randomUUID();
      const { error: catInsertErr } = await adminSupabase.from('categories').insert({
        id: pullCategoryCloudId,
        tenant_id: TENANT_ID,
        name: `Categoria Pull Real ${pullCategoryCloudId.slice(0, 8)}`,
      });
      assert.equal(catInsertErr, null);

      const pullSummary = await processPullSyncCycle();
      // Nota: em createPullSummary() `skipped` é um CONTADOR de linhas já
      // actualizadas (não um booleano "ciclo abortado" como em createSummary(),
      // usado pelo push) — um ciclo saudável confirma-se por skippedEntities
      // vazio (nenhuma tabela inteira foi ignorada) e reason nulo.
      assert.deepEqual(pullSummary.skippedEntities, [], JSON.stringify(pullSummary));
      assert.equal(pullSummary.reason, null, JSON.stringify(pullSummary));

      const localCategory = await dbGet(`SELECT id FROM categories WHERE cloud_id = ?`, [pullCategoryCloudId]);
      assert.ok(localCategory, 'categoria da cloud tem de aparecer localmente após pull real');

      const localOrder = await dbGet(`SELECT id, tenant_id FROM orders WHERE id = ?`, [realOrder.id]);
      assert.ok(localOrder, 'a venda pushed anteriormente tem de voltar via pull (SELECT tenant-scoped)');

      const localOrderItems = await dbGet(`SELECT COUNT(*) AS n FROM order_items WHERE order_id = ?`, [String(localOrder.id)]);
      assert.ok(Number(localOrderItems?.n ?? 0) >= 1, 'os items da venda também têm de vir via pull (order_items)');

      // Etapa 1G.4 (Fase 1 do Backoffice): comportamento CORRIGIDO e intencional — um
      // movimento 'sale' nunca é replicado localmente pelo pull de stock_movements.
      // Antes desta etapa o pull inseria cegamente QUALQUER linha (incluindo 'sale'),
      // criando uma segunda linha local (cloud_id preenchido, reference_id 'order:<id>')
      // que DUPLICAVA a linha já criada no momento da venda (reference_id
      // 'SALE:<local_sale_id>:<produto>') — inofensivo só porque o pull nunca tocava em
      // warehouse_stock/stock_quantity (no-op). Agora que o pull PASSA a aplicar stock
      // para movimentos que não são meus, 'sale' e 'opening' são explicitamente excluídos
      // dessa reconciliação (ver comentário em syncStockMovementsFromCloud): 'sale' já foi
      // reflectido localmente no momento da venda e reconciliado pelo pull de
      // orders/order_items (verificado acima); replicá-lo aqui duplicaria sem propósito.
      // Nota: esta venda foi semeada directamente em sync_queue (atalho deste teste, ver
      // acima) — nunca passou por sales.service.js/createSale, então não existe (nem devia
      // existir) nenhuma linha local 'SALE:<...>' anterior ao pull. A única forma de uma
      // linha 'sale' aparecer em stock_movements local seria o pull a criá-la — o que
      // agora, por desenho, nunca acontece.
      const localStockMovement = await dbGet(`SELECT id FROM stock_movements WHERE cloud_id = ?`, [realStockMovement.id]);
      assert.equal(localStockMovement, null, 'pull nunca replica um movimento "sale" localmente (excluído por desenho — ver Fase 1 do Backoffice)');
      const ownSaleMovements = await dbGet(
        `SELECT COUNT(*) AS n FROM stock_movements WHERE tenant_id = ? AND product_id = 1 AND movement_type = 'sale'`,
        [TENANT_ID]
      );
      assert.equal(Number(ownSaleMovements?.n ?? 0), 0, 'nenhuma linha "sale" é criada localmente por este teste nem pelo pull');
    } finally {
      stopDeviceAuthBridge();
      delete process.env.POS_DEVICE_AUTH_BRIDGE_URL;
      delete process.env.POS_DEVICE_AUTH_BRIDGE_SECRET;
      delete process.env.POS_DEVICE_ID;
      // best-effort: o ficheiro SQLite pode continuar brevemente bloqueado no
      // Windows — nunca deixar isso mascarar uma falha real das assertions acima.
      try {
        fs.rmSync(userDataPath, { recursive: true, force: true });
      } catch {
        // ignore
      }
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
  },
);
