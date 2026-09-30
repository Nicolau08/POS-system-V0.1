/**
 * Etapa 1G.4 Fase 2 — lista as Stores que a sessão actual pode ver. Usa service_role
 * server-side (public.stores nunca concede SELECT a `authenticated` — fronteira do
 * Device Auth, intocada) mas SEMPRE filtrado pela membership já resolvida por
 * getCurrentUser(): owner -> todo o tenant; store_operator -> só as atribuídas (lidas com
 * a PRÓPRIA sessão do utilizador, via RLS self-only, nunca com service_role).
 */
import { NextResponse } from 'next/server';
import { getCurrentSession, serviceRoleClient } from '@/lib/serverSession';
import { ACCESS_COOKIE, sessionedClient } from '@/lib/session';
import { cookies } from 'next/headers';

export async function GET() {
  const session = await getCurrentSession();
  if (session.status === 'unauthenticated') return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });
  if (session.status === 'forbidden') return NextResponse.json({ error: 'Sem acesso.' }, { status: 403 });
  const user = session.user;

  const svc = serviceRoleClient();

  if (user.role === 'owner') {
    const { data, error } = await svc.from('stores').select('id,name').eq('tenant_id', user.tenantId).order('name');
    if (error) return NextResponse.json({ error: 'Falha ao listar Stores.' }, { status: 500 });
    return NextResponse.json({ stores: data ?? [] });
  }

  // store_operator: primeiro as Stores atribuídas, com a PRÓPRIA sessão (RLS self-only).
  const store = await cookies();
  const accessToken = store.get(ACCESS_COOKIE)?.value as string;
  const { data: assigned, error: assignedErr } = await sessionedClient(accessToken)
    .from('backoffice_user_stores')
    .select('store_id')
    .eq('user_id', user.userId);
  if (assignedErr) return NextResponse.json({ error: 'Falha ao listar Stores.' }, { status: 500 });
  const storeIds = (assigned ?? []).map((r) => r.store_id);
  if (storeIds.length === 0) return NextResponse.json({ stores: [] });

  const { data, error } = await svc.from('stores').select('id,name').in('id', storeIds).eq('tenant_id', user.tenantId).order('name');
  if (error) return NextResponse.json({ error: 'Falha ao listar Stores.' }, { status: 500 });
  return NextResponse.json({ stores: data ?? [] });
}
