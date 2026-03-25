'use client';

import React from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Banknote, CreditCard, Lock, Monitor, Smartphone, User, X } from 'lucide-react';
import type { CartItem, Customer, Discount, PaymentEntry, PaymentMethod } from '@/app/pos/types';

// Encapsulates payment workflow UI while keeping business handlers in the page.
export function PaymentModal({
  isOpen,
  onClose,
  selectedCustomer,
  customerName,
  tableNumber,
  cart,
  globalDiscount,
  originalTotal,
  subtotal,
  tax,
  totalDiscount,
  total,
  isMultiplePayment,
  onToggleMultiplePayment,
  paymentMethod,
  setPaymentMethod,
  receivedAmount,
  setReceivedAmount,
  payments,
  setPayments,
  multiplePaymentMethod,
  setMultiplePaymentMethod,
  multiplePaymentAmount,
  setMultiplePaymentAmount,
  onFinalize,
  formatPrice,
}: {
  isOpen: boolean;
  onClose: () => void;
  selectedCustomer: Customer | null;
  customerName: string;
  tableNumber: string;
  cart: CartItem[];
  globalDiscount: Discount | null;
  originalTotal: number;
  subtotal: number;
  tax: number;
  totalDiscount: number;
  total: number;
  isMultiplePayment: boolean;
  onToggleMultiplePayment: () => void;
  paymentMethod: PaymentMethod | null;
  setPaymentMethod: (method: PaymentMethod | null) => void;
  receivedAmount: string;
  setReceivedAmount: (value: string) => void;
  payments: PaymentEntry[];
  setPayments: (value: PaymentEntry[] | ((prev: PaymentEntry[]) => PaymentEntry[])) => void;
  multiplePaymentMethod: PaymentMethod;
  setMultiplePaymentMethod: (method: PaymentMethod) => void;
  multiplePaymentAmount: string;
  setMultiplePaymentAmount: (value: string) => void;
  onFinalize: () => void;
  formatPrice: (value: number) => string;
}) {
  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md" onClick={onClose}>
          <motion.div
            initial={{ scale: 0.9, opacity: 0, y: 20 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.9, opacity: 0, y: 20 }}
            className="bg-[#1a1a1a] border border-zinc-800 rounded w-full max-w-[450px] overflow-hidden flex flex-col max-h-[90vh]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-4 border-b border-zinc-800 bg-zinc-900/50">
              <h3 className="text-xl font-bold text-white capitalize tracking-tight">Finalizar Pagamento</h3>
              <div className="flex gap-4 mt-2 text-xs text-zinc-500 font-medium">
                <span className="flex items-center gap-1"><User size={12} /> {selectedCustomer ? selectedCustomer.name : (customerName || 'Consumidor Final')}</span>
                <span className="flex items-center gap-1"><Monitor size={12} /> Mesa: {tableNumber || 'N/A'}</span>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              <div className="space-y-2">
                <span className="text-xs font-medium text-zinc-500 capitalize">Resumo do Pedido</span>
                <div className="space-y-2">
                  {cart.map((item) => (
                    <div key={item.id} className="flex flex-col">
                      <div className="flex justify-between text-sm">
                        <span className="text-zinc-400">{item.quantity}x {item.name}</span>
                        <span className="font-mono text-zinc-200">{formatPrice(item.price * item.quantity)}</span>
                      </div>
                      {item.discount && (
                        <div className="flex justify-between text-[10px] text-emerald-500 italic">
                          <span>Desconto ({item.discount.type === 'percentage' ? `${item.discount.amount}%` : formatPrice(item.discount.amount)})</span>
                          <span>-{formatPrice(item.discount.type === 'percentage' ? (item.price * item.discount.amount / 100) * item.quantity : item.discount.amount)}</span>
                        </div>
                      )}
                    </div>
                  ))}
                  {globalDiscount && (
                    <div className="flex justify-between text-[10px] text-emerald-500 italic pt-1 border-t border-zinc-800/50">
                      <span>Desconto Global ({globalDiscount.type === 'percentage' ? `${globalDiscount.amount}%` : formatPrice(globalDiscount.amount)})</span>
                      <span>-{formatPrice(globalDiscount.type === 'percentage' ? (originalTotal * globalDiscount.amount / 100) : globalDiscount.amount)}</span>
                    </div>
                  )}
                </div>
              </div>

              <div className="pt-3 border-t border-zinc-800 space-y-0.5">
                <div className="flex justify-between text-sm text-zinc-500"><span>Subtotal (Base)</span><span className="font-mono">{formatPrice(subtotal)}</span></div>
                <div className="flex justify-between text-sm text-zinc-500"><span>IVA (17% Incluso)</span><span className="font-mono">{formatPrice(tax)}</span></div>
                {totalDiscount > 0 && (
                  <div className="flex justify-between text-sm text-emerald-500"><span>Desconto</span><span className="font-mono">-{formatPrice(totalDiscount)}</span></div>
                )}
                <div className="flex justify-between text-xl font-bold text-white pt-1">
                  <span>Total</span>
                  <span className="font-mono text-emerald-400">{formatPrice(total)}</span>
                </div>
              </div>

              <div className="pt-4 space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-xs font-medium text-zinc-500 capitalize">Método de Pagamento</span>
                  <button
                    onClick={onToggleMultiplePayment}
                    className={`text-[10px] font-bold px-2 py-1 rounded transition-all ${
                      isMultiplePayment ? 'bg-emerald-500 text-white' : 'bg-zinc-800 text-zinc-500 hover:text-zinc-300'
                    }`}
                  >
                    Múltiplos Pagamentos
                  </button>
                </div>

                {!isMultiplePayment ? (
                  <div className="grid grid-cols-3 gap-2">
                    <PaymentMethodButton active={paymentMethod === 'cash'} onClick={() => { setPaymentMethod('cash'); setReceivedAmount(''); }} icon={<Banknote size={20} />} label="Dinheiro" />
                    <PaymentMethodButton active={paymentMethod === 'card'} onClick={() => { setPaymentMethod('card'); setReceivedAmount(''); }} icon={<CreditCard size={20} />} label="Cartão" />
                    <PaymentMethodButton active={paymentMethod === 'pix'} onClick={() => { setPaymentMethod('pix'); setReceivedAmount(''); }} icon={<Smartphone size={20} />} label="PIX" />
                  </div>
                ) : (
                  <div className="space-y-3 bg-zinc-900/50 border border-zinc-800 rounded p-3">
                    <div className="grid grid-cols-3 gap-2">
                      <button onClick={() => setMultiplePaymentMethod('cash')} className={`h-10 rounded flex items-center justify-center gap-2 text-xs font-bold transition-all ${multiplePaymentMethod === 'cash' ? 'bg-emerald-500 text-white' : 'bg-zinc-800 text-zinc-500'}`}><Banknote size={14} /> Dinheiro</button>
                      <button onClick={() => setMultiplePaymentMethod('card')} className={`h-10 rounded flex items-center justify-center gap-2 text-xs font-bold transition-all ${multiplePaymentMethod === 'card' ? 'bg-emerald-500 text-white' : 'bg-zinc-800 text-zinc-500'}`}><CreditCard size={14} /> Cartão</button>
                      <button onClick={() => setMultiplePaymentMethod('pix')} className={`h-10 rounded flex items-center justify-center gap-2 text-xs font-bold transition-all ${multiplePaymentMethod === 'pix' ? 'bg-emerald-500 text-white' : 'bg-zinc-800 text-zinc-500'}`}><Smartphone size={14} /> PIX</button>
                    </div>
                    <div className="flex gap-2">
                      <div className="relative flex-1">
                        <input type="number" value={multiplePaymentAmount} onChange={(e) => setMultiplePaymentAmount(e.target.value)} placeholder="Valor" className="w-full bg-zinc-950 border border-zinc-700 rounded h-10 px-3 text-sm text-emerald-400 font-mono outline-none focus:border-emerald-500" />
                      </div>
                      <button
                        onClick={() => {
                          const amt = parseFloat(multiplePaymentAmount);
                          if (amt > 0) {
                            setPayments((prev) => [...prev, { method: multiplePaymentMethod, amount: amt }]);
                            setMultiplePaymentAmount('');
                          }
                        }}
                        className="px-4 bg-emerald-600 hover:bg-emerald-500 text-white rounded font-bold text-xs"
                      >
                        Adicionar
                      </button>
                    </div>
                    {payments.length > 0 && (
                      <div className="space-y-1 pt-2 border-t border-zinc-800">
                        {payments.map((p, i) => (
                          <div key={i} className="flex justify-between items-center text-xs">
                            <span className="text-zinc-400 capitalize">{p.method === 'cash' ? 'Dinheiro' : p.method === 'card' ? 'Cartão' : 'PIX'}</span>
                            <div className="flex items-center gap-2">
                              <span className="text-white font-mono">{formatPrice(p.amount)}</span>
                              <button onClick={() => setPayments((prev) => prev.filter((_, idx) => idx !== i))} className="text-rose-500 hover:text-rose-400">
                                <X size={12} />
                              </button>
                            </div>
                          </div>
                        ))}
                        <div className="flex justify-between items-center pt-1 mt-1 border-t border-zinc-800 font-bold">
                          <span className="text-zinc-500">Total Pago:</span>
                          <span className="text-emerald-400 font-mono">{formatPrice(payments.reduce((acc, p) => acc + p.amount, 0))}</span>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                <AnimatePresence>
                  {!isMultiplePayment && paymentMethod === 'cash' && (
                    <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden space-y-4 pt-2">
                      <div className="bg-zinc-900/80 border border-zinc-800 rounded p-4 space-y-3">
                        <div className="flex justify-between items-center">
                          <span className="text-xs font-bold text-zinc-400 uppercase">Valor Recebido</span>
                          <div className="relative">
                            <input type="number" step="any" value={receivedAmount ?? ''} onChange={(e) => setReceivedAmount(e.target.value)} placeholder="0.00" className="w-40 bg-zinc-950 border border-zinc-700 rounded py-2 pl-3 pr-10 text-right text-emerald-400 font-mono font-bold outline-none focus:border-emerald-500 transition-colors" autoFocus />
                            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 font-mono text-xs pointer-events-none ml-1">MT</span>
                          </div>
                        </div>
                        <div className="flex justify-between items-center pt-2 border-t border-zinc-800/50">
                          <span className="text-xs font-medium text-zinc-400 uppercase">Troco</span>
                          <span className={`text-xl font-bold font-mono ${(receivedAmount === '' || parseFloat(receivedAmount) >= total) ? 'text-white' : 'text-red-500'}`}>
                            {receivedAmount === '' ? formatPrice(0) : formatPrice(Math.max(0, parseFloat(receivedAmount) - total))}
                          </span>
                        </div>
                      </div>
                    </motion.div>
                  )}
                  {isMultiplePayment && payments.reduce((acc, p) => acc + p.amount, 0) > total && (
                    <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden pt-2">
                      <div className="bg-zinc-900/80 border border-zinc-800 rounded p-4 flex justify-between items-center">
                        <span className="text-xs font-medium text-zinc-400 uppercase">Troco</span>
                        <span className="text-xl font-bold font-mono text-white">{formatPrice(payments.reduce((acc, p) => acc + p.amount, 0) - total)}</span>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>

            <div className="p-4 bg-zinc-900/50 border-t border-zinc-800 flex gap-3">
              <button onClick={onClose} className="flex-1 h-12 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded font-medium transition-all">Voltar</button>
              <button
                onClick={onFinalize}
                disabled={
                  (!isMultiplePayment && (!paymentMethod || (paymentMethod === 'cash' && receivedAmount !== '' && parseFloat(receivedAmount) < total))) ||
                  (isMultiplePayment && payments.reduce((acc, p) => acc + p.amount, 0) < total)
                }
                className={`flex-1 h-12 rounded font-bold transition-all flex items-center justify-center gap-2 ${
                  (!isMultiplePayment && paymentMethod && (paymentMethod !== 'cash' || receivedAmount === '' || parseFloat(receivedAmount) >= total)) ||
                  (isMultiplePayment && payments.reduce((acc, p) => acc + p.amount, 0) >= total)
                    ? 'bg-emerald-600 hover:bg-emerald-500 text-white'
                    : 'bg-zinc-800 text-zinc-600 cursor-not-allowed'
                }`}
              >
                <Lock size={16} />
                Finalizar
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

function PaymentMethodButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`h-16 rounded flex flex-col items-center justify-center text-xs font-bold transition-all ${
        active ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/50' : 'bg-zinc-800/50 text-zinc-500 border border-zinc-700 hover:bg-zinc-700/50'
      }`}
    >
      {icon}
      <span className="mt-1">{label}</span>
    </button>
  );
}
