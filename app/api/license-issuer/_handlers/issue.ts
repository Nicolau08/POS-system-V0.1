import { randomUUID } from 'crypto';
import { NextResponse } from 'next/server';
import {
  createSignedMachineLicense,
  encodeLicenseBase64,
  parseExpirationToIso,
} from '@/lib/licensing/signMachineLicense';
import {
  dbErrorMessage,
  findLicenseClientById,
  insertLicenseIssue,
  resolveSupabaseAdmin,
} from '@/lib/licenseIssuerDb';
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

  const record = body as { client_id?: unknown; machine_id?: unknown; expires_at?: unknown };
  const clientId = String(record.client_id ?? '').trim();
  const machineId = String(record.machine_id ?? '').trim();
  const expiresRaw = record.expires_at;

  if (!clientId) {
    return NextResponse.json({ error: 'client_id é obrigatório.' }, { status: 400 });
  }
  if (!machineId) {
    return NextResponse.json({ error: 'machine_id é obrigatório.' }, { status: 400 });
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

  const license = createSignedMachineLicense({
    tenantId: client.tenant_id,
    machineId,
    expirationIso,
    secret,
  });

  const licenseJson = JSON.stringify(license, null, 2);
  const licenseBase64 = encodeLicenseBase64(license);
  const now = new Date().toISOString();
  const issue = {
    id: randomUUID(),
    client_id: client.id,
    tenant_id: client.tenant_id,
    machine_id: machineId,
    expiration: expirationIso,
    license_json: JSON.stringify(license),
    created_at: now,
  };

  try {
    await insertLicenseIssue(supabase, issue);
  } catch (err) {
    return NextResponse.json(
      { error: dbErrorMessage(err, 'Aplique supabase/migrations/20260521_posly_license_issuer.sql.') },
      { status: 502 },
    );
  }

  return NextResponse.json({
    license,
    licenseJson,
    licenseBase64,
    issue,
  });
}
