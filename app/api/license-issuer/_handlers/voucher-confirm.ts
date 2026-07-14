import { NextResponse } from 'next/server';
import {
  parseJsonOrBase64License,
  verifySignedMachineLicense,
} from '@/lib/licensing/signMachineLicense';
import { dbErrorMessage, redeemLicenseVoucher, resolveSupabaseAdmin } from '@/lib/licenseIssuerDb';
import {
  assertIssuerRequest,
  issuerMissingSecretResponse,
  issuerSupabaseUnavailableResponse,
  resolveLicenseHmacSecret,
} from '../_utils';

export async function POST(request: Request) {
  const denied = assertIssuerRequest(request);
  if (denied) return denied;

  const secret = resolveLicenseHmacSecret();
  if (!secret) return issuerMissingSecretResponse();

  const supabase = resolveSupabaseAdmin();
  if (!supabase) return issuerSupabaseUnavailableResponse();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON inválido.' }, { status: 400 });
  }

  const rawKey = String((body as { license_key?: unknown }).license_key ?? '').trim();
  if (!rawKey) {
    return NextResponse.json({ error: 'license_key é obrigatório (JSON ou Base64 da loja).' }, { status: 400 });
  }

  const parsed = parseJsonOrBase64License(rawKey);
  if (!parsed) {
    return NextResponse.json({ error: 'Não foi possível ler a licença.' }, { status: 400 });
  }

  const rec = parsed as Record<string, unknown>;
  const nonce = String(rec.voucher_nonce ?? '').trim();
  if (!nonce) {
    return NextResponse.json(
      { error: 'Esta licença não tem voucher_nonce (não veio de um código de ativação).' },
      { status: 400 },
    );
  }

  const verified = verifySignedMachineLicense(parsed, secret);
  if (!verified.ok) {
    return NextResponse.json({ error: verified.error }, { status: 400 });
  }

  const machineId = verified.license.machine_id;

  try {
    const result = await redeemLicenseVoucher(supabase, nonce, machineId);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    if (result.already) {
      return NextResponse.json({
        success: true,
        already: true,
        voucherId: result.voucher.id,
        redeemed_machine_id: machineId,
        redeemed_at: result.voucher.redeemed_at,
      });
    }
    return NextResponse.json({
      success: true,
      voucherId: result.voucher.id,
      redeemed_machine_id: machineId,
      redeemed_at: result.voucher.redeemed_at,
    });
  } catch (err) {
    return NextResponse.json(
      { error: dbErrorMessage(err, 'Aplique supabase/migrations/20260521_posly_license_issuer.sql.') },
      { status: 502 },
    );
  }
}
