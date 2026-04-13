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
  ArrowRight,
  Check,
  X,
  Loader2,
} from 'lucide-react';

import { getPosApiBase } from '@/lib/apiBase';

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
  country: 'Afghanistan',
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
      const response = await fetch(`${getPosApiBase()}/clientes`);
      const data = await response.json();
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
    const result = await response.json().catch(() => ({}));
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
    const response = await fetch(`${getPosApiBase()}/clientes/${selectedId}`, { method: 'DELETE' });
    if (!response.ok) return;
    setSelectedId(null);
    await fetchRows();
  };

  return (
    <div className="flex flex-col h-full bg-[#1a1a1a] text-zinc-300 overflow-hidden">
      <div className="h-16 bg-[#1a1a1a] border-b border-zinc-800 flex items-center px-2 gap-1 overflow-x-auto no-scrollbar">
        <ToolbarButton icon={<RotateCcw size={20} />} label="Atualizar" onClick={() => void fetchRows()} />
        <ToolbarButton icon={<Plus size={20} />} label="Adicionar" onClick={openNewModal} />
        <ToolbarButton icon={<Edit3 size={20} />} label="Editar" onClick={openEditModal} />
        <ToolbarButton icon={<Trash2 size={20} />} label="Deletar" onClick={() => void handleDelete()} />
        <ToolbarButton icon={<Download size={20} />} label="Importar" />
        <ToolbarButton icon={<Upload size={20} />} label="Exportar" />
        <ToolbarButton icon={<HelpCircle size={20} />} label="Ajuda" />
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

      <div className="flex-1 overflow-auto custom-scrollbar bg-[#0a0a0a]">
        <table className="min-w-full text-left border-collapse table-fixed">
          <thead className="sticky top-0 bg-[#141414] z-10">
            <tr className="border-b border-zinc-800">
              <th className="px-3 py-2 text-[10px] font-bold text-zinc-500 capitalize">Código</th>
              <th className="px-3 py-2 text-[10px] font-bold text-zinc-500 capitalize">Nome</th>
              <th className="px-3 py-2 text-[10px] font-bold text-zinc-500 capitalize">NUIT</th>
              <th className="px-3 py-2 text-[10px] font-bold text-zinc-500 capitalize">Endereço</th>
              <th className="px-3 py-2 text-[10px] font-bold text-zinc-500 capitalize">País</th>
              <th className="px-3 py-2 text-[10px] font-bold text-zinc-500 capitalize">Telefone</th>
              <th className="px-3 py-2 text-[10px] font-bold text-zinc-500 capitalize">Email</th>
              <th className="px-3 py-2 text-[10px] font-bold text-zinc-500 capitalize text-center">Ativo</th>
              <th className="px-3 py-2 text-[10px] font-bold text-zinc-500 capitalize text-center">Cliente</th>
              <th className="px-3 py-2 text-[10px] font-bold text-zinc-500 capitalize text-center">Tax exc.</th>
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
                  className={`border-b border-zinc-800/50 transition-colors cursor-pointer ${
                    selectedId === row.id ? 'bg-zinc-800/50' : i % 2 === 0 ? 'bg-[#1a1a1a]' : 'bg-[#141414]'
                  } hover:bg-zinc-800/30`}
                >
                  <td className="px-3 py-1.5 text-xs text-zinc-500 truncate">---</td>
                  <td className="px-3 py-1.5 text-xs text-zinc-200 truncate">{row.name}</td>
                  <td className="px-3 py-1.5 text-xs text-zinc-500 truncate">(none)</td>
                  <td className="px-3 py-1.5 text-xs text-zinc-500 truncate">{row.address || '(none)'}</td>
                  <td className="px-3 py-1.5 text-xs text-zinc-500 truncate">Mozambique</td>
                  <td className="px-3 py-1.5 text-xs text-zinc-500 truncate">{row.phone || '(none)'}</td>
                  <td className="px-3 py-1.5 text-xs text-zinc-500 truncate">{row.email || '(none)'}</td>
                  <td className="px-3 py-1.5 text-xs text-center text-zinc-300">{metaById[row.id]?.active ?? true ? '✓' : ''}</td>
                  <td className="px-3 py-1.5 text-xs text-center text-zinc-300">{metaById[row.id]?.isCustomer ?? true ? '✓' : ''}</td>
                  <td className="px-3 py-1.5 text-xs text-center text-zinc-300">{metaById[row.id]?.taxExempt ? '✓' : ''}</td>
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
            className="bg-[#1a1a1a] border border-zinc-800 rounded w-full max-w-5xl overflow-hidden flex flex-col max-h-[94vh]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-4 flex items-center justify-between bg-[#1a1a1a]">
              <h3 className="text-xl text-zinc-200">Novo cliente / fornecedor</h3>
              <ArrowRight size={24} className="text-zinc-200" />
            </div>

            <div className="flex border-b border-[#00a3e0]">
              <TabButton label="Geral" active={activeTab === 'geral'} onClick={() => setActiveTab('geral')} />
              <TabButton label="Descontos" active={activeTab === 'descontos'} onClick={() => setActiveTab('descontos')} />
              <TabButton
                label="Cartões de fidelidade"
                active={activeTab === 'fidelidade'}
                onClick={() => setActiveTab('fidelidade')}
              />
              <TabButton label="Termos de pagamento" active={activeTab === 'termos'} onClick={() => setActiveTab('termos')} />
            </div>

            <form id="customer-form" onSubmit={handleSave} className="flex-1 overflow-y-auto p-6 custom-scrollbar bg-[#1a1a1a]">
              {activeTab !== 'geral' ? (
                <div className="py-16 text-center text-zinc-500 text-sm">Sem configuração nesta aba.</div>
              ) : (
                <div className="max-w-3xl space-y-3">
                  <h4 className="text-4xl font-light text-zinc-100 mb-3">Informações gerais</h4>
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

                  <div className="space-y-1">
                    <label className="text-[30px] font-light text-zinc-100">País</label>
                    <div className="relative">
                      <select
                        value={form.country}
                        onChange={(e) => setForm({ ...form, country: e.target.value })}
                        className="w-full bg-[#1a1a1a] border border-zinc-700 rounded px-3 py-1.5 text-sm text-white focus:border-zinc-500 outline-none transition-colors appearance-none"
                      >
                        <option>Afghanistan</option>
                        <option>Mozambique</option>
                        <option>Portugal</option>
                      </select>
                      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500">▼</span>
                    </div>
                  </div>

                  <Field label="Telefone" required value={form.phone} onChange={(v) => setForm({ ...form, phone: v })} />
                  <Field label="Email" value={form.email} onChange={(v) => setForm({ ...form, email: v })} />

                  <ToggleLine label="Ativo" checked={form.active} onToggle={() => setForm({ ...form, active: !form.active })} />
                  <ToggleLine
                    label="Cliente"
                    checked={form.isCustomer}
                    onToggle={() => setForm({ ...form, isCustomer: !form.isCustomer })}
                  />
                </div>
              )}
            </form>

            <div className="p-4 bg-[#1a1a1a] border-t border-zinc-800 flex justify-end gap-3">
              <button
                type="submit"
                form="customer-form"
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

function TabButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-5 py-2 text-[11px] font-medium transition-colors ${
        active ? 'bg-[#00a3e0] text-white' : 'text-zinc-200 hover:text-white'
      }`}
    >
      {label}
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
    <div className="space-y-1">
      <label className="text-xs text-zinc-400">{label}</label>
      <input
        type="text"
        required={required}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`${short ? 'w-1/5 min-w-[180px]' : 'w-full'} bg-[#1a1a1a] border ${
          required && !value.trim() ? 'border-red-900/50' : 'border-zinc-700'
        } rounded px-3 py-1.5 text-sm text-white focus:border-zinc-500 outline-none transition-colors`}
      />
    </div>
  );
}

function ToggleLine({ label, checked, onToggle }: { label: string; checked: boolean; onToggle: () => void }) {
  return (
    <button type="button" onClick={onToggle} className="flex items-center gap-3 pt-2">
      <div className={`w-10 h-5 rounded-sm relative transition-colors ${checked ? 'bg-emerald-500' : 'bg-zinc-600'}`}>
        <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-sm transition-all ${checked ? 'right-0.5' : 'left-0.5'}`} />
      </div>
      <span className="text-xs text-zinc-200">{label}</span>
    </button>
  );
}
