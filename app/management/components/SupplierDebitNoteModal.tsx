'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { FileMinus2, Loader2, X } from 'lucide-react';
import { getPosApiBase, getPosUserAuthHeaders } from '@/lib/apiBase';
import { extractApiErrorMessage, unwrapApiSuccessPayload } from '@/lib/apiResponse';
import { formatMoneyMt } from '@/lib/currency';
import PosSelect from '@/components/PosSelect';
import { PosSwitch } from '@/components/PosSwitch';
import {
  fetchWarehouseStock,
  fetchWarehouses,
  type PosWarehouse,
} from '@/lib/services/posService';

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
  approved_document_type?: string | null;
  approved_document_number?: string | null;
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
  ftfQty: number;
  alreadyReturned: number;
  stockQty: number;
  maxQty: number;
  quantity: number;
  unitPrice: number;
  selected: boolean;
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

function isNdOrder(order: DebitNoteSourceOrder) {
  const number = String(order.document_number ?? '').trim().toUpperCase();
  const docType = String(order.doc_type ?? '').trim().toUpperCase();
  return number.startsWith('ND/') || docType === 'ND' || docType.includes('DÉBITO') || docType.includes('DEBITO');
}

function computeMaxQty(ftfQty: number, alreadyReturned: number, stockQty: number, physicalReturn: boolean) {
  const remainingOnFtf = Math.max(0, ftfQty - alreadyReturned);
  if (!physicalReturn) return remainingOnFtf;
  return Math.max(0, Math.min(remainingOnFtf, stockQty));
}

