import { NextResponse } from 'next/server';
import { normalizeLicensePlan } from '@/lib/licensing/normalizeLicenseMeta';
import { tryParseSerialFormat } from '@/lib/licensing/serialNumber';
import type { LicenseSerialStore } from '@/lib/licenseIssuerTypes';
import {
  dbErrorMessage,
  findLicenseClientById,
  findLicenseVoucherBySerial,
  resolveSupabaseAdmin,
} from '@/lib/licenseIssuerDb';
import { issuerSupabaseUnavailableResponse } from '../../_utils';

/**
 * Público (sem token admin): dado um número de série, devolve a(s) loja(s) associadas.
 * 1 serial = 1 loja hoje; `stores` é um array para evolução.
 */
export async function POST(request: Request) {
  const supabase = resolveSupabaseAdmin();
  if (!supabase) return issuerSupabaseUnavailableResponse();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON inválido.' }, { status: 400 });
  }

  const raw = (body as { serial?: unknown; serial_number?: unknown }).serial
    ?? (body as { serial_number?: unknown }).serial_number;
  const serial = tryParseSerialFormat(raw);
  if (!serial) {
    return NextResponse.json(
      { error: 'Formato de número de série inválido. Use o formato X_XXXXXXXX (ex.: D_9L6WAKYU).' },
      { status: 400 },
    );
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
    return NextResponse.json({ error: 'Número de série não encontrado.', stores: [] }, { status: 404 });
  }

  const expMs = Date.parse(voucher.expiration);
  if (Number.isNaN(expMs) || Date.now() > expMs) {
    return NextResponse.json({ error: 'Licença expirada para este número de série.', stores: [] }, { status: 400 });
  }

  let clientName = voucher.tenant_id;
  let clientNuit: string | null = null;
  let clientPlan = normalizeLicensePlan('LITE');

  try {
    const client = await findLicenseClientById(supabase, voucher.client_id);
    if (client?.name) clientName = String(client.name).trim();
    if (client?.nuit) clientNuit = String(client.nuit).trim() || null;
    if (client?.plan) clientPlan = normalizeLicensePlan(client.plan);
  } catch (err) {
    return NextResponse.json(
      { error: dbErrorMessage(err, 'Aplique supabase/migrations/20260521_posly_license_issuer.sql.') },
      { status: 502 },
    );
  }

  const store: LicenseSerialStore = {
    tenant_id: voucher.tenant_id,
    name: clientName,
    nuit: clientNuit,
    plan: clientPlan,
    expires_at: voucher.expiration,
    serial,
  };

  return NextResponse.json({
    success: true,
    serial,
    redeemed: Boolean(voucher.redeemed_machine_id),
    stores: [store],
  });
}
