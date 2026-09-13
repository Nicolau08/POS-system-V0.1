'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeftRight, Check, Edit3, HelpCircle, Plus, RefreshCw, Trash2, X } from 'lucide-react';
import { PosSwitch } from '@/components/PosSwitch';
import PosSelect from '@/components/PosSelect';
import { ManagementToolbarButton } from '@/components/ManagementToolbarButton';
import { getPosApiBase, getPosUserAuthHeaders } from '@/lib/apiBase';
import { unwrapApiSuccessPayload } from '@/lib/apiResponse';
import { getCachedTaxRates, setCachedTaxRates } from '@/lib/posSessionCache';
import { numberInputDisplayValue, parseNumberInput } from '@/lib/numberInput';

type TaxRate = {
  id: string;
  name: string;
  code: string;
  rate: number;
  isFixed: boolean;
  /** true = preço com imposto; false = preço + imposto */
  priceIncludesTax: boolean;
  /** Taxa usada automaticamente em novos produtos */
  isDefault: boolean;
  enabled: boolean;
  isSystem: boolean;
};

type TaxForm = Omit<TaxRate, 'id' | 'isSystem'>;

const EMPTY_FORM: TaxForm = {
  name: '',
  code: '',
  rate: 0,
  isFixed: false,
  priceIncludesTax: false,
  isDefault: false,
  enabled: true,
};

function isExemptRate(rate: number) {
  return Number(rate) === 0;
}

function priceModeLabel(row: Pick<TaxRate, 'rate' | 'priceIncludesTax'>) {
  if (isExemptRate(row.rate)) return 'Isento (sem imposto)';
  return row.priceIncludesTax !== false ? 'Preço com imposto' : 'Preço + imposto';
}

function resolveFormPriceIncludesTax(rate: number, priceIncludesTax: boolean) {
  if (isExemptRate(rate)) return false;
  return priceIncludesTax !== false;
}

function errorMessage(payload: unknown, fallback: string) {
  if (!payload || typeof payload !== 'object') return fallback;
  const value = payload as Record<string, unknown>;
  const nested =
    value.error && typeof value.error === 'object'
      ? (value.error as Record<string, unknown>)
      : null;
  return String(nested?.message ?? value.error ?? value.message ?? fallback);
}

function buildCode(name: string, rate: number) {
  const base = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '')
    .toUpperCase();
  return `${base || 'IMPOSTO'}${Number(rate) || 0}`;
}

