'use client';

import React, { useEffect, useState } from 'react';
import { AlertCircle, RefreshCw, Settings2 } from 'lucide-react';
import type { PosSettings, PrintJobKey } from '@/lib/posSettings';
import { listSystemPrinters, type SystemPrinter } from '@/lib/printersClient';
import { ReceiptPrinterSettingsModal } from './ReceiptPrinterSettingsModal';
import PosSelect from '@/components/PosSelect';

type PrintTab = 'selecao' | 'personalizar' | 'localizar' | 'modelos';

const PRINT_TABS: Array<{ id: PrintTab; label: string }> = [
  { id: 'selecao', label: 'Seleção de impressora' },
  { id: 'personalizar', label: 'Personalizar recibo' },
  { id: 'localizar', label: 'Localize o texto do recibo' },
  { id: 'modelos', label: 'Modelos de impressão' },
];

const PRINT_JOBS: Array<{ key: PrintJobKey; label: string; settingsLink?: boolean }> = [
  { key: 'receipt', label: 'Imprimir recibo', settingsLink: true },
  { key: 'creditPayments', label: 'Imprimir pagamentos a crédito' },
  { key: 'blockedSale', label: 'Imprimir venda bloqueada' },
  { key: 'kitchen', label: 'Imprimir pedidos da cozinha' },
  { key: 'serviceMessages', label: 'Imprimir mensagens de serviço' },
];

