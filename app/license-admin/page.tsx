'use client';

import Link from 'next/link';
import { CalendarDays } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { LicenseAdminAlertModal } from '@/components/LicenseAdminAlertModal';
import { PosDateTimePickerModal } from '@/components/PosDateTimePickerModal';
import type { LicenseIssuerClient, LicenseIssuerVoucher, LicensePlan } from '@/lib/licenseIssuerTypes';
import { formatDateTime24h } from '@/lib/formatDateTime';
import { NuitInput } from '@/components/NuitInput';
import { normalizeNuit, NUIT_DIGIT_LENGTH } from '@/lib/licensing/normalizeLicenseMeta';
import { formatReactivationTokenDisplay } from '@/lib/licensing/reactivationToken';

const TOKEN_STORAGE_KEY = 'license-issuer-admin-token';

type StorePayload = {
  clients: LicenseIssuerClient[];
  vouchers: LicenseIssuerVoucher[];
};

function authHeaders(token: string): HeadersInit {
  return { Authorization: `Bearer ${token}` };
}

function isIssueActive(expirationIso: string) {
  const t = Date.parse(expirationIso);
  if (Number.isNaN(t)) return false;
  return t > Date.now();
}

function defaultVoucherExpirationIso() {
  const d = new Date();
  d.setFullYear(d.getFullYear() + 1);
  d.setHours(8, 0, 0, 0);
  return d.toISOString();
}

type DatePickerTarget = { kind: 'voucher-new' } | { kind: 'voucher-edit'; voucherId: string; iso: string };

