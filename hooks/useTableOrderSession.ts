'use client';

import { useCallback } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import type { CartItem, Customer } from '@/app/pos/types';
import { claimTableLock, releaseTableLock } from '@/lib/tableLocks';
import {
  fetchSharedTableOrders,
  saveSharedTableOrder,
} from '@/lib/sharedTableOrders';

type TableOrderState = {
  cart: CartItem[];
  globalDiscount: { type: 'value' | 'percentage'; amount: number } | null;
  selectedCustomer: Customer | null;
  docType: 'VD' | 'TK' | 'FP' | 'FT';
};

type UseTableOrderSessionOpts = {
  cart: CartItem[];
  globalDiscount: TableOrderState['globalDiscount'];
  selectedCustomer: Customer | null;
  docType: TableOrderState['docType'];
  selectedTableId: string | null;
  tableOrders: Record<string, TableOrderState>;
  tableOrderUpdatedAtRef: MutableRefObject<Record<string, string>>;
  setTableOrders: Dispatch<SetStateAction<Record<string, TableOrderState>>>;
  setSalesMode: Dispatch<SetStateAction<'customer' | 'table'>>;
  setSelectedTableId: Dispatch<SetStateAction<string | null>>;
  setTableLabels: Dispatch<SetStateAction<Record<string, string>>>;
  setCart: Dispatch<SetStateAction<CartItem[]>>;
  setGlobalDiscount: Dispatch<SetStateAction<TableOrderState['globalDiscount']>>;
  setSelectedCustomer: Dispatch<SetStateAction<Customer | null>>;
  setDocType: Dispatch<SetStateAction<'VD' | 'TK' | 'FP' | 'FT'>>;
  setIsTableFloorOpen: Dispatch<SetStateAction<boolean>>;
  showToast: (message: string, type?: 'success' | 'error' | 'info') => void;
};

export function useTableOrderSession(opts: UseTableOrderSessionOpts) {
  const {
    cart,
    globalDiscount,
    selectedCustomer,
    docType,
    selectedTableId,
    tableOrders,
    tableOrderUpdatedAtRef,
    setTableOrders,
    setSalesMode,
    setSelectedTableId,
    setTableLabels,
    setCart,
    setGlobalDiscount,
    setSelectedCustomer,
    setDocType,
    setIsTableFloorOpen,
    showToast,
  } = opts;

  const handleTableSelect = useCallback(
    async (tableId: string | null, customName?: string | null) => {
      const currentId = selectedTableId || 'direct';
      const currentOrder = { cart, globalDiscount, selectedCustomer, docType };

      // Grelha vê logo o pedido da mesa que estamos a deixar.
      if (selectedTableId) {
        setTableOrders((prev) => ({ ...prev, [selectedTableId]: currentOrder }));
      }

      if (selectedTableId && selectedTableId !== tableId && currentOrder.cart.length > 0) {
        const expectedUpdatedAt = tableOrderUpdatedAtRef.current[selectedTableId] ?? null;
        const saveResult = await saveSharedTableOrder(selectedTableId, {
          ...currentOrder,
          expectedUpdatedAt,
        });
        if (saveResult.ok) {
          tableOrderUpdatedAtRef.current[selectedTableId] = saveResult.updatedAt;
        } else if (saveResult.conflict) {
          const conflictLocal = {
            cart: Array.isArray(saveResult.order.cart) ? saveResult.order.cart : [],
            globalDiscount: saveResult.order.globalDiscount ?? null,
            selectedCustomer: saveResult.order.selectedCustomer ?? null,
            docType: (saveResult.order.docType ?? 'VD') as 'VD' | 'TK' | 'FP' | 'FT',
          };
          if (saveResult.order.updatedAt) {
            tableOrderUpdatedAtRef.current[selectedTableId] = String(saveResult.order.updatedAt);
          }
          setTableOrders((prev) => ({ ...prev, [selectedTableId]: conflictLocal }));
          showToast(
            'Pedido da mesa foi actualizado noutro posto. A mostrar a versão mais recente.',
            'error',
          );
        }
      }

      if (tableId && tableId !== selectedTableId) {
        const claim = await claimTableLock(tableId);
        if (!claim.ok) {
          showToast(claim.error || 'Mesa em uso noutro posto.', 'error');
          return;
        }
      }

      if (selectedTableId && selectedTableId !== tableId) {
        void releaseTableLock(selectedTableId);
      }
      if (tableId === null && selectedTableId) {
        void releaseTableLock(selectedTableId);
      }

      let sharedOrders: Awaited<ReturnType<typeof fetchSharedTableOrders>> = {};
      try {
        sharedOrders = (await fetchSharedTableOrders()) ?? {};
      } catch {
        sharedOrders = {};
      }

      for (const [key, order] of Object.entries(sharedOrders ?? {})) {
        if (order.updatedAt) {
          tableOrderUpdatedAtRef.current[key] = String(order.updatedAt);
        }
      }

      setTableOrders((prev) => {
        const next = {
          ...prev,
          [currentId]: currentOrder,
        };
        for (const [key, order] of Object.entries(sharedOrders ?? {})) {
          if (key === currentId && selectedTableId) continue;
          next[key] = {
            cart: Array.isArray(order.cart) ? order.cart : [],
            globalDiscount: order.globalDiscount ?? null,
            selectedCustomer: order.selectedCustomer ?? null,
            docType: (order.docType ?? 'VD') as 'VD' | 'TK' | 'FP' | 'FT',
          };
        }
        return next;
      });

      const nextId = tableId || 'direct';
      if (tableId === null) {
        setSalesMode('customer');
        setSelectedTableId(null);
      } else {
        setSalesMode('table');
        setSelectedTableId(tableId);
        setTableLabels((prev) => {
          const next = { ...prev };
          if (customName) next[tableId] = customName;
          else if (customName === null && !sharedOrders[tableId]?.cart?.length) {
            delete next[tableId];
          }
          return next;
        });
      }

      const sharedNext = tableId ? sharedOrders[tableId] : null;
      const nextOrder = sharedNext
        ? {
            cart: Array.isArray(sharedNext.cart) ? sharedNext.cart : [],
            globalDiscount: sharedNext.globalDiscount ?? null,
            selectedCustomer: sharedNext.selectedCustomer ?? null,
            docType: (sharedNext.docType ?? 'VD') as 'VD' | 'TK' | 'FP' | 'FT',
          }
        : tableOrders[nextId];
      if (nextOrder) {
        setCart(nextOrder.cart);
        setGlobalDiscount(nextOrder.globalDiscount);
        setSelectedCustomer(nextOrder.selectedCustomer);
        setDocType(nextOrder.docType || 'VD');
      } else {
        setCart([]);
        setGlobalDiscount(null);
        setSelectedCustomer(null);
        setDocType('VD');
      }
      setIsTableFloorOpen(false);
    },
    [
      cart,
      docType,
      globalDiscount,
      selectedCustomer,
      selectedTableId,
      setCart,
      setDocType,
      setGlobalDiscount,
      setIsTableFloorOpen,
      setSalesMode,
      setSelectedCustomer,
      setSelectedTableId,
      setTableLabels,
      setTableOrders,
      showToast,
      tableOrderUpdatedAtRef,
      tableOrders,
    ],
  );

  return { handleTableSelect };
}
