/**
 * Etapa 1G.4 Fase 8 — confirmação do email de recuperação. Rota pública por desenho (o
 * link chega por email, pode ser aberto num browser/sessão diferente) — a prova de
 * identidade é o próprio token, nunca a cookie de sessão. Sempre server-side com
 * service_role (a tabela de tokens não tem GRANT nenhum a authenticated/anon).
 */
import { NextResponse } from 'next/server';
import { serviceRoleClient } from '@/lib/serverSession';
import { hashToken } from '@/lib/authTokens';

export async function POST(req: Request) {
  let body: { token?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Pedido inválido.' }, { status: 400 });
  }
  const token = String(body.token ?? '').trim();
  if (!token) return NextResponse.json({ error: 'Token em falta.' }, { status: 400 });

  const svc = serviceRoleClient();
  const { data: row, error } = await svc
    .from('backoffice_auth_tokens')
    .select('id,user_id,target_email,expires_at,used_at')
    .eq('purpose', 'email_verification')
    .eq('token_hash', hashToken(token))
    .maybeSingle();
  if (error || !row) return NextResponse.json({ error: 'Token inválido.' }, { status: 400 });
  if (row.used_at) return NextResponse.json({ error: 'Token já utilizado.' }, { status: 400 });
  if (new Date(row.expires_at).getTime() < Date.now()) return NextResponse.json({ error: 'Token expirado.' }, { status: 400 });

  // Defende contra um token antigo depois do email de recuperação ter sido alterado.
  const { data: user, error: userErr } = await svc.from('backoffice_users').select('recovery_email').eq('user_id', row.user_id).maybeSingle();
  if (userErr || !user || user.recovery_email !== row.target_email) {
    return NextResponse.json({ error: 'Token já não corresponde ao email de recuperação actual.' }, { status: 400 });
  }

  const { error: markErr } = await svc.from('backoffice_auth_tokens').update({ used_at: new Date().toISOString() }).eq('id', row.id).is('used_at', null);
  if (markErr) return NextResponse.json({ error: 'Falha ao confirmar o token.' }, { status: 500 });

  const { error: verifyErr } = await svc.from('backoffice_users').update({ recovery_email_verified: true }).eq('user_id', row.user_id);
  if (verifyErr) return NextResponse.json({ error: 'Falha ao confirmar o email.' }, { status: 500 });

  return NextResponse.json({ ok: true });
}
