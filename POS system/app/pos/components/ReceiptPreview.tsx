'use client';

import React from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Printer } from 'lucide-react';
import type { CartItem, CompanyProfile, Customer, PaymentEntry, PaymentMethod } from '@/app/pos/types';
import { buildReceiptHeader } from '@/lib/receiptCompanyHeader';
import { getPosTaxPercentLabel } from '@/lib/taxConfig';

export function ReceiptPreview({
  isOpen,
  isSaleFinalized,
  docType,
  nextVDNumber,
  currentReceiptNumber,
  selectedCustomer,
  currentUserName,
  cart,
  originalSubtotal,
  discountNet,
  tax,
  total,
  isMultiplePayment,
  paymentMethod,
  receivedAmount,
  payments,
  formatDocumentNumber,
  paymentLabel,
  isCashPaymentMethod,
  companyProfile,
  onPrimaryAction,
  onPrint,
}: {
  isOpen: boolean;
  isSaleFinalized: boolean;
  docType: 'VD' | 'TK' | 'FP' | 'FT';
  nextVDNumber: number;
  currentReceiptNumber: string | null;
  selectedCustomer: Customer | null;
  currentUserName: string | null;
  cart: CartItem[];
  /** Subtotal s/ IVA antes do desconto (igual a `subtotal` quando não há desconto). */
  originalSubtotal: number;
  /** Valor do desconto em MT na componente líquida (0 se não houver). */
  discountNet: number;
  tax: number;
  total: number;
  isMultiplePayment: boolean;
  paymentMethod: PaymentMethod | null;
  receivedAmount: string;
  payments: PaymentEntry[];
  formatDocumentNumber: (sequence: number, date?: Date) => string;
  /** Nome amigável do método (API); evita fallback errado tipo M-Pesa para códigos não "cash". */
  paymentLabel: (methodCode: PaymentMethod | null) => string;
  /** Mesma regra que o pagamento com troco (ex.: allowChange / cash). */
  isCashPaymentMethod: (methodCode: PaymentMethod | null) => boolean;
  companyProfile: CompanyProfile | null;
  onPrimaryAction: () => void;
  onPrint: () => void;
}) {
  const header = buildReceiptHeader(companyProfile);

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
          <motion.div
            initial={{ scale: 0.9, opacity: 0, y: 20 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.9, opacity: 0, y: 20 }}
            className="bg-white text-black rounded-sm w-full max-w-[380px] overflow-hidden flex flex-col max-h-[90vh] font-mono"
            onClick={(e) => e.stopPropagation()}
          >
            <div id="receipt-print-area" className="flex-1 overflow-y-auto p-6 space-y-4">
              <div className="text-center space-y-1">
                {header.logoDataUrl ? (
                  <div className="mb-2 flex justify-center">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={header.logoDataUrl}
                      alt={header.title}
                      className="receipt-thermal-logo h-[30mm] max-w-[220px] object-contain"
                    />
                  </div>
                ) : (
                  <h1 className="text-2xl font-bold tracking-tighter mb-2 leading-tight">{header.title}</h1>
                )}
                {header.lines.map((line, idx) => (
                  <p key={`${idx}-${line.slice(0, 40)}`} className="text-[11px] font-bold break-words">
                    {line}
                  </p>
                ))}
                <p className="text-[11px] font-bold mt-2">Cliente: {selectedCustomer ? selectedCustomer.name : 'Consumidor Final'}</p>
              </div>

              <div className="border-t border-dashed border-black pt-2">
                <div className="flex justify-between gap-3 text-[10px] font-bold">
                  <div className="min-w-0">
                    <div>Data: {new Date().toLocaleDateString()}</div>
                    <div>{new Date().toLocaleTimeString()}</div>
                  </div>
                  <div className="min-w-0 text-right">
                    <div>Atendido por:</div>
                    <div className="font-black">{currentUserName || 'Admin'}</div>
                  </div>
                </div>
                <div className="text-[12px] font-bold mt-1">
                  {isSaleFinalized ? docType : 'Cons. Doc'} nº: {currentReceiptNumber || formatDocumentNumber(nextVDNumber)}
                </div>
              </div>

              <div className="border-y border-dashed border-black py-2">
                <div className="flex justify-between text-[10px] font-bold mb-1">
                  <span className="w-8">Qt</span>
                  <span className="flex-1 px-2">Descrição</span>
                  <span className="w-16 text-right">P.Unit</span>
                  <span className="w-20 text-right">Valor</span>
                </div>
                <div className="space-y-0.5">
                  {cart.map((item) => (
                    <div key={item.id} className="flex justify-between text-[10px] font-bold">
                      <span className="w-8">{item.quantity.toFixed(2)}</span>
                      <span className="flex-1 px-2 truncate">{item.name}</span>
                      <span className="w-16 text-right">{item.price.toFixed(2)}MT</span>
                      <span className="w-20 text-right">
                        {(item.price * item.quantity).toLocaleString('en-US', { minimumFractionDigits: 2 })}MT
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="space-y-1 text-[11px] font-bold">
                <div className="flex justify-between">
                  <span>Subtotal:</span>
                  <span>{originalSubtotal.toLocaleString('en-US', { minimumFractionDigits: 2 })}MT</span>
                </div>
                {discountNet > 0.0001 && (
                  <div className="flex justify-between text-rose-700">
                    <span>Desconto:</span>
                    <span>
                      -{discountNet.toLocaleString('en-US', { minimumFractionDigits: 2 })}MT
                    </span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span>IVA ({getPosTaxPercentLabel()}):</span>
                  <span>{tax.toLocaleString('en-US', { minimumFractionDigits: 2 })}MT</span>
                </div>
                <div className="flex justify-between text-2xl font-bold border-t border-dashed border-black pt-2 mt-2">
                  <span>Total:</span>
                  <span>{total.toLocaleString('en-US', { minimumFractionDigits: 2 })}MT</span>
                </div>
              </div>

              {isSaleFinalized && (
                <div className="border-t border-dashed border-black pt-2 space-y-1">
                  <div className="flex justify-between text-[10px] font-bold">
                    <span>Método de Pagamento</span>
                    <span>Valor</span>
                  </div>
                  <div className="border-t border-dashed border-black pt-1 space-y-0.5">
                    {!isMultiplePayment ? (
                      <div className="flex justify-between text-[10px] font-bold">
                        <span className="capitalize">{paymentLabel(paymentMethod)}</span>
                        <span>{total.toLocaleString('en-US', { minimumFractionDigits: 2 })}MT</span>
                      </div>
                    ) : (
                      payments.map((p, i) => (
                        <div key={i} className="flex justify-between text-[10px] font-bold">
                          <span className="capitalize">{paymentLabel(p.method)}</span>
                          <span>{p.amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}MT</span>
                        </div>
                      ))
                    )}
                  </div>

                  {/* Display Change (Troco) */}
                  {((!isMultiplePayment &&
                    isCashPaymentMethod(paymentMethod) &&
                    receivedAmount !== '') ||
                    (isMultiplePayment && payments.reduce((acc, p) => acc + p.amount, 0) > total)) && (
                    <div className="flex justify-between text-[11px] font-bold border-t border-dashed border-black pt-1 mt-1">
                      <span>Troco:</span>
                      <span>
                        {(!isMultiplePayment
                          ? (parseFloat(receivedAmount) - total)
                          : (payments.reduce((acc, p) => acc + p.amount, 0) - total)
                        ).toLocaleString('en-US', { minimumFractionDigits: 2 })}MT
                      </span>
                    </div>
                  )}
                </div>
              )}

              <div className="text-center pt-4 border-t border-dashed border-black space-y-1">
                <p className="text-[11px] font-bold">IVA Incluso</p>
                <p className="text-[11px] font-bold">Processada por Computador</p>
                <p className="text-[11px] font-bold">Obrigado pela preferência!</p>
                <p className="text-[10px] font-bold italic mt-2">Sistema desenvolvido por: Nicolau Nino</p>
              </div>
            </div>

            <div className="p-4 bg-zinc-100 border-t border-zinc-200 flex flex-col gap-2 font-sans no-print">
              <p className="text-[10px] text-zinc-500 leading-snug px-0.5">
                Ao imprimir no Windows (Chrome/Edge): em &quot;Mais definições&quot; desative{' '}
                <span className="font-semibold text-zinc-600">Cabeçalhos e rodapés</span> e use margens{' '}
                <span className="font-semibold text-zinc-600">Nenhumas</span>, para sair só o recibo térmico
                (sem data, título nem URL no papel).
              </p>
              <div className="flex gap-3">
                <button onClick={onPrimaryAction} className="flex-1 h-12 bg-zinc-200 hover:bg-zinc-300 text-zinc-700 rounded font-bold transition-all">
                  {isSaleFinalized ? 'Nova Venda' : 'Fechar'}
                </button>
                <button
                  type="button"
                  onClick={onPrint}
                  title="Na janela de impressão: desative Cabeçalhos e rodapés; margens Nenhumas."
                  className="flex-1 h-12 bg-zinc-900 hover:bg-zinc-800 text-white rounded font-bold transition-all flex items-center justify-center gap-2"
                >
                  <Printer size={18} />
                  Imprimir
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

