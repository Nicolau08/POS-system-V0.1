'use client';

import { AnimatePresence, motion } from 'motion/react';
import { AlertTriangle } from 'lucide-react';
import { useEnterToConfirm } from '@/hooks/useEnterToConfirm';

export function CancelOrderModal({
  isOpen,
  onCancel,
  onConfirm,
}: {
  isOpen: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  useEnterToConfirm(isOpen, onConfirm, onCancel);
  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 pos-modal-overlay backdrop-blur-xl">
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.9, opacity: 0 }}
            className="bg-[var(--pos-surface)] border border-pos-border rounded p-8 w-full max-w-[400px] text-center space-y-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="w-20 h-20 bg-amber-500/10 rounded flex items-center justify-center mx-auto text-amber-500">
              <AlertTriangle size={40} />
            </div>

            <div className="space-y-2">
              <h3 className="text-xl font-bold text-pos-fg tracking-tight">Cancelar pedido?</h3>
              <p className="text-sm text-pos-muted">
                Tem a certeza que deseja cancelar este pedido? Todos os itens adicionados ao carrinho serão removidos.
              </p>
            </div>

            <div className="flex gap-3">
              <button
                type="button"
                onClick={onCancel}
                className="flex-1 h-14 rounded border border-pos-border bg-pos-field hover:bg-pos-surface-2 text-pos-fg font-bold transition-all"
              >
                Não, voltar
              </button>
              <button
                type="button"
                onClick={onConfirm}
                className="pos-on-accent flex-1 h-14 bg-red-600 hover:bg-red-500 text-white rounded font-bold transition-all"
              >
                Sim, cancelar
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
