/**
 * Etapa 1G.4 Fase 3E — registar recebimento de cliente (conta corrente). Sempre pela
 * RPC backoffice_pay_customer_order (única que valida doc_type/status/saldo/overpayment);
 * nunca escreve orders.
 */
import { NextResponse } from 'next/server';
import { getSessionClient } from '@/lib/serverSession';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSessionClient();
  if (session.status === 'unauthenticated') return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });
  if (session.status === 'forbidden') return NextResponse.json({ error: 'Sem acesso.' }, { status: 403 });

  const { id } = await params;
  let body: { customerId?: string; amount?: number; method?: string | null; idempotencyKey?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Pedido inválido.' }, { status: 400 });
  }
  const customerId = String(body.customerId ?? '').trim();
  const amount = Number(body.amount);
  const idempotencyKey = String(body.idempotencyKey ?? '').trim();
  if (!customerId) return NextResponse.json({ error: 'Cliente é obrigatório.' }, { status: 400 });
  if (!Number.isFinite(amount) || amount <= 0) return NextResponse.json({ error: 'Valor tem de ser maior que zero.' }, { status: 400 });
  if (!idempotencyKey) return NextResponse.json({ error: 'Pedido inválido (sem chave de idempotência).' }, { status: 400 });

  const { data, error } = await session.client.rpc('backoffice_pay_customer_order', {
    p_order_id: id,
    p_customer_id: customerId,
    p_amount: amount,
    p_method: body.method ?? null,
    p_idempotency_key: idempotencyKey,
  });
  if (error) {
    const msg = String(error.message ?? '');
    const status = /store_not_authorized|unauthenticated_or_no_access/.test(msg) ? 403 : /order_not_found/.test(msg) ? 404 : 400;
    return NextResponse.json({ error: 'Falha ao registar recebimento.', detail: msg }, { status });
  }
  const row = Array.isArray(data) ? data[0] : data;
  return NextResponse.json({ id: row?.out_id, status: row?.out_status, remaining: row?.out_remaining });
}
