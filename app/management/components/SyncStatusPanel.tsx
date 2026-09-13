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

function reasonHint(reason: string | null, cloudConfigured: boolean) {
  if (!cloudConfigured || reason === 'supabase_not_configured') {
    return 'Cloud não configurada neste PC — reinstale com build que inclui Supabase.';
  }
  if (reason === 'no_internet') return 'Sem ligação à internet / Supabase.';
  if (reason === 'sync_service_inactive') return 'Serviço de sync inactivo.';
  return null;
}

export default function SyncStatusPanel() {
  const { online, pending, failed, lastSync, cloudConfigured, syncActive, reason, refresh } =
    useSyncStatus();
  const [isRetrying, setIsRetrying] = useState(false);
  const [retryMessage, setRetryMessage] = useState<string | null>(null);

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
