import { NextResponse } from 'next/server';
import {
  encodeLicenseBase64,
  createSignedMachineLicense,
} from '@/lib/licensing/signMachineLicense';
import { normalizeReactivationTokenInput } from '@/lib/licensing/reactivationToken.js';
import {
  dbErrorMessage,
  findLicenseVoucherById,
  findReactivationTokenByDigits,
  markReactivationTokenUsed,
  resolveSupabaseAdmin,
} from '@/lib/licenseIssuerDb';
import { issuerMissingSecretResponse, issuerSupabaseUnavailableResponse, resolveLicenseHmacSecret } from '../_utils';

/**
 * Resgate do token de 12 dígitos no POS (sem token de admin).
 * Só funciona para a máquina e o voucher exactos definidos na consola.
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

  const record = body as { token?: unknown; machine_id?: unknown };
  const tokenDigits = normalizeReactivationTokenInput(record.token);
  if (!tokenDigits) {
    return NextResponse.json(
      { error: 'Token inválido. Introduza os 12 dígitos enviados pela consola.' },
      { status: 400 },
    );
  }

  const machineId = String(record.machine_id ?? '').trim();
  if (!machineId) {
    return NextResponse.json({ error: 'machine_id é obrigatório.' }, { status: 400 });
  }

  let tokenRow;
  try {
    tokenRow = await findReactivationTokenByDigits(supabase, tokenDigits);
  } catch (err) {
    return NextResponse.json(
      { error: dbErrorMessage(err, 'Aplique supabase/migrations/20260523_license_reactivation_tokens.sql.') },
      { status: 502 },
    );
  }

  if (!tokenRow) {
    return NextResponse.json({ error: 'Token não encontrado ou já expirou.' }, { status: 404 });
  }

  if (tokenRow.used_at) {
    return NextResponse.json({ error: 'Este token já foi utilizado. Peça um novo na consola.' }, { status: 409 });
  }

  const tokenExpMs = Date.parse(tokenRow.token_expires_at);
  if (Number.isNaN(tokenExpMs) || Date.now() > tokenExpMs) {
    return NextResponse.json({ error: 'Token expirado. Gere outro na consola de licenças.' }, { status: 400 });
  }

  if (tokenRow.machine_id !== machineId) {
    return NextResponse.json(
      { error: 'Este token não corresponde a esta máquina. Use o POS onde a licença foi activada.' },
      { status: 403 },
    );
  }

  let voucher;
  try {
    voucher = await findLicenseVoucherById(supabase, tokenRow.voucher_id);
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err, 'Falha ao ler licença do cliente.') }, { status: 502 });
  }

  if (!voucher) {
    return NextResponse.json({ error: 'Licença do cliente não encontrada.' }, { status: 404 });
  }

  if (voucher.client_id !== tokenRow.client_id || voucher.tenant_id !== tokenRow.tenant_id) {
    return NextResponse.json({ error: 'Token não corresponde a este cliente.' }, { status: 403 });
  }

  const redeemedMachine = String(voucher.redeemed_machine_id ?? '').trim();
  if (!redeemedMachine || redeemedMachine !== machineId) {
    return NextResponse.json({ error: 'Máquina não autorizada para este token.' }, { status: 403 });
  }

  const licenseExpMs = Date.parse(voucher.expiration);
  if (Number.isNaN(licenseExpMs) || Date.now() > licenseExpMs) {
    return NextResponse.json(
      {
        error:
          'A licença deste cliente ainda está expirada na consola. Prolongue a data e gere um novo token.',
      },
      { status: 400 },
    );
  }

  const signed = createSignedMachineLicense({
    tenantId: voucher.tenant_id,
    machineId,
    expirationIso: voucher.expiration,
    secret,
  });

  const licensePayload = {
    ...signed,
    voucher_nonce: voucher.nonce,
    activated_at: new Date().toISOString(),
  };

  const licenseB64 = encodeLicenseBase64(signed);

  try {
    await markReactivationTokenUsed(supabase, tokenRow.id);
    const now = new Date().toISOString();
    const { error: regErr } = await supabase
      .from('pos_tenant_registry')
      .update({ license_expires_at: voucher.expiration, updated_at: now })
      .eq('tenant_id', voucher.tenant_id);
    if (regErr) {
      return NextResponse.json(
        { error: `Licença gerada, mas falha ao actualizar registo: ${regErr.message}` },
        { status: 502 },
      );
    }
  } catch (err) {
    return NextResponse.json({ error: dbErrorMessage(err, 'Falha ao marcar token como usado.') }, { status: 502 });
  }

  return NextResponse.json({
    success: true,
    tenant_id: voucher.tenant_id,
    machine_id: machineId,
    license_expires_at: voucher.expiration,
    license_key: licenseB64,
    license: licensePayload,
  });
}
