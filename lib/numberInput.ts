/**
 * Helpers para inputs numéricos: 0/vazio mostram placeholder
 * (evita digitar e ficar "05" / "0" à frente).
 */

export const NUMBER_INPUT_PLACEHOLDER = '0';
export const DECIMAL_INPUT_PLACEHOLDER = '0.00';

/** Valor a mostrar no input controlado — vazio quando for 0/null. */
export function numberInputDisplayValue(value: number | string | null | undefined): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value === 0) return '';
    return String(value);
  }
  const trimmed = String(value).trim();
  if (trimmed === '' || trimmed === '0') return '';
  return trimmed;
}

/** Parse de texto → número; vazio fica 0. */
export function parseNumberInput(raw: string, emptyAs = 0): number {
  const normalized = String(raw ?? '')
    .trim()
    .replace(/\s/g, '')
    .replace(',', '.');
  if (!normalized || normalized === '.' || normalized === '-' || normalized === '-.') {
    return emptyAs;
  }
  const n = Number(normalized);
  return Number.isFinite(n) ? n : emptyAs;
}

/** Alias monetário (mesmo comportamento). */
export function moneyInputDisplayValue(value: number | null | undefined): string {
  return numberInputDisplayValue(value);
}

export function parseMoneyInputValue(raw: string): number {
  return parseNumberInput(raw, 0);
}
