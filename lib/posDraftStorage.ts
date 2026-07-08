import type { CartItem, Customer } from '@/app/pos/types';

export const POS_DRAFT_SCHEMA_VERSION = 1;

export type PosDraftSnapshot = {
  v: number;
  cart: CartItem[];
  selectedCustomer: Customer | null;
  customerName: string;
  tableNumber: string;
  globalDiscount: { type: 'value' | 'percentage'; amount: number } | null;
  docType: 'VD' | 'TK' | 'FP' | 'FT';
  salesMode: 'customer' | 'table';
  selectedTableId: string | null;
  tableOrders: Record<
    string,
    {
      cart: CartItem[];
      globalDiscount: { type: 'value' | 'percentage'; amount: number } | null;
      selectedCustomer: Customer | null;
      docType: 'VD' | 'TK' | 'FP' | 'FT';
    }
  >;
  selectedCartItemId: string | null;
};

const storageKey = (userId: string) => `posly:pos-draft:${String(userId).trim()}`;

export function readPosDraft(userId: string): PosDraftSnapshot | null {
  if (typeof window === 'undefined' || !String(userId).trim()) return null;
  try {
    const raw = window.localStorage.getItem(storageKey(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PosDraftSnapshot;
    if (!parsed || typeof parsed !== 'object') return null;
    if (parsed.v !== POS_DRAFT_SCHEMA_VERSION) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writePosDraft(userId: string, snapshot: PosDraftSnapshot): void {
  if (typeof window === 'undefined') return;
  const key = storageKey(userId);
  if (!userId.trim()) return;
  try {
    window.localStorage.setItem(key, JSON.stringify(snapshot));
  } catch {
    // quota / private mode — ignorar
  }
}

export function clearPosDraft(userId: string | undefined | null): void {
  if (typeof window === 'undefined' || !userId) return;
  try {
    window.localStorage.removeItem(storageKey(userId));
  } catch {
    // ignore
  }
}
