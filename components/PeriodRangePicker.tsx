'use client';

import React, { useEffect, useState } from 'react';
import { CalendarDays, Check, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { useEnterToConfirm } from '@/hooks/useEnterToConfirm';

function toDateInput(value: Date) {
  return new Date(value.getTime() - value.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

function monthLabel(value: string) {
  return new Date(`${value}T00:00:00`).toLocaleDateString('pt-PT', {
    month: 'long',
    year: 'numeric',
  });
}

function shiftMonth(value: string, delta: number) {
  const date = new Date(`${value}T00:00:00`);
  return toDateInput(new Date(date.getFullYear(), date.getMonth() + delta, 1));
}

function buildCalendarDays(monthValue: string) {
  const monthDate = new Date(`${monthValue}T00:00:00`);
  const year = monthDate.getFullYear();
  const month = monthDate.getMonth();
  const firstDay = new Date(year, month, 1);
  const startWeekday = (firstDay.getDay() + 6) % 7;
  const startDate = new Date(year, month, 1 - startWeekday);

  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(startDate);
    date.setDate(startDate.getDate() + index);
    return {
      value: toDateInput(date),
      day: date.getDate(),
      inMonth: date.getMonth() === month,
    };
  });
}

export function formatPeriodDateLabel(value: string) {
  if (!value) return 'dd/mm/yyyy';
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return 'dd/mm/yyyy';
  return new Intl.DateTimeFormat('pt-PT').format(date);
}

function CalendarGrid({
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
  const todayValue = toDateInput(new Date());

  return (
    <div>
      <div className="mb-2 grid grid-cols-7 gap-1">
        {weekDays.map((day) => (
          <div
            key={day}
            className="flex h-7 min-w-0 items-center justify-center text-[11px] font-semibold uppercase tracking-wide text-pos-muted"
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
              type="button"
              onClick={() => onSelect(day.value)}
              className={`flex aspect-square w-full min-w-0 items-center justify-center rounded text-sm transition-colors ${
                isSelected
                  ? 'bg-[#0001fb] text-white scale-110'
                  : isToday
                    ? 'border border-[#0001fb]/70 text-pos-fg'
                    : day.inMonth
                      ? 'text-pos-fg hover:bg-pos-surface-3'
                      : 'text-pos-muted hover:bg-pos-surface-3'
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

export default function PeriodRangePicker({
  from,
  to,
  onApply,
  disabled = false,
  label = 'Período',
}: {
  from: string;
  to: string;
  onApply: (from: string, to: string) => void;
  disabled?: boolean;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [tempFrom, setTempFrom] = useState(from);
  const [tempTo, setTempTo] = useState(to);
  const [startMonth, setStartMonth] = useState(`${from.slice(0, 7)}-01`);
  const [endMonth, setEndMonth] = useState(`${to.slice(0, 7)}-01`);

  useEffect(() => {
    if (open) return;
    setTempFrom(from);
    setTempTo(to);
    setStartMonth(`${from.slice(0, 7)}-01`);
    setEndMonth(`${to.slice(0, 7)}-01`);
  }, [from, to, open]);

  const openModal = () => {
    if (disabled) return;
    setTempFrom(from);
    setTempTo(to);
    setStartMonth(`${from.slice(0, 7)}-01`);
    setEndMonth(`${to.slice(0, 7)}-01`);
    setOpen(true);
  };

  const apply = () => {
    const nextFrom = tempFrom <= tempTo ? tempFrom : tempTo;
    const nextTo = tempFrom <= tempTo ? tempTo : tempFrom;
    onApply(nextFrom, nextTo);
    setOpen(false);
  };

  useEnterToConfirm(open, apply, () => setOpen(false));

  return (
    <>
      <div className="flex min-w-[280px] items-center gap-2">
        {label ? (
          <span className="shrink-0 text-[11px] font-semibold uppercase tracking-wider text-pos-muted">{label}</span>
        ) : null}
        <button
          type="button"
          onClick={openModal}
          disabled={disabled}
          className="pos-select-trigger !h-9 min-w-0 flex-1 justify-center gap-2 px-3 disabled:opacity-60"
        >
          <CalendarDays size={14} className="shrink-0 text-pos-muted" />
          <span className="min-w-0 flex-1 truncate text-center text-xs text-zinc-200">
            {formatPeriodDateLabel(from)} - {formatPeriodDateLabel(to)}
          </span>
        </button>
      </div>

      {open ? (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center pos-modal-overlay p-6"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-[720px] overflow-hidden rounded border border-pos-border bg-pos-surface shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="px-6 py-5 text-center">
              <h3 className="text-lg font-semibold text-pos-fg">Período</h3>
              <div className="mt-4 inline-flex items-center rounded border border-pos-border bg-pos-bg px-4 py-2 font-semibold text-pos-fg">
                {formatPeriodDateLabel(tempFrom)} - {formatPeriodDateLabel(tempTo)}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-6 p-6 md:grid-cols-2">
              <div>
                <p className="mb-3 text-center text-sm text-pos-fg">Início</p>
                <div className="mx-auto max-w-[260px] rounded border border-pos-border bg-pos-bg p-4">
                  <div className="flex items-center justify-between px-1 pb-4">
                    <button
                      type="button"
                      onClick={() => setStartMonth(shiftMonth(startMonth, -1))}
                      className="rounded p-1 text-pos-muted transition-colors hover:bg-pos-surface-3 hover:text-pos-fg"
                    >
                      <ChevronLeft size={16} />
                    </button>
                    <div className="font-semibold capitalize text-pos-fg">{monthLabel(startMonth)}</div>
                    <button
                      type="button"
                      onClick={() => setStartMonth(shiftMonth(startMonth, 1))}
                      className="rounded p-1 text-pos-muted transition-colors hover:bg-pos-surface-3 hover:text-pos-fg"
                    >
                      <ChevronRight size={16} />
                    </button>
                  </div>
                  <CalendarGrid monthValue={startMonth} selectedValue={tempFrom} onSelect={setTempFrom} />
                </div>
              </div>

              <div>
                <p className="mb-3 text-center text-sm text-pos-fg">Fim</p>
                <div className="mx-auto max-w-[260px] rounded border border-pos-border bg-pos-bg p-4">
                  <div className="flex items-center justify-between px-1 pb-4">
                    <button
                      type="button"
                      onClick={() => setEndMonth(shiftMonth(endMonth, -1))}
                      className="rounded p-1 text-pos-muted transition-colors hover:bg-pos-surface-3 hover:text-pos-fg"
                    >
                      <ChevronLeft size={16} />
                    </button>
                    <div className="font-semibold capitalize text-pos-fg">{monthLabel(endMonth)}</div>
                    <button
                      type="button"
                      onClick={() => setEndMonth(shiftMonth(endMonth, 1))}
                      className="rounded p-1 text-pos-muted transition-colors hover:bg-pos-surface-3 hover:text-pos-fg"
                    >
                      <ChevronRight size={16} />
                    </button>
                  </div>
                  <CalendarGrid monthValue={endMonth} selectedValue={tempTo} onSelect={setTempTo} />
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2 border-t border-pos-border px-6 py-4">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="inline-flex h-10 items-center gap-2 rounded border border-pos-border px-4 text-sm text-pos-muted hover:bg-pos-surface-3 hover:text-pos-fg"
              >
                <X size={16} />
                Cancelar
              </button>
              <button
                type="button"
                onClick={apply}
                className="pos-on-accent inline-flex h-10 items-center gap-2 rounded bg-[#0001fb] px-4 text-sm font-semibold text-white hover:bg-[#1a1bff]"
              >
                <Check size={16} />
                OK
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
