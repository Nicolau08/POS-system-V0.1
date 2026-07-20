'use client';

import { useMemo, useState } from 'react';
import type { CartItem } from '@/app/pos/types';
import type { Dispatch, SetStateAction } from 'react';

type UseDiscountFormOpts = {
  cart: CartItem[];
  setCart: Dispatch<SetStateAction<CartItem[]>>;
  setGlobalDiscount: Dispatch<
    SetStateAction<{ type: 'value' | 'percentage'; amount: number } | null>
  >;
  selectedCartItemId: string | null;
  originalTotal: number;
};

export function useDiscountForm(opts: UseDiscountFormOpts) {
  const { cart, setCart, setGlobalDiscount, selectedCartItemId, originalTotal } = opts;

  const [isDiscountModalOpen, setIsDiscountModalOpen] = useState(false);
  const [discountType, setDiscountType] = useState<'value' | 'percentage'>('percentage');
  const [discountAmount, setDiscountAmount] = useState('');
  const [discountTarget, setDiscountTarget] = useState<'selected' | 'all'>('all');

  const applyDiscount = () => {
    const amount = parseFloat(discountAmount);
    if (isNaN(amount) || amount < 0) return;

    if (discountTarget === 'all') {
      setGlobalDiscount({ type: discountType, amount });
      setCart((prev) => prev.map((item) => ({ ...item, discount: undefined })));
    } else {
      setCart((prev) =>
        prev.map((item) => {
          if (item.id === selectedCartItemId) {
            return {
              ...item,
              discount: {
                type: discountType,
                amount,
              },
            };
          }
          return item;
        }),
      );
      setGlobalDiscount(null);
    }

    setIsDiscountModalOpen(false);
    setDiscountAmount('');
  };

  const selectedItem = useMemo(
    () => cart.find((item) => item.id === selectedCartItemId),
    [cart, selectedCartItemId],
  );

  const previewDiscount = useMemo(() => {
    const amount = parseFloat(discountAmount) || 0;
    if (discountTarget === 'selected' && selectedItem) {
      const currentTotal = selectedItem.price * selectedItem.quantity;
      const discountVal =
        discountType === 'percentage' ? (currentTotal * amount) / 100 : amount;
      return { current: currentTotal, discount: discountVal, name: selectedItem.name };
    }
    if (discountTarget === 'all') {
      const discountVal =
        discountType === 'percentage' ? (originalTotal * amount) / 100 : amount;
      return { current: originalTotal, discount: discountVal, name: 'Todos os Itens' };
    }
    return null;
  }, [discountAmount, discountType, discountTarget, selectedItem, originalTotal]);

  return {
    isDiscountModalOpen,
    setIsDiscountModalOpen,
    discountType,
    setDiscountType,
    discountAmount,
    setDiscountAmount,
    discountTarget,
    setDiscountTarget,
    applyDiscount,
    previewDiscount,
  };
}
