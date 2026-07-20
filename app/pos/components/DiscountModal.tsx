'use client';

import { AnimatePresence, motion } from 'motion/react';

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
  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md" onClick={onClose}>
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.9, opacity: 0 }}
            className="bg-[#1a1a1a] border border-zinc-800 rounded p-6 w-full max-w-[400px] space-y-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-center">
              <h3 className="text-xl font-bold text-white">Aplicar Desconto</h3>
              <p className="text-sm text-zinc-500 mt-1">Configure o desconto para o pedido</p>
            </div>

            <div className="space-y-4">
              <div className="space-y-2">
                <span className="text-sm font-medium text-zinc-500 capitalize">Tipo de Desconto</span>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => setDiscountType('percentage')}
                    className={`py-3 rounded border text-sm transition-all font-medium ${
                      discountType === 'percentage'
                        ? 'bg-zinc-900 border-[#0001fb] text-[#a5b4fc]'
                        : 'bg-zinc-900 border-zinc-800 text-zinc-500 hover:border-[#0001fb]'
                    }`}
                  >
                    Porcentagem (%)
                  </button>
                  <button
                    onClick={() => setDiscountType('value')}
                    className={`py-3 rounded border text-sm transition-all font-medium ${
                      discountType === 'value'
                        ? 'bg-zinc-900 border-[#0001fb] text-[#a5b4fc]'
                        : 'bg-zinc-900 border-zinc-800 text-zinc-500 hover:border-[#0001fb]'
                    }`}
                  >
                    Valor (MT)
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                <span className="text-sm font-medium text-zinc-500 capitalize">Aplicar em</span>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => setDiscountTarget('all')}
                    className={`py-3 rounded border text-sm transition-all font-medium ${
                      discountTarget === 'all'
                        ? 'bg-zinc-900 border-[#0001fb] text-[#a5b4fc]'
                        : 'bg-zinc-900 border-zinc-800 text-zinc-500 hover:border-[#0001fb]'
                    }`}
                  >
                    Todos os Itens
                  </button>
                  <button
                    onClick={() => setDiscountTarget('selected')}
                    disabled={!selectedCartItemId}
                    className={`py-3 rounded border text-sm transition-all font-medium ${
                      discountTarget === 'selected'
                        ? 'bg-zinc-900 border-[#0001fb] text-[#a5b4fc]'
                        : !selectedCartItemId
                          ? 'bg-zinc-900/50 border-zinc-800/50 text-zinc-700 cursor-not-allowed'
                          : 'bg-zinc-900 border-zinc-800 text-zinc-500 hover:border-[#0001fb]'
                    }`}
                  >
                    Item Selecionado
                  </button>
                </div>
                {!selectedCartItemId && discountTarget === 'selected' && (
                  <p className="text-sm text-red-400 italic">Selecione um item no carrinho primeiro</p>
                )}
              </div>

              <div className="space-y-2">
                <span className="text-sm font-medium text-zinc-500 capitalize">Valor do Desconto</span>
                <div className="relative">
                  <input
                    type="number"
                    step="any"
                    value={discountAmount ?? ''}
                    onChange={(e) => setDiscountAmount(e.target.value)}
                    placeholder="0.00"
                    className="w-full bg-zinc-950 border border-zinc-700 rounded py-3 px-4 text-sm text-right text-[#a5b4fc] font-mono font-bold outline-none focus:border-[#0001fb] transition-colors"
                    autoFocus
                  />
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500 font-mono text-sm pointer-events-none">
                    {discountType === 'percentage' ? '%' : 'MT'}
                  </span>
                </div>
              </div>
            </div>

            {previewDiscount && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-zinc-900/50 border border-zinc-800 rounded p-4 space-y-2"
              >
                <div className="flex justify-between items-center">
                  <span className="text-sm font-medium text-zinc-500 capitalize">Resumo do Desconto</span>
                  <span className="text-sm font-medium text-[#0001fb] capitalize px-2 py-0.5 bg-[#0001fb]/10 rounded-full">Preview</span>
                </div>
                <div className="space-y-1">
                  <div className="flex justify-between text-sm">
                    <span className="text-zinc-400">Alvo:</span>
                    <span className="text-zinc-200 font-bold">{previewDiscount.name}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-zinc-400">Valor Atual:</span>
                    <span className="text-zinc-200 font-mono">{formatPrice(previewDiscount.current)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-zinc-400">Desconto:</span>
                    <span className="text-[#a5b4fc] font-mono">-{formatPrice(previewDiscount.discount)}</span>
                  </div>
                  <div className="pt-2 mt-2 border-t border-zinc-800 flex justify-between items-center">
                    <span className="text-sm font-medium text-white capitalize">Novo Total:</span>
                    <span className="text-lg font-bold text-white font-mono">
                      {formatPrice(Math.max(0, previewDiscount.current - previewDiscount.discount))}
                    </span>
                  </div>
                </div>
              </motion.div>
            )}

            <div className="flex gap-3 pt-4">
              <button
                onClick={onClose}
                className="flex-1 h-12 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-sm rounded font-medium transition-all"
              >
                Cancelar
              </button>
              <button
                onClick={onApply}
                disabled={!canApply}
                className={`flex-1 h-12 rounded text-sm font-medium transition-all ${
                  canApply
                    ? 'bg-[#0001fb] hover:bg-[#1a1bff] text-white'
                    : 'bg-zinc-800 text-zinc-600 cursor-not-allowed'
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
