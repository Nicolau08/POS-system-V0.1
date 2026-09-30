/**
 * Etapa 1G.4 Fase 7 — Dashboard/Relatórios V1. Sem novas views/RPCs: a agregação vive no
 * Route Handler (Node), sobre as tabelas-fonte já RLS-scoped — por isso este teste, ao
 * contrário dos anteriores, tem de bater no servidor Next.js real (não só no Postgres),
 * para exercitar o código que realmente corre em produção.
 *
 * Requer env: POSLY_1G4J_ISSUER_URL, POSLY_1G4J_ADMIN_TOKEN, POSLY_1G4J_SUPABASE_URL,
 *   POSLY_1G4J_ANON_KEY, POSLY_1G4J_SERVICE_ROLE_KEY, POSLY_1G4J_BACKOFFICE_URL
 *   (default http://localhost:3003 — arrancar `npm run dev` em backoffice/ antes).
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { test, before } from 'node:test';
import { createClient } from '@supabase/supabase-js';

const E = (k) => process.env[`POSLY_1G4J_${k}`] || '';
const BACKOFFICE_URL = E('BACKOFFICE_URL') || 'http://localhost:3003';
const run = Boolean(E('ISSUER_URL') && E('ADMIN_TOKEN') && E('SUPABASE_URL') && E('ANON_KEY') && E('SERVICE_ROLE_KEY'));
const opts = { skip: !run && 'defina POSLY_1G4J_*' };

const svc = run ? createClient(E('SUPABASE_URL'), E('SERVICE_ROLE_KEY'), { auth: { persistSession: false } }) : null;
const uuid = () => crypto.randomUUID();
const rand = () => crypto.randomBytes(4).toString('hex');
const PASSWORD = 'Senha!Teste123';
const isoDate = (d) => d.toISOString().slice(0, 10);

async function post(p, body, admin = true) {
  const res = await fetch(`${E('ISSUER_URL')}${p}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(admin ? { Authorization: `Bearer ${E('ADMIN_TOKEN')}` } : {}) },
    body: JSON.stringify(body),
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}
async function bootstrapRawDevice(tenantId, licenseId, storeId) {
  const tok = await post('/api/license-issuer/device/activation-tokens', { tenant_id: tenantId, license_id: licenseId, store_id: storeId });
  const boot = await post('/api/license-issuer/device/bootstrap', { activation_token: tok.data.activation_token, machine_id: `m-1g4j-${rand()}` }, false);
  assert.equal(boot.status, 200, JSON.stringify(boot.data));
  return createClient(E('SUPABASE_URL'), E('ANON_KEY'), { global: { headers: { Authorization: `Bearer ${boot.data.access_token}` } }, auth: { persistSession: false } });
}
async function mkAuthUser(email) {
  const { data, error } = await svc.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
  assert.equal(error, null, JSON.stringify(error));
  return data.user.id;
}
/**
 * Etapa 1G.4 Fase 8 mudou o login da app para NUIT+username (não email) — este teste
 * não é sobre login, é sobre o dashboard, por isso autentica-se directo contra o Supabase
 * Auth (mesmo padrão do backoffice-customer-payments-live) e monta a cookie bo_at à mão,
 * sem depender do contrato da rota /api/auth/login.
 */
async function loginCookie(email) {
  const anon = createClient(E('SUPABASE_URL'), E('ANON_KEY'), { auth: { persistSession: false } });
  const { data, error } = await anon.auth.signInWithPassword({ email, password: PASSWORD });
  assert.equal(error, null, JSON.stringify(error));
  return `bo_at=${data.session.access_token}`;
}
async function dashboard(cookie, params) {
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`${BACKOFFICE_URL}/api/reports/dashboard?${qs}`, { headers: { Cookie: cookie } });
  return { status: res.status, data: await res.json() };
}

const c = {};

