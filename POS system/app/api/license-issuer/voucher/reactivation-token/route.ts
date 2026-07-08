import { randomUUID } from 'crypto';
import { NextResponse } from 'next/server';
import { formatReactivationTokenDisplay } from '@/lib/licensing/reactivationToken.js';
import { generateOfflineReactivationToken } from '@/lib/licensing/offlineReactivationToken.js';
import {
  dbErrorMessage,
  findLicenseVoucherById,
  insertReactivationToken,
  resolveSupabaseAdmin,
  revokeUnusedReactivationTokensForVoucher,
} from '@/lib/licenseIssuerDb';
import {
  assertIssuerRequest,
  issuerMissingSecretResponse,
  issuerSupabaseUnavailableResponse,
  resolveLicenseHmacSecret,
} from '../../_utils';

const TOKEN_VALID_DAYS = 7;

/** Gera token de 12 dígitos para reativar licença já vinculada a uma máquina (após prolongar data). */
export async function POST(request: Request) {
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

  const voucherId = String((body as { voucher_id?: unknown }).voucher_id ?? '').trim();
  if (!voucherId) {
    return NextResponse.json({ error: 'voucher_id é obrigatório.' }, { status: 400 });
  }

  let voucher;
  try {
    voucher = await findLicenseVoucherById(supabase, voucherId);
  } catch (err) {
    return NextResponse.json(
      { error: dbErrorMessage(err, 'Aplique supabase/migrations/20260523_license_reactivation_tokens.sql.') },
      { status: 502 },
    );
  }

  if (!voucher) {
    return NextResponse.json({ error: 'Código não encontrado.' }, { status: 404 });
  }

  const machineId = String(voucher.redeemed_machine_id ?? '').trim();
  if (!machineId) {
    return NextResponse.json(
      {
        error:
          'Este código ainda não foi activado numa máquina. Use o Base64 de ativação inicial em vez de token de reativação.',
      },
      { status: 400 },
    );
  }

  const licenseExpMs = Date.parse(voucher.expiration);
  if (Number.isNaN(licenseExpMs) || Date.now() > licenseExpMs) {
    return NextResponse.json(
      {
        error:
          'A data de término desta licença ainda está no passado. Altere a data na consola antes de gerar o token.',
      },
      { status: 400 },
    );
  }

  const secret = resolveLicenseHmacSecret();
  if (!secret) return issuerMissingSecretResponse();

  const generated = generateOfflineReactivationToken({
    tenantId: voucher.tenant_id,
    machineId,
    expirationIso: voucher.expiration,
    voucherNonce: String(voucher.nonce ?? ''),
    secret,
  });
  if (!generated.ok || !generated.token) {
    return NextResponse.json(
      { error: generated.error || 'Falha ao gerar token offline.' },
      { status: 500 },
    );
  }

  const tokenDigits = generated.token;
  const now = new Date();
  const tokenExpiresAt = new Date(now);
  tokenExpiresAt.setDate(tokenExpiresAt.getDate() + TOKEN_VALID_DAYS);

  const row = {
    id: randomUUID(),
    voucher_id: voucher.id,
    client_id: voucher.client_id,
    tenant_id: voucher.tenant_id,
    machine_id: machineId,
    token: tokenDigits,
    token_expires_at: tokenExpiresAt.toISOString(),
    used_at: null as string | null,
    created_at: now.toISOString(),
  };

  try {
    await revokeUnusedReactivationTokensForVoucher(supabase, voucher.id);
    await insertReactivationToken(supabase, row);
  } catch (err) {
    return NextResponse.json(
      { error: dbErrorMessage(err, 'Aplique supabase/migrations/20260523_license_reactivation_tokens.sql.') },
      { status: 502 },
    );
  }

  return NextResponse.json({
    success: true,
    voucher_id: voucher.id,
    client_id: voucher.client_id,
    tenant_id: voucher.tenant_id,
    machine_id: machineId,
    token: tokenDigits,
    token_display: formatReactivationTokenDisplay(tokenDigits),
    token_expires_at: row.token_expires_at,
    license_expires_at: voucher.expiration,
    offline_capable: true,
  });
}
