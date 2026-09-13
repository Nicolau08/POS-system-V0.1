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
      className="fixed inset-0 z-[100] flex items-center justify-center pos-modal-overlay px-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="pos-datetime-picker-title"
    >
      <div className="pos-modal w-full max-w-md p-5">
        <h2 id="pos-datetime-picker-title" className="text-base font-semibold text-pos-fg">
          {title}
        </h2>
        <label className="mt-4 block text-sm text-pos-muted">
          Data e hora
          <input
            type="datetime-local"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            className="pos-field mt-1 w-full rounded px-3 py-2 text-sm"
          />
        </label>
        <div className="mt-5 flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded border border-pos-border px-4 py-2 text-sm text-pos-muted transition-colors hover:bg-pos-surface-3"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => onApply(datetimeLocalToIso(draft))}
            className="flex-1 rounded bg-[#0001fb] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1a1bff]"
          >
            Aplicar
          </button>
        </div>
      </div>
    </div>
  );
}