before(async () => {
  if (!run) return;
  // Servidor Next.js do Backoffice tem de estar de pé (npm run dev, porta 3003) — falha
  // cedo e explícito, em vez de cada teste falhar depois com ECONNREFUSED.
  try {
    await fetch(`${BACKOFFICE_URL}/login`);
  } catch {
    throw new Error(`Backoffice não está a responder em ${BACKOFFICE_URL} — arrancar "npm run dev" em backoffice/ primeiro.`);
  }

  const tenantId = `itest-1g4j-${rand()}`;
  await post('/api/license-issuer/tenants', { id: tenantId, name: 'T1G4J' });
  const lic = await post('/api/license-issuer/licenses', { tenant_id: tenantId, plan: 'PRO', commerce_type: 'retalho', max_devices: 20 });
  c.tenantId = tenantId;
  c.licenseId = lic.data.license.id;
  const mkStore = async (n) => (await post('/api/license-issuer/stores', { tenant_id: tenantId, license_id: c.licenseId, name: n })).data.store.id;
  c.storeA = await mkStore('Loja A (1G4J)');
  c.storeX = await mkStore('Loja X (1G4J)');
  c.deviceA = await bootstrapRawDevice(tenantId, c.licenseId, c.storeA);
  c.deviceX = await bootstrapRawDevice(tenantId, c.licenseId, c.storeX);

  c.customerId = uuid();
  assert.equal((await svc.from('customers').insert({ id: c.customerId, tenant_id: tenantId, name: 'Cliente 1G4J', phone: '840000010' })).error, null);
  c.supplierId = uuid();
  assert.equal((await svc.from('suppliers').insert({ id: c.supplierId, tenant_id: tenantId, name: 'Fornecedor 1G4J' })).error, null);
  c.productId = uuid();
  assert.equal((await svc.from('products').insert({ id: c.productId, tenant_id: tenantId, name: 'Produto 1G4J', price: 20 })).error, null);
  assert.equal((await svc.from('store_products').insert({ tenant_id: tenantId, store_id: c.storeA, product_id: c.productId, status: 'active' })).error, null);
  assert.equal((await svc.from('store_products').insert({ tenant_id: tenantId, store_id: c.storeX, product_id: c.productId, status: 'active' })).error, null);

  const sell = (device, docType, storeLabel, customerId, total, paymentMethod) =>
    device.rpc('create_order_with_items', {
      order_data: {
        local_sale_id: `sale-1g4j-${uuid()}`,
        total,
        subtotal: total,
        doc_type: docType,
        customer_id: customerId,
        payment_method: paymentMethod,
        status: docType === 'FT' ? 'pending' : 'completed',
      },
      items: [{ product_id: c.productId, product_name: 'Produto 1G4J', quantity: total / 20, price: 20 }],
    });

  // Store A: VD 40 (dinheiro) + FT 100 a crédito (conta corrente, cliente) + FT 25 cancelada (tem de ficar de fora).
  const vdA = await sell(c.deviceA, 'VD', 'A', null, 40, 'dinheiro');
  assert.equal(vdA.error, null, JSON.stringify(vdA.error));
  const ftA = await sell(c.deviceA, 'FT', 'A', c.customerId, 100, 'conta corrente');
  assert.equal(ftA.error, null, JSON.stringify(ftA.error));
  c.ftOrderId = ftA.data[0].order_id;
  const ftCancelled = await sell(c.deviceA, 'FT', 'A', c.customerId, 25, 'conta corrente');
  assert.equal(ftCancelled.error, null, JSON.stringify(ftCancelled.error));
  assert.equal((await svc.from('orders').update({ status: 'cancelled' }).eq('id', ftCancelled.data[0].order_id)).error, null);

  // Store X: VD 60 (mbway).
  const vdX = await sell(c.deviceX, 'VD', 'X', null, 60, 'mbway');
  assert.equal(vdX.error, null, JSON.stringify(vdX.error));

  // Recebimento parcial (30 de 100) — saldo esperado 70.
  assert.equal(
    (await svc.from('customer_payments').insert({ tenant_id: tenantId, store_id: c.storeA, customer_id: c.customerId, order_id: c.ftOrderId, amount: 30, idempotency_key: uuid() })).error,
    null
  );

  // Documento de fornecedor confirmado (total 200) + pagamento parcial (50) — saldo esperado 150.
  // Items só podem ser inseridos com o pai ainda 'draft' (trigger supplier_document_items_guard_parent_draft)
  // — cria-se draft, insere-se os items, só depois se flipa para 'confirmed'.
  c.docId = uuid();
  assert.equal((await svc.from('supplier_documents').insert({ id: c.docId, tenant_id: tenantId, store_id: c.storeA, supplier_id: c.supplierId, document_number: `F-1G4J-${rand()}`, status: 'draft' })).error, null);
  assert.equal((await svc.from('supplier_document_items').insert({ tenant_id: tenantId, document_id: c.docId, product_id: c.productId, quantity: 20, unit_cost: 10 })).error, null);
  assert.equal((await svc.from('supplier_documents').update({ status: 'confirmed', confirmed_at: new Date().toISOString() }).eq('id', c.docId)).error, null);
  assert.equal((await svc.from('supplier_payments').insert({ tenant_id: tenantId, supplier_id: c.supplierId, document_id: c.docId, amount: 50, idempotency_key: uuid() })).error, null);

  // Movimentos de stock independentes (resumo por tipo).
  assert.equal((await svc.from('stock_movements').insert({ tenant_id: tenantId, store_id: c.storeA, product_id: c.productId, type: 'restock', quantity: 20, reference_id: `restock-1g4j-${rand()}` })).error, null);
  assert.equal((await svc.from('stock_movements').insert({ tenant_id: tenantId, store_id: c.storeA, product_id: c.productId, type: 'adjustment', quantity: -3, reference_id: `adj-1g4j-${rand()}` })).error, null);

  c.ownerEmail = `owner-1g4j-${rand()}@test.local`;
  const ownerId = await mkAuthUser(c.ownerEmail);
  assert.equal((await svc.from('backoffice_users').insert({ user_id: ownerId, tenant_id: tenantId, role: 'owner' })).error, null);
  c.opAEmail = `op-a-1g4j-${rand()}@test.local`;
  const opAId = await mkAuthUser(c.opAEmail);
  assert.equal((await svc.from('backoffice_users').insert({ user_id: opAId, tenant_id: tenantId, role: 'store_operator' })).error, null);
  assert.equal((await svc.from('backoffice_user_stores').insert({ user_id: opAId, tenant_id: tenantId, store_id: c.storeA })).error, null);

  // Tenant B, só para o teste de isolamento (sem nenhuma order/document).
  c.tenantBId = `itest-1g4jb-${rand()}`;
  await post('/api/license-issuer/tenants', { id: c.tenantBId, name: 'T1G4JB' });
  c.ownerBEmail = `owner-b-1g4j-${rand()}@test.local`;
  const ownerBId = await mkAuthUser(c.ownerBEmail);
  assert.equal((await svc.from('backoffice_users').insert({ user_id: ownerBId, tenant_id: c.tenantBId, role: 'owner' })).error, null);

  const today = new Date();
  const past = new Date(today.getTime() - 2 * 24 * 60 * 60 * 1000);
  c.from = isoDate(past);
  c.to = isoDate(today);
});

