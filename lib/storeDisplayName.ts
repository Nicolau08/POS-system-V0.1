const GENERIC_STORE_NAMES = new Set(['', 'loja', 'store', 'tenant']);

export function normalizeStoreLabel(value: unknown): string {
  return String(value ?? '').trim();
}

export function isGenericStoreName(value: unknown): boolean {
  const label = normalizeStoreLabel(value).toLowerCase();
  return GENERIC_STORE_NAMES.has(label);
}

/** Preferência: nome real do cliente; ignora «Loja» antigo no registo da máquina. */
export function pickStoreDisplayName(...candidates: unknown[]): string {
  const normalized = candidates.map(normalizeStoreLabel).filter(Boolean);
  const specific = normalized.find((name) => !isGenericStoreName(name));
  if (specific) return specific;
  if (normalized.length > 0) return normalized[0];
  return 'Loja';
}

export function storeNameFromLicensePayload(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return '';
  const rec = payload as Record<string, unknown>;
  return normalizeStoreLabel(rec.store_name ?? rec.tenant_name ?? rec.storeName);
}
