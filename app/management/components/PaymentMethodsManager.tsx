'use client';

import React, { useEffect, useMemo, useState } from 'react';
import {
  RotateCcw,
  Plus,
  Edit3,
  Trash2,
  HelpCircle,
  ArrowRight,
  Check,
  X,
} from 'lucide-react';

import { getPosApiBase, getPosUserAuthHeaders } from '@/lib/apiBase';
import { unwrapApiSuccessPayload } from '@/lib/apiResponse';
import { getPosCatalogCache, patchPosCatalogCache } from '@/lib/posSessionCache';
import { getPaymentMethodColor } from '@/lib/paymentMethodLabel';
import { PosSwitch } from '@/components/PosSwitch';
import { ManagementToolbarButton } from '@/components/ManagementToolbarButton';

type PaymentMethod = {
  id: string;
  name: string;
  code: string;
  shortcut: string;
  position: number;
  enabled: boolean;
  quickPayment: boolean;
  requiredCustomer: boolean;
  allowChange: boolean;
  markAsPaid: boolean;
  printReceipt: boolean;
  openCashDrawer: boolean;
  color: string;
};

type PaymentMethodForm = Omit<PaymentMethod, 'id'>;

function apiErrorMessage(payload: unknown, fallback: string) {
  if (!payload || typeof payload !== 'object') return fallback;
  const candidate = payload as Record<string, unknown>;
  const errorObject =
    candidate.error && typeof candidate.error === 'object'
      ? (candidate.error as Record<string, unknown>)
      : null;
  return String(errorObject?.message ?? candidate.error ?? candidate.message ?? fallback);
}

const initialForm: PaymentMethodForm = {
  name: '',
  code: '',
  shortcut: '',
  position: 1,
  enabled: true,
  quickPayment: true,
  requiredCustomer: false,
  allowChange: true,
  markAsPaid: true,
  printReceipt: true,
  openCashDrawer: true,
  color: '#66c013',
};