export function SupplierDebitNoteModal({
  isOpen,
  onClose,
  sourceOrders,
  itemsByOrderId,
  initialSourceOrder,
  initialSourceOrderId,
  initialSourceItems,
  onSaved,
}: {
  isOpen: boolean;
  onClose: () => void;
  sourceOrders: DebitNoteSourceOrder[];
  itemsByOrderId: Record<string, DebitNoteSourceItem[]>;
  initialSourceOrder?: DebitNoteSourceOrder | null;
  initialSourceOrderId?: string | null;
  initialSourceItems?: DebitNoteSourceItem[];
  onSaved?: (result: { documentNumber: string }) => void;
}) {
  const [sourceId, setSourceId] = useState('');
  const [lines, setLines] = useState<EditableLine[]>([]);
  const [physicalReturn, setPhysicalReturn] = useState(true);
  const [isWaste, setIsWaste] = useState(false);
  const [wasteReason, setWasteReason] = useState('');
  const [warehouses, setWarehouses] = useState<PosWarehouse[]>([]);
  const [warehouseId, setWarehouseId] = useState('');
  const [stockByProductId, setStockByProductId] = useState<Record<string, number>>({});
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

  const effectiveSource = initialSourceOrderId ? initialSourceOrder ?? selectedSource : selectedSource;

  const returnedQtyByProduct = useMemo(() => {
    const sourceNumber = String(effectiveSource?.document_number ?? '').trim().toUpperCase();
    if (!sourceNumber) return {} as Record<string, number>;
    const map: Record<string, number> = {};
    for (const order of sourceOrders) {
      if (!isNdOrder(order)) continue;
      const linked = String(order.approved_document_number ?? '').trim().toUpperCase();
      const linkedType = String(order.approved_document_type ?? '').trim().toUpperCase();
      if (linked !== sourceNumber) continue;
      if (linkedType && linkedType !== 'FTF') continue;
      const items = itemsByOrderId[String(order.id)] ?? [];
      for (const item of items) {
        const pid = item.product_id != null ? String(item.product_id) : '';
        if (!pid) continue;
        map[pid] = (map[pid] || 0) + (Number(item.quantity ?? 0) || 0);
      }
    }
    return map;
  }, [effectiveSource?.document_number, itemsByOrderId, sourceOrders]);

  const taxRatio = useMemo(() => {
    if (!effectiveSource) return 0;
    const subtotal = Number(effectiveSource.subtotal ?? 0);
    const tax = Number(effectiveSource.tax ?? 0);
    if (!(subtotal > 0) || !(tax > 0)) return 0;
    return tax / subtotal;
  }, [effectiveSource]);

  const totals = useMemo(() => {
    return lines.reduce(
      (acc, line) => {
        const qty = line.selected ? Math.max(0, Number(line.quantity) || 0) : 0;
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

  const noReturnableStock = useMemo(() => {
    if (!physicalReturn || lines.length === 0) return false;
    return lines.every((line) => line.maxQty <= 0);
  }, [lines, physicalReturn]);

  useEffect(() => {
    if (!isOpen) return;
    setSourceId(String(initialSourceOrderId ?? '').trim());
    setPhysicalReturn(true);
    setIsWaste(false);
    setWasteReason('');
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
  }, [initialSourceOrderId, isOpen]);

  useEffect(() => {
    if (!isOpen || !warehouseId || !physicalReturn) {
      setStockByProductId({});
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const rows = await fetchWarehouseStock(warehouseId);
        if (cancelled) return;
        const map: Record<string, number> = {};
        for (const row of rows) {
          if (!row.productId) continue;
          map[row.productId] = row.quantity;
        }
        setStockByProductId(map);
      } catch {
        if (!cancelled) setStockByProductId({});
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isOpen, physicalReturn, warehouseId]);

  useEffect(() => {
    if (!isOpen) return;
    if (!effectiveSource) {
      setLines([]);
      return;
    }
    const fallbackItems = itemsByOrderId[String(effectiveSource.id)] ?? [];
    const items =
      initialSourceOrderId && initialSourceItems?.length ? initialSourceItems : fallbackItems;
    setLines(
      items
        .filter((item) => Number(item.quantity ?? 0) > 0)
        .map((item, index) => {
          const productId = item.product_id != null ? String(item.product_id) : null;
          const ftfQty = Math.max(0, Number(item.quantity ?? 0));
          const alreadyReturned = productId ? Number(returnedQtyByProduct[productId] ?? 0) || 0 : 0;
          const stockQty = productId ? Number(stockByProductId[productId] ?? 0) || 0 : 0;
          const maxQty = computeMaxQty(ftfQty, alreadyReturned, stockQty, physicalReturn);
          return {
            key: String(item.id ?? `line-${index}`),
            productId,
            name: String(item.product_name ?? `Item ${index + 1}`),
            unit: String(item.unit ?? 'un'),
            ftfQty,
            alreadyReturned,
            stockQty,
            maxQty,
            quantity: maxQty,
            unitPrice: Math.max(0, Number(item.price ?? 0)),
            selected: false,
          };
        }),
    );
  }, [
    effectiveSource,
    initialSourceItems,
    initialSourceOrderId,
    isOpen,
    itemsByOrderId,
    physicalReturn,
    returnedQtyByProduct,
    stockByProductId,
  ]);

  const updateLineQty = (key: string, raw: number) => {
    setLines((prev) =>
      prev.map((line) => {
        if (line.key !== key) return line;
        const next = Math.max(0, Math.min(line.maxQty, Number(raw) || 0));
        return { ...line, quantity: Number(next.toFixed(3)) };
      }),
    );
  };

  const toggleLine = (key: string, selected: boolean) => {
    setLines((prev) =>
      prev.map((line) =>
        line.key === key
          ? {
              ...line,
              selected: selected && line.maxQty > 0 ? selected : false,
              quantity: selected && line.quantity <= 0 ? line.maxQty : line.quantity,
            }
          : line,
      ),
    );
  };

  const handleSave = async () => {
    if (saving) return;
    setError('');
    if (!effectiveSource?.document_number) {
      setError('Seleccione a fatura de fornecedor (FTF) de origem.');
      return;
    }
    const activeLines = lines.filter((line) => line.selected && line.quantity > 0);
    if (activeLines.length === 0) {
      setError(
        physicalReturn && noReturnableStock
          ? 'Não há stock disponível para devolver nesta FTF (já foi vendido ou sem existências).'
          : 'Seleccione pelo menos um produto e indique a quantidade.',
      );
      return;
    }
    if (isWaste && !wasteReason.trim()) {
      setError('Informe o motivo do desperdício.');
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
    if (physicalReturn) {
      const overStock = activeLines.find((line) => line.quantity > line.stockQty + 1e-6);
      if (overStock) {
        setError(
          `«${overStock.name}» sem stock suficiente no armazém (disponível: ${overStock.stockQty}). Não há o que devolver.`,
        );
        return;
      }
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
        sourceDocumentNumber: String(effectiveSource.document_number).trim(),
        externalDocument: String(effectiveSource.document_number).trim(),
        customerId: effectiveSource.customer_id != null ? String(effectiveSource.customer_id) : null,
        customerName: String(effectiveSource.client_name ?? 'Fornecedor'),
        warehouseId: physicalReturn ? warehouseId : null,
        total: totals.gross,
        subtotal: totals.net,
        tax: totals.tax,
        discount: 0,
        paymentMethod: null,
        isWaste,
        notes: isWaste ? `Desperdício: ${wasteReason.trim()}` : null,
        items,
      };

      const res = await fetch(`${getPosApiBase()}/documentos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getPosUserAuthHeaders() },
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
              baixa — só é possível se ainda houver existências no armazém.
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
            {initialSourceOrderId ? (
              <div className="rounded border border-zinc-800 bg-[#141414] px-3 py-2 text-sm md:col-span-2">
                <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                  Fatura de fornecedor (origem)
                </p>
                <p className="mt-1 font-medium text-zinc-100">
                  {effectiveSource?.document_number || '—'}
                </p>
              </div>
            ) : (
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
            )}

            <div className="rounded border border-zinc-800 bg-[#141414] px-3 py-2 text-sm">
              <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">Fornecedor</p>
              <p className="mt-1 font-medium text-zinc-100">
                {effectiveSource?.client_name || '—'}
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
            disabled={saving || isWaste}
            label="Devolução física (baixa stock)"
          />

          {physicalReturn && noReturnableStock && effectiveSource ? (
            <p className="rounded border border-amber-700/50 bg-amber-950/40 px-3 py-2 text-xs text-amber-200">
              Não há o que devolver: o stock desta FTF já foi vendido ou não existe no armazém seleccionado.
              Desactive a devolução física para uma correcção apenas comercial, se aplicável.
            </p>
          ) : null}

          <div className="rounded border border-zinc-800 bg-[#141414] px-4 py-3">
            <label className="flex cursor-pointer items-center gap-3 text-sm text-zinc-200">
              <input
                type="checkbox"
                checked={isWaste}
                disabled={saving}
                onChange={(event) => {
                  const checked = event.target.checked;
                  setIsWaste(checked);
                  if (checked) setPhysicalReturn(true);
                  if (!checked) setWasteReason('');
                }}
                className="h-4 w-4 accent-[#0001fb]"
              />
              É desperdício
            </label>
            {isWaste ? (
              <label className="mt-3 block space-y-1.5">
                <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                  Motivo do desperdício
                </span>
                <textarea
                  value={wasteReason}
                  onChange={(event) => setWasteReason(event.target.value)}
                  disabled={saving}
                  maxLength={500}
                  rows={3}
                  placeholder="Ex.: produto danificado, expirado ou impróprio para venda…"
                  className="pos-field min-h-20 resize-y px-3 py-2 text-sm placeholder:text-zinc-600"
                />
              </label>
            ) : null}
          </div>

          <div className="overflow-hidden rounded border border-zinc-800">
            <div className="grid grid-cols-[48px_minmax(0,1.4fr)_72px_72px_88px_100px] gap-2 border-b border-zinc-800 bg-[#141414] px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-zinc-500">
              <span className="text-center">Incluir</span>
              <span>Produto</span>
              <span className="text-right">FTF</span>
              <span className="text-right">{physicalReturn ? 'Stock' : 'Rest.'}</span>
              <span className="text-right">Devolver</span>
              <span className="text-right">Total</span>
            </div>
            {!effectiveSource ? (
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
                  const lineNet = line.selected ? roundMoney(line.unitPrice * line.quantity) : 0;
                  const lineTax = roundMoney(lineNet * taxRatio);
                  const lineGross = roundMoney(lineNet + lineTax);
                  const blocked = physicalReturn && line.maxQty <= 0;
                  return (
                    <div
                      key={line.key}
                      className={`grid grid-cols-[48px_minmax(0,1.4fr)_72px_72px_88px_100px] items-center gap-2 px-3 py-2 ${
                        line.selected ? 'bg-[var(--pos-brand-selected-bg)]' : ''
                      } ${blocked ? 'opacity-55' : ''}`}
                    >
                      <div className="flex justify-center">
                        <input
                          type="checkbox"
                          checked={line.selected}
                          disabled={saving || blocked}
                          onChange={(event) => toggleLine(line.key, event.target.checked)}
                          aria-label={`Incluir ${line.name} na nota de débito`}
                          className="h-4 w-4 accent-[#0001fb]"
                        />
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-sm text-zinc-100">{line.name}</p>
                        <p className="text-[10px] text-zinc-500">
                          {formatMoneyMt(line.unitPrice)} / {line.unit}
                          {line.alreadyReturned > 0
                            ? ` · já ND: ${line.alreadyReturned}`
                            : ''}
                          {blocked ? ' · sem stock' : ''}
                        </p>
                      </div>
                      <span className="text-right text-xs text-zinc-400 tabular-nums">
                        {line.ftfQty}
                      </span>
                      <span className="text-right text-xs text-zinc-400 tabular-nums">
                        {physicalReturn
                          ? line.stockQty
                          : Math.max(0, line.ftfQty - line.alreadyReturned)}
                      </span>
                      <input
                        type="number"
                        min={0}
                        max={line.maxQty}
                        step="any"
                        value={line.quantity}
                        disabled={saving || !line.selected || blocked}
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
            disabled={saving || loadingMeta || (physicalReturn && noReturnableStock)}
            onClick={() => void handleSave()}
            className="inline-flex items-center gap-2 rounded bg-[#0001fb] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#1a1aff] disabled:opacity-40"
          >
            {saving ? <Loader2 size={16} className="animate-spin" /> : <FileMinus2 size={16} />}
            Emitir ND
          </button>
        </div>
      </div>
    </div>
  );
}
