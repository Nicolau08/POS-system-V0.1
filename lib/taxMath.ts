/**
 * Cálculo partilhado de imposto sobre o preço de venda (frontend).
 * - priceIncludesTax=true  → preço já inclui imposto (extrair)
 * - priceIncludesTax=false → preço + imposto (somar)
 */
export function computeTaxFromBasePrice(options: {
  basePrice: number;
  rate: number;
  isFixed?: boolean;
  priceIncludesTax?: boolean;
}): { tax: number; finalPrice: number } {
  const price = Math.max(0, Number(options.basePrice) || 0);
  const rateValue = Math.max(0, Number(options.rate) || 0);
  const isFixed = Boolean(options.isFixed);
  // Taxa 0% = isento: nunca tratar como “preço com imposto”.
  const priceIncludesTax = rateValue === 0 ? false : options.priceIncludesTax !== false;

  if (isFixed) {
    if (priceIncludesTax) {
      const tax = Math.min(price, rateValue);
      return {
        tax: Math.round(tax * 100) / 100,
        finalPrice: Math.round(price * 100) / 100,
      };
    }
    const tax = Math.round(rateValue * 100) / 100;
    return {
      tax,
      finalPrice: Math.round((price + tax) * 100) / 100,
    };
  }

  if (priceIncludesTax) {
    const tax =
      rateValue > 0
        ? Math.round((price - price / (1 + rateValue / 100)) * 100) / 100
        : 0;
    return {
      tax,
      finalPrice: Math.round(price * 100) / 100,
    };
  }

  const tax = Math.round(((price * rateValue) / 100) * 100) / 100;
  return {
    tax,
    finalPrice: Math.round((price + tax) * 100) / 100,
  };
}

export function extractTaxFromGross(
  gross: number,
  ratePercent: number,
  isFixed = false,
  qty = 1,
): number {
  const amount = Math.max(0, Number(gross) || 0);
  if (isFixed) {
    return Math.min(amount, Math.max(0, Number(ratePercent) || 0) * Math.max(1, Number(qty) || 1));
  }
  const rate = Math.max(0, Number(ratePercent) || 0) / 100;
  if (rate <= 0) return 0;
  return Math.round((amount - amount / (1 + rate)) * 100) / 100;
}
