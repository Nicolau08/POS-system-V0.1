/**
 * Etapa 1G.4 Fase 10 — mailer.ts (SMTP real + fail-closed em produção). Testa a lógica
 * de decisão isoladamente (sem SMTP real nenhum): SMTP não configurado + produção ->
 * atira; sem produção -> stub de log + devEcho; SMTP configurado -> chama
 * transporter.sendMail (mockado via mock.module, nunca liga a um servidor real).
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { test, mock, beforeEach, afterEach } from 'node:test';

// mock.module resolve a mesma path que backoffice/lib/mailer.ts resolveria para
// "nodemailer" — não a raiz do repo (que nem tem nodemailer instalado, de propósito).
// backoffice é "type":"module", por isso o import ESM real resolve para dist/esm/, não
// para o dist/cjs/ que require.resolve() devolveria. mock.module precisa do specifier
// como file:// URL (a mesma forma que o resolver ESM usa internamente).
const NODEMAILER_PATH = pathToFileURL(createRequire(new URL('../../backoffice/lib/mailer.ts', import.meta.url)).resolve('nodemailer').split('cjs').join('esm')).href;

const ENV_KEYS = ['NODE_ENV', 'SMTP_HOST', 'SMTP_PORT', 'SMTP_SECURE', 'SMTP_USER', 'SMTP_PASSWORD', 'MAIL_FROM', 'BACKOFFICE_DEV_MAIL_ECHO'];
let saved = {};

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  mock.reset();
});

test('produção sem SMTP configurado: fail closed (atira, nunca finge sucesso)', async () => {
  process.env.NODE_ENV = 'production';
  const { sendMail } = await import(`../../backoffice/lib/mailer.ts?t=${Date.now()}-a`);
  await assert.rejects(() => sendMail({ to: 'x@example.com', subject: 's', text: 't' }), /mailer_not_configured/);
});

test('dev sem SMTP configurado: stub de log, nunca envia; devEcho só com a flag', async () => {
  process.env.BACKOFFICE_DEV_MAIL_ECHO = 'true';
  const { sendMail } = await import(`../../backoffice/lib/mailer.ts?t=${Date.now()}-b`);
  const res = await sendMail({ to: 'x@example.com', subject: 's', text: 't' });
  assert.equal(res.devEcho, true);
});

test('dev sem SMTP configurado, sem a flag: devEcho false', async () => {
  const { sendMail } = await import(`../../backoffice/lib/mailer.ts?t=${Date.now()}-c`);
  const res = await sendMail({ to: 'x@example.com', subject: 's', text: 't' });
  assert.equal(res.devEcho, false);
});

test('produção com DEV_MAIL_ECHO=true por engano: nunca honrado (só fora de produção)', async () => {
  process.env.NODE_ENV = 'production';
  process.env.BACKOFFICE_DEV_MAIL_ECHO = 'true';
  process.env.SMTP_HOST = 'smtp.example.com';
  process.env.SMTP_USER = 'user';
  process.env.SMTP_PASSWORD = 'pass';
  process.env.MAIL_FROM = 'POSly <noreply@giga-it.co.mz>';

  mock.module(NODEMAILER_PATH, {
    exports: { default: { createTransport: () => ({ sendMail: async () => ({}) }) } },
  });
  const { sendMail } = await import(`../../backoffice/lib/mailer.ts?t=${Date.now()}-d`);
  const res = await sendMail({ to: 'x@example.com', subject: 's', text: 't' });
  assert.equal(res.devEcho, false, 'DEV_MAIL_ECHO nunca deve ter efeito em produção, mesmo definido por engano');
});

test('SMTP configurado: usa o transporter real (mockado) com o remetente de MAIL_FROM', async () => {
  process.env.SMTP_HOST = 'smtp.example.com';
  process.env.SMTP_PORT = '465';
  process.env.SMTP_SECURE = 'true';
  process.env.SMTP_USER = 'user@example.com';
  process.env.SMTP_PASSWORD = 'segredo';
  process.env.MAIL_FROM = 'POSly <noreply@giga-it.co.mz>';

  const sendMailMock = mock.fn(async () => ({ messageId: '1' }));
  let capturedConfig = null;
  mock.module(NODEMAILER_PATH, {
    exports: {
      default: {
        createTransport: (config) => {
          capturedConfig = config;
          return { sendMail: sendMailMock };
        },
      },
    },
  });

  const { sendMail } = await import(`../../backoffice/lib/mailer.ts?t=${Date.now()}-e`);
  await sendMail({ to: 'destino@example.com', subject: 'Assunto', text: 'Corpo' });

  assert.equal(sendMailMock.mock.calls.length, 1);
  const arg = sendMailMock.mock.calls[0].arguments[0];
  assert.equal(arg.from, 'POSly <noreply@giga-it.co.mz>');
  assert.equal(arg.to, 'destino@example.com');
  assert.equal(capturedConfig.host, 'smtp.example.com');
  assert.equal(capturedConfig.port, 465);
  assert.equal(capturedConfig.secure, true);
  assert.deepEqual(capturedConfig.auth, { user: 'user@example.com', pass: 'segredo' });
});
