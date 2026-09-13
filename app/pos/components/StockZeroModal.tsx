'use client';

import { AnimatePresence, motion } from 'motion/react';
import { AlertTriangle } from 'lucide-react';
import { useEnterToConfirm } from '@/hooks/useEnterToConfirm';

export function StockZeroModal({
  isOpen,
  productName,
  onCancel,
  onConfirm,
}: {
  isOpen: boolean;
  productName: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  useEnterToConfirm(isOpen, onConfirm, onCancel);
  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" onClick={onCancel}>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 pos-modal-overlay backdrop-blur-md"
          />
          <motion.div
            initial={{ scale: 0.9, opacity: 0, y: 20 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.9, opacity: 0, y: 20 }}
            className="relative w-full max-w-md bg-pos-surface border border-pos-border rounded overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-6 text-center space-y-4">
              <div className="w-16 h-16 rounded-full bg-red-500/20 flex items-center justify-center text-red-500 mx-auto">
                <AlertTriangle size={32} />
              </div>
              <div>
                <h2 className="text-xl font-bold text-pos-fg tracking-tight">Produto sem stock</h2>
                <p className="text-sm text-pos-muted mt-2">
                  O produto <span className="text-pos-fg font-bold">&quot;{productName}&quot;</span> está com quantidade zero no stock.
                </p>
                <p className="text-sm text-pos-muted mt-1 italic">
                  Deseja continuar com a venda mesmo assim?
                </p>
              </div>
              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={onCancel}
                  className="flex-1 h-12 rounded border border-pos-border bg-pos-field hover:bg-pos-surface-2 text-pos-fg font-bold transition-all"
                >
                  Não
                </button>
                <button
                  type="button"
                  onClick={onConfirm}
                  className="pos-on-accent flex-1 h-12 bg-red-600 hover:bg-red-500 text-white rounded font-bold transition-all"
                >
                  Sim, Continuar
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
