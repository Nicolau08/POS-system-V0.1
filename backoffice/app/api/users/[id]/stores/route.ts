/**
 * Etapa 1G.4 Fase 9 — substitui o conjunto de Stores atribuídas a um store_operator.
 */
import { NextResponse } from 'next/server';
import { getSessionClient } from '@/lib/serverSession';

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSessionClient();
  if (session.status === 'unauthenticated') return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });
  if (session.status === 'forbidden') return NextResponse.json({ error: 'Sem acesso.' }, { status: 403 });
  if (session.user.role !== 'owner') return NextResponse.json({ error: 'Só o owner gere utilizadores.' }, { status: 403 });

  const { id } = await params;
  let body: { storeIds?: string[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Pedido inválido.' }, { status: 400 });
  }
  const storeIds = Array.isArray(body.storeIds) ? body.storeIds.filter((s) => typeof s === 'string' && s) : [];

  const { error } = await session.client.rpc('backoffice_set_user_stores', { p_user_id: id, p_store_ids: storeIds });
  if (error) {
    const msg = String(error.message ?? '');
    if (/owner_has_all_stores/.test(msg)) return NextResponse.json({ error: 'Um owner já tem acesso a todas as Stores do Tenant.' }, { status: 400 });
    if (/store_not_in_tenant/.test(msg)) return NextResponse.json({ error: 'Uma das Stores não pertence a este Tenant.' }, { status: 400 });
    if (/user_not_in_tenant/.test(msg)) return NextResponse.json({ error: 'Utilizador não encontrado neste Tenant.' }, { status: 404 });
    return NextResponse.json({ error: `Falha ao alterar Stores: ${msg}` }, { status: 500 });
  }

  return NextResponse.json({ ok: true, storeIds });
}
