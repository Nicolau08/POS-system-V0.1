'use client';

import { useEffect, useState } from 'react';

export type PosDateTimePickerModalProps = {
  open: boolean;
  title: string;
  value: string;
  onClose: () => void;
  onApply: (iso: string) => void;
};

function isoToDatetimeLocalValue(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return '';
  const date = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function datetimeLocalToIso(local: string): string {
  if (!local.trim()) return new Date().toISOString();
  const parsed = new Date(local);
  if (Number.isNaN(parsed.getTime())) return new Date().toISOString();
  return parsed.toISOString();
}

export function PosDateTimePickerModal({
  open,
  title,
  value,
  onClose,
  onApply,
}: PosDateTimePickerModalProps) {
  const [draft, setDraft] = useState('');

  useEffect(() => {
    if (open) setDraft(isoToDatetimeLocalValue(value));
  }, [open, value]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 px-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="pos-datetime-picker-title"
    >
      <div className="w-full max-w-md rounded-xl border border-zinc-700 bg-zinc-900 p-5 shadow-xl">
        <h2 id="pos-datetime-picker-title" className="text-base font-semibold text-white">
          {title}
        </h2>
        <label className="mt-4 block text-sm text-zinc-300">
          Data e hora
          <input
            type="datetime-local"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-[#0001fb] focus:ring-1 focus:ring-[rgba(0,1,251,0.4)]"
          />
        </label>
        <div className="mt-5 flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-lg border border-zinc-600 px-4 py-2 text-sm text-zinc-200 transition-colors hover:bg-zinc-800"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => onApply(datetimeLocalToIso(draft))}
            className="flex-1 rounded-lg bg-[#0001fb] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1a1bff]"
          >
            Aplicar
          </button>
        </div>
      </div>
    </div>
  );
}
