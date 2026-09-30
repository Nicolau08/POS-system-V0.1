/**
 * Etapa 1G.4 Fase 8 — passo 1 do primeiro acesso: trocar a password temporária. Exige
 * sessão válida com primeiro acesso por concluir (nunca 'ok' — já concluído; nunca
 * unauthenticated/forbidden). admin.updateUserById corre sempre server-side com
 * service_role — nunca há forma de um browser trocar a password de outro utilizador
 * (o id vem sempre da PRÓPRIA sessão resolvida aqui, nunca do corpo do pedido).
 */
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { anonClient, ACCESS_COOKIE, REFRESH_COOKIE, COOKIE_OPTIONS } from '@/lib/session';
import { getDetailedSession, serviceRoleClient } from '@/lib/serverSession';

const MIN_LENGTH = 8;

export async function POST(req: Request) {
  const session = await getDetailedSession();
  if (session.status === 'unauthenticated') return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });
  if (session.status === 'forbidden') return NextResponse.json({ error: 'Sem acesso.' }, { status: 403 });
  if (session.status === 'ok') return NextResponse.json({ error: 'Primeiro acesso já concluído.' }, { status: 409 });

  let body: { newPassword?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Pedido inválido.' }, { status: 400 });
  }
  const newPassword = String(body.newPassword ?? '');
  if (newPassword.length < MIN_LENGTH) {
    return NextResponse.json({ error: `A nova password tem de ter pelo menos ${MIN_LENGTH} caracteres.` }, { status: 400 });
  }

  const svc = serviceRoleClient();
  const { data: row, error: rowErr } = await svc.from('backoffice_users').select('auth_internal_email').eq('user_id', session.user.userId).maybeSingle();
  if (rowErr || !row?.auth_internal_email) return NextResponse.json({ error: 'Falha ao ler a conta.' }, { status: 500 });

  const { error: authErr } = await svc.auth.admin.updateUserById(session.user.userId, { password: newPassword });
  if (authErr) return NextResponse.json({ error: 'Falha ao definir a nova password.' }, { status: 500 });

  const { error: dbErr } = await svc.from('backoffice_users').update({ must_change_password: false }).eq('user_id', session.user.userId);
  if (dbErr) return NextResponse.json({ error: 'Password alterada, mas falhou a actualizar o estado.' }, { status: 500 });

  // admin.updateUserById invalida o access token que estava na cookie (troca de
  // password revoga as sessões existentes no GoTrue) — sem reautenticar aqui, o
  // utilizador ficaria "deslogado a meio" do próprio fluxo de primeiro acesso. Login
  // silencioso com a password nova para emitir cookies frescas antes de responder.
  const { data: signIn, error: signInErr } = await anonClient().auth.signInWithPassword({ email: row.auth_internal_email, password: newPassword });
  if (signInErr || !signIn.session) return NextResponse.json({ error: 'Password alterada, mas falhou a renovar a sessão. Entre novamente.' }, { status: 500 });

  const store = await cookies();
  store.set(ACCESS_COOKIE, signIn.session.access_token, COOKIE_OPTIONS);
  store.set(REFRESH_COOKIE, signIn.session.refresh_token, COOKIE_OPTIONS);

  return NextResponse.json({ ok: true });
}
