import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@supabase/supabase-js';
import { normalizeLicensePlan, normalizeNuit } from '@/lib/licensing/normalizeLicenseMeta';
import type {
  LicenseIssuerClient,
  LicenseIssuerIssue,
  LicenseIssuerStore,
  LicenseIssuerVoucher,
} from '@/lib/licenseIssuerTypes';

export type {
  LicenseIssuerClient,
  LicenseIssuerIssue,
  LicenseIssuerVoucher,
  LicenseIssuerStore,
} from '@/lib/licenseIssuerTypes';

/** Detecta chaves que não são service_role (anon JWT ou publishable). */
export function isLikelyNonServiceRoleKey(key: string): boolean {
  const k = String(key ?? '').trim();
  if (!k) return true;
  if (/^sb_publishable_/i.test(k) || /^sb_anon_/i.test(k)) return true;
  if (/^eyJ/i.test(k)) {
    try {
      const payloadPart = k.split('.')[1];
      if (!payloadPart) return false;
      const json = Buffer.from(payloadPart.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString(
        'utf8',
      );
      const payload = JSON.parse(json) as { role?: string };
      const role = String(payload?.role ?? '').trim().toLowerCase();
      if (role && role !== 'service_role') return true;
    } catch {
      // JWT ilegível — deixa o createClient falhar depois
    }
  }
  return false;
}

export function resolveSupabaseAdmin(): SupabaseClient | null {
  const url = String(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
  const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!url || !key) return null;
  // RLS activo sem políticas públicas: só service_role pode escrever.
  if (isLikelyNonServiceRoleKey(key)) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

function toIso(value: unknown): string {
  if (value == null) return '';
  const s = String(value);
  const t = Date.parse(s);
  if (!Number.isNaN(t)) return new Date(t).toISOString();
  return s;
}

function mapClient(row: Record<string, unknown>): LicenseIssuerClient {
  return {
    id: String(row.id),
    name: String(row.name),
    tenant_id: String(row.tenant_id),
    nuit: row.nuit != null && String(row.nuit).trim() ? String(row.nuit).trim() : null,
    plan: normalizeLicensePlan(row.plan),
    created_at: toIso(row.created_at),
  };
}

function mapIssue(row: Record<string, unknown>): LicenseIssuerIssue {
  return {
    id: String(row.id),
    client_id: String(row.client_id),
    tenant_id: String(row.tenant_id),
    machine_id: String(row.machine_id),
    expiration: toIso(row.expiration),
    license_json: String(row.license_json),
    created_at: toIso(row.created_at),
  };
}

function mapVoucher(row: Record<string, unknown>): LicenseIssuerVoucher {
  const serialRaw = row.serial_number != null ? String(row.serial_number).trim().toUpperCase() : '';
  return {
    id: String(row.id),
    client_id: String(row.client_id),
    tenant_id: String(row.tenant_id),
    expiration: toIso(row.expiration),
    nonce: String(row.nonce),
    voucher_json: String(row.voucher_json),
    code_b64: String(row.code_b64),
    serial_number: serialRaw || null,
    created_at: toIso(row.created_at),
    redeemed_machine_id: row.redeemed_machine_id ? String(row.redeemed_machine_id) : null,
    redeemed_at: row.redeemed_at ? toIso(row.redeemed_at) : null,
  };
}

export async function readLicenseIssuerStore(supabase: SupabaseClient): Promise<LicenseIssuerStore> {
  const [clientsRes, issuesRes, vouchersRes] = await Promise.all([
    supabase.from('license_clients').select('*').order('created_at', { ascending: false }),
    supabase.from('license_issues').select('*').order('created_at', { ascending: false }),
    supabase.from('license_vouchers').select('*').order('created_at', { ascending: false }),
  ]);

  if (clientsRes.error) throw new Error(clientsRes.error.message);
  if (issuesRes.error) throw new Error(issuesRes.error.message);
  if (vouchersRes.error) throw new Error(vouchersRes.error.message);

  return {
    clients: (clientsRes.data ?? []).map((r) => mapClient(r as Record<string, unknown>)),
    issues: (issuesRes.data ?? []).map((r) => mapIssue(r as Record<string, unknown>)),
    vouchers: (vouchersRes.data ?? []).map((r) => mapVoucher(r as Record<string, unknown>)),
  };
}

export async function insertLicenseClient(
  supabase: SupabaseClient,
  client: LicenseIssuerClient,
): Promise<LicenseIssuerClient> {
  const { error } = await supabase.from('license_clients').insert({
    id: client.id,
    name: client.name,
    tenant_id: client.tenant_id,
    nuit: client.nuit,
    plan: client.plan,
    created_at: client.created_at,
  });
  if (error) throw new Error(error.message);
  return client;
}

export async function findLicenseClientById(
  supabase: SupabaseClient,
  id: string,
): Promise<LicenseIssuerClient | null> {
  const { data, error } = await supabase.from('license_clients').select('*').eq('id', id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return mapClient(data as Record<string, unknown>);
}

export async function findLicenseClientByTenantId(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<LicenseIssuerClient | null> {
  const { data, error } = await supabase
    .from('license_clients')
    .select('*')
    .eq('tenant_id', tenantId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return mapClient(data as Record<string, unknown>);
}

export type LicenseReactivationToken = {
  id: string;
  voucher_id: string;
  client_id: string;
  tenant_id: string;
  machine_id: string;
  token: string;
  token_expires_at: string;
  used_at: string | null;
  created_at: string;
};

function mapReactivationToken(row: Record<string, unknown>): LicenseReactivationToken {
  return {
    id: String(row.id),
    voucher_id: String(row.voucher_id),
    client_id: String(row.client_id),
    tenant_id: String(row.tenant_id),
    machine_id: String(row.machine_id),
    token: String(row.token),
    token_expires_at: toIso(row.token_expires_at),
    used_at: row.used_at ? toIso(row.used_at) : null,
    created_at: toIso(row.created_at),
  };
}

export async function revokeUnusedReactivationTokensForVoucher(
  supabase: SupabaseClient,
  voucherId: string,
): Promise<void> {
  const { error } = await supabase
    .from('license_reactivation_tokens')
    .delete()
    .eq('voucher_id', voucherId)
    .is('used_at', null);
  if (error) throw new Error(error.message);
}

export async function insertReactivationToken(
  supabase: SupabaseClient,
  row: LicenseReactivationToken,
): Promise<LicenseReactivationToken> {
  const { error } = await supabase.from('license_reactivation_tokens').insert({
    id: row.id,
    voucher_id: row.voucher_id,
    client_id: row.client_id,
    tenant_id: row.tenant_id,
    machine_id: row.machine_id,
    token: row.token,
    token_expires_at: row.token_expires_at,
    used_at: row.used_at,
    created_at: row.created_at,
  });
  if (error) throw new Error(error.message);
  return row;
}

export async function findReactivationTokenByDigits(
  supabase: SupabaseClient,
  tokenDigits: string,
): Promise<LicenseReactivationToken | null> {
  const { data, error } = await supabase
    .from('license_reactivation_tokens')
    .select('*')
    .eq('token', tokenDigits)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return mapReactivationToken(data as Record<string, unknown>);
}

export async function markReactivationTokenUsed(
  supabase: SupabaseClient,
  tokenId: string,
): Promise<void> {
  const { error } = await supabase
    .from('license_reactivation_tokens')
    .update({ used_at: new Date().toISOString() })
    .eq('id', tokenId)
    .is('used_at', null);
  if (error) throw new Error(error.message);
}

export async function deleteLicenseClient(supabase: SupabaseClient, clientId: string): Promise<void> {
  const { error } = await supabase.from('license_clients').delete().eq('id', clientId);
  if (error) throw new Error(error.message);
}

export async function updateLicenseClientMeta(
  supabase: SupabaseClient,
  clientId: string,
  meta: { nuit?: string | null; plan?: string | null; name?: string | null },
): Promise<LicenseIssuerClient> {
  const patch: Record<string, unknown> = {};
  if (meta.name != null) patch.name = String(meta.name).trim();
  if (meta.nuit != null) patch.nuit = normalizeNuit(meta.nuit) || null;
  if (meta.plan != null) patch.plan = normalizeLicensePlan(meta.plan);

  const { data, error } = await supabase
    .from('license_clients')
    .update(patch)
    .eq('id', clientId)
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  return mapClient(data as Record<string, unknown>);
}

export async function insertLicenseIssue(
  supabase: SupabaseClient,
  issue: LicenseIssuerIssue,
): Promise<LicenseIssuerIssue> {
  const { error } = await supabase.from('license_issues').insert({
    id: issue.id,
    client_id: issue.client_id,
    tenant_id: issue.tenant_id,
    machine_id: issue.machine_id,
    expiration: issue.expiration,
    license_json: issue.license_json,
    created_at: issue.created_at,
  });
  if (error) throw new Error(error.message);
  return issue;
}

export async function findLicenseVoucherById(
  supabase: SupabaseClient,
  id: string,
): Promise<LicenseIssuerVoucher | null> {
  const { data, error } = await supabase.from('license_vouchers').select('*').eq('id', id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return mapVoucher(data as Record<string, unknown>);
}

export async function updateLicenseVoucherExpiration(
  supabase: SupabaseClient,
  voucherId: string,
  expirationIso: string,
  voucherPayload: { voucher_json: string; code_b64: string },
): Promise<LicenseIssuerVoucher> {
  const existing = await findLicenseVoucherById(supabase, voucherId);
  if (!existing) throw new Error('Código de ativação não encontrado.');

  const { error } = await supabase
    .from('license_vouchers')
    .update({
      expiration: expirationIso,
      voucher_json: voucherPayload.voucher_json,
      code_b64: voucherPayload.code_b64,
    })
    .eq('id', voucherId);

  if (error) throw new Error(error.message);
  return { ...existing, expiration: expirationIso, voucher_json: voucherPayload.voucher_json, code_b64: voucherPayload.code_b64 };
}

export async function insertLicenseVoucher(
  supabase: SupabaseClient,
  voucher: LicenseIssuerVoucher,
): Promise<LicenseIssuerVoucher> {
  const { error } = await supabase.from('license_vouchers').insert({
    id: voucher.id,
    client_id: voucher.client_id,
    tenant_id: voucher.tenant_id,
    expiration: voucher.expiration,
    nonce: voucher.nonce,
    voucher_json: voucher.voucher_json,
    code_b64: voucher.code_b64,
    serial_number: voucher.serial_number,
    redeemed_machine_id: voucher.redeemed_machine_id,
    redeemed_at: voucher.redeemed_at,
    created_at: voucher.created_at,
  });
  if (error) throw new Error(error.message);
  return voucher;
}

export async function findLicenseVoucherByNonce(
  supabase: SupabaseClient,
  nonce: string,
): Promise<LicenseIssuerVoucher | null> {
  const { data, error } = await supabase
    .from('license_vouchers')
    .select('*')
    .eq('nonce', nonce)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return mapVoucher(data as Record<string, unknown>);
}

export async function findLicenseVoucherBySerial(
  supabase: SupabaseClient,
  serial: string,
): Promise<LicenseIssuerVoucher | null> {
  const s = String(serial ?? '')
    .trim()
    .toUpperCase();
  if (!s) return null;
  const { data, error } = await supabase
    .from('license_vouchers')
    .select('*')
    .eq('serial_number', s)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return mapVoucher(data as Record<string, unknown>);
}

/** Garante serial único ao inserir (retry em colisão rara). */
export async function isSerialNumberTaken(
  supabase: SupabaseClient,
  serial: string,
): Promise<boolean> {
  const existing = await findLicenseVoucherBySerial(supabase, serial);
  return Boolean(existing);
}

export type RedeemVoucherResult =
  | { ok: true; voucher: LicenseIssuerVoucher; already: boolean }
  | { ok: false; error: string; status: number };

export async function redeemLicenseVoucher(
  supabase: SupabaseClient,
  nonce: string,
  machineId: string,
): Promise<RedeemVoucherResult> {
  const voucher = await findLicenseVoucherByNonce(supabase, nonce);
  if (!voucher) {
    return {
      ok: false,
      error: 'Nenhum código pendente corresponde a este voucher_nonce.',
      status: 404,
    };
  }

  if (voucher.redeemed_machine_id) {
    if (voucher.redeemed_machine_id !== machineId) {
      return { ok: false, error: 'Este código já foi associado a outra máquina.', status: 409 };
    }
    return { ok: true, voucher, already: true };
  }

  const now = new Date().toISOString();
  const { error } = await supabase
    .from('license_vouchers')
    .update({ redeemed_machine_id: machineId, redeemed_at: now })
    .eq('nonce', nonce)
    .is('redeemed_machine_id', null);

  if (error) throw new Error(error.message);

  return {
    ok: true,
    voucher: { ...voucher, redeemed_machine_id: machineId, redeemed_at: now },
    already: false,
  };
}

export function dbErrorMessage(err: unknown, hint: string): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/row-level security|rls/i.test(msg)) {
    return `${msg} Isto costuma acontecer quando SUPABASE_SERVICE_ROLE_KEY não é a service_role (ex.: anon ou sb_publishable_*). Use a chave service_role do Dashboard → Settings → API. ${hint}`;
  }
  if (/relation.*does not exist|license_clients/i.test(msg)) {
    return `${msg}. ${hint}`;
  }
  return msg;
}
