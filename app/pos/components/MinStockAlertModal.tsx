'use client';

import { AnimatePresence, motion } from 'motion/react';
import { AlertTriangle } from 'lucide-react';
import { useEnterToConfirm } from '@/hooks/useEnterToConfirm';

export function MinStockAlertModal({
  alert,
  onClose,
}: {
  alert: { name: string; quantity: number } | null;
  onClose: () => void;
}) {
  useEnterToConfirm(Boolean(alert), onClose);
  return (
    <AnimatePresence>
      {alert && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4"
          onClick={onClose}
        >
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
              <div className="w-16 h-16 rounded-full bg-amber-500/20 flex items-center justify-center text-amber-600 mx-auto">
                <AlertTriangle size={32} />
              </div>
              <div>
                <h2 className="text-xl font-bold text-pos-fg tracking-tight">Aviso de stock</h2>
                <p className="text-sm text-pos-muted mt-2">
                  O stock de{' '}
                  <span className="text-pos-fg font-bold">&quot;{alert.name}&quot;</span> está no
                  nível mínimo ({alert.quantity}). Reabastecimento necessário.
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="pos-on-accent w-full h-12 bg-[#0001fb] hover:bg-[#1a1bff] text-white rounded font-bold transition-all"
              >
                OK
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
