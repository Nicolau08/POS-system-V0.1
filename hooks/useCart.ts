import { useMemo } from 'react';
import type { CartItem, Discount } from '@/app/pos/types';
import { getPosTaxRate } from '@/lib/taxConfig';
import { extractTaxFromGross } from '@/lib/taxMath';

// Centralizes cart totals/discount calculations to keep UI components lean.
// item.price is always the amount charged (final_price from the product).
export function useCart(cart: CartItem[], globalDiscount: Discount | null) {
  const fallbackTaxRatePercent = getPosTaxRate() * 100;

  const originalTotal = useMemo(
    () => cart.reduce((acc, item) => acc + item.price * item.quantity, 0),
    [cart]
  );

  const lineTotalsAfterDiscount = useMemo(
    () =>
      cart.map((item) => {
        const gross = item.price * item.quantity;
        if (!item.discount) return gross;
        const discount =
          item.discount.type === 'percentage'
            ? gross * item.discount.amount / 100
            : item.discount.amount;
        return Math.max(0, gross - discount);
      }),
    [cart],
  );

  const itemDiscountTotal = useMemo(
    () => Math.max(0, originalTotal - lineTotalsAfterDiscount.reduce((sum, value) => sum + value, 0)),
    [lineTotalsAfterDiscount, originalTotal],
  );

  const totalDiscount = useMemo(() => {
    if (!globalDiscount) return itemDiscountTotal;

    const globalValue = globalDiscount.type === 'percentage'
      ? originalTotal * globalDiscount.amount / 100
      : globalDiscount.amount;

    return itemDiscountTotal + globalValue;
  }, [globalDiscount, itemDiscountTotal, originalTotal]);

  const total = Math.max(0, originalTotal - totalDiscount);
  const grossAfterItemDiscount = Math.max(
    0,
    lineTotalsAfterDiscount.reduce((sum, value) => sum + value, 0),
  );
  const globalDiscountFactor = grossAfterItemDiscount > 0
    ? Math.min(1, total / grossAfterItemDiscount)
    : 0;

  const calculateLineTax = (item: CartItem, gross: number) => {
    const ratePercent = Number.isFinite(Number(item.tax_rate_percent))
      ? Number(item.tax_rate_percent)
      : fallbackTaxRatePercent;
    return extractTaxFromGross(
      gross,
      ratePercent,
      Boolean(item.tax_rate_is_fixed),
      item.quantity,
    );
  };

  const originalTax = cart.reduce(
    (sum, item) => sum + calculateLineTax(item, item.price * item.quantity),
    0,
  );
  const tax = cart.reduce(
    (sum, item, index) =>
      sum + calculateLineTax(item, lineTotalsAfterDiscount[index] ?? 0) * globalDiscountFactor,
    0,
  );
  const subtotal = Math.max(0, total - tax);
  const originalSubtotal = Math.max(0, originalTotal - originalTax);

  return {
    originalTotal,
    originalSubtotal,
    totalDiscount,
    total,
    subtotal,
    tax,
  };
}
