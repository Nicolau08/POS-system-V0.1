'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  formatItemNameWithTotal,
  formatMoneyForDisplay,
  formatQtyTimesUnitPrice,
  formatRemovedItem,
} from '@/lib/customerDisplayFormat';
import { resetCustomerDisplayCache, writeCustomerDisplay } from '@/lib/customerDisplayClient';
import { loadPosSettings } from '@/lib/posSettings';

type CartLikeItem = {
  id?: string | number | null;
  name?: string | null;
  quantity?: number | null;
  price?: number | null;
};

type CartSnapshot = {
  key: string;
  name: string;
  quantity: number;
  price: number;
};

type DisplayFocus =
  | { kind: 'item'; item: CartLikeItem }
  | { kind: 'removed'; name: string }
  | null;

const REMOVED_DISPLAY_MS = 2500;

function itemKey(item: CartLikeItem, index: number): string {
  if (item.id != null && String(item.id).trim()) return String(item.id);
  return `idx:${index}:${String(item.name ?? '')}`;
}

function toSnapshot(cart: CartLikeItem[]): CartSnapshot[] {
  return cart.map((item, index) => ({
    key: itemKey(item, index),
    name: String(item.name ?? 'ITEM'),
    quantity: Number(item.quantity ?? 1) || 1,
    price: Number(item.price ?? 0),
  }));
}

function focusAfterCart(cart: CartLikeItem[]): DisplayFocus {
  if (!cart.length) return null;
  return { kind: 'item', item: cart[cart.length - 1] };
}

/** Preferir remoção / item alterado / novo — não só o último da lista. */
function resolveCartFocus(cart: CartLikeItem[], previous: CartSnapshot[]): DisplayFocus {
  const current = toSnapshot(cart);
  const currMap = new Map(current.map((item) => [item.key, item]));
  const prevMap = new Map(previous.map((item) => [item.key, item]));

  // Carrinho passou a vazio: notificar o último produto que saiu
  if (previous.length > 0 && cart.length === 0) {
    return { kind: 'removed', name: previous[previous.length - 1].name };
  }

  // Linha removida do carrinho
  for (let i = previous.length - 1; i >= 0; i -= 1) {
    if (!currMap.has(previous[i].key)) {
      return { kind: 'removed', name: previous[i].name };
    }
  }

  if (!cart.length) return null;

  // Novo item
  for (let i = current.length - 1; i >= 0; i -= 1) {
    if (!prevMap.has(current[i].key)) {
      return { kind: 'item', item: cart[i] };
    }
  }

  // Quantidade ou preço alterados
  for (let i = current.length - 1; i >= 0; i -= 1) {
    const before = prevMap.get(current[i].key);
    if (!before) continue;
    if (before.quantity !== current[i].quantity || before.price !== current[i].price) {
      return { kind: 'item', item: cart[i] };
    }
  }

  return { kind: 'item', item: cart[cart.length - 1] };
}

export function useCustomerDisplay({
  cart,
  total,
  isPaymentOpen = false,
  isSaleFinalized = false,
}: {
  cart: CartLikeItem[];
  total: number;
  isPaymentOpen?: boolean;
  isSaleFinalized?: boolean;
}) {
  const [settingsVersion, setSettingsVersion] = useState(0);
  const settings = useMemo(() => loadPosSettings(), [settingsVersion]);
  const previousCartRef = useRef<CartSnapshot[]>([]);
  const cartRef = useRef(cart);
  const [focus, setFocus] = useState<DisplayFocus>(null);
  const removedTimerRef = useRef<number | null>(null);
  const showingRemovedRef = useRef(false);

  cartRef.current = cart;

  useEffect(() => {
    const sync = () => {
      resetCustomerDisplayCache();
      setSettingsVersion((value) => value + 1);
    };
    window.addEventListener('pos-settings-changed', sync);
    return () => window.removeEventListener('pos-settings-changed', sync);
  }, []);

  useEffect(() => {
    const previous = previousCartRef.current;
    const next = resolveCartFocus(cart, previous);

    // Só actualiza o snapshot se ainda não estamos a mostrar "REMOVIDO",
    // ou se detectámos uma nova remoção — evita perder o nome no Strict Mode.
    if (next?.kind === 'removed' || !showingRemovedRef.current) {
      previousCartRef.current = toSnapshot(cart);
    }

    if (next?.kind === 'removed') {
      showingRemovedRef.current = true;
      setFocus(next);

      if (removedTimerRef.current != null) {
        window.clearTimeout(removedTimerRef.current);
      }
      removedTimerRef.current = window.setTimeout(() => {
        removedTimerRef.current = null;
        showingRemovedRef.current = false;
        previousCartRef.current = toSnapshot(cartRef.current);
        setFocus(focusAfterCart(cartRef.current));
      }, REMOVED_DISPLAY_MS);
      return;
    }

    // Manter "REMOVIDO" no ecrã até o temporizador terminar (incl. último item)
    if (showingRemovedRef.current) {
      return;
    }

    setFocus(next);
  }, [cart]);

  useEffect(() => {
    return () => {
      if (removedTimerRef.current != null) {
        window.clearTimeout(removedTimerRef.current);
      }
    };
  }, []);

  const message = useMemo(() => {
    const width = Number(settings.customerDisplayChars) || 20;

    if (isSaleFinalized) {
      return { line1: 'OBRIGADO', line2: 'VOLTE SEMPRE' };
    }

    if (isPaymentOpen) {
      return {
        line1: 'TOTAL',
        line2: formatMoneyForDisplay(total, width).trim(),
      };
    }

    // Remoção tem prioridade mesmo com carrinho vazio
    if (focus?.kind === 'removed') {
      return formatRemovedItem(focus.name, width);
    }

    if (!cart.length || focus?.kind !== 'item' || !focus.item) {
      return {
        line1: settings.welcomeTop || 'BEM VINDO!',
        line2: settings.welcomeBottom || '',
      };
    }

    const qty = Number(focus.item.quantity ?? 1) || 1;
    const price = Number(focus.item.price ?? 0);
    const lineTotal = qty * price;
    return {
      line1: formatItemNameWithTotal(String(focus.item.name ?? 'ITEM'), lineTotal || total, width),
      line2: formatQtyTimesUnitPrice(qty, price, width),
    };
  }, [cart.length, focus, total, isPaymentOpen, isSaleFinalized, settings]);

  useEffect(() => {
    if (!settings.customerDisplayEnabled) return;
    void writeCustomerDisplay(message.line1, message.line2, {
      settings,
      force: focus?.kind === 'removed',
    });
  }, [message.line1, message.line2, settings, focus?.kind]);
}
