'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeftRight, Loader2, X } from 'lucide-react';
import PosSelect from '@/components/PosSelect';
import { numberInputDisplayValue } from '@/lib/numberInput';
import {
  fetchWarehouses,
  transferWarehouseStockApi,
  type PosWarehouse,
} from '@/lib/services/posService';

type ProductOption = {
  id: string;
  name: string;
  stock_quantity?: number;
  warehouse_quantity?: number | null;
};

type TransferStockModalProps = {
  isOpen: boolean;
  onClose: () => void;
  products: ProductOption[];
  onSaved: () => void | Promise<void>;
};

export default function TransferStockModal({
  isOpen,
  onClose,
  products,
  onSaved,
}: TransferStockModalProps) {
  const [warehouses, setWarehouses] = useState<PosWarehouse[]>([]);
  const [fromId, setFromId] = useState('');
  const [toId, setToId] = useState('');
  const [productId, setProductId] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setError('');
    setQuantity('1');
    setProductId('');
    setLoading(true);
    void (async () => {
      try {
        const rows = await fetchWarehouses();
        const active = rows.filter((w) => w.isActive);
        setWarehouses(active);
        const def = active.find((w) => w.isDefault) || active[0];
        const other = active.find((w) => w.id !== def?.id) || active[1] || null;
        setFromId(def?.id || '');
        setToId(other?.id || '');
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Falha ao carregar armazéns.');
      } finally {
        setLoading(false);
      }
    })();
  }, [isOpen]);

  const productOptions = useMemo(
    () =>
      products
        .filter((p) => p.id)
        .map((p) => ({ value: String(p.id), label: p.name })),
    [products],
  );

  const selectedProduct = products.find((p) => String(p.id) === String(productId));

  const handleSave = async () => {
    if (saving) return;
    setError('');
    if (!fromId || !toId) {
      setError('Seleccione origem e destino.');
      return;
    }
    if (fromId === toId) {
      setError('Origem e destino devem ser diferentes.');
      return;
    }
    if (!productId) {
      setError('Seleccione um produto.');
      return;
    }
    const qty = Number(quantity);
    if (!Number.isFinite(qty) || qty <= 0) {
      setError('Quantidade inválida.');
      return;
    }

    setSaving(true);
    try {
      await transferWarehouseStockApi({
        fromWarehouseId: fromId,
        toWarehouseId: toId,
        items: [
          {
            productId,
            quantity: qty,
            name: selectedProduct?.name,
          } as any,
        ],
      });
      await onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha na transferência.');
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center pos-modal-overlay p-4">
      <div className="w-full max-w-lg rounded border border-pos-border bg-pos-surface shadow-2xl">
        <div className="flex items-center justify-between border-b border-pos-border px-4 py-3">
          <div className="flex items-center gap-2 text-zinc-100">
            <ArrowLeftRight size={18} className="text-[#0001fb]" />
            <h2 className="text-sm font-semibold">Transferência de stock</h2>
          </div>
          <button type="button" onClick={onClose} className="rounded p-1.5 text-zinc-400 hover:bg-zinc-800">
            <X size={16} />
          </button>
        </div>

        <div className="space-y-3 p-4">
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-zinc-400">
              <Loader2 size={14} className="animate-spin" />A carregar…
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3">
                <label className="block space-y-1">
                  <span className="text-[10px] font-bold uppercase text-zinc-500">Origem</span>
                  <PosSelect
                    value={fromId}
                    onChange={setFromId}
                    options={warehouses.map((w) => ({ value: w.id, label: w.name }))}
                    size="md"
                  />
                </label>
                <label className="block space-y-1">
                  <span className="text-[10px] font-bold uppercase text-zinc-500">Destino</span>
                  <PosSelect
                    value={toId}
                    onChange={setToId}
                    options={warehouses.map((w) => ({ value: w.id, label: w.name }))}
                    size="md"
                  />
                </label>
              </div>
              <label className="block space-y-1">
                <span className="text-[10px] font-bold uppercase text-zinc-500">Produto</span>
                <PosSelect
                  value={productId}
                  onChange={setProductId}
                  options={[{ value: '', label: 'Seleccione…' }, ...productOptions]}
                  size="md"
                />
              </label>
              <label className="block space-y-1">
                <span className="text-[10px] font-bold uppercase text-zinc-500">Quantidade</span>
                <input
                  type="number"
                  min="0"
                  step="any"
                  inputMode="decimal"
                  placeholder="0"
                  value={numberInputDisplayValue(quantity)}
                  onChange={(e) => setQuantity(e.target.value)}
                  className="h-10 w-full rounded border border-zinc-600 bg-pos-surface px-3 text-sm text-white placeholder:text-zinc-600"
                />
              </label>
            </>
          )}
          {error ? <p className="text-xs text-amber-400">{error}</p> : null}
        </div>

        <div className="flex justify-end gap-2 border-t border-pos-border px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-zinc-600 px-3 py-1.5 text-xs text-zinc-300"
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={saving || loading}
            onClick={() => void handleSave()}
            className="rounded bg-[#0001fb] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
          >
            {saving ? 'A transferir…' : 'Transferir'}
          </button>
        </div>
      </div>
    </div>
  );
}
