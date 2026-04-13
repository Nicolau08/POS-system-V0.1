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

import { getPosApiBase } from '@/lib/apiBase';

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
};

type PaymentMethodForm = Omit<PaymentMethod, 'id'>;

const defaultRows: PaymentMethod[] = [
  {
    id: '1',
    name: 'DINHEIRO',
    code: 'cash',
    shortcut: '',
    position: 1,
    enabled: true,
    quickPayment: true,
    requiredCustomer: false,
    allowChange: true,
    markAsPaid: true,
    printReceipt: true,
    openCashDrawer: true,
  },
  {
    id: '2',
    name: 'CARTAO',
    code: 'card',
    shortcut: '',
    position: 2,
    enabled: true,
    quickPayment: true,
    requiredCustomer: false,
    allowChange: false,
    markAsPaid: true,
    printReceipt: true,
    openCashDrawer: false,
  },
  {
    id: '3',
    name: 'PIX',
    code: 'pix',
    shortcut: '',
    position: 3,
    enabled: true,
    quickPayment: true,
    requiredCustomer: false,
    allowChange: false,
    markAsPaid: true,
    printReceipt: true,
    openCashDrawer: false,
  },
];

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
  const [rows, setRows] = useState<PaymentMethod[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<PaymentMethodForm>(initialForm);
  const [isLoading, setIsLoading] = useState(true);

  const fetchRows = async () => {
    setIsLoading(true);
    try {
      const response = await fetch(`${getPosApiBase()}/payment-methods`);
      const data = await response.json();
      setRows(Array.isArray(data) ? data : []);
    } catch {
      setRows(defaultRows);
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
    setEditingId(null);
    setForm(initialForm);
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
    });
    setIsModalOpen(true);
  };

  const handleDelete = () => {
    if (!selectedId) return;
    void (async () => {
      const response = await fetch(`${getPosApiBase()}/payment-methods/${selectedId}`, { method: 'DELETE' });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        window.alert(data?.error || 'Falha ao apagar meio de pagamento.');
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
      };
      const url = editingId ? `${getPosApiBase()}/payment-methods/${editingId}` : `${getPosApiBase()}/payment-methods`;
      const method = editingId ? 'PUT' : 'POST';
      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        window.alert(data?.error || 'Falha ao salvar meio de pagamento.');
        return;
      }

      setIsModalOpen(false);
      setEditingId(null);
      setForm(initialForm);
      await fetchRows();
    })();
  };

  return (
    <div className="flex flex-col h-full bg-[#1a1a1a] text-zinc-300 overflow-hidden">
      <div className="h-16 bg-[#1a1a1a] border-b border-zinc-800 flex items-center px-2 gap-1 overflow-x-auto no-scrollbar">
        <ToolbarButton icon={<RotateCcw size={20} />} label="Atualizar" onClick={() => void fetchRows()} />
        <ToolbarButton icon={<Plus size={20} />} label="Novo tipo de pagamento" onClick={openNewModal} />
        <ToolbarButton icon={<Edit3 size={20} />} label="Editar" onClick={openEditModal} />
        <ToolbarButton icon={<Trash2 size={20} />} label="Deletar" onClick={handleDelete} />
        <ToolbarButton icon={<HelpCircle size={20} />} label="Ajuda" />
      </div>

      <div className="flex-1 overflow-auto custom-scrollbar bg-[#0a0a0a]">
        <table className="min-w-full text-left border-collapse table-fixed">
          <thead className="sticky top-0 bg-[#141414] z-10">
            <tr className="border-b border-zinc-800">
              <th className="px-3 py-2 text-[10px] font-bold text-zinc-500 capitalize">Nome</th>
              <th className="px-3 py-2 text-[10px] font-bold text-zinc-500 capitalize">Posição</th>
              <th className="px-3 py-2 text-[10px] font-bold text-zinc-500 capitalize">Código</th>
              <th className="px-3 py-2 text-[10px] font-bold text-zinc-500 capitalize text-center">Habilitado</th>
              <th className="px-3 py-2 text-[10px] font-bold text-zinc-500 capitalize text-center">Pagamento rápido</th>
              <th className="px-3 py-2 text-[10px] font-bold text-zinc-500 capitalize text-center">Cliente obrigatório</th>
              <th className="px-3 py-2 text-[10px] font-bold text-zinc-500 capitalize text-center">Mudança permitida</th>
              <th className="px-3 py-2 text-[10px] font-bold text-zinc-500 capitalize text-center">Marcar transação como paga</th>
              <th className="px-3 py-2 text-[10px] font-bold text-zinc-500 capitalize text-center">Imprimir recibo</th>
              <th className="px-3 py-2 text-[10px] font-bold text-zinc-500 capitalize text-center">Tecla de atalho</th>
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
                  className={`border-b border-zinc-800/50 transition-colors cursor-pointer ${
                    selectedId === row.id ? 'bg-zinc-800/50' : i % 2 === 0 ? 'bg-[#1a1a1a]' : 'bg-[#141414]'
                  } hover:bg-zinc-800/30`}
                >
                  <td className="px-3 py-1.5 text-xs text-zinc-200 truncate">{row.name}</td>
                  <td className="px-3 py-1.5 text-xs text-zinc-400">{row.position}</td>
                  <td className="px-3 py-1.5 text-xs text-zinc-400 truncate">{row.code || '-'}</td>
                  <td className="px-3 py-1.5 text-xs text-center text-zinc-300">{row.enabled ? '✓' : ''}</td>
                  <td className="px-3 py-1.5 text-xs text-center text-zinc-300">{row.quickPayment ? '✓' : ''}</td>
                  <td className="px-3 py-1.5 text-xs text-center text-zinc-300">{row.requiredCustomer ? '✓' : ''}</td>
                  <td className="px-3 py-1.5 text-xs text-center text-zinc-300">{row.allowChange ? '✓' : ''}</td>
                  <td className="px-3 py-1.5 text-xs text-center text-zinc-300">{row.markAsPaid ? '✓' : ''}</td>
                  <td className="px-3 py-1.5 text-xs text-center text-zinc-300">{row.printReceipt ? '✓' : ''}</td>
                  <td className="px-3 py-1.5 text-xs text-zinc-400">{row.shortcut || '-'}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {isModalOpen && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
          onClick={() => setIsModalOpen(false)}
        >
          <div
            className="bg-[#1a1a1a] border border-zinc-800 rounded w-full max-w-2xl overflow-hidden flex flex-col max-h-[94vh]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-4 flex items-center justify-between bg-[#1a1a1a] border-b border-zinc-800">
              <h3 className="text-xl text-zinc-200">Novo tipo de pagamento</h3>
              <ArrowRight size={24} className="text-zinc-200" />
            </div>

            <form id="payment-method-form" onSubmit={handleSave} className="flex-1 overflow-y-auto p-6 custom-scrollbar bg-[#1a1a1a]">
              <div className="max-w-xl space-y-3">
                <Field label="Nome" value={form.name} required onChange={(value) => setForm((prev) => ({ ...prev, name: value }))} />
                <Field label="Código" value={form.code} onChange={(value) => setForm((prev) => ({ ...prev, code: value }))} short />
                <Field
                  label="Tecla de atalho"
                  value={form.shortcut}
                  onChange={(value) => setForm((prev) => ({ ...prev, shortcut: value }))}
                  short
                />

                <div className="space-y-1">
                  <label className="text-xs text-zinc-400">Posição</label>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setForm((prev) => ({ ...prev, position: Math.max(1, prev.position - 1) }))}
                      className="h-8 w-8 rounded border border-zinc-700 text-zinc-300 hover:bg-zinc-800/70 transition-colors"
                    >
                      -
                    </button>
                    <input
                      type="number"
                      min={1}
                      value={form.position}
                      onChange={(e) => setForm((prev) => ({ ...prev, position: Math.max(1, Number(e.target.value) || 1) }))}
                      className="w-16 bg-[#1a1a1a] border border-zinc-700 rounded px-2 py-1.5 text-sm text-white focus:border-zinc-500 outline-none transition-colors text-center"
                    />
                    <button
                      type="button"
                      onClick={() => setForm((prev) => ({ ...prev, position: prev.position + 1 }))}
                      className="h-8 w-8 rounded border border-zinc-700 text-zinc-300 hover:bg-zinc-800/70 transition-colors"
                    >
                      +
                    </button>
                  </div>
                </div>

                <div className="pt-1 space-y-1.5">
                  <ToggleLine label="Habilitado" checked={form.enabled} onToggle={() => setForm((prev) => ({ ...prev, enabled: !prev.enabled }))} />
                  <ToggleLine
                    label="Pagamento rápido"
                    checked={form.quickPayment}
                    onToggle={() => setForm((prev) => ({ ...prev, quickPayment: !prev.quickPayment }))}
                  />
                  <ToggleLine
                    label="Cliente obrigatório"
                    checked={form.requiredCustomer}
                    onToggle={() => setForm((prev) => ({ ...prev, requiredCustomer: !prev.requiredCustomer }))}
                  />
                  <ToggleLine
                    label="Imprimir recibo"
                    checked={form.printReceipt}
                    onToggle={() => setForm((prev) => ({ ...prev, printReceipt: !prev.printReceipt }))}
                  />
                  <ToggleLine
                    label="Mudança permitida"
                    checked={form.allowChange}
                    onToggle={() => setForm((prev) => ({ ...prev, allowChange: !prev.allowChange }))}
                  />
                  <ToggleLine
                    label="Marcar transação como paga"
                    checked={form.markAsPaid}
                    onToggle={() => setForm((prev) => ({ ...prev, markAsPaid: !prev.markAsPaid }))}
                  />
                  <ToggleLine
                    label="Abrir a gaveta do dinheiro"
                    checked={form.openCashDrawer}
                    onToggle={() => setForm((prev) => ({ ...prev, openCashDrawer: !prev.openCashDrawer }))}
                  />
                </div>
              </div>
            </form>

            <div className="p-4 bg-[#1a1a1a] border-t border-zinc-800 flex justify-end gap-3">
              <button
                type="submit"
                form="payment-method-form"
                className="flex items-center gap-2 px-6 py-2 bg-zinc-800/50 border border-zinc-700 hover:bg-zinc-700 text-zinc-400 hover:text-white text-xs font-medium rounded transition-colors"
              >
                <Check size={16} />
                Salvar
              </button>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="flex items-center gap-2 px-6 py-2 bg-zinc-800/50 border border-zinc-700 hover:bg-zinc-700 text-zinc-400 hover:text-white text-xs font-medium rounded transition-colors"
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

function ToolbarButton({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick?: () => void }) {
  return (
    <button onClick={onClick} className="flex flex-col items-center justify-center min-w-[80px] py-2 px-2 rounded transition-all hover:bg-zinc-800 text-zinc-400 group">
      <div className="mb-1 group-hover:scale-110 transition-transform">{icon}</div>
      <span className="text-[11px] font-bold text-center leading-none capitalize tracking-tighter">{label}</span>
    </button>
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
    <div className="space-y-1">
      <label className="text-xs text-zinc-400">{label}</label>
      <input
        type="text"
        required={required}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        className={`${short ? 'w-1/3 min-w-[160px]' : 'w-full'} bg-[#1a1a1a] border ${
          required && !value.trim() ? 'border-red-900/50' : 'border-zinc-700'
        } rounded px-3 py-1.5 text-sm text-white focus:border-zinc-500 outline-none transition-colors`}
      />
    </div>
  );
}

function ToggleLine({ label, checked, onToggle }: { label: string; checked: boolean; onToggle: () => void }) {
  return (
    <button type="button" onClick={onToggle} className="flex items-center gap-3 pt-1">
      <div className={`w-10 h-5 rounded-sm relative transition-colors ${checked ? 'bg-emerald-500' : 'bg-zinc-600'}`}>
        <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-sm transition-all ${checked ? 'right-0.5' : 'left-0.5'}`} />
      </div>
      <span className="text-xs text-zinc-200">{label}</span>
    </button>
  );
}
