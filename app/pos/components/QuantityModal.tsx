'use client';

import React from 'react';
import { AnimatePresence, motion } from 'motion/react';

export function QuantityModal({
  isOpen,
  itemName,
  tempQuantity,
  setTempQuantity,
  onClose,
  onConfirm,
}: {
  isOpen: boolean;
  itemName: string;
  tempQuantity: string;
  setTempQuantity: React.Dispatch<React.SetStateAction<string>>;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm" onClick={onClose}>
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.9, opacity: 0 }}
            className="bg-[#1a1a1a] border border-zinc-800 rounded p-6 w-full max-w-[320px] overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-bold text-white mb-1 text-center">{itemName}</h3>
            <p className="text-xs text-zinc-500 mb-6 text-center">Atualizar quantidade do produto</p>

            <div className="space-y-6">
              <div className="flex items-center gap-2 w-full">
                <button
                  onClick={() => setTempQuantity((prev) => {
                    const val = parseFloat(prev) || 0;
                    return Math.max(0, val - 1).toString();
                  })}
                  className="w-10 h-10 shrink-0 flex items-center justify-center bg-zinc-800 hover:bg-zinc-700 rounded text-xl font-bold transition-colors"
                >
                  -
                </button>
                <input
                  type="number"
                  step="any"
                  value={tempQuantity ?? ''}
                  onChange={(e) => setTempQuantity(e.target.value)}
                  className="flex-1 min-w-0 h-10 bg-zinc-900 border border-zinc-800 rounded text-center text-xl font-bold outline-none focus:border-[#0001fb] transition-colors"
                  autoFocus
                />
                <button
                  onClick={() => setTempQuantity((prev) => {
                    const val = parseFloat(prev) || 0;
                    return (val + 1).toString();
                  })}
                  className="w-10 h-10 shrink-0 flex items-center justify-center bg-zinc-800 hover:bg-zinc-700 rounded text-xl font-bold transition-colors"
                >
                  +
                </button>
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  onClick={onClose}
                  className="flex-1 h-11 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded font-bold transition-colors text-sm"
                >
                  Cancelar
                </button>
                <button
                  onClick={onConfirm}
                  className="flex-1 h-11 bg-[#0001fb] hover:bg-[#1a1bff] text-white rounded font-bold transition-colors text-sm"
                >
                  Confirmar
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
