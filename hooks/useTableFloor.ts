'use client';

import { useCallback, useState } from 'react';
import type { CartItem, Customer } from '@/app/pos/types';
import { fetchLocations, type PosLocation } from '@/lib/services/posService';
import { fetchSharedTableOrders, saveSharedTableOrder } from '@/lib/sharedTableOrders';
import { formatTablesRange } from '@/lib/tableRange';
import { setCachedLocationsTables } from '@/lib/posSessionCache';
import { readPosFloorContext, writePosFloorContext } from '@/lib/posFloorContext';
import type { PosTableOrderState } from '@/hooks/useSharedTableOrdersSync';
import type { MutableRefObject } from 'react';

type OrderSlice = {
  cart: CartItem[];
  globalDiscount: PosTableOrderState['globalDiscount'];
  selectedCustomer: Customer | null;
  docType: PosTableOrderState['docType'];
};

function tablesEnabledLocations(locations: PosLocation[]) {
  return locations.filter((location) => location.active && Array.isArray(location.tables) && location.tables.length > 0);
}

function pickDefaultLocation(locations: PosLocation[], preferredId?: string | null) {
  const usable = tablesEnabledLocations(locations);
  if (preferredId) {
    const match = usable.find((location) => String(location.id) === String(preferredId));
    if (match) return match;
  }
  return (
    usable.find(
      (location) =>
        location.code === 'BALCAO' || location.name.toLowerCase() === 'balcão' || location.type === 'counter',
    ) ||
    usable[0] ||
    locations[0] ||
    null
  );
}

