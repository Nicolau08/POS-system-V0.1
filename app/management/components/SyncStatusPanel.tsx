'use client';

import { useCallback, useMemo, useState } from 'react';
import { useSyncStatus } from '@/hooks/useSyncStatus';
import { getPosApiBase, getPosUserAuthHeaders } from '@/lib/apiBase';

function formatSyncDate(value: string | null) {
  if (!value) return 'Nunca';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Nunca';
  return date.toLocaleString('pt-PT', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

const TYPE_LABELS: Record<string, string> = {
  sale: 'Vendas',
  product: 'Produtos',
  category: 'Categorias',
  customer: 'Clientes',
};

function formatByTypeLine(counts: Record<string, number>): string | null {
  const entries = Object.entries(counts).filter(([, count]) => count > 0);
  if (entries.length === 0) return null;
  return entries.map(([type, count]) => `${TYPE_LABELS[type] ?? type} ${count}`).join(' · ');
}

function reasonHint(reason: string | null, cloudConfigured: boolean) {
  if (!cloudConfigured || reason === 'supabase_not_configured') {
    return 'Cloud não configurada neste PC — reinstale com build que inclui Supabase.';
  }
  if (reason === 'no_internet') return 'Sem ligação à internet.';
  if (reason === 'sync_service_inactive') return 'Serviço de sync inactivo.';
  return null;
}

function formatAttemptWindow(first: string | null, last: string | null): string | null {
  if (!first && !last) return null;
  if (first === last || !last) return formatSyncDate(first);
  return `${formatSyncDate(first)} → ${formatSyncDate(last)}`;
}

export default function SyncStatusPanel() {
  const { online, pending, failed, lastSync, cloudConfigured, syncActive, reason, byType, tenantDiagnostic, rlsDiagnostic, refresh } =
    useSyncStatus();
  const [isRetrying, setIsRetrying] = useState(false);
  const [retryMessage, setRetryMessage] = useState<string | null>(null);

  const pendingByTypeLine = useMemo(() => formatByTypeLine(byType.pending), [byType.pending]);
  const failedByTypeLine = useMemo(() => formatByTypeLine(byType.failed), [byType.failed]);
  const deadByTypeLine = useMemo(() => formatByTypeLine(byType.dead), [byType.dead]);
  const hasByTypeDetail = Boolean(pendingByTypeLine || failedByTypeLine || deadByTypeLine);

  const hasTenantMismatch =
    tenantDiagnostic.categories.other > 0 ||
    tenantDiagnostic.products.other > 0 ||
    tenantDiagnostic.queueDead.category.other > 0 ||
    tenantDiagnostic.queueDead.product.other > 0;

  const hasRlsDiagnostic = rlsDiagnostic.category.items > 0 || rlsDiagnostic.product.items > 0;

  const state = useMemo(() => {
    if (!cloudConfigured) return { label: 'Só local', dot: 'bg-zinc-500' };
    if (!online) return { label: 'Offline', dot: 'bg-red-500' };
    if (pending > 0 && syncActive) return { label: 'A sincronizar', dot: 'bg-amber-400' };
    if (pending > 0) return { label: 'Pendente', dot: 'bg-amber-400' };
    if (failed > 0) return { label: 'Com falhas', dot: 'bg-red-500' };
    return { label: 'Online', dot: 'bg-[#0001fb]' };
  }, [cloudConfigured, online, pending, failed, syncActive]);

  const hint = useMemo(() => reasonHint(reason, cloudConfigured), [reason, cloudConfigured]);
  const canRunSync = cloudConfigured && online && (pending > 0 || failed > 0);

  const handleRunSync = useCallback(async () => {
    setIsRetrying(true);
    setRetryMessage(null);
    try {
      const response = await fetch(`${getPosApiBase()}/sync/run`, {
        method: 'POST',
        headers: { ...getPosUserAuthHeaders() },
      });
      if (!response.ok) {
        setRetryMessage(
          response.status === 403
            ? 'Sem permissão de admin para forçar sync'
            : 'Falha ao iniciar sincronização',
        );
        return;
      }
      setRetryMessage(failed > 0 ? 'Retry iniciado' : 'Sincronização iniciada');
      void refresh();
    } catch {
      setRetryMessage('Falha ao iniciar sincronização');
    } finally {
      setIsRetrying(false);
    }
  }, [failed, refresh]);

  return (
    <div className="bg-pos-card border border-pos-border rounded p-4 flex flex-col min-h-[250px] hover:border-[#0001fb] transition-colors">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h4 className="text-xs font-bold text-zinc-300 capitalize tracking-wider">Status de sincronização</h4>
          <p className="text-[10px] text-zinc-500 mt-0.5">Atualização automática a cada 3s</p>
        </div>
        <div className={`w-2 h-2 rounded-full ${state.dot}`} />
      </div>

      <div className="flex-1 flex flex-col justify-center gap-3">
        <div className="flex items-center justify-between text-xs">
          <span className="text-zinc-500">Estado</span>
          <span className="text-zinc-200 font-bold uppercase">{state.label}</span>
        </div>
        <div className="flex items-center justify-between text-xs">
          <span className="text-zinc-500">Pendentes</span>
          <span className="text-zinc-200 font-bold">{pending}</span>
        </div>
        <div className="flex items-center justify-between text-xs">
          <span className="text-zinc-500">Falhas</span>
          <span className="text-zinc-200 font-bold">{failed}</span>
        </div>
        {hasByTypeDetail ? (
          <div className="space-y-1 text-[10px] text-zinc-500 leading-snug">
            {pendingByTypeLine ? <p>Pendentes: {pendingByTypeLine}</p> : null}
            {failedByTypeLine ? <p>Falhas: {failedByTypeLine}</p> : null}
            {deadByTypeLine ? <p>Permanentes: {deadByTypeLine}</p> : null}
          </div>
        ) : null}
        {hasTenantMismatch ? (
          <div className="space-y-1 text-[10px] text-amber-500/90 leading-snug border-t border-pos-border pt-2">
            <p className="font-bold uppercase tracking-wide">Tenant desalinhado</p>
            {tenantDiagnostic.categories.other > 0 ? (
              <p>Categorias: {tenantDiagnostic.categories.current} actuais · {tenantDiagnostic.categories.other} de outro tenant</p>
            ) : null}
            {tenantDiagnostic.products.other > 0 ? (
              <p>Produtos: {tenantDiagnostic.products.current} actuais · {tenantDiagnostic.products.other} de outro tenant</p>
            ) : null}
            {tenantDiagnostic.queueDead.category.other > 0 ? (
              <p>Fila (categoria, permanente): {tenantDiagnostic.queueDead.category.other} de outro tenant</p>
            ) : null}
            {tenantDiagnostic.queueDead.product.other > 0 ? (
              <p>Fila (produto, permanente): {tenantDiagnostic.queueDead.product.other} de outro tenant</p>
            ) : null}
          </div>
        ) : null}
        {hasRlsDiagnostic ? (
          <div className="space-y-1 text-[10px] text-amber-500/90 leading-snug border-t border-pos-border pt-2">
            <p className="font-bold uppercase tracking-wide">Diagnóstico RLS</p>
            {rlsDiagnostic.category.items > 0 ? (
              <p>
                Categorias: {rlsDiagnostic.category.items} permanentes · {rlsDiagnostic.category.totalAttempts} tentativas
                {rlsDiagnostic.category.sameRlsErrorAttempts > 0 ? ` (${rlsDiagnostic.category.sameRlsErrorAttempts} com o mesmo erro RLS)` : ''}
                {formatAttemptWindow(rlsDiagnostic.category.firstAttempt, rlsDiagnostic.category.lastAttempt)
                  ? ` · ${formatAttemptWindow(rlsDiagnostic.category.firstAttempt, rlsDiagnostic.category.lastAttempt)}`
                  : ''}
              </p>
            ) : null}
            {rlsDiagnostic.product.items > 0 ? (
              <p>
                Produtos: {rlsDiagnostic.product.items} permanentes · {rlsDiagnostic.product.totalAttempts} tentativas
                {formatAttemptWindow(rlsDiagnostic.product.firstAttempt, rlsDiagnostic.product.lastAttempt)
                  ? ` · ${formatAttemptWindow(rlsDiagnostic.product.firstAttempt, rlsDiagnostic.product.lastAttempt)}`
                  : ''}
              </p>
            ) : null}
          </div>
        ) : null}
        <div className="pt-2 border-t border-pos-border">
          <div className="flex items-center justify-between text-xs">
            <span className="text-zinc-500">Último sync</span>
            <span className="text-zinc-400">{formatSyncDate(lastSync)}</span>
          </div>
        </div>
        {hint ? <p className="text-[10px] text-amber-500/90 leading-snug">{hint}</p> : null}
      </div>

      <div className="mt-4 pt-3 border-t border-pos-border">
        <button
          type="button"
          onClick={handleRunSync}
          disabled={!canRunSync || isRetrying}
          className="w-full h-9 rounded border border-pos-border bg-pos-field text-zinc-200 text-xs font-medium transition-all hover:border-[#0001fb] hover:bg-pos-surface-3 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isRetrying ? 'A sincronizar...' : failed > 0 ? 'Repetir falhas' : 'Sincronizar agora'}
        </button>
        {retryMessage ? <p className="mt-2 text-[10px] text-zinc-500">{retryMessage}</p> : null}
      </div>
    </div>
  );
}
