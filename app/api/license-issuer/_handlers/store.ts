import { NextResponse } from 'next/server';
import { dbErrorMessage, readLicenseIssuerStore, resolveSupabaseAdmin } from '@/lib/licenseIssuerDb';
import { assertIssuerRequest, issuerSupabaseUnavailableResponse } from '../_utils';

export async function GET(request: Request) {
  const denied = assertIssuerRequest(request);
  if (denied) return denied;

  const supabase = resolveSupabaseAdmin();
  if (!supabase) return issuerSupabaseUnavailableResponse();

  try {
    const store = await readLicenseIssuerStore(supabase);
    return NextResponse.json(store);
  } catch (err) {
    return NextResponse.json(
      {
        error: dbErrorMessage(
          err,
          'Aplique supabase/migrations/20260521_posly_license_issuer.sql.',
        ),
      },
      { status: 502 },
    );
  }
}
