'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Banknote, Check, CreditCard, Inbox, Smartphone, X } from 'lucide-react';
import { getPosApiBase } from '@/lib/apiBase';
import { extractApiErrorMessage, unwrapApiSuccessPayload } from '@/lib/apiResponse';
import { formatMoneyMt } from '@/lib/currency';
import { fetchPaymentMethods } from '@/lib/services/posService';

type PaymentPreview = {
  documentNumber: string;
  clientName: string;
  total: number;
  payableKind: 'FT' | 'FP';
  generatedDocumentType: 'RC' | 'VD';
  generatedDocumentLabel: string;
  alreadyPaid: boolean;
  canPay: boolean;
};

type KnownDocument = {
  document_number?: string | null;
  client_name?: string | null;
  total?: number | null;
  doc_type?: string | null;
  payment_method?: string | null;
  status?: string | null;
};

function PosTerminalIcon({ size = 22, className }: { size?: number; className?: string }) {
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

function normalizePaymentCode(code: string) {
  return String(code || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\s_-]+/g, '');
}

function paymentIconForCode(code: string) {
  const normalized = normalizePaymentCode(code);
  if (normalized === 'cash' || normalized === 'dinheiro') return <Banknote size={22} />;
  if (normalized === 'mpesa' || normalized === 'emola') return <Smartphone size={22} />;
  if (normalized === 'pos' || normalized.includes('terminal')) return <PosTerminalIcon size={22} />;
  if (normalized === 'cc' || normalized === 'contacorrente' || normalized === 'cartao' || normalized === 'card') {
    return <CreditCard size={22} />;
  }
  return <CreditCard size={22} />;
}

function normalizeDocumentNumber(value: string) {
  return String(value ?? '').trim().toUpperCase();
}

function resolveLocalPreview(documentNumber: string, knownDocuments: KnownDocument[]): PaymentPreview | null {
  const normalized = normalizeDocumentNumber(documentNumber);
  if (!normalized) return null;

  const row = knownDocuments.find(
    (doc) => normalizeDocumentNumber(String(doc.document_number ?? '')) === normalized,
  );
  if (!row) return null;

  const docType = String(row.doc_type ?? '').trim().toUpperCase();
  const paymentMethod = String(row.payment_method ?? '').toLowerCase();
  const isFp = docType === 'FP' || docType.includes('PROFORMA') || normalized.startsWith('FP/');
  const isFt =
    docType === 'FT' ||
    docType === 'FATURA' ||
    normalized.startsWith('FT/') ||
    paymentMethod.includes('conta corrente');
  if (!isFp && !isFt) return null;

  const payableKind = isFp ? 'FP' : 'FT';
  const generatedDocumentType = payableKind === 'FP' ? 'VD' : 'RC';
  const status = String(row.status ?? '').trim().toLowerCase();
  const alreadyPaid = status === 'completed' || status === 'approved' || status === 'pago';

  return {
    documentNumber: String(row.document_number ?? documentNumber).trim(),
    clientName: String(row.client_name ?? 'Consumidor final'),
    total: Number(row.total ?? 0),
    payableKind,
    generatedDocumentType,
    generatedDocumentLabel: generatedDocumentType === 'VD' ? 'Venda a dinheiro (VD)' : 'Recibo (RC)',
    alreadyPaid,
    canPay: !alreadyPaid,
  };
}

