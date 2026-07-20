export const DEFAULT_TAX_RATE_SPECS = [
  {
    name: 'Isento',
    code: 'ISENTO',
    rate: 0,
    is_fixed: 0,
    // 0% = isento: nunca “com imposto”
    price_includes_tax: 0,
    is_default: 0,
    enabled: 1,
    is_system: 1,
  },
  {
    name: 'IVA',
    code: 'IVA16',
    rate: 16,
    is_fixed: 0,
    price_includes_tax: 1,
    is_default: 1,
    enabled: 1,
    is_system: 1,
  },
];

export function buildDefaultTaxRateInsertRows(tenantId, now = new Date().toISOString()) {
  return DEFAULT_TAX_RATE_SPECS.map((spec) => [
    tenantId,
    spec.name,
    spec.code,
    spec.rate,
    spec.is_fixed,
    spec.price_includes_tax ?? 1,
    spec.is_default ?? 0,
    spec.enabled,
    spec.is_system,
    now,
    now,
  ]);
}
