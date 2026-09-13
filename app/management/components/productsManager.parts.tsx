'use client';

/**
 * Subcomponentes usados por ProductsManager.tsx (sem acesso ao estado do pai,
 * apenas às suas próprias props / estado local).
 * Extraído de ProductsManager.tsx — mesmo código, sem alterações de comportamento.
 */
import React from 'react';
import { X } from 'lucide-react';
import { formatMoneyMt, moneyFieldLabel } from '@/lib/currency';
import { calcMargin } from '@/lib/margin';

/** Mostra margem € e % a partir do preço de venda e custo. */
export function ProductMarginReadout({ sellingPrice, unitCost }: { sellingPrice: number; unitCost: number }) {
  const { amount, percent } = calcMargin(sellingPrice, unitCost);
  const negative = percent < 0;
  const tone = negative ? 'text-amber-400' : 'text-zinc-200';
  return (
    <div className="grid grid-cols-2 gap-4">
      <div className="space-y-1">
        <label className="text-xs text-zinc-400">{moneyFieldLabel('Margem')}</label>
        <p className={`rounded border border-pos-border bg-pos-card px-3 py-1.5 text-sm ${tone}`}>
          {formatMoneyMt(amount)}
        </p>
      </div>
      <div className="space-y-1">
        <label className="text-xs text-zinc-400">Margem %</label>
        <p className={`rounded border border-pos-border bg-pos-card px-3 py-1.5 text-sm ${tone}`}>
          {percent.toFixed(1)}%
        </p>
      </div>
    </div>
  );
}

export function BarcodeChipField({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const [focused, setFocused] = React.useState(false);
  const trimmed = String(value ?? '').trim();
  const showChip = trimmed.length > 0 && !focused;

  if (showChip) {
    return (
      <div className="flex min-h-[34px] w-full items-center rounded border border-pos-border bg-pos-surface px-2 py-1.5">
        <span className="inline-flex max-w-full items-center gap-1.5 rounded bg-[#0001fb] px-2 py-0.5 text-sm font-medium text-white">
          <span className="truncate font-mono tracking-wide text-white">{trimmed}</span>
          <button
            type="button"
            title="Apagar código de barras"
            onClick={() => onChange('')}
            className="shrink-0 rounded p-0.5 leading-none text-white transition-colors hover:bg-white/20"
          >
            <X size={12} strokeWidth={2.5} />
          </button>
        </span>
      </div>
    );
  }

  return (
    <input
      type="text"
      value={value ?? ''}
      placeholder="Digite ou gere um código"
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded border border-pos-border bg-pos-surface px-3 py-1.5 text-sm text-white outline-none transition-colors placeholder:text-zinc-600 focus:border-blue-500"
    />
  );
}

export function ResizableHeader({
  width,
  label,
  onResize,
  align = 'left',
}: {
  width: number;
  label: string;
  onResize: (e: React.MouseEvent) => void;
  align?: 'left' | 'right' | 'center';
}) {
  return (
    <th
      className={`px-3 py-2 text-xs font-bold text-zinc-300 whitespace-nowrap relative group select-none ${
        align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left'
      }`}
      style={{ width }}
    >
      <span className="truncate block">{label}</span>
      <div
        onMouseDown={onResize}
        className="absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-blue-500/50 active:bg-blue-500 transition-colors z-20 opacity-0 group-hover:opacity-100"
      />
    </th>
  );
}
