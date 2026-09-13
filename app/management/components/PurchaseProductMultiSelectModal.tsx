'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Check, Search, X } from 'lucide-react';

export type MultiSelectProductOption = {
  id: string;
  name: string;
  code?: number;
  cost?: number;
  unit?: string;
  stock_quantity?: number;
  track_lot?: boolean;
  tax_rate_id?: string | null;
};

type PurchaseProductMultiSelectModalProps = {
  isOpen: boolean;
  products: MultiSelectProductOption[];
  initialQuery?: string;
  onClose: () => void;
  onConfirm: (selected: MultiSelectProductOption[]) => void;
};

export function PurchaseProductMultiSelectModal({
  isOpen,
  products,
  initialQuery = '',
  onClose,
  onConfirm,
}: PurchaseProductMultiSelectModalProps) {
  const [query, setQuery] = useState(initialQuery);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    if (!isOpen) return;
    setQuery(initialQuery);
    setSelectedIds(new Set());
  }, [isOpen, initialQuery]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return products;
    return products.filter((p) => {
      const name = String(p.name ?? '').toLowerCase();
      const code = String(p.code ?? '');
      return name.includes(q) || code.includes(q);
    });
  }, [products, query]);

  const selectedCount = selectedIds.size;

  const toggle = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAllVisible = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      const allSelected = filtered.every((p) => next.has(String(p.id)));
      if (allSelected) {
        for (const p of filtered) next.delete(String(p.id));
      } else {
        for (const p of filtered) next.add(String(p.id));
      }
      return next;
    });
  };

  const handleConfirm = () => {
    const selected = products.filter((p) => selectedIds.has(String(p.id)));
    if (!selected.length) return;
    onConfirm(selected);
  };

  if (!isOpen) return null;

  const allVisibleSelected =
    filtered.length > 0 && filtered.every((p) => selectedIds.has(String(p.id)));

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center pos-modal-overlay p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-[640px] flex-col overflow-hidden rounded border border-pos-border bg-pos-surface shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between border-b border-pos-border bg-pos-card px-5 py-4">
          <div>
            <h3 className="text-base font-bold text-zinc-100">Seleccionar produtos</h3>
            <p className="mt-1 text-xs text-zinc-500">
              Escolha vários produtos de uma vez para adicionar à compra.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-2 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-white"
            aria-label="Fechar"
          >
            <X size={18} />
          </button>
        </div>

        <div className="border-b border-pos-border px-5 py-3">
          <div className="relative">
            <Search
              size={14}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500"
            />
            <input
              type="text"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Pesquisar produto por nome ou código…"
              className="pos-field h-10 w-full border border-[#3f3f46] pl-9 pr-3 text-sm placeholder:text-zinc-600"
              autoFocus
            />
          </div>
          <div className="mt-2 flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={toggleAllVisible}
              disabled={filtered.length === 0}
              className="text-xs font-semibold text-[#a5b4fc] transition-colors hover:text-white disabled:opacity-40"
            >
              {allVisibleSelected ? 'Limpar selecção' : 'Seleccionar visíveis'}
            </button>
            <span className="text-[11px] text-zinc-500">
              {selectedCount} seleccionado{selectedCount === 1 ? '' : 's'} · {filtered.length} na
              lista
            </span>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto custom-scrollbar">
          {filtered.length === 0 ? (
            <p className="px-5 py-10 text-center text-xs text-zinc-500">
              Nenhum produto encontrado.
            </p>
          ) : (
            <ul className="divide-y divide-zinc-800/80">
              {filtered.map((product) => {
                const id = String(product.id);
                const checked = selectedIds.has(id);
                return (
                  <li key={id}>
                    <button
                      type="button"
                      onClick={() => toggle(id)}
                      className={`flex w-full items-center gap-3 px-5 py-2.5 text-left transition-colors hover:bg-[var(--pos-brand-hover-bg)] ${
                        checked ? 'bg-[var(--pos-brand-selected-bg)]/40' : ''
                      }`}
                    >
                      <span
                        className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                          checked
                            ? 'border-[#0001fb] bg-[#0001fb] text-white'
                            : 'border-zinc-600'
                        }`}
                      >
                        {checked ? <Check size={11} strokeWidth={3} /> : null}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-sm text-zinc-100">
                        {product.name}
                      </span>
                      <span className="shrink-0 text-xs text-zinc-500">
                        {product.code != null && String(product.code).trim()
                          ? String(product.code)
                          : '—'}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-pos-border bg-pos-card px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-zinc-600 px-4 py-2 text-sm text-zinc-300 transition-colors hover:border-[#0001fb] hover:text-white"
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={selectedCount === 0}
            onClick={handleConfirm}
            className="rounded bg-[#0001fb] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#1a1bff] disabled:opacity-40"
          >
            Adicionar {selectedCount > 0 ? `(${selectedCount})` : ''}
          </button>
        </div>
      </div>
    </div>
  );
}
