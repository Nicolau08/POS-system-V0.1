'use client';

import { useCallback, useState } from 'react';
import type { CartItem, Customer } from '@/app/pos/types';
import { fetchLocations } from '@/lib/services/posService';
import { fetchSharedTableOrders } from '@/lib/sharedTableOrders';
import { formatTablesRange } from '@/lib/tableRange';
import type { PosTableOrderState } from '@/hooks/useSharedTableOrdersSync';

type OrderSlice = {
  cart: CartItem[];
  globalDiscount: PosTableOrderState['globalDiscount'];
  selectedCustomer: Customer | null;
  docType: PosTableOrderState['docType'];
};

/**
 * Abre/fecha a grelha de mesas (substitui produtos) e refresca locais + pedidos.
 */
export function useTableFloor(opts: {
  tablesEnabled: boolean;
  selectedTableId: string | null;
  currentOrder: OrderSlice;
  setTableOrders: React.Dispatch<React.SetStateAction<Record<string, PosTableOrderState>>>;
  setPosTableIds: (ids: string[]) => void;
  setPosTablesSummary: (summary: string) => void;
  setAllowTableCustomNames: (v: boolean) => void;
}) {
  const {
    tablesEnabled,
    selectedTableId,
    currentOrder,
    setTableOrders,
    setPosTableIds,
    setPosTablesSummary,
    setAllowTableCustomNames,
  } = opts;

  const [isTableFloorOpen, setIsTableFloorOpen] = useState(false);
  const [activeLocationId, setActiveLocationId] = useState<string | null>(null);

  const openTableFloor = useCallback(() => {
    if (!tablesEnabled) return;
    if (isTableFloorOpen) {
      setIsTableFloorOpen(false);
      return;
    }
    const currentId = selectedTableId || 'direct';
    setTableOrders((prev) => ({
      ...prev,
      [currentId]: { ...currentOrder },
    }));
    void (async () => {
      try {
        const [locations, sharedOrdersRaw] = await Promise.all([
          fetchLocations(),
          fetchSharedTableOrders().catch(() => null),
        ]);
        const sharedOrders = sharedOrdersRaw ?? {};
        setTableOrders((prev) => {
          const next: Record<string, PosTableOrderState> = {
            ...prev,
            [currentId]: { ...currentOrder },
          };
          for (const [key, order] of Object.entries(sharedOrders)) {
            if (key === selectedTableId) continue;
            next[key] = {
              cart: Array.isArray(order.cart) ? order.cart : [],
              globalDiscount: order.globalDiscount ?? null,
              selectedCustomer: order.selectedCustomer ?? null,
              docType: (order.docType ?? 'VD') as PosTableOrderState['docType'],
            };
          }
          return next;
        });
        const balcao =
          locations.find(
            (l) =>
              l.active &&
              (l.code === 'BALCAO' || l.name.toLowerCase() === 'balcão' || l.type === 'counter'),
          ) ||
          locations.find((l) => l.active && l.tables.length > 0) ||
          locations[0];
        if (balcao) {
          const ids = balcao.tables
            .map((t) => String(t.name))
            .filter(Boolean)
            .sort((a, b) => Number(a) - Number(b) || a.localeCompare(b));
          if (ids.length) {
            setPosTableIds(ids);
            setPosTablesSummary(balcao.tablesSummary || formatTablesRange(ids));
          }
          setAllowTableCustomNames(Boolean(balcao.allowCustomNames));
          setActiveLocationId(String(balcao.id));
        }
      } catch {
        /* keep current */
      }
      setIsTableFloorOpen(true);
    })();
  }, [
    tablesEnabled,
    isTableFloorOpen,
    selectedTableId,
    currentOrder,
    setTableOrders,
    setPosTableIds,
    setPosTablesSummary,
    setAllowTableCustomNames,
  ]);

  return {
    isTableFloorOpen,
    setIsTableFloorOpen,
    openTableFloor,
    activeLocationId,
  };
}
