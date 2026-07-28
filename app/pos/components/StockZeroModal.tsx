'use client';

import { AnimatePresence, motion } from 'motion/react';
import { AlertTriangle } from 'lucide-react';

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
  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" onClick={onCancel}>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-black/90 backdrop-blur-md"
          />
          <motion.div
            initial={{ scale: 0.9, opacity: 0, y: 20 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.9, opacity: 0, y: 20 }}
            className="relative w-full max-w-md bg-zinc-900 border border-zinc-800 rounded overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-6 text-center space-y-4">
              <div className="w-16 h-16 rounded-full bg-red-500/20 flex items-center justify-center text-red-500 mx-auto">
                <AlertTriangle size={32} />
              </div>
              <div>
                <h2 className="text-xl font-bold text-white tracking-tight">Produto sem Stock</h2>
                <p className="text-sm text-zinc-400 mt-2">
                  O produto <span className="text-white font-bold">&quot;{productName}&quot;</span> está com quantidade zero no stock.
                </p>
                <p className="text-sm text-zinc-500 mt-1 italic">
                  Deseja continuar com a venda mesmo assim?
                </p>
              </div>
              <div className="flex gap-3 pt-2">
                <button
                  onClick={onCancel}
                  className="flex-1 h-12 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded font-bold transition-all"
                >
                  Não
                </button>
                <button
                  onClick={onConfirm}
                  className="flex-1 h-12 bg-red-600 hover:bg-red-500 text-white rounded font-bold transition-all"
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
