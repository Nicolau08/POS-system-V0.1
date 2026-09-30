/**
 * Etapa 1G.4 Fase 3A — activar/descontinuar um produto numa Store (store_products,
 * PK (store_id, product_id)). RLS já nega uma Store não autorizada, tanto no upsert como
 * na leitura — nunca é preciso validar `storeId` contra a lista do utilizador aqui à
 * parte (ver backoffice-catalog-rls-live: "store_operator nunca escreve numa Store não
 * atribuída"). Nunca mexe em stock/ledger — só o estado active/discontinued.
 */
import { NextResponse } from 'next/server';
import { getSessionClient } from '@/lib/serverSession';

export async function PATCH(req: Request) {
  const session = await getSessionClient();
  if (session.status === 'unauthenticated') return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });
  if (session.status === 'forbidden') return NextResponse.json({ error: 'Sem acesso.' }, { status: 403 });

  let body: { storeId?: string; productId?: string; status?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Pedido inválido.' }, { status: 400 });
  }
  const storeId = String(body.storeId ?? '').trim();
  const productId = String(body.productId ?? '').trim();
  const status = String(body.status ?? '').trim();
  if (!storeId || !productId) return NextResponse.json({ error: 'storeId e productId são obrigatórios.' }, { status: 400 });
  if (status !== 'active' && status !== 'discontinued') {
    return NextResponse.json({ error: "status tem de ser 'active' ou 'discontinued'." }, { status: 400 });
  }

  const { data, error } = await session.client
    .from('store_products')
    .upsert(
      { tenant_id: session.user.tenantId, store_id: storeId, product_id: productId, status },
      { onConflict: 'store_id,product_id' }
    )
    .select('store_id,product_id,status')
    .single();
  if (error) {
    // RLS nega silenciosamente (0 linhas afectadas) para uma Store não autorizada — o
    // Postgres devolve isso como erro de policy no upsert (WITH CHECK falhou).
    return NextResponse.json({ error: 'Falha ao actualizar o estado nesta Store (sem acesso, ou dados inválidos).' }, { status: 403 });
  }
  return NextResponse.json({ storeProduct: data });
}
