'use client';

import React from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Power, X } from 'lucide-react';
import { useEnterToConfirm } from '@/hooks/useEnterToConfirm';

export function ConfirmDialog({
  isOpen,
  title = 'Confirmar',
  message,
  confirmLabel = 'Confirmar',
  cancelLabel = 'Cancelar',
  tone = 'danger',
  icon,
  onConfirm,
  onCancel,
}: {
  isOpen: boolean;
  title?: string;
  message: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'danger' | 'default';
  icon?: React.ReactNode;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const confirmClass =
    tone === 'danger'
      ? 'bg-red-600 hover:bg-red-500 text-white'
      : 'bg-[#0001fb] hover:bg-[#1a1bff] text-white';

  useEnterToConfirm(isOpen, onConfirm, onCancel);

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[200] flex items-center justify-center p-4 pos-modal-overlay"
          onClick={onCancel}
        >
          <motion.div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="posly-confirm-title"
            aria-describedby="posly-confirm-message"
            initial={{ opacity: 0, scale: 0.96, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 8 }}
            transition={{ type: 'spring', damping: 26, stiffness: 280 }}
            className="pos-modal w-full max-w-md"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="pos-modal-header">
              <h2 id="posly-confirm-title" className="text-lg font-semibold text-pos-fg tracking-tight">
                {title}
              </h2>
              <button
                type="button"
                onClick={onCancel}
                className="p-2 rounded text-pos-muted hover:text-pos-fg hover:bg-pos-surface-3 transition-colors"
                aria-label="Fechar"
              >
                <X size={18} />
              </button>
            </div>

            <div className="pos-modal-body flex gap-4 items-start !py-6">
              <div
                className={`shrink-0 w-12 h-12 rounded-full flex items-center justify-center border ${
                  tone === 'danger'
                    ? 'bg-red-600/15 border-red-600/30 text-red-400'
                    : 'bg-pos-surface-3 border-pos-border text-pos-muted'
                }`}
              >
                {icon ?? <Power size={22} />}
              </div>
              <div id="posly-confirm-message" className="text-[15px] leading-relaxed text-pos-muted pt-2 space-y-2">
                {typeof message === 'string' ? <p>{message}</p> : message}
              </div>
            </div>

            <div className="pos-modal-footer gap-3">
              <button
                type="button"
                onClick={onCancel}
                className="h-11 min-w-[110px] px-4 rounded border border-pos-border bg-pos-surface-3 text-sm font-medium text-pos-muted hover:bg-pos-surface-2 hover:border-[#0001fb] transition-colors"
              >
                {cancelLabel}
              </button>
              <button
                type="button"
                onClick={onConfirm}
                className={`h-11 min-w-[110px] px-4 rounded text-sm font-semibold transition-colors ${confirmClass}`}
              >
                {confirmLabel}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export async function quitPoslyApp(options?: {
  onFallbackLogout?: () => void;
}) {
  if (window.electronAPI?.quitApp) {
    try {
      const result = await window.electronAPI.quitApp();
      if (result?.success) return;
    } catch {
      /* fallback below */
    }
  }

  options?.onFallbackLogout?.();
  try {
    window.close();
  } catch {
    // Browser may ignore window.close() when not opened by script.
  }
}
