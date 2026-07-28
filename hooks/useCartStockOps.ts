'use client';

import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import type {
  CartItem,
  Customer,
  PaymentEntry,
  PaymentMethod,
  Product,
} from '@/app/pos/types';
import { clearSharedTableOrder } from '@/lib/sharedTableOrders';
import { loadPosSettings } from '@/lib/posSettings';

type TableOrderState = {
  cart: CartItem[];
  globalDiscount: { type: 'value' | 'percentage'; amount: number } | null;
  selectedCustomer: Customer | null;
  docType: 'VD' | 'TK' | 'FP' | 'FT';
};

type UseCartStockOpsOpts = {
  cart: CartItem[];
  setCart: Dispatch<SetStateAction<CartItem[]>>;
  products: Product[];
  setProducts: Dispatch<SetStateAction<Product[]>>;
  selectedCartItemId: string | null;
  setSelectedCartItemId: Dispatch<SetStateAction<string | null>>;
  setSelectedCategory: Dispatch<SetStateAction<string | null>>;
  setPendingProduct: Dispatch<SetStateAction<Product | null>>;
  setIsStockModalOpen: Dispatch<SetStateAction<boolean>>;
  setMinStockAlert: Dispatch<SetStateAction<{ name: string; quantity: number } | null>>;
  setGlobalDiscount: Dispatch<
    SetStateAction<{ type: 'value' | 'percentage'; amount: number } | null>
  >;
  setPaymentMethod: Dispatch<SetStateAction<PaymentMethod | null>>;
  setReceivedAmount: Dispatch<SetStateAction<string>>;
  setPayments: Dispatch<SetStateAction<PaymentEntry[]>>;
  setIsMultiplePayment: Dispatch<SetStateAction<boolean>>;
  setMultiplePaymentAmount: Dispatch<SetStateAction<string>>;
  setAllowStockOverrideOnCheckout: Dispatch<SetStateAction<boolean>>;
  setPaymentFinalizeError: Dispatch<SetStateAction<string | null>>;
  setIsFinalizingPayment: Dispatch<SetStateAction<boolean>>;
  checkoutIdempotencyKeyRef: MutableRefObject<string | null>;
  setSelectedCustomer: Dispatch<SetStateAction<Customer | null>>;
  setCustomerName: Dispatch<SetStateAction<string>>;
  setCurrentReceiptNumber: Dispatch<SetStateAction<string | null>>;
  setDocType: Dispatch<SetStateAction<'VD' | 'TK' | 'FP' | 'FT'>>;
  setFinalizedDocType: Dispatch<SetStateAction<'VD' | 'TK' | 'FP' | 'FT'>>;
  setLoadedQuotationSource: Dispatch<
    SetStateAction<{ sourceId: string; sourceType: 'order' | 'sale' } | null>
  >;
  selectedTableId: string | null;
  setTableOrders: Dispatch<SetStateAction<Record<string, TableOrderState>>>;
  clearDraftEverywhereRef: MutableRefObject<() => void>;
  showToast: (message: string, type?: 'success' | 'error' | 'info') => void;
};

