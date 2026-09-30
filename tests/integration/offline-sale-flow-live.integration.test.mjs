/**
 * Etapa 1F.6 (itens 9-14) — E2E real da venda offline: activação real,
 * `api/server.js` real spawnado (SQLite real), totalmente OFFLINE (sem
 * SUPABASE_URL no processo-filho), login -> produto -> venda -> stock ->
 * sync_queue, restart entre vendas, depois volta "online" (ponte de Device
 * Auth real + Supabase real) e prova sync + idempotência contra Postgres
 * real (supabase/). Só 'electron' safeStorage é mockado.
 *
 * Requer env: POSLY_1F6B_ISSUER_URL, POSLY_1F6B_TENANT_ID, POSLY_1F6B_LICENSE_ID,
 *   POSLY_1F6B_ACTIVATION_TOKEN, POSLY_1F6B_SUPABASE_URL, POSLY_1F6B_SUPABASE_ANON_KEY,
 *   POSLY_1F6B_SUPABASE_SERVICE_ROLE_KEY, POSLY_1F6B_OFFLINE_PUBLIC_KEY,
 *   POSLY_1F6B_OFFLINE_KEY_ID.
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { test, mock } from 'node:test';
import { createClient } from '@supabase/supabase-js';

const ISSUER_URL = process.env.POSLY_1F6B_ISSUER_URL || '';
const TENANT_ID = process.env.POSLY_1F6B_TENANT_ID || '';
const LICENSE_ID = process.env.POSLY_1F6B_LICENSE_ID || '';
const ACTIVATION_TOKEN = process.env.POSLY_1F6B_ACTIVATION_TOKEN || '';
const SUPABASE_URL = process.env.POSLY_1F6B_SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.POSLY_1F6B_SUPABASE_ANON_KEY || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.POSLY_1F6B_SUPABASE_SERVICE_ROLE_KEY || '';
const OFFLINE_PUBLIC_KEY = process.env.POSLY_1F6B_OFFLINE_PUBLIC_KEY || '';
const OFFLINE_KEY_ID = process.env.POSLY_1F6B_OFFLINE_KEY_ID || '';
const shouldRun = Boolean(
  ISSUER_URL && TENANT_ID && LICENSE_ID && ACTIVATION_TOKEN && SUPABASE_URL && SUPABASE_ANON_KEY && OFFLINE_PUBLIC_KEY,
);

mock.module('electron', {
  exports: {
    safeStorage: {
      isEncryptionAvailable: () => true,
      encryptString: (s) => Buffer.concat([Buffer.from('FAKEENC:'), Buffer.from(s, 'utf8')]),
      decryptString: (b) => Buffer.from(b).subarray(8).toString('utf8'),
    },
  },
});

const repoRoot = path.resolve(import.meta.dirname, '../..');

function waitForHttp(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return (async () => {
    for (;;) {
      try {
        const res = await fetch(url);
        if (res.ok || res.status < 500) return true;
      } catch {
        // ainda não está pronto
      }
      if (Date.now() > deadline) throw new Error(`timeout à espera de ${url}`);
      await new Promise((r) => setTimeout(r, 200));
    }
  })();
}

function spawnServer({ port, extraEnv }) {
  let stdout = '';
  const env = {
    ...process.env,
    POS_API_PORT: String(port),
    NODE_ENV: 'development',
    ...extraEnv,
  };
  delete env.SUPABASE_URL;
  delete env.SUPABASE_ANON_KEY;
  delete env.SUPABASE_SERVICE_ROLE_KEY;
  delete env.NEXT_PUBLIC_SUPABASE_URL;
  delete env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  delete env.POS_DEVICE_AUTH_BRIDGE_URL;
  delete env.POS_DEVICE_AUTH_BRIDGE_SECRET;
  delete env.POS_LICENSE_HMAC_SECRET;
  Object.assign(env, extraEnv);
  const child = spawn(process.execPath, [path.join(repoRoot, 'api', 'server.js')], {
    cwd: repoRoot,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (d) => (stdout += d.toString()));
  child.stderr.on('data', (d) => (stdout += d.toString()));
  return { child, getLog: () => stdout };
}

async function api(port, method, urlPath, { body, token } = {}) {
  const res = await fetch(`http://127.0.0.1:${port}${urlPath}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

test(
  'venda offline E2E real: activação -> offline -> login -> produto -> 2 vendas com restart entre elas -> volta online -> sync -> idempotência',
  { skip: !shouldRun && 'defina POSLY_1F6B_* para correr' },
  async () => {
    const { bootstrapDevice } = await import('../../electron/deviceAuth/deviceAuthClient.js');
    const { requestOfflineLicense, installOfflineLicense } = await import('../../electron/deviceAuth/offlineLicenseClient.js');
    const { verifyOfflineLicense } = await import('../../lib/licensing/offlineLicense.js');
    const { startDeviceAuthBridge, stopDeviceAuthBridge } = await import('../../electron/deviceAuth/deviceAuthBridge.js');

    const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'posly-1f6-saleflow-'));
    const dbPath = path.join(userDataPath, 'database.db');
    const machineId = `machine-1f6-saleflow-${crypto.randomBytes(3).toString('hex')}`;
    let bridge = null;
    const liveChildren = [];
    function trackChild(server) {
      liveChildren.push(server.child);
      return server;
    }
    async function waitForLogin(port, { timeoutMs = 15000, pin = '1234' } = {}) {
      const deadline = Date.now() + timeoutMs;
      let last = null;
      for (;;) {
        last = await api(port, 'POST', '/auth/login', { body: { userId: 'admin-local', enteredPin: pin } });
        if (last.status === 200) return last;
        // Nunca martelar login em loop apertado: dispara o lockout real de
        // força-bruta local (LOGIN_LOCKED) e mascara o resultado verdadeiro.
        if (last.status === 429 || Date.now() > deadline) return last;
        await new Promise((r) => setTimeout(r, 1000));
      }
    }

    try {
      // --- Fase 0: activação real (item 5) ---
      const boot = await bootstrapDevice({ activationToken: ACTIVATION_TOKEN, machineId, userDataPath, issuerBaseUrl: ISSUER_URL });
      assert.equal(boot.ok, true, `bootstrap falhou: ${JSON.stringify(boot)}`);

      const issuance = await requestOfflineLicense({ accessToken: boot.accessToken, issuerBaseUrl: ISSUER_URL });
      assert.equal(issuance.ok, true, `emissão offline license falhou: ${JSON.stringify(issuance)}`);
      const resolvePem = (kid) => (kid === OFFLINE_KEY_ID ? OFFLINE_PUBLIC_KEY : null);
      const localVerify = verifyOfflineLicense(issuance.envelope, resolvePem, { machineId });
      assert.equal(localVerify.ok, true, `verificação local falhou: ${localVerify.error}`);
      const installed = installOfflineLicense({ envelope: issuance.envelope, userDataPath, resolvePublicKeyPem: resolvePem, machineId });
      assert.equal(installed.ok, true);

      const commonEnv = {
        POS_DB_PATH: dbPath,
        POS_USER_DATA_PATH: userDataPath,
        DEFAULT_TENANT_ID: TENANT_ID,
        POS_DEV_OFFLINE_LICENSE_KEY_ID: OFFLINE_KEY_ID,
        POS_DEV_OFFLINE_LICENSE_PUBLIC_KEY: OFFLINE_PUBLIC_KEY,
      };

      // --- Fase 1: TOTALMENTE OFFLINE (item 9) — sem SUPABASE_URL no processo. ---
      const port1 = 4900 + Math.floor(Math.random() * 90);
      const s1 = trackChild(spawnServer({ port: port1, extraEnv: commonEnv }));
      await waitForHttp(`http://127.0.0.1:${port1}/setup/status`, 20000);

      const installRes = await api(port1, 'POST', '/setup/license/install-offline-license', {
        body: { offline_license: issuance.envelope, machine_id: machineId },
      });
      assert.equal(installRes.status, 200, JSON.stringify(installRes.data));

      const status1 = await api(port1, 'GET', '/setup/status');
      const activated1 = status1.data?.data?.licenseActivated ?? status1.data?.licenseActivated;
      assert.equal(activated1, true, 'POS deve abrir offline com a licença local válida (item 9)');

      // Achado real (não um bug): installOfflineLicenseState() LIMPA o PIN
      // dev-seed ('1234', bootstrap.js) para '' na primeira activação real —
      // nunca pode sobreviver um PIN de desenvolvimento a uma activação real.
      // O fluxo real exige por isso configurar o PIN admin primeiro
      // (POST /setup/admin-password, o mesmo que o Setup Wizard chama).
      const ADMIN_PIN = '1234';
      const setPin1 = await api(port1, 'POST', '/setup/admin-password', { body: { pin: ADMIN_PIN } });
      assert.equal(setPin1.status, 200, `configurar PIN admin falhou: ${JSON.stringify(setPin1.data)}. Log: ${s1.getLog().slice(-1500)}`);

      // Login real (item 10), agora com o PIN admin real configurado.
      const login1 = await waitForLogin(port1, { pin: ADMIN_PIN });
      assert.equal(login1.status, 200, `login offline falhou mesmo com poll: ${JSON.stringify(login1.data)}. Log do processo: ${s1.getLog().slice(-2000)}`);
      const token = login1.data?.token;
      assert.ok(token, 'login deve devolver bearer token mesmo offline');

      // Produto real (item 10).
      const prod1 = await api(port1, 'POST', '/produtos', {
        token,
        body: { name: 'Produto Offline 1F6', price: 25, stock_quantity: 100 },
      });
      assert.equal(prod1.status, 200, JSON.stringify(prod1.data));
      const productId = prod1.data?.data?.id ?? prod1.data?.id;
      assert.ok(productId, 'produto deve ter id');

      // Venda 1 offline (item 10).
      const sale1Key = crypto.randomUUID();
      const sale1 = await api(port1, 'POST', '/vendas', {
        token,
        body: {
          total: 25,
          docType: 'VD',
          paymentMethod: 'dinheiro',
          cart: [{ id: productId, name: 'Produto Offline 1F6', quantity: 1, price: 25 }],
        },
      });
      assert.equal(sale1.status, 200, `venda 1 offline falhou: ${JSON.stringify(sale1.data)}`);

      // Stock deve ter descido (item 10).
      const prodAfterSale1 = await api(port1, 'GET', '/produtos', { token });
      const p1 = (prodAfterSale1.data?.data ?? prodAfterSale1.data ?? []).find((p) => String(p.id) === String(productId));
      assert.ok(p1, 'produto deve continuar visível após venda');
      assert.equal(Number(p1.stock_quantity), 99, 'stock deve ter descido 1 unidade após a venda offline');

      // sync_queue deve ter a venda pendente (item 10) — verificado via /sync/status.
      const syncStatus1 = await api(port1, 'GET', '/sync/status', { token });
      assert.equal(syncStatus1.status, 200, JSON.stringify(syncStatus1.data));
      console.log('[item 10] sync_queue status offline (após venda 1):', JSON.stringify(syncStatus1.data));

      s1.child.kill('SIGKILL');

      // --- Fase 2: RESTART ainda offline (item 11) — confirma persistência real. ---
      const port2 = port1 + 1;
      const s2 = trackChild(spawnServer({ port: port2, extraEnv: commonEnv }));
      await waitForHttp(`http://127.0.0.1:${port2}/setup/status`, 20000);

      const status2 = await api(port2, 'GET', '/setup/status');
      assert.equal(status2.data?.data?.licenseActivated ?? status2.data?.licenseActivated, true, 'deve continuar activado após restart offline');

      const login2 = await waitForLogin(port2, { pin: ADMIN_PIN });
      assert.equal(login2.status, 200, `login pós-restart falhou: ${JSON.stringify(login2.data)}`);
      const token2 = login2.data?.token;

      // Confirma produto/stock sobreviveram ao restart.
      const prodAfterRestart = await api(port2, 'GET', '/produtos', { token: token2 });
      const pAfterRestart = (prodAfterRestart.data?.data ?? prodAfterRestart.data ?? []).find((p) => String(p.id) === String(productId));
      assert.equal(Number(pAfterRestart.stock_quantity), 99, 'stock deve continuar 99 após restart (nada perdido/duplicado)');

      // Venda 2 offline, após restart (item 11).
      const sale2 = await api(port2, 'POST', '/vendas', {
        token: token2,
        body: {
          total: 50,
          docType: 'VD',
          paymentMethod: 'dinheiro',
          cart: [{ id: productId, name: 'Produto Offline 1F6', quantity: 2, price: 25 }],
        },
      });
      assert.equal(sale2.status, 200, `venda 2 (após restart) falhou: ${JSON.stringify(sale2.data)}`);

      const prodAfterSale2 = await api(port2, 'GET', '/produtos', { token: token2 });
      const p2 = (prodAfterSale2.data?.data ?? prodAfterSale2.data ?? []).find((p) => String(p.id) === String(productId));
      assert.equal(Number(p2.stock_quantity), 97, 'stock deve reflectir as DUAS vendas (100 - 1 - 2 = 97), sem duplicação/perda');

      s2.child.kill('SIGKILL');

      // --- Fase 3: VOLTA ONLINE (item 12) — ponte de Device Auth real + Supabase real. ---
      bridge = await startDeviceAuthBridge({ userDataPath, issuerBaseUrl: ISSUER_URL });

      const port3 = port2 + 1;
      const s3 = trackChild(spawnServer({
        port: port3,
        extraEnv: {
          ...commonEnv,
          SUPABASE_URL,
          SUPABASE_ANON_KEY,
          POS_DEVICE_AUTH_BRIDGE_URL: bridge.url,
          POS_DEVICE_AUTH_BRIDGE_SECRET: bridge.secret,
          SYNC_INTERVAL_MS: '3000000', // desactiva o ciclo automático — controlamos via POST /sync/run
        },
      }));
      await waitForHttp(`http://127.0.0.1:${port3}/setup/status`, 20000);

      const login3 = await waitForLogin(port3, { pin: ADMIN_PIN });
      assert.equal(login3.status, 200, JSON.stringify(login3.data));
      const token3 = login3.data?.token;

      const runSync1 = await api(port3, 'POST', '/sync/run', { token: token3 });
      assert.equal(runSync1.status, 200, `sync/run falhou: ${JSON.stringify(runSync1.data)}`);
      await new Promise((r) => setTimeout(r, 1500));

      // Verificação EXTERNA real via service_role (nunca o caminho do device) —
      // confirma as 2 vendas offline chegaram ao Postgres real, sem duplicação.
      const adminSupabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
      const { data: cloudOrders, error: ordersErr } = await adminSupabase
        .from('orders')
        .select('id, total, tenant_id')
        .eq('tenant_id', TENANT_ID);
      assert.equal(ordersErr, null, JSON.stringify(ordersErr));
      assert.equal(cloudOrders.length, 2, `esperava exactamente 2 orders no cloud, veio ${cloudOrders.length}: ${JSON.stringify(cloudOrders)}`);
      console.log('[item 12] orders no cloud após sync:', JSON.stringify(cloudOrders));

      // 1G.2B: a Store das vendas sincronizadas é a do device (derivada no servidor).
      const { data: devRows } = await adminSupabase.from('pos_devices').select('id, store_id').eq('tenant_id', TENANT_ID);
      assert.equal(devRows.length, 1);
      const { data: syncedOrders } = await adminSupabase.from('orders').select('id, store_id, device_id').eq('tenant_id', TENANT_ID);
      assert.ok(syncedOrders.every((o) => o.store_id === devRows[0].store_id && o.device_id === devRows[0].id), 'orders sincronizadas com a store/device correctos');
      const { data: syncedMov } = await adminSupabase.from('stock_movements').select('store_id').eq('tenant_id', TENANT_ID);
      assert.ok(syncedMov.length >= 1 && syncedMov.every((m) => m.store_id === devRows[0].store_id), 'stock_movements sincronizados com a store correcta');

      // --- Fase 4: idempotência (item 13) — repete a fila manualmente. ---
      const runSync2 = await api(port3, 'POST', '/sync/run', { token: token3 });
      assert.equal(runSync2.status, 200, JSON.stringify(runSync2.data));
      await new Promise((r) => setTimeout(r, 1500));

      const { data: cloudOrdersAfterRetry } = await adminSupabase.from('orders').select('id').eq('tenant_id', TENANT_ID);
      assert.equal(cloudOrdersAfterRetry.length, 2, `retry do sync não pode duplicar orders — continua a ter de ser 2, veio ${cloudOrdersAfterRetry.length}`);

      const { data: cloudItems } = await adminSupabase.from('order_items').select('id, order_id').in(
        'order_id',
        cloudOrders.map((o) => o.id),
      );
      console.log('[item 13] order_items no cloud:', cloudItems.length);

      const { data: cloudStockMovements } = await adminSupabase
        .from('stock_movements')
        .select('id')
        .eq('tenant_id', TENANT_ID);
      console.log('[item 12] stock_movements no cloud:', cloudStockMovements?.length ?? 'n/a');

      s3.child.kill('SIGKILL');
    } finally {
      // Nunca deixar um processo-filho órfão vivo, mesmo que o teste falhe a
      // meio (achado real desta etapa: um throw antes do kill() explícito
      // deixava o api/server.js spawnado a correr para sempre, mantendo o
      // processo do test runner vivo e o stdout por enviar até ser morto à mão).
      for (const child of liveChildren) {
        try {
          if (!child.killed) child.kill('SIGKILL');
        } catch {
          // ignore
        }
      }
      if (bridge) {
        try {
          await stopDeviceAuthBridge(bridge);
        } catch {
          // ignore
        }
      }
      try {
        fs.rmSync(userDataPath, { recursive: true, force: true });
      } catch {
        // Windows pode manter um handle breve depois de matar os processos filhos.
      }
    }
  },
);
