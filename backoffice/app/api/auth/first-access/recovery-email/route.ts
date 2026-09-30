/**
 * Etapa 1G.4 Fase 8 — passo 2 do primeiro acesso: definir o email de recuperação e
 * disparar a verificação. Exige que a troca de password (passo 1) já tenha sido feita —
 * ordem imposta pelo servidor, nunca só pela UI.
 */
import { NextResponse } from 'next/server';
import { getDetailedSession, serviceRoleClient } from '@/lib/serverSession';
import { generateToken, hashToken, tokenExpiryIso } from '@/lib/authTokens';
import { sendMail } from '@/lib/mailer';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(req: Request) {
  const session = await getDetailedSession();
  if (session.status === 'unauthenticated') return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });
  if (session.status === 'forbidden') return NextResponse.json({ error: 'Sem acesso.' }, { status: 403 });
  if (session.status === 'ok') return NextResponse.json({ error: 'Primeiro acesso já concluído.' }, { status: 409 });
  if (session.mustChangePassword) return NextResponse.json({ error: 'Conclua primeiro a troca de password.' }, { status: 409 });

  let body: { recoveryEmail?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Pedido inválido.' }, { status: 400 });
  }
  const recoveryEmail = String(body.recoveryEmail ?? '').trim().toLowerCase();
  if (!EMAIL_RE.test(recoveryEmail)) return NextResponse.json({ error: 'Email de recuperação inválido.' }, { status: 400 });

  const svc = serviceRoleClient();
  const { error: dbErr } = await svc.from('backoffice_users').update({ recovery_email: recoveryEmail, recovery_email_verified: false }).eq('user_id', session.user.userId);
  if (dbErr) return NextResponse.json({ error: 'Falha ao gravar o email de recuperação.' }, { status: 500 });

  const token = generateToken();
  const { error: tokenErr } = await svc.from('backoffice_auth_tokens').insert({
    user_id: session.user.userId,
    purpose: 'email_verification',
    token_hash: hashToken(token),
    target_email: recoveryEmail,
    expires_at: tokenExpiryIso(30),
  });
  if (tokenErr) return NextResponse.json({ error: 'Falha ao gerar a verificação.' }, { status: 500 });

  const link = `${process.env.BACKOFFICE_PUBLIC_URL || 'http://localhost:3003'}/first-access?verifyToken=${token}`;
  let mail;
  try {
    mail = await sendMail({ to: recoveryEmail, subject: 'Verifique o seu email de recuperação — POSly Backoffice', text: `Confirme o seu email de recuperação: ${link}\n\nEste link expira em 30 minutos.` });
  } catch {
    // Fluxo autenticado (não anónimo) — sem risco de enumeração em dizer que o envio
    // falhou; é preferível a deixar o utilizador à espera de um email que nunca chega.
    return NextResponse.json({ error: 'Não foi possível enviar o email de verificação. Contacte o suporte.' }, { status: 503 });
  }

  return NextResponse.json({ ok: true, ...(mail.devEcho ? { dev: { token, link } } : {}) });
}
