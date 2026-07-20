'use client';

import { useEffect, useRef } from 'react';
import type { CartItem, Customer } from '@/app/pos/types';
import {
  fetchSharedTableOrders,
  saveSharedTableOrder,
  TABLE_ORDER_CONFLICT_MESSAGE,
  type SharedTableOrder,
} from '@/lib/sharedTableOrders';
import { subscribeSharedTableOrderEvents } from '@/lib/tableOrdersRealtime';

export type PosTableOrderState = {
  cart: CartItem[];
  globalDiscount: { type: 'value' | 'percentage'; amount: number } | null;
  selectedCustomer: Customer | null;
  docType: 'VD' | 'TK' | 'FP' | 'FT';
};

function toLocalOrder(order: SharedTableOrder): PosTableOrderState {
  return {
    cart: Array.isArray(order.cart) ? order.cart : [],
    globalDiscount: order.globalDiscount ?? null,
    selectedCustomer: order.selectedCustomer ?? null,
    docType: (order.docType ?? 'VD') as PosTableOrderState['docType'],
  };
}

/**
 * Sync de pedidos de mesa: SSE (push) + poll de fallback + publicação da mesa activa.
 */
export function useSharedTableOrdersSync(opts: {
  enabled: boolean;
  selectedTableId: string | null;
  salesMode: 'customer' | 'table';
  cart: CartItem[];
  globalDiscount: PosTableOrderState['globalDiscount'];
  selectedCustomer: Customer | null;
  docType: PosTableOrderState['docType'];
  setTableOrders: React.Dispatch<React.SetStateAction<Record<string, PosTableOrderState>>>;
  tableOrderUpdatedAtRef: React.MutableRefObject<Record<string, string>>;
  /** Aplicar pedido remoto no carrinho activo (conflito 409). */
  applyActiveTableOrder?: (order: PosTableOrderState) => void;
  onConflict?: (message: string) => void;
}) {
  const {
    enabled,
    selectedTableId,
    salesMode,
    cart,
    globalDiscount,
    selectedCustomer,
    docType,
    setTableOrders,
    tableOrderUpdatedAtRef,
    applyActiveTableOrder,
    onConflict,
  } = opts;

  const selectedRef = useRef(selectedTableId);
  selectedRef.current = selectedTableId;
  const applyActiveRef = useRef(applyActiveTableOrder);
  applyActiveRef.current = applyActiveTableOrder;
  const onConflictRef = useRef(onConflict);
  onConflictRef.current = onConflict;
  const sseConnectedRef = useRef(false);
  const pullInFlight = useRef(false);

  const mergeRemote = (orders: Record<string, SharedTableOrder>) => {
    const activeId = selectedRef.current;
    setTableOrders((prev) => {
      const next = { ...prev };
      const remoteKeys = new Set(Object.keys(orders));
      for (const [key, order] of Object.entries(orders)) {
        if (order.updatedAt) {
          tableOrderUpdatedAtRef.current[key] = String(order.updatedAt);
        }
        if (key === activeId) continue;
        next[key] = toLocalOrder(order);
      }
      for (const key of Object.keys(next)) {
        if (key === activeId || key === 'direct') continue;
        if (!remoteKeys.has(key)) {
          delete next[key];
          delete tableOrderUpdatedAtRef.current[key];
        }
      }
      return next;
    });
  };

  const applyConflictOrder = (tableKey: string, order: SharedTableOrder) => {
    const local = toLocalOrder(order);
    if (order.updatedAt) {
      tableOrderUpdatedAtRef.current[tableKey] = String(order.updatedAt);
    }
    setTableOrders((prev) => ({ ...prev, [tableKey]: local }));
    if (selectedRef.current === tableKey) {
      applyActiveRef.current?.(local);
    }
    onConflictRef.current?.(TABLE_ORDER_CONFLICT_MESSAGE);
  };

  const pull = async () => {
    if (pullInFlight.current) return;
    pullInFlight.current = true;
    try {
      const orders = await fetchSharedTableOrders();
      if (orders != null) mergeRemote(orders);
    } finally {
      pullInFlight.current = false;
    }
  };

  // SSE + poll de segurança (lento com SSE, rápido sem)
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let pollTimer: number | null = null;

    const schedulePoll = () => {
      if (pollTimer) window.clearInterval(pollTimer);
      const ms = sseConnectedRef.current ? 20_000 : 2_500;
      pollTimer = window.setInterval(() => {
        if (!cancelled) void pull();
      }, ms);
    };

    void pull();
    schedulePoll();

    const unsubscribe = subscribeSharedTableOrderEvents({
      onEvent: (ev) => {
        if (cancelled) return;
        if (ev.type === 'ready') return;
        void pull();
      },
      onStatus: (status) => {
        const was = sseConnectedRef.current;
        sseConnectedRef.current = status === 'connected';
        if (was !== sseConnectedRef.current) schedulePoll();
      },
    });

    return () => {
      cancelled = true;
      unsubscribe();
      if (pollTimer) window.clearInterval(pollTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, selectedTableId]);

  // Publicar mesa activa
  useEffect(() => {
    if (!enabled || !selectedTableId) return;
    if (salesMode !== 'table') return;
    if (!Array.isArray(cart) || cart.length === 0) return;
    const t = window.setTimeout(() => {
      const expectedUpdatedAt = tableOrderUpdatedAtRef.current[selectedTableId] ?? null;
      void saveSharedTableOrder(selectedTableId, {
        cart,
        globalDiscount,
        selectedCustomer,
        docType,
        expectedUpdatedAt,
      }).then((result) => {
        if (result.ok) {
          tableOrderUpdatedAtRef.current[selectedTableId] = result.updatedAt;
          return;
        }
        if (result.conflict) {
          applyConflictOrder(selectedTableId, result.order);
        }
      });
    }, 500);
    return () => window.clearTimeout(t);
  }, [
    enabled,
    selectedTableId,
    salesMode,
    cart,
    globalDiscount,
    selectedCustomer,
    docType,
    tableOrderUpdatedAtRef,
  ]);
}
