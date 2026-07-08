'use client';

import React from 'react';
import { FileText, RefreshCw, User, X } from 'lucide-react';

export type QuotationRow = {
  id: string;
  doc_type?: string | null;
  document_number?: string | null;
  status?: string | null;
  total?: number | null;
  created_at?: string | null;
  customer_id?: string | null;
  client_name?: string | null;
};

function formatMoney(value: number | null | undefined) {
  const amount = Number(value ?? 0);
  return new Intl.NumberFormat('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount);
}

function formatDate(value: string | null | undefined) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return `${date.toLocaleDateString('pt-PT')} ${date.toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' })}`;
}

export function QuotationModal({
  isOpen,
  onClose,
  quotations,
  isLoading,
  onReload,
  onLoadQuotation,
}: {
  isOpen: boolean;
  onClose: () => void;
  quotations: QuotationRow[];
  isLoading: boolean;
  onReload: () => void;
  onLoadQuotation: (quotation: QuotationRow) => void;
}) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-4xl bg-[#1a1a1a] border border-zinc-800 rounded overflow-hidden" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded bg-emerald-500/10 text-emerald-500">
              <FileText size={18} />
            </div>
            <div>
              <h3 className="text-lg font-bold text-white">Cotações</h3>
              <p className="text-xs text-zinc-400">Duplo clique para carregar cliente e produtos no carrinho</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onReload}
              className="h-9 px-3 rounded bg-zinc-900 border border-zinc-700 text-zinc-200 hover:bg-zinc-800 transition-colors flex items-center gap-2 text-xs"
            >
              <RefreshCw size={14} />
              Atualizar
            </button>
            <button
              onClick={onClose}
              className="h-9 w-9 rounded bg-zinc-900 border border-zinc-700 text-zinc-300 hover:bg-zinc-800 transition-colors grid place-items-center"
              aria-label="Fechar modal de cotações"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="max-h-[70vh] overflow-auto custom-scrollbar">
          <table className="w-full text-xs border-collapse">
            <thead className="sticky top-0 bg-[#202020] z-10">
              <tr className="text-zinc-400">
                <th className="px-4 py-2.5 text-left border-b border-zinc-700">Documento</th>
                <th className="px-4 py-2.5 text-left border-b border-zinc-700">Cliente</th>
                <th className="px-4 py-2.5 text-left border-b border-zinc-700">Data</th>
                <th className="px-4 py-2.5 text-left border-b border-zinc-700">Estado</th>
                <th className="px-4 py-2.5 text-right border-b border-zinc-700">Total</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-zinc-500">
                    Carregando cotações...
                  </td>
                </tr>
              ) : quotations.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-zinc-500">
                    Nenhuma cotação encontrada.
                  </td>
                </tr>
              ) : (
                quotations.map((quotation) => (
                  <tr
                    key={quotation.id}
                    onDoubleClick={() => onLoadQuotation(quotation)}
                    className="border-b border-zinc-800/70 hover:bg-zinc-800/40 cursor-pointer"
                    title="Duplo clique para carregar esta cotação"
                  >
                    <td className="px-4 py-2.5 text-zinc-100 font-semibold">{quotation.document_number || `DOC-${quotation.id}`}</td>
                    <td className="px-4 py-2.5 text-zinc-300">
                      <span className="inline-flex items-center gap-2">
                        <User size={12} className="text-zinc-500" />
                        {quotation.client_name || 'Consumidor final'}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-zinc-400">{formatDate(quotation.created_at)}</td>
                    <td className="px-4 py-2.5 text-zinc-400">{quotation.status || 'pending'}</td>
                    <td className="px-4 py-2.5 text-right text-zinc-100 font-mono">{formatMoney(quotation.total)} MT</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
