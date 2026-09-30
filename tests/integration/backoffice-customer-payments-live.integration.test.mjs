/**
 * Etapa 1G.4 Fase 3E — Backoffice: Consulta VD/FT + Recebimentos de Clientes. Sem
 * service_role em nenhum caminho de escrita/leitura do Backoffice. orders permanece
 * inalterada (Backoffice nunca cria/altera VD/FT nem orders.status).
 *
 * Requer env: POSLY_1G4I_ISSUER_URL, POSLY_1G4I_ADMIN_TOKEN, POSLY_1G4I_SUPABASE_URL,
 *   POSLY_1G4I_ANON_KEY, POSLY_1G4I_SERVICE_ROLE_KEY.
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { test, before } from 'node:test';
import { createClient } from '@supabase/supabase-js';

const E = (k) => process.env[`POSLY_1G4I_${k}`] || '';
const run = Boolean(E('ISSUER_URL') && E('ADMIN_TOKEN') && E('SUPABASE_URL') && E('ANON_KEY') && E('SERVICE_ROLE_KEY'));
const opts = { skip: !run && 'defina POSLY_1G4I_*' };

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
async function bootstrapRawDevice(tenantId, licenseId, storeId) {
  const tok = await post('/api/license-issuer/device/activation-tokens', { tenant_id: tenantId, license_id: licenseId, store_id: storeId });
  const boot = await post('/api/license-issuer/device/bootstrap', { activation_token: tok.data.activation_token, machine_id: `m-1g4i-${rand()}` }, false);
  assert.equal(boot.status, 200, JSON.stringify(boot.data));
  return createClient(E('SUPABASE_URL'), E('ANON_KEY'), { global: { headers: { Authorization: `Bearer ${boot.data.access_token}` } }, auth: { persistSession: false } });
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

const c = {};

before(async () => {
  if (!run) return;
  const tenantId = `itest-1g4i-${rand()}`;
  await post('/api/license-issuer/tenants', { id: tenantId, name: 'T1G4I' });
  const lic = await post('/api/license-issuer/licenses', { tenant_id: tenantId, plan: 'PRO', commerce_type: 'retalho', max_devices: 20 });
  c.tenantId = tenantId;
  c.licenseId = lic.data.license.id;
  const mkStore = async (n) => (await post('/api/license-issuer/stores', { tenant_id: tenantId, license_id: c.licenseId, name: n })).data.store.id;
  c.storeA = await mkStore('Loja A (1G4I)');
  c.storeX = await mkStore('Loja X (1G4I)');
  c.deviceA = await bootstrapRawDevice(tenantId, c.licenseId, c.storeA);

  c.customerId = uuid();
  assert.equal((await svc.from('customers').insert({ id: c.customerId, tenant_id: tenantId, name: 'Cliente 1G4I', phone: '840000000' })).error, null);
  c.otherCustomerId = uuid();
  assert.equal((await svc.from('customers').insert({ id: c.otherCustomerId, tenant_id: tenantId, name: 'Outro Cliente 1G4I', phone: '840000001' })).error, null);

  c.productId = uuid();
  assert.equal((await svc.from('products').insert({ id: c.productId, tenant_id: tenantId, name: 'Produto 1G4I', price: 25 })).error, null);
  assert.equal((await svc.from('store_products').insert({ tenant_id: tenantId, store_id: c.storeA, product_id: c.productId, status: 'active' })).error, null);

  // Vende via a RPC real (create_order_with_items) — nunca inventar uma order à mão.
  // status='pending' explícito nas FT (mesmo estado real de uma venda a conta corrente —
  // a RPC de venda não o infere sozinha a partir de payment_method, só grava o que recebe).
  const sell = (docType, customerId, qty) =>
    c.deviceA.rpc('create_order_with_items', {
      order_data: {
        local_sale_id: `sale-1g4i-${uuid()}`,
        total: qty * 25,
        subtotal: qty * 25,
        doc_type: docType,
        customer_id: customerId,
        payment_method: docType === 'FT' ? 'conta corrente' : 'dinheiro',
        status: docType === 'FT' ? 'pending' : 'completed',
      },
      items: [{ product_id: c.productId, product_name: 'Produto 1G4I', quantity: qty, price: 25 }],
    });

  const ftSale = await sell('FT', c.customerId, 4); // total 100
  assert.equal(ftSale.error, null, JSON.stringify(ftSale.error));
  c.ftOrderId = ftSale.data[0].order_id;

  const vdSale = await sell('VD', c.customerId, 1); // total 25
  assert.equal(vdSale.error, null, JSON.stringify(vdSale.error));
  c.vdOrderId = vdSale.data[0].order_id;

  // FT cancelada (directamente via service_role — não há RPC de cancelamento nesta etapa
  // nem é preciso uma para o teste: só precisamos de UMA linha real com status='cancelled').
  const ftCancelSale = await sell('FT', c.customerId, 1); // total 25
  assert.equal(ftCancelSale.error, null, JSON.stringify(ftCancelSale.error));
  c.ftCancelledOrderId = ftCancelSale.data[0].order_id;
  assert.equal((await svc.from('orders').update({ status: 'cancelled' }).eq('id', c.ftCancelledOrderId)).error, null);

  c.ownerEmail = `owner-1g4i-${rand()}@test.local`;
  const ownerId = await mkAuthUser(c.ownerEmail);
  assert.equal((await svc.from('backoffice_users').insert({ user_id: ownerId, tenant_id: tenantId, role: 'owner' })).error, null);
  c.opAEmail = `op-a-1g4i-${rand()}@test.local`;
  const opAId = await mkAuthUser(c.opAEmail);
  assert.equal((await svc.from('backoffice_users').insert({ user_id: opAId, tenant_id: tenantId, role: 'store_operator' })).error, null);
  assert.equal((await svc.from('backoffice_user_stores').insert({ user_id: opAId, tenant_id: tenantId, store_id: c.storeA })).error, null);
});

test('consulta: owner lê VD e FT (read-only); store_operator só Stores atribuídas', opts, async () => {
  const owner = await signIn(c.ownerEmail);
  const { data: orders, error } = await owner.from('orders').select('id,doc_type,total,status').eq('id', c.ftOrderId);
  assert.equal(error, null);
  assert.equal(orders.length, 1);
  assert.equal(orders[0].doc_type, 'FT');

  const { data: items } = await owner.from('order_items').select('id').eq('order_id', c.ftOrderId);
  assert.ok((items ?? []).length > 0, 'order_items também legível');

  // orders nunca é escrevível pelo Backoffice (sem GRANT nenhum) — mesmo o owner.
  const forgedWrite = await owner.from('orders').update({ status: 'completed' }).eq('id', c.ftOrderId);
  assert.ok(forgedWrite.error, 'sem GRANT de escrita em orders para authenticated — nem RLS entra em jogo');

  const op = await signIn(c.opAEmail);
  const { data: allowed } = await op.from('orders').select('id').eq('id', c.ftOrderId); // a order É da Store A, atribuída ao op — deve ler
  assert.equal((allowed ?? []).length, 1);
});

test('FT 100 -> paga 30 -> saldo 70 (Parcial); +70 -> saldo 0 (Pago); retry não duplica; overpayment bloqueado', opts, async () => {
  const owner = await signIn(c.ownerEmail);

  const pay1 = await owner.rpc('backoffice_pay_customer_order', { p_order_id: c.ftOrderId, p_customer_id: c.customerId, p_amount: 30, p_method: 'dinheiro', p_idempotency_key: `pay1-${uuid()}` });
  assert.equal(pay1.error, null, JSON.stringify(pay1.error));
  assert.equal(pay1.data[0].out_status, 'inserted');
  assert.equal(Number(pay1.data[0].out_remaining), 70, 'saldo parcial 70 -> Parcialmente pago no ecrã');

  const key1 = `pay1-retry-${uuid()}`;
  const first = await owner.rpc('backoffice_pay_customer_order', { p_order_id: c.ftOrderId, p_customer_id: c.customerId, p_amount: 10, p_method: null, p_idempotency_key: key1 });
  const retry = await owner.rpc('backoffice_pay_customer_order', { p_order_id: c.ftOrderId, p_customer_id: c.customerId, p_amount: 10, p_method: null, p_idempotency_key: key1 });
  assert.equal(first.data[0].out_status, 'inserted');
  assert.equal(retry.data[0].out_status, 'duplicate');
  const { data: rows } = await svc.from('customer_payments').select('id').eq('order_id', c.ftOrderId).eq('idempotency_key', key1);
  assert.equal(rows.length, 1, 'retry nunca duplica');

  const overpay = await owner.rpc('backoffice_pay_customer_order', { p_order_id: c.ftOrderId, p_customer_id: c.customerId, p_amount: 1000, p_method: null, p_idempotency_key: `k-${uuid()}` });
  assert.match(overpay.error.message, /payment_exceeds_balance/);

  const zeroPay = await owner.rpc('backoffice_pay_customer_order', { p_order_id: c.ftOrderId, p_customer_id: c.customerId, p_amount: 0, p_method: null, p_idempotency_key: `k-${uuid()}` });
  assert.match(zeroPay.error.message, /amount_must_be_positive/);

  // fecha a conta: 100 - 30 - 10 = 60 restantes
  const final = await owner.rpc('backoffice_pay_customer_order', { p_order_id: c.ftOrderId, p_customer_id: c.customerId, p_amount: 60, p_method: 'transferência', p_idempotency_key: `final-${uuid()}` });
  assert.equal(final.error, null, JSON.stringify(final.error));
  assert.equal(Number(final.data[0].out_remaining), 0, 'saldo 0 -> Pago no ecrã');

  const { data: orderAfter } = await svc.from('orders').select('status,total').eq('id', c.ftOrderId).single();
  assert.equal(orderAfter.status, 'pending', 'orders.status NUNCA é alterado por esta etapa — continua exactamente como a RPC de venda o deixou');
  assert.equal(Number(orderAfter.total), 100, 'orders permanece inalterada');
});

test('VD nunca recebe pagamento; FT cancelada nunca recebe pagamento; Tenant/Store/customer forjados bloqueados', opts, async () => {
  const owner = await signIn(c.ownerEmail);
  const op = await signIn(c.opAEmail);

  const payVd = await owner.rpc('backoffice_pay_customer_order', { p_order_id: c.vdOrderId, p_customer_id: c.customerId, p_amount: 1, p_method: null, p_idempotency_key: `k-${uuid()}` });
  assert.match(payVd.error.message, /order_not_payable/);

  const payCancelled = await owner.rpc('backoffice_pay_customer_order', { p_order_id: c.ftCancelledOrderId, p_customer_id: c.customerId, p_amount: 1, p_method: null, p_idempotency_key: `k-${uuid()}` });
  assert.match(payCancelled.error.message, /order_cancelled/);

  const forgedCustomer = await owner.rpc('backoffice_pay_customer_order', { p_order_id: c.ftOrderId, p_customer_id: c.otherCustomerId, p_amount: 1, p_method: null, p_idempotency_key: `k-${uuid()}` });
  assert.match(forgedCustomer.error.message, /order_customer_mismatch/);

  // store_operator (só A) tenta pagar uma order de outra Store — precisa de uma order em X.
  const deviceX = await bootstrapRawDevice(c.tenantId, c.licenseId, c.storeX);
  await svc.from('store_products').insert({ tenant_id: c.tenantId, store_id: c.storeX, product_id: c.productId, status: 'active' });
  const ftX = await deviceX.rpc('create_order_with_items', {
    order_data: { local_sale_id: `sale-1g4i-x-${uuid()}`, total: 25, subtotal: 25, doc_type: 'FT', customer_id: c.customerId, payment_method: 'conta corrente' },
    items: [{ product_id: c.productId, product_name: 'Produto 1G4I', quantity: 1, price: 25 }],
  });
  assert.equal(ftX.error, null, JSON.stringify(ftX.error));
  const forgedStore = await op.rpc('backoffice_pay_customer_order', { p_order_id: ftX.data[0].order_id, p_customer_id: c.customerId, p_amount: 1, p_method: null, p_idempotency_key: `k-${uuid()}` });
  assert.match(forgedStore.error.message, /store_not_authorized/);
});

test('concorrência: dois recebimentos simultâneos nunca ultrapassam o saldo', opts, async () => {
  const owner = await signIn(c.ownerEmail);
  const sell = await c.deviceA.rpc('create_order_with_items', {
    order_data: { local_sale_id: `sale-1g4i-race-${uuid()}`, total: 50, subtotal: 50, doc_type: 'FT', customer_id: c.customerId, payment_method: 'conta corrente' },
    items: [{ product_id: c.productId, product_name: 'Produto 1G4I', quantity: 2, price: 25 }],
  });
  assert.equal(sell.error, null, JSON.stringify(sell.error));
  const orderId = sell.data[0].order_id;

  const [ra, rb] = await Promise.all([
    owner.rpc('backoffice_pay_customer_order', { p_order_id: orderId, p_customer_id: c.customerId, p_amount: 30, p_method: null, p_idempotency_key: `race-a-${uuid()}` }),
    owner.rpc('backoffice_pay_customer_order', { p_order_id: orderId, p_customer_id: c.customerId, p_amount: 30, p_method: null, p_idempotency_key: `race-b-${uuid()}` }),
  ]);
  const ok = [ra, rb].filter((r) => !r.error);
  const failed = [ra, rb].filter((r) => r.error);
  assert.equal(ok.length, 1);
  assert.equal(failed.length, 1);
  assert.match(failed[0].error.message, /payment_exceeds_balance/);
  const { data: sum } = await svc.from('customer_payments').select('amount').eq('order_id', orderId);
  const total = (sum ?? []).reduce((s, r) => s + Number(r.amount), 0);
  assert.ok(total <= 50, `saldo nunca ultrapassado (pago=${total})`);
});
