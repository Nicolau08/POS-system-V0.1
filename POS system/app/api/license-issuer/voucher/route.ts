import { randomUUID } from 'crypto';
import { NextResponse } from 'next/server';
import {
  ACTIVATION_VOUCHER_KIND,
  createActivationVoucher,
  encodeVoucherBase64,
  parseExpirationToIso,
} from '@/lib/licensing/signMachineLicense';
import { generateSerialNumber } from '@/lib/licensing/serialNumber';
import {
  dbErrorMessage,
  findLicenseClientById,
  findLicenseVoucherById,
  insertLicenseVoucher,
  isSerialNumberTaken,
  resolveSupabaseAdmin,
  updateLicenseVoucherExpiration,
} from '@/lib/licenseIssuerDb';
import {
  assertIssuerRequest,
  issuerMissingSecretResponse,
  issuerSupabaseUnavailableResponse,
  resolveLicenseHmacSecret,
} from '../_utils';

async function allocateUniqueSerial(
  supabase: NonNullable<ReturnType<typeof resolveSupabaseAdmin>>,
): Promise<string> {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const serial = generateSerialNumber();
    if (!(await isSerialNumberTaken(supabase, serial))) return serial;
  }
  throw new Error('Não foi possível gerar um número de série único.');
}

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

  const record = body as { client_id?: unknown; expires_at?: unknown };
  const clientId = String(record.client_id ?? '').trim();
  const expiresRaw = record.expires_at;

  if (!clientId) {
    return NextResponse.json({ error: 'client_id é obrigatório.' }, { status: 400 });
  }

  const expirationIso = parseExpirationToIso(expiresRaw);
  if (!expirationIso) {
    return NextResponse.json(
      { error: 'Data de expiração inválida. Use ISO, ex: 2027-12-31T23:59:59.000Z' },
      { status: 400 },
    );
  }
  if (Date.now() > Date.parse(expirationIso)) {
    return NextResponse.json({ error: 'A data de expiração deve estar no futuro.' }, { status: 400 });
  }

  let client;
  try {
    client = await findLicenseClientById(supabase, clientId);
  } catch (err) {
    return NextResponse.json(
      { error: dbErrorMessage(err, 'Aplique supabase/migrations/20260521_posly_license_issuer.sql.') },
      { status: 502 },
    );
  }
  if (!client) {
    return NextResponse.json({ error: 'Cliente não encontrado.' }, { status: 404 });
  }

  const nonce = randomUUID();
  const voucher = createActivationVoucher({
    tenantId: client.tenant_id,
    expirationIso,
    nonce,
    secret,
  });

  let serialNumber: string;
  try {
    serialNumber = await allocateUniqueSerial(supabase);
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

  const voucherJson = JSON.stringify(voucher, null, 2);
  const codeB64 = encodeVoucherBase64(voucher);
  const now = new Date().toISOString();
  const row = {
    id: randomUUID(),
    client_id: client.id,
    tenant_id: client.tenant_id,
    expiration: expirationIso,
    nonce: voucher.nonce,
    voucher_json: JSON.stringify(voucher),
    code_b64: codeB64,
    serial_number: serialNumber,
    created_at: now,
    redeemed_machine_id: null as string | null,
    redeemed_at: null as string | null,
  };

  try {
    await insertLicenseVoucher(supabase, row);
  } catch (err) {
    return NextResponse.json(
      {
        error: dbErrorMessage(
          err,
          'Aplique supabase/migrations/20260521_posly_license_issuer.sql e 20260708_license_voucher_serial_number.sql.',
        ),
      },
      { status: 502 },
    );
  }

  return NextResponse.json({
    kind: ACTIVATION_VOUCHER_KIND,
    voucher,
    voucherJson,
    codeB64,
    serial_number: serialNumber,
    record: row,
  });
}

/** Alterar data de término de um código (pendente ou já activado no registo). */
export async function PATCH(request: Request) {
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

  const record = body as { voucher_id?: unknown; id?: unknown; expires_at?: unknown; license_expires_at?: unknown };
  const voucherId = String(record.voucher_id ?? record.id ?? '').trim();
  const expiresRaw = record.expires_at ?? record.license_expires_at;

  if (!voucherId) {
    return NextResponse.json({ error: 'voucher_id é obrigatório.' }, { status: 400 });
  }

  const expirationIso = parseExpirationToIso(expiresRaw);
  if (!expirationIso) {
    return NextResponse.json({ error: 'Data de término inválida.' }, { status: 400 });
  }

  let voucher;
  try {
    voucher = await findLicenseVoucherById(supabase, voucherId);
  } catch (err) {
    return NextResponse.json(
      { error: dbErrorMessage(err, 'Aplique supabase/migrations/20260521_posly_license_issuer.sql.') },
      { status: 502 },
    );
  }
  if (!voucher) {
    return NextResponse.json({ error: 'Código não encontrado.' }, { status: 404 });
  }

  const signed = createActivationVoucher({
    tenantId: voucher.tenant_id,
    expirationIso,
    nonce: voucher.nonce,
    secret,
  });
  const voucherJson = JSON.stringify(signed, null, 2);
  const codeB64 = encodeVoucherBase64(signed);

  try {
    await updateLicenseVoucherExpiration(supabase, voucherId, expirationIso, {
      voucher_json: voucherJson,
      code_b64: codeB64,
    });
  } catch (err) {
    return NextResponse.json(
      { error: dbErrorMessage(err, 'Aplique supabase/migrations/20260521_posly_license_issuer.sql.') },
      { status: 502 },
    );
  }

  if (voucher.redeemed_machine_id) {
    const now = new Date().toISOString();
    const { error: regErr } = await supabase
      .from('pos_tenant_registry')
      .update({ license_expires_at: expirationIso, updated_at: now })
      .eq('tenant_id', voucher.tenant_id);
    if (regErr) {
      return NextResponse.json(
        {
          error: `Código actualizado, mas falha no registo da máquina: ${regErr.message}`,
        },
        { status: 502 },
      );
    }
  }

  return NextResponse.json({
    success: true,
    voucher_id: voucherId,
    tenant_id: voucher.tenant_id,
    license_expires_at: expirationIso,
    code_b64: codeB64,
    redeemed: Boolean(voucher.redeemed_machine_id),
  });
}
