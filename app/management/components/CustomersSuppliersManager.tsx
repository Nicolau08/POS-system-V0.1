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
  Loader2,
} from 'lucide-react';

import { getPosApiBase, getPosUserAuthHeaders } from '@/lib/apiBase';
import { unwrapApiSuccessPayload } from '@/lib/apiResponse';
import { getPosCatalogCache, patchPosCatalogCache } from '@/lib/posSessionCache';
import { ManagementToolbarButton } from '@/components/ManagementToolbarButton';
import {
  CustomerSupplierFormModal,
  CUSTOMER_SUPPLIER_EMPTY_FORM,
  type CustomerSupplierFormValues,
} from '@/app/management/components/CustomerSupplierFormModal';

type CustomerRow = {
  id: string;
  cloud_id?: string | null;
  name: string;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
};

export default function CustomersSuppliersManager() {
  const [rows, setRows] = useState<CustomerRow[]>(
    () => (getPosCatalogCache()?.customers as CustomerRow[] | undefined) ?? []
  );
  const [metaById, setMetaById] = useState<
    Record<string, { active: boolean; isCustomer: boolean; taxExempt: boolean; code?: string }>
  >({});
  const [loading, setLoading] = useState(() => !getPosCatalogCache()?.customers?.length);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editing, setEditing] = useState<CustomerRow | null>(null);
  const [formDefaults, setFormDefaults] = useState<Partial<CustomerSupplierFormValues>>(CUSTOMER_SUPPLIER_EMPTY_FORM);

  const fetchRows = async () => {
    const hasCache = Boolean(getPosCatalogCache()?.customers?.length);
    if (!hasCache) setLoading(true);
    try {
      const response = await fetch(`${getPosApiBase()}/clientes`, {
        headers: { ...getPosUserAuthHeaders() },
      });
      const data = unwrapApiSuccessPayload<any[]>(await response.json());
      const next = Array.isArray(data) ? data : [];
      setRows(next);
      patchPosCatalogCache({ customers: next as any });
    } catch {
      if (!getPosCatalogCache()?.customers?.length) setRows([]);
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
    setFormDefaults(CUSTOMER_SUPPLIER_EMPTY_FORM);
    setIsModalOpen(true);
  };

  const openEditModal = () => {
    if (!selectedId) return;
    const selected = rows.find((r) => r.id === selectedId);
    if (!selected) return;
    setEditing(selected);
    setFormDefaults({
      ...CUSTOMER_SUPPLIER_EMPTY_FORM,
      name: selected.name || '',
      code: metaById[selected.id]?.code || '',
      phone: selected.phone || '',
      email: selected.email || '',
      streetName: selected.address || '',
      active: metaById[selected.id]?.active ?? true,
      isCustomer: metaById[selected.id]?.isCustomer ?? true,
      taxExempt: metaById[selected.id]?.taxExempt ?? false,
    });
    setIsModalOpen(true);
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
                  <td className="px-3 py-2 text-xs text-zinc-400 truncate">
                    {metaById[row.id]?.code || '---'}
                  </td>
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

      <CustomerSupplierFormModal
        isOpen={isModalOpen}
        editingId={editing?.id ?? null}
        initialValues={formDefaults}
        onClose={() => {
          setIsModalOpen(false);
          setEditing(null);
        }}
        onSaved={(saved) => {
          setMetaById((prev) => ({
            ...prev,
            [saved.id]: {
              active: saved.active,
              isCustomer: saved.isCustomer,
              taxExempt: saved.taxExempt,
              code: saved.code,
            },
          }));
          void fetchRows();
        }}
      />
    </div>
  );
}
