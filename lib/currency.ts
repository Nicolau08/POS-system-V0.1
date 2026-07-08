/** Moeda do mercado de Moçambique (Metical). */
export const POS_CURRENCY_CODE = 'MT';
export const POS_CURRENCY_LABEL = 'MT';
export const POS_CURRENCY_NAME = 'Metical';
export const POS_CURRENCY_LOCALE = 'pt-MZ';

/** Placeholder tipico para campos monetarios (ex.: 0.00). */
export const POS_MONEY_PLACEHOLDER = '0.00';

export function formatMoneyMt(value: number): string {
  const n = Number(value);
  const safe = Number.isFinite(n) ? n : 0;
  return (
    new Intl.NumberFormat('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(safe) + POS_CURRENCY_LABEL
  );
}

export function moneyFieldLabel(base: string): string {
  return `${base} (${POS_CURRENCY_LABEL})`;
}
