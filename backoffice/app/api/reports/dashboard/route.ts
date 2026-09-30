/**
 * Etapa 1G.4 Fase 7 — Dashboard/Relatórios V1. 100% leitura, sem novas views/RPCs: todas
 * as tabelas-fonte já têm SELECT aditivo do Backoffice, RLS-scoped
 * (backoffice_can_access_store/backoffice_current_tenant_id) — os agregados são
 * calculados aqui, em Node, sobre os resultados dessas queries (mesmo padrão já usado em
 * supplier-documents/[id] e orders/[id] para total/paid/remaining). Nunca escreve
 * orders/ledger. Período obrigatório + LIMIT em cada query evita scans sem controlo;
 * `truncated` sinaliza quando o LIMIT foi atingido (agregados nesse caso reflectem só o
 * subconjunto devolvido, nunca a tabela inteira).
 */
import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getSessionClient, serviceRoleClient } from '@/lib/serverSession';

const ORDERS_LIMIT = 5000;
const DOCS_LIMIT = 5000;
const MOVEMENTS_LIMIT = 5000;
const TOP_PRODUCTS_LIMIT = 10;
const BALANCES_LIMIT = 50;
const IN_BATCH_SIZE = 300;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function fetchInBatches<T>(client: SupabaseClient, table: string, select: string, column: string, ids: string[]): Promise<T[]> {
  const out: T[] = [];
  for (const batch of chunk(ids, IN_BATCH_SIZE)) {
    const { data, error } = await client.from(table).select(select).in(column, batch);
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...((data ?? []) as T[]));
  }
  return out;
}