test('owner: Todas as Stores vs Store específica — totais consistentes, cancelada excluída', opts, async () => {
  const cookie = await loginCookie(c.ownerEmail);

  const all = await dashboard(cookie, { storeId: 'all', from: c.from, to: c.to });
  assert.equal(all.status, 200, JSON.stringify(all.data));
  assert.equal(all.data.totals.totalSold, 200); // 40 + 100 + 60, sem a FT cancelada (25)
  assert.equal(all.data.totals.documentCount, 3);
  assert.equal(Math.round(all.data.totals.avgTicket * 100) / 100, Math.round((200 / 3) * 100) / 100);

  const paymentSum = all.data.byPaymentMethod.reduce((s, r) => s + r.total, 0);
  assert.equal(paymentSum, 200);
  assert.ok(all.data.byStore, 'byStore deve vir preenchido quando storeId=all');
  const storeSum = all.data.byStore.reduce((s, r) => s + r.total, 0);
  assert.equal(storeSum, 200);
  assert.equal(all.data.byStore.length, 2);

  const receivable = all.data.receivables.find((r) => r.customerId === c.customerId);
  assert.ok(receivable, 'cliente devia aparecer em contas a receber');
  assert.equal(receivable.remaining, 70); // 100 - 30

  const payable = all.data.payables.find((p) => p.supplierId === c.supplierId);
  assert.ok(payable, 'fornecedor devia aparecer em contas a pagar');
  assert.equal(payable.remaining, 150); // 200 - 50

  const stockByType = Object.fromEntries(all.data.stockSummary.map((s) => [s.type, s.quantity]));
  assert.equal(stockByType.restock, 20);
  assert.equal(stockByType.adjustment, -3);

  const onlyA = await dashboard(cookie, { storeId: c.storeA, from: c.from, to: c.to });
  assert.equal(onlyA.status, 200);
  assert.equal(onlyA.data.totals.totalSold, 140); // 40 + 100
  assert.equal(onlyA.data.totals.documentCount, 2);
  assert.equal(onlyA.data.byStore, null);
});

test('store_operator: só a Store atribuída; "all" bloqueado (403)', opts, async () => {
  const cookie = await loginCookie(c.opAEmail);

  const ok = await dashboard(cookie, { storeId: c.storeA, from: c.from, to: c.to });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  assert.equal(ok.data.totals.totalSold, 140);

  const forbidden = await dashboard(cookie, { storeId: 'all', from: c.from, to: c.to });
  assert.equal(forbidden.status, 403);

  // Store X nunca atribuída ao operador — RLS filtra tudo, nunca vaza dados de outra Store.
  const otherStore = await dashboard(cookie, { storeId: c.storeX, from: c.from, to: c.to });
  assert.equal(otherStore.status, 200);
  assert.equal(otherStore.data.totals.documentCount, 0);
  assert.equal(otherStore.data.totals.totalSold, 0);
});

test('isolamento de Tenant: owner de B nunca vê dados de A', opts, async () => {
  const cookie = await loginCookie(c.ownerBEmail);
  const res = await dashboard(cookie, { storeId: 'all', from: c.from, to: c.to });
  assert.equal(res.status, 200);
  assert.equal(res.data.totals.documentCount, 0);
  assert.equal(res.data.totals.totalSold, 0);
  assert.equal(res.data.receivables.length, 0);
  assert.equal(res.data.payables.length, 0);
});

test('período fora do intervalo devolve zero; período/store em falta são 400', opts, async () => {
  const cookie = await loginCookie(c.ownerEmail);

  const outOfRange = await dashboard(cookie, { storeId: 'all', from: '2000-01-01', to: '2000-01-02' });
  assert.equal(outOfRange.status, 200);
  assert.equal(outOfRange.data.totals.documentCount, 0);

  const noPeriod = await dashboard(cookie, { storeId: 'all' });
  assert.equal(noPeriod.status, 400);

  const noStore = await dashboard(cookie, { from: c.from, to: c.to });
  assert.equal(noStore.status, 400);
});