export default function LicenseAdminPage() {
  const [token, setToken] = useState('');
  const [tokenDraft, setTokenDraft] = useState('');
  const [store, setStore] = useState<StorePayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [newClientName, setNewClientName] = useState('');
  const [newClientTenant, setNewClientTenant] = useState('');
  const [newClientNuit, setNewClientNuit] = useState('');
  const [newClientPlan, setNewClientPlan] = useState<LicensePlan>('LITE');

  const [editingClientId, setEditingClientId] = useState<string | null>(null);
  const [confirmDeleteClientId, setConfirmDeleteClientId] = useState<string | null>(null);
  const [editClientName, setEditClientName] = useState('');
  const [editClientNuit, setEditClientNuit] = useState('');
  const [editClientPlan, setEditClientPlan] = useState<LicensePlan>('LITE');

  const [voucherClientId, setVoucherClientId] = useState('');
  const [voucherExpiresIso, setVoucherExpiresIso] = useState('');

  const [lastVoucherJson, setLastVoucherJson] = useState('');
  const [lastVoucherB64, setLastVoucherB64] = useState('');
  const [lastReactivationToken, setLastReactivationToken] = useState<{
    token: string;
    token_display: string;
    clientName: string;
    machine_id: string;
    token_expires_at: string;
    license_expires_at: string;
  } | null>(null);

  const [confirmLicensePaste, setConfirmLicensePaste] = useState('');
  const [datePickerTarget, setDatePickerTarget] = useState<DatePickerTarget | null>(null);

  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(TOKEN_STORAGE_KEY);
      if (saved) setToken(saved);
    } catch {
      // ignore
    }
  }, []);

  const persistToken = useCallback((value: string) => {
    setToken(value);
    try {
      if (value) sessionStorage.setItem(TOKEN_STORAGE_KEY, value);
      else sessionStorage.removeItem(TOKEN_STORAGE_KEY);
    } catch {
      // ignore
    }
  }, []);

  const loadStore = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/license-issuer/store', { headers: authHeaders(token) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(String(data.error || res.statusText || 'Falha ao carregar.'));
        setStore(null);
        return;
      }
      setStore({
        clients: Array.isArray(data.clients) ? data.clients : [],
        vouchers: Array.isArray(data.vouchers) ? data.vouchers : [],
      });
    } finally {
      setLoading(false);
    }
  }, [token]);

  const saveVoucherExpiration = useCallback(
    async (voucherId: string, expiresAt: string) => {
      if (!token) return;
      setLoading(true);
      setError(null);
      setMessage(null);
      try {
        const res = await fetch('/api/license-issuer/voucher', {
          method: 'PATCH',
          headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
          body: JSON.stringify({ voucher_id: voucherId, expires_at: expiresAt }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(String(data.error || res.statusText || 'Falha ao guardar data de término.'));
          return;
        }
        setDatePickerTarget(null);
        const redeemed = Boolean(data.redeemed);
        setMessage(
          redeemed
            ? `Data de término: ${formatDateTime24h(String(data.license_expires_at || expiresAt))}. Gere um token de reativação (12 dígitos, válido offline) na tabela abaixo para o cliente introduzir no POS.`
            : `Data de término: ${formatDateTime24h(String(data.license_expires_at || expiresAt))}. O POS sincroniza em background (~1 min) ou no próximo logout.`,
        );
        await loadStore();
      } finally {
        setLoading(false);
      }
    },
    [token, loadStore],
  );

  useEffect(() => {
    void loadStore();
  }, [loadStore]);

  const stats = useMemo(() => {
    if (!store) {
      return { clients: 0, active: 0, expired: 0, pendingVouchers: 0 };
    }
    let active = 0;
    let expired = 0;
    let pendingVouchers = 0;
    for (const row of store.vouchers) {
      if (!row.redeemed_machine_id) {
        if (isIssueActive(row.expiration)) pendingVouchers += 1;
        else expired += 1;
        continue;
      }
      if (isIssueActive(row.expiration)) active += 1;
      else expired += 1;
    }
    return { clients: store.clients.length, active, expired, pendingVouchers };
  }, [store]);

  const clientById = useMemo(() => {
    const map = new Map<string, LicenseIssuerClient>();
    for (const c of store?.clients ?? []) {
      map.set(c.id, c);
    }
    return map;
  }, [store]);

  const clientsWithFlags = useMemo(() => {
    if (!store) return [];
    return store.clients.map((c) => {
      const relatedVouchers = store.vouchers.filter((v) => v.client_id === c.id);
      const activeLicenses = relatedVouchers.filter(
        (v) => v.redeemed_machine_id && isIssueActive(v.expiration),
      ).length;
      const pendingVouchers = relatedVouchers.filter((v) => !v.redeemed_machine_id).length;
      return {
        ...c,
        total: relatedVouchers.length,
        activeLicenses,
        pendingVouchers,
      };
    });
  }, [store]);

  const handleLogin = () => {
    persistToken(tokenDraft.trim());
    setTokenDraft('');
  };

  const handleLogout = () => {
    persistToken('');
    setStore(null);
    setLastVoucherJson('');
    setLastVoucherB64('');
  };

  const handleCreateClient = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;
    const nuitDigits = normalizeNuit(newClientNuit);
    if (nuitDigits.length !== NUIT_DIGIT_LENGTH) {
      setError(`NUIT deve ter exactamente ${NUIT_DIGIT_LENGTH} dígitos.`);
      return;
    }
    setMessage(null);
    setError(null);
    const res = await fetch('/api/license-issuer/clients', {
      method: 'POST',
      headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: newClientName,
        tenant_id: newClientTenant.trim() || undefined,
        nuit: nuitDigits,
        plan: newClientPlan,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(String(data.error || 'Erro ao criar cliente.'));
      return;
    }
    setMessage('Cliente criado.');
    setNewClientName('');
    setNewClientTenant('');
    setNewClientNuit('');
    setNewClientPlan('LITE');
    await loadStore();
    if (data.client?.id) {
      setVoucherClientId(String(data.client.id));
    }
  };

  const saveClientMeta = useCallback(
    async (clientId: string, name: string, nuit: string, plan: LicensePlan) => {
      if (!token) return;
      const trimmedName = name.trim();
      if (trimmedName.length < 2) {
        setError('Nome da loja deve ter pelo menos 2 caracteres.');
        return;
      }
      const nuitDigits = normalizeNuit(nuit);
      if (nuitDigits.length !== NUIT_DIGIT_LENGTH) {
        setError(`NUIT deve ter exactamente ${NUIT_DIGIT_LENGTH} dígitos.`);
        return;
      }
      setLoading(true);
      setError(null);
      setMessage(null);
      try {
        const res = await fetch('/api/license-issuer/clients', {
          method: 'PATCH',
          headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: clientId, name: trimmedName, nuit: nuitDigits, plan }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(String(data.error || 'Erro ao actualizar cliente.'));
          return;
        }
        setMessage(
          'Cliente actualizado. No POS: mude de janela ou aguarde ~1 min — o rodapé mostra este nome em «Loja:».',
        );
        setEditingClientId(null);
        await loadStore();
      } finally {
        setLoading(false);
      }
    },
    [token, loadStore],
  );

  const handleDeleteClient = useCallback(
    async (clientId: string) => {
      if (!token) return;
      setLoading(true);
      setError(null);
      setMessage(null);
      try {
        const res = await fetch(
          `/api/license-issuer/clients?client_id=${encodeURIComponent(clientId)}`,
          { method: 'DELETE', headers: authHeaders(token) },
        );
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(String(data.error || 'Erro ao apagar cliente.'));
          return;
        }
        setConfirmDeleteClientId(null);
        setEditingClientId(null);
        if (voucherClientId === clientId) setVoucherClientId('');
        setMessage('Cliente apagado (códigos e registo de máquina associados foram removidos).');
        await loadStore();
      } finally {
        setLoading(false);
      }
    },
    [token, loadStore, voucherClientId],
  );

  const handleGenerateReactivationToken = useCallback(
    async (voucherId: string) => {
      if (!token) return;
      setLoading(true);
      setError(null);
      setMessage(null);
      try {
        const res = await fetch('/api/license-issuer/voucher/reactivation-token', {
          method: 'POST',
          headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
          body: JSON.stringify({ voucher_id: voucherId }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(String(data.error || 'Erro ao gerar token.'));
          return;
        }
        const client = store?.clients.find((c) => c.id === String(data.client_id ?? ''));
        const tokenDigits = String(data.token ?? '');
        setLastReactivationToken({
          token: tokenDigits,
          token_display: String(data.token_display || formatReactivationTokenDisplay(tokenDigits)),
          clientName: client?.name ?? 'Cliente',
          machine_id: String(data.machine_id ?? ''),
          token_expires_at: String(data.token_expires_at ?? ''),
          license_expires_at: String(data.license_expires_at ?? ''),
        });
        setMessage(
          `Token gerado para ${client?.name ?? 'cliente'}. Válido 7 dias; uso único nesta máquina.`,
        );
      } finally {
        setLoading(false);
      }
    },
    [token, store],
  );

  const handleGenerateVoucher = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;
    if (!voucherExpiresIso) {
      setError('Escolha a data de término (calendário).');
      return;
    }
    setMessage(null);
    setError(null);
    const res = await fetch('/api/license-issuer/voucher', {
      method: 'POST',
      headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: voucherClientId,
        expires_at: voucherExpiresIso,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(String(data.error || 'Erro ao gerar código.'));
      return;
    }
    setMessage(
      'Código gerado. Envie o Base64 (ou JSON) ao cliente — no POS cola na ativação; a máquina fica vinculada automaticamente.',
    );
    setLastVoucherJson(String(data.voucherJson || ''));
    setLastVoucherB64(String(data.codeB64 || ''));
    await loadStore();
  };

  const handleConfirmRedeem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;
    setMessage(null);
    setError(null);
    const res = await fetch('/api/license-issuer/voucher/confirm', {
      method: 'POST',
      headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ license_key: confirmLicensePaste.trim() }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(String(data.error || 'Erro ao confirmar.'));
      return;
    }
    setMessage(
      data.already
        ? 'Este código já estava associado a esta máquina.'
        : `Máquina registada na consola: ${String(data.redeemed_machine_id || '')}`,
    );
    setConfirmLicensePaste('');
    await loadStore();
  };

  const copy = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setMessage(`Copiado: ${label}`);
    } catch {
      setError('Não foi possível copiar para a área de transferência.');
    }
  };

  if (!token) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#121212] px-4 py-10 text-zinc-100">
        <div className="w-full max-w-md rounded-xl border border-zinc-800 bg-zinc-900/80 p-6 shadow-xl">
          <h1 className="text-xl font-semibold text-white">Consola de licenças POSly</h1>
          <p className="mt-2 text-sm text-zinc-400">
            Ferramenta interna para criar licenças assinadas e listar clientes.
          </p>
          <label className="mt-6 block text-sm font-medium text-zinc-300">Senha de administrador</label>
          <input
            type="password"
            value={tokenDraft}
            onChange={(e) => setTokenDraft(e.target.value)}
            className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm outline-none ring-emerald-500/40 focus:ring-2"
            autoComplete="off"
            placeholder="digite a senha"
          />
          <button
            type="button"
            onClick={handleLogin}
            className="mt-4 w-full rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500"
          >
            Entrar
          </button>
        </div>
      </div>
    );
  }

  return (
    <div lang="pt-PT" className="min-h-screen bg-[#121212] px-4 py-8 text-zinc-100">
      <div className="mx-auto max-w-5xl space-y-8">
        <header className="flex flex-col gap-4 border-b border-zinc-800 pb-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-white">Consola de licenças POSly</h1>
            <p className="mt-1 text-sm text-zinc-400">
              Emita <strong className="font-medium text-zinc-300">códigos de ativação</strong> por cliente. Com{' '}
              <code className="text-zinc-300">POS_LICENSE_ISSUER_BASE_URL</code> no POS, a activação regista a máquina em
              Supabase (<code className="text-zinc-300">device-activation</code>).
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void loadStore()}
              disabled={loading}
              className="rounded-lg border border-zinc-700 px-3 py-1.5 text-sm hover:bg-zinc-800 disabled:opacity-50"
            >
              {loading ? 'A atualizar…' : 'Atualizar'}
            </button>
            <button
              type="button"
              onClick={handleLogout}
              className="rounded-lg border border-red-900/60 px-3 py-1.5 text-sm text-red-300 hover:bg-red-950/40"
            >
              Sair
            </button>
            <Link
              href="/"
              className="rounded-lg border border-zinc-700 px-3 py-1.5 text-sm hover:bg-zinc-800"
            >
              POS
            </Link>
          </div>
        </header>

        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
            <p className="text-xs uppercase tracking-wide text-zinc-500">Clientes</p>
            <p className="mt-1 text-2xl font-semibold text-white">{stats.clients}</p>
          </div>
          <div className="rounded-xl border border-amber-900/30 bg-amber-950/15 p-4">
            <p className="text-xs uppercase tracking-wide text-amber-600/90">Códigos pendentes</p>
            <p className="mt-1 text-2xl font-semibold text-amber-100">{stats.pendingVouchers}</p>
            <p className="mt-1 text-xs text-amber-800/90">Ainda sem máquina na consola</p>
          </div>
          <div className="rounded-xl border border-emerald-900/30 bg-emerald-950/20 p-4">
            <p className="text-xs uppercase tracking-wide text-emerald-600/90">Códigos activos</p>
            <p className="mt-1 text-2xl font-semibold text-emerald-100">{stats.active}</p>
            <p className="mt-1 text-xs text-emerald-700/90">Já activados na máquina</p>
          </div>
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
            <p className="text-xs uppercase tracking-wide text-zinc-500">Códigos expirados</p>
            <p className="mt-1 text-2xl font-semibold text-zinc-200">{stats.expired}</p>
          </div>
        </section>

        <div className="grid gap-8 lg:grid-cols-2">
          <section className="space-y-4 rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
            <h2 className="text-lg font-medium text-white">Novo cliente</h2>
            <p className="text-sm text-zinc-400">
              Cada cliente recebe um <code className="text-zinc-300">tenant_id</code> estável. O{' '}
              <strong className="text-zinc-300">Nome</strong> (texto «Loja:» no rodapé do POS),{' '}
              <strong className="text-zinc-300">NUIT</strong> e <strong className="text-zinc-300">plano</strong> vêm
              daqui após activação ou ao abrir o POS (sincronização automática).
            </p>
            <form onSubmit={handleCreateClient} className="space-y-3">
              <div>
                <label className="text-sm text-zinc-300">Nome</label>
                <input
                  value={newClientName}
                  onChange={(e) => setNewClientName(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-emerald-500/40"
                  placeholder="Ex: Padaria Central"
                  required
                  minLength={2}
                />
              </div>
              <div>
                <label className="text-sm text-zinc-300">Tenant ID (opcional)</label>
                <input
                  value={newClientTenant}
                  onChange={(e) => setNewClientTenant(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-emerald-500/40"
                  placeholder="tenant-minha-loja"
                />
              </div>
              <div>
                <label className="text-sm text-zinc-300">NUIT ({NUIT_DIGIT_LENGTH} dígitos)</label>
                <NuitInput
                  value={newClientNuit}
                  onChange={setNewClientNuit}
                  showCounter
                  required
                  className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm font-mono outline-none focus:ring-2 focus:ring-emerald-500/40"
                />
              </div>
              <div>
                <label className="text-sm text-zinc-300">Plano</label>
                <select
                  value={newClientPlan}
                  onChange={(e) => setNewClientPlan(e.target.value as LicensePlan)}
                  className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-emerald-500/40"
                >
                  <option value="LITE">Lite</option>
                  <option value="PRO">Pro</option>
                </select>
              </div>
              <button
                type="submit"
                className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500"
              >
                Registar cliente
              </button>
            </form>
          </section>

          <section className="space-y-4 rounded-xl border border-amber-900/25 bg-amber-950/10 p-5 ring-1 ring-amber-900/20">
            <h2 className="text-lg font-medium text-amber-100">Código de ativação</h2>
            <p className="text-sm text-amber-100/80">
              Gera um número/Base64 <strong>sem</strong> pedir o Machine ID. O cliente cola no POS; a app grava a
              licença com o <code className="text-amber-50/90">machine_id</code> local automaticamente.
            </p>
            <form onSubmit={handleGenerateVoucher} className="space-y-3">
              <div>
                <label className="text-sm text-zinc-300">Cliente</label>
                <select
                  value={voucherClientId}
                  onChange={(e) => setVoucherClientId(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-amber-500/40"
                  required
                >
                  <option value="">— escolher —</option>
                  {store?.clients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} — {c.plan}
                      {c.nuit ? ` · NUIT ${c.nuit}` : ''} ({c.tenant_id})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-sm text-zinc-300">Data de término</label>
                <button
                  type="button"
                  onClick={() =>
                    setDatePickerTarget({
                      kind: 'voucher-new',
                    })
                  }
                  className="mt-1 flex w-full items-center gap-2 rounded-lg border border-zinc-700 bg-[#131314] px-3 py-2 text-sm text-zinc-200 outline-none transition-colors hover:border-zinc-600 hover:bg-zinc-900 focus:border-[#2a9cd4] focus:ring-1 focus:ring-[#2a9cd4]/40"
                >
                  <CalendarDays size={16} className="shrink-0 text-zinc-400" />
                  <span className="flex-1 text-left">
                    {voucherExpiresIso
                      ? formatDateTime24h(voucherExpiresIso)
                      : 'Escolher data e hora…'}
                  </span>
                </button>
              </div>
              <button
                type="submit"
                className="w-full rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-zinc-950 hover:bg-amber-500"
              >
                Gerar código
              </button>
            </form>
          </section>
        </div>

        {lastReactivationToken ? (
          <section className="space-y-3 rounded-xl border border-emerald-900/35 bg-emerald-950/15 p-5">
            <h2 className="text-lg font-medium text-emerald-100">Token de reativação (para o cliente)</h2>
            <p className="text-sm text-emerald-100/80">
              Envie estes <strong>12 dígitos</strong> à loja <strong>{lastReactivationToken.clientName}</strong> (funcionam
              sem internet no POS, desde que o segredo HMAC seja o mesmo).
              No POS (licença expirada ou ativação), cole só o número — só funciona na máquina{' '}
              <code className="font-mono text-xs text-emerald-50/90">{lastReactivationToken.machine_id}</code>.
            </p>
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-black/40 px-4 py-3">
              <span className="font-mono text-2xl font-semibold tracking-widest text-white">
                {lastReactivationToken.token_display}
              </span>
              <button
                type="button"
                onClick={() => void copy(lastReactivationToken.token, 'token')}
                className="text-sm text-emerald-300 hover:underline"
              >
                Copiar dígitos
              </button>
            </div>
            <p className="text-xs text-emerald-800/90">
              Licença até {formatDateTime24h(lastReactivationToken.license_expires_at)} · token válido até{' '}
              {formatDateTime24h(lastReactivationToken.token_expires_at)} · uso único
            </p>
          </section>
        ) : null}

        {(lastVoucherJson || lastVoucherB64) && (
          <section className="space-y-3 rounded-xl border border-amber-900/30 bg-amber-950/10 p-5">
            <h2 className="text-lg font-medium text-amber-100">Último código gerado (para o cliente)</h2>
            {lastVoucherJson ? (
              <div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm text-amber-100/80">JSON do voucher</span>
                  <button
                    type="button"
                    onClick={() => void copy(lastVoucherJson, 'JSON voucher')}
                    className="text-xs text-amber-300 hover:underline"
                  >
                    Copiar
                  </button>
                </div>
                <pre className="mt-2 max-h-40 overflow-auto rounded-lg bg-black/50 p-3 text-xs text-zinc-300">
                  {lastVoucherJson}
                </pre>
              </div>
            ) : null}
            {lastVoucherB64 ? (
              <div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm text-amber-100/80">Base64 (colar no POS)</span>
                  <button
                    type="button"
                    onClick={() => void copy(lastVoucherB64, 'Base64 voucher')}
                    className="text-xs text-amber-300 hover:underline"
                  >
                    Copiar
                  </button>
                </div>
                <pre className="mt-2 max-h-24 overflow-auto break-all rounded-lg bg-black/50 p-3 text-xs text-zinc-300">
                  {lastVoucherB64}
                </pre>
              </div>
            ) : null}
          </section>
        )}

        <section className="space-y-3 rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
          <h2 className="text-lg font-medium text-white">Registar máquina na consola (opcional)</h2>
          <p className="text-sm text-zinc-400">
            Depois do cliente ativar no POS, o ficheiro <code className="text-zinc-300">license.json</code> inclui{' '}
            <code className="text-zinc-300">voucher_nonce</code>. Cole aqui o JSON ou Base64 dessa licença para
            aparecer o Machine ID na tabela de códigos abaixo.
          </p>
          <form onSubmit={handleConfirmRedeem} className="space-y-2">
            <textarea
              value={confirmLicensePaste}
              onChange={(e) => setConfirmLicensePaste(e.target.value)}
              rows={5}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 font-mono text-xs text-zinc-200 outline-none focus:ring-2 focus:ring-emerald-500/40"
              placeholder="{ ... } ou Base64..."
            />
            <button
              type="submit"
              className="rounded-lg border border-zinc-600 px-4 py-2 text-sm text-zinc-200 hover:bg-zinc-800"
            >
              Confirmar ativação
            </button>
          </form>
        </section>

        <section className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/40">
          <div className="border-b border-zinc-800 px-5 py-3">
            <h2 className="text-lg font-medium text-white">Clientes</h2>
            <p className="text-xs text-zinc-500">
              Códigos activos / pendentes / total de códigos por cliente
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-zinc-950/80 text-xs uppercase text-zinc-500">
                <tr>
                  <th className="px-4 py-2 font-medium">Nome</th>
                  <th className="px-4 py-2 font-medium">NUIT</th>
                  <th className="px-4 py-2 font-medium">Plano</th>
                  <th className="px-4 py-2 font-medium">Tenant</th>
                  <th className="px-4 py-2 font-medium">Activos / Pendentes / Total</th>
                  <th className="px-4 py-2 font-medium">Criado</th>
                  <th className="px-4 py-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {clientsWithFlags.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-6 text-center text-zinc-500">
                      Sem clientes. Crie o primeiro acima.
                    </td>
                  </tr>
                ) : (
                  clientsWithFlags.map((row) => (
                    <tr key={row.id} className="border-t border-zinc-800/80">
                      <td className="px-4 py-2 text-zinc-200">
                        {editingClientId === row.id ? (
                          <input
                            value={editClientName}
                            onChange={(e) => setEditClientName(e.target.value)}
                            className="w-full min-w-[8rem] rounded border border-zinc-600 bg-zinc-950 px-2 py-1 text-sm"
                            minLength={2}
                            required
                          />
                        ) : (
                          row.name
                        )}
                      </td>
                      <td className="px-4 py-2 font-mono text-xs text-zinc-300">
                        {editingClientId === row.id ? (
                          <NuitInput
                            value={editClientNuit}
                            onChange={setEditClientNuit}
                            className="w-[6.75rem] rounded border border-zinc-600 bg-zinc-950 px-2 py-1 font-mono text-xs"
                          />
                        ) : (
                          row.nuit || '—'
                        )}
                      </td>
                      <td className="px-4 py-2 text-zinc-300">
                        {editingClientId === row.id ? (
                          <select
                            value={editClientPlan}
                            onChange={(e) => setEditClientPlan(e.target.value as LicensePlan)}
                            className="rounded border border-zinc-600 bg-zinc-950 px-2 py-1 text-xs"
                          >
                            <option value="LITE">Lite</option>
                            <option value="PRO">Pro</option>
                          </select>
                        ) : (
                          row.plan
                        )}
                      </td>
                      <td className="px-4 py-2 font-mono text-xs text-zinc-400">{row.tenant_id}</td>
                      <td className="px-4 py-2">
                        <span className="text-emerald-400">{row.activeLicenses}</span>
                        <span className="text-zinc-600"> / </span>
                        <span className="text-amber-400">{row.pendingVouchers}</span>
                        <span className="text-zinc-600"> / </span>
                        <span className="text-zinc-300">{row.total}</span>
                      </td>
                      <td className="px-4 py-2 text-xs text-zinc-500">
                        {formatDateTime24h(row.created_at)}
                      </td>
                      <td className="px-4 py-2 text-right">
                        {editingClientId === row.id ? (
                          <div className="flex justify-end gap-2">
                            <button
                              type="button"
                              className="text-xs text-emerald-400 hover:underline"
                              onClick={() =>
                                void saveClientMeta(row.id, editClientName, editClientNuit, editClientPlan)
                              }
                            >
                              Guardar
                            </button>
                            <button
                              type="button"
                              className="text-xs text-zinc-500 hover:underline"
                              onClick={() => setEditingClientId(null)}
                            >
                              Cancelar
                            </button>
                          </div>
                        ) : confirmDeleteClientId === row.id ? (
                          <div className="flex flex-col items-end gap-1">
                            <span className="text-xs text-red-300/90">Apagar este cliente?</span>
                            <div className="flex justify-end gap-2">
                              <button
                                type="button"
                                disabled={loading}
                                className="text-xs text-red-400 hover:underline disabled:opacity-50"
                                onClick={() => void handleDeleteClient(row.id)}
                              >
                                Sim, apagar
                              </button>
                              <button
                                type="button"
                                disabled={loading}
                                className="text-xs text-zinc-500 hover:underline disabled:opacity-50"
                                onClick={() => setConfirmDeleteClientId(null)}
                              >
                                Cancelar
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex justify-end gap-3">
                            <button
                              type="button"
                              className="text-xs text-zinc-400 hover:text-zinc-200 hover:underline"
                              onClick={() => {
                                setConfirmDeleteClientId(null);
                                setEditingClientId(row.id);
                                setEditClientName(row.name ?? '');
                                setEditClientNuit(normalizeNuit(row.nuit ?? ''));
                                setEditClientPlan(row.plan ?? 'LITE');
                              }}
                            >
                              Editar
                            </button>
                            <button
                              type="button"
                              className="text-xs text-red-400/90 hover:text-red-300 hover:underline"
                              onClick={() => {
                                setEditingClientId(null);
                                setConfirmDeleteClientId(row.id);
                              }}
                            >
                              Apagar
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/40">
          <div className="border-b border-zinc-800 px-5 py-3">
            <h2 className="text-lg font-medium text-white">Códigos de ativação</h2>
            <p className="text-xs text-zinc-500">
              <strong className="text-zinc-400">Editar data</strong> prolonga a licença. Em códigos já{' '}
              <strong className="text-zinc-400">Ativados</strong>, use <strong className="text-zinc-400">Token reativação</strong>{' '}
              (12 dígitos) em vez do Base64 longo.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-zinc-950/80 text-xs uppercase text-zinc-500">
                <tr>
                  <th className="px-4 py-2 font-medium">Estado</th>
                  <th className="px-4 py-2 font-medium">Cliente</th>
                  <th className="px-4 py-2 font-medium">Plano</th>
                  <th className="px-4 py-2 font-medium">Tenant</th>
                  <th className="px-4 py-2 font-medium">Máquina</th>
                  <th className="px-4 py-2 font-medium">Expira</th>
                  <th className="px-4 py-2 font-medium">Emitido</th>
                  <th className="px-4 py-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {!store || store.vouchers.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-6 text-center text-zinc-500">
                      Nenhum código de ativação ainda.
                    </td>
                  </tr>
                ) : (
                  [...store.vouchers]
                    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
                    .map((row) => {
                      const pending = !row.redeemed_machine_id;
                      const active = pending && isIssueActive(row.expiration);
                      const client = clientById.get(row.client_id);
                      return (
                        <tr key={row.id} className="border-t border-zinc-800/80">
                          <td className="px-4 py-2">
                            {row.redeemed_machine_id ? (
                              <span className="rounded-full bg-emerald-950/80 px-2 py-0.5 text-xs text-emerald-300">
                                Ativado
                              </span>
                            ) : active ? (
                              <span className="rounded-full bg-amber-950/80 px-2 py-0.5 text-xs text-amber-200">
                                Pendente
                              </span>
                            ) : (
                              <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-xs text-zinc-400">
                                Expirado
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-2 text-zinc-200">
                            {client?.name ?? (
                              <span className="text-zinc-500" title={row.client_id}>
                                —
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-2">
                            {client?.plan === 'PRO' ? (
                              <span className="rounded-full bg-violet-950/80 px-2 py-0.5 text-xs font-medium text-violet-200">
                                Pro
                              </span>
                            ) : client?.plan === 'LITE' ? (
                              <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-xs text-zinc-300">
                                Lite
                              </span>
                            ) : (
                              <span className="text-zinc-500">—</span>
                            )}
                          </td>
                          <td className="px-4 py-2 font-mono text-xs text-zinc-400">{row.tenant_id}</td>
                          <td className="px-4 py-2 font-mono text-xs text-zinc-400">
                            {row.redeemed_machine_id || '—'}
                          </td>
                          <td className="px-4 py-2 text-xs text-zinc-300">
                            {formatDateTime24h(row.expiration)}
                          </td>
                          <td className="px-4 py-2 text-xs text-zinc-500">
                            {formatDateTime24h(row.created_at)}
                          </td>
                          <td className="px-4 py-2 text-right">
                            <div className="flex flex-wrap items-center justify-end gap-2">
                              <button
                                type="button"
                                onClick={() =>
                                  setDatePickerTarget({
                                    kind: 'voucher-edit',
                                    voucherId: row.id,
                                    iso: row.expiration,
                                  })
                                }
                                className="text-xs text-amber-300 hover:underline"
                              >
                                Editar data
                              </button>
                              {row.redeemed_machine_id ? (
                                <button
                                  type="button"
                                  disabled={loading || !isIssueActive(row.expiration)}
                                  title={
                                    !isIssueActive(row.expiration)
                                      ? 'Prolongue a data antes de gerar o token'
                                      : undefined
                                  }
                                  onClick={() => void handleGenerateReactivationToken(row.id)}
                                  className="text-xs text-emerald-300 hover:underline disabled:cursor-not-allowed disabled:opacity-40"
                                >
                                  Token reativação
                                </button>
                              ) : null}
                              <button
                                type="button"
                                onClick={() => void copy(row.code_b64, 'código')}
                                className="text-xs text-zinc-400 hover:underline"
                              >
                                Copiar Base64
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <LicenseAdminAlertModal
        open={Boolean(message || error)}
        variant={error ? 'error' : 'success'}
        message={error || message || ''}
        onClose={() => {
          setMessage(null);
          setError(null);
        }}
      />

      <PosDateTimePickerModal
        open={datePickerTarget != null}
        title={
          datePickerTarget?.kind === 'voucher-new'
            ? 'Data de término do código'
            : 'Alterar data de término'
        }
        value={
          datePickerTarget?.kind === 'voucher-edit'
            ? datePickerTarget.iso
            : voucherExpiresIso || defaultVoucherExpirationIso()
        }
        onClose={() => setDatePickerTarget(null)}
        onApply={(iso) => {
          if (datePickerTarget?.kind === 'voucher-edit') {
            void saveVoucherExpiration(datePickerTarget.voucherId, iso);
            return;
          }
          setVoucherExpiresIso(iso);
          setDatePickerTarget(null);
        }}
      />
    </div>
  );
}
