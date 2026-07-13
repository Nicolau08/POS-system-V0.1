'use client';

import React from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Banknote, Plus, Printer, RotateCcw, Trash2, User } from 'lucide-react';
import type { CartItem, Customer, Discount } from '@/app/pos/types';

// Right sidebar cart section extracted from the POS page.
export function Cart({
  selectedCartItemId,
  onDeleteSelected,
  docType,
  onCycleDocType,
  selectedCustomer,
  customerName,
  onCustomerNameChange,
  customers,
  onSelectCustomer,
  onCreateCustomerFromName,
  cart,
  globalDiscount,
  formatPrice,
  onToggleItemSelection,
  onEditItemQuantity,
  onRemoveItem,
  onClearSelection,
  originalSubtotal,
  totalDiscount,
  tax,
  total,
  onCancelOrder,
  onOpenPayment,
  onOpenBillPreview,
}: {
  selectedCartItemId: string | null;
  onDeleteSelected: () => void;
  docType: 'VD' | 'TK' | 'FP' | 'FT';
  onCycleDocType: () => void;
  selectedCustomer: Customer | null;
  customerName: string;
  onCustomerNameChange: (value: string) => void;
  customers: Customer[];
  onSelectCustomer: (customer: Customer | null) => void;
  onCreateCustomerFromName: () => void;
  cart: CartItem[];
  globalDiscount: Discount | null;
  formatPrice: (value: number) => string;
  onToggleItemSelection: (id: string) => void;
  onEditItemQuantity: (item: CartItem) => void;
  onRemoveItem: (id: string) => void;
  onClearSelection: () => void;
  originalSubtotal: number;
  totalDiscount: number;
  tax: number;
  total: number;
  onCancelOrder: () => void;
  onOpenPayment: () => void;
  onOpenBillPreview: () => void;
}) {
  const docTypeButtonClass =
    docType === 'FP'
      ? 'bg-amber-600 hover:bg-amber-500'
      : docType === 'TK'
        ? 'bg-sky-600 hover:bg-sky-500'
        : 'bg-emerald-600 hover:bg-emerald-500';

  return (
    <div className="w-[350px] flex flex-col border-l border-zinc-800 bg-[#151515]">
      <div className="h-14 p-2 border-b border-zinc-800 flex items-center gap-2 bg-[#1a1a1a]">
        <button
          onClick={onDeleteSelected}
          disabled={!selectedCartItemId}
          className={`w-12 h-10 flex flex-col items-center justify-center rounded transition-colors ${
            selectedCartItemId
              ? 'bg-zinc-800 hover:bg-zinc-700 text-red-400'
              : 'bg-zinc-800 text-zinc-700 cursor-not-allowed opacity-50'
          }`}
          title="Deletar item selecionado"
        >
          <Trash2 size={14} />
          <span className="text-[8px] capitalize font-bold mt-0.5">Del</span>
        </button>

        <div className="flex-[2] flex items-center bg-zinc-800 rounded h-10 relative overflow-hidden">
          <button
            onClick={onCycleDocType}
            className={`h-full px-3 text-white font-bold text-xs flex items-center justify-center min-w-[45px] transition-colors border-r border-zinc-700/50 ${docTypeButtonClass}`}
            title="Tipo de Documento"
          >
            {docType}
          </button>

          <div className="flex-1 flex items-center px-3 h-full">
            {selectedCustomer ? (
              <div className="flex items-center gap-2 w-full overflow-hidden">
                <div className="w-5 h-5 rounded-full bg-emerald-500 flex items-center justify-center text-white flex-shrink-0">
                  <User size={12} />
                </div>
                <span className="text-xs text-emerald-400 font-bold truncate">{selectedCustomer.name}</span>
                <button onClick={() => onSelectCustomer(null)} className="ml-auto text-zinc-500 hover:text-rose-500 transition-colors">
                  <RotateCcw size={12} />
                </button>
              </div>
            ) : (
              <>
                <input
                  type="text"
                  value={customerName ?? ''}
                  onChange={(e) => onCustomerNameChange(e.target.value)}
                  className="bg-transparent w-full outline-none text-xs text-zinc-200 placeholder:text-zinc-600"
                  placeholder="Nome do cliente..."
                />
                {customerName.length > 0 && (
                  <div className="pos-dropdown absolute top-full left-0 z-50 mt-1 w-full">
                    {customers
                      .filter((c) => c.name.toLowerCase().includes(customerName.toLowerCase()))
                      .slice(0, 3)
                      .map((c) => (
                        <button
                          key={c.id}
                          onClick={() => onSelectCustomer(c)}
                          className="pos-dropdown-item flex items-center gap-2"
                        >
                          <div className="w-4 h-4 rounded-full bg-emerald-500 flex items-center justify-center text-white">
                            <User size={10} />
                          </div>
                          <div className="flex flex-col">
                            <span className="text-[11px] text-white font-bold leading-none">{c.name}</span>
                            <span className="text-[9px] text-zinc-500">{c.phone}</span>
                          </div>
                        </button>
                      ))}

                    {!customers.some((c) => c.name.toLowerCase() === customerName.toLowerCase()) && (
                      <button
                        onClick={onCreateCustomerFromName}
                        className="pos-dropdown-item mt-0.5 flex items-center gap-2 text-emerald-400 hover:!bg-emerald-500/10"
                      >
                        <Plus size={12} />
                        <span className="text-[10px] font-bold capitalize tracking-tight">Cadastrar &quot;{customerName}&quot;</span>
                      </button>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </div>

      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-1 scrollbar-hide" onClick={onClearSelection}>
        {cart.length === 0 ? (
          <div className="h-full flex items-center justify-center text-zinc-600 text-sm italic">Sem itens</div>
        ) : (
          <AnimatePresence initial={false}>
            {cart.map((item) => (
              <motion.div
                key={item.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, x: -20 }}
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleItemSelection(item.id);
                }}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  onEditItemQuantity(item);
                }}
                className={`flex justify-between items-center p-3 border rounded transition-colors group cursor-pointer ${
                  selectedCartItemId === item.id
                    ? 'bg-emerald-500/20 border-emerald-500/50'
                    : 'bg-zinc-900/50 border-zinc-800 hover:bg-zinc-800/50'
                }`}
              >
                <div className="flex flex-col">
                  <span className="text-sm font-medium text-zinc-200">{item.name}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-zinc-500">{item.quantity} x {formatPrice(item.price)}</span>
                    {item.discount && (
                      <span className="text-[10px] bg-emerald-500/20 text-emerald-400 px-1 rounded-md font-bold">
                        -{item.discount.type === 'percentage' ? `${item.discount.amount}%` : formatPrice(item.discount.amount)}
                      </span>
                    )}
                    {globalDiscount && (
                      <span className="text-[10px] bg-emerald-500/20 text-emerald-400 px-1 rounded-md font-bold">
                        Global: -{globalDiscount.type === 'percentage' ? `${globalDiscount.amount}%` : formatPrice(globalDiscount.amount / cart.length)}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm font-bold text-zinc-100">{formatPrice(item.price * item.quantity)}</span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onRemoveItem(item.id);
                    }}
                    className="opacity-0 group-hover:opacity-100 text-zinc-600 hover:text-red-400 transition-all"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        )}
      </div>

      <div className="p-3 bg-[#1a1a1a] border-t border-zinc-800 space-y-0.5">
        <div className="flex justify-between text-xs text-zinc-500">
          <span>Subtotal</span>
          <span>{formatPrice(originalSubtotal)}</span>
        </div>
        {totalDiscount > 0 && (
          <div className="flex justify-between text-xs text-emerald-500">
            <span>Desconto</span>
            <span>-{formatPrice(totalDiscount)}</span>
          </div>
        )}
        <div className="flex justify-between text-xs text-zinc-500">
          <span>Imposto</span>
          <span>{formatPrice(tax)}</span>
        </div>
        <div className="pt-1.5 mt-1.5 border-t border-dashed border-zinc-700 flex justify-between items-end">
          <span className="text-xs font-bold uppercase tracking-wider">TOTAL</span>
          <span className="text-2xl font-bold text-white">{formatPrice(total)}</span>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-1 p-1 bg-zinc-900">
        <button onClick={onCancelOrder} className="flex flex-col items-center justify-center py-3 bg-red-600 hover:bg-red-500 text-white rounded transition-colors">
          <Trash2 size={18} />
          <span className="text-[10px] mt-1 capitalize font-bold">Cancelar pedido</span>
        </button>
        <button
          onClick={onOpenPayment}
          disabled={cart.length === 0}
          className={`flex flex-col items-center justify-center py-3 rounded transition-colors ${
            cart.length > 0
              ? 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300'
              : 'bg-zinc-800 text-zinc-700 cursor-not-allowed opacity-50'
          }`}
        >
          <Banknote size={18} />
          <span className="text-[10px] mt-1 capitalize font-bold">Pagamento</span>
        </button>
        <button
          onClick={onOpenBillPreview}
          disabled={cart.length === 0}
          className={`flex flex-col items-center justify-center py-3 rounded transition-colors ${
            cart.length > 0
              ? 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300'
              : 'bg-zinc-800 text-zinc-700 cursor-not-allowed opacity-50'
          }`}
        >
          <Printer size={18} />
          <span className="text-[10px] mt-1 capitalize font-bold">CONTA</span>
        </button>
      </div>
    </div>
  );
}
