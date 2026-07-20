'use client';

import React, { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { User, Utensils, X } from 'lucide-react';

type TableOrderLite = {
  cart: unknown[];
};

/** Grelha de mesas no lugar dos produtos (restauração). */
export function TableFloorPanel({
  tableIds,
  tablesSummary,
  allowCustomNames,
  selectedTableId,
  salesMode,
  tableOrders,
  tableLabels,
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
  onSelect: (tableId: string | null, customName?: string | null) => void;
  onClose: () => void;
}) {
  const [namingTableId, setNamingTableId] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (namingTableId) {
      window.setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [namingTableId]);

  const requestSelect = (tableId: string | null) => {
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

  return (
    <div className="relative flex min-w-0 flex-1 flex-col bg-[#121212]">
      <div className="flex h-14 items-center gap-3 border-b border-zinc-800 bg-[#1a1a1a] px-3">
        <Utensils size={20} className="shrink-0 text-zinc-500" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-white">Mesas</p>
          {tablesSummary && tablesSummary !== '—' ? (
            <p className="truncate text-[10px] text-zinc-500">
              {tablesSummary}
              {allowCustomNames ? ' · nome só na 1ª abertura' : ''}
            </p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-2 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-white"
          title="Voltar aos produtos"
          aria-label="Voltar aos produtos"
        >
          <X size={20} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-3 sm:p-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
          <button
            type="button"
            onClick={() => requestSelect(null)}
            className={`flex min-h-[88px] flex-col items-center justify-center rounded border p-4 transition-all ${
              salesMode === 'customer'
                ? 'border-[#0001fb]/60 bg-[#0001fb]/10 text-[#a5b4fc]'
                : 'border-zinc-700/70 bg-zinc-800 text-zinc-500 hover:border-zinc-500'
            }`}
          >
            <User size={28} className="mb-1.5" />
            <span className="text-xs font-bold uppercase tracking-wide">Venda Direta</span>
          </button>

          {tableIds.map((tableId) => {
            const order = tableOrders[tableId];
            const isOccupied = Boolean(order && Array.isArray(order.cart) && order.cart.length > 0);
            const isActive = selectedTableId === tableId;
            const label = tableLabels[tableId];

            return (
              <button
                key={tableId}
                type="button"
                onClick={() => requestSelect(tableId)}
                className={`relative flex min-h-[88px] flex-col items-center justify-center rounded border p-4 transition-all ${
                  isActive
                    ? 'border-[#0001fb]/60 bg-[#0001fb]/10 text-[#a5b4fc]'
                    : isOccupied
                      ? 'border-amber-500/50 bg-amber-500/10 text-amber-400'
                      : 'border-zinc-700/70 bg-zinc-800 text-zinc-500 hover:border-zinc-500'
                }`}
              >
                <span className="text-2xl font-bold">{tableId}</span>
                {label ? (
                  <span className="mt-1 max-w-full truncate text-[10px] font-semibold text-zinc-300">
                    {label}
                  </span>
                ) : (
                  <span className="mt-1 text-[10px] font-bold uppercase">
                    {isOccupied ? 'Ocupada' : 'Livre'}
                  </span>
                )}
                {isOccupied ? (
                  <div className="absolute top-2 right-2 h-2 w-2 animate-pulse rounded-full bg-amber-500" />
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
            className="absolute inset-0 z-10 flex items-center justify-center bg-black/60 p-4"
            onClick={() => {
              setNamingTableId(null);
              setNameDraft('');
            }}
          >
            <motion.div
              initial={{ scale: 0.96, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.96, opacity: 0 }}
              className="w-full max-w-sm rounded border border-zinc-700 bg-[#1e1e1e] p-5 shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <p className="text-sm font-semibold text-white">Mesa {namingTableId}</p>
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
                className="mt-4 h-10 w-full rounded border border-zinc-600 bg-[#171717] px-3 text-sm text-white outline-none focus:border-[#0001fb]"
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
