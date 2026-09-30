/**
 * Etapa 1G.4 Fase 3E — detalhe de VD/FT (items + recebimentos + saldo derivado).
 * paid=SUM(customer_payments); remaining=orders.total-paid. Nunca guardado, sempre lido.
 */
import { NextResponse } from 'next/server';
import { getSessionClient } from '@/lib/serverSession';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSessionClient();
  if (session.status === 'unauthenticated') return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });
  if (session.status === 'forbidden') return NextResponse.json({ error: 'Sem acesso.' }, { status: 403 });

  const { id } = await params;
  const { data: order, error: orderErr } = await session.client
    .from('orders')
    .select('id,store_id,customer_id,doc_type,document_number,status,subtotal,discount,tax,total,payment_method,created_at')
    .eq('id', id)
    .maybeSingle();
  if (orderErr) return NextResponse.json({ error: 'Falha ao ler documento.' }, { status: 500 });
  if (!order) return NextResponse.json({ error: 'Documento não encontrado.' }, { status: 404 });

  const { data: items } = await session.client.from('order_items').select('id,product_id,product_name,quantity,price,discount_amount').eq('order_id', id);
  const { data: payments } = await session.client.from('customer_payments').select('id,amount,method,paid_at').eq('order_id', id).order('paid_at');

  const paid = (payments ?? []).reduce((s, p) => s + Number(p.amount), 0);
  const total = Number(order.total);
  const remaining = total - paid;
  const paymentStatus = remaining <= 0 && total > 0 ? 'paid' : paid > 0 ? 'partial' : 'pending';

  return NextResponse.json({
    order,
    items: items ?? [],
    payments: payments ?? [],
    total,
    paid,
    remaining,
    paymentStatus,
  });
}
