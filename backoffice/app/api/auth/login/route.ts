/**
 * Etapa 1G.4 Fase 8 — login por NUIT+username+password. GoTrue continua a autenticar por
 * email por baixo (auth_internal_email, opaco, nunca mostrado) — NUIT só localiza o
 * Tenant (nunca autoriza), username só localiza a linha dentro desse Tenant. A resolução
 * NUIT/username->auth_internal_email corre sempre PRÉ-sessão (o utilizador ainda não
 * está autenticado nesse momento), por isso usa sempre serviceRoleClient() aqui, nunca
 * anon/RLS. Sem self-registration: só signInWithPassword, nunca signUp.
 *
 * Erro de credenciais é SEMPRE a mesma frase genérica, independente do motivo exacto
 * (NUIT inexistente, username inexistente, password errada, conta desactivada) — nunca
 * dar pistas a quem tentar adivinhar.
 */
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { anonClient, COOKIE_OPTIONS, ACCESS_COOKIE, REFRESH_COOKIE, resolveDetailedSession } from '@/lib/session';
import { serviceRoleClient } from '@/lib/serverSession';

const INVALID_CREDENTIALS = 'NUIT, utilizador ou senha inválidos.';

export async function POST(req: Request) {
  let body: { nuit?: string; username?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Pedido inválido.' }, { status: 400 });
  }
  const nuit = String(body.nuit ?? '').trim();
  const username = String(body.username ?? '').trim();
  const password = String(body.password ?? '');
  if (!nuit || !username || !password) {
    return NextResponse.json({ error: 'NUIT, utilizador e palavra-passe são obrigatórios.' }, { status: 400 });
  }

  const svc = serviceRoleClient();

  const { data: tenant } = await svc.from('tenants').select('id').eq('nuit', nuit).maybeSingle();
  if (!tenant) return NextResponse.json({ error: INVALID_CREDENTIALS }, { status: 401 });

  const { data: membership } = await svc
    .from('backoffice_users')
    .select('auth_internal_email,status')
    .eq('tenant_id', tenant.id)
    .ilike('username', username)
    .maybeSingle();
  if (!membership || membership.status !== 'active' || !membership.auth_internal_email) {
    return NextResponse.json({ error: INVALID_CREDENTIALS }, { status: 401 });
  }

  const { data, error } = await anonClient().auth.signInWithPassword({ email: membership.auth_internal_email, password });
  if (error || !data.session) {
    return NextResponse.json({ error: INVALID_CREDENTIALS }, { status: 401 });
  }

  const detailed = await resolveDetailedSession(data.session.access_token);
  if (detailed.status === 'unauthenticated' || detailed.status === 'forbidden') {
    // Sessão Supabase Auth válida mas sem membership activa nesse instante (corrida rara
    // com uma desactivação) — mesmo tratamento "sem pistas" do login normal.
    return NextResponse.json({ error: INVALID_CREDENTIALS }, { status: 401 });
  }

  const store = await cookies();
  store.set(ACCESS_COOKIE, data.session.access_token, COOKIE_OPTIONS);
  store.set(REFRESH_COOKIE, data.session.refresh_token, COOKIE_OPTIONS);

  return NextResponse.json({
    tenantId: detailed.user.tenantId,
    role: detailed.user.role,
    username: detailed.user.username,
    firstAccessRequired: detailed.status === 'first_access_required',
  });
}
