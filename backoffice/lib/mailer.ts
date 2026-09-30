/**
 * Etapa 1G.4 Fase 10 — SMTP real. Configuração só por ENV (SMTP_HOST/PORT/SECURE/USER/
 * PASSWORD/MAIL_FROM) — nunca credenciais no código. Em produção, sem SMTP configurado é
 * "fail closed": nunca finge sucesso nem cai silenciosamente para o stub de log — atira
 * um erro explícito, para o chamador decidir como reagir (nunca "enviámos" quando não
 * enviou nada). DEV_MAIL_ECHO só é honrado fora de produção, mesmo que alguém o defina
 * por engano num ambiente de produção mal configurado.
 */
import nodemailer, { type Transporter } from 'nodemailer';

export type MailResult = { devEcho: boolean };

function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}

type SmtpConfig = { host: string; port: number; secure: boolean; user: string; password: string; from: string };

function resolveSmtpConfig(): SmtpConfig | null {
  const host = String(process.env.SMTP_HOST || '').trim();
  const user = String(process.env.SMTP_USER || '').trim();
  const password = String(process.env.SMTP_PASSWORD || '').trim();
  const from = String(process.env.MAIL_FROM || '').trim();
  if (!host || !user || !password || !from) return null;
  const port = Number(process.env.SMTP_PORT || 587);
  const secure = String(process.env.SMTP_SECURE || '').trim().toLowerCase() === 'true';
  return { host, port, secure, user, password, from };
}

let cachedTransporter: { key: string; transporter: Transporter } | null = null;

function getTransporter(config: SmtpConfig): Transporter {
  const key = `${config.host}:${config.port}:${config.secure}:${config.user}`;
  if (cachedTransporter && cachedTransporter.key === key) return cachedTransporter.transporter;
  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: { user: config.user, pass: config.password },
  });
  cachedTransporter = { key, transporter };
  return transporter;
}

export async function sendMail({ to, subject, text }: { to: string; subject: string; text: string }): Promise<MailResult> {
  const config = resolveSmtpConfig();
  const devEcho = !isProduction() && process.env.BACKOFFICE_DEV_MAIL_ECHO === 'true';

  if (config) {
    const transporter = getTransporter(config);
    await transporter.sendMail({ from: config.from, to, subject, text });
    return { devEcho };
  }

  if (isProduction()) {
    // Fail closed — nunca finge que enviou. O chamador decide como reagir (erro visível
    // num fluxo autenticado; log server-side + resposta genérica num fluxo anónimo, para
    // não vazar "o mailer está em baixo" a quem está a tentar adivinhar contas).
    throw new Error('mailer_not_configured');
  }

  // Dev sem SMTP configurado — stub de sempre: regista no log, nunca envia de verdade.
  console.log(`[dev-mail] to=${to} subject=${subject}\n${text}`);
  return { devEcho };
}
