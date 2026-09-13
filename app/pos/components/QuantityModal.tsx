'use client';

import React from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { numberInputDisplayValue } from '@/lib/numberInput';
import { useEnterToConfirm } from '@/hooks/useEnterToConfirm';

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
  useEnterToConfirm(isOpen, onConfirm, onClose);
  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pos-modal-overlay" onClick={onClose}>
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.9, opacity: 0 }}
            className="bg-pos-surface border border-pos-border rounded p-6 w-full max-w-[320px] overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-bold text-pos-fg mb-1 text-center">{itemName}</h3>
            <p className="text-xs text-pos-muted mb-6 text-center">Actualizar quantidade do produto</p>

            <div className="space-y-6">
              <div className="flex items-center gap-2 w-full">
                <button
                  type="button"
                  onClick={() => setTempQuantity((prev) => {
                    const val = parseFloat(prev) || 0;
                    return Math.max(0, val - 1).toString();
                  })}
                  className="w-10 h-10 shrink-0 flex items-center justify-center rounded border border-pos-border bg-pos-field text-pos-fg text-xl font-bold transition-colors hover:border-[#0001fb]"
                >
                  −
                </button>
                <input
                  type="number"
                  step="any"
                  inputMode="decimal"
                  value={numberInputDisplayValue(tempQuantity)}
                  onChange={(e) => setTempQuantity(e.target.value)}
                  placeholder="0"
                  className="flex-1 min-w-0 h-10 bg-pos-field border border-pos-border rounded text-center text-xl font-bold text-pos-fg outline-none focus:border-[#0001fb] transition-colors placeholder:text-pos-muted"
                  autoFocus
                />
                <button
                  type="button"
                  onClick={() => setTempQuantity((prev) => {
                    const val = parseFloat(prev) || 0;
                    return (val + 1).toString();
                  })}
                  className="w-10 h-10 shrink-0 flex items-center justify-center rounded border border-pos-border bg-pos-field text-pos-fg text-xl font-bold transition-colors hover:border-[#0001fb]"
                >
                  +
                </button>
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="flex-1 h-11 rounded border border-pos-border bg-pos-field hover:bg-pos-surface-2 text-pos-fg font-bold transition-colors text-sm"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={onConfirm}
                  className="pos-on-accent flex-1 h-11 bg-[#0001fb] hover:bg-[#1a1bff] text-white rounded font-bold transition-colors text-sm"
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