export function DocumentPaymentModal({
  isOpen,
  initialDocumentNumber,
  knownDocuments = [],
  onClose,
  onSuccess,
}: {
  isOpen: boolean;
  initialDocumentNumber?: string;
  knownDocuments?: KnownDocument[];
  onClose: () => void;
  onSuccess?: (result: {
    generatedDocumentType: string;
    generatedDocumentNumber: string;
    sourceDocumentNumber: string;
  }) => void;
}) {
  const [documentNumber, setDocumentNumber] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('');
  const [paymentOptions, setPaymentOptions] = useState<Array<{ code: string; name: string }>>([]);
  const [loadingMethods, setLoadingMethods] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [preview, setPreview] = useState<PaymentPreview | null>(null);
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    setDocumentNumber(String(initialDocumentNumber ?? '').trim());
    setPaymentMethod('');
    setPreview(null);
    setErrorMessage('');
    setLoadingMethods(true);
    void fetchPaymentMethods()
      .then((methods) => {
        const options = methods
          .filter((method) => method.enabled && method.markAsPaid !== false)
          .slice(0, 4)
          .map((method) => ({ code: method.code, name: method.name }));
        setPaymentOptions(options);
        if (options[0]) setPaymentMethod(options[0].code);
      })
      .catch(() => {
        setPaymentOptions([
          { code: 'cash', name: 'Dinheiro' },
          { code: 'm-pesa', name: 'M-Pesa' },
          { code: 'pos', name: 'POS' },
          { code: 'cc', name: 'CC' },
        ]);
        setPaymentMethod('cash');
      })
      .finally(() => setLoadingMethods(false));
  }, [isOpen, initialDocumentNumber]);

  useEffect(() => {
    if (!isOpen) return;
    const trimmed = documentNumber.trim();
    if (!trimmed) {
      setPreview(null);
      setErrorMessage('');
      return;
    }

    const localPreview = resolveLocalPreview(trimmed, knownDocuments);
    if (localPreview) {
      setPreview(localPreview);
      if (!localPreview.canPay) {
        setErrorMessage('Este documento já se encontra pago.');
      } else {
        setErrorMessage('');
      }
    }

    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setLoadingPreview(true);
      void fetch(
        `${getPosApiBase()}/documentos/pagamento/preview?documentNumber=${encodeURIComponent(trimmed)}`,
        { signal: controller.signal },
      )
        .then(async (res) => {
          const payload = await res.json().catch(() => ({}));
          if (!res.ok) {
            throw new Error(extractApiErrorMessage(payload, 'Documento não encontrado'));
          }
          const data = unwrapApiSuccessPayload<PaymentPreview>(payload);
          setPreview(data);
          if (!data.canPay) {
            setErrorMessage('Este documento já se encontra pago.');
          } else {
            setErrorMessage('');
          }
        })
        .catch((error) => {
          if (controller.signal.aborted) return;
          if (!localPreview) {
            setPreview(null);
            setErrorMessage(error instanceof Error ? error.message : 'Documento não encontrado');
          }
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoadingPreview(false);
        });
    }, 350);

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [documentNumber, isOpen, knownDocuments]);

  const canSubmit = useMemo(() => {
    return Boolean(
      documentNumber.trim() &&
        paymentMethod.trim() &&
        !submitting &&
        preview?.canPay,
    );
  }, [documentNumber, paymentMethod, submitting, preview]);

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setErrorMessage('');
    try {
      const res = await fetch(`${getPosApiBase()}/documentos/registar-pagamento`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          documentNumber: documentNumber.trim(),
          paymentMethod,
        }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(extractApiErrorMessage(payload, `Falha ao registar pagamento (${res.status})`));
      }
      const data = unwrapApiSuccessPayload<{
        generatedDocumentType?: string;
        generatedDocumentNumber?: string;
        sourceDocumentNumber?: string;
      }>(payload);
      onSuccess?.({
        generatedDocumentType: String(data?.generatedDocumentType ?? ''),
        generatedDocumentNumber: String(data?.generatedDocumentNumber ?? ''),
        sourceDocumentNumber: String(data?.sourceDocumentNumber ?? documentNumber.trim()),
      });
      onClose();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Falha ao registar pagamento');
    } finally {
      setSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/70 p-6 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[760px] rounded border border-zinc-700 bg-[#1f1f1f] shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="px-8 py-10 text-center">
          <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center text-zinc-100">
            <Inbox size={42} strokeWidth={1.5} />
          </div>
          <p className="text-[15px] leading-relaxed text-zinc-200">
            Insira o número do documento e o tipo de pagamento para confirmar o pagamento
            <br />
            de uma <strong>FT</strong> ou <strong>FP</strong> (cotação).
          </p>

          <div className="mx-auto mt-8 max-w-[520px] text-left">
            <label className="mb-2 block text-sm text-zinc-300">Número do documento</label>
            <input
              type="text"
              value={documentNumber}
              onChange={(event) => setDocumentNumber(event.target.value)}
              placeholder="FT/2026/00004 ou FP/2026/0001"
              className="h-11 w-full rounded border border-zinc-500 bg-transparent px-4 text-center text-lg font-bold text-white outline-none focus:border-[#0001fb]"
            />
          </div>

          {loadingPreview && !preview ? (
            <p className="mx-auto mt-4 max-w-[520px] text-sm text-zinc-400">A carregar documento...</p>
          ) : null}

          {preview ? (
            <div className="mx-auto mt-6 max-w-[520px] rounded border border-[#0001fb]/40 bg-[rgba(0,1,251,0.35)]/40 px-5 py-4 text-left">
              <div className="grid gap-2 text-sm">
                <div className="flex items-center justify-between gap-4">
                  <span className="text-zinc-400">Cliente</span>
                  <span className="font-semibold text-white">{preview.clientName}</span>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <span className="text-zinc-400">Valor a pagar</span>
                  <span className="text-lg font-bold text-[#0001fb]">{formatMoneyMt(preview.total)}</span>
                </div>
                <div className="flex items-center justify-between gap-4 border-t border-zinc-700/60 pt-2">
                  <span className="text-zinc-400">Documento a gerar</span>
                  <span className="font-semibold text-[#a5b4fc]">{preview.generatedDocumentLabel}</span>
                </div>
                <p className="text-xs text-zinc-500">
                  O valor entra no caixa e nos relatórios na data de hoje (sessão actual).
                </p>
              </div>
            </div>
          ) : null}

          <div className="mx-auto mt-8 max-w-[640px] text-left">
            <label className="mb-3 block text-sm text-zinc-300">Tipo de pagamento</label>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              {(paymentOptions.length
                ? paymentOptions
                : [
                    { code: 'cash', name: 'Dinheiro' },
                    { code: 'm-pesa', name: 'M-Pesa' },
                    { code: 'pos', name: 'POS' },
                    { code: 'cc', name: 'CC' },
                  ]
              ).map((option) => {
                const selected = paymentMethod === option.code;
                return (
                  <button
                    key={option.code}
                    type="button"
                    disabled={loadingMethods || submitting}
                    onClick={() => setPaymentMethod(option.code)}
                    className={`relative flex min-h-[92px] flex-col items-center justify-center rounded border px-3 py-4 text-xs font-bold uppercase tracking-wide transition-colors ${
                      selected
                        ? 'border-[#0001fb] bg-[rgba(0,1,251,0.35)] text-white'
                        : 'border-zinc-600 bg-[#171717] text-zinc-300 hover:border-[#0001fb]'
                    }`}
                  >
                    {selected ? (
                      <span className="absolute -top-3 left-1/2 flex h-6 w-6 -translate-x-1/2 items-center justify-center rounded-full bg-[#0001fb] text-white">
                        <Check size={14} />
                      </span>
                    ) : null}
                    <span className="mb-2">{paymentIconForCode(option.code)}</span>
                    <span>{option.name}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {errorMessage ? (
            <div className="mx-auto mt-6 max-w-[520px] rounded border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm text-red-300">
              {errorMessage}
            </div>
          ) : null}
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-zinc-800 px-6 py-4">
          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={!canSubmit}
            className="flex min-w-[120px] items-center justify-center gap-2 rounded bg-[#0001fb] px-5 py-2.5 text-sm font-bold text-white transition-colors hover:bg-[#1a1bff] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Check size={16} />
            OK
          </button>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="flex min-w-[120px] items-center justify-center gap-2 rounded bg-red-600 px-5 py-2.5 text-sm font-bold text-white transition-colors hover:bg-red-500 disabled:opacity-50"
          >
            <X size={16} />
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}
