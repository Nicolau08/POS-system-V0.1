/**
 * Pilot Gate offline (achado real): a Loja Piloto fez 3 vendas VD offline
 * (SALE_CREATE + STOCK_CHANGE auditados para as 3), mas a UI mostrava
 * "Pending = 0" — não porque a fila estivesse vazia, mas porque
 * hooks/useSyncStatus.ts nunca chegava a chamar GET /sync/status enquanto
 * navigator.onLine=false (early-return antes do fetch). GET /sync/status é
 * sempre uma leitura LOCAL (loopback, autenticada) — nunca depende de
 * Internet — por isso "offline" nunca devia impedir esta leitura, só a
 * sincronização real com a cloud.
 *
 * Este ficheiro não tem infra de testes de React (sem jsdom/testing-library
 * neste projecto) — por isso a regressão é coberta em duas frentes,
 * proporcionais ao fix mínimo:
 * 1) uma guarda ao nível do código-fonte: fetchStatus() nunca mais pode
 *    saltar o fetch com base em navigator.onLine (isto sozinho prova que o
 *    hook volta a pedir o estado real mesmo offline);
 * 2) um teste real do endpoint que o hook chama (GET /sync/status,
 *    getSyncStatus): confirma que "pending" vem sempre da BD local
 *    (sync_queue), nunca de uma suposição, e SEM configurar cloud/Supabase
 *    — ou seja, sem qualquer chamada de rede/sync neste teste.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, before } from 'node:test';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'posly-sync-status-offline-'));
process.env.POS_DB_PATH = path.join(tmpDir, 'database.db');
process.env.DEFAULT_TENANT_ID = 'tenant-sync-status-offline';
// Nunca configurar cloud neste teste — prova que "pending" nunca depende de
// rede/Supabase para ser lido correctamente.
delete process.env.SUPABASE_URL;
delete process.env.NEXT_PUBLIC_SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;

const T = 'tenant-sync-status-offline';
const db = (await import('../../api/database.js')).default;
const sales = await import('../../api/services/sales.service.js');
const { getSyncStatus } = await import('../../api/controllers/sync.controller.js');
const { isCloudSyncConfigured } = await import('../../api/syncService.js');

const allDb = (sql, params = []) => new Promise((res, rej) => db.all(sql, params, (e, r) => (e ? rej(e) : res(r))));

async function ready() {
  const deadline = Date.now() + 8000;
  for (;;) {
    try {
      await allDb('SELECT id FROM vendas LIMIT 1');
      await allDb('SELECT id FROM sync_queue LIMIT 1');
      return;
    } catch (e) {
      if (Date.now() > deadline) throw e;
      await new Promise((r) => setTimeout(r, 100));
    }
  }
}

function fakeRes() {
  const res = { statusCode: 200, body: null };
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (payload) => {
    res.body = payload;
    return res;
  };
  return res;
}

const actor = { id: 'op-sync-status', name: 'Operador Teste', tenant_id: T };

before(async () => {
  await ready();
});

test('regressão de código: fetchStatus() nunca mais salta o fetch por causa de navigator.onLine', () => {
  const source = fs.readFileSync(new URL('../../hooks/useSyncStatus.ts', import.meta.url), 'utf8');
  const start = source.indexOf('const fetchStatus = useCallback(async () => {');
  assert.ok(start >= 0, 'fetchStatus não encontrado — o ficheiro mudou de forma inesperada');
  const end = source.indexOf('}, []);', start);
  const fetchStatusBody = source.slice(start, end);
  const codeOnly = fetchStatusBody
    .split('\n')
    .map((line) => line.replace(/\/\/.*/, ''))
    .join('\n');
  assert.ok(
    !/navigator\.onLine/.test(codeOnly),
    'REGRESSÃO: fetchStatus() voltou a depender de navigator.onLine antes de chamar /sync/status — isto congela "pending" enquanto a loja estiver offline',
  );
  assert.match(
    fetchStatusBody,
    /getPosApiBase\(\)\}\/sync\/status/,
    'fetchStatus() deve continuar a chamar o endpoint local autenticado /sync/status',
  );
  assert.match(
    fetchStatusBody,
    /getPosUserAuthHeaders\(\)/,
    'fetchStatus() deve continuar a usar o caminho de autenticação existente do POS (nunca contornar auth)',
  );
});

test('GET /sync/status (getSyncStatus): "pending" vem sempre de sync_queue local, nunca adivinhado — sem cloud configurada', async () => {
  assert.equal(isCloudSyncConfigured(), false, 'este teste nunca deve ter cloud configurada — zero chamadas de rede/sync');

  const before = fakeRes();
  await getSyncStatus({ tenantId: T }, before);
  const pendingBefore = before.body?.data?.pending ?? before.body?.pending ?? 0;

  // 3 vendas VD offline reais (mesmo padrão do Pilot Gate: cart vazio é
  // suficiente para exercitar o enqueueSync('sale', ...) que é o que importa aqui).
  for (const total of [1150, 970, 900]) {
    const result = await sales.createSale(
      { cart: [], docType: 'VD', total, subtotal: total, tax: 0, paymentMethod: 'dinheiro', receivedAmount: String(total), selectedUserId: actor.id, selectedUserName: actor.name },
      actor,
      {},
    );
    assert.ok(result?.success, `venda offline falhou: ${JSON.stringify(result)}`);
    assert.equal(result.syncQueued, true, 'a venda deve ficar enfileirada para sync mesmo sem cloud configurada');
  }

  const after = fakeRes();
  await getSyncStatus({ tenantId: T }, after);
  const dataAfter = after.body?.data ?? after.body;

  assert.equal(dataAfter.pending, pendingBefore + 3, 'as 3 vendas offline devem aparecer como pending — nunca "Pending=0" com vendas por sincronizar');
  assert.equal(dataAfter.cloud_configured, false);
  assert.equal(dataAfter.online, false, 'sem cloud configurada, online é sempre false — sem tentar nenhuma sonda de rede');
  assert.equal(dataAfter.mode, 'offline_only');

  const queueRows = await allDb(`SELECT status FROM sync_queue WHERE tenant_id = ? AND type = 'sale'`, [T]);
  assert.equal(queueRows.filter((r) => r.status === 'pending').length, 3, 'devem existir exactamente 3 linhas pending reais em sync_queue, não uma contagem adivinhada');
});
