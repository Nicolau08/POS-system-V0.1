import type { CartItem, Customer } from '@/app/pos/types';
import { getPosApiBase, getPosUserAuthHeaders } from '@/lib/apiBase';
import { unwrapApiSuccessPayload } from '@/lib/apiResponse';

export const POS_DRAFT_SCHEMA_VERSION = 2;

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

export function makeEmptyPosDraft(): PosDraftSnapshot {
  return {
    v: POS_DRAFT_SCHEMA_VERSION,
    cart: [],
    selectedCustomer: null,
    customerName: '',
    tableNumber: '',
    globalDiscount: null,
    docType: 'VD',
    salesMode: 'customer',
    selectedTableId: null,
    tableOrders: {},
    selectedCartItemId: null,
  };
}

export function isMeaningfulPosDraft(draft: PosDraftSnapshot | null | undefined): boolean {
  if (!draft || typeof draft !== 'object') return false;
  if (Array.isArray(draft.cart) && draft.cart.length > 0) return true;
  if (Boolean(draft.selectedCustomer)) return true;
  if (typeof draft.customerName === 'string' && draft.customerName.trim() !== '') return true;
  if (draft.globalDiscount != null) return true;
  if (draft.tableOrders) {
    for (const order of Object.values(draft.tableOrders)) {
      if (Array.isArray(order?.cart) && order.cart.length > 0) return true;
      if (order?.selectedCustomer) return true;
      if (order?.globalDiscount != null) return true;
    }
  }
  return false;
}

export function normalizePosDraft(raw: unknown): PosDraftSnapshot | null {
  if (!raw || typeof raw !== 'object') return null;
  const parsed = raw as PosDraftSnapshot;
  if (parsed.v !== POS_DRAFT_SCHEMA_VERSION) return null;
  return {
    v: POS_DRAFT_SCHEMA_VERSION,
    cart: Array.isArray(parsed.cart) ? parsed.cart : [],
    selectedCustomer: parsed.selectedCustomer ?? null,
    customerName: typeof parsed.customerName === 'string' ? parsed.customerName : '',
    tableNumber: typeof parsed.tableNumber === 'string' ? parsed.tableNumber : '',
    globalDiscount: parsed.globalDiscount ?? null,
    docType: (parsed.docType ?? 'VD') as PosDraftSnapshot['docType'],
    salesMode: parsed.salesMode === 'table' ? 'table' : 'customer',
    selectedTableId: parsed.selectedTableId ?? null,
    tableOrders:
      parsed.tableOrders && typeof parsed.tableOrders === 'object' ? parsed.tableOrders : {},
    selectedCartItemId:
      typeof parsed.selectedCartItemId === 'string' ? parsed.selectedCartItemId : null,
  };
}

export function readPosDraft(userId: string): PosDraftSnapshot | null {
  if (typeof window === 'undefined' || !String(userId).trim()) return null;
  try {
    const raw = window.localStorage.getItem(storageKey(userId));
    if (!raw) return null;
    return normalizePosDraft(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function writePosDraft(userId: string, snapshot: PosDraftSnapshot): void {
  if (typeof window === 'undefined') return;
  const key = storageKey(userId);
  if (!userId.trim()) return;
  try {
    if (!isMeaningfulPosDraft(snapshot)) {
      window.localStorage.removeItem(key);
      return;
    }
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

export async function fetchPosDraftFromServer(
  userId: string,
): Promise<{ ok: boolean; draft: PosDraftSnapshot | null }> {
  const uid = String(userId ?? '').trim();
  if (!uid) return { ok: false, draft: null };
  try {
    const res = await fetch(`${getPosApiBase()}/pos/draft?userId=${encodeURIComponent(uid)}`, {
      headers: { ...getPosUserAuthHeaders() },
    });
    if (!res.ok) return { ok: false, draft: null };
    const json = await res.json();
    const payload = unwrapApiSuccessPayload<{ draft?: unknown }>(json) ?? json;
    return { ok: true, draft: normalizePosDraft(payload?.draft) };
  } catch {
    return { ok: false, draft: null };
  }
}

export async function savePosDraftToServer(userId: string, snapshot: PosDraftSnapshot): Promise<boolean> {
  const uid = String(userId ?? '').trim();
  if (!uid) return false;
  if (!isMeaningfulPosDraft(snapshot)) {
    await clearPosDraftOnServer(uid);
    return true;
  }
  try {
    const res = await fetch(`${getPosApiBase()}/pos/draft`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        ...getPosUserAuthHeaders(),
      },
      body: JSON.stringify({ userId: uid, draft: snapshot }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function clearPosDraftOnServer(userId: string | undefined | null): Promise<void> {
  const uid = String(userId ?? '').trim();
  if (!uid) return;
  try {
    await fetch(`${getPosApiBase()}/pos/draft?userId=${encodeURIComponent(uid)}`, {
      method: 'DELETE',
      headers: { ...getPosUserAuthHeaders() },
    });
  } catch {
    // ignore
  }
}

/** Limpa localStorage + SQLite. */
export async function clearPosDraftEverywhere(userId: string | undefined | null): Promise<void> {
  clearPosDraft(userId);
  await clearPosDraftOnServer(userId);
}
