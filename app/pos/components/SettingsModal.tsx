'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Check, Minus, Plus, X } from 'lucide-react';
import {
  DEFAULT_POS_SETTINGS,
  loadPosSettings,
  savePosSettings,
  type PosSettings,
  type PosSettingsSection,
} from '@/lib/posSettings';
import { listCustomerDisplayPorts, writeCustomerDisplay, type SerialPortOption } from '@/lib/customerDisplayClient';
import { PrintOptionsPanel } from './PrintOptionsPanel';
import { LocationsSettingsPanel } from './LocationsSettingsPanel';
import { StationsSettingsPanel } from './StationsSettingsPanel';
import PosSelect from '@/components/PosSelect';
import { PosSwitch } from '@/components/PosSwitch';
import { useCommerceProfile } from '@/lib/useCommerceProfile';
import { commerceTypeLabel, type CommerceFeatures } from '@/lib/commerceProfile';
import { formatDateTime24h } from '@/lib/formatDateTime';

const ALL_SECTIONS: Array<{
  id: PosSettingsSection;
  label: string;
  /** Se definido, só mostra quando a feature da licença está activa */
  requireFeature?: keyof CommerceFeatures;
}> = [
  { id: 'basicas', label: 'Configurações básicas' },
  { id: 'postos', label: 'Postos' },
  { id: 'locais', label: 'Locais', requireFeature: 'locations' },
  { id: 'pedidos', label: 'Pedidos & Pagamentos' },
  { id: 'produtos', label: 'Configurações de produtos' },
  // Farmácia: secção oculta até módulos (lotes/validade/receita) estarem prontos
  { id: 'documentos', label: 'Documents' },
  { id: 'balanca', label: 'Balança' },
  { id: 'display', label: 'Display do cliente' },
  { id: 'email', label: 'Configurações de email' },
  { id: 'impressao', label: 'Opções de impressão' },
  { id: 'banco', label: 'Banco de dados' },
  { id: 'licenca', label: 'Licença' },
  { id: 'sobre', label: 'Sobre' },
];

function FieldRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[180px_minmax(0,1fr)] items-center gap-4 py-2.5">
      <label className="text-sm text-zinc-300">{label}</label>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function SelectField({
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
      triggerClassName="!bg-[#171717] !border-zinc-600"
    />
  );
}

function TextField({
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
      className="h-9 w-full max-w-[420px] rounded border border-zinc-600 bg-[#171717] px-3 text-sm text-white outline-none focus:border-[#0001fb]"
    />
  );
}

function NumberStepper({
  value,
  onChange,
  min = 1,
  max = 99,
}: {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
}) {
  return (
    <div className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={() => onChange(Math.max(min, value - 1))}
        className="flex h-8 w-8 items-center justify-center rounded border border-zinc-600 bg-[#171717] text-zinc-300 hover:text-white"
      >
        <Minus size={14} />
      </button>
      <span className="min-w-[2rem] text-center text-sm font-semibold text-white">{value}</span>
      <button
        type="button"
        onClick={() => onChange(Math.min(max, value + 1))}
        className="flex h-8 w-8 items-center justify-center rounded border border-zinc-600 bg-[#171717] text-zinc-300 hover:text-white"
      >
        <Plus size={14} />
      </button>
    </div>
  );
}

const CUSTOMER_DISPLAY_PORT_DEFAULTS = {
  customerDisplayBaud: '9600',
  customerDisplayDataBits: '8',
  customerDisplayParity: 'None',
  customerDisplayStopBits: '1',
  customerDisplayFlowControl: 'None',
} as const;

