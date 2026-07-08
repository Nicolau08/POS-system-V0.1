'use client';

import { useEffect } from 'react';
import { X } from 'lucide-react';

export type LicenseAdminAlertModalProps = {
  open: boolean;
  variant: 'error' | 'success' | 'confirm';
  message: string;
  title?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  confirming?: boolean;
  onClose: () => void;
  onConfirm?: () => void;
};

export function LicenseAdminAlertModal({
  open,
  variant,
  message,
  title,
  confirmLabel = 'Confirmar',
  cancelLabel = 'Cancelar',
  confirming = false,
  onClose,
  onConfirm,
}: LicenseAdminAlertModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !confirming) onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose, confirming]);

  if (!open) return null;

  const isError = variant === 'error';
  const isConfirm = variant === 'confirm';
  const heading =
    title || (isConfirm ? 'Confirmar eliminação' : isError ? 'Erro' : 'Sucesso');

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 px-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="license-admin-alert-title"
      onClick={() => {
        if (!confirming) onClose();
      }}
    >
      <div
        className={`w-full max-w-md rounded-xl border bg-zinc-900 p-5 shadow-xl ${
          isError || isConfirm ? 'border-red-800/60' : 'border-emerald-800/60'
        }`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <h2
            id="license-admin-alert-title"
            className={`text-base font-semibold ${
              isError || isConfirm ? 'text-red-300' : 'text-emerald-300'
            }`}
          >
            {heading}
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={confirming}
            className="rounded p-1 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200 disabled:opacity-40"
            aria-label="Fechar"
          >
            <X size={18} />
          </button>
        </div>
        <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-zinc-200">{message}</p>

        {isConfirm ? (
          <div className="mt-5 flex gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={confirming}
              className="flex-1 rounded-lg border border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-200 transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {cancelLabel}
            </button>
            <button
              type="button"
              onClick={() => onConfirm?.()}
              disabled={confirming || !onConfirm}
              className="flex-1 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {confirming ? 'A apagar…' : confirmLabel}
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={onClose}
            className={`mt-4 w-full rounded-lg px-4 py-2 text-sm font-medium text-white transition-colors ${
              isError ? 'bg-red-600 hover:bg-red-500' : 'bg-emerald-600 hover:bg-emerald-500'
            }`}
          >
            OK
          </button>
        )}
      </div>
    </div>
  );
}
