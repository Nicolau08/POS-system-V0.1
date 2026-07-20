'use client';

import React from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Power, X } from 'lucide-react';

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
  message: string;
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

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm"
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
            className="w-full max-w-md overflow-hidden rounded-lg border border-zinc-700 bg-[#1f1f1f] shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-3 border-b border-zinc-800">
              <h2 id="posly-confirm-title" className="text-lg font-semibold text-white tracking-tight">
                {title}
              </h2>
              <button
                type="button"
                onClick={onCancel}
                className="p-2 rounded text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"
                aria-label="Fechar"
              >
                <X size={18} />
              </button>
            </div>

            <div className="px-5 py-6 flex gap-4 items-start">
              <div
                className={`shrink-0 w-12 h-12 rounded-full flex items-center justify-center border ${
                  tone === 'danger'
                    ? 'bg-red-600/15 border-red-600/30 text-red-400'
                    : 'bg-zinc-800 border-zinc-700 text-zinc-300'
                }`}
              >
                {icon ?? <Power size={22} />}
              </div>
              <p id="posly-confirm-message" className="text-[15px] leading-relaxed text-zinc-300 pt-2">
                {message}
              </p>
            </div>

            <div className="px-5 py-4 border-t border-zinc-800 flex justify-end gap-3 bg-[#1a1a1a]">
              <button
                type="button"
                onClick={onCancel}
                className="h-11 min-w-[110px] px-4 rounded border border-zinc-700 bg-[#1f1f1f] text-sm font-medium text-zinc-200 hover:bg-zinc-800 hover:border-[#0001fb] transition-colors"
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
