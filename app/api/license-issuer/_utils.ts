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
        'Consola de licenças requer Supabase. Defina SUPABASE_URL (ou NEXT_PUBLIC_SUPABASE_URL) e SUPABASE_SERVICE_ROLE_KEY no servidor Next e aplique a migração supabase/migrations/20260521_posly_license_issuer.sql no projecto.',
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
