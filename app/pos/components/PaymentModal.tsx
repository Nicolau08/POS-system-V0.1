'use client';

import React, { useEffect, useState } from 'react';
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

/** Aceita apenas dígitos e um separador decimal; vírgula é convertida em ponto. */
function sanitizeDecimalInput(value: string) {
  const cleaned = String(value ?? '')
    .replace(',', '.')
    .replace(/[^0-9.]/g, '');
  const [first, ...rest] = cleaned.split('.');
  return rest.length ? `${first}.${rest.join('')}` : first;
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
  title,
  contextLabel,
  hideReceiptPrint = false,
  allowPartialPayment = false,
  paymentAmount,
  setPaymentAmount,
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
  docType: 'VD' | 'TK' | 'FP' | 'FT' | 'FTF';
  /** Título opcional (ex.: pagamento de documento em Gestão). */
  title?: string;
  /** Substitui a linha «Mesa: …» (ex.: número do documento). */
  contextLabel?: string;
  hideReceiptPrint?: boolean;
  /** Permite pagar menos do que o total (faturas de cliente). */
  allowPartialPayment?: boolean;
  paymentAmount?: string;
  setPaymentAmount?: (value: string) => void;
}) {
  const [isPartialPayment, setIsPartialPayment] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      setIsPartialPayment(false);
      return;
    }
    setIsPartialPayment(false);
  }, [isOpen]);

  const isProforma = docType === 'FP';
  const receivedRaw = (receivedAmount ?? '').trim();
  const receivedParsed = receivedRaw === '' ? NaN : parseFloat(receivedRaw);
  const receivedForChange = Number.isFinite(receivedParsed) ? receivedParsed : 0;
  const totalPago = payments.reduce((acc, p) => acc + p.amount, 0);
  const paymentAmountRaw = (paymentAmount ?? '').trim();
  const paymentAmountParsed = paymentAmountRaw === '' ? NaN : parseFloat(paymentAmountRaw);
  const partialModeActive = allowPartialPayment && isPartialPayment;
  const effectivePayTotal = partialModeActive
    ? Number.isFinite(paymentAmountParsed) && paymentAmountParsed > 0
      ? Math.min(paymentAmountParsed, total)
      : 0
    : total;
  const missingAmount = Math.max(0, effectivePayTotal - totalPago);
  /** Vazio = pagamento exato (sem troco); preenchido = cálculo de troco (exige >= valor a pagar). */
  const singleChange = receivedRaw === '' ? 0 : Math.max(0, receivedForChange - effectivePayTotal);
  const multiChange = Math.max(0, totalPago - effectivePayTotal);
  const remainingAfterPartial = Math.max(0, total - effectivePayTotal);

  const isCashSingle =
    !isMultiplePayment && !!paymentMethod && isCashMethod(paymentMethod, paymentMethods);
  const cashInputAllowed =
    !isCashSingle ||
    receivedRaw === '' ||
    (Number.isFinite(receivedParsed) && receivedParsed >= effectivePayTotal - 0.009);

  const partialAmountValid =
    !partialModeActive ||
    (Number.isFinite(paymentAmountParsed) &&
      paymentAmountParsed > 0 &&
      paymentAmountParsed <= total + 0.009);

  const canFinalize = isProforma
    ? cart.length > 0 || total > 0
    : partialAmountValid &&
      effectivePayTotal > 0 &&
      ((!isMultiplePayment && !!paymentMethod && cashInputAllowed) ||
        (isMultiplePayment && totalPago >= effectivePayTotal - 0.009 && totalPago > 0));

  const enabledMethods = paymentMethods.filter((method) => method.enabled);
  const modalTitle = title || (isProforma ? 'Salvar Proforma' : 'Finalizar Pagamento');
  const secondaryContext = contextLabel || `Mesa: ${tableNumber || 'N/A'}`;

  const handleTogglePartialPayment = () => {
    setIsPartialPayment((prev) => {
      const next = !prev;
      if (next) {
        setPaymentAmount?.('');
        if (isMultiplePayment) onToggleMultiplePayment();
      } else {
        setPaymentAmount?.(String(Number(total.toFixed(2))));
      }
      return next;
    });
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md"
          onClick={(e) => e.stopPropagation()}
        >
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
                  <h3 className="text-xl font-bold text-white">{modalTitle}</h3>
                  <div className="flex gap-4 mt-2 text-xs text-zinc-500">
                    <span className="flex items-center gap-1"><User size={12} /> {selectedCustomer ? selectedCustomer.name : (customerName || 'Consumidor Final')}</span>
                    <span className="flex items-center gap-1"><Monitor size={12} /> {secondaryContext}</span>
                  </div>
                </div>
                {!hideReceiptPrint ? (
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
                ) : null}
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
                    Cotação / fatura proforma: não move caixa nem stock. Pode ser convertida numa venda depois.
                  </div>
                ) : null}
                {!isProforma && (
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-zinc-500 capitalize">Método de pagamento</span>
                  <div className="flex items-center gap-2">
                    {allowPartialPayment ? (
                      <button
                        type="button"
                        onClick={handleTogglePartialPayment}
                        className={`h-9 px-4 rounded font-bold text-xs transition-colors ${
                          isPartialPayment
                            ? 'bg-[#0001fb] text-white hover:bg-[#1a1bff]'
                            : 'bg-zinc-800 text-zinc-500 hover:bg-zinc-700 hover:text-zinc-200'
                        }`}
                      >
                        Parcial
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => {
                        if (isPartialPayment) {
                          setIsPartialPayment(false);
                          setPaymentAmount?.(String(Number(total.toFixed(2))));
                        }
                        onToggleMultiplePayment();
                      }}
                      className={`h-9 px-4 rounded font-bold text-xs transition-colors ${
                        isMultiplePayment
                          ? 'bg-[#0001fb] text-white hover:bg-[#1a1bff]'
                          : 'bg-zinc-800 text-zinc-500 hover:bg-zinc-700 hover:text-zinc-200'
                      }`}
                    >
                      Múltiplos Pagamentos
                    </button>
                  </div>
                </div>
                )}

                {partialModeActive && setPaymentAmount ? (
                  <div className="space-y-2 rounded border border-zinc-800 bg-zinc-900/40 p-3">
                    <label className="block space-y-1.5">
                      <span className="text-xs font-medium text-zinc-400">Valor parcial a pagar</span>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={paymentAmount ?? ''}
                        onChange={(e) => setPaymentAmount(sanitizeDecimalInput(e.target.value))}
                        placeholder="0"
                        autoFocus
                        className="w-full h-11 px-3 bg-zinc-950 border border-zinc-700 rounded text-right text-[#a5b4fc] font-bold outline-none focus:border-[#0001fb] placeholder:text-zinc-600"
                      />
                    </label>
                    {Number.isFinite(paymentAmountParsed) && paymentAmountParsed > 0 ? (
                      <div className="flex justify-between text-xs text-amber-300">
                        <span>Fica a dever</span>
                        <span className="font-semibold tabular-nums">
                          {formatPrice(remainingAfterPartial)}
                        </span>
                      </div>
                    ) : null}
                  </div>
                ) : null}

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
                        type="text"
                        inputMode="decimal"
                        value={multiplePaymentAmount}
                        onChange={(e) => setMultiplePaymentAmount(sanitizeDecimalInput(e.target.value))}
                        placeholder="Valor"
                        className="flex-1 h-11 px-3 bg-zinc-900 border border-zinc-700 rounded text-right text-[#a5b4fc] font-bold outline-none focus:border-[#0001fb]"
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
                          <div className="flex justify-between text-[#a5b4fc] font-bold">
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
                      type="text"
                      inputMode="decimal"
                      value={receivedAmount}
                      onChange={(e) => setReceivedAmount(sanitizeDecimalInput(e.target.value))}
                      placeholder="Valor recebido"
                      className="w-full h-11 px-3 bg-zinc-950 border border-zinc-700 rounded text-right text-[#a5b4fc] font-bold outline-none focus:border-[#0001fb]"
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
                    ? 'bg-[#0001fb] hover:bg-[#1a1bff] text-white'
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
          ? 'bg-[#0001fb]/15 border-[#0001fb] text-[#a5b4fc]'
          : 'bg-zinc-900 border-zinc-700 text-zinc-500 hover:border-[#0001fb] hover:text-zinc-300'
      }`}
    >
      <div className="mb-1">{icon}</div>
      <span className="text-sm font-bold leading-none">{label}</span>
    </button>
  );
}