export function SettingsModal({
  isOpen,
  onClose,
  initialSection = 'display',
}: {
  isOpen: boolean;
  onClose: () => void;
  initialSection?: PosSettingsSection;
}) {
  const [activeSection, setActiveSection] = useState<PosSettingsSection>(initialSection);
  const [draft, setDraft] = useState<PosSettings>(DEFAULT_POS_SETTINGS);
  const [showPortSettings, setShowPortSettings] = useState(false);
  const [saveMessage, setSaveMessage] = useState('');
  const [testMessage, setTestMessage] = useState('');
  const [availablePorts, setAvailablePorts] = useState<SerialPortOption[]>([]);
  const [portsError, setPortsError] = useState('');
  const { features, label: commerceLabel, license, loading: licenseLoading, refresh: refreshCommerceProfile } =
    useCommerceProfile();

  const SECTIONS = useMemo(
    () =>
      ALL_SECTIONS.filter((section) => {
        if (!section.requireFeature) return true;
        return Boolean(features[section.requireFeature]);
      }),
    [features],
  );

  useEffect(() => {
    if (!isOpen) return;
    setDraft(loadPosSettings());
    const allowed = ALL_SECTIONS.filter((section) => {
      if (!section.requireFeature) return true;
      return Boolean(features[section.requireFeature]);
    }).map((s) => s.id);
    setActiveSection(allowed.includes(initialSection) ? initialSection : allowed[0] || 'basicas');
    setShowPortSettings(false);
    setSaveMessage('');
    setTestMessage('');
    setPortsError('');
    void refreshPorts();
    void refreshCommerceProfile();
  }, [isOpen, initialSection, features, refreshCommerceProfile]);

  const refreshPorts = async () => {
    setPortsError('');
    try {
      const ports = await listCustomerDisplayPorts();
      setAvailablePorts(ports);
      if (!ports.length) {
        setPortsError('Nenhuma porta COM encontrada. Verifique o Device Manager e clique em Actualizar lista.');
      }
    } catch (error) {
      setAvailablePorts([]);
      setPortsError(error instanceof Error ? error.message : 'Falha ao listar portas COM.');
    }
  };

  const update = <K extends keyof PosSettings>(key: K, value: PosSettings[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const handleSave = async () => {
    const next = { ...draft };
    if (next.customerDisplayEnabled && !String(next.customerDisplayPort || '').trim()) {
      setSaveMessage('Seleccione a porta COM do display antes de salvar.');
      return;
    }

    savePosSettings(next);
    setSaveMessage(
      next.customerDisplayEnabled && next.customerDisplayPort
        ? `Configurações guardadas. Porta ${next.customerDisplayPort}.`
        : 'Configurações guardadas.',
    );

    if (next.customerDisplayEnabled && next.customerDisplayPort) {
      void writeCustomerDisplay(next.welcomeTop || 'BEM VINDO!', next.welcomeBottom || '', {
        settings: next,
        force: true,
      });
    }

    window.setTimeout(() => {
      setSaveMessage('');
      onClose();
    }, 700);
  };

  const handleTestDisplay = async () => {
    const top = draft.welcomeTop.trim() || 'BEM VINDO!';
    const bottom = draft.welcomeBottom.trim();
    if (!String(draft.customerDisplayPort || '').trim()) {
      setTestMessage('Seleccione a porta COM (ex.: COM9) antes de testar.');
      return;
    }
    setTestMessage('A enviar para o display...');

    const result = await writeCustomerDisplay(top, bottom, {
      settings: { ...draft, customerDisplayEnabled: true },
      force: true,
    });
    if (!result.success) {
      const err =
        typeof result.error === 'string'
          ? result.error
          : result.error && typeof result.error === 'object' && 'message' in (result.error as object)
            ? String((result.error as { message?: unknown }).message)
            : 'Falha no teste do display.';
      setTestMessage(err || 'Falha no teste do display.');
      return;
    }
    setTestMessage(`Mensagem enviada para ${result.port || draft.customerDisplayPort}.`);
  };

  const sectionTitle = useMemo(
    () => SECTIONS.find((section) => section.id === activeSection)?.label ?? 'Configurações',
    [activeSection],
  );

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-4" onClick={onClose}>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-black/80 backdrop-blur-sm"
          />
          <motion.div
            initial={{ scale: 0.96, opacity: 0, y: 12 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.96, opacity: 0, y: 12 }}
            className="relative flex h-[min(860px,92vh)] w-full max-w-5xl overflow-hidden rounded border border-zinc-700 bg-[#1e1e1e] shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <aside className="flex w-[240px] shrink-0 flex-col border-r border-zinc-800 bg-[#171717]">
              <div className="border-b border-zinc-800 px-5 py-4">
                <h2 className="text-lg font-semibold text-white">Configurações</h2>
              </div>
              <nav className="flex-1 overflow-y-auto py-2 custom-scrollbar">
                {SECTIONS.map((section) => {
                  const active = activeSection === section.id;
                  return (
                    <button
                      key={section.id}
                      type="button"
                      onClick={() => setActiveSection(section.id)}
                      className={`w-full px-5 py-2.5 text-left text-sm transition-colors ${
                        active
                          ? 'bg-[#0001fb] text-white'
                          : 'text-zinc-400 hover:bg-[var(--pos-brand-hover-bg)] hover:text-white'
                      }`}
                    >
                      {section.label}
                    </button>
                  );
                })}
              </nav>
            </aside>

            <div className="flex min-w-0 flex-1 flex-col">
              <div className="flex items-center justify-between border-b border-zinc-800 px-6 py-4">
                <div className="flex items-center gap-3">
                  <h3 className="text-base font-semibold text-white">{sectionTitle}</h3>
                  {activeSection === 'display' || activeSection === 'impressao' ? (
                    <button type="button" className="text-xs font-medium text-[#0001fb] hover:underline">
                      Saiba mais
                    </button>
                  ) : null}
                </div>
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded p-2 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-white"
                  aria-label="Fechar"
                >
                  <X size={18} />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto px-6 py-5 custom-scrollbar">
                {activeSection === 'basicas' && (
                  <div className="max-w-2xl space-y-1">
                    <FieldRow label="Idioma">
                      <SelectField
                        value={draft.language}
                        onChange={(value) => update('language', value)}
                        options={[
                          { value: 'pt-MZ', label: 'Português (Moçambique)' },
                          { value: 'pt-PT', label: 'Português (Portugal)' },
                          { value: 'en', label: 'English' },
                        ]}
                      />
                    </FieldRow>
                    <FieldRow label="Moeda">
                      <SelectField
                        value={draft.currency}
                        onChange={(value) => update('currency', value)}
                        options={[
                          { value: 'MT', label: 'Metical (MT)' },
                          { value: 'USD', label: 'Dólar (USD)' },
                          { value: 'EUR', label: 'Euro (EUR)' },
                        ]}
                      />
                    </FieldRow>
                    <FieldRow label="Arredondar dinheiro">
                      <PosSwitch checked={draft.roundCash} onChange={(value) => update('roundCash', value)} />
                    </FieldRow>
                  </div>
                )}

                {activeSection === 'postos' ? <StationsSettingsPanel /> : null}

                {activeSection === 'locais' && features.locations ? <LocationsSettingsPanel /> : null}

                {activeSection === 'pedidos' && (
                  <div className="max-w-2xl space-y-1">
                    {features.tables ? (
                      <FieldRow label="Pedir mesa">
                        <PosSwitch checked={draft.askTable} onChange={(value) => update('askTable', value)} />
                      </FieldRow>
                    ) : null}
                    <FieldRow label="Imprimir recibo automaticamente">
                      <PosSwitch
                        checked={draft.printJobs.receipt.enabled}
                        onChange={(value) =>
                          setDraft((current) => ({
                            ...current,
                            autoPrintReceipt: value,
                            printJobs: {
                              ...current.printJobs,
                              receipt: { ...current.printJobs.receipt, enabled: value },
                            },
                          }))
                        }
                      />
                    </FieldRow>
                  </div>
                )}

                {activeSection === 'produtos' && (
                  <div className="max-w-2xl space-y-1">
                    <FieldRow label="Permitir stock negativo">
                      <PosSwitch
                        checked={draft.allowNegativeStock}
                        onChange={(value) => update('allowNegativeStock', value)}
                      />
                    </FieldRow>
                    <FieldRow label="Mostrar produtos sem stock">
                      <PosSwitch
                        checked={draft.showOutOfStock}
                        onChange={(value) => update('showOutOfStock', value)}
                      />
                    </FieldRow>
                  </div>
                )}

                {activeSection === 'documentos' && (
                  <div className="max-w-2xl space-y-1">
                    <FieldRow label="Documento padrão">
                      <SelectField
                        value={draft.defaultDocType}
                        onChange={(value) => update('defaultDocType', value)}
                        options={[
                          { value: 'VD', label: 'Venda a dinheiro (VD)' },
                          { value: 'FT', label: 'Fatura (FT)' },
                          { value: 'FP', label: 'Cotação (FP)' },
                        ]}
                      />
                    </FieldRow>
                  </div>
                )}

                {activeSection === 'balanca' && (
                  <div className="max-w-2xl space-y-1">
                    <FieldRow label="Habilitado">
                      <PosSwitch checked={draft.scaleEnabled} onChange={(value) => update('scaleEnabled', value)} />
                    </FieldRow>
                    <FieldRow label="Porta COM">
                      <TextField
                        value={draft.scalePort}
                        onChange={(value) => update('scalePort', value)}
                        placeholder="COM3"
                      />
                    </FieldRow>
                  </div>
                )}

                {activeSection === 'display' && (
                  <div className="max-w-2xl space-y-1">
                    <p className="mb-3 text-xs text-zinc-500">
                      Visor de cliente de 2 linhas (ex.: 2×20). Quando activado, mostra boas-vindas, item e total no POS.
                    </p>
                    <FieldRow label="Habilitado">
                      <PosSwitch
                        checked={draft.customerDisplayEnabled}
                        onChange={(value) => {
                          update('customerDisplayEnabled', value);
                          if (value) void refreshPorts();
                        }}
                      />
                    </FieldRow>
                    <FieldRow label="Porta COM">
                      <div className="flex flex-wrap items-center gap-3">
                        <SelectField
                          value={draft.customerDisplayPort || ''}
                          onChange={(value) => update('customerDisplayPort', value)}
                          options={[
                            { value: '', label: 'Seleccionar porta...' },
                            ...availablePorts.map((port) => ({
                              value: port.path,
                              label: port.label,
                            })),
                            ...(draft.customerDisplayPort &&
                            !availablePorts.some((port) => port.path === draft.customerDisplayPort)
                              ? [{ value: draft.customerDisplayPort, label: draft.customerDisplayPort }]
                              : []),
                          ]}
                        />
                        <button
                          type="button"
                          onClick={() => void refreshPorts()}
                          className="text-xs font-medium text-[#0001fb] hover:underline"
                        >
                          Actualizar lista
                        </button>
                        <button
                          type="button"
                          onClick={() => setShowPortSettings((current) => !current)}
                          className="text-xs font-medium text-[#0001fb] hover:underline"
                        >
                          {showPortSettings ? 'Ocultar configurações de porta' : 'Mostrar configurações de porta'}
                        </button>
                      </div>
                      {portsError ? (
                        <p className="mt-1 text-[11px] text-amber-400">{portsError}</p>
                      ) : null}
                    </FieldRow>

                    {showPortSettings ? (
                      <div className="ml-[180px] space-y-1 border-l border-zinc-800 pl-4">
                        <FieldRow label="Bits por segundo">
                          <SelectField
                            value={draft.customerDisplayBaud}
                            onChange={(value) => update('customerDisplayBaud', value)}
                            options={[
                              { value: '2400', label: '2400' },
                              { value: '4800', label: '4800' },
                              { value: '9600', label: '9600' },
                              { value: '19200', label: '19200' },
                            ]}
                          />
                        </FieldRow>
                        <FieldRow label="Bits de dados">
                          <SelectField
                            value={draft.customerDisplayDataBits}
                            onChange={(value) => update('customerDisplayDataBits', value)}
                            options={[
                              { value: '7', label: '7' },
                              { value: '8', label: '8' },
                            ]}
                          />
                        </FieldRow>
                        <FieldRow label="Paridade">
                          <SelectField
                            value={draft.customerDisplayParity}
                            onChange={(value) => update('customerDisplayParity', value)}
                            options={[
                              { value: 'None', label: 'None' },
                              { value: 'Even', label: 'Even' },
                              { value: 'Odd', label: 'Odd' },
                            ]}
                          />
                        </FieldRow>
                        <FieldRow label="Bits de parada">
                          <SelectField
                            value={draft.customerDisplayStopBits}
                            onChange={(value) => update('customerDisplayStopBits', value)}
                            options={[
                              { value: '1', label: '1' },
                              { value: '2', label: '2' },
                            ]}
                          />
                        </FieldRow>
                        <FieldRow label="Controle de fluxo">
                          <SelectField
                            value={draft.customerDisplayFlowControl}
                            onChange={(value) => update('customerDisplayFlowControl', value)}
                            options={[
                              { value: 'None', label: 'None' },
                              { value: 'Xon/Xoff', label: 'Xon/Xoff' },
                              { value: 'Hardware', label: 'Hardware' },
                            ]}
                          />
                        </FieldRow>
                        <div className="pt-1">
                          <button
                            type="button"
                            onClick={() =>
                              setDraft((current) => ({
                                ...current,
                                ...CUSTOMER_DISPLAY_PORT_DEFAULTS,
                              }))
                            }
                            className="text-xs font-medium text-[#0001fb] hover:underline"
                          >
                            Restaurar padrões
                          </button>
                        </div>
                      </div>
                    ) : null}

                    <FieldRow label="Número de caracteres">
                      <NumberStepper
                        value={draft.customerDisplayChars}
                        min={8}
                        max={40}
                        onChange={(value) => update('customerDisplayChars', value)}
                      />
                    </FieldRow>

                    <div className="mt-6 border-t border-zinc-800 pt-4">
                      <h4 className="mb-3 text-sm font-semibold text-white">Mensagem de boas-vindas</h4>
                      <FieldRow label="Linha superior">
                        <TextField
                          value={draft.welcomeTop}
                          onChange={(value) => update('welcomeTop', value)}
                          placeholder="BEM VINDO!"
                        />
                      </FieldRow>
                      <FieldRow label="Linha inferior">
                        <TextField
                          value={draft.welcomeBottom}
                          onChange={(value) => update('welcomeBottom', value)}
                        />
                      </FieldRow>
                      <div className="mt-4 ml-[180px] space-y-3">
                        <div>
                          <button
                            type="button"
                            onClick={() => void handleTestDisplay()}
                            className="rounded border border-zinc-600 bg-[#171717] px-4 py-2 text-sm text-zinc-200 hover:border-[#0001fb] hover:text-white"
                          >
                            Tela de teste
                          </button>
                          {testMessage ? (
                            <p className="mt-2 text-xs text-zinc-400">{testMessage}</p>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {activeSection === 'email' && (
                  <div className="max-w-2xl space-y-1">
                    <FieldRow label="Servidor SMTP">
                      <TextField value={draft.emailHost} onChange={(value) => update('emailHost', value)} placeholder="smtp.exemplo.com" />
                    </FieldRow>
                    <FieldRow label="Porta">
                      <TextField value={draft.emailPort} onChange={(value) => update('emailPort', value)} />
                    </FieldRow>
                    <FieldRow label="Utilizador">
                      <TextField value={draft.emailUser} onChange={(value) => update('emailUser', value)} />
                    </FieldRow>
                    <FieldRow label="Remetente">
                      <TextField value={draft.emailFrom} onChange={(value) => update('emailFrom', value)} />
                    </FieldRow>
                  </div>
                )}

                {activeSection === 'impressao' && (
                  <PrintOptionsPanel
                    draft={draft}
                    onChange={setDraft}
                    showPrintCenters={features.printCenters}
                  />
                )}

                {activeSection === 'banco' && (
                  <div className="max-w-2xl space-y-3 text-sm text-zinc-400">
                    <p>Os dados do POS são guardados localmente na base SQLite do tenant.</p>
                    <p>Use o módulo de sincronização no painel de gestão para enviar/receber dados da nuvem.</p>
                  </div>
                )}

                {activeSection === 'licenca' && (
                  <div className="max-w-2xl space-y-1">
                    <p className="mb-3 text-sm text-zinc-400">
                      A licença é gerida na activação da aplicação desktop. Os dados abaixo são só de leitura.
                    </p>
                    {licenseLoading ? (
                      <p className="text-sm text-zinc-500">A carregar dados da licença…</p>
                    ) : (
                      <div className="divide-y divide-zinc-800/80">
                        <FieldRow label="Nome da licença">
                          <p className="text-sm text-zinc-100">{license.name}</p>
                        </FieldRow>
                        <FieldRow label="NUIT">
                          <p className="font-mono text-sm text-zinc-100">{license.nuit}</p>
                        </FieldRow>
                        <FieldRow label="Tipo de comércio">
                          <p className="text-sm text-zinc-100">
                            {commerceTypeLabel(license.commerceType) || commerceLabel}
                          </p>
                        </FieldRow>
                        <FieldRow label="Tipo de licença">
                          <p className="text-sm text-zinc-100">{license.licenseType}</p>
                        </FieldRow>
                        <FieldRow label="Data de validade">
                          <p className="text-sm text-zinc-100">
                            {formatDateTime24h(license.licenseExpiresAt)}
                          </p>
                        </FieldRow>
                      </div>
                    )}
                    <p className="mt-4 text-sm text-zinc-500">
                      Para renovar ou reactivar, use o ecrã de activação ou contacte o suporte.
                    </p>
                  </div>
                )}

                {activeSection === 'sobre' && (
                  <div className="max-w-2xl space-y-2 text-sm text-zinc-300">
                    <p className="text-base font-semibold text-white">POSly</p>
                    <p className="text-zinc-400">Sistema de ponto de venda para Moçambique.</p>
                    <p className="text-zinc-500">Versão desktop / web local</p>
                  </div>
                )}
              </div>

              <div className="flex items-center justify-end gap-3 border-t border-zinc-800 bg-[#1a1a1a] px-6 py-4">
                {saveMessage ? <span className="mr-auto text-sm text-[#a5b4fc]">{saveMessage}</span> : null}
                <button
                  type="button"
                  onClick={handleSave}
                  className="inline-flex items-center gap-2 rounded bg-[#0001fb] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#1a1bff]"
                >
                  <Check size={16} />
                  Salvar
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="inline-flex items-center gap-2 rounded bg-red-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-red-500"
                >
                  <X size={16} />
                  Cancelar
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