export default function TaxRatesManager() {
  const [rows, setRows] = useState<TaxRate[]>(
    () => (getCachedTaxRates() as TaxRate[] | null) ?? []
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(() => !getCachedTaxRates()?.length);
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<TaxForm>(EMPTY_FORM);
  const [swapOpen, setSwapOpen] = useState(false);
  const [swapFrom, setSwapFrom] = useState('');
  const [swapTo, setSwapTo] = useState('');

  const fetchRows = useCallback(async () => {
    const hasCache = Boolean(getCachedTaxRates()?.length);
    if (!hasCache) setLoading(true);
    try {
      const response = await fetch(`${getPosApiBase()}/tax-rates?_=${Date.now()}`, {
        cache: 'no-store',
        headers: { ...getPosUserAuthHeaders() },
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(errorMessage(json, 'Falha ao carregar impostos.'));
      const data = unwrapApiSuccessPayload<TaxRate[]>(json);
      const next = Array.isArray(data)
        ? data.map((row) => ({
            ...row,
            priceIncludesTax: resolveFormPriceIncludesTax(Number(row.rate), row.priceIncludesTax !== false),
            isDefault: Boolean(row.isDefault),
          }))
        : [];
      setRows(next);
      setCachedTaxRates(next);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Falha ao carregar impostos.');
      if (!getCachedTaxRates()?.length) setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchRows();
  }, [fetchRows]);

  const selected = useMemo(
    () => rows.find((row) => row.id === selectedId) ?? null,
    [rows, selectedId],
  );

  const openNew = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setFormOpen(true);
  };

  const openEditRow = (row: TaxRate | null) => {
    if (!row) return;
    setEditingId(row.id);
    setForm({
      name: row.name,
      code: row.code,
      rate: row.rate,
      isFixed: row.isFixed,
      priceIncludesTax: resolveFormPriceIncludesTax(row.rate, row.priceIncludesTax !== false),
      isDefault: Boolean(row.isDefault),
      enabled: row.enabled,
    });
    setFormOpen(true);
  };

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    const rate = Number(form.rate);
    const payload = {
      ...form,
      name: form.name.trim(),
      code: form.code.trim().toUpperCase() || buildCode(form.name, rate),
      rate,
      isFixed: false,
      priceIncludesTax: resolveFormPriceIncludesTax(rate, form.priceIncludesTax),
    };
    if (!payload.name) return;
    const response = await fetch(
      editingId ? `${getPosApiBase()}/tax-rates/${editingId}` : `${getPosApiBase()}/tax-rates`,
      {
        method: editingId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json', ...getPosUserAuthHeaders() },
        body: JSON.stringify(payload),
      },
    );
    const json = await response.json().catch(() => ({}));
    if (!response.ok) {
      window.alert(errorMessage(json, 'Falha ao salvar imposto.'));
      return;
    }
    setFormOpen(false);
    setEditingId(null);
    await fetchRows();
  };

  const remove = async () => {
    if (!selected) return;
    if (!window.confirm(`Eliminar o imposto “${selected.name}”?`)) return;
    const response = await fetch(`${getPosApiBase()}/tax-rates/${selected.id}`, {
      method: 'DELETE',
      headers: { ...getPosUserAuthHeaders() },
    });
    const json = await response.json().catch(() => ({}));
    if (!response.ok) {
      window.alert(errorMessage(json, 'Falha ao eliminar imposto.'));
      return;
    }
    setSelectedId(null);
    await fetchRows();
  };

  const openSwap = () => {
    setSwapFrom(selectedId ?? rows[0]?.id ?? '');
    setSwapTo('');
    setSwapOpen(true);
  };

  const swap = async (event: React.FormEvent) => {
    event.preventDefault();
    const response = await fetch(`${getPosApiBase()}/tax-rates/swap`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getPosUserAuthHeaders() },
      body: JSON.stringify({ fromTaxRateId: swapFrom, toTaxRateId: swapTo }),
    });
    const json = await response.json().catch(() => ({}));
    if (!response.ok) {
      window.alert(errorMessage(json, 'Falha ao trocar impostos.'));
      return;
    }
    const result = unwrapApiSuccessPayload<{ updatedProducts?: number }>(json);
    window.alert(`${Number(result?.updatedProducts ?? 0)} produto(s) atualizado(s).`);
    setSwapOpen(false);
  };

  return (
    <div className="flex h-full flex-col overflow-hidden bg-pos-surface text-zinc-300">
      <div className="flex h-16 items-center gap-1 overflow-x-auto border-b border-pos-border bg-pos-surface px-2">
        <ManagementToolbarButton icon={<RefreshCw size={20} />} label="Atualizar" onClick={() => void fetchRows()} />
        <ManagementToolbarButton icon={<Plus size={22} />} label="Nova taxa de imposto" onClick={openNew} />
        <ManagementToolbarButton icon={<Edit3 size={20} />} label="Editar" onClick={() => openEditRow(selected)} disabled={!selected} />
        <ManagementToolbarButton icon={<Trash2 size={20} />} label="Eliminar" onClick={() => void remove()} disabled={!selected} />
        <ManagementToolbarButton icon={<ArrowLeftRight size={22} />} label="Trocar impostos" onClick={openSwap} disabled={rows.length < 2} />
        <ManagementToolbarButton icon={<HelpCircle size={20} />} label="Ajuda" />
      </div>

      <div className="flex-1 overflow-auto bg-pos-bg custom-scrollbar">
        <table className="w-full table-fixed border-collapse text-left [&_th]:border [&_td]:border [&_th]:border-pos-border/55 [&_td]:border-pos-border/55">
          <thead className="sticky top-0 z-10 bg-pos-card">
            <tr className="border-b border-[#0001fb]/70">
              <th className="w-[24%] px-3 py-2 text-xs font-bold text-zinc-300">Nome</th>
              <th className="w-[12%] px-3 py-2 text-xs font-bold text-zinc-300">Taxa</th>
              <th className="w-[14%] px-3 py-2 text-xs font-bold text-zinc-300">Código</th>
              <th className="w-[20%] px-3 py-2 text-xs font-bold text-zinc-300">Modo do preço</th>
              <th className="w-[10%] px-3 py-2 text-center text-xs font-bold text-zinc-300">Taxa fixa</th>
              <th className="w-[10%] px-3 py-2 text-center text-xs font-bold text-zinc-300">Habilitado</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="py-20 text-center text-xs text-zinc-600">Carregando impostos...</td></tr>
            ) : rows.map((row, index) => (
              <tr
                key={row.id}
                onClick={() => setSelectedId(row.id)}
                onDoubleClick={() => {
                  setSelectedId(row.id);
                  openEditRow(row);
                }}
                className={`cursor-pointer ${
                  selectedId === row.id ? 'bg-[var(--pos-brand-selected-bg)]' : index % 2 ? 'bg-pos-surface' : 'bg-pos-row'
                } hover:bg-[var(--pos-brand-hover-bg)]`}
              >
                <td className="px-3 py-2 text-xs text-zinc-200">{row.name}</td>
                <td className="px-3 py-2 text-xs text-zinc-200">{`${row.rate}%`}</td>
                <td className="px-3 py-2 text-xs text-zinc-400">{row.code}</td>
                <td className="px-3 py-2 text-xs text-zinc-300">{priceModeLabel(row)}</td>
                <td className="px-3 py-2 text-center text-xs">{row.isDefault ? '✓' : ''}</td>
                <td className="px-3 py-2 text-center text-xs">{row.enabled ? '✓' : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {formOpen && (
        <Modal title={editingId ? 'Editar taxa de imposto' : 'Nova taxa de imposto'} onClose={() => setFormOpen(false)}>
          <form id="tax-rate-form" onSubmit={save} className="space-y-4 p-6">
            <Field label="Nome" value={form.name} onChange={(name) => setForm((prev) => ({ ...prev, name }))} required />
            <div className="grid grid-cols-2 gap-4">
              <Field label="Código" value={form.code} onChange={(code) => setForm((prev) => ({ ...prev, code }))} />
              <div className="space-y-1">
                <label className="text-xs text-zinc-400">Taxa (%)</label>
                <input
                  type="number"
                  min="0"
                  max={100}
                  step="0.01"
                  inputMode="decimal"
                  placeholder="0"
                  value={numberInputDisplayValue(form.rate)}
                  onChange={(event) => {
                    const rate = parseNumberInput(event.target.value);
                    setForm((prev) => ({
                      ...prev,
                      rate,
                      priceIncludesTax: resolveFormPriceIncludesTax(rate, prev.priceIncludesTax),
                    }));
                  }}
                  className="w-full rounded border border-pos-border bg-pos-card px-3 py-2 text-sm text-white outline-none focus:border-[#0001fb] placeholder:text-zinc-600"
                />
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-zinc-400">Modo do preço de venda</label>
              {isExemptRate(form.rate) ? (
                <>
                  <div className="rounded border border-pos-border bg-pos-card px-3 py-2 text-sm text-zinc-300">
                    Isento (sem imposto)
                  </div>
                  <p className="text-[10px] leading-relaxed text-zinc-500">
                    Com taxa 0% o produto é isento: o preço de venda não inclui imposto.
                  </p>
                </>
              ) : (
                <>
                  <PosSelect
                    value={form.priceIncludesTax ? 'inclusive' : 'exclusive'}
                    onChange={(value) =>
                      setForm((prev) => ({ ...prev, priceIncludesTax: value !== 'exclusive' }))
                    }
                    options={[
                      { value: 'inclusive', label: 'Preço de venda com imposto' },
                      { value: 'exclusive', label: 'Preço de venda + imposto' },
                    ]}
                  />
                  <p className="text-[10px] leading-relaxed text-zinc-500">
                    {form.priceIncludesTax
                      ? 'O preço introduzido no produto já inclui o imposto. O POS cobra esse valor.'
                      : 'O preço introduzido no produto é sem imposto. O imposto é somado e o POS cobra o total.'}
                  </p>
                </>
              )}
            </div>
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-x-8 gap-y-2">
                <PosSwitch
                  label="Taxa fixa"
                  checked={form.isDefault}
                  onChange={(isDefault) => setForm((prev) => ({ ...prev, isDefault }))}
                />
                <PosSwitch
                  label="Habilitado"
                  checked={form.enabled}
                  onChange={(enabled) => setForm((prev) => ({ ...prev, enabled }))}
                />
              </div>
              <p className="text-[10px] leading-relaxed text-zinc-500">
                Ao ativar Taxa fixa, esta taxa fica automática nos produtos novos e também nos já existentes.
              </p>
            </div>
          </form>
          <ModalActions form="tax-rate-form" onCancel={() => setFormOpen(false)} />
        </Modal>
      )}

      {swapOpen && (
        <Modal title="Trocar impostos nos produtos" onClose={() => setSwapOpen(false)}>
          <form id="swap-tax-form" onSubmit={swap} className="space-y-4 p-6">
            <p className="text-xs text-zinc-500">Todos os produtos associados ao imposto de origem passarão para o imposto de destino.</p>
            <div className="space-y-1">
              <label className="text-xs text-zinc-400">Imposto de origem</label>
              <PosSelect value={swapFrom} onChange={setSwapFrom} options={rows.map((row) => ({ value: row.id, label: `${row.name} (${row.rate}%)` }))} />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-zinc-400">Imposto de destino</label>
              <PosSelect value={swapTo} onChange={setSwapTo} options={[{ value: '', label: 'Selecione...' }, ...rows.filter((row) => row.id !== swapFrom).map((row) => ({ value: row.id, label: `${row.name} (${row.rate}%)` }))]} />
            </div>
          </form>
          <ModalActions form="swap-tax-form" onCancel={() => setSwapOpen(false)} />
        </Modal>
      )}
    </div>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center pos-modal-overlay p-4" onClick={onClose}>
      <div className="w-full max-w-lg overflow-hidden rounded border border-pos-border bg-pos-surface" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-pos-border px-5 py-4">
          <h3 className="text-lg text-zinc-200">{title}</h3>
          <button type="button" onClick={onClose} className="text-zinc-500 hover:text-white"><X size={18} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

function ModalActions({ form, onCancel }: { form: string; onCancel: () => void }) {
  return (
    <div className="flex justify-end gap-3 border-t border-pos-border p-4">
      <button type="submit" form={form} className="flex items-center gap-2 rounded bg-[#0001fb] px-6 py-2 text-xs font-medium text-white hover:bg-[#1a1bff]"><Check size={15} />Salvar</button>
      <button type="button" onClick={onCancel} className="rounded border border-pos-border px-6 py-2 text-xs text-zinc-300 hover:bg-zinc-800">Cancelar</button>
    </div>
  );
}

function Field({ label, value, onChange, required }: { label: string; value: string; onChange: (value: string) => void; required?: boolean }) {
  return (
    <div className="space-y-1">
      <label className="text-xs text-zinc-400">{label}</label>
      <input required={required} value={value} onChange={(event) => onChange(event.target.value)} className="w-full rounded border border-pos-border bg-pos-card px-3 py-2 text-sm text-white outline-none focus:border-[#0001fb]" />
    </div>
  );
}
