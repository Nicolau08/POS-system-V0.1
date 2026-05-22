import { NextResponse } from 'next/server';
import {
  parseJsonOrBase64License,
  resolveAuthoritativeLicenseExpiration,
  verifySignedMachineLicense,
} from '@/lib/licensing/signMachineLicense';
import { normalizeLicensePlan } from '@/lib/licensing/normalizeLicenseMeta';
import { isGenericStoreName, pickStoreDisplayName, storeNameFromLicensePayload } from '@/lib/storeDisplayName';
import {
  dbErrorMessage,
  findLicenseClientByTenantId,
  findLicenseVoucherByNonce,
  resolveSupabaseAdmin,
} from '@/lib/licenseIssuerDb';
import { issuerMissingSecretResponse, issuerSupabaseUnavailableResponse, resolveLicenseHmacSecret } from '../_utils';

/**
 * O POS consulta a consola para obter a validade actual (pos_tenant_registry / voucher).
 * Não exige licença não expirada — permite prolongar na consola e sincronizar no cliente.
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
    return NextResponse.json({ error: 'license_key é obrigatório.' }, { status: 400 });
  }

  const parsed = parseJsonOrBase64License(rawKey);
  if (!parsed) {
    return NextResponse.json({ error: 'Não foi possível ler a licença.' }, { status: 400 });
  }

  const verified = verifySignedMachineLicense(parsed, secret);
  if (!verified.ok) {
    return NextResponse.json({ error: verified.error }, { status: 400 });
  }

  const rec = parsed as Record<string, unknown>;
  const tenantId = verified.license.tenant_id;
  const nonce = String(rec.voucher_nonce ?? '').trim();
  let registryDisplayName: string | null = null;
  let registryExpires: string | null = null;
  let voucherExpires: string | null = null;
  let nuit: string | null = null;
  let plan: string | null = null;
  let clientName: string | null = null;

  try {
    const { data: reg, error: regErr } = await supabase
      .from('pos_tenant_registry')
      .select('display_name, license_expires_at')
      .eq('tenant_id', tenantId)
      .maybeSingle();
    if (regErr) throw new Error(regErr.message);
    if (reg?.display_name) registryDisplayName = String(reg.display_name).trim();
    if (reg?.license_expires_at) registryExpires = new Date(reg.license_expires_at).toISOString();

    if (nonce) {
      const voucher = await findLicenseVoucherByNonce(supabase, nonce);
      if (voucher?.expiration) voucherExpires = voucher.expiration;
    }

    if (
      voucherExpires &&
      registryExpires &&
      Date.parse(voucherExpires) !== Date.parse(registryExpires)
    ) {
      const repaired = new Date(voucherExpires).toISOString();
      registryExpires = repaired;
      const { error: repairErr } = await supabase
        .from('pos_tenant_registry')
        .update({ license_expires_at: repaired, updated_at: new Date().toISOString() })
        .eq('tenant_id', tenantId);
      if (repairErr) {
        console.warn('[device-status] registry date repair:', repairErr.message);
      }
    }

    const client = await findLicenseClientByTenantId(supabase, tenantId);
    if (client) {
      if (client.nuit) nuit = client.nuit;
      if (client.plan) plan = client.plan;
      if (client.name) clientName = String(client.name).trim();
    }

  } catch (err) {
    return NextResponse.json(
      { error: dbErrorMessage(err, 'Aplique supabase/migrations/20260513_pos_tenant_registry.sql.') },
      { status: 502 },
    );
  }

  const licenseExpiresAt = resolveAuthoritativeLicenseExpiration({
    licenseFileExpiration: verified.license.expiration,
    registryExpiration: registryExpires,
    voucherExpiration: voucherExpires,
  });

  const displayName = pickStoreDisplayName(
    clientName,
    registryDisplayName,
    storeNameFromLicensePayload(rec),
  );

  if (
    clientName &&
    !isGenericStoreName(displayName) &&
    registryDisplayName !== displayName
  ) {
    const { error: nameRepairErr } = await supabase
      .from('pos_tenant_registry')
      .update({ display_name: displayName, updated_at: new Date().toISOString() })
      .eq('tenant_id', tenantId);
    if (nameRepairErr) {
      console.warn('[device-status] registry name repair:', nameRepairErr.message);
    }
  }

  return NextResponse.json({
    success: true,
    tenant_id: tenantId,
    machine_id: verified.license.machine_id,
    display_name: displayName,
    nuit,
    plan: plan ? normalizeLicensePlan(plan) : null,
    license_expires_at: licenseExpiresAt,
    sources: {
      license_file: verified.license.expiration,
      registry: registryExpires,
      voucher: voucherExpires,
    },
  });
}
