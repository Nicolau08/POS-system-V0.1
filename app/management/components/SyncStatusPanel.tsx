'use client';

import { useCallback, useMemo, useState } from 'react';
import { useSyncStatus } from '@/hooks/useSyncStatus';
import { getPosApiBase } from '@/lib/apiBase';

function formatSyncDate(value: string | null) {
  if (!value) return 'Nunca';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Nunca';
  return date.toLocaleString();
}

export default function SyncStatusPanel() {
  const { online, pending, failed, lastSync } = useSyncStatus();
  const [isRetrying, setIsRetrying] = useState(false);
  const [retryMessage, setRetryMessage] = useState<string | null>(null);

  const state = useMemo(() => {
    if (!online) return { label: 'Offline', dot: 'bg-red-500' };
    if (pending > 0) return { label: 'Syncing', dot: 'bg-amber-400' };
    return { label: 'Online', dot: 'bg-emerald-500' };
  }, [online, pending]);

  const handleRetryFailed = useCallback(async () => {
    setIsRetrying(true);
    setRetryMessage(null);
    try {
      const response = await fetch(`${getPosApiBase()}/sync/run`, {
        method: 'POST',
      });
      if (!response.ok) {
        setRetryMessage('Falha ao iniciar retry');
        return;
      }
      setRetryMessage('Retry iniciado');
    } catch {
      setRetryMessage('Falha ao iniciar retry');
    } finally {
      setIsRetrying(false);
    }
  }, []);

  return (
    <div className="bg-[#141414] border border-zinc-800/50 rounded-lg p-4 flex flex-col min-h-[250px] hover:border-zinc-700 transition-colors">
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
        <div className="pt-2 border-t border-zinc-800">
          <div className="flex items-center justify-between text-xs">
            <span className="text-zinc-500">Último sync</span>
            <span className="text-zinc-400">{formatSyncDate(lastSync)}</span>
          </div>
        </div>
      </div>

      <div className="mt-4 pt-3 border-t border-zinc-800">
        <button
          type="button"
          onClick={handleRetryFailed}
          disabled={!online || failed <= 0 || isRetrying}
          className="w-full h-9 rounded border border-zinc-800 bg-[#121212] text-zinc-200 text-xs font-medium transition-all hover:border-zinc-700 hover:bg-zinc-800/70 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isRetrying ? 'Retrying...' : 'Retry failed'}
        </button>
        {retryMessage ? <p className="mt-2 text-[10px] text-zinc-500">{retryMessage}</p> : null}
      </div>
    </div>
  );
}
