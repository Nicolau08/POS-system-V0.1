import { useMemo } from 'react';
import type { CartItem, Discount } from '@/app/pos/types';
import { getPosTaxRate } from '@/lib/taxConfig';

// Centralizes cart totals/discount calculations to keep UI components lean.
export function useCart(cart: CartItem[], globalDiscount: Discount | null) {
  const taxRate = getPosTaxRate();

  const originalTotal = useMemo(
    () => cart.reduce((acc, item) => acc + item.price * item.quantity, 0),
    [cart]
  );

  const totalDiscount = useMemo(() => {
    const itemsDiscount = cart.reduce((acc, item) => {
      if (!item.discount) return acc;
      if (item.discount.type === 'percentage') {
        return acc + (item.price * item.discount.amount / 100) * item.quantity;
      }
      return acc + item.discount.amount;
    }, 0);

    if (!globalDiscount) return itemsDiscount;

    const globalValue = globalDiscount.type === 'percentage'
      ? originalTotal * globalDiscount.amount / 100
      : globalDiscount.amount;

    return itemsDiscount + globalValue;
  }, [cart, globalDiscount, originalTotal]);

  const total = Math.max(0, originalTotal - totalDiscount);
  const subtotal = total / (1 + taxRate);
  const tax = total - subtotal;
  const originalSubtotal = originalTotal / (1 + taxRate);

  return {
    originalTotal,
    originalSubtotal,
    totalDiscount,
    total,
    subtotal,
    tax,
  };
}
