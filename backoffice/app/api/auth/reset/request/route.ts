/**
 * Etapa 1G.4 Fase 8 — "Esqueci a senha": NUIT+username localizam a conta; o email só
 * serve de destino do link (nunca de login). Resposta SEMPRE genérica, exista ou não a
 * conta/NUIT/email verificado — nunca dar pistas de enumeração.
 */
import { NextResponse } from 'next/server';
import { serviceRoleClient } from '@/lib/serverSession';
import { generateToken, hashToken, tokenExpiryIso } from '@/lib/authTokens';
import { sendMail } from '@/lib/mailer';

const GENERIC_OK = { ok: true, message: 'Se os dados estiverem correctos, enviaremos instruções para o email de recuperação associado.' };

export async function POST(req: Request) {
  let body: { nuit?: string; username?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Pedido inválido.' }, { status: 400 });
  }
  const nuit = String(body.nuit ?? '').trim();
  const username = String(body.username ?? '').trim();
  if (!nuit || !username) return NextResponse.json({ error: 'NUIT e utilizador são obrigatórios.' }, { status: 400 });

  const svc = serviceRoleClient();
  const { data: tenant } = await svc.from('tenants').select('id').eq('nuit', nuit).maybeSingle();
  if (!tenant) return NextResponse.json(GENERIC_OK);

  const { data: user } = await svc
    .from('backoffice_users')
    .select('user_id,status,recovery_email,recovery_email_verified')
    .eq('tenant_id', tenant.id)
    .ilike('username', username)
    .maybeSingle();
  if (!user || user.status !== 'active' || !user.recovery_email_verified || !user.recovery_email) {
    return NextResponse.json(GENERIC_OK);
  }

  const token = generateToken();
  const { error: tokenErr } = await svc.from('backoffice_auth_tokens').insert({
    user_id: user.user_id,
    purpose: 'password_reset',
    token_hash: hashToken(token),
    target_email: user.recovery_email,
    expires_at: tokenExpiryIso(30),
  });
  if (tokenErr) return NextResponse.json(GENERIC_OK);

  const link = `${process.env.BACKOFFICE_PUBLIC_URL || 'http://localhost:3003'}/reset?token=${token}`;
  try {
    const mail = await sendMail({ to: user.recovery_email, subject: 'Recuperação de password — POSly Backoffice', text: `Defina uma nova password: ${link}\n\nEste link expira em 30 minutos. Se não pediu isto, ignore este email.` });
    return NextResponse.json({ ...GENERIC_OK, ...(mail.devEcho ? { dev: { token, link } } : {}) });
  } catch (err) {
    // Rota pública/anónima — a resposta NUNCA revela que o envio falhou (isso seria uma
    // pista de enumeração/estado interno); o erro real fica só no log do servidor.
    console.error('[reset/request] falha ao enviar email de recuperação', err);
    return NextResponse.json(GENERIC_OK);
  }
}
