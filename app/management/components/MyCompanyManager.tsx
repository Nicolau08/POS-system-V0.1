'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Check, HelpCircle, FolderOpen, Eraser, AlertTriangle, Plus, Pencil, Trash2 } from 'lucide-react';
import type { CompanyProfile } from '@/app/pos/types';
import { getPosApiBase } from '@/lib/apiBase';
import {
  fetchCompanyProfile,
  saveCompanyProfile,
  resetDatabase,
  listDatabaseBackups,
} from '@/lib/services/posService';
import { getPosCatalogCache, patchPosCatalogCache } from '@/lib/posSessionCache';
import { ensureCompactReceiptLogo } from '@/lib/compressReceiptLogo';
import DatabaseBackupPanel from '@/app/management/components/DatabaseBackupPanel';
import { useCommerceProfile } from '@/lib/useCommerceProfile';
import PosSelect from '@/components/PosSelect';
import {
  COMPANY_BANK_CURRENCY_OPTIONS,
  createEmptyBankAccountDraft,
  parseCompanyBankAccounts,
  serializeCompanyBankAccounts,
  type CompanyBankAccount,
} from '@/lib/companyBankDetails';

const emptyForm = (): CompanyProfile => ({
  name: '',
  taxId: '',
  street: '',
  buildingNumber: '',
  additionalStreet: '',
  plotIdentification: '',
  district: '',
  city: '',
  state: '',
  country: 'Moçambique',
  phone: '',
  email: '',
  bankAccountNumber: '',
  bankDetails: '',
  logoDataUrl: null,
  voidReasons: [],
  updatedAt: null,
});

