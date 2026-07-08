import { NextResponse } from 'next/server';
import {
  encodeLicenseBase64,
  materializeMachineLicenseFromVoucher,
} from '@/lib/licensing/signMachineLicense';
import { normalizeLicensePlan } from '@/lib/licensing/normalizeLicenseMeta';
import { tryParseSerialFormat } from '@/lib/licensing/serialNumber';
import {
  dbErrorMessage,
  findLicenseClientById,
  findLicenseVoucherBySerial,
  redeemLicenseVoucher,
  resolveSupabaseAdmin,
} from '@/lib/licenseIssuerDb';
import {
  issuerMissingSecretResponse,
  issuerSupabaseUnavailableResponse,
  resolveLicenseHmacSecret,
} from '../../_utils';

/**
 * Público (sem token admin): activa um serial nesta máquina.
 * Body: { serial, machine_id, tenant_id? }
 * Marca voucher como resgatado, upsert pos_tenant_registry, devolve licença assinada.
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

  const rec = body as {
    serial?: unknown;
    serial_number?: unknown;
    machine_id?: unknown;
    machineId?: unknown;
    tenant_id?: unknown;
    tenantId?: unknown;
  };

  const serial = tryParseSerialFormat(rec.serial ?? rec.serial_number);
  const machineId = String(rec.machine_id ?? rec.machineId ?? '').trim();
  const requestedTenantId = String(rec.tenant_id ?? rec.tenantId ?? '').trim();

  if (!serial) {
    return NextResponse.json(
      { error: 'Formato de número de série inválido. Use o formato X_XXXXXXXX (ex.: D_9L6WAKYU).' },
      { status: 400 },
    );
  }
  if (!machineId) {
    return NextResponse.json({ error: 'machine_id é obrigatório.' }, { status: 400 });
  }

  let voucher;
  try {
    voucher = await findLicenseVoucherBySerial(supabase, serial);
  } catch (err) {
    return NextResponse.json(
      {
        error: dbErrorMessage(
          err,
          'Aplique supabase/migrations/20260708_license_voucher_serial_number.sql.',
        ),
      },
      { status: 502 },
    );
  }

  if (!voucher) {
    return NextResponse.json({ error: 'Número de série não encontrado.' }, { status: 404 });
  }

  if (requestedTenantId && requestedTenantId !== voucher.tenant_id) {
    return NextResponse.json(
      { error: 'O tenant seleccionado não corresponde a este número de série.' },
      { status: 400 },
    );
  }

  const expMs = Date.parse(voucher.expiration);
  if (Number.isNaN(expMs) || Date.now() > expMs) {
    return NextResponse.json({ error: 'Licença expirada para este número de série.' }, { status: 400 });
  }

  let redeem;
  try {
    redeem = await redeemLicenseVoucher(supabase, voucher.nonce, machineId);
  } catch (err) {
    return NextResponse.json(
      { error: dbErrorMessage(err, 'Aplique supabase/migrations/20260521_posly_license_issuer.sql.') },
      { status: 502 },
    );
  }
  if (!redeem.ok) {
    return NextResponse.json({ error: redeem.error }, { status: redeem.status });
  }

  let clientName = voucher.tenant_id;
  let clientNuit: string | null = null;
  let clientPlan = normalizeLicensePlan('LITE');
  try {
    const client = await findLicenseClientById(supabase, voucher.client_id);
    if (client?.name) clientName = String(client.name).trim();
    if (client?.nuit) clientNuit = String(client.nuit).trim() || null;
    if (client?.plan) clientPlan = normalizeLicensePlan(client.plan);
  } catch {
    // metadados opcionais
  }

  let licensePayload: Record<string, unknown>;
  try {
    const signed = materializeMachineLicenseFromVoucher(
      { tenant_id: voucher.tenant_id, expiration: voucher.expiration },
      machineId,
      secret,
    );
    licensePayload = {
      ...signed,
      voucher_nonce: voucher.nonce,
      serial_number: serial,
      activated_at: new Date().toISOString(),
    };
  } catch {
    return NextResponse.json({ error: 'Falha ao gerar licença para esta máquina.' }, { status: 500 });
  }

  const now = new Date().toISOString();
  const registryRow = {
    tenant_id: voucher.tenant_id,
    display_name: clientName,
    machine_id: machineId,
    license_expires_at: voucher.expiration,
    voucher_nonce: voucher.nonce,
    nuit: clientNuit,
    plan: clientPlan,
    updated_at: now,
  };
  const { error: regErr } = await supabase
    .from('pos_tenant_registry')
    .upsert(registryRow, { onConflict: 'tenant_id' });
  if (regErr) {
    return NextResponse.json(
      {
        error: `Falha ao registar tenant no Supabase: ${regErr.message}. Aplique a migração do pos_tenant_registry.`,
        tenant_id: voucher.tenant_id,
        machine_id: machineId,
      },
      { status: 502 },
    );
  }

  const licenseKey = encodeLicenseBase64({
    tenant_id: String(licensePayload.tenant_id),
    machine_id: String(licensePayload.machine_id),
    expiration: String(licensePayload.expiration),
    signature: String(licensePayload.signature),
  });

  return NextResponse.json({
    success: true,
    serial,
    tenant_id: voucher.tenant_id,
    store_name: clientName,
    nuit: clientNuit,
    plan: clientPlan,
    machine_id: machineId,
    expires_at: voucher.expiration,
    license: licensePayload,
    license_key: licenseKey,
    license_json: JSON.stringify(licensePayload, null, 2),
    already_redeemed: redeem.already,
    voucher_redeemed: true,
  });
}
