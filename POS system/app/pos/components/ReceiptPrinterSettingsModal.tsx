'use client';

import React, { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowRight, AlignCenter, AlignLeft, FileText, Minus, Plus, Printer } from 'lucide-react';
import type { PosSettings } from '@/lib/posSettings';
import { buildThermalPrintPageCss, resolveThermalWidthMm } from '@/lib/thermalPrintPage';
import PosSelect from '@/components/PosSelect';

type SettingsTab = 'general' | 'drawer' | 'advanced';

const TABS: Array<{ id: SettingsTab; label: string }> = [
  { id: 'general', label: 'General' },
  { id: 'drawer', label: 'Gaveta de dinheiro' },
  { id: 'advanced', label: 'Avançado' },
];

function HelpLink({ children = 'O que é isto?' }: { children?: string }) {
  return (
    <button type="button" className="text-xs font-medium text-[#00a3e0] hover:underline">
      {children}
    </button>
  );
}

function PillToggle({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${
        checked ? 'bg-emerald-500' : 'bg-zinc-600'
      }`}
    >
      <span
        className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-transform ${
          checked ? 'translate-x-5 left-0.5' : 'translate-x-0 left-0.5'
        }`}
      />
    </button>
  );
}

function FieldSelect({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <PosSelect
      value={value}
      onChange={onChange}
      options={options}
      size="md"
      className="max-w-[280px]"
      triggerClassName="!bg-[#2a2a2a] !border-zinc-600"
    />
  );
}

function CopiesStepper({
  value,
  onChange,
}: {
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="mt-1.5 inline-flex h-10 items-center overflow-hidden rounded border border-zinc-600 bg-[#2a2a2a]">
      <button
        type="button"
        onClick={() => onChange(Math.max(1, value - 1))}
        className="flex h-full w-10 items-center justify-center text-zinc-300 hover:bg-zinc-700 hover:text-white"
        aria-label="Diminuir cópias"
      >
        <Minus size={14} />
      </button>
      <span className="min-w-[2.5rem] text-center text-sm font-semibold text-white">{value}</span>
      <button
        type="button"
        onClick={() => onChange(Math.min(5, value + 1))}
        className="flex h-full w-10 items-center justify-center text-zinc-300 hover:bg-zinc-700 hover:text-white"
        aria-label="Aumentar cópias"
      >
        <Plus size={14} />
      </button>
    </div>
  );
}

