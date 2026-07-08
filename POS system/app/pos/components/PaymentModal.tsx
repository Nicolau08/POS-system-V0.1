'use client';

import React from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Banknote, CreditCard, Lock, Monitor, Printer, Save, Smartphone, User, X } from 'lucide-react';
import type { CartItem, Customer, Discount, PaymentEntry, PaymentMethod, PaymentMethodOption } from '@/app/pos/types';
import { getPosTaxPercentLabel } from '@/lib/taxConfig';

/** Terminal POS portátil (recibo + ecrã + teclado), alinhado ao estilo Lucide. */
function PosTerminalIcon({ size = 24, className }: { size?: number; className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M9.5 2h5v4h-5z" />
      <path d="M11 3.2h2M11 4.4h2" />
      <rect x="6" y="6" width="12" height="16" rx="2" />
      <rect x="8" y="8.5" width="8" height="3.5" rx="0.75" />
      <path d="M8.5 15h1.5M11.25 15h1.5M14 15h1.5M8.5 17.25h1.5M11.25 17.25h1.5M14 17.25h1.5M8.5 19.5h1.5M11.25 19.5h1.5M14 19.5h1.5" />
    </svg>
  );
}

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
  paymentMethods = [],
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
  isFinalizing,
  finalizeError,
  isReceiptPrintEnabled,
  onToggleReceiptPrint,
  formatPrice,
  docType,
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
  paymentMethods?: PaymentMethodOption[];
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
  isFinalizing: boolean;
  finalizeError: string | null;
  isReceiptPrintEnabled: boolean;
  onToggleReceiptPrint: () => void;
  formatPrice: (value: number) => string;
  docType: 'VD' | 'TK' | 'FP' | 'FT';
}) {
  const isProforma = docType === 'FP';
  const receivedRaw = (receivedAmount ?? '').trim();
  const receivedParsed = receivedRaw === '' ? NaN : parseFloat(receivedRaw);
  const receivedForChange = Number.isFinite(receivedParsed) ? receivedParsed : 0;
  const totalPago = payments.reduce((acc, p) => acc + p.amount, 0);
  const missingAmount = Math.max(0, total - totalPago);
  /** Vazio = pagamento exato (sem troco); preenchido = cálculo de troco (exige >= total). */
  const singleChange = receivedRaw === '' ? 0 : Math.max(0, receivedForChange - total);
  const multiChange = Math.max(0, totalPago - total);

  const isCashSingle =
    !isMultiplePayment && !!paymentMethod && isCashMethod(paymentMethod, paymentMethods);
  const cashInputAllowed =
    !isCashSingle ||
    receivedRaw === '' ||
    (Number.isFinite(receivedParsed) && receivedParsed >= total);

  const canFinalize = isProforma
    ? cart.length > 0
    : ((!isMultiplePayment && !!paymentMethod && cashInputAllowed) || (isMultiplePayment && totalPago >= total));

  const enabledMethods = paymentMethods.filter((method) => method.enabled);

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
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-xl font-bold text-white">{isProforma ? 'Salvar Proforma' : 'Finalizar Pagamento'}</h3>
                  <div className="flex gap-4 mt-2 text-xs text-zinc-500">
                    <span className="flex items-center gap-1"><User size={12} /> {selectedCustomer ? selectedCustomer.name : (customerName || 'Consumidor Final')}</span>
                    <span className="flex items-center gap-1"><Monitor size={12} /> Mesa: {tableNumber || 'N/A'}</span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={onToggleReceiptPrint}
                  title={isReceiptPrintEnabled ? 'Impressão de recibo ativada' : 'Impressão de recibo desativada'}
                  className={`w-14 h-12 rounded border flex items-center justify-center transition-colors ${
                    isReceiptPrintEnabled
                      ? 'bg-zinc-800 border-zinc-700 text-zinc-300 hover:bg-zinc-700'
                      : 'bg-red-600/30 border-red-500 text-red-400 hover:bg-red-600/40'
                  }`}
                >
                  <Printer size={20} />
                </button>
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
                  <span>IVA ({getPosTaxPercentLabel()} Incluso)</span>
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
                {finalizeError ? (
                  <div className="rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
                    {finalizeError}
                  </div>
                ) : null}
                {isProforma ? (
                  <div className="rounded border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
                    Cotação / fatura proforma: não move caixa nem estoque. Pode ser convertida numa venda depois.
                  </div>
                ) : null}
                {!isProforma && (
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
                )}

                {!isProforma && !isMultiplePayment ? (
                  <div className="grid grid-cols-3 gap-2">
                    {enabledMethods.map((method) => (
                      <PaymentMethodButton
                        key={method.id}
                        active={paymentMethod === method.code}
                        onClick={() => setPaymentMethod(method.code)}
                        icon={paymentIconForCode(method.code, 26)}
                        label={method.name}
                      />
                    ))}
                  </div>
                ) : !isProforma ? (
                  <div className="space-y-3">
                    <div className="grid grid-cols-3 gap-2">
                      {enabledMethods.map((method) => (
                        <PaymentMethodButton
                          key={method.id}
                          active={multiplePaymentMethod === method.code}
                          onClick={() => setMultiplePaymentMethod(method.code)}
                          icon={paymentIconForCode(method.code, 22)}
                          label={method.name}
                        />
                      ))}
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
                          <div key={`${p.method}-${p.amount}-${i}`} className="flex items-center justify-between gap-2 text-zinc-300">
                            <span>{paymentLabelForCode(p.method, paymentMethods)}</span>
                            <div className="flex items-center gap-2">
                              <span>{formatPrice(p.amount)}</span>
                              <button
                                type="button"
                                onClick={() => setPayments((prev) => prev.filter((_, index) => index !== i))}
                                aria-label={`Remover ${paymentLabelForCode(p.method, paymentMethods)} ${formatPrice(p.amount)}`}
                                title="Remover pagamento"
                                className="h-7 w-7 rounded border border-zinc-700 text-zinc-400 hover:text-red-400 hover:border-red-500 hover:bg-red-500/10 transition-colors flex items-center justify-center"
                              >
                                <X size={14} />
                              </button>
                            </div>
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
                ) : null}

                {!isProforma && !isMultiplePayment && isCashMethod(paymentMethod, paymentMethods) && (
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
                disabled={!canFinalize || isFinalizing}
                className={`flex-1 h-12 rounded text-sm font-medium transition-all flex items-center justify-center gap-2 ${
                  canFinalize && !isFinalizing
                    ? 'bg-emerald-600 hover:bg-emerald-500 text-white'
                    : 'bg-zinc-800 text-zinc-600 cursor-not-allowed'
                }`}
              >
                {isProforma ? <Save size={16} /> : <Lock size={16} />}
                {isFinalizing ? 'Finalizando...' : isProforma ? 'Salvar' : 'Finalizar'}
              </button>
            </div>

          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

function paymentIconForCode(code: string, size: number) {
  const normalized = String(code || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, '');
  if (normalized === 'cash' || normalized === 'dinheiro') return <Banknote size={size} />;
  if (
    normalized === 'pix' ||
    normalized === 'mpesa' ||
    normalized === 'm-pesa' ||
    normalized === 'emola' ||
    normalized === 'e-mola'
  ) {
    return <Smartphone size={size} />;
  }
  if (normalized === 'pos') return <PosTerminalIcon size={size} />;
  if (
    normalized === 'card' ||
    normalized === 'cartao' ||
    normalized === 'cc' ||
    normalized === 'conta-corrente' ||
    normalized === 'contacorrente'
  ) {
    return <CreditCard size={size} />;
  }
  return <CreditCard size={size} />;
}

function paymentLabelForCode(code: string, methods: PaymentMethodOption[]) {
  const method = methods.find((item) => item.code === code);
  return method?.name ?? code;
}

function isCashMethod(methodCode: string | null, methods: PaymentMethodOption[]) {
  if (!methodCode) return false;
  const method = methods.find((item) => item.code === methodCode);
  if (!method) return String(methodCode).toLowerCase() === 'cash';
  return method.allowChange || method.code === 'cash';
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