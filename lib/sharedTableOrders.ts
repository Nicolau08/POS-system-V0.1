/**
 * Pedidos de mesa partilhados (postos LAN ↔ caixa desktop).
 */
import { getPosApiDirectBase, getPosApiBase, getPosUserAuthHeaders } from '@/lib/apiBase';
import { unwrapApiSuccessPayload } from '@/lib/apiResponse';
import type { CartItem, Customer } from '@/app/pos/types';

export type SharedTableOrder = {
  cart: CartItem[];
  globalDiscount: { type: 'value' | 'percentage'; amount: number } | null;
  selectedCustomer: Customer | null;
  docType: 'VD' | 'TK' | 'FP' | 'FT';
  updatedAt?: string | null;
  stationCode?: string | null;
};

export type SaveSharedTableOrderResult =
  | { ok: true; updatedAt: string }
  | { ok: false; conflict: true; order: SharedTableOrder }
  | { ok: false; conflict: false };

export const TABLE_ORDER_CONFLICT_MESSAGE =
  'Pedido da mesa foi actualizado noutro posto. A mostrar a versão mais recente.';

function bases(): string[] {
  const direct = getPosApiDirectBase().replace(/\/$/, '');
  const proxy = getPosApiBase().replace(/\/$/, '');
  return direct === proxy ? [direct] : [direct, proxy];
}

function normalizeOrders(raw: unknown): Record<string, SharedTableOrder> {
  const data =
    unwrapApiSuccessPayload<{ orders?: Record<string, SharedTableOrder> }>(raw) ?? raw;
  const orders = (data as { orders?: Record<string, SharedTableOrder> })?.orders;
  return orders && typeof orders === 'object' ? orders : {};
}

function normalizeConflictOrder(raw: unknown): SharedTableOrder | null {
  if (!raw || typeof raw !== 'object') return null;
  const order = raw as SharedTableOrder;
  return {
    cart: Array.isArray(order.cart) ? order.cart : [],
    globalDiscount: order.globalDiscount ?? null,
    selectedCustomer: order.selectedCustomer ?? null,
    docType: (order.docType ?? 'VD') as SharedTableOrder['docType'],
    updatedAt: order.updatedAt ?? null,
    stationCode: order.stationCode ?? null,
  };
}

/**
 * null = falha de rede/API (não limpar estado local).
 * {} = servidor confirmou que não há pedidos.
 */
export async function fetchSharedTableOrders(): Promise<Record<string, SharedTableOrder> | null> {
  let lastErr: unknown = null;
  for (const base of bases()) {
    try {
      const res = await fetch(`${base}/pos/table-orders`, {
        headers: { ...getPosUserAuthHeaders() },
        cache: 'no-store',
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        lastErr = json ?? res.status;
        continue;
      }
      return normalizeOrders(json);
    } catch (err) {
      lastErr = err;
    }
  }
  console.warn('[sharedTableOrders] falha ao carregar pedidos partilhados', lastErr);
  return null;
}

export async function saveSharedTableOrder(
  tableKey: string,
  order: {
    cart: CartItem[];
    globalDiscount?: SharedTableOrder['globalDiscount'];
    selectedCustomer?: Customer | null;
    docType?: SharedTableOrder['docType'];
    stationCode?: string;
    /** Se definido, servidor rejeita (409) se o pedido mudou noutro posto. */
    expectedUpdatedAt?: string | null;
  },
): Promise<SaveSharedTableOrderResult> {
  const key = String(tableKey ?? '').trim();
  if (!key) return { ok: false, conflict: false };
  for (const base of bases()) {
    try {
      const res = await fetch(`${base}/pos/table-orders/${encodeURIComponent(key)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...getPosUserAuthHeaders() },
        body: JSON.stringify(order),
      });
      const json = await res.json().catch(() => null);
      if (res.status === 409) {
        // Envelope de erro: { success: false, data: { tableKey, order }, error: { code } }
        const data = (json as { data?: { order?: SharedTableOrder } | SharedTableOrder })?.data;
        const conflictOrder =
          normalizeConflictOrder(
            data && typeof data === 'object' && 'order' in data
              ? (data as { order?: SharedTableOrder }).order
              : data,
          );
        if (conflictOrder) {
          return { ok: false, conflict: true, order: conflictOrder };
        }
        return { ok: false, conflict: false };
      }
      if (!res.ok) continue;
      const data =
        (json && typeof json === 'object' && (json as { success?: boolean }).success === true
          ? (json as { data?: { updatedAt?: string; order?: { updatedAt?: string } } }).data
          : null) ??
        (json as { data?: { updatedAt?: string; order?: { updatedAt?: string } } })?.data;
      const updatedAt =
        (data && typeof data === 'object'
          ? data.updatedAt || data.order?.updatedAt
          : null) ?? null;
      return {
        ok: true,
        updatedAt: updatedAt ? String(updatedAt) : new Date().toISOString(),
      };
    } catch {
      // tenta base seguinte
    }
  }
  return { ok: false, conflict: false };
}

export async function clearSharedTableOrder(tableKey: string): Promise<boolean> {
  const key = String(tableKey ?? '').trim();
  if (!key) return false;
  for (const base of bases()) {
    try {
      const res = await fetch(`${base}/pos/table-orders/${encodeURIComponent(key)}`, {
        method: 'DELETE',
        headers: { ...getPosUserAuthHeaders() },
      });
      if (res.ok) return true;
    } catch {
      // tenta base seguinte
    }
  }
  return false;
}