function tableIdsFromLocation(location: PosLocation) {
  return location.tables
    .map((table) => String(table.name))
    .filter(Boolean)
    .sort((a, b) => Number(a) - Number(b) || a.localeCompare(b));
}

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
  tableOrderUpdatedAtRef?: MutableRefObject<Record<string, string>>;
}) {
  const {
    tablesEnabled,
    selectedTableId,
    currentOrder,
    setTableOrders,
    setPosTableIds,
    setPosTablesSummary,
    setAllowTableCustomNames,
    tableOrderUpdatedAtRef,
  } = opts;

  const [isTableFloorOpen, setIsTableFloorOpen] = useState(() =>
    typeof window !== 'undefined' ? readPosFloorContext().resumeFloor : false,
  );
  const [activeLocationId, setActiveLocationId] = useState<string | null>(() =>
    typeof window !== 'undefined' ? readPosFloorContext().locationId : null,
  );
  const [floorLocations, setFloorLocations] = useState<PosLocation[]>([]);

  const applyLocation = useCallback(
    (location: PosLocation) => {
      const ids = tableIdsFromLocation(location);
      if (ids.length) {
        setPosTableIds(ids);
        setPosTablesSummary(location.tablesSummary || formatTablesRange(ids));
        setCachedLocationsTables({
          tableIds: ids,
          tablesSummary: location.tablesSummary || formatTablesRange(ids),
          allowCustomNames: Boolean(location.allowCustomNames),
        });
      }
      setAllowTableCustomNames(Boolean(location.allowCustomNames));
      const locationId = String(location.id);
      setActiveLocationId(locationId);
      writePosFloorContext({ locationId });
    },
    [setAllowTableCustomNames, setPosTableIds, setPosTablesSummary],
  );

  const refreshLocations = useCallback(async () => {
    if (!tablesEnabled) {
      setFloorLocations([]);
      return [] as PosLocation[];
    }
    try {
      const locations = await fetchLocations();
      const usable = tablesEnabledLocations(locations);
      setFloorLocations(usable);
      const preferredId = activeLocationId || readPosFloorContext().locationId;
      const selected = pickDefaultLocation(locations, preferredId);
      if (selected) applyLocation(selected);
      return usable;
    } catch {
      return [] as PosLocation[];
    }
  }, [activeLocationId, applyLocation, tablesEnabled]);

  /**
   * Após logout numa mesa/grelha: abre já a grelha do local correcto.
   * Devolve true se restaurou; false se não havia pedido de resume.
   */
  const resumeFloorAfterLogin = useCallback(async () => {
    if (!tablesEnabled) return false;
    const ctx = readPosFloorContext();
    if (!ctx.resumeFloor) return false;

    setIsTableFloorOpen(true);

    try {
      const [locations, sharedOrdersRaw] = await Promise.all([
        fetchLocations(),
        fetchSharedTableOrders().catch(() => null),
      ]);
      const sharedOrders = sharedOrdersRaw ?? {};
      const usable = tablesEnabledLocations(locations);
      setFloorLocations(usable);

      let selected =
        (ctx.locationId ? pickDefaultLocation(locations, ctx.locationId) : null) || null;
      if (!selected && ctx.tableId) {
        selected =
          usable.find((location) =>
            location.tables.some((table) => String(table.name) === String(ctx.tableId)),
          ) || null;
      }
      if (!selected) {
        selected = pickDefaultLocation(locations, null);
      }
      if (selected) applyLocation(selected);

      setTableOrders((prev) => {
        const next: Record<string, PosTableOrderState> = { ...prev };
        for (const [key, order] of Object.entries(sharedOrders)) {
          next[key] = {
            cart: Array.isArray(order.cart) ? order.cart : [],
            globalDiscount: order.globalDiscount ?? null,
            selectedCustomer: order.selectedCustomer ?? null,
            docType: (order.docType ?? 'VD') as PosTableOrderState['docType'],
          };
        }
        return next;
      });

      writePosFloorContext({
        locationId: selected ? String(selected.id) : ctx.locationId,
        tableId: null,
        resumeFloor: false,
      });
      return true;
    } catch {
      writePosFloorContext({ resumeFloor: false });
      return false;
    }
  }, [applyLocation, setTableOrders, tablesEnabled]);

  const persistLeavingTableOrder = useCallback(
    async (leavingId: string | null, order: OrderSlice) => {
      if (!leavingId || leavingId === 'direct') return;
      setTableOrders((prev) => ({
        ...prev,
        [leavingId]: { ...order },
      }));
      if (!Array.isArray(order.cart) || order.cart.length === 0) return;
      const expectedUpdatedAt = tableOrderUpdatedAtRef?.current[leavingId] ?? null;
      const saveResult = await saveSharedTableOrder(leavingId, {
        ...order,
        expectedUpdatedAt,
      });
      if (saveResult.ok && tableOrderUpdatedAtRef) {
        tableOrderUpdatedAtRef.current[leavingId] = saveResult.updatedAt;
      }
    },
    [setTableOrders, tableOrderUpdatedAtRef],
  );

  const selectLocation = useCallback(
    (locationId: string) => {
      if (!tablesEnabled) return;
      if (isTableFloorOpen && String(activeLocationId) === String(locationId)) {
        setIsTableFloorOpen(false);
        return;
      }
      const currentId = selectedTableId || 'direct';
      const leavingOrder = { ...currentOrder };
      // Mostra já OCUPADA na grelha (antes do round-trip ao servidor).
      setTableOrders((prev) => ({
        ...prev,
        [currentId]: leavingOrder,
      }));
      void (async () => {
        await persistLeavingTableOrder(selectedTableId, leavingOrder);
        try {
          const [locations, sharedOrdersRaw] = await Promise.all([
            fetchLocations(),
            fetchSharedTableOrders().catch(() => null),
          ]);
          const sharedOrders = sharedOrdersRaw ?? {};
          setTableOrders((prev) => {
            const next: Record<string, PosTableOrderState> = {
              ...prev,
              // Pedido local da mesa que acabámos de deixar tem prioridade.
              ...(selectedTableId
                ? { [selectedTableId]: leavingOrder.cart.length ? leavingOrder : prev[selectedTableId] || leavingOrder }
                : { [currentId]: leavingOrder }),
            };
            for (const [key, order] of Object.entries(sharedOrders)) {
              if (key === selectedTableId) {
                // Se o servidor ainda não tem itens, manter o pedido local.
                if (leavingOrder.cart.length > 0) continue;
              }
              next[key] = {
                cart: Array.isArray(order.cart) ? order.cart : [],
                globalDiscount: order.globalDiscount ?? null,
                selectedCustomer: order.selectedCustomer ?? null,
                docType: (order.docType ?? 'VD') as PosTableOrderState['docType'],
              };
            }
            if (selectedTableId && leavingOrder.cart.length > 0) {
              next[selectedTableId] = leavingOrder;
            }
            return next;
          });
          const usable = tablesEnabledLocations(locations);
          setFloorLocations(usable);
          const selected = pickDefaultLocation(locations, locationId);
          if (selected) applyLocation(selected);
        } catch {
          const location = floorLocations.find((row) => String(row.id) === String(locationId));
          if (location) applyLocation(location);
        }
        setIsTableFloorOpen(true);
      })();
    },
    [
      applyLocation,
      currentOrder,
      floorLocations,
      isTableFloorOpen,
      activeLocationId,
      persistLeavingTableOrder,
      selectedTableId,
      setTableOrders,
      tablesEnabled,
    ],
  );

  const openTableFloor = useCallback(() => {
    if (!tablesEnabled) return;
    if (isTableFloorOpen) {
      setIsTableFloorOpen(false);
      return;
    }
    const currentId = selectedTableId || 'direct';
    const leavingOrder = { ...currentOrder };
    setTableOrders((prev) => ({
      ...prev,
      [currentId]: leavingOrder,
    }));
    void (async () => {
      await persistLeavingTableOrder(selectedTableId, leavingOrder);
      try {
        const [locations, sharedOrdersRaw] = await Promise.all([
          fetchLocations(),
          fetchSharedTableOrders().catch(() => null),
        ]);
        const sharedOrders = sharedOrdersRaw ?? {};
        setTableOrders((prev) => {
          const next: Record<string, PosTableOrderState> = {
            ...prev,
            ...(selectedTableId
              ? {
                  [selectedTableId]: leavingOrder.cart.length
                    ? leavingOrder
                    : prev[selectedTableId] || leavingOrder,
                }
              : { [currentId]: leavingOrder }),
          };
          for (const [key, order] of Object.entries(sharedOrders)) {
            if (key === selectedTableId && leavingOrder.cart.length > 0) continue;
            next[key] = {
              cart: Array.isArray(order.cart) ? order.cart : [],
              globalDiscount: order.globalDiscount ?? null,
              selectedCustomer: order.selectedCustomer ?? null,
              docType: (order.docType ?? 'VD') as PosTableOrderState['docType'],
            };
          }
          if (selectedTableId && leavingOrder.cart.length > 0) {
            next[selectedTableId] = leavingOrder;
          }
          return next;
        });
        const usable = tablesEnabledLocations(locations);
        setFloorLocations(usable);
        const selected = pickDefaultLocation(locations, activeLocationId);
        if (selected) applyLocation(selected);
      } catch {
        /* keep current */
      }
      setIsTableFloorOpen(true);
    })();
  }, [
    activeLocationId,
    applyLocation,
    currentOrder,
    isTableFloorOpen,
    persistLeavingTableOrder,
    selectedTableId,
    setTableOrders,
    tablesEnabled,
  ]);

  return {
    isTableFloorOpen,
    setIsTableFloorOpen,
    openTableFloor,
    activeLocationId,
    applyLocation,
    floorLocations,
    selectLocation,
    refreshLocations,
    resumeFloorAfterLogin,
  };
}
