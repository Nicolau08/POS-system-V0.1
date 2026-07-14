import { randomUUID } from 'crypto';
import { NextResponse } from 'next/server';
import { normalizeLicensePlan, validateNuit } from '@/lib/licensing/normalizeLicenseMeta';
import {
  dbErrorMessage,
  deleteLicenseClient,
  findLicenseClientById,
  insertLicenseClient,
  resolveSupabaseAdmin,
  updateLicenseClientMeta,
} from '@/lib/licenseIssuerDb';
import type { LicensePlan } from '@/lib/licenseIssuerTypes';
import { assertIssuerRequest, issuerSupabaseUnavailableResponse } from '../_utils';

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

  const record = body as { name?: unknown; tenant_id?: unknown; nuit?: unknown; plan?: unknown };
  const name = String(record.name ?? '').trim();
  if (name.length < 2) {
    return NextResponse.json({ error: 'Nome do cliente deve ter pelo menos 2 caracteres.' }, { status: 400 });
  }

  const nuitCheck = validateNuit(record.nuit);
  if (!nuitCheck.ok) {
    return NextResponse.json({ error: nuitCheck.error }, { status: 400 });
  }

  const tenantInput = String(record.tenant_id ?? '').trim();
  const tenant_id = tenantInput || `tenant-${randomUUID()}`;
  const now = new Date().toISOString();
  const plan = normalizeLicensePlan(record.plan) as LicensePlan;
  const client = {
    id: randomUUID(),
    name,
    tenant_id,
    nuit: nuitCheck.nuit,
    plan,
    created_at: now,
  };

  try {
    await insertLicenseClient(supabase, client);
    return NextResponse.json({ client });
  } catch (err) {
    const msg = dbErrorMessage(err, 'Aplique supabase/migrations/20260521_posly_license_issuer.sql e 20260522_license_client_plan_nuit.sql.');
    const status = /unique|duplicate/i.test(msg) ? 409 : 502;
    return NextResponse.json({ error: msg }, { status });
  }
}

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

  const record = body as { client_id?: unknown; name?: unknown; nuit?: unknown; plan?: unknown };
  const clientId = String(record.client_id ?? '').trim();
  if (!clientId) {
    return NextResponse.json({ error: 'client_id é obrigatório.' }, { status: 400 });
  }

  const patch: { name?: string; nuit?: string; plan?: LicensePlan } = {};
  if (record.name != null) {
    const name = String(record.name).trim();
    if (name.length < 2) {
      return NextResponse.json({ error: 'Nome deve ter pelo menos 2 caracteres.' }, { status: 400 });
    }
    patch.name = name;
  }
  if (record.nuit != null) {
    const nuitCheck = validateNuit(record.nuit);
    if (!nuitCheck.ok) {
      return NextResponse.json({ error: nuitCheck.error }, { status: 400 });
    }
    patch.nuit = nuitCheck.nuit;
  }
  if (record.plan != null) {
    patch.plan = normalizeLicensePlan(record.plan);
  }
  if (!patch.name && !patch.nuit && !patch.plan) {
    return NextResponse.json({ error: 'Indique name, nuit ou plan para actualizar.' }, { status: 400 });
  }

  try {
    const existing = await findLicenseClientById(supabase, clientId);
    if (!existing) {
      return NextResponse.json({ error: 'Cliente não encontrado.' }, { status: 404 });
    }
    const client = await updateLicenseClientMeta(supabase, clientId, patch);

    const regPatch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (patch.nuit != null) regPatch.nuit = client.nuit;
    if (patch.plan != null) regPatch.plan = client.plan;
    if (patch.name != null) regPatch.display_name = client.name;
    if (Object.keys(regPatch).length > 1) {
      await supabase.from('pos_tenant_registry').update(regPatch).eq('tenant_id', client.tenant_id);
    }

    return NextResponse.json({ client });
  } catch (err) {
    return NextResponse.json(
      {
        error: dbErrorMessage(err, 'Aplique supabase/migrations/20260522_license_client_plan_nuit.sql.'),
      },
      { status: 502 },
    );
  }
}

export async function DELETE(request: Request) {
  const denied = assertIssuerRequest(request);
  if (denied) return denied;

  const supabase = resolveSupabaseAdmin();
  if (!supabase) return issuerSupabaseUnavailableResponse();

  const url = new URL(request.url);
  let clientId = url.searchParams.get('client_id')?.trim() || '';

  if (!clientId) {
    try {
      const body = (await request.json()) as { client_id?: unknown };
      clientId = String(body.client_id ?? '').trim();
    } catch {
      // body opcional
    }
  }

  if (!clientId) {
    return NextResponse.json({ error: 'client_id é obrigatório.' }, { status: 400 });
  }

  try {
    const existing = await findLicenseClientById(supabase, clientId);
    if (!existing) {
      return NextResponse.json({ error: 'Cliente não encontrado.' }, { status: 404 });
    }

    await deleteLicenseClient(supabase, clientId);
    await supabase.from('pos_tenant_registry').delete().eq('tenant_id', existing.tenant_id);

    return NextResponse.json({ ok: true, deleted_client_id: clientId });
  } catch (err) {
    return NextResponse.json(
      { error: dbErrorMessage(err, 'Aplique supabase/migrations/20260521_posly_license_issuer.sql.') },
      { status: 502 },
    );
  }
}
