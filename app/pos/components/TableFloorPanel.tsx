'use client';

import React, { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { User, Utensils, X } from 'lucide-react';
import type { CartItem, Discount } from '@/app/pos/types';
import { formatMoneyMt } from '@/lib/currency';

type TableOrderLite = {
  cart: CartItem[];
  globalDiscount?: Discount | null;
};

function tableCartTotal(order: TableOrderLite | undefined): number {
  if (!order || !Array.isArray(order.cart) || order.cart.length === 0) return 0;
  const original = order.cart.reduce((acc, item) => {
    const price = Number(item?.price) || 0;
    const qty = Number(item?.quantity) || 0;
    return acc + price * qty;
  }, 0);
  const afterItemDiscount = order.cart.reduce((acc, item) => {
    const price = Number(item?.price) || 0;
    const qty = Number(item?.quantity) || 0;
    const gross = price * qty;
    if (!item?.discount) return acc + gross;
    const discount =
      item.discount.type === 'percentage'
        ? (gross * item.discount.amount) / 100
        : item.discount.amount;
    return acc + Math.max(0, gross - discount);
  }, 0);
  const itemDiscountTotal = Math.max(0, original - afterItemDiscount);
  const global = order.globalDiscount;
  if (!global) return Math.max(0, afterItemDiscount);
  const globalValue =
    global.type === 'percentage'
      ? (original * global.amount) / 100
      : global.amount;
  return Math.max(0, original - itemDiscountTotal - globalValue);
}

/** Grelha de mesas no lugar dos produtos (restauração). */
export function TableFloorPanel({
  tableIds,
  allowCustomNames,
  selectedTableId,
  salesMode,
  tableOrders,
  tableLabels,
  tableNumberLabels = {},
  formatPrice = formatMoneyMt,
  onSelect,
  onClose,
}: {
  tableIds: string[];
  tablesSummary?: string;
  allowCustomNames: boolean;
  selectedTableId: string | null;
  salesMode: 'customer' | 'table';
  tableOrders: Record<string, TableOrderLite | undefined>;
  tableLabels: Record<string, string>;
  /** Nome no POS (ex.: 1) enquanto o id interno continua 40 */
  tableNumberLabels?: Record<string, string>;
  formatPrice?: (value: number) => string;
  onSelect: (tableId: string | null, customName?: string | null) => void;
  onClose: () => void;
}) {
  const [namingTableId, setNamingTableId] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef({
    active: false,
    moved: false,
    startY: 0,
    lastY: 0,
    lastTime: 0,
    velocity: 0,
    startScrollTop: 0,
    pointerId: -1,
  });
  const inertiaRef = useRef<number | null>(null);

  useEffect(() => {
    if (namingTableId) {
      window.setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [namingTableId]);

  useEffect(() => {
    return () => {
      if (inertiaRef.current != null) cancelAnimationFrame(inertiaRef.current);
    };
  }, []);

  const stopInertia = () => {
    if (inertiaRef.current != null) {
      cancelAnimationFrame(inertiaRef.current);
      inertiaRef.current = null;
    }
  };

  const startInertia = (pxPerFrame: number) => {
    stopInertia();
    const el = scrollRef.current;
    if (!el || Math.abs(pxPerFrame) < 0.5) return;
    let velocity = pxPerFrame;
    const tick = () => {
      const node = scrollRef.current;
      if (!node) {
        inertiaRef.current = null;
        return;
      }
      const max = node.scrollHeight - node.clientHeight;
      node.scrollTop = Math.max(0, Math.min(max, node.scrollTop - velocity));
      velocity *= 0.95;
      if (node.scrollTop <= 0 || node.scrollTop >= max - 0.5) velocity = 0;
      if (Math.abs(velocity) < 0.4) {
        inertiaRef.current = null;
        return;
      }
      inertiaRef.current = requestAnimationFrame(tick);
    };
    inertiaRef.current = requestAnimationFrame(tick);
  };

  const requestSelect = (tableId: string | null) => {
    if (dragRef.current.moved) return;
    if (tableId === null) {
      onSelect(null, null);
      return;
    }
    if (!allowCustomNames) {
      onSelect(tableId, null);
      return;
    }
    const order = tableOrders[tableId];
    const isOccupied = Boolean(order && Array.isArray(order.cart) && order.cart.length > 0);
    if (isOccupied) {
      onSelect(tableId, tableLabels[tableId] || null);
      return;
    }
    setNamingTableId(tableId);
    setNameDraft(tableLabels[tableId] || '');
  };

  const confirmName = () => {
    if (!namingTableId) return;
    const trimmed = nameDraft.trim();
    onSelect(namingTableId, trimmed || null);
    setNamingTableId(null);
    setNameDraft('');
  };

  const onScrollPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    // Toque: o browser faz scroll nativo (inércia Android/iOS).
    if (e.pointerType === 'touch') return;
    if (e.button !== 0) return;
    const el = scrollRef.current;
    if (!el) return;
    stopInertia();
    const now = performance.now();
    dragRef.current = {
      active: true,
      moved: false,
      startY: e.clientY,
      lastY: e.clientY,
      lastTime: now,
      velocity: 0,
      startScrollTop: el.scrollTop,
      pointerId: e.pointerId,
    };
  };

  const onScrollPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'touch') return;
    const state = dragRef.current;
    if (!state.active) return;
    const el = scrollRef.current;
    if (!el) return;
    const dy = e.clientY - state.startY;
    const now = performance.now();
    const dt = Math.max(1, now - state.lastTime);
    if (!state.moved && Math.abs(dy) > 8) {
      state.moved = true;
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
    }
    if (state.moved) {
      el.scrollTop = state.startScrollTop - dy;
      state.velocity = ((e.clientY - state.lastY) / dt) * 16.67;
      state.lastY = e.clientY;
      state.lastTime = now;
      e.preventDefault();
    }
  };

  const endScrollDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'touch') return;
    const state = dragRef.current;
    if (!state.active) return;
    state.active = false;
    const el = scrollRef.current;
    if (el && state.pointerId >= 0) {
      try {
        el.releasePointerCapture(state.pointerId);
      } catch {
        /* ignore */
      }
    }
    if (state.moved) startInertia(state.velocity);
    window.setTimeout(() => {
      dragRef.current.moved = false;
    }, 0);
  };

  return (
    <div className="relative flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-pos-bg">
      <div className="flex h-14 shrink-0 items-center gap-2 border-b border-pos-border bg-pos-surface p-2">
        <div className="flex items-center gap-3 border-r border-pos-border px-3 text-zinc-500">
          <Utensils size={18} />
        </div>
        <div className="min-w-0 flex-1 px-2">
          <p className="truncate text-sm text-pos-fg">Mesa: Escolha uma mesa</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-2 text-pos-muted transition-colors hover:bg-pos-surface-3 hover:text-pos-fg"
          title="Voltar aos produtos"
          aria-label="Voltar aos produtos"
        >
          <X size={18} />
        </button>
      </div>

      <div
        ref={scrollRef}
        className="min-h-0 flex-1 touch-pan-y overflow-y-auto overscroll-contain p-3 sm:p-4 scrollbar-hide"
        style={{ WebkitOverflowScrolling: 'touch', touchAction: 'pan-y' }}
        onPointerDown={onScrollPointerDown}
        onPointerMove={onScrollPointerMove}
        onPointerUp={endScrollDrag}
        onPointerCancel={endScrollDrag}
        onClickCapture={(e) => {
          if (dragRef.current.moved) {
            e.preventDefault();
            e.stopPropagation();
          }
        }}
      >
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
          <button
            type="button"
            onClick={() => requestSelect(null)}
            className={`flex min-h-[100px] flex-col items-center justify-center rounded border p-4 transition-colors ${
              salesMode === 'customer'
                ? 'border-[#0001fb] bg-[#0001fb]/10 text-[#0001fb]'
                : 'border-pos-border bg-pos-field text-pos-fg hover:border-[#0001fb] hover:bg-[var(--pos-brand-hover-bg)]'
            }`}
          >
            <User size={28} className="mb-1.5" />
            <span className="text-xs font-bold uppercase tracking-wide">Venda Direta</span>
          </button>

          {tableIds.map((tableId) => {
            const order = tableOrders[tableId];
            const isOccupied = Boolean(order && Array.isArray(order.cart) && order.cart.length > 0);
            const isActive = selectedTableId === tableId;
            const label = (tableLabels[tableId] || '').trim();
            const numberLabel = (tableNumberLabels[tableId] || tableId).trim() || tableId;
            const total = tableCartTotal(order);

            return (
              <button
                key={tableId}
                type="button"
                onClick={() => requestSelect(tableId)}
                className={`relative flex min-h-[100px] flex-col items-center justify-center gap-0.5 rounded border p-3 transition-colors ${
                  isActive
                    ? 'border-[#0001fb] bg-[#0001fb]/10 text-[#0001fb]'
                    : isOccupied
                      ? 'border-[#0001fb]/35 bg-[#0001fb]/[0.07] text-pos-fg hover:border-[#0001fb] hover:bg-[#0001fb]/12'
                      : 'border-pos-border bg-pos-field text-pos-fg hover:border-[#0001fb] hover:bg-[var(--pos-brand-hover-bg)]'
                }`}
              >
                <span className="text-2xl font-bold leading-none">{numberLabel}</span>
                <span
                  className={`mt-1 max-w-full truncate px-1 text-[11px] font-semibold ${
                    label ? 'text-pos-fg' : 'uppercase text-pos-muted'
                  }`}
                  title={label || undefined}
                >
                  {label || (isOccupied ? 'Ocupada' : 'Livre')}
                </span>
                {isOccupied ? (
                  <span className="mt-0.5 text-xs font-bold tabular-nums tracking-tight text-pos-fg">
                    {formatPrice(total)}
                  </span>
                ) : (
                  <span className="mt-0.5 text-[10px] font-medium text-pos-muted">—</span>
                )}
                {isOccupied ? (
                  <div className="absolute top-2 right-2 h-2 w-2 animate-pulse rounded-full bg-[#0001fb]" />
                ) : null}
              </button>
            );
          })}
        </div>
      </div>

      <AnimatePresence>
        {namingTableId ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[80] flex items-center justify-center pos-modal-overlay p-4"
            onClick={() => {
              setNamingTableId(null);
              setNameDraft('');
            }}
          >
            <motion.div
              initial={{ scale: 0.96, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.96, opacity: 0 }}
              className="w-full max-w-sm rounded border border-pos-border bg-pos-surface p-5 shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <p className="text-sm font-semibold text-white">Mesa {tableNumberLabels[namingTableId] || namingTableId}</p>
              <p className="mt-1 text-xs text-zinc-500">
                Nome opcional (só na primeira abertura). Enter vazio abre só com o número.
              </p>
              <input
                ref={inputRef}
                type="text"
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    confirmName();
                  }
                  if (e.key === 'Escape') {
                    setNamingTableId(null);
                    setNameDraft('');
                  }
                }}
                placeholder="Ex.: Varanda, VIP…"
                className="mt-4 h-10 w-full rounded border border-zinc-600 bg-pos-surface px-3 text-sm text-white outline-none focus:border-[#0001fb]"
              />
              <div className="mt-4 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setNamingTableId(null);
                    setNameDraft('');
                  }}
                  className="h-9 rounded border border-zinc-600 px-3 text-xs text-zinc-400"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={confirmName}
                  className="h-9 rounded bg-[#0001fb] px-3 text-xs font-medium text-white"
                >
                  Abrir mesa
                </button>
              </div>
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
