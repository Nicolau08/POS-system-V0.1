'use client';

import React, { useEffect, useMemo, useState } from 'react';
import {
  RotateCcw,
  Plus,
  Edit3,
  Trash2,
  Download,
  Upload,
  HelpCircle,
  Search,
  Check,
  X,
  Loader2,
} from 'lucide-react';

import { getPosApiBase, getPosUserAuthHeaders } from '@/lib/apiBase';
import { unwrapApiSuccessPayload } from '@/lib/apiResponse';
import PosSelect from '@/components/PosSelect';
import { PosSwitch } from '@/components/PosSwitch';
import { ManagementToolbarButton } from '@/components/ManagementToolbarButton';

type CustomerRow = {
  id: string;
  cloud_id?: string | null;
  name: string;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
};

type CustomerForm = {
  name: string;
  code: string;
  taxId: string;
  streetName: string;
  buildingNumber: string;
  additionalStreetName: string;
  plotIdentification: string;
  district: string;
  city: string;
  stateProvince: string;
  country: string;
  phone: string;
  email: string;
  active: boolean;
  isCustomer: boolean;
  taxExempt: boolean;
};

const initialForm: CustomerForm = {
  name: '',
  code: '',
  taxId: '',
  streetName: '',
  buildingNumber: '',
  additionalStreetName: '',
  plotIdentification: '',
  district: '',
  city: '',
  stateProvince: '',
  country: 'Moçambique',
  phone: '',
  email: '',
  active: true,
  isCustomer: true,
  taxExempt: false,
};

