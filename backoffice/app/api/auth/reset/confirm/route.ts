/**
 * Etapa 1G.4 Fase 8 — confirmação de "esqueci a senha". Rota pública por desenho (mesmo
 * motivo do verify-email): a prova de identidade é o token, nunca uma cookie de sessão.
 */
import { NextResponse } from 'next/server';
import { serviceRoleClient } from '@/lib/serverSession';
import { hashToken } from '@/lib/authTokens';

const MIN_LENGTH = 8;

export async function POST(req: Request) {
  let body: { token?: string; newPassword?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Pedido inválido.' }, { status: 400 });
  }
  const token = String(body.token ?? '').trim();
  const newPassword = String(body.newPassword ?? '');
  if (!token) return NextResponse.json({ error: 'Token em falta.' }, { status: 400 });
  if (newPassword.length < MIN_LENGTH) {
    return NextResponse.json({ error: `A nova password tem de ter pelo menos ${MIN_LENGTH} caracteres.` }, { status: 400 });
  }

  const svc = serviceRoleClient();
  const { data: row, error } = await svc
    .from('backoffice_auth_tokens')
    .select('id,user_id,expires_at,used_at')
    .eq('purpose', 'password_reset')
    .eq('token_hash', hashToken(token))
    .maybeSingle();
  if (error || !row) return NextResponse.json({ error: 'Token inválido.' }, { status: 400 });
  if (row.used_at) return NextResponse.json({ error: 'Token já utilizado.' }, { status: 400 });
  if (new Date(row.expires_at).getTime() < Date.now()) return NextResponse.json({ error: 'Token expirado.' }, { status: 400 });

  const { data: marked, error: markErr } = await svc
    .from('backoffice_auth_tokens')
    .update({ used_at: new Date().toISOString() })
    .eq('id', row.id)
    .is('used_at', null)
    .select('id');
  if (markErr || !marked || marked.length === 0) return NextResponse.json({ error: 'Token já utilizado.' }, { status: 400 });

  const { error: authErr } = await svc.auth.admin.updateUserById(row.user_id, { password: newPassword });
  if (authErr) return NextResponse.json({ error: 'Falha ao definir a nova password.' }, { status: 500 });

  return NextResponse.json({ ok: true });
}
