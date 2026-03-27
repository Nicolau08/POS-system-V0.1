'use client';

import React from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Banknote, CreditCard, Lock, Monitor, Smartphone, User } from 'lucide-react';
import type { CartItem, Customer, Discount, PaymentEntry, PaymentMethod } from '@/app/pos/types';

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
  const received = parseFloat(receivedAmount || '0');
  const totalPago = payments.reduce((acc, p) => acc + p.amount, 0);
  const missingAmount = Math.max(0, total - totalPago);
  const singleChange = Math.max(0, received - total);
  const multiChange = Math.max(0, totalPago - total);
  const canFinalize =
    (!isMultiplePayment && !!paymentMethod && (paymentMethod !== 'cash' || received >= total)) ||
    (isMultiplePayment && totalPago >= total);

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
              <h3 className="text-xl font-bold text-white">Finalizar Pagamento</h3>
              <div className="flex gap-4 mt-2 text-xs text-zinc-500">
                <span className="flex items-center gap-1"><User size={12} /> {selectedCustomer ? selectedCustomer.name : (customerName || 'Consumidor Final')}</span>
                <span className="flex items-center gap-1"><Monitor size={12} /> Mesa: {tableNumber || 'N/A'}</span>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              <div className="text-sm font-medium text-zinc-500 capitalize">Resumo do pedido</div>
              <div className="space-y-2">
                {cart.map((item) => (
                  <div key={item.id} className="flex justify-between text-sm">
                    <span>{item.quantity}x {item.name}</span>
                    <span>{formatPrice(item.price * item.quantity)}</span>
                  </div>
                ))}
              </div>

              <div className="pt-3 border-t border-zinc-800 space-y-1 text-zinc-500 text-sm">
                <div className="flex justify-between">
                  <span>Subtotal (Base)</span>
                  <span>{formatPrice(subtotal)}</span>
                </div>
                <div className="flex justify-between">
                  <span>IVA (17% Incluso)</span>
                  <span>{formatPrice(tax)}</span>
                </div>
                {!!totalDiscount && (
                  <div className="flex justify-between text-emerald-500">
                    <span>Desconto</span>
                    <span>-{formatPrice(totalDiscount)}</span>
                  </div>
                )}
              </div>

              <div className="pt-3 border-t border-zinc-800 flex justify-between items-baseline">
                <span className="text-4xl font-bold text-white">Total</span>
                <span className="text-4xl font-bold text-emerald-400 tabular-nums">{formatPrice(total)}</span>
              </div>

              <div className="pt-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-zinc-500 capitalize">Método de pagamento</span>
                  <button
                    onClick={onToggleMultiplePayment}
                    className={`h-9 px-4 rounded font-bold text-xs transition-colors ${
                      isMultiplePayment
                        ? 'bg-emerald-600 text-white hover:bg-emerald-500'
                        : 'bg-zinc-800 text-zinc-500 hover:bg-zinc-700 hover:text-zinc-200'
                    }`}
                  >
                    Múltiplos Pagamentos
                  </button>
                </div>

                {!isMultiplePayment ? (
                  <div className="grid grid-cols-3 gap-2">
                    <PaymentMethodButton active={paymentMethod === 'cash'} onClick={() => setPaymentMethod('cash')} icon={<Banknote size={26} />} label="Dinheiro" />
                    <PaymentMethodButton active={paymentMethod === 'card'} onClick={() => setPaymentMethod('card')} icon={<CreditCard size={26} />} label="Cartão" />
                    <PaymentMethodButton active={paymentMethod === 'pix'} onClick={() => setPaymentMethod('pix')} icon={<Smartphone size={26} />} label="PIX" />
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="grid grid-cols-3 gap-2">
                      <PaymentMethodButton active={multiplePaymentMethod === 'cash'} onClick={() => setMultiplePaymentMethod('cash')} icon={<Banknote size={22} />} label="Dinheiro" />
                      <PaymentMethodButton active={multiplePaymentMethod === 'card'} onClick={() => setMultiplePaymentMethod('card')} icon={<CreditCard size={22} />} label="Cartão" />
                      <PaymentMethodButton active={multiplePaymentMethod === 'pix'} onClick={() => setMultiplePaymentMethod('pix')} icon={<Smartphone size={22} />} label="PIX" />
                    </div>

                    <div className="flex gap-2">
                      <input
                        type="number"
                        step="any"
                        value={multiplePaymentAmount}
                        onChange={(e) => setMultiplePaymentAmount(e.target.value)}
                        placeholder="Valor"
                        className="flex-1 h-11 px-3 bg-zinc-900 border border-zinc-700 rounded text-right text-emerald-400 font-bold outline-none focus:border-emerald-500"
                      />
                      <button
                        onClick={() => {
                          const amt = parseFloat(multiplePaymentAmount || '0');
                          if (amt > 0) {
                            setPayments((prev) => [...prev, { method: multiplePaymentMethod, amount: amt }]);
                            setMultiplePaymentAmount('');
                          }
                        }}
                        className="h-11 px-4 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded font-bold text-sm"
                      >
                        Adicionar
                      </button>
                    </div>

                    {payments.length > 0 && (
                      <div className="space-y-1 text-sm border border-zinc-800 rounded p-3 bg-zinc-900/40">
                        {payments.map((p, i) => (
                          <div key={`${p.method}-${p.amount}-${i}`} className="flex justify-between text-zinc-300">
                            <span>{p.method === 'cash' ? 'Dinheiro' : p.method === 'card' ? 'Cartão' : 'PIX'}</span>
                            <span>{formatPrice(p.amount)}</span>
                          </div>
                        ))}
                        <div className="pt-2 mt-2 border-t border-zinc-800 flex justify-between text-zinc-400">
                          <span>Falta</span>
                          <span>{formatPrice(missingAmount)}</span>
                        </div>
                        {multiChange > 0 && (
                          <div className="flex justify-between text-emerald-400 font-bold">
                            <span>Troco</span>
                            <span>{formatPrice(multiChange)}</span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {!isMultiplePayment && paymentMethod === 'cash' && (
                  <div className="space-y-2 border border-zinc-800 rounded p-3 bg-zinc-900/40">
                    <input
                      type="number"
                      step="any"
                      value={receivedAmount}
                      onChange={(e) => setReceivedAmount(e.target.value)}
                      placeholder="Valor recebido"
                      className="w-full h-11 px-3 bg-zinc-950 border border-zinc-700 rounded text-right text-emerald-400 font-bold outline-none focus:border-emerald-500"
                    />
                    <div className="flex justify-between text-zinc-300 text-sm">
                      <span>Troco:</span>
                      <span className="font-bold text-emerald-400">{formatPrice(singleChange)}</span>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="p-4 flex gap-3">
              <button onClick={onClose} className="flex-1 h-12 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-sm rounded font-medium transition-all">
                Voltar
              </button>

              <button
                onClick={onFinalize}
                disabled={!canFinalize}
                className={`flex-1 h-12 rounded text-sm font-medium transition-all flex items-center justify-center gap-2 ${
                  canFinalize
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
      className={`h-20 px-2 flex flex-col items-center justify-center rounded border transition-colors ${
        active
          ? 'bg-emerald-500/15 border-emerald-500 text-emerald-400'
          : 'bg-zinc-900 border-zinc-700 text-zinc-500 hover:border-zinc-500 hover:text-zinc-300'
      }`}
    >
      <div className="mb-1">{icon}</div>
      <span className="text-sm font-bold leading-none">{label}</span>
    </button>
  );
}