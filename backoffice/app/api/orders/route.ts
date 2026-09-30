/**
 * Etapa 1G.4 Fase 3E — consulta VD/FT (public.orders). Read-only: sem GRANT de
 * escrita nunca concedido a `authenticated` nesta tabela — só create_order_with_items
 * (Device) escreve. Backoffice nunca cria/altera orders.
 */
import { NextResponse } from 'next/server';
import { getSessionClient } from '@/lib/serverSession';

export async function GET(req: Request) {
  const session = await getSessionClient();
  if (session.status === 'unauthenticated') return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });
  if (session.status === 'forbidden') return NextResponse.json({ error: 'Sem acesso.' }, { status: 403 });

  const storeId = new URL(req.url).searchParams.get('storeId');
  let query = session.client
    .from('orders')
    .select('id,store_id,customer_id,doc_type,document_number,status,total,created_at')
    .order('created_at', { ascending: false })
    .limit(100);
  if (storeId) query = query.eq('store_id', storeId);
  const { data, error } = await query;
  if (error) return NextResponse.json({ error: 'Falha ao listar documentos.' }, { status: 500 });
  return NextResponse.json({ orders: data ?? [] });
}
