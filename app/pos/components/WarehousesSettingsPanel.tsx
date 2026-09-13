'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, Star } from 'lucide-react';
import {
  createWarehouseApi,
  fetchWarehouses,
  setDefaultWarehouseApi,
  updateWarehouseApi,
  type PosWarehouse,
} from '@/lib/services/posService';
import { PosSwitch } from '@/components/PosSwitch';

function DarkInput({
  value,
  onChange,
  placeholder,
  className = '',
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}) {
  return (
    <input
      type="text"
      value={value}
      placeholder={placeholder}
      onChange={(event) => onChange(event.target.value)}
      className={`h-9 w-full rounded border border-zinc-600 bg-pos-surface px-3 text-sm text-white outline-none focus:border-[#0001fb] ${className}`}
    />
  );
}

export function WarehousesSettingsPanel() {
  const [warehouses, setWarehouses] = useState<PosWarehouse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [newName, setNewName] = useState('');
  const [newCode, setNewCode] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editCode, setEditCode] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const rows = await fetchWarehouses();
      setWarehouses(rows);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao carregar armazéns.');
      setWarehouses([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const flash = (text: string) => {
    setMessage(text);
    window.setTimeout(() => setMessage(''), 2200);
  };

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name) {
      setError('Indique o nome do armazém.');
      return;
    }
    setBusyId('create');
    setError('');
    try {
      await createWarehouseApi({
        name,
        code: newCode.trim() || undefined,
        isActive: true,
      });
      setNewName('');
      setNewCode('');
      await refresh();
      flash('Armazém criado.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao criar armazém.');
    } finally {
      setBusyId(null);
    }
  };

  const handleToggleActive = async (warehouse: PosWarehouse) => {
    setBusyId(warehouse.id);
    setError('');
    try {
      await updateWarehouseApi(warehouse.id, { isActive: !warehouse.isActive });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao actualizar armazém.');
    } finally {
      setBusyId(null);
    }
  };

  const handleSetDefault = async (warehouse: PosWarehouse) => {
    if (warehouse.isDefault) return;
    setBusyId(`default-${warehouse.id}`);
    setError('');
    try {
      await setDefaultWarehouseApi(warehouse.id);
      await refresh();
      flash(`«${warehouse.name}» é agora o armazém principal.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao definir armazém principal.');
    } finally {
      setBusyId(null);
    }
  };

  const startEdit = (warehouse: PosWarehouse) => {
    setEditingId(warehouse.id);
    setEditName(warehouse.name);
    setEditCode(warehouse.code ?? '');
  };

  const handleSaveEdit = async (warehouse: PosWarehouse) => {
    const name = editName.trim();
    if (!name) {
      setError('Nome do armazém é obrigatório.');
      return;
    }
    setBusyId(warehouse.id);
    setError('');
    try {
      await updateWarehouseApi(warehouse.id, {
        name,
        code: editCode.trim() || undefined,
        isActive: warehouse.isActive,
      });
      setEditingId(null);
      await refresh();
      flash('Armazém actualizado.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao guardar armazém.');
    } finally {
      setBusyId(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-zinc-400">
        <Loader2 size={16} className="animate-spin" />A carregar armazéns…
      </div>
    );
  }

  return (
    <div className="max-w-3xl space-y-6">
      <p className="text-xs text-zinc-500">
        Os armazéns guardam o stock físico. O armazém{' '}
        <strong className="font-semibold text-zinc-300">principal</strong> é usado por defeito nas
        compras, entradas e vendas de locais sem armazém fixo. Locais (salão/mesas) são independentes —
        configure o vínculo em Settings → Locais.
      </p>

      {error ? <p className="text-xs text-amber-400/90">{error}</p> : null}
      {message ? <p className="text-xs text-[#a5b4fc]">{message}</p> : null}

      <div className="rounded border border-pos-border bg-pos-surface p-4">
        <p className="mb-3 text-sm font-medium text-zinc-200">Novo armazém</p>
        <div className="grid gap-3 sm:grid-cols-[1fr_140px_auto] sm:items-end">
          <div>
            <label className="mb-1 block text-xs text-zinc-500">Nome</label>
            <DarkInput value={newName} onChange={setNewName} placeholder="Ex.: Cave, Loja 2" />
          </div>
          <div>
            <label className="mb-1 block text-xs text-zinc-500">Código</label>
            <DarkInput value={newCode} onChange={setNewCode} placeholder="Opcional" />
          </div>
          <button
            type="button"
            disabled={busyId === 'create'}
            onClick={() => void handleCreate()}
            className="inline-flex h-9 items-center justify-center gap-1.5 rounded bg-[#0001fb] px-3 text-sm font-medium text-white hover:brightness-110 disabled:opacity-50"
          >
            <Plus size={14} />
            Adicionar
          </button>
        </div>
      </div>

      <div className="space-y-3">
        {warehouses.length === 0 ? (
          <p className="text-sm text-zinc-500">Ainda não há armazéns.</p>
        ) : (
          warehouses.map((warehouse) => {
            const isEditing = editingId === warehouse.id;
            return (
              <div key={warehouse.id} className="rounded border border-pos-border bg-pos-surface p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    {isEditing ? (
                      <div className="grid max-w-md gap-2 sm:grid-cols-[1fr_120px]">
                        <DarkInput value={editName} onChange={setEditName} placeholder="Nome" />
                        <DarkInput value={editCode} onChange={setEditCode} placeholder="Código" />
                      </div>
                    ) : (
                      <div>
                        <p className="text-sm font-semibold text-white">
                          {warehouse.name}
                          {warehouse.code ? (
                            <span className="ml-2 text-xs font-normal text-zinc-500">
                              {warehouse.code}
                            </span>
                          ) : null}
                          {warehouse.isDefault ? (
                            <span className="ml-2 inline-flex items-center gap-1 rounded bg-[#0001fb]/20 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-[#a5b4fc]">
                              <Star size={10} />
                              Principal
                            </span>
                          ) : null}
                        </p>
                      </div>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-zinc-400">Activo</span>
                      <PosSwitch
                        checked={warehouse.isActive}
                        onChange={() => void handleToggleActive(warehouse)}
                        disabled={busyId === warehouse.id || warehouse.isDefault}
                      />
                    </div>
                    {!warehouse.isDefault ? (
                      <button
                        type="button"
                        disabled={busyId === `default-${warehouse.id}` || !warehouse.isActive}
                        onClick={() => void handleSetDefault(warehouse)}
                        className="rounded border border-zinc-600 px-2.5 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
                      >
                        Definir principal
                      </button>
                    ) : null}
                    {isEditing ? (
                      <>
                        <button
                          type="button"
                          onClick={() => void handleSaveEdit(warehouse)}
                          className="rounded bg-[#0001fb] px-2.5 py-1.5 text-xs text-white"
                        >
                          Guardar
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingId(null)}
                          className="rounded px-2.5 py-1.5 text-xs text-zinc-400 hover:bg-zinc-800"
                        >
                          Cancelar
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={() => startEdit(warehouse)}
                        className="rounded px-2.5 py-1.5 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-white"
                      >
                        Editar
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