function PrintToggle({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-[22px] w-[42px] shrink-0 rounded-[3px] border transition-colors disabled:opacity-50 ${
        checked
          ? 'border-emerald-500 bg-emerald-500'
          : 'border-zinc-500 bg-zinc-600'
      }`}
    >
      <span
        className={`absolute top-[2px] h-[16px] w-[16px] rounded-[2px] bg-white shadow-sm transition-all ${
          checked ? 'left-[22px]' : 'left-[2px]'
        }`}
      />
    </button>
  );
}

function DarkSelect({
  value,
  onChange,
  options,
  disabled,
  placeholder = 'Seleccionar impressora',
}: {
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
  disabled?: boolean;
  placeholder?: string;
}) {
  return (
    <PosSelect
      value={value}
      onChange={onChange}
      disabled={disabled}
      placeholder={placeholder}
      size="md"
      className="min-w-[200px] max-w-[280px] flex-1"
      triggerClassName="!bg-[#2a2a2a] !border-zinc-600"
      options={[{ value: '', label: placeholder }, ...options]}
    />
  );
}

function DarkInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <input
      type="text"
      value={value}
      placeholder={placeholder}
      onChange={(event) => onChange(event.target.value)}
      className="h-9 w-full max-w-[420px] rounded border border-zinc-600 bg-[#171717] px-3 text-sm text-white outline-none focus:border-[#00a3e0]"
    />
  );
}

export function PrintOptionsPanel({
  draft,
  onChange,
}: {
  draft: PosSettings;
  onChange: (next: PosSettings) => void;
}) {
  const [tab, setTab] = useState<PrintTab>('selecao');
  const [printers, setPrinters] = useState<SystemPrinter[]>([]);
  const [printersError, setPrintersError] = useState('');
  const [loadingPrinters, setLoadingPrinters] = useState(false);
  const [printerSettingsOpen, setPrinterSettingsOpen] = useState(false);

  const refreshPrinters = async () => {
    setLoadingPrinters(true);
    setPrintersError('');
    try {
      const list = await listSystemPrinters();
      setPrinters(list);
      if (!list.length) {
        setPrintersError(
          window.electronAPI?.listPrinters
            ? 'Nenhuma impressora encontrada no Windows.'
            : 'Lista de impressoras disponível na app desktop (Electron).',
        );
      }
    } catch (error) {
      setPrinters([]);
      setPrintersError(error instanceof Error ? error.message : 'Falha ao listar impressoras.');
    } finally {
      setLoadingPrinters(false);
    }
  };

  useEffect(() => {
    void refreshPrinters();
  }, []);

  const printerOptions = printers.map((printer) => ({
    value: printer.name,
    label: printer.isDefault ? `${printer.displayName} (padrão)` : printer.displayName,
  }));

  const updateJob = (key: PrintJobKey, patch: Partial<{ enabled: boolean; printer: string }>) => {
    onChange({
      ...draft,
      printJobs: {
        ...draft.printJobs,
        [key]: {
          ...draft.printJobs[key],
          ...patch,
        },
      },
      ...(key === 'receipt' && patch.enabled != null
        ? { autoPrintReceipt: patch.enabled }
        : {}),
    });
  };

  const updateField = <K extends keyof PosSettings>(key: K, value: PosSettings[K]) => {
    onChange({ ...draft, [key]: value });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="mb-1 flex items-center gap-2 border-b border-zinc-700">
        {PRINT_TABS.map((item) => {
          const active = tab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                setTab(item.id);
              }}
              className={`relative px-3 pb-3 pt-1 text-sm transition-colors ${
                active ? 'text-white' : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              {item.label}
              {active ? (
                <span className="absolute inset-x-0 bottom-0 h-[3px] rounded-t bg-[#00a3e0]" />
              ) : null}
            </button>
          );
        })}
      </div>

      <div className="mt-5 min-h-0 flex-1 overflow-y-auto pr-1 custom-scrollbar">
        {tab === 'selecao' && (
          <div className="space-y-1">
            <div className="mb-4 flex items-center justify-between gap-3">
              <p className="text-xs text-zinc-500">
                Active a função e escolha uma impressora <strong className="font-semibold text-zinc-300">instalada no Windows</strong>.
                A gestão de drivers e portas fica no sistema operativo — o POSly apenas lista e envia a impressão.
              </p>
              <button
                type="button"
                onClick={() => void refreshPrinters()}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-[#00a3e0] hover:underline"
              >
                <RefreshCw size={12} className={loadingPrinters ? 'animate-spin' : ''} />
                Actualizar lista
              </button>
            </div>

            {printersError ? <p className="mb-3 text-xs text-amber-400/90">{printersError}</p> : null}

            {PRINT_JOBS.map((job) => {
              const cfg = draft.printJobs[job.key];
              const hasPrinter = Boolean(String(cfg.printer || '').trim());
              const showWarning = !cfg.enabled || !hasPrinter;
              const showSettings = Boolean(job.settingsLink) && cfg.enabled && hasPrinter;

              return (
                <div
                  key={job.key}
                  className="grid grid-cols-[auto_minmax(180px,1.1fr)_minmax(200px,1fr)_minmax(160px,auto)] items-center gap-3 border-b border-zinc-800/80 py-3"
                >
                  <PrintToggle
                    checked={cfg.enabled}
                    onChange={(enabled) => updateJob(job.key, { enabled })}
                  />
                  <span className="truncate text-sm text-zinc-200">{job.label}</span>
                  <DarkSelect
                    value={cfg.printer}
                    disabled={!cfg.enabled}
                    options={printerOptions}
                    onChange={(printer) => updateJob(job.key, { printer })}
                  />
                  <div className="flex min-h-[28px] items-center justify-end">
                    {showSettings ? (
                      <button
                        type="button"
                        onClick={() => setPrinterSettingsOpen(true)}
                        className="inline-flex items-center gap-1.5 text-sm text-zinc-200 hover:text-white"
                      >
                        <Settings2 size={15} className="text-zinc-300" />
                        Configurações de impressora
                      </button>
                    ) : showWarning ? (
                      <span
                        className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-red-600 text-white"
                        title={
                          !cfg.enabled
                            ? 'Função desactivada'
                            : 'Seleccione uma impressora'
                        }
                      >
                        <AlertCircle size={14} />
                      </span>
                    ) : null}
                  </div>
                </div>
              );
            })}

            <ReceiptPrinterSettingsModal
              isOpen={printerSettingsOpen}
              onClose={() => setPrinterSettingsOpen(false)}
              draft={draft}
              onChange={onChange}
              printerName={draft.printJobs.receipt.printer}
            />
          </div>
        )}

        {tab === 'personalizar' && (
          <div className="max-w-2xl space-y-4">
            <div className="flex items-center justify-between gap-4 border-b border-zinc-800 py-3">
              <div>
                <p className="text-sm text-zinc-200">Mostrar logótipo no recibo</p>
                <p className="text-xs text-zinc-500">Usa o logótipo da loja no cabeçalho.</p>
              </div>
              <PrintToggle
                checked={draft.receiptShowLogo}
                onChange={(value) => updateField('receiptShowLogo', value)}
              />
            </div>
            <div className="grid grid-cols-[160px_1fr] items-center gap-3">
              <label className="text-sm text-zinc-400">Cabeçalho linha 1</label>
              <DarkInput
                value={draft.receiptHeaderLine1}
                onChange={(value) => updateField('receiptHeaderLine1', value)}
                placeholder="Nome da loja / slogan"
              />
            </div>
            <div className="grid grid-cols-[160px_1fr] items-center gap-3">
              <label className="text-sm text-zinc-400">Cabeçalho linha 2</label>
              <DarkInput
                value={draft.receiptHeaderLine2}
                onChange={(value) => updateField('receiptHeaderLine2', value)}
                placeholder="NUIT, telefone, endereço…"
              />
            </div>
            <div className="grid grid-cols-[160px_1fr] items-center gap-3">
              <label className="text-sm text-zinc-400">Rodapé</label>
              <DarkInput
                value={draft.receiptFooter}
                onChange={(value) => updateField('receiptFooter', value)}
                placeholder="Obrigado pela preferência!"
              />
            </div>
          </div>
        )}

        {tab === 'localizar' && (
          <div className="max-w-2xl space-y-3">
            <p className="mb-2 text-xs text-zinc-500">
              Textos que aparecem no recibo impresso. Deixe em português ou adapte ao idioma da loja.
            </p>
            {(
              [
                ['receiptLabelItem', 'Item'],
                ['receiptLabelQty', 'Quantidade'],
                ['receiptLabelPrice', 'Preço'],
                ['receiptLabelTotal', 'Total'],
                ['receiptLabelChange', 'Troco'],
              ] as const
            ).map(([key, label]) => (
              <div key={key} className="grid grid-cols-[160px_1fr] items-center gap-3">
                <label className="text-sm text-zinc-400">{label}</label>
                <DarkInput value={String(draft[key])} onChange={(value) => updateField(key, value)} />
              </div>
            ))}
          </div>
        )}

        {tab === 'modelos' && (
          <div className="grid max-w-3xl gap-3 sm:grid-cols-2">
            {[
              {
                id: '80mm-standard',
                title: '80 mm — Padrão',
                desc: 'Recibo térmico completo para impressoras XP-80 / similares.',
              },
              {
                id: '58mm-compact',
                title: '58 mm — Compacto',
                desc: 'Formato estreito para impressoras portáteis.',
              },
            ].map((model) => {
              const active = draft.receiptTemplate === model.id;
              return (
                <button
                  key={model.id}
                  type="button"
                  onClick={() => {
                    updateField('receiptTemplate', model.id);
                    updateField('printPaperWidth', model.id.startsWith('58') ? '58' : '80');
                  }}
                  className={`rounded border p-4 text-left transition-colors ${
                    active
                      ? 'border-[#00a3e0] bg-[#00a3e0]/10'
                      : 'border-zinc-700 bg-[#171717] hover:border-zinc-500'
                  }`}
                >
                  <p className="text-sm font-semibold text-white">{model.title}</p>
                  <p className="mt-1 text-xs text-zinc-400">{model.desc}</p>
                  {active ? (
                    <p className="mt-3 text-xs font-medium text-[#00a3e0]">Seleccionado</p>
                  ) : null}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
