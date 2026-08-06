'use client';

import React, { useEffect, useState } from 'react';
import { Check, X } from 'lucide-react';
import { getPosApiBase } from '@/lib/apiBase';
import { unwrapApiSuccessPayload } from '@/lib/apiResponse';
import PosSelect from '@/components/PosSelect';
import { PosSwitch } from '@/components/PosSwitch';

export type CustomerSupplierFormValues = {
  name: string;
  code: string;
  taxId: string;
  streetName: string;
  buildingNumber: string;
  additionalStreetName: string;
  plotIdentification: string;
  district: string;
  city: string;
  stateProvince: string;
  country: string;
  phone: string;
  email: string;
  active: boolean;
  isCustomer: boolean;
  taxExempt: boolean;
};

export type CustomerSupplierSaved = {
  id: string;
  name: string;
  code: string;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  active: boolean;
  isCustomer: boolean;
  taxExempt: boolean;
};

const emptyForm: CustomerSupplierFormValues = {
  name: '',
  code: '',
  taxId: '',
  streetName: '',
  buildingNumber: '',
  additionalStreetName: '',
  plotIdentification: '',
  district: '',
  city: '',
  stateProvince: '',
  country: 'Moçambique',
  phone: '',
  email: '',
  active: true,
  isCustomer: true,
  taxExempt: false,
};

const COUNTRY_OPTIONS = [{ value: 'Moçambique', label: 'Moçambique' }];

const MOZAMBIQUE_CITY_OPTIONS = [
  'Maputo',
  'Matola',
  'Boane',
  'Marracuene',
  'Namaacha',
  'Xai-Xai',
  'Chokwe',
  'Mandlakazi',
  'Macia',
  'Massinga',
  'Inhambane',
  'Maxixe',
  'Vilankulo',
  'Jangamo',
  'Zavala',
  'Beira',
  'Dondo',
  'Nhamatanda',
  'Gorongosa',
  'Chimoio',
  'Manica',
  'Gondola',
  'Sussundenga',
  'Tete',
  'Moatize',
  'Angonia',
  'Ulongue',
  'Quelimane',
  'Mocuba',
  'Milange',
  'Gurué',
  'Pebane',
  'Nampula',
  'Nacala',
  'Nacala-a-Velha',
  'Ilha de Moçambique',
  'Monapo',
  'Mongicual',
  'Angoche',
  'Malema',
  'Ribaue',
  'Cuamba',
  'Lichinga',
  'Mandimba',
  'Metangula',
  'Pemba',
  'Montepuez',
  'Mocimboa da Praia',
  'Mueda',
  'Palma',
].map((city) => ({ value: city, label: city }));

function buildAddress(address: string, city: string, country: string) {
  const parts = [address.trim(), city.trim(), country.trim()].filter(Boolean);
  return parts.length ? parts.join(', ') : null;
}

const CUSTOMERS_META_KEY = 'customers-manager-meta';
const CUSTOMERS_NEXT_CODE_KEY = 'customers-manager-next-code';