export default function CustomersSuppliersManager() {
  const [rows, setRows] = useState<CustomerRow[]>([]);
  const [metaById, setMetaById] = useState<Record<string, { active: boolean; isCustomer: boolean; taxExempt: boolean }>>(
    {}
  );
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editing, setEditing] = useState<CustomerRow | null>(null);
  const [form, setForm] = useState<CustomerForm>(initialForm);
  const [activeTab, setActiveTab] = useState<'geral' | 'descontos' | 'fidelidade' | 'termos'>('geral');

  const fetchRows = async () => {
    setLoading(true);
    try {
      const response = await fetch(`${getPosApiBase()}/clientes`, {
        headers: { ...getPosUserAuthHeaders() },
      });
      const data = unwrapApiSuccessPayload<any[]>(await response.json());
      setRows(Array.isArray(data) ? data : []);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchRows();
  }, []);

  useEffect(() => {
    try {
      const raw = localStorage.getItem('customers-manager-meta');
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        setMetaById(parsed);
      }
    } catch {
      // ignore invalid local data
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem('customers-manager-meta', JSON.stringify(metaById));
    } catch {
      // ignore persistence failures
    }
  }, [metaById]);

  const filtered = useMemo(() => {
    const q = searchQuery.toLowerCase();
    return rows.filter((r) => r.name.toLowerCase().includes(q) || String(r.phone || '').includes(searchQuery));
  }, [rows, searchQuery]);

  const openNewModal = () => {
    setEditing(null);
    setForm(initialForm);
    setActiveTab('geral');
    setIsModalOpen(true);
  };

  const openEditModal = () => {
    if (!selectedId) return;
    const selected = rows.find((r) => r.id === selectedId);
    if (!selected) return;
    setEditing(selected);
    setForm({
      ...initialForm,
      name: selected.name || '',
      phone: selected.phone || '',
      email: selected.email || '',
      streetName: selected.address || '',
      active: metaById[selected.id]?.active ?? true,
      isCustomer: metaById[selected.id]?.isCustomer ?? true,
      taxExempt: metaById[selected.id]?.taxExempt ?? false,
    });
    setActiveTab('geral');
    setIsModalOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim() || !form.phone.trim()) return;

    const payload = {
      name: form.name.trim(),
      phone: form.phone.trim(),
      email: form.email.trim() || null,
      address: form.streetName.trim() || null,
    };

    const url = editing ? `${getPosApiBase()}/clientes/${editing.id}` : `${getPosApiBase()}/clientes`;
    const method = editing ? 'PUT' : 'POST';
    const response = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!response.ok) return;
    const rawResult = await response.json().catch(() => ({}));
    const result = unwrapApiSuccessPayload<any>(rawResult);
    const savedId = editing?.id ?? String(result?.id ?? '');
    if (savedId) {
      setMetaById((prev) => ({
        ...prev,
        [savedId]: {
          active: form.active,
          isCustomer: form.isCustomer,
          taxExempt: form.taxExempt,
        },
      }));
    }

    setIsModalOpen(false);
    setEditing(null);
    setForm(initialForm);
    await fetchRows();
  };

  const handleDelete = async () => {
    if (!selectedId) return;
    const response = await fetch(`${getPosApiBase()}/clientes/${selectedId}`, {
      method: 'DELETE',
      headers: { ...getPosUserAuthHeaders() },
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      const message = String(
        (data?.error && typeof data.error === 'object' ? data.error.message : null) ??
          data?.error ??
          data?.message ??
          'Não é possível apagar este cliente.',
      );
      window.alert(message);
      return;
    }
    setSelectedId(null);
    await fetchRows();
  };

  return (
    <div className="flex flex-col h-full bg-[#1a1a1a] text-zinc-300 overflow-hidden">
      <div className="h-16 bg-[#1a1a1a] border-b border-zinc-800 flex items-center px-2 gap-1 overflow-x-auto no-scrollbar">
        <ManagementToolbarButton icon={<RotateCcw size={20} />} label="Atualizar" onClick={() => void fetchRows()} />
        <ManagementToolbarButton icon={<Plus size={20} />} label="Adicionar" onClick={openNewModal} />
        <ManagementToolbarButton icon={<Edit3 size={20} />} label="Editar" onClick={openEditModal} />
        <ManagementToolbarButton icon={<Trash2 size={20} />} label="Deletar" onClick={() => void handleDelete()} />
        <ManagementToolbarButton icon={<Download size={20} />} label="Importar" />
        <ManagementToolbarButton icon={<Upload size={20} />} label="Exportar" />
        <ManagementToolbarButton icon={<HelpCircle size={20} />} label="Ajuda" />
      </div>

      <div className="h-10 bg-[#111] border-b border-zinc-800/50 flex items-center justify-between px-4">
        <div className="flex items-center gap-2 flex-1 max-w-md">
          <div className="flex items-center gap-2 px-2 py-1 bg-[#1a1a1a] border border-zinc-800 rounded flex-1">
            <Search size={14} className="text-zinc-500" />
            <input
              type="text"
              placeholder="Procurar clientes & fornecedores"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="bg-transparent border-none outline-none text-xs text-zinc-200 w-full"
            />
          </div>
        </div>
        <div className="text-[10px] text-zinc-500 font-bold capitalize tracking-wider">
          Registos: <span className="text-white">{filtered.length}</span>
        </div>
      </div>

      <div className="flex-1 overflow-auto custom-scrollbar bg-[#0f0f0f]">
        <table className="w-full table-fixed border-collapse text-left text-xs [&_th]:border [&_td]:border [&_th]:border-zinc-800/55 [&_td]:border-zinc-800/55">
          <thead className="sticky top-0 z-10 bg-[#141414]">
            <tr className="border-b border-[#0001fb]/70">
              <th className="px-3 py-2 text-xs font-bold text-zinc-300">Código</th>
              <th className="px-3 py-2 text-xs font-bold text-zinc-300">Nome</th>
              <th className="px-3 py-2 text-xs font-bold text-zinc-300">NUIT</th>
              <th className="px-3 py-2 text-xs font-bold text-zinc-300">Endereço</th>
              <th className="px-3 py-2 text-xs font-bold text-zinc-300">País</th>
              <th className="px-3 py-2 text-xs font-bold text-zinc-300">Telefone</th>
              <th className="px-3 py-2 text-xs font-bold text-zinc-300">Email</th>
              <th className="px-3 py-2 text-center text-xs font-bold text-zinc-300">Ativo</th>
              <th className="px-3 py-2 text-center text-xs font-bold text-zinc-300">Cliente</th>
              <th className="px-3 py-2 text-center text-xs font-bold text-zinc-300">Tax exc.</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={10} className="py-20 text-center">
                  <div className="flex items-center justify-center gap-2 text-zinc-500 text-xs">
                    <Loader2 size={16} className="animate-spin" />
                    Carregando clientes...
                  </div>
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={10} className="py-20 text-center text-xs text-zinc-600 italic">
                  Nenhum cliente encontrado
                </td>
              </tr>
            ) : (
              filtered.map((row, i) => (
                <tr
                  key={row.id}
                  onClick={() => setSelectedId(row.id)}
                  className={`transition-colors cursor-pointer ${
                    selectedId === row.id ? 'bg-[var(--pos-brand-selected-bg)]' : i % 2 ? 'bg-[#171717]' : 'bg-[#1d1d1d]'
                  } hover:bg-[var(--pos-brand-hover-bg)]`}
                >
                  <td className="px-3 py-2 text-xs text-zinc-400 truncate">---</td>
                  <td className="px-3 py-2 text-xs text-zinc-200 truncate">{row.name}</td>
                  <td className="px-3 py-2 text-xs text-zinc-400 truncate">(none)</td>
                  <td className="px-3 py-2 text-xs text-zinc-400 truncate">{row.address || '(none)'}</td>
                  <td className="px-3 py-2 text-xs text-zinc-400 truncate">Moçambique</td>
                  <td className="px-3 py-2 text-xs text-zinc-400 truncate">{row.phone || '(none)'}</td>
                  <td className="px-3 py-2 text-xs text-zinc-400 truncate">{row.email || '(none)'}</td>
                  <td className="px-3 py-2 text-center text-xs text-zinc-300">{metaById[row.id]?.active ?? true ? '✓' : ''}</td>
                  <td className="px-3 py-2 text-center text-xs text-zinc-300">{metaById[row.id]?.isCustomer ?? true ? '✓' : ''}</td>
                  <td className="px-3 py-2 text-center text-xs text-zinc-300">{metaById[row.id]?.taxExempt ? '✓' : ''}</td>
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
            className="bg-[#1a1a1a] border border-zinc-800 rounded w-full max-w-lg overflow-hidden flex flex-col max-h-[90vh]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-4 flex items-center bg-[#1a1a1a]">
              <h3 className="text-xl text-zinc-200">
                {editing ? 'Editar cliente / fornecedor' : 'Novo cliente / fornecedor'}
              </h3>
            </div>

            <div className="flex border-b border-[#0001fb]">
              <TabButton label="Geral" active={activeTab === 'geral'} onClick={() => setActiveTab('geral')} />
              <TabButton label="Descontos" active={activeTab === 'descontos'} onClick={() => setActiveTab('descontos')} />
              <TabButton
                label="Fidelidade"
                active={activeTab === 'fidelidade'}
                onClick={() => setActiveTab('fidelidade')}
              />
              <TabButton label="Pagamento" active={activeTab === 'termos'} onClick={() => setActiveTab('termos')} />
            </div>

            <form id="customer-form" onSubmit={handleSave} className="flex-1 overflow-y-auto p-6 space-y-5 custom-scrollbar bg-[#1a1a1a]">
              {activeTab !== 'geral' ? (
                <div className="py-10 text-center text-zinc-500 text-sm">Sem configuração nesta aba.</div>
              ) : (
                <div className="space-y-5">
                  <Field label="Nome" required value={form.name} onChange={(v) => setForm({ ...form, name: v })} />
                  <Field label="Código" value={form.code} onChange={(v) => setForm({ ...form, code: v })} short />
                  <Field label="NUIT" value={form.taxId} onChange={(v) => setForm({ ...form, taxId: v })} />
                  <Field label="Street name" value={form.streetName} onChange={(v) => setForm({ ...form, streetName: v })} />
                  <Field
                    label="Building number"
                    value={form.buildingNumber}
                    onChange={(v) => setForm({ ...form, buildingNumber: v })}
                    short
                  />
                  <Field
                    label="Additional street name"
                    value={form.additionalStreetName}
                    onChange={(v) => setForm({ ...form, additionalStreetName: v })}
                  />
                  <Field
                    label="Plot identification"
                    value={form.plotIdentification}
                    onChange={(v) => setForm({ ...form, plotIdentification: v })}
                  />
                  <Field label="District" value={form.district} onChange={(v) => setForm({ ...form, district: v })} />
                  <Field label="Cidade" value={form.city} onChange={(v) => setForm({ ...form, city: v })} />
                  <Field
                    label="State / Province"
                    value={form.stateProvince}
                    onChange={(v) => setForm({ ...form, stateProvince: v })}
                  />

                  <div className="space-y-2">
                    <label className="text-xs text-zinc-400">País</label>
                    <PosSelect
                      value={form.country}
                      onChange={(v) => setForm({ ...form, country: v })}
                      size="md"
                      options={[{ value: 'Moçambique', label: 'Moçambique' }]}
                    />
                  </div>

                  <Field label="Telefone" required value={form.phone} onChange={(v) => setForm({ ...form, phone: v })} />
                  <Field label="Email" value={form.email} onChange={(v) => setForm({ ...form, email: v })} />

                  <div className="flex flex-wrap items-center gap-x-8 gap-y-2 pt-2">
                    <PosSwitch
                      label="Ativo"
                      checked={form.active}
                      onChange={(active) => setForm({ ...form, active })}
                    />
                    <PosSwitch
                      label="Cliente"
                      checked={form.isCustomer}
                      onChange={(isCustomer) => setForm({ ...form, isCustomer })}
                    />
                  </div>
                </div>
              )}
            </form>

            <div className="p-4 bg-[#1a1a1a] border-t border-zinc-800 flex justify-end gap-3">
              <button
                type="submit"
                form="customer-form"
                className="flex items-center gap-2 px-6 py-2 rounded bg-[#0001fb] text-xs font-medium text-white transition-colors hover:bg-[#1a1bff]"
              >
                <Check size={16} />
                Salvar
              </button>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="flex items-center gap-2 px-6 py-2 rounded border border-zinc-700 bg-transparent text-xs font-medium text-zinc-300 transition-colors hover:border-[#0001fb] hover:bg-[var(--pos-brand-hover-bg)] hover:text-white"
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

function TabButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative flex-1 py-2 text-[11px] font-medium text-center transition-colors ${
        active ? 'bg-[#0001fb] text-white' : 'text-zinc-400 hover:text-[#0001fb]'
      }`}
    >
      {label}
      {active && (
        <span className="absolute left-1/2 -bottom-[6px] -translate-x-1/2 w-0 h-0 border-l-[6px] border-r-[6px] border-t-[6px] border-l-transparent border-r-transparent border-t-[#0001fb]" />
      )}
    </button>
  );
}

function Field({
  label,
  value,
  onChange,
  required,
  short,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  short?: boolean;
}) {
  return (
    <div className="space-y-2">
      <label className="text-xs text-zinc-400">{label}</label>
      <input
        type="text"
        required={required}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`${short ? 'w-24' : 'w-full'} bg-[#1a1a1a] border ${
          required && !value.trim() ? 'border-red-900/50' : 'border-zinc-800'
        } rounded px-3 py-1.5 text-sm text-white focus:border-blue-500 outline-none transition-colors`}
      />
    </div>
  );
}