function buildTestPageHtml(settings: PosSettings, printerName: string) {
  const widthMm = resolveThermalWidthMm(settings.printPaperWidth);
  const now = new Date().toLocaleString('pt-MZ', { hour12: false });
  const header = String(settings.printExtraHeader || '').trim();
  const footer = String(settings.printExtraFooter || '').trim();
  const headerAlign = settings.printHeaderAlign === 'left' ? 'align-left' : 'align-center';
  const footerAlign = settings.printFooterAlign === 'left' ? 'align-left' : 'align-center';
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <style>${buildThermalPrintPageCss(widthMm, {
    top: settings.printMarginTop,
    right: settings.printMarginRight,
    bottom: settings.printMarginBottom,
    left: settings.printMarginLeft,
  })}</style>
</head>
<body>
  <div class="print-receipt">
    ${header ? `<div class="print-extra-header ${headerAlign}">${header.replace(/</g, '&lt;')}</div>` : ''}
    <div class="print-header"><div class="logo">PAGINA DE TESTE</div></div>
    <div class="print-divider"></div>
    <p>Impressora: ${printerName.replace(/</g, '')}</p>
    <p>Papel: ${widthMm} mm</p>
    <p>Margens L/R: ${settings.printMarginLeft} / ${settings.printMarginRight} mm</p>
    <p>Data: ${now}</p>
    <div class="print-divider"></div>
    <p style="text-align:center">POSly - teste OK</p>
    <p style="text-align:center">1234567890 ABCDEF</p>
    ${footer ? `<div class="print-extra-footer ${footerAlign}">${footer.replace(/</g, '&lt;')}</div>` : ''}
  </div>
</body>
</html>`;
}

function MarginField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="flex flex-col items-center gap-1">
      <span className="text-[11px] text-zinc-400">{label}</span>
      <input
        type="number"
        step="0.5"
        min={-20}
        max={20}
        value={Number.isFinite(value) ? value : 0}
        onChange={(event) => onChange(Number(event.target.value))}
        className="h-9 w-14 rounded border border-zinc-600 bg-[#1f1f1f] text-center text-sm text-white outline-none focus:border-[#00a3e0]"
      />
    </div>
  );
}

function AlignButtons({
  value,
  onChange,
}: {
  value: 'left' | 'center';
  onChange: (value: 'left' | 'center') => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={() => onChange('left')}
        className={`flex h-8 w-8 items-center justify-center rounded border ${
          value === 'left' ? 'border-[#00a3e0] bg-[#00a3e0]/20 text-[#00a3e0]' : 'border-zinc-600 text-zinc-400'
        }`}
        aria-label="Alinhar à esquerda"
      >
        <AlignLeft size={14} />
      </button>
      <button
        type="button"
        onClick={() => onChange('center')}
        className={`flex h-8 w-8 items-center justify-center rounded border ${
          value === 'center' ? 'border-[#00a3e0] bg-[#00a3e0]/20 text-[#00a3e0]' : 'border-zinc-600 text-zinc-400'
        }`}
        aria-label="Centrar"
      >
        <AlignCenter size={14} />
      </button>
    </div>
  );
}

export function ReceiptPrinterSettingsModal({
  isOpen,
  onClose,
  draft,
  onChange,
  printerName,
}: {
  isOpen: boolean;
  onClose: () => void;
  draft: PosSettings;
  onChange: (next: PosSettings) => void;
  printerName: string;
}) {
  const [tab, setTab] = useState<SettingsTab>('general');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setTab('general');
    setStatus('');
  }, [isOpen]);

  const update = <K extends keyof PosSettings>(key: K, value: PosSettings[K]) => {
    onChange({ ...draft, [key]: value });
  };

  const handleTestPrint = async () => {
    setBusy(true);
    setStatus('A enviar página de teste...');
    try {
      if (!window.electronAPI?.printReceipt) {
        setStatus('Impressão de teste disponível na app desktop (Electron).');
        return;
      }
      const html = buildTestPageHtml(draft, printerName || 'Impressora');
      const widthMm = draft.printPaperWidth === '58' ? 58 : 80;
      const result = await window.electronAPI.printReceipt(html, {
        printer: printerName || undefined,
        copies: draft.printCopies,
        widthMm,
        heightMm: 120,
      });
      if (result?.success) {
        setStatus(`Página de teste enviada para ${result.printer || printerName}.`);
      } else {
        setStatus(result?.error || 'Falha ao imprimir página de teste.');
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Falha ao imprimir.');
    } finally {
      setBusy(false);
    }
  };

  const handleTestDrawer = async () => {
    setBusy(true);
    setStatus('A enviar comando ESC/POS para a gaveta...');
    try {
      if (!draft.printOpenDrawer) {
        setStatus('Active "Abrir a gaveta do dinheiro" antes de testar.');
        return;
      }
      if (!printerName?.trim()) {
        setStatus('Seleccione a impressora de recibos (ex.: XP-80C).');
        return;
      }
      if (!window.electronAPI?.openCashDrawer) {
        setStatus('Teste de gaveta só funciona na app desktop (Electron). Reinicie o Electron.');
        return;
      }
      // O RJ11 tem de estar na impressora de recibos (XP-80C), não noutro sistema.
      const result = await window.electronAPI.openCashDrawer({
        printer: printerName,
        command: draft.printDrawerCommand || '1B700019FA',
        tryBothPins: true,
      });
      if (result?.success) {
        setStatus(
          `Gaveta: comando ${result.commandHex || 'ESC/POS'} enviado para ${result.printer || printerName}.`,
        );
      } else {
        setStatus(
          result?.error ||
            'Falha ao abrir gaveta. Confirme que o RJ11 está na XP-80C (não noutro PC/sistema).',
        );
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Falha ao testar gaveta.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AnimatePresence>
      {isOpen ? (
        <div
          className="fixed inset-0 z-[130] flex items-center justify-center p-4"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-black/70"
          />
          <motion.div
            initial={{ opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
            transition={{ duration: 0.18 }}
            className="relative flex max-h-[min(900px,92vh)] w-full max-w-[720px] flex-col overflow-hidden rounded border border-zinc-700 bg-[#2b2b2b] shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex shrink-0 items-start justify-between border-b border-zinc-700/80 px-6 pt-5 pb-3">
              <div>
                <h2 className="text-xl font-semibold tracking-tight text-white">
                  Impressora de recibos
                </h2>
                <div className="mt-3 flex items-center gap-2 text-sm font-semibold text-white">
                  <Printer size={16} className="text-zinc-300" />
                  <span>{printerName || 'Sem impressora'}</span>
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="rounded p-2 text-zinc-300 transition-colors hover:bg-zinc-700 hover:text-white"
                aria-label="Fechar"
              >
                <ArrowRight size={20} />
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-4 custom-scrollbar">
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-[1fr_auto]">
              <div className="min-w-0 space-y-4">
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-zinc-300">Tipo de impressora</span>
                    <HelpLink />
                  </div>
                  <FieldSelect
                    value={draft.printPrinterType || 'windows'}
                    onChange={(value) => update('printPrinterType', value)}
                    options={[
                      { value: 'windows', label: 'Impressora do Windows' },
                      { value: 'escpos', label: 'ESC/POS (térmica USB/COM)' },
                    ]}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <span className="text-sm text-zinc-300">Tamanho do papel</span>
                  <FieldSelect
                    value={draft.printPaperWidth}
                    onChange={(value) => update('printPaperWidth', value)}
                    options={[
                      { value: '58', label: '58 mm' },
                      { value: '80', label: '80 mm' },
                    ]}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <span className="text-sm text-zinc-300">Número de cópias</span>
                  <CopiesStepper
                    value={Number(draft.printCopies) || 1}
                    onChange={(value) => update('printCopies', value)}
                  />
                </div>
              </div>

              <button
                type="button"
                disabled={busy}
                onClick={() => void handleTestPrint()}
                className="flex h-[120px] w-full shrink-0 flex-col items-center justify-center gap-3 rounded border border-zinc-500 bg-transparent text-center text-sm text-zinc-100 transition-colors hover:border-zinc-300 hover:bg-zinc-800/40 disabled:opacity-60 sm:h-[148px] sm:w-[168px]"
              >
                <Printer size={28} className="text-zinc-200" />
                <span className="leading-snug px-2">Imprimir página de teste</span>
              </button>
            </div>

            <div className="relative mt-5">
              <div className="flex items-end gap-1 border-b-2 border-[#00a3e0]">
                {TABS.map((item) => {
                  const active = tab === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setTab(item.id)}
                      className={`relative px-4 py-2.5 text-sm transition-colors ${
                        active
                          ? 'bg-[#00a3e0] text-white'
                          : 'bg-transparent text-zinc-400 hover:text-zinc-200'
                      }`}
                    >
                      {item.label}
                      {active ? (
                        <span className="absolute left-1/2 top-full h-0 w-0 -translate-x-1/2 border-x-[6px] border-t-[7px] border-x-transparent border-t-[#00a3e0]" />
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="min-h-[160px] py-5">
              {tab === 'general' ? (
                <div className="space-y-6">
                  <div>
                    <h4 className="mb-4 text-sm font-semibold text-white">Margens (em milímetros)</h4>
                    <div className="flex flex-col items-center gap-2">
                      <MarginField
                        label="Acima"
                        value={Number(draft.printMarginTop) || 0}
                        onChange={(value) => update('printMarginTop', value)}
                      />
                      <div className="flex items-center gap-4">
                        <MarginField
                          label="Esquerda"
                          value={Number(draft.printMarginLeft) || 0}
                          onChange={(value) => update('printMarginLeft', value)}
                        />
                        <div className="flex h-16 w-12 items-center justify-center rounded border border-zinc-600 bg-[#1f1f1f] text-zinc-500">
                          <FileText size={22} />
                        </div>
                        <MarginField
                          label="Direita"
                          value={Number(draft.printMarginRight) || 0}
                          onChange={(value) => update('printMarginRight', value)}
                        />
                      </div>
                      <MarginField
                        label="Abaixo"
                        value={Number(draft.printMarginBottom) || 0}
                        onChange={(value) => update('printMarginBottom', value)}
                      />
                    </div>
                    <p className="mt-3 text-center text-xs text-zinc-500">
                      Aumente a margem esquerda para afastar da borda; diminua (ou use valor negativo) para
                      puxar o texto para a esquerda.
                    </p>
                  </div>

                  <div>
                    <h4 className="mb-2 text-sm font-semibold text-white">Cabeçalho</h4>
                    <div className="flex gap-2">
                      <textarea
                        value={draft.printExtraHeader || ''}
                        onChange={(event) => update('printExtraHeader', event.target.value)}
                        rows={3}
                        placeholder="Texto extra no topo do recibo (opcional)"
                        className="min-h-[72px] flex-1 resize-y rounded border border-zinc-600 bg-[#1f1f1f] px-3 py-2 text-sm text-white outline-none focus:border-[#00a3e0]"
                      />
                      <AlignButtons
                        value={draft.printHeaderAlign || 'center'}
                        onChange={(value) => update('printHeaderAlign', value)}
                      />
                    </div>
                  </div>

                  <div>
                    <h4 className="mb-2 text-sm font-semibold text-white">Rodapé</h4>
                    <div className="flex gap-2">
                      <textarea
                        value={draft.printExtraFooter || ''}
                        onChange={(event) => update('printExtraFooter', event.target.value)}
                        rows={3}
                        placeholder="Texto extra no fim do recibo (opcional)"
                        className="min-h-[72px] flex-1 resize-y rounded border border-zinc-600 bg-[#1f1f1f] px-3 py-2 text-sm text-white outline-none focus:border-[#00a3e0]"
                      />
                      <AlignButtons
                        value={draft.printFooterAlign || 'center'}
                        onChange={(value) => update('printFooterAlign', value)}
                      />
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-4 border-t border-zinc-700 pt-4">
                    <div>
                      <p className="text-sm text-white">Cortar papel após imprimir</p>
                      <p className="text-xs text-zinc-500">Se a impressora tiver cortador automático.</p>
                    </div>
                    <PillToggle
                      checked={draft.printCutPaper}
                      onChange={(value) => update('printCutPaper', value)}
                    />
                  </div>
                </div>
              ) : null}

              {tab === 'drawer' ? (
                <div className="space-y-5">
                  <div className="flex items-center gap-3">
                    <PillToggle
                      checked={draft.printOpenDrawer}
                      onChange={(value) => update('printOpenDrawer', value)}
                    />
                    <span className="text-sm text-zinc-100">Abrir a gaveta do dinheiro</span>
                  </div>

                  <div>
                    <div className="mb-1.5 flex items-center gap-2">
                      <span className="text-sm text-zinc-300">Comando de gaveta de dinheiro</span>
                      <HelpLink />
                    </div>
                    <input
                      type="text"
                      value={draft.printDrawerCommand}
                      onChange={(event) => update('printDrawerCommand', event.target.value)}
                      placeholder="1B700019FA"
                      disabled={!draft.printOpenDrawer}
                      className="h-10 w-full max-w-md rounded border border-zinc-600 bg-[#1f1f1f] px-3 text-sm text-white outline-none focus:border-[#00a3e0] disabled:opacity-50"
                    />
                  </div>

                  <button
                    type="button"
                    disabled={busy || !draft.printOpenDrawer}
                    onClick={() => void handleTestDrawer()}
                    className="rounded border border-zinc-500 px-5 py-2.5 text-sm text-zinc-100 transition-colors hover:border-zinc-300 hover:bg-zinc-800/50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Testar gaveta
                  </button>
                </div>
              ) : null}

              {tab === 'advanced' ? (
                <div className="space-y-4">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <p className="text-sm text-white">Sinal sonoro ao imprimir</p>
                      <p className="text-xs text-zinc-500">Beep da impressora (se suportado).</p>
                    </div>
                    <PillToggle
                      checked={draft.printBeepOnPrint}
                      onChange={(value) => update('printBeepOnPrint', value)}
                    />
                  </div>
                  <p className="text-xs text-zinc-500">
                    Opções avançadas aplicam-se na próxima impressão de recibo. Em impressoras
                    Windows, alguns comandos ESC/POS dependem do driver.
                  </p>
                </div>
              ) : null}

              {status ? <p className="mt-4 text-xs text-zinc-400">{status}</p> : null}
            </div>
            </div>
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>
  );
}
