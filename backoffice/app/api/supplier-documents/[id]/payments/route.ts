/**
 * Etapa 1G.4 Fase 3D — registar pagamento a fornecedor (parcial ou total). Sempre pela
 * RPC (é a única que valida saldo/overpayment); nunca escreve stock.
 */
import { NextResponse } from 'next/server';
import { getSessionClient } from '@/lib/serverSession';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSessionClient();
  if (session.status === 'unauthenticated') return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });
  if (session.status === 'forbidden') return NextResponse.json({ error: 'Sem acesso.' }, { status: 403 });

  const { id } = await params;
  let body: { supplierId?: string; amount?: number; method?: string | null; idempotencyKey?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Pedido inválido.' }, { status: 400 });
  }
  const supplierId = String(body.supplierId ?? '').trim();
  const amount = Number(body.amount);
  const idempotencyKey = String(body.idempotencyKey ?? '').trim();
  if (!supplierId) return NextResponse.json({ error: 'Fornecedor é obrigatório.' }, { status: 400 });
  if (!Number.isFinite(amount) || amount <= 0) return NextResponse.json({ error: 'Valor tem de ser maior que zero.' }, { status: 400 });
  if (!idempotencyKey) return NextResponse.json({ error: 'Pedido inválido (sem chave de idempotência).' }, { status: 400 });

  const { data, error } = await session.client.rpc('backoffice_pay_supplier_document', {
    p_document_id: id,
    p_supplier_id: supplierId,
    p_amount: amount,
    p_method: body.method ?? null,
    p_idempotency_key: idempotencyKey,
  });
  if (error) {
    const msg = String(error.message ?? '');
    const status = /store_not_authorized/.test(msg) ? 403 : /document_not_found/.test(msg) ? 404 : 400;
    return NextResponse.json({ error: 'Falha ao registar pagamento.', detail: msg }, { status });
  }
  const row = Array.isArray(data) ? data[0] : data;
  return NextResponse.json({ id: row?.out_id, status: row?.out_status, remaining: row?.out_remaining });
}
