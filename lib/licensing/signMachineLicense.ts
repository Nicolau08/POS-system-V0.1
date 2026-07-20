import crypto from 'crypto';

export function normalizeLicenseText(value: unknown): string {
  return String(value ?? '').trim();
}

export function buildCanonicalLicensePayload(payload: {
  tenant_id?: unknown;
  machine_id?: unknown;
  expiration?: unknown;
  expires_at?: unknown;
}) {
  return {
    tenant_id: normalizeLicenseText(payload?.tenant_id),
    machine_id: normalizeLicenseText(payload?.machine_id),
    expiration: normalizeLicenseText(payload?.expiration || payload?.expires_at),
  };
}

export function signCanonicalLicensePayload(
  canonical: ReturnType<typeof buildCanonicalLicensePayload>,
  secret: string,
): string {
  return crypto.createHmac('sha256', secret).update(JSON.stringify(canonical)).digest('hex');
}

/**
 * Validade definida na consola prevalece sobre license.json na máquina.
 * Ordem: voucher (consola de licenças) → registo da máquina → ficheiro local.
 * O registo pode ficar desactualizado (ex. 2027 na activação); o voucher é a fonte de verdade.
 */
export function resolveAuthoritativeLicenseExpiration(input: {
  licenseFileExpiration: string;
  registryExpiration?: string | null;
  voucherExpiration?: string | null;
}): string {
  const voucher = normalizeLicenseText(input.voucherExpiration);
  if (voucher) return voucher;
  const registry = normalizeLicenseText(input.registryExpiration);
  if (registry) return registry;
  return normalizeLicenseText(input.licenseFileExpiration);
}

