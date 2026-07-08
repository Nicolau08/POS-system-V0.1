/** Partilhado entre Electron, API Express e Next (via reactivationToken.ts). */

export const REACTIVATION_TOKEN_DIGITS = 12;

/** Aceita "123456789012", "1234 5678 9012" ou "1234-5678-9012". */
export function normalizeReactivationTokenInput(raw) {
  const digits = String(raw ?? '').replace(/\D/g, '');
  if (digits.length !== REACTIVATION_TOKEN_DIGITS) return null;
  return digits;
}

export function isReactivationTokenInput(raw) {
  return normalizeReactivationTokenInput(raw) != null;
}

export function formatReactivationTokenDisplay(token) {
  const digits = normalizeReactivationTokenInput(token);
  if (!digits) return String(token ?? '');
  return `${digits.slice(0, 4)} ${digits.slice(4, 8)} ${digits.slice(8, 12)}`;
}