export async function GET(req: Request) {
  const session = await getSessionClient();
  if (session.status === 'unauthenticated') return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });
  if (session.status === 'forbidden') return NextResponse.json({ error: 'Sem acesso.' }, { status: 403 });
  const { user, client } = session;

  const url = new URL(req.url);
  const storeParam = url.searchParams.get('storeId');
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  if (!storeParam) return NextResponse.json({ error: 'Store é obrigatória.' }, { status: 400 });
  if (!from || !to || !DATE_RE.test(from) || !DATE_RE.test(to)) return NextResponse.json({ error: 'Período obrigatório (from/to, formato AAAA-MM-DD).' }, { status: 400 });

  const fromDate = new Date(`${from}T00:00:00.000Z`);
  const toDate = new Date(`${to}T00:00:00.000Z`);
  if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime()) || fromDate > toDate) {
    return NextResponse.json({ error: 'Período inválido.' }, { status: 400 });
  }
  const fromIso = fromDate.toISOString();
  const toExclusiveIso = new Date(toDate.getTime() + 24 * 60 * 60 * 1000).toISOString();

  const isAll = storeParam === 'all';
  if (isAll && user.role !== 'owner') {
    return NextResponse.json({ error: 'Apenas o owner pode consultar todas as Stores.' }, { status: 403 });
  }

  try {
    let ordersQuery = client
      .from('orders')
      .select('id,store_id,customer_id,doc_type,document_number,status,total,payment_method,created_at')
      .neq('status', 'cancelled')
      .gte('created_at', fromIso)
      .lt('created_at', toExclusiveIso)
      .order('created_at', { ascending: false })
      .limit(ORDERS_LIMIT);
    if (!isAll) ordersQuery = ordersQuery.eq('store_id', storeParam);
    const { data: ordersData, error: ordersErr } = await ordersQuery;
    if (ordersErr) throw new Error(`orders: ${ordersErr.message}`);
    const orders = ordersData ?? [];
    const ordersTruncated = orders.length === ORDERS_LIMIT;

    const totalSold = orders.reduce((s, o) => s + Number(o.total), 0);
    const documentCount = orders.length;
    const avgTicket = documentCount > 0 ? totalSold / documentCount : 0;

    const paymentMap = new Map<string, { total: number; count: number }>();
    const storeMap = new Map<string, { total: number; count: number }>();
    for (const o of orders) {
      const method = (o.payment_method ?? '').trim() || 'não especificado';
      const pm = paymentMap.get(method) ?? { total: 0, count: 0 };
      pm.total += Number(o.total);
      pm.count += 1;
      paymentMap.set(method, pm);

      const sm = storeMap.get(o.store_id) ?? { total: 0, count: 0 };
      sm.total += Number(o.total);
      sm.count += 1;
      storeMap.set(o.store_id, sm);
    }
    const byPaymentMethod = [...paymentMap.entries()].map(([method, v]) => ({ method, ...v })).sort((a, b) => b.total - a.total);

    let byStore: Array<{ storeId: string; storeName: string; total: number; count: number }> | null = null;
    if (isAll) {
      const { data: storesData, error: storesErr } = await serviceRoleClient().from('stores').select('id,name').eq('tenant_id', user.tenantId);
      if (storesErr) throw new Error(`stores: ${storesErr.message}`);
      const names = new Map((storesData ?? []).map((s) => [s.id, s.name as string]));
      byStore = [...storeMap.entries()]
        .map(([storeId, v]) => ({ storeId, storeName: names.get(storeId) ?? storeId, ...v }))
        .sort((a, b) => b.total - a.total);
    }

    const orderIds = orders.map((o) => o.id);
    let topProducts: Array<{ productId: string; productName: string; quantity: number; revenue: number }> = [];
    if (orderIds.length > 0) {
      const items = await fetchInBatches<{ product_id: string | null; product_name: string; quantity: number; price: number; discount_amount: number }>(
        client,
        'order_items',
        'product_id,product_name,quantity,price,discount_amount,order_id',
        'order_id',
        orderIds
      );
      const productMap = new Map<string, { productName: string; quantity: number; revenue: number }>();
      for (const it of items) {
        const key = it.product_id ?? it.product_name;
        const cur = productMap.get(key) ?? { productName: it.product_name, quantity: 0, revenue: 0 };
        cur.quantity += Number(it.quantity);
        cur.revenue += Number(it.quantity) * Number(it.price) - Number(it.discount_amount ?? 0);
        productMap.set(key, cur);
      }
      topProducts = [...productMap.entries()]
        .map(([productId, v]) => ({ productId, ...v }))
        .sort((a, b) => b.quantity - a.quantity)
        .slice(0, TOP_PRODUCTS_LIMIT);
    }

    // Contas a receber: FT com cliente, saldo derivado = total - SUM(customer_payments), no período seleccionado.
    const ftOrders = orders.filter((o) => o.doc_type === 'FT' && o.customer_id);
    let receivables: Array<{ customerId: string; customerName: string; remaining: number }> = [];
    if (ftOrders.length > 0) {
      const payments = await fetchInBatches<{ order_id: string; amount: number }>(client, 'customer_payments', 'order_id,amount', 'order_id', ftOrders.map((o) => o.id));
      const paidByOrder = new Map<string, number>();
      for (const p of payments) paidByOrder.set(p.order_id, (paidByOrder.get(p.order_id) ?? 0) + Number(p.amount));
      const remainingByCustomer = new Map<string, number>();
      for (const o of ftOrders) {
        const remaining = Number(o.total) - (paidByOrder.get(o.id) ?? 0);
        if (remaining > 0.0001) remainingByCustomer.set(o.customer_id as string, (remainingByCustomer.get(o.customer_id as string) ?? 0) + remaining);
      }
      if (remainingByCustomer.size > 0) {
        const ids = [...remainingByCustomer.keys()];
        const { data: customers, error: custErr } = await client.from('customers').select('id,name').in('id', ids);
        if (custErr) throw new Error(`customers: ${custErr.message}`);
        const names = new Map((customers ?? []).map((c) => [c.id, c.name as string]));
        receivables = ids
          .map((id) => ({ customerId: id, customerName: names.get(id) ?? id, remaining: remainingByCustomer.get(id) as number }))
          .sort((a, b) => b.remaining - a.remaining)
          .slice(0, BALANCES_LIMIT);
      }
    }

    // Contas a pagar: só documentos 'confirmed' (draft ainda não é dívida real — mesma
    // lógica da imutabilidade da 3D: só o confirm() cria o compromisso).
    let payables: Array<{ supplierId: string; supplierName: string; remaining: number }> = [];
    {
      let docsQuery = client
        .from('supplier_documents')
        .select('id,store_id,supplier_id,document_number,created_at')
        .eq('status', 'confirmed')
        .gte('created_at', fromIso)
        .lt('created_at', toExclusiveIso)
        .limit(DOCS_LIMIT);
      if (!isAll) docsQuery = docsQuery.eq('store_id', storeParam);
      const { data: docs, error: docsErr } = await docsQuery;
      if (docsErr) throw new Error(`supplier_documents: ${docsErr.message}`);
      if (docs && docs.length > 0) {
        const docIds = docs.map((d) => d.id);
        const [items, pays] = await Promise.all([
          fetchInBatches<{ document_id: string; quantity: number; unit_cost: number }>(client, 'supplier_document_items', 'document_id,quantity,unit_cost', 'document_id', docIds),
          fetchInBatches<{ document_id: string; amount: number }>(client, 'supplier_payments', 'document_id,amount', 'document_id', docIds),
        ]);
        const totalByDoc = new Map<string, number>();
        for (const it of items) totalByDoc.set(it.document_id, (totalByDoc.get(it.document_id) ?? 0) + Number(it.quantity) * Number(it.unit_cost));
        const paidByDoc = new Map<string, number>();
        for (const p of pays) paidByDoc.set(p.document_id, (paidByDoc.get(p.document_id) ?? 0) + Number(p.amount));
        const remainingBySupplier = new Map<string, number>();
        for (const d of docs) {
          const remaining = (totalByDoc.get(d.id) ?? 0) - (paidByDoc.get(d.id) ?? 0);
          if (remaining > 0.0001) remainingBySupplier.set(d.supplier_id, (remainingBySupplier.get(d.supplier_id) ?? 0) + remaining);
        }
        if (remainingBySupplier.size > 0) {
          const ids = [...remainingBySupplier.keys()];
          const { data: suppliers, error: supErr } = await client.from('suppliers').select('id,name').in('id', ids);
          if (supErr) throw new Error(`suppliers: ${supErr.message}`);
          const names = new Map((suppliers ?? []).map((s) => [s.id, s.name as string]));
          payables = ids
            .map((id) => ({ supplierId: id, supplierName: names.get(id) ?? id, remaining: remainingBySupplier.get(id) as number }))
            .sort((a, b) => b.remaining - a.remaining)
            .slice(0, BALANCES_LIMIT);
        }
      }
    }

    let movementsQuery = client.from('stock_movements').select('type,quantity,store_id').gte('created_at', fromIso).lt('created_at', toExclusiveIso).limit(MOVEMENTS_LIMIT);
    if (!isAll) movementsQuery = movementsQuery.eq('store_id', storeParam);
    const { data: movements, error: movementsErr } = await movementsQuery;
    if (movementsErr) throw new Error(`stock_movements: ${movementsErr.message}`);
    const movementsTruncated = (movements ?? []).length === MOVEMENTS_LIMIT;
    const stockMap = new Map<string, { count: number; quantity: number }>();
    for (const m of movements ?? []) {
      const cur = stockMap.get(m.type) ?? { count: 0, quantity: 0 };
      cur.count += 1;
      cur.quantity += Number(m.quantity);
      stockMap.set(m.type, cur);
    }
    const stockSummary = [...stockMap.entries()].map(([type, v]) => ({ type, ...v }));

    return NextResponse.json({
      period: { from, to },
      storeScope: isAll ? 'all' : storeParam,
      truncated: { orders: ordersTruncated, stockMovements: movementsTruncated },
      totals: { totalSold, documentCount, avgTicket },
      byPaymentMethod,
      byStore,
      receivables,
      payables,
      stockSummary,
      topProducts,
    });
  } catch (err) {
    return NextResponse.json({ error: 'Falha ao calcular o dashboard.', detail: (err as Error).message }, { status: 500 });
  }
}
