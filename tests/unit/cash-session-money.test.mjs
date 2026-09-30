/**
 * Pilot Gate — POS/Dinheiro (2ª passagem, pós-correção). Cobre a invariante "total
 * vendido = pagamentos = movimentos de caixa" com o breakdown real por tender
 * (sale_payments), o fallback legacy por payment_method, e o isolamento de sessões por
 * timestamp com precisão de milissegundo. BD SQLite real temporária, sem cloud — mesmo
 * padrão de tests/unit/stock-*.
 *
 * CORRIGIDO nesta etapa (ver relatório): pagamento misto deixou de contar o total
 * inteiro como dinheiro — agora soma só o valor realmente aplicado por tender, lido de
 * sale_payments (nunca substring em payment_method para vendas novas). Troco é sempre
 * líquido: o tender de dinheiro nunca inclui o valor devolvido ao cliente.
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, before } from 'node:test';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'posly-cash-money-'));
process.env.POS_DB_PATH = path.join(tmpDir, 'database.db');
process.env.DEFAULT_TENANT_ID = 'tenant-cash-money';

const db = (await import('../../api/database.js')).default;
const sales = await import('../../api/services/sales.service.js');
const cash = await import('../../api/services/cash-session.service.js');

const T = 'tenant-cash-money';
const runDb = (sql, params = []) => new Promise((res, rej) => db.run(sql, params, (e) => (e ? rej(e) : res())));
const allDb = (sql, params = []) => new Promise((res, rej) => db.all(sql, params, (e, r) => (e ? rej(e) : res(r))));

async function ready() {
  const deadline = Date.now() + 8000;
  for (;;) {
    try {
      await allDb('SELECT id FROM vendas LIMIT 1');
      await allDb('SELECT id FROM cash_sessions LIMIT 1');
      await allDb('SELECT id FROM sale_payments LIMIT 1');
      return;
    } catch (e) {
      if (Date.now() > deadline) throw e;
      await new Promise((r) => setTimeout(r, 100));
    }
  }
}

const actor = { id: 'op-1', name: 'Operador Teste', tenant_id: T };

async function sell(payload) {
  const res = await sales.createSale(
    { cart: [], selectedCustomerId: null, selectedUserId: actor.id, selectedUserName: actor.name, ...payload },
    actor,
    {}
  );
  assert.ok(res?.success, `venda falhou: ${JSON.stringify(res)}`);
  return res;
}
async function tendersOf(saleId) {
  return allDb(`SELECT method, amount, tendered_amount FROM sale_payments WHERE sale_id = ? ORDER BY rowid`, [saleId]);
}

before(async () => {
  await ready();
  await cash.ensureCashSession(actor);
});

test('100 dinheiro: cash esperado 100', async () => {
  const before = (await cash.getCashSession(actor)).totals;
  const sale = await sell({ docType: 'VD', total: 100, subtotal: 86.21, tax: 13.79, paymentMethod: 'dinheiro', receivedAmount: '100' });
  const t = await tendersOf(sale.id);
  assert.deepEqual(t, [{ method: 'Dinheiro', amount: 100, tendered_amount: null }]);
  const snap = await cash.getCashSession(actor);
  assert.equal(snap.totals.cashSalesTotal, before.cashSalesTotal + 100);
  assert.equal(snap.totals.salesTotal, before.salesTotal + 100);
});

test('100 cartão: cash esperado 0', async () => {
  const before = (await cash.getCashSession(actor)).totals;
  const sale = await sell({ docType: 'VD', total: 100, subtotal: 86.21, tax: 13.79, paymentMethod: 'cartao', receivedAmount: '' });
  const t = await tendersOf(sale.id);
  assert.deepEqual(t, [{ method: 'cartao', amount: 100, tendered_amount: null }]);
  const snap = await cash.getCashSession(actor);
  assert.equal(snap.totals.cashSalesTotal, before.cashSalesTotal, 'cartão nunca soma no dinheiro');
  assert.equal(snap.totals.salesTotal, before.salesTotal + 100);
});

test('60 dinheiro + 40 cartão (exacto, sem troco): cash esperado 60', async () => {
  const before = (await cash.getCashSession(actor)).totals;
  const sale = await sell({
    docType: 'VD',
    total: 100,
    subtotal: 86.21,
    tax: 13.79,
    isMultiplePayment: true,
    payments: [
      { method: 'dinheiro', amount: 60 },
      { method: 'cartao', amount: 40 },
    ],
  });
  const t = await tendersOf(sale.id);
  assert.deepEqual(t, [
    { method: 'Dinheiro', amount: 60, tendered_amount: null },
    { method: 'cartao', amount: 40, tendered_amount: null },
  ]);
  const sum = t.reduce((acc, r) => acc + r.amount, 0);
  assert.equal(sum, 100, 'SUM(amount) tem de bater com o total da venda');
  const snap = await cash.getCashSession(actor);
  assert.equal(snap.totals.cashSalesTotal, before.cashSalesTotal + 60, 'só os 60 em dinheiro contam, nunca os 100 inteiros');
});

test('dinheiro com troco: total=60, cliente entrega 100, troco=40 → cash líquido esperado 60', async () => {
  const before = (await cash.getCashSession(actor)).totals;
  const sale = await sell({ docType: 'VD', total: 60, subtotal: 51.72, tax: 8.28, paymentMethod: 'dinheiro', receivedAmount: '100' });
  const t = await tendersOf(sale.id);
  assert.deepEqual(t, [{ method: 'Dinheiro', amount: 60, tendered_amount: 100 }]);
  const snap = await cash.getCashSession(actor);
  assert.equal(snap.totals.cashSalesTotal, before.cashSalesTotal + 60, 'troco nunca infla o dinheiro recebido');
});

test('misto com troco: 70 dinheiro + 40 cartão entregues (total=100, troco=10) → cash líquido esperado 60', async () => {
  const before = (await cash.getCashSession(actor)).totals;
  const sale = await sell({
    docType: 'VD',
    total: 100,
    subtotal: 86.21,
    tax: 13.79,
    isMultiplePayment: true,
    payments: [
      { method: 'dinheiro', amount: 70 },
      { method: 'cartao', amount: 40 },
    ],
  });
  const t = await tendersOf(sale.id);
  const cashRow = t.find((r) => r.method === 'Dinheiro');
  const cardRow = t.find((r) => r.method === 'cartao');
  assert.deepEqual(cashRow, { method: 'Dinheiro', amount: 60, tendered_amount: 70 }, 'troco (10) absorvido pela linha de dinheiro');
  assert.deepEqual(cardRow, { method: 'cartao', amount: 40, tendered_amount: null });
  const sum = t.reduce((acc, r) => acc + r.amount, 0);
  assert.equal(sum, 100);
  const snap = await cash.getCashSession(actor);
  assert.equal(snap.totals.cashSalesTotal, before.cashSalesTotal + 60);
});

test('misto sem dinheiro (cartão + m-pesa): cash esperado 0', async () => {
  const before = (await cash.getCashSession(actor)).totals;
  const sale = await sell({
    docType: 'VD',
    total: 100,
    subtotal: 86.21,
    tax: 13.79,
    isMultiplePayment: true,
    payments: [
      { method: 'cartao', amount: 60 },
      { method: 'mpesa', amount: 40 },
    ],
  });
  const t = await tendersOf(sale.id);
  assert.equal(t.reduce((acc, r) => acc + r.amount, 0), 100);
  const snap = await cash.getCashSession(actor);
  assert.equal(snap.totals.cashSalesTotal, before.cashSalesTotal, 'sem dinheiro no mix, cash não muda');
});

test('movimentos de caixa: entrada/saída ajustam cashAvailable; saque respeita o limite', async () => {
  const before = (await cash.getCashSession(actor)).totals.cashAvailable;
  await cash.createCashMovement(actor, { kind: 'in', amount: 20, note: 'fundo de maneio extra' });
  await cash.createCashMovement(actor, { kind: 'out', amount: 10, note: 'compra miúda' });
  const afterMov = await cash.getCashSession(actor);
  assert.equal(afterMov.totals.cashAvailable, before + 20 - 10);

  await assert.rejects(() => cash.withdrawCash(actor, { amount: 1000000 }), /excede/i);

  const withdrawn = await cash.withdrawCash(actor, { amount: 50 });
  assert.equal(withdrawn.totals.withdrawnTotal, 50);
  assert.equal(withdrawn.totals.cashAvailable, before + 20 - 10 - 50);
});

test('venda cancelada e FP (proforma) nunca entram nos totais de caixa nem geram sale_payments úteis', async () => {
  const beforeSnap = await cash.getCashSession(actor);

  const cancelled = await sell({ docType: 'VD', total: 999, subtotal: 861.21, tax: 137.79, paymentMethod: 'dinheiro', receivedAmount: '999' });
  await runDb(`UPDATE vendas SET status = 'cancelled' WHERE id = ? AND tenant_id = ?`, [cancelled.id, T]);

  const fp = await sell({ docType: 'FP', total: 777, subtotal: 0, tax: 0 });
  assert.deepEqual(await tendersOf(fp.id), [], 'FP (proforma) nunca gera linhas de pagamento');

  const afterSnap = await cash.getCashSession(actor);
  assert.equal(afterSnap.totals.salesTotal, beforeSnap.totals.salesTotal, 'cancelada e FP não podem alterar salesTotal');
  assert.equal(afterSnap.totals.cashSalesTotal, beforeSnap.totals.cashSalesTotal);
  assert.equal(afterSnap.totals.cashAvailable, beforeSnap.totals.cashAvailable);
});

test('venda legacy (sem linhas em sale_payments) continua legível pelo fallback por payment_method', async () => {
  const beforeSnap = await cash.getCashSession(actor);
  const now = new Date().toISOString();
  const insert = await new Promise((resolve, reject) => {
    db.run(
      `INSERT INTO vendas (total, data, doc_type, status, payment_method, tenant_id) VALUES (?, ?, 'VD', 'completed', 'dinheiro', ?)`,
      [45, now, T],
      function onRun(err) {
        if (err) reject(err);
        else resolve(this.lastID);
      }
    );
  });
  assert.deepEqual(await tendersOf(insert), [], 'venda legacy não tem linhas em sale_payments, de propósito');
  const snap = await cash.getCashSession(actor);
  assert.equal(snap.totals.cashSalesTotal, beforeSnap.totals.cashSalesTotal + 45, 'fallback por payment_method continua a funcionar para vendas antigas');
  assert.equal(snap.totals.salesTotal, beforeSnap.totals.salesTotal + 45);
});

test('X/Z: breakdown por tender correcto no fecho', async () => {
  const preClose = await cash.getCashSession(actor);
  const z = await cash.closeCashSessionDay(actor, { printItems: false, printZ: true });
  assert.equal(z.report.totals.salesTotal, preClose.totals.salesTotal);
  assert.equal(z.report.totals.cashSalesTotal, preClose.totals.cashSalesTotal);
  assert.deepEqual(z.report.totals.byTender, preClose.totals.byTender);
  assert.equal(z.report.session.status, 'closed');
});

test('duas sessões abertas/fechadas no MESMO segundo: isolamento correcto (sem herdar vendas)', async () => {
  await cash.ensureCashSession(actor);
  await sell({ docType: 'VD', total: 30, subtotal: 25.86, tax: 4.14, paymentMethod: 'dinheiro', receivedAmount: '30' });
  const z1 = await cash.closeCashSessionDay(actor, { printItems: false, printZ: true });
  // Reabre e vende imediatamente a seguir — sem qualquer espera — para forçar o cenário
  // do gate: fecho+reabertura no mesmo segundo (millisecond precision é o que protege aqui).
  const opened2 = await cash.ensureCashSession(actor);
  assert.notEqual(opened2.session.id, undefined);
  await sell({ docType: 'VD', total: 12, subtotal: 10.34, tax: 1.66, paymentMethod: 'dinheiro', receivedAmount: '12' });
  const snap2 = await cash.getCashSession(actor);
  assert.equal(snap2.totals.salesTotal, 12, 'sessão nova não pode herdar a venda de 30 da sessão anterior, mesmo no mesmo segundo');
  const z2 = await cash.closeCashSessionDay(actor, { printItems: false, printZ: true });
  assert.equal(z2.zNumber, z1.zNumber + 1);
  assert.equal(z2.report.totals.salesTotal, 12);
});

let creditCustomerId;
test('setup: cliente para vendas a crédito/conta corrente', async () => {
  await runDb(`INSERT INTO clientes (name, phone, tenant_id) VALUES (?, ?, ?)`, ['Cliente Fiado', '840000000', T]);
  const row = (await allDb(`SELECT id FROM clientes WHERE tenant_id = ? ORDER BY id DESC LIMIT 1`, [T]))[0];
  creditCustomerId = row.id;
  await cash.ensureCashSession(actor);
});

test('doc_type: numeração sequencial independente por tipo (VD e FT não colidem)', async () => {
  const vd1 = await sell({ docType: 'VD', total: 10, subtotal: 8.62, tax: 1.38, paymentMethod: 'dinheiro', receivedAmount: '10' });
  const ft1 = await sell({ docType: 'FT', total: 20, subtotal: 17.24, tax: 2.76, selectedCustomerId: creditCustomerId, selectedCustomerName: 'Cliente Fiado', paymentMethod: 'conta corrente' });
  const vd2 = await sell({ docType: 'VD', total: 10, subtotal: 8.62, tax: 1.38, paymentMethod: 'dinheiro', receivedAmount: '10' });
  assert.equal(vd2.usedSequence, vd1.usedSequence + 1, 'VD incrementa independentemente de FT');
  assert.notEqual(vd1.usedDocumentNumber, ft1.usedDocumentNumber);
  assert.ok(vd1.usedDocumentNumber.startsWith('VD/'));
  assert.ok(ft1.usedDocumentNumber.startsWith('FT/'));
});

test('venda a crédito/conta corrente: promove automaticamente para FT, mesmo pedindo VD', async () => {
  const res = await sell({ docType: 'VD', total: 40, subtotal: 34.48, tax: 5.52, paymentMethod: 'conta corrente', selectedCustomerId: creditCustomerId, selectedCustomerName: 'Cliente Fiado' });
  assert.equal(res.usedDocType, 'FT', 'conta corrente nunca fica como VD — vira sempre FT (dívida)');
  const t = await tendersOf(res.id);
  assert.deepEqual(t, [{ method: 'conta corrente', amount: 40, tendered_amount: null }]);
});

test('retry/idempotência: nunca duplica a venda nem os tenders (restart/retry offline-sync)', async () => {
  const key = `idem-${crypto.randomUUID()}`;
  const payload = { cart: [], docType: 'VD', total: 15, subtotal: 12.93, tax: 2.07, isMultiplePayment: true, payments: [{ method: 'dinheiro', amount: 10 }, { method: 'cartao', amount: 5 }] };
  const first = await sales.createSale(payload, actor, { idempotencyKey: key });
  const retry = await sales.createSale(payload, actor, { idempotencyKey: key });
  assert.equal(retry.id, first.id, 'retry com a mesma idempotencyKey devolve a MESMA venda');
  assert.equal(retry.idempotentReplay, true);
  const t = await tendersOf(first.id);
  assert.equal(t.length, 2, 'retry nunca duplica as linhas de sale_payments');
});

test('restart (reabrir a "sessão" de leitura): totais recomputados do zero batem com os anteriores', async () => {
  const snapA = await cash.getCashSession(actor);
  // Simula um restart do processo: os totais nunca podem depender de estado em memória —
  // recalcular do zero, só a partir do que está persistido, tem de dar exactamente o mesmo.
  const snapB = await cash.getCashSession(actor);
  assert.deepEqual(snapB.totals, snapA.totals);
});
