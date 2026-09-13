'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import {
  createLocationApi,
  deleteLocationApi,
  fetchLocations,
  fetchWarehouses,
  updateLocationApi,
  type PosLocation,
  type PosWarehouse,
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

const DEFAULT_WAREHOUSE_OPTION = '__default__';

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

function locationTablesSummary(location: PosLocation): string {
  if (location.tablesSummary) return location.tablesSummary;
  return formatTablesRange(location.tables.map((t) => t.name));
}

function locationFoSummary(location: PosLocation): string | null {
  const fo = formatTablesRange(location.tables.map((t) => t.displayName || t.name));
  const sys = locationTablesSummary(location);
  if (!location.displayStart || fo === sys) return null;
  return fo;
}

function warehouseSelectValue(warehouseId: string | null | undefined): string {
  return warehouseId ? String(warehouseId) : DEFAULT_WAREHOUSE_OPTION;
}

export function LocationsSettingsPanel() {
  const [locations, setLocations] = useState<PosLocation[]>([]);
  const [warehouses, setWarehouses] = useState<PosWarehouse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState('dining');
  const [newCode, setNewCode] = useState('');
  const [newTablesSpec, setNewTablesSpec] = useState('');
  const [newDisplayStart, setNewDisplayStart] = useState('');
  const [newWarehouseId, setNewWarehouseId] = useState(DEFAULT_WAREHOUSE_OPTION);
  const [editSpecs, setEditSpecs] = useState<Record<string, string>>({});
  const [editDisplayStarts, setEditDisplayStarts] = useState<Record<string, string>>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const warehouseOptions = [
    { value: DEFAULT_WAREHOUSE_OPTION, label: 'Armazém principal (default)' },
    ...warehouses
      .filter((w) => w.isActive)
      .map((w) => ({
        value: w.id,
        label: w.isDefault ? `${w.name} (principal)` : w.name,
      })),
  ];

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [rows, whRows] = await Promise.all([fetchLocations(), fetchWarehouses()]);
      setLocations(rows);
      setWarehouses(whRows);
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
        warehouseId: newWarehouseId === DEFAULT_WAREHOUSE_OPTION ? null : newWarehouseId,
        displayStart: newDisplayStart.trim() ? Number(newDisplayStart.trim()) : null,
      });
      setNewName('');
      setNewCode('');
      setNewType('dining');
      setNewTablesSpec('');
      setNewDisplayStart('');
      setNewWarehouseId(DEFAULT_WAREHOUSE_OPTION);
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

  const handleWarehouseChange = async (location: PosLocation, value: string) => {
    setBusyId(`wh-${location.id}`);
    setError('');
    try {
      await updateLocationApi(location.id, {
        warehouseId: value === DEFAULT_WAREHOUSE_OPTION ? null : value,
      });
      await refresh();
      flash('Armazém de stock actualizado.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao actualizar armazém.');
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
      setError('Indique as mesas (ex.: 40:59 ou 1,3,4).');
      return;
    }
    const foRaw = String(editDisplayStarts[location.id] ?? location.displayStart ?? '').trim();
    const displayStart = foRaw ? Number(foRaw) : null;
    if (foRaw && (!Number.isFinite(displayStart) || Number(displayStart) < 1)) {
      setError('A numeração no POS deve ser um número a partir de 1.');
      return;
    }
    setBusyId(`table-${location.id}`);
    setError('');
    try {
      await updateLocationApi(location.id, {
        tablesSpec: spec,
        displayStart,
      });
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
        Cada número de mesa só pode existir num local. Se o 40 já estiver no Balcão, outro local não
        o pode usar. As mesas no sistema ficam com esse número; opcionalmente indique a{' '}
        <strong className="font-semibold text-zinc-300">numeração no POS</strong> (ex.: começar em 1)
        e as mesas seguintes seguem a sequência no front office, sem alterar o número interno.
      </p>

      {error ? <p className="text-xs text-amber-400/90">{error}</p> : null}
      {message ? <p className="text-xs text-[#a5b4fc]">{message}</p> : null}

      <div className="rounded border border-pos-border bg-pos-surface p-4">
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
                triggerClassName="!bg-pos-field !border-zinc-600"
              />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs text-zinc-500">Armazém de stock</label>
            <PosSelect
              value={newWarehouseId}
              onChange={setNewWarehouseId}
              options={warehouseOptions}
              size="md"
              triggerClassName="!bg-pos-field !border-zinc-600"
            />
            <p className="mt-1 text-[11px] text-zinc-500">
              Vendas neste local debitam stock deste armazém. Se escolher o principal, segue o default
              das configurações de Armazéns.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-[1fr_140px_auto] sm:items-end">
            <div>
              <label className="mb-1 block text-xs text-zinc-500">Mesas no sistema (ex.: 40:59)</label>
              <DarkInput
                value={newTablesSpec}
                onChange={setNewTablesSpec}
                placeholder="40:59"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-zinc-500">POS a partir de</label>
              <DarkInput
                value={newDisplayStart}
                onChange={setNewDisplayStart}
                placeholder="Opcional, ex.: 1"
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
            const foSummary = locationFoSummary(location);
            const isEditing = editingId === location.id;
            const beginEdit = () => {
              setEditingId(location.id);
              setEditSpecs((prev) => ({
                ...prev,
                [location.id]: summary === '—' ? '' : summary,
              }));
              setEditDisplayStarts((prev) => ({
                ...prev,
                [location.id]: location.displayStart ? String(location.displayStart) : '',
              }));
            };
            return (
              <div key={location.id} className="rounded border border-pos-border bg-pos-surface p-4">
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

                <div className="mt-3">
                  <label className="mb-1 block text-xs text-zinc-500">Armazém de stock</label>
                  <PosSelect
                    value={warehouseSelectValue(location.warehouseId)}
                    onChange={(value) => void handleWarehouseChange(location, value)}
                    options={warehouseOptions}
                    size="md"
                    triggerClassName="!bg-pos-field !border-zinc-600"
                    disabled={busyId === `wh-${location.id}`}
                  />
                  <p className="mt-1 text-[11px] text-zinc-500">
                    Vendas neste local debitam stock deste armazém. Se escolher o principal, segue o
                    default das configurações de Armazéns.
                  </p>
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-pos-border pt-3">
                  <span className="text-sm text-zinc-300">
                    {location.tables.length} mesa{location.tables.length === 1 ? '' : 's'}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      if (isEditing) setEditingId(null);
                      else beginEdit();
                    }}
                    className="rounded border border-[#0001fb]/50 bg-[#0001fb]/10 px-3 py-1.5 text-sm font-semibold text-[#a5b4fc] hover:bg-[#0001fb]/20"
                    title="Intervalo de mesas"
                  >
                    {foSummary ? `${foSummary} · sistema ${summary}` : summary}
                  </button>
                  {!isEditing ? (
                    <button
                      type="button"
                      onClick={beginEdit}
                      className="text-xs text-zinc-500 hover:text-zinc-300"
                    >
                      Alterar
                    </button>
                  ) : null}
                </div>

                {isEditing ? (
                  <div className="mt-3 flex flex-wrap items-end gap-2">
                    <div>
                      <label className="mb-1 block text-[11px] text-zinc-500">Mesas no sistema</label>
                      <DarkInput
                        value={editSpecs[location.id] ?? ''}
                        onChange={(value) =>
                          setEditSpecs((prev) => ({ ...prev, [location.id]: value }))
                        }
                        placeholder="40:59"
                        className="max-w-[160px]"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-[11px] text-zinc-500">POS a partir de</label>
                      <DarkInput
                        value={editDisplayStarts[location.id] ?? ''}
                        onChange={(value) =>
                          setEditDisplayStarts((prev) => ({ ...prev, [location.id]: value }))
                        }
                        placeholder="1"
                        className="max-w-[100px]"
                      />
                    </div>
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

                <div className="mt-4 flex items-center justify-between gap-3 border-t border-pos-border pt-3">
                  <div>
                    <p className="text-sm text-zinc-200">Dar nome às mesas</p>
                    <p className="text-xs text-zinc-500">
                      No front office, ao clicar na mesa pede um nome. Enter vazio = abre só com o
                      número.
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
