export type LicensePlan = 'PRO' | 'LITE';

export type { CommerceType } from '@/lib/commerceProfile';
export type { CapabilityId, VerticalId } from '@/lib/capabilities';
export { normalizeCommerceType, commerceTypeLabel, COMMERCE_TYPE_OPTIONS } from '@/lib/commerceProfile';
export { normalizeCapabilities, normalizeVertical, getVerticalPreset } from '@/lib/capabilities';

/** NUIT (Moçambique): 9 dígitos. */
export const NUIT_DIGIT_LENGTH = 9;

export function normalizeLicensePlan(value: unknown): LicensePlan {
  const raw = String(value ?? '')
    .trim()
    .toUpperCase();
  if (raw === 'PRO') return 'PRO';
  return 'LITE';
}

export function normalizeNuit(value: unknown): string {
  const digits = String(value ?? '').replace(/\D/g, '');
  return digits.slice(0, NUIT_DIGIT_LENGTH);
}

export function validateNuit(value: unknown): { ok: true; nuit: string } | { ok: false; error: string } {
  const nuit = normalizeNuit(value);
  if (nuit.length !== NUIT_DIGIT_LENGTH) {
    return {
      ok: false,
      error: `NUIT deve ter exactamente ${NUIT_DIGIT_LENGTH} dígitos.`,
    };
  }
  return { ok: true, nuit };
}