function readStoredPartyCodes(): number[] {
  try {
    const raw = localStorage.getItem(CUSTOMERS_META_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return [];
    return Object.values(parsed)
      .map((meta: any) => Number(meta?.code))
      .filter((n) => Number.isFinite(n) && n >= 1);
  } catch {
    return [];
  }
}

/** Códigos numéricos sequenciais: 1, 2, 3, … */
function generatePartyCode() {
  const codes = readStoredPartyCodes();
  const maxFromMeta = codes.length ? Math.max(...codes) : 0;
  let nextStored = 0;
  try {
    nextStored = Number(localStorage.getItem(CUSTOMERS_NEXT_CODE_KEY) || 0);
    if (!Number.isFinite(nextStored) || nextStored < 0) nextStored = 0;
  } catch {
    nextStored = 0;
  }
  return String(Math.max(maxFromMeta, nextStored) + 1);
}

function rememberPartyCode(code: string) {
  const n = Number(code);
  if (!Number.isFinite(n) || n < 1) return;
  try {
    const current = Number(localStorage.getItem(CUSTOMERS_NEXT_CODE_KEY) || 0);
    const next = Math.max(Number.isFinite(current) ? current : 0, n);
    localStorage.setItem(CUSTOMERS_NEXT_CODE_KEY, String(next));
  } catch {
    /* ignore */
  }
}

type Props = {
  isOpen: boolean;
  editingId?: string | null;
  initialValues?: Partial<CustomerSupplierFormValues>;
  onClose: () => void;
  onSaved: (saved: CustomerSupplierSaved) => void | Promise<void>;
};

export function CustomerSupplierFormModal({
  isOpen,
  editingId = null,
  initialValues,
  onClose,
  onSaved,
}: Props) {
  const [form, setForm] = useState<CustomerSupplierFormValues>(emptyForm);
  const [activeTab, setActiveTab] = useState<'geral' | 'descontos' | 'fidelidade' | 'termos'>('geral');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    const next = { ...emptyForm, ...initialValues };
    if (!String(next.code ?? '').trim()) {
      next.code = generatePartyCode();
    }
    setForm(next);
    setActiveTab('geral');
    setError('');
    setSaving(false);
    // Reset only when opening; parent should pass stable initialValues while open.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional open-only reset
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    if (!form.name.trim() || !form.phone.trim()) {
      setError('Preencha pelo menos nome e telefone.');
      return;
    }

    setSaving(true);
    setError('');
    try {
      const payload = {
        name: form.name.trim(),
        phone: form.phone.trim(),
        email: form.email.trim() || null,
        address: buildAddress(form.streetName, form.city, form.country),
      };
      const url = editingId ? `${getPosApiBase()}/clientes/${editingId}` : `${getPosApiBase()}/clientes`;
      const method = editingId ? 'PUT' : 'POST';
      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const rawResult = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          String(rawResult?.error?.message ?? rawResult?.error ?? rawResult?.message ?? 'Falha ao guardar.'),
        );
      }
      const result = unwrapApiSuccessPayload<any>(rawResult) ?? rawResult;
      const savedId = editingId ?? String(result?.id ?? result?.data?.id ?? '').trim();
      if (!savedId) throw new Error('Registo guardado sem identificador.');

      const code = String(form.code || '').trim() || generatePartyCode();
      rememberPartyCode(code);
      await onSaved({
        id: savedId,
        name: payload.name,
        code,
        phone: payload.phone,
        email: payload.email,
        address: payload.address,
        active: form.active,
        isCustomer: form.isCustomer,
        taxExempt: form.taxExempt,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao guardar.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[140] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="bg-[#1a1a1a] border border-zinc-800 rounded w-full max-w-lg overflow-hidden flex flex-col max-h-[90vh]">
        <div className="p-4 flex items-center bg-[#1a1a1a]">
          <h3 className="text-xl text-zinc-200">
            {editingId ? 'Editar cliente / fornecedor' : 'Novo cliente / fornecedor'}
          </h3>
        </div>

        <div className="flex border-b border-[#0001fb]">
          <TabButton label="Geral" active={activeTab === 'geral'} onClick={() => setActiveTab('geral')} />
          <TabButton label="Descontos" active={activeTab === 'descontos'} onClick={() => setActiveTab('descontos')} />
          <TabButton
            label="Fidelidade"
            active={activeTab === 'fidelidade'}
            onClick={() => setActiveTab('fidelidade')}
          />
          <TabButton label="Pagamento" active={activeTab === 'termos'} onClick={() => setActiveTab('termos')} />
        </div>

        <form
          id="customer-supplier-form"
          onSubmit={(e) => void handleSave(e)}
          className="flex-1 overflow-y-auto p-6 space-y-5 custom-scrollbar bg-[#1a1a1a]"
        >
          {activeTab !== 'geral' ? (
            <div className="py-10 text-center text-zinc-500 text-sm">Sem configuração nesta aba.</div>
          ) : (
            <div className="space-y-5">
              <Field label="Nome" required value={form.name} onChange={(v) => setForm({ ...form, name: v })} />
              <Field label="Código" value={form.code} onChange={(v) => setForm({ ...form, code: v })} short readOnly />
              <Field
                label="NUIT"
                value={form.taxId}
                onChange={(v) => setForm({ ...form, taxId: v.slice(0, 9) })}
                maxLength={9}
              />
              <Field
                label="Endereço"
                value={form.streetName}
                onChange={(v) => setForm({ ...form, streetName: v })}
              />
              <div className="space-y-2">
                <label className="text-xs text-zinc-400">País</label>
                <PosSelect
                  value={form.country}
                  onChange={(country) => setForm({ ...form, country })}
                  size="md"
                  options={COUNTRY_OPTIONS}
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs text-zinc-400">Cidade</label>
                <PosSelect
                  value={form.city}
                  onChange={(city) => setForm({ ...form, city })}
                  size="md"
                  placeholder="Selecionar cidade..."
                  options={MOZAMBIQUE_CITY_OPTIONS}
                />
              </div>
              <Field label="Telefone" required value={form.phone} onChange={(v) => setForm({ ...form, phone: v })} />
              <Field label="Email" value={form.email} onChange={(v) => setForm({ ...form, email: v })} />

              <div className="flex flex-wrap items-center gap-x-8 gap-y-2 pt-2">
                <PosSwitch
                  label="Ativo"
                  checked={form.active}
                  onChange={(active) => setForm({ ...form, active })}
                />
                <PosSwitch
                  label="Cliente"
                  checked={form.isCustomer}
                  onChange={(isCustomer) => setForm({ ...form, isCustomer })}
                />
              </div>

              {error ? <p className="text-xs text-rose-400">{error}</p> : null}
            </div>
          )}
        </form>

        <div className="p-4 bg-[#1a1a1a] border-t border-zinc-800 flex justify-end gap-3">
          <button
            type="submit"
            form="customer-supplier-form"
            disabled={saving}
            className="flex items-center gap-2 px-6 py-2 rounded bg-[#0001fb] text-xs font-medium text-white transition-colors hover:bg-[#1a1bff] disabled:opacity-50"
          >
            <Check size={16} />
            Salvar
          </button>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="flex items-center gap-2 px-6 py-2 rounded border border-zinc-700 bg-transparent text-xs font-medium text-zinc-300 transition-colors hover:border-[#0001fb] hover:bg-[var(--pos-brand-hover-bg)] hover:text-white disabled:opacity-40"
          >
            <X size={16} />
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}

function TabButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative flex-1 py-2 text-[11px] font-medium text-center transition-colors ${
        active ? 'bg-[#0001fb] text-white' : 'text-zinc-400 hover:text-[#0001fb]'
      }`}
    >
      {label}
      {active && (
        <span className="absolute left-1/2 -bottom-[6px] -translate-x-1/2 w-0 h-0 border-l-[6px] border-r-[6px] border-t-[6px] border-l-transparent border-r-transparent border-t-[#0001fb]" />
      )}
    </button>
  );
}

function Field({
  label,
  value,
  onChange,
  required,
  short,
  readOnly,
  maxLength,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  short?: boolean;
  readOnly?: boolean;
  maxLength?: number;
}) {
  return (
    <div className="space-y-2">
      <label className="block text-xs text-zinc-400">{label}</label>
      <input
        type="text"
        required={required}
        value={value}
        maxLength={maxLength}
        onChange={(e) => onChange(e.target.value)}
        readOnly={readOnly}
        className={`pos-field h-10 px-3 text-sm ${short ? '!w-24' : 'w-full'} ${
          required && !value.trim() ? '!border-red-900/50' : ''
        } ${readOnly ? 'cursor-default text-zinc-400 hover:!border-[#3f3f46] hover:!bg-[#121212]' : ''}`}
      />
    </div>
  );
}

export const CUSTOMER_SUPPLIER_EMPTY_FORM = emptyForm;
