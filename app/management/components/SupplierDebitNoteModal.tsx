'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { FileMinus2, Loader2, X } from 'lucide-react';
import { getPosApiBase } from '@/lib/apiBase';
import { extractApiErrorMessage, unwrapApiSuccessPayload } from '@/lib/apiResponse';
import { formatMoneyMt } from '@/lib/currency';
import PosSelect from '@/components/PosSelect';
import { PosSwitch } from '@/components/PosSwitch';
import { fetchWarehouses, type PosWarehouse } from '@/lib/services/posService';

export type DebitNoteSourceOrder = {
  id: number | string;
  document_number?: string | null;
  doc_type?: string | null;
  customer_id?: string | null;
  client_name?: string | null;
  subtotal?: number | null;
  tax?: number | null;
  total?: number | null;
  status?: string | null;
};

export type DebitNoteSourceItem = {
  id: number | string;
  order_id: number | string;
  product_id?: string | number | null;
  product_name?: string | null;
  quantity?: number | null;
  unit?: string | null;
  price?: number | null;
};

type EditableLine = {
  key: string;
  productId: string | null;
  name: string;
  unit: string;
  maxQty: number;
  quantity: number;
  unitPrice: number;
};

function roundMoney(n: number) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function isFtfOrder(order: DebitNoteSourceOrder) {
  const number = String(order.document_number ?? '').trim().toUpperCase();
  const docType = String(order.doc_type ?? '').trim().toUpperCase();
  return (
    number.startsWith('FTF/') ||
    docType === 'FTF' ||
    docType === 'COMPRA' ||
    docType.includes('FORNECEDOR')
  );
}