function FieldRow({
  label,
  children,
  required,
  showDivider = true,
  fixedLabelWidth = false,
}: {
  label: string;
  children: React.ReactNode;
  required?: boolean;
  showDivider?: boolean;
  fixedLabelWidth?: boolean;
}) {
  const gridColsClass = fixedLabelWidth
    ? 'grid grid-cols-1 sm:grid-cols-[220px_1fr]'
    : 'grid grid-cols-1 sm:grid-cols-[minmax(160px,220px)_1fr]';

  return (
    <div
      className={`${gridColsClass} gap-x-4 gap-y-1 items-center ${
        showDivider ? 'border-b border-pos-border/60 py-2.5' : 'py-2.5'
      }`}
    >
      <label className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
        {label}
        {required ? <span className="sr-only"> (obrigatório)</span> : null}
      </label>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export default function MyCompanyManager() {
  const { license } = useCommerceProfile();
  const [innerTab, setInnerTab] = useState<'dados' | 'backups' | 'reset'>('dados');
  const [form, setForm] = useState<CompanyProfile>(
    () => getPosCatalogCache()?.companyProfile ?? emptyForm()
  );
  const [bankAccounts, setBankAccounts] = useState<CompanyBankAccount[]>(() => {
    const cached = getPosCatalogCache()?.companyProfile;
    return cached
      ? parseCompanyBankAccounts(cached.bankDetails, cached.bankAccountNumber)
      : [];
  });
  const [bankDraft, setBankDraft] = useState<CompanyBankAccount>(() => createEmptyBankAccountDraft());
  const [editingBankId, setEditingBankId] = useState<string | null>(null);
  const [loading, setLoading] = useState(() => !getPosCatalogCache()?.companyProfile);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const [resetBackupPath, setResetBackupPath] = useState('');
  const [resetSelections, setResetSelections] = useState({
    products: true,
    customers: true,
    documents: true,
  });
  const [adminPassword, setAdminPassword] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const licenseName =
    license.name && license.name !== '—' ? license.name.trim() : '';
  const licenseNuit =
    license.nuit && license.nuit !== '—' ? license.nuit.trim() : '';

  useEffect(() => {
    void listDatabaseBackups()
      .then((data) => {
        if (data.backupsDir) setResetBackupPath(data.backupsDir);
      })
      .catch(() => {
        /* ignore */
      });
  }, []);

  const load = useCallback(async () => {
    const hasCache = Boolean(getPosCatalogCache()?.companyProfile);
    if (!hasCache) setLoading(true);
    setMessage(null);
    try {
      const data = await fetchCompanyProfile();
      const next = {
        ...data,
        name: licenseName || data.name || '',
        taxId: licenseNuit || data.taxId || '',
        country: 'Moçambique',
      };
      setForm(next);
      setBankAccounts(parseCompanyBankAccounts(next.bankDetails, next.bankAccountNumber));
      setBankDraft(createEmptyBankAccountDraft());
      setEditingBankId(null);
      patchPosCatalogCache({ companyProfile: next });
    } catch (e) {
      setMessage({ type: 'err', text: e instanceof Error ? e.message : 'Falha ao carregar dados da empresa' });
      if (!getPosCatalogCache()?.companyProfile) setForm(emptyForm());
    } finally {
      setLoading(false);
    }
  }, [licenseName, licenseNuit]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!licenseName && !licenseNuit) return;
    setForm((current) => ({
      ...current,
      name: licenseName || current.name,
      taxId: licenseNuit || current.taxId,
    }));
  }, [licenseName, licenseNuit]);

  const broadcastRefresh = () => {
    try {
      window.dispatchEvent(new Event('company-profile-changed'));
    } catch {
      /* ignore */
    }
  };

  const inputCls = (invalid?: boolean) =>
    `pos-field px-2.5 py-1.5 text-xs ${
      invalid ? '!border-rose-500 ring-1 ring-rose-500/30' : ''
    }`;

  const readOnlyCls = 'pos-field px-2.5 py-1.5 text-xs';

  const resetBankDraft = () => {
    setBankDraft(createEmptyBankAccountDraft());
    setEditingBankId(null);
  };

  const handleSaveBankDraft = () => {
    const nextAccount: CompanyBankAccount = {
      ...bankDraft,
      id: editingBankId || bankDraft.id || createEmptyBankAccountDraft().id,
      bankName: bankDraft.bankName.trim(),
      accountHolder: bankDraft.accountHolder.trim(),
      accountNumber: bankDraft.accountNumber.trim(),
      nib: bankDraft.nib.trim(),
      swift: bankDraft.swift.trim(),
      currency: (bankDraft.currency || 'MZN').trim().toUpperCase(),
    };
    if (!nextAccount.accountHolder && !nextAccount.accountNumber && !nextAccount.nib && !nextAccount.swift) {
      setMessage({ type: 'err', text: 'Preencha pelo menos titular, número, NIB ou SWIFT.' });
      return;
    }
    setBankAccounts((current) => {
      if (editingBankId) {
        return current.map((account) => (account.id === editingBankId ? nextAccount : account));
      }
      return [...current, nextAccount];
    });
    resetBankDraft();
    setMessage({
      type: 'ok',
      text: editingBankId
        ? 'Conta actualizada na lista. Clique em Salvar para gravar.'
        : 'Conta adicionada à lista. Clique em Salvar para gravar.',
    });
  };

  const handleEditBankAccount = (account: CompanyBankAccount) => {
    setEditingBankId(account.id);
    setBankDraft({ ...account });
  };

  const handleRemoveBankAccount = (accountId: string) => {
    setBankAccounts((current) => current.filter((account) => account.id !== accountId));
    if (editingBankId === accountId) resetBankDraft();
    setMessage({ type: 'ok', text: 'Conta removida da lista. Clique em Salvar para gravar.' });
  };

  const handleSaveDados = async () => {
    const lockedName = (licenseName || form.name).trim();
    if (!lockedName) {
      setMessage({ type: 'err', text: 'Nome da empresa em falta na licença.' });
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      const compactLogo = await ensureCompactReceiptLogo(form.logoDataUrl);
      const bankDetails = serializeCompanyBankAccounts(bankAccounts);
      const bankAccountNumber = bankAccounts[0]?.accountNumber?.trim() || '';
      await saveCompanyProfile({
        name: lockedName,
        taxId: licenseNuit || form.taxId,
        street: form.street,
        buildingNumber: form.buildingNumber,
        additionalStreet: form.additionalStreet,
        plotIdentification: form.plotIdentification,
        district: form.district,
        city: form.city,
        state: form.state,
        country: 'Moçambique',
        phone: form.phone,
        email: form.email,
        bankAccountNumber,
        bankDetails,
        logoDataUrl: compactLogo,
        voidReasons: form.voidReasons,
      });
      if (compactLogo !== form.logoDataUrl) {
        setForm((f) => ({ ...f, logoDataUrl: compactLogo }));
      }
      setForm((f) => ({ ...f, bankAccountNumber, bankDetails }));
      setMessage({ type: 'ok', text: 'Dados da empresa guardados.' });
      broadcastRefresh();
      await load();
    } catch (e) {
      setMessage({ type: 'err', text: e instanceof Error ? e.message : 'Erro ao guardar' });
    } finally {
      setSaving(false);
    }
  };

  const handleResetDatabase = async () => {
    const hasSelection = resetSelections.products || resetSelections.customers || resetSelections.documents;
    if (!hasSelection) {
      setMessage({ type: 'err', text: 'Selecione pelo menos uma entidade para redefinir.' });
      return;
    }
    if (!resetBackupPath.trim()) {
      setMessage({ type: 'err', text: 'Informe um caminho de backup válido.' });
      return;
    }
    if (!adminPassword.trim()) {
      setMessage({ type: 'err', text: 'Digite a senha do administrador para confirmar.' });
      return;
    }

    setSaving(true);
    setMessage(null);
    try {
      const result = await resetDatabase({
        backupDir: resetBackupPath.trim(),
        adminPassword: adminPassword.trim(),
        resetProducts: resetSelections.products,
        resetCustomers: resetSelections.customers,
        resetDocuments: resetSelections.documents,
      });
      const deleted = result?.deleted ?? {};
      setMessage({
        type: 'ok',
        text: `Redefinição concluída. Backup: ${result?.backupFile ?? 'gerado'} | Produtos: ${Number(deleted.products ?? 0)} | Clientes: ${Number(deleted.customers ?? 0)} | Documentos: ${Number(deleted.documents ?? 0)}`,
      });
      setAdminPassword('');
    } catch (e) {
      setMessage({ type: 'err', text: e instanceof Error ? e.message : 'Falha ao redefinir banco de dados' });
    } finally {
      setSaving(false);
    }
  };

  const onLogoPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !file.type.startsWith('image/')) return;
    if (file.size > 8_000_000) {
      setMessage({ type: 'err', text: 'Imagem demasiado grande (máx. 8 MB).' });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      void (async () => {
        const url = typeof reader.result === 'string' ? reader.result : null;
        if (!url) return;
        try {
          const compact = await ensureCompactReceiptLogo(url);
          setForm((f) => ({ ...f, logoDataUrl: compact }));
          if (compact && url.length > compact.length * 1.15) {
            setMessage({
              type: 'ok',
              text: 'Logo comprimido automaticamente para impressão rápida.',
            });
          } else {
            setMessage(null);
          }
        } catch {
          setForm((f) => ({ ...f, logoDataUrl: url }));
          setMessage({
            type: 'err',
            text: 'Não foi possível comprimir o logo; a imagem original foi usada.',
          });
        }
      })();
    };
    reader.readAsDataURL(file);
  };

  const handleSelectBackupFolder = async () => {
    try {
      const selectedPath = await window.electronAPI?.selectFolder?.();
      if (!selectedPath) return;
      setResetBackupPath(selectedPath);
    } catch {
      setMessage({
        type: 'err',
        text: 'Não foi possível abrir o seletor de pasta.',
      });
    }
  };

  const tabs: { id: typeof innerTab; label: string }[] = [
    { id: 'dados', label: 'Dados da empresa' },
  ];

  return (
    <div className="flex flex-col h-full min-h-0 bg-pos-surface text-zinc-300">
      <div className="shrink-0 border-b border-pos-border/50 px-4 pt-3">
        <div className="flex flex-wrap gap-1">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setInnerTab(t.id)}
              className={`px-3 py-2 text-[11px] font-semibold uppercase tracking-wide border-b-2 transition-colors ${
                innerTab === t.id
                  ? 'border-[#0001fb] text-white'
                  : 'border-transparent text-zinc-500 hover:text-[#0001fb]'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-4 py-2">
          <button
            type="button"
            onClick={() => {
              if (innerTab === 'dados') void handleSaveDados();
            }}
            disabled={saving || loading || innerTab !== 'dados'}
            className="pos-on-accent inline-flex items-center gap-1.5 rounded bg-[#0001fb] px-3 py-1.5 text-[11px] font-semibold text-white transition-colors hover:bg-[#1a1bff] disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Check size={14} />
            Salvar
          </button>
          <button
            type="button"
            onClick={() => setShowHelp((v) => !v)}
            className="flex items-center gap-1.5 text-[11px] font-semibold text-zinc-500 transition-colors hover:text-[#0001fb]"
          >
            <HelpCircle size={14} />
            Ajuda
          </button>
        </div>
      </div>

      {showHelp && (
        <div className="mx-4 mt-2 rounded border border-pos-border bg-pos-card px-3 py-2 text-[10px] text-zinc-500 leading-relaxed">
          Os dados de identificação da empresa (Nome, NUIT, morada e contactos) vêm da{' '}
          <strong className="text-zinc-400">licença</strong> e são apenas de leitura. Pode adicionar várias contas
          bancárias (titular, número, NIB, SWIFT e moeda) e o logo; as contas aparecem no rodapé das faturas A4. Use{' '}
          <strong className="text-zinc-400">Salvar</strong> para gravar as alterações. Logos grandes são comprimidos
          automaticamente (máx. ~280 px) para a impressão do recibo ser rápida. API:{' '}
          <code className="text-zinc-400">{getPosApiBase()}/company-profile</code> (leitura via proxy; gravação usa a API
          directa).
        </div>
      )}

      {message && (
        <div
          className={`mx-4 mt-2 rounded px-3 py-2 text-[11px] font-medium ${
            message.type === 'ok' ? 'bg-[#0001fb]/10 text-[#a5b4fc]' : 'bg-rose-950/50 text-rose-300'
          }`}
        >
          {message.text}
        </div>
      )}

      <div className="flex-1 overflow-y-auto custom-scrollbar px-4 pb-8">
        {loading && innerTab === 'dados' ? (
          <p className="py-8 text-center text-xs text-zinc-500">A carregar…</p>
        ) : innerTab === 'dados' ? (
          <div className="max-w-3xl pt-4 space-y-6">
            <section>
              <h3 className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 mb-1">Dados da Empresa</h3>
              <p className="mb-2 text-[10px] text-zinc-600">
                Dados provenientes da licença — apenas leitura.
              </p>
              <div className="rounded border border-pos-border/80 bg-pos-card px-3">
                <FieldRow label="Nome">
                  <input
                    className={readOnlyCls}
                    value={licenseName || form.name}
                    readOnly
                    tabIndex={-1}
                    title="Definido pela licença"
                  />
                </FieldRow>
                <FieldRow label="NUIT">
                  <input
                    className={readOnlyCls}
                    value={licenseNuit || form.taxId}
                    readOnly
                    tabIndex={-1}
                    title="Definido pela licença"
                  />
                </FieldRow>
                <FieldRow label="Cidade">
                  <input
                    className={readOnlyCls}
                    value={form.city}
                    readOnly
                    tabIndex={-1}
                    title="Definido pela licença"
                  />
                </FieldRow>
                <FieldRow label="Estado / Província">
                  <input
                    className={readOnlyCls}
                    value={form.state}
                    readOnly
                    tabIndex={-1}
                    title="Definido pela licença"
                  />
                </FieldRow>
                <FieldRow label="País">
                  <input
                    className={readOnlyCls}
                    value={form.country || 'Moçambique'}
                    readOnly
                    tabIndex={-1}
                    title="Definido pela licença"
                  />
                </FieldRow>
                <FieldRow label="Telefone">
                  <input
                    className={readOnlyCls}
                    value={form.phone}
                    readOnly
                    tabIndex={-1}
                    title="Definido pela licença"
                  />
                </FieldRow>
                <FieldRow label="Email">
                  <input
                    type="email"
                    className={readOnlyCls}
                    value={form.email}
                    readOnly
                    tabIndex={-1}
                    title="Definido pela licença"
                  />
                </FieldRow>
              </div>
            </section>

            <section>
              <div className="mb-2">
                <h3 className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Contas bancárias</h3>
                <p className="mt-1 text-[10px] text-zinc-600">
                  Pode ter várias contas. Aparecem no rodapé das faturas A4.
                </p>
              </div>

              {bankAccounts.length > 0 ? (
                <div className="mb-3 space-y-2">
                  {bankAccounts.map((account) => (
                    <div
                      key={account.id}
                      className={`rounded border px-3 py-2 ${
                        editingBankId === account.id
                          ? 'border-[#0001fb]/50 bg-[#0001fb]/5'
                          : 'border-pos-border/80 bg-pos-card'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 space-y-0.5 text-[11px] text-zinc-300">
                          <p className="truncate font-semibold text-zinc-100">
                            {account.accountHolder || 'Sem titular'}
                          </p>
                          <p className="truncate text-zinc-500">
                            Banco: {account.bankName || '—'}
                          </p>
                          <p className="truncate text-zinc-500">
                            Conta: {account.accountNumber || '—'} · NIB: {account.nib || '—'}
                          </p>
                          <p className="truncate text-zinc-500">
                            SWIFT: {account.swift || '—'} · Moeda: {account.currency || 'MZN'}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          <button
                            type="button"
                            onClick={() => handleEditBankAccount(account)}
                            className="inline-flex items-center gap-1 rounded border border-pos-border px-2 py-1 text-[10px] font-semibold text-zinc-300 transition-colors hover:text-[#0001fb]"
                            title="Editar conta"
                          >
                            <Pencil size={12} />
                            Editar
                          </button>
                          <button
                            type="button"
                            onClick={() => handleRemoveBankAccount(account.id)}
                            className="inline-flex items-center gap-1 rounded border border-pos-border px-2 py-1 text-[10px] font-semibold text-zinc-300 transition-colors hover:text-rose-300"
                            title="Remover conta"
                          >
                            <Trash2 size={12} />
                            Remover
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mb-3 rounded border border-dashed border-pos-border bg-pos-card px-3 py-3 text-[11px] text-zinc-600">
                  Ainda não há contas bancárias. Preencha o formulário abaixo e clique em Adicionar conta.
                </p>
              )}

              <div className="rounded border border-pos-border/80 bg-pos-card px-3">
                <div className="py-2.5">
                  <p className="text-[11px] font-semibold text-zinc-400">
                    {editingBankId ? 'Editar conta seleccionada' : 'Nova conta bancária'}
                  </p>
                </div>
                <FieldRow label="Titular da conta" showDivider={false} fixedLabelWidth>
                  <input
                    className={inputCls()}
                    value={bankDraft.accountHolder}
                    onChange={(e) => setBankDraft((prev) => ({ ...prev, accountHolder: e.target.value }))}
                    placeholder="Nome do titular"
                  />
                </FieldRow>
                <FieldRow label="Nome do banco" showDivider={false} fixedLabelWidth>
                  <input
                    className={inputCls()}
                    value={bankDraft.bankName}
                    onChange={(e) => setBankDraft((prev) => ({ ...prev, bankName: e.target.value }))}
                    placeholder="Ex.: Banco de Moçambique"
                  />
                </FieldRow>
                <FieldRow label="Número de conta" showDivider={false} fixedLabelWidth>
                  <input
                    className={inputCls()}
                    value={bankDraft.accountNumber}
                    onChange={(e) => setBankDraft((prev) => ({ ...prev, accountNumber: e.target.value }))}
                    placeholder="Ex.: 123456789"
                  />
                </FieldRow>
                <FieldRow label="NIB" showDivider={false} fixedLabelWidth>
                  <input
                    className={inputCls()}
                    value={bankDraft.nib}
                    onChange={(e) => setBankDraft((prev) => ({ ...prev, nib: e.target.value }))}
                    placeholder="Número de Identificação Bancária"
                  />
                </FieldRow>
                <FieldRow label="SWIFT" showDivider={false} fixedLabelWidth>
                  <input
                    className={inputCls()}
                    value={bankDraft.swift}
                    onChange={(e) => setBankDraft((prev) => ({ ...prev, swift: e.target.value }))}
                    placeholder="Código SWIFT/BIC"
                  />
                </FieldRow>
                <FieldRow label="Tipo de moeda" showDivider={false} fixedLabelWidth>
                  <PosSelect
                    value={bankDraft.currency || 'MZN'}
                    onChange={(value) => setBankDraft((prev) => ({ ...prev, currency: value }))}
                    className="w-full"
                    triggerClassName="w-full"
                    size="md"
                    options={COMPANY_BANK_CURRENCY_OPTIONS.map((option) => ({
                      value: option.value,
                      label: option.label,
                    }))}
                  />
                </FieldRow>
                <div className="flex flex-wrap items-center gap-2 py-3">
                  <button
                    type="button"
                    onClick={handleSaveBankDraft}
                    className="inline-flex items-center gap-1.5 rounded border border-zinc-600 bg-transparent px-3 py-1.5 text-[11px] font-semibold text-zinc-200 transition-colors hover:text-[#0001fb]"
                  >
                    <Plus size={14} />
                    {editingBankId ? 'Actualizar conta' : 'Adicionar conta'}
                  </button>
                  {editingBankId ? (
                    <button
                      type="button"
                      onClick={resetBankDraft}
                      className="inline-flex items-center gap-1.5 rounded border border-pos-border px-3 py-1.5 text-[11px] font-semibold text-zinc-400 transition-colors hover:text-zinc-200"
                    >
                      Cancelar edição
                    </button>
                  ) : null}
                </div>
              </div>
            </section>

            <section>
              <h3 className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 mb-1">Logo</h3>
              <div className="rounded border border-pos-border/80 bg-pos-card p-3 space-y-3">
                <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onLogoPick} />
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => fileRef.current?.click()}
                    className="inline-flex items-center gap-1 rounded border border-zinc-600 bg-transparent px-2.5 py-1 text-[11px] font-semibold text-zinc-200 transition-colors hover:text-[#0001fb]"
                  >
                    <FolderOpen size={14} />
                    Procurar
                  </button>
                  <button
                    type="button"
                    onClick={() => setForm((f) => ({ ...f, logoDataUrl: null }))}
                    className="inline-flex items-center gap-1 rounded border border-zinc-600 bg-transparent px-2.5 py-1 text-[11px] font-semibold text-zinc-200 transition-colors hover:text-[#0001fb]"
                  >
                    <Eraser size={14} />
                    Limpar
                  </button>
                </div>
                <div className="flex min-h-[100px] items-center justify-center rounded border border-dashed border-pos-border bg-[#0d0d0d] p-4">
                  {form.logoDataUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={form.logoDataUrl} alt="Logo" className="max-h-24 max-w-full object-contain" />
                  ) : (
                    <span className="text-[11px] text-zinc-600">Pré-visualização do logo</span>
                  )}
                </div>
              </div>
            </section>
          </div>
        ) : innerTab === 'backups' ? (
          <DatabaseBackupPanel />
        ) : (
          <div className="max-w-3xl pt-4 space-y-4">
            <div className="rounded border border-yellow-700/70 bg-yellow-950/25 px-3 py-2 text-[11px] text-yellow-200/90">
              <div className="flex items-center gap-2">
                <AlertTriangle size={14} />
                <span>
                  Esta é uma operação destrutiva. Por favor, certifique-se de ler as instruções antes de prosseguir.
                </span>
              </div>
            </div>

            <section className="rounded border border-pos-border/80 bg-pos-card p-3">
              <div className="flex items-start gap-3">
                <div className="mt-0.5 flex h-6 w-6 items-center justify-center rounded-full bg-[#0001fb] text-[12px] font-bold text-white">
                  1
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="text-xs font-semibold text-zinc-200">Local do backup do banco de dados</h3>
                  <p className="mt-0.5 text-[11px] text-zinc-500">
                    O backup do banco de dados será executado antes da redefinição. Pode alterar o destino padrão abaixo.
                  </p>
                  <div className="mt-2 flex items-center gap-2">
                    <input
                      className={inputCls()}
                      value={resetBackupPath}
                      onChange={(e) => setResetBackupPath(e.target.value)}
                      placeholder="Ex.: C:\\Users\\SeuUsuario\\Documents\\POSly Backup"
                    />
                    <button
                      type="button"
                      onClick={() => void handleSelectBackupFolder()}
                      className="inline-flex h-[30px] w-[34px] shrink-0 items-center justify-center rounded border border-zinc-600 bg-transparent text-zinc-200 transition-colors hover:text-[#0001fb]"
                      aria-label="Escolher pasta de backup"
                      title="Escolher pasta"
                    >
                      <FolderOpen size={14} />
                    </button>
                  </div>
                </div>
              </div>
            </section>

            <section className="rounded border border-pos-border/80 bg-pos-card p-3">
              <div className="flex items-start gap-3">
                <div className="mt-0.5 flex h-6 w-6 items-center justify-center rounded-full bg-[#0001fb] text-[12px] font-bold text-white">
                  2
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="text-xs font-semibold text-zinc-200">Selecione entidades para redefinir</h3>
                  <p className="mt-0.5 text-[11px] text-zinc-500">
                    As entidades selecionadas serão excluídas do banco de dados.
                  </p>
                  <div className="mt-2 space-y-2">
                    <label className="flex cursor-pointer items-center gap-2 text-xs text-zinc-300 transition-colors hover:text-[#0001fb]">
                      <input
                        type="checkbox"
                        checked={resetSelections.products}
                        onChange={(e) => setResetSelections((s) => ({ ...s, products: e.target.checked }))}
                      />
                      Produtos
                    </label>
                    <label className="flex cursor-pointer items-center gap-2 text-xs text-zinc-300 transition-colors hover:text-[#0001fb]">
                      <input
                        type="checkbox"
                        checked={resetSelections.customers}
                        onChange={(e) => setResetSelections((s) => ({ ...s, customers: e.target.checked }))}
                      />
                      Clientes
                    </label>
                    <label className="flex cursor-pointer items-center gap-2 text-xs text-zinc-300 transition-colors hover:text-[#0001fb]">
                      <input
                        type="checkbox"
                        checked={resetSelections.documents}
                        onChange={(e) => setResetSelections((s) => ({ ...s, documents: e.target.checked }))}
                      />
                      Documentos
                    </label>
                  </div>
                </div>
              </div>
            </section>

            <section className="rounded border border-pos-border/80 bg-pos-card p-3">
              <div className="flex items-start gap-3">
                <div className="mt-0.5 flex h-6 w-6 items-center justify-center rounded-full bg-[#0001fb] text-[12px] font-bold text-white">
                  3
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="text-xs font-semibold text-zinc-200">Confirmação</h3>
                  <p className="mt-0.5 text-[11px] text-zinc-500">
                    Autorize e execute a redefinição nas entidades selecionadas.
                  </p>
                  <div className="mt-2 max-w-[240px] space-y-2">
                    <input
                      type="password"
                      className={inputCls()}
                      value={adminPassword}
                      onChange={(e) => setAdminPassword(e.target.value)}
                      placeholder="Digite a senha do administrador"
                    />
                    <button
                      type="button"
                      disabled={
                        saving ||
                        !adminPassword.trim() ||
                        !(resetSelections.products || resetSelections.customers || resetSelections.documents)
                      }
                      onClick={() => void handleResetDatabase()}
                      className="inline-flex items-center rounded border border-zinc-600 bg-transparent px-3 py-1.5 text-[11px] font-semibold text-zinc-200 transition-colors hover:text-[#0001fb] disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Redefinir banco de dados
                    </button>
                  </div>
                </div>
              </div>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
