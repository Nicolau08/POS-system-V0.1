import { NextResponse } from 'next/server';
import { parseExpirationToIso } from '@/lib/licensing/signMachineLicense';
import { dbErrorMessage, resolveSupabaseAdmin } from '@/lib/licenseIssuerDb';
import {
  assertIssuerRequest,
  issuerSupabaseUnavailableResponse,
} from '../_utils';

/**
 * Definir data de término de uma loja já activada (pos_tenant_registry).
 * Preferir PATCH /api/license-issuer/voucher com voucher_id. O POS sincroniza via device-status.
 */
export async function PATCH(request: Request) {
  const denied = assertIssuerRequest(request);
  if (denied) return denied;

  const supabase = resolveSupabaseAdmin();
  if (!supabase) return issuerSupabaseUnavailableResponse();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON inválido.' }, { status: 400 });
  }

  const record = body as { tenant_id?: unknown; license_expires_at?: unknown; expires_at?: unknown };
  const tenantId = String(record.tenant_id ?? '').trim();
  const expiresRaw = record.license_expires_at ?? record.expires_at;

  if (!tenantId) {
    return NextResponse.json({ error: 'tenant_id é obrigatório.' }, { status: 400 });
  }

  const expirationIso = parseExpirationToIso(expiresRaw);
  if (!expirationIso) {
    return NextResponse.json({ error: 'Data de expiração inválida.' }, { status: 400 });
  }

  const now = new Date().toISOString();

  try {
    const { error: regErr } = await supabase
      .from('pos_tenant_registry')
      .update({ license_expires_at: expirationIso, updated_at: now })
      .eq('tenant_id', tenantId);
    if (regErr) throw new Error(regErr.message);

    const { error: voucherErr } = await supabase
      .from('license_vouchers')
      .update({ expiration: expirationIso })
      .eq('tenant_id', tenantId)
      .not('redeemed_machine_id', 'is', null);
    if (voucherErr) throw new Error(voucherErr.message);
  } catch (err) {
    return NextResponse.json(
      {
        error: dbErrorMessage(
          err,
          'Confirme pos_tenant_registry e license_vouchers no Supabase.',
        ),
      },
      { status: 502 },
    );
  }

  return NextResponse.json({
    success: true,
    tenant_id: tenantId,
    license_expires_at: expirationIso,
  });
}
