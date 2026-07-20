'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import {
  createLocationApi,
  createLocationTableApi,
  deleteLocationApi,
  fetchLocations,
  updateLocationApi,
  type PosLocation,
} from '@/lib/services/posService';
import { formatTablesRange } from '@/lib/tableRange';
import PosSelect from '@/components/PosSelect';
import { PosSwitch } from '@/components/PosSwitch';

const LOCATION_TYPES = [
  { value: 'counter', label: 'Balcão' },
  { value: 'dining', label: 'Salão / consumo' },
  { value: 'takeaway', label: 'Takeaway' },
  { value: 'delivery', label: 'Delivery' },
  { value: 'other', label: 'Outro' },
];

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
      className={`h-9 w-full rounded border border-zinc-600 bg-[#171717] px-3 text-sm text-white outline-none focus:border-[#0001fb] ${className}`}
    />
  );
}

function locationTablesSummary(location: PosLocation): string {
  if (location.tablesSummary) return location.tablesSummary;
  return formatTablesRange(location.tables.map((t) => t.name));
}

export function LocationsSettingsPanel() {
  const [locations, setLocations] = useState<PosLocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState('dining');
  const [newCode, setNewCode] = useState('');
  const [newTablesSpec, setNewTablesSpec] = useState('');
  const [editSpecs, setEditSpecs] = useState<Record<string, string>>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const rows = await fetchLocations();
      setLocations(rows);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao carregar locais.');
      setLocations([]);
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
      setError('Indique o nome do local.');
      return;
    }
    setBusyId('create');
    setError('');
    try {
      await createLocationApi({
        name,
        code: newCode.trim() || undefined,
        type: newType,
        active: true,
        tablesSpec: newTablesSpec.trim() || undefined,
        allowCustomNames: false,
      });
      setNewName('');
      setNewCode('');
      setNewType('dining');
      setNewTablesSpec('');
      await refresh();
      flash('Local criado.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao criar local.');
    } finally {
      setBusyId(null);
    }
  };

  const handleToggleActive = async (location: PosLocation) => {
    setBusyId(location.id);
    try {
      await updateLocationApi(location.id, { active: !location.active });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao actualizar local.');
    } finally {
      setBusyId(null);
    }
  };

  const handleToggleCustomNames = async (location: PosLocation) => {
    setBusyId(`names-${location.id}`);
    try {
      await updateLocationApi(location.id, { allowCustomNames: !location.allowCustomNames });
      await refresh();
      flash(
        !location.allowCustomNames
          ? 'No POS, ao abrir a mesa pode dar um nome (Enter = só o número).'
          : 'No POS as mesas abrem só com o número.',
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao actualizar opção de nomes.');
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (location: PosLocation) => {
    if (!window.confirm(`Apagar o local «${location.name}» e as suas mesas?`)) return;
    setBusyId(location.id);
    try {
      await deleteLocationApi(location.id);
      await refresh();
      flash('Local apagado.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao apagar local.');
    } finally {
      setBusyId(null);
    }
  };

  const handleReplaceTables = async (location: PosLocation) => {
    const spec = String(editSpecs[location.id] ?? locationTablesSummary(location)).trim();
    if (!spec || spec === '—') {
      setError('Indique as mesas (ex.: 1:20 ou 1,3,4).');
      return;
    }
    setBusyId(`table-${location.id}`);
    setError('');
    try {
      // Substitui: apagar local tables via re-create by deleting each is heavy;
      // API addTablesFromSpec ignores duplicates — for replace we need clear first.
      // Use delete location tables by recreating: call delete each via API is N calls.
      // Simpler: deleteLocation + create is bad. Add replace endpoint? For now:
      // delete all tables then add — use existing delete per table in a batch via fetch.
      const { deleteLocationTableApi } = await import('@/lib/services/posService');
      for (const table of location.tables) {
        await deleteLocationTableApi(table.id);
      }
      await createLocationTableApi(location.id, { tablesSpec: spec });
      setEditingId(null);
      await refresh();
      flash('Mesas actualizadas.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao actualizar mesas.');
    } finally {
      setBusyId(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-zinc-400">
        <Loader2 size={16} className="animate-spin" />A carregar locais…
      </div>
    );
  }

  return (
    <div className="max-w-3xl space-y-6">
      <p className="text-xs text-zinc-500">
        Locais servem o <strong className="font-semibold text-zinc-300">multiposto</strong> (salão /
        zona). Em restauração, o local{' '}
        <strong className="font-semibold text-zinc-300">Balcão</strong> vem com{' '}
        <strong className="font-semibold text-zinc-300">20 mesas (1:20)</strong> — basta o intervalo.
        Em retalho/farmácia a venda é sempre directa (sem mesas no POS). Com{' '}
        <strong className="font-semibold text-zinc-300">Dar nome às mesas</strong>, o nome só é pedido
        na 1ª abertura; mesa ocupada abre directo; após pagar e ficar vazia, volta a pedir.
      </p>

      {error ? <p className="text-xs text-amber-400/90">{error}</p> : null}
      {message ? <p className="text-xs text-[#a5b4fc]">{message}</p> : null}

      <div className="rounded border border-zinc-700 bg-[#171717] p-4">
        <p className="mb-3 text-sm font-medium text-zinc-200">Novo local</p>
        <div className="grid gap-3">
          <div className="grid gap-3 sm:grid-cols-[1fr_120px_160px]">
            <div>
              <label className="mb-1 block text-xs text-zinc-500">Nome do local</label>
              <DarkInput value={newName} onChange={setNewName} placeholder="Ex.: Terraço, Salão VIP" />
            </div>
            <div>
              <label className="mb-1 block text-xs text-zinc-500">Código</label>
              <DarkInput value={newCode} onChange={setNewCode} placeholder="Opcional" />
            </div>
            <div>
              <label className="mb-1 block text-xs text-zinc-500">Tipo</label>
              <PosSelect
                value={newType}
                onChange={setNewType}
                options={LOCATION_TYPES}
                size="md"
                triggerClassName="!bg-[#2a2a2a] !border-zinc-600"
              />
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
            <div>
              <label className="mb-1 block text-xs text-zinc-500">Mesas (ex.: 1:20 ou 1,3,4)</label>
              <DarkInput
                value={newTablesSpec}
                onChange={setNewTablesSpec}
                placeholder="1:20"
              />
            </div>
            <button
              type="button"
              disabled={busyId === 'create'}
              onClick={() => void handleCreate()}
              className="inline-flex h-9 items-center justify-center gap-1.5 rounded bg-[#0001fb] px-3 text-sm font-medium text-white hover:brightness-110 disabled:opacity-50"
            >
              <Plus size={14} />
              Adicionar local
            </button>
          </div>
        </div>
      </div>

      <div className="space-y-3">
        {locations.length === 0 ? (
          <p className="text-sm text-zinc-500">Ainda não há locais configurados.</p>
        ) : (
          locations.map((location) => {
            const summary = locationTablesSummary(location);
            const isEditing = editingId === location.id;
            return (
              <div key={location.id} className="rounded border border-zinc-700 bg-[#171717] p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-white">
                      {location.name}
                      {location.code ? (
                        <span className="ml-2 text-xs font-normal text-zinc-500">{location.code}</span>
                      ) : null}
                    </p>
                    <p className="text-xs text-zinc-500">
                      Tipo:{' '}
                      {LOCATION_TYPES.find((t) => t.value === location.type)?.label ?? location.type}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-zinc-400">Activo</span>
                      <PosSwitch
                        checked={location.active}
                        onChange={() => void handleToggleActive(location)}
                        disabled={busyId === location.id}
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleDelete(location)}
                      className="rounded p-2 text-zinc-400 hover:bg-zinc-800 hover:text-red-400"
                      aria-label="Apagar local"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-zinc-800 pt-3">
                  <span className="text-sm text-zinc-300">
                    {location.tables.length} mesa{location.tables.length === 1 ? '' : 's'}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setEditingId(isEditing ? null : location.id);
                      setEditSpecs((prev) => ({
                        ...prev,
                        [location.id]: summary === '—' ? '' : summary,
                      }));
                    }}
                    className="rounded border border-[#0001fb]/50 bg-[#0001fb]/10 px-3 py-1.5 text-sm font-semibold text-[#a5b4fc] hover:bg-[#0001fb]/20"
                    title="Intervalo de mesas"
                  >
                    {summary}
                  </button>
                  {!isEditing ? (
                    <button
                      type="button"
                      onClick={() => {
                        setEditingId(location.id);
                        setEditSpecs((prev) => ({
                          ...prev,
                          [location.id]: summary === '—' ? '' : summary,
                        }));
                      }}
                      className="text-xs text-zinc-500 hover:text-zinc-300"
                    >
                      Alterar
                    </button>
                  ) : null}
                </div>

                {isEditing ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <DarkInput
                      value={editSpecs[location.id] ?? ''}
                      onChange={(value) =>
                        setEditSpecs((prev) => ({ ...prev, [location.id]: value }))
                      }
                      placeholder="1:20 ou 1,3,4"
                      className="max-w-[200px]"
                    />
                    <button
                      type="button"
                      disabled={busyId === `table-${location.id}`}
                      onClick={() => void handleReplaceTables(location)}
                      className="h-9 rounded bg-[#0001fb] px-3 text-xs font-medium text-white disabled:opacity-50"
                    >
                      Guardar mesas
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingId(null)}
                      className="h-9 rounded border border-zinc-600 px-3 text-xs text-zinc-400"
                    >
                      Cancelar
                    </button>
                  </div>
                ) : null}

                <div className="mt-4 flex items-center justify-between gap-3 border-t border-zinc-800 pt-3">
                  <div>
                    <p className="text-sm text-zinc-200">Dar nome às mesas</p>
                    <p className="text-xs text-zinc-500">
                      No front office, ao clicar na mesa pede um nome. Enter vazio = abre só com o número.
                    </p>
                  </div>
                  <PosSwitch
                    checked={Boolean(location.allowCustomNames)}
                    onChange={() => void handleToggleCustomNames(location)}
                    disabled={busyId === `names-${location.id}`}
                  />
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
