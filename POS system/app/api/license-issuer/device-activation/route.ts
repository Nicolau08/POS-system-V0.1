import { NextResponse } from 'next/server';
import {
  parseJsonOrBase64License,
  verifySignedMachineLicense,
} from '@/lib/licensing/signMachineLicense';
import { normalizeLicensePlan } from '@/lib/licensing/normalizeLicenseMeta';
import { pickStoreDisplayName, storeNameFromLicensePayload } from '@/lib/storeDisplayName';
import {
  dbErrorMessage,
  findLicenseClientById,
  findLicenseClientByTenantId,
  findLicenseVoucherByNonce,
  redeemLicenseVoucher,
  resolveSupabaseAdmin,
} from '@/lib/licenseIssuerDb';
import { issuerMissingSecretResponse, issuerSupabaseUnavailableResponse, resolveLicenseHmacSecret } from '../_utils';

function displayNameFromLicense(rec: Record<string, unknown>, clientName: string | null) {
  return pickStoreDisplayName(clientName, storeNameFromLicensePayload(rec));
}

/**
 * Chamado pelo POS (API local) após ativar licença: autenticação = assinatura HMAC válida
 * da licença final (sem token de admin). Marca voucher como resgatado e regista tenant no Supabase.
 */
export async function POST(request: Request) {
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
    return NextResponse.json(
      { error: 'license_key é obrigatório (JSON ou Base64 da licença gravada no POS).' },
      { status: 400 },
    );
  }

  const parsed = parseJsonOrBase64License(rawKey);
  if (!parsed) {
    return NextResponse.json({ error: 'Não foi possível ler a licença.' }, { status: 400 });
  }

  const verified = verifySignedMachineLicense(parsed, secret);
  if (!verified.ok) {
    return NextResponse.json({ error: verified.error }, { status: 400 });
  }

  const expMs = Date.parse(verified.license.expiration);
  if (Number.isNaN(expMs) || Date.now() > expMs) {
    return NextResponse.json({ error: 'Licença expirada.' }, { status: 400 });
  }

  const rec = parsed as Record<string, unknown>;
  const nonce = String(rec.voucher_nonce ?? '').trim();
  let voucherClientId: string | null = null;
  let clientName: string | null = null;
  let clientNuit: string | null = null;
  let clientPlan = 'LITE';

  if (nonce) {
    try {
      const voucher = await findLicenseVoucherByNonce(supabase, nonce);
      if (!voucher) {
        return NextResponse.json(
          {
            error:
              'Nenhum código pendente corresponde a este voucher_nonce. Confirme que a consola usa o mesmo Supabase (migração 20260521_posly_license_issuer.sql).',
          },
          { status: 404 },
        );
      }
      voucherClientId = voucher.client_id;
      const redeem = await redeemLicenseVoucher(supabase, nonce, verified.license.machine_id);
      if (!redeem.ok) {
        return NextResponse.json({ error: redeem.error }, { status: redeem.status });
      }
    } catch (err) {
      return NextResponse.json(
        { error: dbErrorMessage(err, 'Aplique supabase/migrations/20260521_posly_license_issuer.sql.') },
        { status: 502 },
      );
    }
  }

  try {
    const byId = voucherClientId ? await findLicenseClientById(supabase, voucherClientId) : null;
    const client =
      byId ?? (await findLicenseClientByTenantId(supabase, verified.license.tenant_id));
    if (client?.name) clientName = String(client.name).trim();
    if (client?.nuit) clientNuit = String(client.nuit).trim();
    if (client?.plan) clientPlan = normalizeLicensePlan(client.plan);
  } catch {
    // metadados opcionais para registo
  }

  let registryExpiresAt = new Date(verified.license.expiration).toISOString();
  if (nonce) {
    try {
      const voucher = await findLicenseVoucherByNonce(supabase, nonce);
      if (voucher?.expiration) registryExpiresAt = voucher.expiration;
    } catch {
      // mantém expiração da licença final
    }
  }

  const displayName = displayNameFromLicense(rec, clientName);
  const row = {
    tenant_id: verified.license.tenant_id,
    display_name: displayName,
    machine_id: verified.license.machine_id,
    license_expires_at: registryExpiresAt,
    voucher_nonce: nonce || null,
    nuit: clientNuit,
    plan: clientPlan,
    updated_at: new Date().toISOString(),
  };
  const { error } = await supabase.from('pos_tenant_registry').upsert(row, { onConflict: 'tenant_id' });
  if (error) {
    return NextResponse.json(
      {
        error: `Falha ao registar tenant no Supabase: ${error.message}. Aplique a migração 20260513_pos_tenant_registry.sql no projecto.`,
        tenant_id: verified.license.tenant_id,
        machine_id: verified.license.machine_id,
      },
      { status: 502 },
    );
  }

  return NextResponse.json({
    success: true,
    tenant_id: verified.license.tenant_id,
    machine_id: verified.license.machine_id,
    display_name: displayName,
    voucher_redeemed: Boolean(nonce),
    supabase: 'provisioned',
  });
}
