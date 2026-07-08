'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Copy, KeyRound, Loader2, RefreshCw } from 'lucide-react';
import { getPosApiBase } from '@/lib/apiBase';
import { unwrapApiSuccessPayload } from '@/lib/apiResponse';

type TenantRow = {
  id: string;
  name?: string | null;
};

type EmitResult = {
  tenant_id?: string;
  serial_number?: string;
  license_key?: string;
  serie_label?: string;
  expires_at?: string | Date;
};

function formatExpires(value: string | Date | undefined) {
  if (value == null) return '—';
  const d = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(d.getTime())) return String(value);
    return d.toLocaleString('pt-PT', { dateStyle: 'short', timeStyle: 'short' });
}

async function fetchSaasJson(path: string, init?: RequestInit) {
  const base = getPosApiBase().replace(/\/$/, '');
  const url = `${base}${path.startsWith('/') ? path : `/${path}`}`;
  const response = await fetch(url, init);
  const text = await response.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    throw new Error('Resposta inválida do servidor.');
  }
  if (!response.ok) {
    const errObj = json && typeof json === 'object' ? (json as Record<string, unknown>) : null;
    const msg =
      (errObj?.error && typeof errObj.error === 'object' && (errObj.error as { message?: string }).message) ||
      (typeof errObj?.error === 'string' ? errObj.error : null) ||
      (errObj?.message != null ? String(errObj.message) : null) ||
      text ||
      `HTTP ${response.status}`;
    throw new Error(String(msg));
  }
  return unwrapApiSuccessPayload(json);
}

