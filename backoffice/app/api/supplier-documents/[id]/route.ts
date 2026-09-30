/**
 * Etapa 1G.4 Fase 3D — detalhe de um documento de fornecedor (com items e saldo pago).
 */
import { NextResponse } from 'next/server';
import { getSessionClient } from '@/lib/serverSession';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSessionClient();
  if (session.status === 'unauthenticated') return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });
  if (session.status === 'forbidden') return NextResponse.json({ error: 'Sem acesso.' }, { status: 403 });

  const { id } = await params;
  const { data: doc, error: docErr } = await session.client.from('supplier_documents').select('id,store_id,supplier_id,document_number,status,created_at,confirmed_at').eq('id', id).maybeSingle();
  if (docErr) return NextResponse.json({ error: 'Falha ao ler documento.' }, { status: 500 });
  if (!doc) return NextResponse.json({ error: 'Documento não encontrado.' }, { status: 404 });

  const { data: items } = await session.client.from('supplier_document_items').select('id,product_id,quantity,unit_cost').eq('document_id', id);
  const { data: payments } = await session.client.from('supplier_payments').select('id,amount,method,paid_at').eq('document_id', id).order('paid_at');

  const total = (items ?? []).reduce((s, it) => s + Number(it.quantity) * Number(it.unit_cost), 0);
  const paid = (payments ?? []).reduce((s, p) => s + Number(p.amount), 0);

  const productIds = [...new Set((items ?? []).map((i) => i.product_id))];
  let names = new Map<string, string>();
  if (productIds.length > 0) {
    const { data: products } = await session.client.from('products').select('id,name').in('id', productIds);
    names = new Map((products ?? []).map((p) => [p.id, p.name]));
  }

  return NextResponse.json({
    document: doc,
    items: (items ?? []).map((it) => ({ ...it, productName: names.get(it.product_id) ?? it.product_id })),
    payments: payments ?? [],
    total,
    paid,
    remaining: total - paid,
  });
}
