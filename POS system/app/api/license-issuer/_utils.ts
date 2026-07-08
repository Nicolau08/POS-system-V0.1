import { NextResponse } from 'next/server';

export function resolveLicenseHmacSecret(): string {
  return String(process.env.POS_LICENSE_HMAC_SECRET || process.env.LICENSE_HMAC_SECRET || '').trim();
}

export function resolveIssuerAdminToken(): string {
  return String(process.env.LICENSE_ISSUER_ADMIN_TOKEN || '').trim();
}

export function issuerMisconfiguredResponse() {
  return NextResponse.json(
    {
      error:
        'Servidor sem LICENSE_ISSUER_ADMIN_TOKEN. Defina no .env.local (ferramenta interna).',
    },
    { status: 503 },
  );
}

export function issuerUnauthorizedResponse() {
  return NextResponse.json({ error: 'Token inválido ou ausente.' }, { status: 401 });
}

export function issuerMissingSecretResponse() {
  return NextResponse.json(
    {
      error:
        'POS_LICENSE_HMAC_SECRET (ou LICENSE_HMAC_SECRET) não definido — deve coincidir com o POS/Electron.',
    },
    { status: 503 },
  );
}

export function issuerSupabaseUnavailableResponse() {
  return NextResponse.json(
    {
      error:
        'Consola de licenças requer Supabase com SUPABASE_SERVICE_ROLE_KEY (role service_role no Dashboard → Settings → API). Não use a anon key nem chaves sb_publishable_*. Defina também SUPABASE_URL e aplique as migrações 20260521 / 20260522 / 20260708.',
    },
    { status: 503 },
  );
}

export function readBearerToken(request: Request): string {
  const header = request.headers.get('authorization') || '';
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1].trim() : '';
}

export function assertIssuerRequest(request: Request): Response | null {
  const expected = resolveIssuerAdminToken();
  if (!expected) return issuerMisconfiguredResponse();

  const token = readBearerToken(request);
  if (!token || token !== expected) return issuerUnauthorizedResponse();

  return null;
}
