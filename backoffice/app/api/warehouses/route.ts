/**
 * Etapa 1G.4 Fase 3C.1 — armazéns de uma Store (para o seletor no formulário de
 * entrada). RLS aditiva do Backoffice já filtra por Store autorizada.
 */
import { NextResponse } from 'next/server';
import { getSessionClient } from '@/lib/serverSession';

export async function GET(req: Request) {
  const session = await getSessionClient();
  if (session.status === 'unauthenticated') return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });
  if (session.status === 'forbidden') return NextResponse.json({ error: 'Sem acesso.' }, { status: 403 });

  const storeId = new URL(req.url).searchParams.get('storeId');
  if (!storeId) return NextResponse.json({ error: 'storeId é obrigatório.' }, { status: 400 });

  const { data, error } = await session.client.from('warehouses').select('id,name,is_default').eq('store_id', storeId).order('name');
  if (error) return NextResponse.json({ error: 'Falha ao listar armazéns.' }, { status: 500 });
  return NextResponse.json({ warehouses: data ?? [] });
}
