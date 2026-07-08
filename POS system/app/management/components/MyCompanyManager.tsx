'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, HelpCircle, Plus, Trash2, FolderOpen, Eraser, AlertTriangle } from 'lucide-react';
import type { CompanyProfile } from '@/app/pos/types';
import { getPosApiBase } from '@/lib/apiBase';
import {
  fetchCompanyProfile,
  saveCompanyProfile,
  saveCompanyVoidReasons,
  resetDatabase,
} from '@/lib/services/posService';

const COUNTRY_OPTIONS = [
  { value: '', label: 'Selecione o país…' },
  { value: 'Moçambique', label: 'Moçambique' },
  { value: 'Brasil', label: 'Brasil' },
  { value: 'Portugal', label: 'Portugal' },
  { value: 'Angola', label: 'Angola' },
  { value: 'Cabo Verde', label: 'Cabo Verde' },
  { value: 'Espanha', label: 'Espanha' },
  { value: 'Estados Unidos', label: 'Estados Unidos' },
  { value: 'Outro', label: 'Outro' },
];

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
  country: '',
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
}: {
  label: string;
  children: React.ReactNode;
  required?: boolean;
}) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-[minmax(160px,220px)_1fr] gap-x-4 gap-y-1 items-center border-b border-zinc-800/60 py-2.5">
      <label className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
        {label}
        {required ? <span className="sr-only"> (obrigatório)</span> : null}
      </label>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export default function MyCompanyManager() {
  const [innerTab, setInnerTab] = useState<'dados' | 'void' | 'reset'>('dados');
  const [form, setForm] = useState<CompanyProfile>(emptyForm);
  const [voidDraft, setVoidDraft] = useState<string[]>([]);
  const [newVoidReason, setNewVoidReason] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const [resetBackupPath, setResetBackupPath] = useState('C:\\Users\\Nicol\\Documents\\Vorum\\Backup');
  const [resetSelections, setResetSelections] = useState({
    products: true,
    customers: true,
    documents: true,
  });
  const [adminPassword, setAdminPassword] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setMessage(null);
    try {
      const data = await fetchCompanyProfile();
      setForm(data);
      setVoidDraft(data.voidReasons.length ? [...data.voidReasons] : []);
    } catch (e) {
      setMessage({ type: 'err', text: e instanceof Error ? e.message : 'Falha ao carregar dados da empresa' });
      setForm(emptyForm());
      setVoidDraft([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const broadcastRefresh = () => {
    try {
      window.dispatchEvent(new Event('company-profile-changed'));
    } catch {
      /* ignore */
    }
  };

  const inputCls = (invalid?: boolean) =>
    `w-full rounded border bg-[#111] px-2.5 py-1.5 text-xs text-zinc-200 outline-none transition-colors placeholder:text-zinc-600 focus:border-blue-500/80 ${
      invalid ? 'border-rose-500 ring-1 ring-rose-500/30' : 'border-zinc-700'
    }`;

  const handleSaveDados = async () => {
    if (!form.name.trim() || !form.country.trim()) {
      setMessage({ type: 'err', text: 'Preencha Nome e País (obrigatórios).' });
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      await saveCompanyProfile({
        name: form.name,
        taxId: form.taxId,
        street: form.street,
        buildingNumber: form.buildingNumber,
        additionalStreet: form.additionalStreet,
        plotIdentification: form.plotIdentification,
        district: form.district,
        city: form.city,
        state: form.state,
        country: form.country,
        phone: form.phone,
        email: form.email,
        bankAccountNumber: form.bankAccountNumber,
        bankDetails: form.bankDetails,
        logoDataUrl: form.logoDataUrl,
        voidReasons: form.voidReasons,
      });
      setMessage({ type: 'ok', text: 'Dados da empresa guardados.' });
      broadcastRefresh();
      await load();
    } catch (e) {
      setMessage({ type: 'err', text: e instanceof Error ? e.message : 'Erro ao guardar' });
    } finally {
      setSaving(false);
    }
  };

  const handleSaveVoid = async () => {
    setSaving(true);
    setMessage(null);
    try {
      await saveCompanyVoidReasons(voidDraft);
      setForm((f) => ({ ...f, voidReasons: [...voidDraft] }));
      setMessage({ type: 'ok', text: 'Motivos de anulação guardados.' });
      broadcastRefresh();
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
    if (file.size > 1_500_000) {
      setMessage({ type: 'err', text: 'Imagem demasiado grande (máx. ~1,5 MB).' });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const url = typeof reader.result === 'string' ? reader.result : null;
      setForm((f) => ({ ...f, logoDataUrl: url }));
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

  const countryOptions = useMemo(() => {
    const o = [...COUNTRY_OPTIONS];
    if (form.country && !o.some((x) => x.value === form.country)) {
      o.push({ value: form.country, label: form.country });
    }
    return o;
  }, [form.country]);

  const tabs: { id: typeof innerTab; label: string }[] = [
    { id: 'dados', label: 'Dados da empresa' },
    { id: 'void', label: 'Void reasons' },
    { id: 'reset', label: 'Redefinir banco de dados' },
  ];

  return (
    <div className="flex flex-col h-full min-h-0 bg-[#1a1a1a] text-zinc-300">
      <div className="shrink-0 border-b border-zinc-800/50 px-4 pt-3">
        <div className="flex flex-wrap gap-1">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setInnerTab(t.id)}
              className={`px-3 py-2 text-[11px] font-semibold uppercase tracking-wide border-b-2 transition-colors ${
                innerTab === t.id
                  ? 'border-blue-500 text-white'
                  : 'border-transparent text-zinc-500 hover:text-zinc-300'
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
              else if (innerTab === 'void') void handleSaveVoid();
            }}
            disabled={saving || loading || innerTab === 'reset'}
            className="flex items-center gap-1.5 text-[11px] font-semibold text-blue-400 hover:text-blue-300 disabled:opacity-40"
          >
            <Check size={14} />
            Salvar
          </button>
          <button
            type="button"
            onClick={() => setShowHelp((v) => !v)}
            className="flex items-center gap-1.5 text-[11px] font-semibold text-zinc-500 hover:text-zinc-300"
          >
            <HelpCircle size={14} />
            Ajuda
          </button>
        </div>
      </div>

      {showHelp && (
        <div className="mx-4 mt-2 rounded border border-zinc-800 bg-[#141414] px-3 py-2 text-[10px] text-zinc-500 leading-relaxed">
          Os dados de <strong className="text-zinc-400">Nome</strong> e <strong className="text-zinc-400">País</strong> são
          obrigatórios. As informações guardadas aqui aparecem automaticamente no cabeçalho do recibo no POS. Para o logo,
          use ficheiros pequenos (PNG/JPG; tipicamente abaixo de 1 MB) para evitar erros ao guardar. API:{' '}
          <code className="text-zinc-400">{getPosApiBase()}/company-profile</code> (leitura via proxy; gravação usa a API direta).
        </div>
      )}

      {message && (
        <div
          className={`mx-4 mt-2 rounded px-3 py-2 text-[11px] font-medium ${
            message.type === 'ok' ? 'bg-emerald-950/50 text-emerald-400' : 'bg-rose-950/50 text-rose-300'
          }`}
        >
          {message.text}
        </div>
      )}

      <div className="flex-1 overflow-y-auto custom-scrollbar px-4 pb-8">
        {loading ? (
          <p className="py-8 text-center text-xs text-zinc-500">A carregar…</p>
        ) : innerTab === 'dados' ? (
          <div className="max-w-3xl pt-4 space-y-6">
            <section>
              <h3 className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 mb-1">Dados da Empresa</h3>
              <div className="rounded border border-zinc-800/80 bg-[#141414] px-3">
                <FieldRow label="Nome" required>
                  <input
                    className={inputCls(!form.name.trim())}
                    value={form.name}
                    onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                    placeholder="Nome fantasia ou razão social"
                  />
                </FieldRow>
                <FieldRow label="NUIT">
                  <input
                    className={inputCls()}
                    value={form.taxId}
                    onChange={(e) => setForm((f) => ({ ...f, taxId: e.target.value }))}
                  />
                </FieldRow>
                <FieldRow label="Cidade">
                  <input
                    className={inputCls()}
                    value={form.city}
                    onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))}
                  />
                </FieldRow>
                <FieldRow label="Estado / Província">
                  <input
                    className={inputCls()}
                    value={form.state}
                    onChange={(e) => setForm((f) => ({ ...f, state: e.target.value }))}
                  />
                </FieldRow>
                <FieldRow label="País" required>
                  <select
                    className={inputCls(!form.country.trim())}
                    value={form.country}
                    onChange={(e) => setForm((f) => ({ ...f, country: e.target.value }))}
                  >
                    {countryOptions.map((o) => (
                      <option key={o.value || 'empty'} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </FieldRow>
                <FieldRow label="Telefone">
                  <input
                    className={inputCls()}
                    value={form.phone}
                    onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                  />
                </FieldRow>
                <FieldRow label="Email">
                  <input
                    type="email"
                    className={inputCls()}
                    value={form.email}
                    onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                  />
                </FieldRow>
              </div>
            </section>

            <section>
              <h3 className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 mb-1">Conta bancária</h3>
              <div className="rounded border border-zinc-800/80 bg-[#141414] px-3">
                <FieldRow label="Número da conta">
                  <input
                    className={inputCls()}
                    value={form.bankAccountNumber}
                    onChange={(e) => setForm((f) => ({ ...f, bankAccountNumber: e.target.value }))}
                  />
                </FieldRow>
                <FieldRow label="Detalhes bancários">
                  <textarea
                    className={`${inputCls()} min-h-[88px] resize-y font-sans`}
                    value={form.bankDetails}
                    onChange={(e) => setForm((f) => ({ ...f, bankDetails: e.target.value }))}
                  />
                </FieldRow>
              </div>
            </section>

            <section>
              <h3 className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 mb-1">Logo</h3>
              <div className="rounded border border-zinc-800/80 bg-[#141414] p-3 space-y-3">
                <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onLogoPick} />
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => fileRef.current?.click()}
                    className="inline-flex items-center gap-1 rounded border border-zinc-600 bg-zinc-800/50 px-2.5 py-1 text-[11px] font-semibold text-zinc-200 hover:bg-zinc-800"
                  >
                    <FolderOpen size={14} />
                    Procurar
                  </button>
                  <button
                    type="button"
                    onClick={() => setForm((f) => ({ ...f, logoDataUrl: null }))}
                    className="inline-flex items-center gap-1 rounded border border-zinc-600 bg-zinc-800/50 px-2.5 py-1 text-[11px] font-semibold text-zinc-200 hover:bg-zinc-800"
                  >
                    <Eraser size={14} />
                    Limpar
                  </button>
                </div>
                <div className="flex min-h-[100px] items-center justify-center rounded border border-dashed border-zinc-700 bg-[#0d0d0d] p-4">
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
        ) : innerTab === 'void' ? (
          <div className="max-w-xl pt-6 space-y-4">
            <p className="text-[11px] text-zinc-500">
              Lista de motivos de anulação (void). Pode usar mais tarde em fluxos de cancelamento no POS.
            </p>
            <ul className="space-y-2">
              {voidDraft.map((reason, idx) => (
                <li
                  key={`${idx}-${reason.slice(0, 12)}`}
                  className="flex items-center gap-2 rounded border border-zinc-800 bg-[#141414] px-2 py-1.5"
                >
                  <span className="flex-1 text-xs text-zinc-300">{reason}</span>
                  <button
                    type="button"
                    onClick={() => setVoidDraft((list) => list.filter((_, i) => i !== idx))}
                    className="text-rose-400 hover:text-rose-300 p-1"
                    aria-label="Remover"
                  >
                    <Trash2 size={14} />
                  </button>
                </li>
              ))}
            </ul>
            <div className="flex gap-2">
              <input
                className={inputCls()}
                value={newVoidReason}
                onChange={(e) => setNewVoidReason(e.target.value)}
                placeholder="Novo motivo…"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    const t = newVoidReason.trim();
                    if (t) {
                      setVoidDraft((l) => [...l, t]);
                      setNewVoidReason('');
                    }
                  }
                }}
              />
              <button
                type="button"
                onClick={() => {
                  const t = newVoidReason.trim();
                  if (!t) return;
                  setVoidDraft((l) => [...l, t]);
                  setNewVoidReason('');
                }}
                className="shrink-0 rounded bg-blue-600 px-3 text-white hover:bg-blue-500"
              >
                <Plus size={18} className="mx-auto" />
              </button>
            </div>
          </div>
        ) : (
          <div className="max-w-3xl pt-4 space-y-4">
            <div className="rounded border border-yellow-700/70 bg-yellow-950/25 px-3 py-2 text-[11px] text-yellow-200/90">
              <div className="flex items-center gap-2">
                <AlertTriangle size={14} />
                <span>
                  Esta é uma operação destrutiva. Por favor, certifique-se de ler as instruções antes de prosseguir.{' '}
                  <a href="#" className="text-blue-300 hover:text-blue-200 underline">
                    saiba mais
                  </a>
                </span>
              </div>
            </div>

            <section className="rounded border border-zinc-800/80 bg-[#141414] p-3">
              <div className="flex items-start gap-3">
                <div className="mt-0.5 flex h-6 w-6 items-center justify-center rounded-full bg-sky-500 text-[12px] font-bold text-white">
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
                      placeholder="Ex.: C:\\Users\\SeuUsuario\\Documents\\POS\\Backup"
                    />
                    <button
                      type="button"
                      onClick={() => void handleSelectBackupFolder()}
                      className="inline-flex h-[30px] w-[34px] shrink-0 items-center justify-center rounded border border-zinc-600 bg-zinc-800/60 text-zinc-200 hover:bg-zinc-700"
                      aria-label="Escolher pasta de backup"
                      title="Escolher pasta"
                    >
                      <FolderOpen size={14} />
                    </button>
                  </div>
                </div>
              </div>
            </section>

            <section className="rounded border border-zinc-800/80 bg-[#141414] p-3">
              <div className="flex items-start gap-3">
                <div className="mt-0.5 flex h-6 w-6 items-center justify-center rounded-full bg-sky-500 text-[12px] font-bold text-white">
                  2
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="text-xs font-semibold text-zinc-200">Selecione entidades para redefinir</h3>
                  <p className="mt-0.5 text-[11px] text-zinc-500">
                    As entidades selecionadas serão excluídas do banco de dados.
                  </p>
                  <div className="mt-2 space-y-2">
                    <label className="flex items-center gap-2 text-xs text-zinc-300">
                      <input
                        type="checkbox"
                        checked={resetSelections.products}
                        onChange={(e) => setResetSelections((s) => ({ ...s, products: e.target.checked }))}
                      />
                      Produtos
                    </label>
                    <label className="flex items-center gap-2 text-xs text-zinc-300">
                      <input
                        type="checkbox"
                        checked={resetSelections.customers}
                        onChange={(e) => setResetSelections((s) => ({ ...s, customers: e.target.checked }))}
                      />
                      Clientes
                    </label>
                    <label className="flex items-center gap-2 text-xs text-zinc-300">
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

            <section className="rounded border border-zinc-800/80 bg-[#141414] p-3">
              <div className="flex items-start gap-3">
                <div className="mt-0.5 flex h-6 w-6 items-center justify-center rounded-full bg-sky-500 text-[12px] font-bold text-white">
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
                      className="inline-flex items-center rounded border border-zinc-600 bg-zinc-800/60 px-3 py-1.5 text-[11px] font-semibold text-zinc-200 hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-40"
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