export function SupplierDebitNoteModal({
  isOpen,
  onClose,
  sourceOrders,
  itemsByOrderId,
  onSaved,
}: {
  isOpen: boolean;
  onClose: () => void;
  sourceOrders: DebitNoteSourceOrder[];
  itemsByOrderId: Record<string, DebitNoteSourceItem[]>;
  onSaved?: (result: { documentNumber: string }) => void;
}) {
  const [sourceId, setSourceId] = useState('');
  const [lines, setLines] = useState<EditableLine[]>([]);
  const [physicalReturn, setPhysicalReturn] = useState(true);
  const [warehouses, setWarehouses] = useState<PosWarehouse[]>([]);
  const [warehouseId, setWarehouseId] = useState('');
  const [loadingMeta, setLoadingMeta] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const ftfOrders = useMemo(
    () =>
      sourceOrders
        .filter(isFtfOrder)
        .slice()
        .sort((a, b) =>
          String(b.document_number ?? '').localeCompare(String(a.document_number ?? ''), 'pt'),
        ),
    [sourceOrders],
  );

  const selectedSource = useMemo(
    () => ftfOrders.find((row) => String(row.id) === String(sourceId)) ?? null,
    [ftfOrders, sourceId],
  );

  const taxRatio = useMemo(() => {
    if (!selectedSource) return 0;
    const subtotal = Number(selectedSource.subtotal ?? 0);
    const tax = Number(selectedSource.tax ?? 0);
    if (!(subtotal > 0) || !(tax > 0)) return 0;
    return tax / subtotal;
  }, [selectedSource]);

  const totals = useMemo(() => {
    return lines.reduce(
      (acc, line) => {
        const qty = Math.max(0, Number(line.quantity) || 0);
        const lineNet = roundMoney(line.unitPrice * qty);
        const lineTax = roundMoney(lineNet * taxRatio);
        const lineGross = roundMoney(lineNet + lineTax);
        return {
          net: roundMoney(acc.net + lineNet),
          tax: roundMoney(acc.tax + lineTax),
          gross: roundMoney(acc.gross + lineGross),
        };
      },
      { net: 0, tax: 0, gross: 0 },
    );
  }, [lines, taxRatio]);

  useEffect(() => {
    if (!isOpen) return;
    setSourceId('');
    setLines([]);
    setPhysicalReturn(true);
    setError('');
    setSaving(false);
    setLoadingMeta(true);
    void (async () => {
      try {
        const rows = await fetchWarehouses();
        const active = rows.filter((w) => w.isActive);
        setWarehouses(active);
        const def = active.find((w) => w.isDefault) || active[0];
        setWarehouseId(def?.id || '');
      } catch {
        setError('Não foi possível carregar armazéns.');
      } finally {
        setLoadingMeta(false);
      }
    })();
  }, [isOpen]);

  useEffect(() => {
    if (!selectedSource) {
      setLines([]);
      return;
    }
    const items = itemsByOrderId[String(selectedSource.id)] ?? [];
    setLines(
      items
        .filter((item) => Number(item.quantity ?? 0) > 0)
        .map((item, index) => {
          const maxQty = Math.max(0, Number(item.quantity ?? 0));
          return {
            key: String(item.id ?? `line-${index}`),
            productId: item.product_id != null ? String(item.product_id) : null,
            name: String(item.product_name ?? `Item ${index + 1}`),
            unit: String(item.unit ?? 'un'),
            maxQty,
            quantity: maxQty,
            unitPrice: Math.max(0, Number(item.price ?? 0)),
          };
        }),
    );
  }, [selectedSource, itemsByOrderId]);

  const updateLineQty = (key: string, raw: number) => {
    setLines((prev) =>
      prev.map((line) => {
        if (line.key !== key) return line;
        const next = Math.max(0, Math.min(line.maxQty, Number(raw) || 0));
        return { ...line, quantity: Number(next.toFixed(3)) };
      }),
    );
  };

  const handleSave = async () => {
    if (saving) return;
    setError('');
    if (!selectedSource?.document_number) {
      setError('Seleccione a fatura de fornecedor (FTF) de origem.');
      return;
    }
    const activeLines = lines.filter((line) => line.quantity > 0);
    if (activeLines.length === 0) {
      setError('Indique quantidade em pelo menos uma linha.');
      return;
    }
    if (physicalReturn && !warehouseId) {
      setError('Seleccione o armazém da devolução.');
      return;
    }
    if (physicalReturn && activeLines.some((line) => !line.productId)) {
      setError('Há linhas sem produto ligado — não é possível baixar stock.');
      return;
    }

    setSaving(true);
    try {
      const items = activeLines.map((line) => {
        const lineNet = roundMoney(line.unitPrice * line.quantity);
        const lineTax = roundMoney(lineNet * taxRatio);
        const lineGross = roundMoney(lineNet + lineTax);
        const unitTax = line.quantity > 0 ? roundMoney(lineTax / line.quantity) : 0;
        const unitGross = line.quantity > 0 ? roundMoney(lineGross / line.quantity) : line.unitPrice;
        return {
          productId: line.productId,
          name: line.name,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          unitGross,
          taxAmount: unitTax,
          discountAmount: 0,
        };
      });

      const payload = {
        documentType: 'Nota de débito',
        prefix: 'ND',
        paid: true,
        physicalReturn,
        sourceDocumentNumber: String(selectedSource.document_number).trim(),
        externalDocument: String(selectedSource.document_number).trim(),
        customerId: selectedSource.customer_id != null ? String(selectedSource.customer_id) : null,
        customerName: String(selectedSource.client_name ?? 'Fornecedor'),
        warehouseId: physicalReturn ? warehouseId : null,
        total: totals.gross,
        subtotal: totals.net,
        tax: totals.tax,
        discount: 0,
        paymentMethod: null,
        items,
      };

      const res = await fetch(`${getPosApiBase()}/documentos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(extractApiErrorMessage(body, `Falha ao criar ND (${res.status})`));
      }
      const data = unwrapApiSuccessPayload<{ documentNumber?: string }>(body) ?? body;
      const documentNumber = String(
        data?.documentNumber ?? body?.documentNumber ?? body?.data?.documentNumber ?? '',
      );
      onSaved?.({ documentNumber });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao criar nota de débito.');
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/70 p-4 backdrop-blur-[2px]"
      onClick={() => {
        if (!saving) onClose();
      }}
    >
      <div
        className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded border border-zinc-700 bg-[#1a1a1a] shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-zinc-800 px-5 py-4">
          <div>
            <h2 className="text-base font-bold text-white">Criar nota de débito</h2>
            <p className="mt-1 text-xs text-zinc-400">
              Devolução / correcção contra uma fatura de fornecedor (FTF). Com devolução física o stock
              baixa.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded p-1.5 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-white disabled:opacity-40"
            aria-label="Fechar"
          >
            <X size={18} />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4 custom-scrollbar">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <label className="block space-y-1.5 md:col-span-2">
              <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                Fatura de fornecedor (origem)
              </span>
              <PosSelect
                value={sourceId}
                onChange={setSourceId}
                disabled={saving || loadingMeta || ftfOrders.length === 0}
                size="md"
                placeholder={
                  ftfOrders.length === 0
                    ? 'Sem faturas de fornecedor…'
                    : 'Seleccione a FTF…'
                }
                options={[
                  { value: '', label: 'Seleccione a FTF…' },
                  ...ftfOrders.map((order) => ({
                    value: String(order.id),
                    label: `${order.document_number ?? 'FTF'} — ${order.client_name ?? 'Fornecedor'} (${formatMoneyMt(Number(order.total ?? 0))})`,
                  })),
                ]}
              />
            </label>

            <div className="rounded border border-zinc-800 bg-[#141414] px-3 py-2 text-sm">
              <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">Fornecedor</p>
              <p className="mt-1 font-medium text-zinc-100">
                {selectedSource?.client_name || '—'}
              </p>
            </div>

            <label className="block space-y-1.5">
              <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                Armazém
              </span>
              <PosSelect
                value={warehouseId}
                onChange={setWarehouseId}
                disabled={saving || loadingMeta || !physicalReturn || warehouses.length === 0}
                size="md"
                placeholder="Seleccione o armazém…"
                options={warehouses.map((w) => ({
                  value: w.id,
                  label: w.isDefault ? `${w.name} (principal)` : w.name,
                }))}
              />
            </label>
          </div>

          <PosSwitch
            checked={physicalReturn}
            onChange={setPhysicalReturn}
            disabled={saving}
            label="Devolução física (baixa stock)"
          />

          <div className="overflow-hidden rounded border border-zinc-800">
            <div className="grid grid-cols-[minmax(0,1.4fr)_88px_100px_100px] gap-2 border-b border-zinc-800 bg-[#141414] px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-zinc-500">
              <span>Produto</span>
              <span className="text-right">Qtd FTF</span>
              <span className="text-right">Devolver</span>
              <span className="text-right">Total</span>
            </div>
            {!selectedSource ? (
              <p className="px-3 py-8 text-center text-xs text-zinc-500">
                Escolha uma FTF para carregar as linhas.
              </p>
            ) : lines.length === 0 ? (
              <p className="px-3 py-8 text-center text-xs text-zinc-500">
                Esta fatura não tem itens.
              </p>
            ) : (
              <div className="divide-y divide-zinc-800/80">
                {lines.map((line) => {
                  const lineNet = roundMoney(line.unitPrice * line.quantity);
                  const lineTax = roundMoney(lineNet * taxRatio);
                  const lineGross = roundMoney(lineNet + lineTax);
                  return (
                    <div
                      key={line.key}
                      className="grid grid-cols-[minmax(0,1.4fr)_88px_100px_100px] items-center gap-2 px-3 py-2"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm text-zinc-100">{line.name}</p>
                        <p className="text-[10px] text-zinc-500">
                          {formatMoneyMt(line.unitPrice)} / {line.unit}
                        </p>
                      </div>
                      <span className="text-right text-xs text-zinc-400 tabular-nums">
                        {line.maxQty}
                      </span>
                      <input
                        type="number"
                        min={0}
                        max={line.maxQty}
                        step="any"
                        value={line.quantity}
                        disabled={saving}
                        onChange={(event) =>
                          updateLineQty(line.key, Number(event.target.value) || 0)
                        }
                        className="pos-field h-9 w-full border border-[#3f3f46] px-2 text-right text-sm"
                      />
                      <span className="text-right text-sm font-semibold text-zinc-200 tabular-nums">
                        {formatMoneyMt(lineGross)}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="flex justify-end">
            <div className="inline-grid grid-cols-[auto_auto] items-baseline gap-x-6 gap-y-1 text-right text-white tabular-nums">
              <span className="text-sm text-zinc-400">Valor sem imposto:</span>
              <span className="text-sm font-semibold text-zinc-100">{formatMoneyMt(totals.net)}</span>
              <span className="text-sm text-zinc-400">Imposto:</span>
              <span className="text-sm font-semibold text-zinc-100">{formatMoneyMt(totals.tax)}</span>
              <span className="text-base font-bold text-white">Total:</span>
              <span className="text-lg font-bold text-white">{formatMoneyMt(totals.gross)}</span>
            </div>
          </div>

          {error ? <p className="text-xs text-rose-400">{error}</p> : null}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-zinc-800 px-5 py-4">
          <button
            type="button"
            disabled={saving}
            onClick={onClose}
            className="rounded border border-zinc-600 px-4 py-2 text-sm text-zinc-300 transition-colors hover:border-[#0001fb] hover:text-white disabled:opacity-40"
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={saving || loadingMeta}
            onClick={() => void handleSave()}
            className="inline-flex items-center gap-2 rounded bg-[#0001fb] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#1a1bff] disabled:opacity-50"
          >
            {saving ? <Loader2 size={16} className="animate-spin" /> : <FileMinus2 size={16} />}
            Guardar ND
          </button>
        </div>
      </div>
    </div>
  );
}
