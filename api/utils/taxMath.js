/**
 * Cálculo partilhado de imposto sobre o preço de venda.
 * - priceIncludesTax=true  → preço já inclui imposto (extrair)
 * - priceIncludesTax=false → preço + imposto (somar)
 * - rate 0% (isento) → sempre sem imposto
 */
export function computeTaxFromBasePrice({
  basePrice,
  rate,
  isFixed = false,
  priceIncludesTax = true,
}) {
  const price = Math.max(0, Number(basePrice) || 0);
  const rateValue = Math.max(0, Number(rate) || 0);
  const includesTax = rateValue === 0 ? false : priceIncludesTax !== false;

  if (isFixed) {
    if (includesTax) {
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

  if (includesTax) {
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

/** Extrai imposto de um total cobrado (já com ou sem imposto na origem). */
export function extractTaxFromGross(gross, ratePercent, isFixed = false, qty = 1) {
  const amount = Math.max(0, Number(gross) || 0);
  if (isFixed) {
    return Math.min(amount, Math.max(0, Number(ratePercent) || 0) * Math.max(1, Number(qty) || 1));
  }
  const rate = Math.max(0, Number(ratePercent) || 0) / 100;
  if (rate <= 0) return 0;
  return Math.round((amount - amount / (1 + rate)) * 100) / 100;
}