function buildCodeFromName(name: string) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export default function PaymentMethodsManager() {
  const [rows, setRows] = useState<PaymentMethod[]>(
    () => (getPosCatalogCache()?.paymentMethods as PaymentMethod[] | undefined) ?? []
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<PaymentMethodForm>(initialForm);
  const [isLoading, setIsLoading] = useState(() => !getPosCatalogCache()?.paymentMethods?.length);

  const fetchRows = async () => {
    const hasCache = Boolean(getPosCatalogCache()?.paymentMethods?.length);
    if (!hasCache) setIsLoading(true);
    try {
      const response = await fetch(`${getPosApiBase()}/payment-methods?_=${Date.now()}`, {
        cache: 'no-store',
        headers: { ...getPosUserAuthHeaders() },
      });
      const json = await response.json();
      if (!response.ok) {
        throw new Error(apiErrorMessage(json, `Falha ao carregar meios de pagamento (${response.status})`));
      }
      const data = unwrapApiSuccessPayload<PaymentMethod[]>(json);
      const next = Array.isArray(data) ? data : [];
      setRows(next);
      patchPosCatalogCache({ paymentMethods: next as any });
    } catch (error) {
      console.error('Error fetching payment methods:', error);
      if (!getPosCatalogCache()?.paymentMethods?.length) setRows([]);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void fetchRows();
  }, []);

  const orderedRows = useMemo(
    () => [...rows].sort((a, b) => a.position - b.position || a.name.localeCompare(b.name)),
    [rows]
  );

  const openNewModal = () => {
    const nextPosition =
      rows.reduce((max, row) => Math.max(max, Number(row.position) || 0), 0) + 1;
    setEditingId(null);
    setForm({
      ...initialForm,
      position: Math.max(1, nextPosition),
      color: getPaymentMethodColor(''),
    });
    setIsModalOpen(true);
  };

  const openEditModal = () => {
    if (!selectedId) return;
    const selected = rows.find((row) => row.id === selectedId);
    if (!selected) return;
    setEditingId(selectedId);
    setForm({
      name: selected.name,
      code: selected.code,
      shortcut: selected.shortcut ?? '',
      position: selected.position,
      enabled: selected.enabled,
      quickPayment: selected.quickPayment,
      requiredCustomer: selected.requiredCustomer,
      allowChange: selected.allowChange,
      markAsPaid: selected.markAsPaid,
      printReceipt: selected.printReceipt,
      openCashDrawer: selected.openCashDrawer,
      color: selected.color || getPaymentMethodColor(selected.code || selected.name),
    });
    setIsModalOpen(true);
  };

  const handleDelete = () => {
    if (!selectedId) return;
    void (async () => {
      const response = await fetch(`${getPosApiBase()}/payment-methods/${selectedId}`, {
        method: 'DELETE',
        headers: { ...getPosUserAuthHeaders() },
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        window.alert(apiErrorMessage(data, 'Falha ao apagar meio de pagamento.'));
        return;
      }
      setSelectedId(null);
      await fetchRows();
    })();
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    void (async () => {
      const resolvedCode = form.code.trim().toLowerCase() || buildCodeFromName(form.name);
      if (!resolvedCode) return;
      const payload = {
        ...form,
        name: form.name.trim(),
        code: resolvedCode,
        shortcut: form.shortcut.trim(),
        position: Math.max(1, Number(form.position) || 1),
        color: form.color.trim() || getPaymentMethodColor(resolvedCode || form.name),
      };
      const url = editingId ? `${getPosApiBase()}/payment-methods/${editingId}` : `${getPosApiBase()}/payment-methods`;
      const method = editingId ? 'PUT' : 'POST';
      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...getPosUserAuthHeaders(),
        },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        window.alert(apiErrorMessage(data, 'Falha ao salvar meio de pagamento.'));
        return;
      }

      setIsModalOpen(false);
      setEditingId(null);
      setForm(initialForm);
      await fetchRows();
    })();
  };

  return (
    <div className="flex flex-col h-full bg-pos-surface text-zinc-300 overflow-hidden">
      <div className="h-16 bg-pos-surface border-b border-pos-border flex items-center px-2 gap-1 overflow-x-auto no-scrollbar">
        <ManagementToolbarButton icon={<RotateCcw size={20} />} label="Atualizar" onClick={() => void fetchRows()} />
        <ManagementToolbarButton icon={<Plus size={20} />} label="Novo" onClick={openNewModal} />
        <ManagementToolbarButton icon={<Edit3 size={20} />} label="Editar" onClick={openEditModal} />
        <ManagementToolbarButton icon={<Trash2 size={20} />} label="Eliminar" onClick={handleDelete} />
        <ManagementToolbarButton icon={<HelpCircle size={20} />} label="Ajuda" />
      </div>

      <div className="flex-1 overflow-auto custom-scrollbar bg-pos-bg">
        <table className="w-full table-fixed border-collapse text-left text-xs [&_th]:border [&_td]:border [&_th]:border-pos-border/55 [&_td]:border-pos-border/55">
          <thead className="sticky top-0 z-10 bg-pos-card">
            <tr className="border-b border-[#0001fb]/70">
              <th className="px-3 py-2 text-xs font-bold text-zinc-300">Nome</th>
              <th className="px-3 py-2 text-xs font-bold text-zinc-300">Posição</th>
              <th className="px-3 py-2 text-xs font-bold text-zinc-300">Código</th>
              <th className="px-3 py-2 text-center text-xs font-bold text-zinc-300">Habilitado</th>
              <th className="px-3 py-2 text-center text-xs font-bold text-zinc-300">Pagamento rápido</th>
              <th className="px-3 py-2 text-center text-xs font-bold text-zinc-300">Cliente obrigatório</th>
              <th className="px-3 py-2 text-center text-xs font-bold text-zinc-300">Mudança permitida</th>
              <th className="px-3 py-2 text-center text-xs font-bold text-zinc-300">Marcar transação como paga</th>
              <th className="px-3 py-2 text-center text-xs font-bold text-zinc-300">Imprimir recibo</th>
              <th className="px-3 py-2 text-center text-xs font-bold text-zinc-300">Tecla de atalho</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={10} className="py-20 text-center text-xs text-zinc-600 italic">
                  Carregando meios de pagamento...
                </td>
              </tr>
            ) : orderedRows.length === 0 ? (
              <tr>
                <td colSpan={10} className="py-20 text-center text-xs text-zinc-600 italic">
                  Nenhum meio de pagamento cadastrado
                </td>
              </tr>
            ) : (
              orderedRows.map((row, i) => (
                <tr
                  key={row.id}
                  onClick={() => setSelectedId(row.id)}
                  className={`transition-colors cursor-pointer ${
                    selectedId === row.id ? 'bg-[var(--pos-brand-selected-bg)]' : i % 2 ? 'bg-pos-surface' : 'bg-pos-row'
                  } hover:bg-[var(--pos-brand-hover-bg)]`}
                >
                  <td className="px-3 py-2 text-xs text-zinc-200 truncate">
                    <span className="inline-flex items-center gap-2">
                      <span
                        className="inline-block h-3 w-3 shrink-0 rounded-full border border-black/10"
                        style={{ backgroundColor: row.color || getPaymentMethodColor(row.code || row.name) }}
                      />
                      {row.name}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-xs text-zinc-400">{row.position}</td>
                  <td className="px-3 py-2 text-xs text-zinc-400 truncate">{row.code || '-'}</td>
                  <td className="px-3 py-2 text-xs text-center text-zinc-300">{row.enabled ? '✓' : ''}</td>
                  <td className="px-3 py-2 text-xs text-center text-zinc-300">{row.quickPayment ? '✓' : ''}</td>
                  <td className="px-3 py-2 text-xs text-center text-zinc-300">{row.requiredCustomer ? '✓' : ''}</td>
                  <td className="px-3 py-2 text-xs text-center text-zinc-300">{row.allowChange ? '✓' : ''}</td>
                  <td className="px-3 py-2 text-xs text-center text-zinc-300">{row.markAsPaid ? '✓' : ''}</td>
                  <td className="px-3 py-2 text-xs text-center text-zinc-300">{row.printReceipt ? '✓' : ''}</td>
                  <td className="px-3 py-2 text-xs text-zinc-400">{row.shortcut || '-'}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {isModalOpen && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 pos-modal-overlay"
          onClick={() => setIsModalOpen(false)}
        >
          <div
            className="bg-pos-surface border border-pos-border rounded w-full max-w-2xl overflow-hidden flex flex-col max-h-[94vh]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-4 flex items-center justify-between bg-pos-surface border-b border-pos-border">
              <h3 className="text-xl text-zinc-200">Novo tipo de pagamento</h3>
              <ArrowRight size={24} className="text-zinc-200" />
            </div>

            <form id="payment-method-form" onSubmit={handleSave} className="flex-1 overflow-y-auto p-6 space-y-5 custom-scrollbar bg-pos-surface">
              <div className="max-w-xl space-y-5">
                <Field
                  label="Nome"
                  value={form.name}
                  required
                  onChange={(value) =>
                    setForm((prev) => ({
                      ...prev,
                      name: value,
                      color: getPaymentMethodColor(prev.code || value),
                    }))
                  }
                />
                <Field
                  label="Código"
                  value={form.code}
                  onChange={(value) =>
                    setForm((prev) => ({
                      ...prev,
                      code: value,
                      color: getPaymentMethodColor(value || prev.name),
                    }))
                  }
                  short
                />
                <Field
                  label="Tecla de atalho"
                  value={form.shortcut}
                  onChange={(value) => setForm((prev) => ({ ...prev, shortcut: value }))}
                  short
                />

                <div className="space-y-2">
                  <label className="text-xs text-zinc-400 mr-2">Posição</label>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setForm((prev) => ({ ...prev, position: Math.max(1, prev.position - 1) }))}
                      className="h-8 w-8 rounded border border-pos-border text-zinc-300 hover:bg-zinc-800/70 transition-colors"
                    >
                      -
                    </button>
                    <input
                      type="number"
                      min={1}
                      value={form.position}
                      onChange={(e) => setForm((prev) => ({ ...prev, position: Math.max(1, Number(e.target.value) || 1) }))}
                      className="w-16 bg-pos-surface border border-pos-border rounded px-2 py-1.5 text-sm text-white focus:border-zinc-500 outline-none transition-colors text-center"
                    />
                    <button
                      type="button"
                      onClick={() => setForm((prev) => ({ ...prev, position: prev.position + 1 }))}
                      className="h-8 w-8 rounded border border-pos-border text-zinc-300 hover:bg-zinc-800/70 transition-colors"
                    >
                      +
                    </button>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-xs text-zinc-400 mr-2">Cor no POS</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={form.color || '#66c013'}
                      onChange={(e) => setForm((prev) => ({ ...prev, color: e.target.value }))}
                      className="h-9 w-12 cursor-pointer rounded border border-pos-border bg-pos-surface p-0.5"
                    />
                    <span className="text-xs text-zinc-500">{form.color || getPaymentMethodColor(form.code || form.name)}</span>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-x-8 gap-y-3 pt-2">
                  <PosSwitch
                    label="Habilitado"
                    checked={form.enabled}
                    onChange={() => setForm((prev) => ({ ...prev, enabled: !prev.enabled }))}
                  />
                  <PosSwitch
                    label="Pagamento rápido"
                    checked={form.quickPayment}
                    onChange={() => setForm((prev) => ({ ...prev, quickPayment: !prev.quickPayment }))}
                  />
                  <PosSwitch
                    label="Cliente obrigatório"
                    checked={form.requiredCustomer}
                    onChange={() => setForm((prev) => ({ ...prev, requiredCustomer: !prev.requiredCustomer }))}
                  />
                  <PosSwitch
                    label="Imprimir recibo"
                    checked={form.printReceipt}
                    onChange={() => setForm((prev) => ({ ...prev, printReceipt: !prev.printReceipt }))}
                  />
                  <PosSwitch
                    label="Mudança permitida"
                    checked={form.allowChange}
                    onChange={() => setForm((prev) => ({ ...prev, allowChange: !prev.allowChange }))}
                  />
                  <PosSwitch
                    label="Marcar transação como paga"
                    checked={form.markAsPaid}
                    onChange={() => setForm((prev) => ({ ...prev, markAsPaid: !prev.markAsPaid }))}
                  />
                  <PosSwitch
                    label="Abrir a gaveta do dinheiro"
                    checked={form.openCashDrawer}
                    onChange={() => setForm((prev) => ({ ...prev, openCashDrawer: !prev.openCashDrawer }))}
                  />
                </div>
              </div>
            </form>

            <div className="p-4 bg-pos-surface border-t border-pos-border flex justify-end gap-3">
              <button
                type="submit"
                form="payment-method-form"
                className="flex items-center gap-2 px-6 py-2 bg-zinc-800/50 border border-pos-border hover:bg-zinc-700 text-zinc-400 hover:text-white text-xs font-medium rounded transition-colors"
              >
                <Check size={16} />
                Salvar
              </button>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="flex items-center gap-2 px-6 py-2 bg-zinc-800/50 border border-pos-border hover:bg-zinc-700 text-zinc-400 hover:text-white text-xs font-medium rounded transition-colors"
              >
                <X size={16} />
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  short,
  required,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  short?: boolean;
  required?: boolean;
}) {
  return (
    <div className="space-y-2">
      <label className="text-xs text-zinc-400 mr-2">{label}</label>
      <input
        type="text"
        required={required}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        className={`${short ? 'w-24 min-w-[160px]' : 'w-full'} bg-pos-surface border ${
          required && !value.trim() ? 'border-red-900/50' : 'border-pos-border'
        } rounded px-3 py-1.5 text-sm text-white focus:border-zinc-500 outline-none transition-colors`}
      />
    </div>
  );
}