export function useCartStockOps(opts: UseCartStockOpsOpts) {
  const {
    cart,
    setCart,
    products,
    setProducts,
    selectedCartItemId,
    setSelectedCartItemId,
    setSelectedCategory,
    setPendingProduct,
    setIsStockModalOpen,
    setMinStockAlert,
    setGlobalDiscount,
    setPaymentMethod,
    setReceivedAmount,
    setPayments,
    setIsMultiplePayment,
    setMultiplePaymentAmount,
    setAllowStockOverrideOnCheckout,
    setPaymentFinalizeError,
    setIsFinalizingPayment,
    checkoutIdempotencyKeyRef,
    setSelectedCustomer,
    setCustomerName,
    setCurrentReceiptNumber,
    setDocType,
    setFinalizedDocType,
    setLoadedQuotationSource,
    selectedTableId,
    setTableOrders,
    clearDraftEverywhereRef,
    showToast,
  } = opts;

  const executeAddToCart = (product: Product) => {
    if (!product.is_service) {
      setProducts((prev) =>
        prev.map((p) =>
          p.id === product.id ? { ...p, stock_quantity: Number(p.stock_quantity ?? 0) - 1 } : p,
        ),
      );
    }

    setCart((prev) => {
      const existing = prev.find((item) => item.id === product.id);
      if (existing) {
        return prev.map((item) =>
          item.id === product.id ? { ...item, quantity: item.quantity + 1 } : item,
        );
      }
      return [...prev, { ...product, quantity: 1 }];
    });
  };

  const addToCart = (product: Product) => {
    if (product.price === 0) {
      setSelectedCategory(product.name);
      return;
    }

    if (!product.is_service) {
      if (product.stock_quantity !== undefined && product.stock_quantity <= 0) {
        if (loadPosSettings().allowNegativeStock) {
          executeAddToCart(product);
          setAllowStockOverrideOnCheckout(true);
          return;
        }
        setPendingProduct(product);
        setIsStockModalOpen(true);
        return;
      }

      if (
        product.stock_quantity !== undefined &&
        product.min_stock !== undefined &&
        product.min_stock > 0 &&
        product.stock_quantity <= product.min_stock
      ) {
        setMinStockAlert({
          name: product.name,
          quantity: product.stock_quantity,
        });
      }
    }

    executeAddToCart(product);
  };

  const removeFromCart = async (id: string) => {
    const itemToRemove = cart.find((item) => item.id === id);
    if (itemToRemove && !itemToRemove.is_service) {
      setProducts((prev) =>
        prev.map((p) =>
          p.id === id
            ? { ...p, stock_quantity: Number(p.stock_quantity ?? 0) + itemToRemove.quantity }
            : p,
        ),
      );
    }

    setCart((prev) => prev.filter((item) => item.id !== id));
    if (selectedCartItemId === id) {
      setSelectedCartItemId(null);
    }
  };

  const updateQuantity = async (id: string, quantity: number) => {
    const item = cart.find((i) => i.id === id);
    if (!item) return;

    if (quantity <= 0) {
      removeFromCart(id);
      return;
    }

    const delta = quantity - item.quantity;
    if (!item.is_service && delta !== 0) {
      const currentProduct = products.find((p) => p.id === id);
      const currentStock = Number(currentProduct?.stock_quantity ?? 0);

      if (delta > 0) {
        if (currentStock < delta) {
          if (loadPosSettings().allowNegativeStock) {
            setProducts((prev) =>
              prev.map((p) =>
                p.id === id ? { ...p, stock_quantity: Number(p.stock_quantity ?? 0) - delta } : p,
              ),
            );
            setAllowStockOverrideOnCheckout(true);
            setCart((prev) => prev.map((row) => (row.id === id ? { ...row, quantity } : row)));
            return;
          }
          if (currentStock <= 0) {
            setPendingProduct(currentProduct ?? item);
            setIsStockModalOpen(true);
          } else {
            showToast('Quantidade solicitada excede o stock disponível.', 'error');
          }
          return;
        }
        setProducts((prev) =>
          prev.map((p) =>
            p.id === id ? { ...p, stock_quantity: Number(p.stock_quantity ?? 0) - delta } : p,
          ),
        );
      } else {
        const restore = -delta;
        setProducts((prev) =>
          prev.map((p) =>
            p.id === id ? { ...p, stock_quantity: Number(p.stock_quantity ?? 0) + restore } : p,
          ),
        );
      }
    }

    setCart((prev) => prev.map((item) => (item.id === id ? { ...item, quantity } : item)));
  };

  const clearCart = async (isFinalized: boolean = false) => {
    if (!isFinalized) {
      const restockByProductId = new Map<string, number>();
      for (const item of cart) {
        if (item.is_service) continue;
        restockByProductId.set(item.id, (restockByProductId.get(item.id) ?? 0) + item.quantity);
      }

      if (restockByProductId.size > 0) {
        setProducts((prev) =>
          prev.map((p) => {
            const delta = restockByProductId.get(p.id);
            if (delta == null) return p;
            return { ...p, stock_quantity: Number(p.stock_quantity ?? 0) + delta };
          }),
        );
      }
    }

    setCart([]);
    setSelectedCartItemId(null);
    setGlobalDiscount(null);
    setPaymentMethod(null);
    setReceivedAmount('');
    setPayments([]);
    setIsMultiplePayment(false);
    setMultiplePaymentAmount('');
    setAllowStockOverrideOnCheckout(false);
    setPaymentFinalizeError(null);
    setIsFinalizingPayment(false);
    checkoutIdempotencyKeyRef.current = null;
    setSelectedCustomer(null);
    setCustomerName('');
    setCurrentReceiptNumber(null);
    setDocType('VD');
    setFinalizedDocType('VD');
    setLoadedQuotationSource(null);
    if (selectedTableId) {
      void clearSharedTableOrder(selectedTableId);
      setTableOrders((prev) => {
        const next = { ...prev };
        delete next[selectedTableId];
        return next;
      });
    } else {
      setTableOrders({});
    }
    void clearDraftEverywhereRef.current();
  };

  return {
    addToCart,
    executeAddToCart,
    removeFromCart,
    updateQuantity,
    clearCart,
  };
}
