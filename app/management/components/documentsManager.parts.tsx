'use client';

/**
 * Subcomponentes de apresentação (sem estado próprio) usados por DocumentsManager.tsx.
 * Extraído de DocumentsManager.tsx — mesmo código, sem alterações de comportamento.
 */
import React from 'react';
import PosSelect from '@/components/PosSelect';
import { buildCalendarDays, todayInput } from './documentsManager.helpers';

export function DocumentStatusBadge({
  label,
  className,
  hint,
}: {
  label: string;
  className: string;
  hint?: string;
}) {
  if (!hint) {
    return <span className={`px-2 py-0.5 rounded text-[10px] font-semibold ${className}`}>{label}</span>;
  }

  return (
    <span className="relative inline-flex group/status">
      <span className={`px-2 py-0.5 rounded text-[10px] font-semibold ${className}`}>{label}</span>
      <span className="pointer-events-none absolute left-1/2 top-full z-50 mt-2 -translate-x-1/2 whitespace-nowrap rounded border border-[#0001fb]/30 bg-[rgba(0, 1, 251,0.35)] px-3 py-1.5 text-[11px] font-medium text-zinc-100 opacity-0 shadow-xl transition-all duration-150 group-hover/status:translate-y-0 group-hover/status:opacity-100">
        {hint}
      </span>
    </span>
  );
}

export function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: string[];
}) {
  return (
    <PosSelect
      label={label}
      value={value}
      onChange={onChange}
      size="sm"
      options={options.map((option) => ({
        value: option,
        label: option === 'all' ? 'Todos' : option,
      }))}
    />
  );
}

export function Th({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <th className={`px-3 py-2 text-left text-xs font-bold text-zinc-300 whitespace-nowrap ${className}`}>
      {children}
    </th>
  );
}

export function Td({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-3 py-2 text-xs text-zinc-200 whitespace-nowrap ${className}`}>{children}</td>;
}

export function ModalActionButton({
  icon,
  label,
  onClick,
  disabled,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="flex min-h-11 items-center justify-center gap-2 rounded-[0.4rem] border border-pos-border bg-pos-card px-3 py-3 text-white transition-colors hover:border-[#0001fb] hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40"
    >
      {icon}
      <span className="text-sm">{label}</span>
    </button>
  );
}

export function PresetButton({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="min-h-11 rounded-[0.4rem] border border-pos-border bg-pos-surface px-3 py-3 text-sm text-white transition-colors hover:border-[#0001fb] hover:bg-zinc-800"
    >
      {label}
    </button>
  );
}

export function CalendarGrid({
  monthValue,
  selectedValue,
  onSelect,
}: {
  monthValue: string;
  selectedValue: string;
  onSelect: (value: string) => void;
}) {
  const weekDays = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];
  const days = buildCalendarDays(monthValue);
  const todayValue = todayInput();

  return (
    <div>
      <div className="mb-2 grid grid-cols-7 gap-1">
        {weekDays.map((day) => (
          <div
            key={day}
            className="flex h-7 min-w-0 items-center justify-center text-[11px] font-semibold uppercase tracking-wide text-zinc-400"
          >
            {day}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {days.map((day) => {
          const isSelected = day.value === selectedValue;
          const isToday = day.value === todayValue;
          return (
            <button
              key={day.value}
              onClick={() => onSelect(day.value)}
              className={`flex aspect-square w-full min-w-0 items-center justify-center rounded text-sm transition-colors ${
                isSelected
                  ? 'bg-[#0001fb] text-white scale-110'
                  : isToday
                    ? 'border border-[#0001fb]/70 text-white'
                    : day.inMonth
                      ? 'text-white hover:bg-zinc-700'
                      : 'text-zinc-500 hover:bg-zinc-800'
              }`}
            >
              {day.day}
            </button>
          );
        })}
      </div>
    </div>
  );
}

