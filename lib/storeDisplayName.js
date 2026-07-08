const GENERIC_STORE_NAMES = new Set(['', 'loja', 'store', 'tenant']);

export function normalizeStoreLabel(value) {
  return String(value ?? '').trim();
}

export function isGenericStoreName(value) {
  const label = normalizeStoreLabel(value).toLowerCase();
  return GENERIC_STORE_NAMES.has(label);
}

/** Preferência: nome real do cliente; ignora «Loja» antigo no registo da máquina. */
export function pickStoreDisplayName(...candidates) {
  const normalized = candidates.map(normalizeStoreLabel).filter(Boolean);
  const specific = normalized.find((name) => !isGenericStoreName(name));
  if (specific) return specific;
  if (normalized.length > 0) return normalized[0];
  return 'Loja';
}

export function storeNameFromLicensePayload(payload) {
  if (!payload || typeof payload !== 'object') return '';
  return normalizeStoreLabel(payload.store_name ?? payload.tenant_name ?? payload.storeName);
}
