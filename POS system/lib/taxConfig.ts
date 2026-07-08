const DEFAULT_POS_TAX_RATE = 0.16;

export function getPosTaxRate(): number {
  const raw = Number(process.env.NEXT_PUBLIC_POS_TAX_RATE ?? DEFAULT_POS_TAX_RATE);
  if (!Number.isFinite(raw) || raw < 0) return DEFAULT_POS_TAX_RATE;
  return raw;
}

export function getPosTaxPercentLabel(): string {
  return `${Math.round(getPosTaxRate() * 100)}%`;
}