export default function LicenseSerialManager() {
  const [tenants, setTenants] = useState<TenantRow[]>([]);
  const [tenantsLoading, setTenantsLoading] = useState(true);
  const [tenantsError, setTenantsError] = useState<string | null>(null);

  const [newName, setNewName] = useState('');
  const [newNuit, setNewNuit] = useState('');
  const [newSubmitting, setNewSubmitting] = useState(false);

  const [existingTenantId, setExistingTenantId] = useState('');
  const [plan, setPlan] = useState('BASIC');
  const [expiresDate, setExpiresDate] = useState(() => {
    const d = new Date();
    d.setMonth(d.getMonth() + 1);
    return d.toISOString().slice(0, 10);
  });
  const [existingSubmitting, setExistingSubmitting] = useState(false);

  const [lastNewResult, setLastNewResult] = useState<EmitResult | null>(null);
  const [lastExistingResult, setLastExistingResult] = useState<EmitResult | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const loadTenants = useCallback(async () => {
    setTenantsLoading(true);
    setTenantsError(null);
    try {
      const data = await fetchSaasJson('/saas/tenants');
      const rows = Array.isArray(data) ? data : [];
      setTenants(
        rows.map((r: Record<string, unknown>) => ({
          id: String(r.id ?? ''),
          name: r.name != null ? String(r.name) : null,
        }))
      );
    } catch (e) {
      setTenantsError(e instanceof Error ? e.message : 'Falha ao carregar clientes.');
      setTenants([]);
    } finally {
      setTenantsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadTenants();
  }, [loadTenants]);

  const copyText = async (label: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setToast(`${label} copiado.`);
      window.setTimeout(() => setToast(null), 2500);
    } catch {
      setToast('Não foi possível copiar.');
      window.setTimeout(() => setToast(null), 2500);
    }
  };

  const emitNewClient = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = newName.trim();
    if (name.length < 2) {
      setToast('Informe o nome do cliente (mín. 2 caracteres).');
      window.setTimeout(() => setToast(null), 3000);
      return;
    }
    setNewSubmitting(true);
    setLastNewResult(null);
    try {
      const data = (await fetchSaasJson('/saas/tenants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, nuit: newNuit.trim() || undefined }),
      })) as EmitResult;
      setLastNewResult(data);
      setToast('Número de série emitido.');
      window.setTimeout(() => setToast(null), 3000);
      void loadTenants();
    } catch (err) {
      setToast(err instanceof Error ? err.message : 'Falha ao emitir.');
      window.setTimeout(() => setToast(null), 4000);
    } finally {
      setNewSubmitting(false);
    }
  };

  const emitForExisting = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!existingTenantId) {
      setToast('Selecione um cliente.');
      window.setTimeout(() => setToast(null), 3000);
      return;
    }
    const expiresIso = new Date(`${expiresDate}T23:59:59`).toISOString();
    setExistingSubmitting(true);
    setLastExistingResult(null);
    try {
      const data = (await fetchSaasJson('/saas/license', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenant_id: existingTenantId,
          plan: plan.trim() || 'BASIC',
          expires_at: expiresIso,
        }),
      })) as EmitResult;
      setLastExistingResult(data);
      setToast('Número de série emitido.');
      window.setTimeout(() => setToast(null), 3000);
    } catch (err) {
      setToast(err instanceof Error ? err.message : 'Falha ao emitir.');
      window.setTimeout(() => setToast(null), 4000);
    } finally {
      setExistingSubmitting(false);
    }
  };

  const ResultCard = ({ title, result }: { title: string; result: EmitResult | null }) => {
    if (!result?.serial_number && !result?.license_key) return null;
    const serial = String(result.serial_number ?? result.license_key ?? '').trim();
    const label = result.serie_label || `série ${serial}`;
    return (
      <div className="mt-4 rounded-lg border border-emerald-800/40 bg-emerald-950/20 px-4 py-3 text-sm">
        <p className="text-xs font-semibold uppercase tracking-wide text-emerald-400/90">{title}</p>
        {result.tenant_id ? (
          <p className="mt-2 text-xs text-zinc-500">
            Tenant: <span className="font-mono text-zinc-300">{result.tenant_id}</span>
          </p>
        ) : null}
        <p className="mt-2 text-zinc-200">{label}</p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <code className="rounded bg-zinc-950 px-2 py-1 font-mono text-base text-emerald-300">{serial}</code>
          <button
            type="button"
            onClick={() => void copyText('Número de série', serial)}
            className="inline-flex items-center gap-1 rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:border-zinc-500"
          >
            <Copy size={14} /> Copiar
          </button>
        </div>
        <p className="mt-2 text-xs text-zinc-500">Válido até: {formatExpires(result.expires_at)}</p>
      </div>
    );
  };

  return (
    <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
      <div className="mx-auto max-w-3xl space-y-6">
        <div className="flex items-start gap-3 rounded-lg border border-zinc-800/50 bg-[#141414] p-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-400">
            <KeyRound size={22} />
          </div>
          <div>
            <h2 className="text-lg font-medium text-zinc-200">Emitir número de série</h2>
            <p className="mt-1 text-sm text-zinc-500">
              Gere o código no formato <span className="font-mono text-zinc-400">X_XXXXXXXX</span> para o cliente instalar no
              POS. Na primeira configuração no computador dele, a licença fica vinculada a essa máquina.
            </p>
          </div>
        </div>

        {toast ? (
          <div className="rounded border border-zinc-700 bg-zinc-900/80 px-3 py-2 text-sm text-zinc-200">{toast}</div>
        ) : null}

        <section className="rounded-lg border border-zinc-800/50 bg-[#141414] p-5">
          <h3 className="text-sm font-semibold text-zinc-300">Novo cliente (com primeira licença)</h3>
          <p className="mt-1 text-xs text-zinc-500">Cria o registo do cliente e emite já um número de série (validade +1 mês).</p>
          <form onSubmit={(ev) => void emitNewClient(ev)} className="mt-4 space-y-3">
            <label className="block text-sm text-zinc-400">
              Nome do cliente / estabelecimento
              <input
                value={newName}
                onChange={(ev) => setNewName(ev.target.value)}
                className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-zinc-100 outline-none focus:border-emerald-600"
                placeholder="Ex.: Padaria Central"
                autoComplete="organization"
              />
            </label>
            <label className="block text-sm text-zinc-400">
              NUIT (opcional)
              <input
                value={newNuit}
                onChange={(ev) => setNewNuit(ev.target.value)}
                className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-zinc-100 outline-none focus:border-emerald-600"
                placeholder="Ex.: 400123456"
              />
            </label>
            <button
              type="submit"
              disabled={newSubmitting}
              className="inline-flex items-center gap-2 rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
            >
              {newSubmitting ? <Loader2 size={16} className="animate-spin" /> : null}
              Emitir série
            </button>
          </form>
          <ResultCard title="Última emissão" result={lastNewResult} />
        </section>

        <section className="rounded-lg border border-zinc-800/50 bg-[#141414] p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold text-zinc-300">Cliente já cadastrado</h3>
              <p className="mt-1 text-xs text-zinc-500">Emite uma nova série para um tenant existente (nova validade).</p>
            </div>
            <button
              type="button"
              onClick={() => void loadTenants()}
              disabled={tenantsLoading}
              className="inline-flex items-center gap-1 rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-400 hover:border-zinc-500"
            >
              <RefreshCw size={14} className={tenantsLoading ? 'animate-spin' : ''} />
              Atualizar lista
            </button>
          </div>

          {tenantsError ? <p className="mt-2 text-sm text-amber-400">{tenantsError}</p> : null}

          <form onSubmit={(ev) => void emitForExisting(ev)} className="mt-4 space-y-3">
            <label className="block text-sm text-zinc-400">
              Cliente (tenant)
              <select
                value={existingTenantId}
                onChange={(ev) => setExistingTenantId(ev.target.value)}
                disabled={tenantsLoading || tenants.length === 0}
                className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-zinc-100 outline-none focus:border-emerald-600 disabled:opacity-50"
              >
                <option value="">{tenantsLoading ? 'A carregar…' : 'Selecione…'}</option>
                {tenants.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name || t.id}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm text-zinc-400">
              Plano
              <input
                value={plan}
                onChange={(ev) => setPlan(ev.target.value)}
                className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-zinc-100 outline-none focus:border-emerald-600"
                placeholder="BASIC"
              />
            </label>
            <label className="block text-sm text-zinc-400">
              Válido até (data)
              <input
                type="date"
                value={expiresDate}
                onChange={(ev) => setExpiresDate(ev.target.value)}
                className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-zinc-100 outline-none focus:border-emerald-600"
              />
            </label>
            <button
              type="submit"
              disabled={existingSubmitting || !existingTenantId}
              className="inline-flex items-center gap-2 rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
            >
              {existingSubmitting ? <Loader2 size={16} className="animate-spin" /> : null}
              Emitir nova série
            </button>
          </form>
          <ResultCard title="Última emissão" result={lastExistingResult} />
        </section>
      </div>
    </div>
  );
}
