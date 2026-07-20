'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import {
  createPrintCenterApi,
  deletePrintCenterApi,
  fetchCategories,
  fetchPrintCenters,
  updatePrintCenterApi,
  type PrintCenter,
} from '@/lib/services/posService';
import { listSystemPrinters, type SystemPrinter } from '@/lib/printersClient';
import PosSelect from '@/components/PosSelect';
import { PosSwitch } from '@/components/PosSwitch';

type CategoryOption = { id: string; name: string; parent_id: string | null };

function DarkInput({
  value,
  onChange,
  placeholder,
  type = 'text',
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <input
      type={type}
      value={value}
      placeholder={placeholder}
      onChange={(event) => onChange(event.target.value)}
      className="h-9 w-full rounded border border-zinc-600 bg-[#171717] px-3 text-sm text-white outline-none focus:border-[#0001fb]"
    />
  );
}

const emptyForm = {
  name: '',
  connectionType: 'windows' as 'windows' | 'network',
  windowsPrinterName: '',
  host: '',
  port: '9100',
  paperWidth: '80',
  categoryIds: [] as string[],
};

export function PrintCentersPanel() {
  const [centers, setCenters] = useState<PrintCenter[]>([]);
  const [categories, setCategories] = useState<CategoryOption[]>([]);
  const [printers, setPrinters] = useState<SystemPrinter[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [centerRows, categoryRows, printerRows] = await Promise.all([
        fetchPrintCenters(),
        fetchCategories(),
        listSystemPrinters(),
      ]);
      setCenters(centerRows);
      setCategories(categoryRows);
      setPrinters(printerRows);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao carregar centros de impressão.');
      setCenters([]);
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

  const assignedCategoryIds = useMemo(() => {
    const set = new Set<string>();
    for (const center of centers) {
      if (editingId && center.id === editingId) continue;
      for (const id of center.categoryIds) set.add(String(id));
    }
    return set;
  }, [centers, editingId]);

  const categoryOptions = useMemo(
    () =>
      categories.map((cat) => ({
        value: cat.id,
        label: assignedCategoryIds.has(cat.id)
          ? `${cat.name} (já noutro centro)`
          : cat.name,
        disabled: assignedCategoryIds.has(cat.id),
      })),
    [categories, assignedCategoryIds],
  );

  const printerOptions = printers.map((printer) => ({
    value: printer.name,
    label: printer.isDefault ? `${printer.displayName} (padrão)` : printer.displayName,
  }));

  const resetForm = () => {
    setForm(emptyForm);
    setEditingId(null);
  };

  const startEdit = (center: PrintCenter) => {
    setEditingId(center.id);
    setForm({
      name: center.name,
      connectionType: center.connectionType === 'network' ? 'network' : 'windows',
      windowsPrinterName: center.windowsPrinterName || '',
      host: center.host || '',
      port: String(center.port || 9100),
      paperWidth: String(center.paperWidth === 58 ? 58 : 80),
      categoryIds: [...center.categoryIds],
    });
  };

  const toggleCategory = (categoryId: string) => {
    if (assignedCategoryIds.has(categoryId) && !form.categoryIds.includes(categoryId)) return;
    setForm((prev) => ({
      ...prev,
      categoryIds: prev.categoryIds.includes(categoryId)
        ? prev.categoryIds.filter((id) => id !== categoryId)
        : [...prev.categoryIds, categoryId],
    }));
  };

  const handleSave = async () => {
    const name = form.name.trim();
    if (!name) {
      setError('Indique o nome do centro (ex.: Imp Cozinha).');
      return;
    }
    if (form.connectionType === 'windows' && !form.windowsPrinterName.trim()) {
      setError('Seleccione a impressora Windows.');
      return;
    }
    if (form.connectionType === 'network' && !form.host.trim()) {
      setError('Indique o IP da impressora.');
      return;
    }

    setBusy(true);
    setError('');
    const payload = {
      name,
      connectionType: form.connectionType,
      windowsPrinterName: form.connectionType === 'windows' ? form.windowsPrinterName.trim() : null,
      host: form.connectionType === 'network' ? form.host.trim() : null,
      port: Number(form.port) || 9100,
      paperWidth: Number(form.paperWidth) === 58 ? 58 : 80,
      enabled: true,
      categoryIds: form.categoryIds,
    };

    try {
      if (editingId) {
        await updatePrintCenterApi(editingId, payload);
        flash('Centro actualizado.');
      } else {
        await createPrintCenterApi(payload);
        flash('Centro criado.');
      }
      resetForm();
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao guardar centro.');
    } finally {
      setBusy(false);
    }
  };

  const handleToggle = async (center: PrintCenter) => {
    setBusy(true);
    try {
      await updatePrintCenterApi(center.id, { enabled: !center.enabled });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao actualizar.');
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (center: PrintCenter) => {
    if (!window.confirm(`Apagar o centro «${center.name}»?`)) return;
    setBusy(true);
    try {
      await deletePrintCenterApi(center.id);
      if (editingId === center.id) resetForm();
      await refresh();
      flash('Centro apagado.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao apagar.');
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-zinc-400">
        <Loader2 size={16} className="animate-spin" />A carregar centros…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <p className="text-xs text-zinc-500">
        Crie centros como <strong className="font-semibold text-zinc-300">Imp Cozinha</strong> ou{' '}
        <strong className="font-semibold text-zinc-300">Imp Balcão</strong> e associe as famílias/grupos
        (Comida, Sandes, Bebidas…). No pedido, cada produto imprime só no centro das suas famílias.
      </p>

      {error ? <p className="text-xs text-amber-400/90">{error}</p> : null}
      {message ? <p className="text-xs text-[#a5b4fc]">{message}</p> : null}

      <div className="rounded border border-zinc-700 bg-[#171717] p-4">
        <p className="mb-3 text-sm font-medium text-zinc-200">
          {editingId ? 'Editar centro' : 'Novo centro de impressão'}
        </p>
        <div className="grid max-w-2xl gap-3">
          <div className="grid grid-cols-[140px_1fr] items-center gap-3">
            <label className="text-sm text-zinc-400">Nome</label>
            <DarkInput
              value={form.name}
              onChange={(value) => setForm((prev) => ({ ...prev, name: value }))}
              placeholder="Imp Cozinha"
            />
          </div>
          <div className="grid grid-cols-[140px_1fr] items-center gap-3">
            <label className="text-sm text-zinc-400">Ligação</label>
            <PosSelect
              value={form.connectionType}
              onChange={(value) =>
                setForm((prev) => ({
                  ...prev,
                  connectionType: value === 'network' ? 'network' : 'windows',
                }))
              }
              options={[
                { value: 'windows', label: 'Windows / USB (spooler)' },
                { value: 'network', label: 'Rede (IP)' },
              ]}
              size="md"
              triggerClassName="!bg-[#2a2a2a] !border-zinc-600"
            />
          </div>
          {form.connectionType === 'windows' ? (
            <div className="grid grid-cols-[140px_1fr] items-center gap-3">
              <label className="text-sm text-zinc-400">Impressora</label>
              <PosSelect
                value={form.windowsPrinterName}
                onChange={(value) => setForm((prev) => ({ ...prev, windowsPrinterName: value }))}
                options={[{ value: '', label: 'Seleccionar impressora' }, ...printerOptions]}
                size="md"
                triggerClassName="!bg-[#2a2a2a] !border-zinc-600"
              />
            </div>
          ) : (
            <div className="grid grid-cols-[140px_1fr_100px] items-center gap-3">
              <label className="text-sm text-zinc-400">IP / Porta</label>
              <DarkInput
                value={form.host}
                onChange={(value) => setForm((prev) => ({ ...prev, host: value }))}
                placeholder="192.168.1.50"
              />
              <DarkInput
                value={form.port}
                onChange={(value) => setForm((prev) => ({ ...prev, port: value }))}
                placeholder="9100"
              />
            </div>
          )}
          <div className="grid grid-cols-[140px_1fr] items-center gap-3">
            <label className="text-sm text-zinc-400">Papel</label>
            <PosSelect
              value={form.paperWidth}
              onChange={(value) => setForm((prev) => ({ ...prev, paperWidth: value }))}
              options={[
                { value: '80', label: '80 mm' },
                { value: '58', label: '58 mm' },
              ]}
              size="md"
              triggerClassName="!bg-[#2a2a2a] !border-zinc-600"
            />
          </div>
        </div>

        <div className="mt-4">
          <p className="mb-2 text-sm text-zinc-300">Famílias / grupos neste centro</p>
          {categories.length === 0 ? (
            <p className="text-xs text-zinc-500">
              Crie grupos em Gestão de produtos (Comida, Bebidas…) para os associar aqui.
            </p>
          ) : (
            <div className="flex max-h-40 flex-wrap gap-2 overflow-y-auto custom-scrollbar">
              {categoryOptions.map((opt) => {
                const selected = form.categoryIds.includes(opt.value);
                const locked = Boolean(opt.disabled) && !selected;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    disabled={locked}
                    onClick={() => toggleCategory(opt.value)}
                    className={`rounded border px-2.5 py-1 text-xs transition-colors ${
                      selected
                        ? 'border-[#0001fb] bg-[#0001fb]/20 text-white'
                        : locked
                          ? 'cursor-not-allowed border-zinc-800 text-zinc-600'
                          : 'border-zinc-700 text-zinc-300 hover:border-zinc-500'
                    }`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="mt-4 flex gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => void handleSave()}
            className="inline-flex h-9 items-center gap-1.5 rounded bg-[#0001fb] px-3 text-sm font-medium text-white hover:brightness-110 disabled:opacity-50"
          >
            <Plus size={14} />
            {editingId ? 'Guardar alterações' : 'Adicionar centro'}
          </button>
          {editingId ? (
            <button
              type="button"
              onClick={resetForm}
              className="h-9 rounded border border-zinc-600 px-3 text-sm text-zinc-300 hover:text-white"
            >
              Cancelar
            </button>
          ) : null}
        </div>
      </div>

      <div className="space-y-2">
        {centers.length === 0 ? (
          <p className="text-sm text-zinc-500">Nenhum centro configurado.</p>
        ) : (
          centers.map((center) => (
            <div
              key={center.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded border border-zinc-800 bg-[#171717] px-4 py-3"
            >
              <div className="min-w-0">
                <p className="text-sm font-semibold text-white">{center.name}</p>
                <p className="text-xs text-zinc-500">
                  {center.connectionType === 'network'
                    ? `Rede ${center.host}:${center.port}`
                    : `Windows: ${center.windowsPrinterName || '—'}`}
                  {' · '}
                  {center.categories.length
                    ? center.categories.map((c) => c.name).join(', ')
                    : 'sem famílias'}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <PosSwitch checked={center.enabled} onChange={() => void handleToggle(center)} />
                <button
                  type="button"
                  onClick={() => startEdit(center)}
                  className="rounded border border-zinc-700 px-2.5 py-1 text-xs text-zinc-300 hover:border-[#0001fb]"
                >
                  Editar
                </button>
                <button
                  type="button"
                  onClick={() => void handleDelete(center)}
                  className="rounded p-2 text-zinc-400 hover:bg-zinc-800 hover:text-red-400"
                  aria-label="Apagar"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