export function parseExpirationToIso(value: unknown): string | null {
  const raw = normalizeLicenseText(value);
  if (!raw) return null;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

export type SignedMachineLicense = {
  tenant_id: string;
  machine_id: string;
  expiration: string;
  signature: string;
};

export function createSignedMachineLicense(input: {
  tenantId: string;
  machineId: string;
  expirationIso: string;
  secret: string;
}): SignedMachineLicense {
  const canonical = buildCanonicalLicensePayload({
    tenant_id: input.tenantId,
    machine_id: input.machineId,
    expiration: input.expirationIso,
  });
  const signature = signCanonicalLicensePayload(canonical, input.secret);
  return {
    tenant_id: canonical.tenant_id,
    machine_id: canonical.machine_id,
    expiration: canonical.expiration,
    signature,
  };
}

export function encodeLicenseBase64(license: SignedMachineLicense): string {
  return Buffer.from(JSON.stringify(license), 'utf8').toString('base64');
}

/** Voucher: allows emitting a code before the customer machine_id is known; POS binds machine at activation. */
export const ACTIVATION_VOUCHER_KIND = 'pos_activation_v1' as const;

export type ActivationVoucher = {
  kind: typeof ACTIVATION_VOUCHER_KIND;
  tenant_id: string;
  expiration: string;
  nonce: string;
  signature: string;
};

export function buildCanonicalVoucherPayload(input: {
  tenant_id?: unknown;
  expiration?: unknown;
  expires_at?: unknown;
  nonce?: unknown;
}) {
  return {
    kind: ACTIVATION_VOUCHER_KIND,
    tenant_id: normalizeLicenseText(input.tenant_id),
    expiration: normalizeLicenseText(input.expiration || input.expires_at),
    nonce: normalizeLicenseText(input.nonce),
  };
}

export function signCanonicalVoucherPayload(
  canonical: ReturnType<typeof buildCanonicalVoucherPayload>,
  secret: string,
): string {
  return crypto.createHmac('sha256', secret).update(JSON.stringify(canonical)).digest('hex');
}

function timingSafeEqualHex(a: string, b: string): boolean {
  const left = Buffer.from(String(a ?? ''), 'utf8');
  const right = Buffer.from(String(b ?? ''), 'utf8');
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

export function verifyActivationVoucher(payload: unknown, secret: string): { ok: true; voucher: ActivationVoucher } | { ok: false; error: string } {
  if (!payload || typeof payload !== 'object') {
    return { ok: false, error: 'Voucher inválido.' };
  }
  const rec = payload as Record<string, unknown>;
  if (normalizeLicenseText(rec.kind) !== ACTIVATION_VOUCHER_KIND) {
    return { ok: false, error: 'Não é um código de ativação válido.' };
  }
  const tenant_id = normalizeLicenseText(rec.tenant_id);
  const expiration = normalizeLicenseText(rec.expiration || rec.expires_at);
  const nonce = normalizeLicenseText(rec.nonce);
  const signature = normalizeLicenseText(rec.signature);
  if (!tenant_id || !expiration || !nonce || !signature) {
    return { ok: false, error: 'Voucher incompleto (tenant_id, expiration, nonce, signature).' };
  }
  if (!secret) {
    return { ok: false, error: 'Segredo HMAC não configurado.' };
  }
  const canonical = buildCanonicalVoucherPayload({ tenant_id, expiration, nonce });
  const expected = signCanonicalVoucherPayload(canonical, secret);
  if (!timingSafeEqualHex(expected, signature)) {
    return { ok: false, error: 'Assinatura do voucher inválida.' };
  }
  const expMs = Date.parse(expiration);
  if (Number.isNaN(expMs)) {
    return { ok: false, error: 'Data de expiração do voucher inválida.' };
  }
  if (Date.now() > expMs) {
    return { ok: false, error: 'Este código de ativação já expirou.' };
  }
  return {
    ok: true,
    voucher: { kind: ACTIVATION_VOUCHER_KIND, tenant_id, expiration: new Date(expMs).toISOString(), nonce, signature },
  };
}

export function createActivationVoucher(input: {
  tenantId: string;
  expirationIso: string;
  nonce: string;
  secret: string;
}): ActivationVoucher {
  const canonical = buildCanonicalVoucherPayload({
    tenant_id: input.tenantId,
    expiration: input.expirationIso,
    nonce: input.nonce,
  });
  const signature = signCanonicalVoucherPayload(canonical, input.secret);
  return {
    kind: ACTIVATION_VOUCHER_KIND,
    tenant_id: canonical.tenant_id,
    expiration: canonical.expiration,
    nonce: canonical.nonce,
    signature,
  };
}

export function encodeVoucherBase64(voucher: ActivationVoucher): string {
  return Buffer.from(JSON.stringify(voucher), 'utf8').toString('base64');
}

export function materializeMachineLicenseFromVoucher(
  voucher: Pick<ActivationVoucher, 'tenant_id' | 'expiration'>,
  machineId: string,
  secret: string,
): SignedMachineLicense {
  return createSignedMachineLicense({
    tenantId: voucher.tenant_id,
    machineId,
    expirationIso: voucher.expiration,
    secret,
  });
}

/** Validates final machine-bound license (same canonical as POS/Electron). */
export function verifySignedMachineLicense(
  payload: unknown,
  secret: string,
): { ok: true; license: SignedMachineLicense } | { ok: false; error: string } {
  if (!payload || typeof payload !== 'object') {
    return { ok: false, error: 'Licença inválida.' };
  }
  const rec = payload as Record<string, unknown>;
  if (normalizeLicenseText(rec.kind) === ACTIVATION_VOUCHER_KIND) {
    return { ok: false, error: 'Esperava licença final (máquina), não voucher.' };
  }
  const canonical = buildCanonicalLicensePayload(rec);
  if (!canonical.tenant_id || !canonical.machine_id || !canonical.expiration) {
    return { ok: false, error: 'Licença incompleta.' };
  }
  const sig = normalizeLicenseText(rec.signature);
  if (!sig || !secret) {
    return { ok: false, error: 'Assinatura ou segredo em falta.' };
  }
  const expected = signCanonicalLicensePayload(canonical, secret);
  if (!timingSafeEqualHex(expected, sig)) {
    return { ok: false, error: 'Assinatura da licença inválida.' };
  }
  return {
    ok: true,
    license: {
      tenant_id: canonical.tenant_id,
      machine_id: canonical.machine_id,
      expiration: canonical.expiration,
      signature: sig,
    },
  };
}

export function parseJsonOrBase64License(rawInput: string): unknown | null {
  const raw = normalizeLicenseText(rawInput);
  if (!raw) return null;
  const normalizedInput = raw.startsWith('LICENSE_KEY=') ? raw.slice('LICENSE_KEY='.length).trim() : raw;
  try {
    const parsed = JSON.parse(normalizedInput);
    if (parsed && typeof parsed === 'object') return parsed;
  } catch {
    // continue
  }
  try {
    const base64Normalized = normalizedInput.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64Normalized.padEnd(Math.ceil(base64Normalized.length / 4) * 4, '=');
    const decoded = Buffer.from(padded, 'base64').toString('utf8');
    const parsed = JSON.parse(decoded);
    if (parsed && typeof parsed === 'object') return parsed;
  } catch {
    return null;
  }
  return null;
}
