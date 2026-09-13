'use client';

import { AnimatePresence, motion } from 'motion/react';
import { numberInputDisplayValue } from '@/lib/numberInput';
import { useEnterToConfirm } from '@/hooks/useEnterToConfirm';

function typeButtonClass(active: boolean) {
  return `py-3 rounded border text-sm transition-all font-medium ${
    active
      ? 'border-[#0001fb] bg-[#0001fb]/10 text-[#0001fb]'
      : 'border-pos-border bg-pos-field text-pos-fg hover:border-[#0001fb]'
  }`;
}

export function DiscountModal({
  isOpen,
  onClose,
  discountType,
  setDiscountType,
  discountTarget,
  setDiscountTarget,
  discountAmount,
  setDiscountAmount,
  selectedCartItemId,
  previewDiscount,
  formatPrice,
  onApply,
  canApply,
}: {
  isOpen: boolean;
  onClose: () => void;
  discountType: 'value' | 'percentage';
  setDiscountType: (type: 'value' | 'percentage') => void;
  discountTarget: 'all' | 'selected';
  setDiscountTarget: (target: 'all' | 'selected') => void;
  discountAmount: string;
  setDiscountAmount: (amount: string) => void;
  selectedCartItemId: string | null;
  previewDiscount: { current: number; discount: number; name: string } | null;
  formatPrice: (value: number) => string;
  onApply: () => void;
  canApply: boolean;
}) {
  useEnterToConfirm(isOpen && canApply, onApply, onClose);
  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pos-modal-overlay backdrop-blur-md" onClick={onClose}>
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.9, opacity: 0 }}
            className="bg-pos-surface border border-pos-border rounded p-6 w-full max-w-[400px] space-y-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-center">
              <h3 className="text-xl font-bold text-pos-fg">Aplicar desconto</h3>
              <p className="text-sm text-pos-muted mt-1">Configure o desconto para o pedido</p>
            </div>

            <div className="space-y-4">
              <div className="space-y-2">
                <span className="text-sm font-medium text-pos-muted">Tipo de desconto</span>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setDiscountType('percentage')}
                    className={typeButtonClass(discountType === 'percentage')}
                  >
                    Percentagem (%)
                  </button>
                  <button
                    type="button"
                    onClick={() => setDiscountType('value')}
                    className={typeButtonClass(discountType === 'value')}
                  >
                    Valor (MT)
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                <span className="text-sm font-medium text-pos-muted">Aplicar em</span>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setDiscountTarget('all')}
                    className={typeButtonClass(discountTarget === 'all')}
                  >
                    Todos os itens
                  </button>
                  <button
                    type="button"
                    onClick={() => setDiscountTarget('selected')}
                    disabled={!selectedCartItemId}
                    className={`py-3 rounded border text-sm transition-all font-medium ${
                      discountTarget === 'selected'
                        ? 'border-[#0001fb] bg-[#0001fb]/10 text-[#0001fb]'
                        : !selectedCartItemId
                          ? 'border-pos-border bg-pos-surface-2 text-pos-muted cursor-not-allowed opacity-50'
                          : 'border-pos-border bg-pos-field text-pos-fg hover:border-[#0001fb]'
                    }`}
                  >
                    Item seleccionado
                  </button>
                </div>
                {!selectedCartItemId && discountTarget === 'selected' && (
                  <p className="text-sm text-red-600 italic">Seleccione um item no carrinho primeiro</p>
                )}
              </div>

              <div className="space-y-2">
                <span className="text-sm font-medium text-pos-muted">Valor do desconto</span>
                <div className="relative">
                  <input
                    type="number"
                    step="any"
                    inputMode="decimal"
                    value={numberInputDisplayValue(discountAmount)}
                    onChange={(e) => setDiscountAmount(e.target.value)}
                    placeholder="0.00"
                    className="w-full bg-pos-field border border-pos-border rounded py-3 px-4 text-sm text-right text-pos-fg font-mono font-bold outline-none focus:border-[#0001fb] transition-colors placeholder:text-pos-muted"
                    autoFocus
                  />
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-pos-muted font-mono text-sm pointer-events-none">
                    {discountType === 'percentage' ? '%' : 'MT'}
                  </span>
                </div>
              </div>
            </div>

            {previewDiscount && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-pos-field border border-pos-border rounded p-4 space-y-2"
              >
                <div className="flex justify-between items-center">
                  <span className="text-sm font-medium text-pos-muted">Resumo do desconto</span>
                  <span className="text-sm font-medium text-[#0001fb] capitalize px-2 py-0.5 bg-[#0001fb]/10 rounded-full">Preview</span>
                </div>
                <div className="space-y-1">
                  <div className="flex justify-between text-sm">
                    <span className="text-pos-muted">Alvo:</span>
                    <span className="text-pos-fg font-bold">{previewDiscount.name}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-pos-muted">Valor actual:</span>
                    <span className="text-pos-fg font-mono">{formatPrice(previewDiscount.current)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-pos-muted">Desconto:</span>
                    <span className="text-[#0001fb] font-mono">-{formatPrice(previewDiscount.discount)}</span>
                  </div>
                  <div className="pt-2 mt-2 border-t border-pos-border flex justify-between items-center">
                    <span className="text-sm font-medium text-pos-fg">Novo total:</span>
                    <span className="text-lg font-bold text-pos-fg font-mono">
                      {formatPrice(Math.max(0, previewDiscount.current - previewDiscount.discount))}
                    </span>
                  </div>
                </div>
              </motion.div>
            )}

            <div className="flex gap-3 pt-4">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 h-12 border border-pos-border bg-pos-field hover:bg-pos-surface-2 text-pos-fg text-sm rounded font-medium transition-all"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={onApply}
                disabled={!canApply}
                className={`flex-1 h-12 rounded text-sm font-medium transition-all ${
                  canApply
                    ? 'pos-on-accent bg-[#0001fb] hover:bg-[#1a1bff] text-white'
                    : 'border border-pos-border bg-pos-surface-3 text-pos-muted cursor-not-allowed'
                }`}
              >
                Aplicar
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
