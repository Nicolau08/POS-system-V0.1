'use client';

import { useCallback, useEffect, useState } from 'react';
import { CloudCheck, CloudOff, Plug, Unplug } from 'lucide-react';

type SyncStatusResponse = {
  total_pending?: number;
  total_failed?: number;
  total_synced?: number;
  last_synced_at?: string | null;
  last_error?: {
    created_at?: string | null;
  } | null;
};

function getStatusColor(isPositive: boolean | null): string {
  if (isPositive == null) return 'text-zinc-400';
  return isPositive ? 'text-emerald-500' : 'text-red-500';
}

export function SyncStatus() {
  const [online, setOnline] = useState<boolean>(false);
  const [totalPending, setTotalPending] = useState<number | null>(null);
  const [totalFailed, setTotalFailed] = useState<number | null>(null);
  const [totalSynced, setTotalSynced] = useState<number | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [lastErrorAt, setLastErrorAt] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState<number>(() => Date.now());

  const loadSyncStatus = useCallback(async () => {
    if (!navigator.onLine) {
      setOnline(false);
      return;
    }

    try {
      const response = await fetch('http://localhost:3001/sync/status', {
        method: 'GET',
        cache: 'no-store',
      });
      if (!response.ok) {
        setOnline(false);
        return;
      }

      const data = (await response.json()) as SyncStatusResponse;
      setOnline(true);
      setTotalPending(Number(data.total_pending ?? 0));
      setTotalFailed(Number(data.total_failed ?? 0));
      setTotalSynced(Number(data.total_synced ?? 0));
      setLastSyncedAt(data.last_synced_at ?? null);
      setLastErrorAt(data.last_error?.created_at ?? null);
    } catch {
      setOnline(false);
      // Keep last known values when API is temporarily unavailable.
    }
  }, []);

  useEffect(() => {
    const updateOnline = () => {
      if (!navigator.onLine) {
        setOnline(false);
        return;
      }
      loadSyncStatus();
    };
    updateOnline();

    window.addEventListener('online', updateOnline);
    window.addEventListener('offline', updateOnline);
    return () => {
      window.removeEventListener('online', updateOnline);
      window.removeEventListener('offline', updateOnline);
    };
  }, []);

  useEffect(() => {
    loadSyncStatus();
    const intervalId = window.setInterval(loadSyncStatus, 5000);
    return () => window.clearInterval(intervalId);
  }, [loadSyncStatus]);

  useEffect(() => {
    const timerId = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timerId);
  }, []);

  const isOffline = !online;
  const recentErrorThresholdMs = 2 * 60 * 1000;
  const lastErrorTimeMs = lastErrorAt ? new Date(lastErrorAt).getTime() : NaN;
  const lastSyncedTimeMs = lastSyncedAt ? new Date(lastSyncedAt).getTime() : NaN;
  const errorAgeMs = Number.isFinite(lastErrorTimeMs) ? Math.max(0, nowMs - lastErrorTimeMs) : null;
  const hasRecoveredAfterError =
    Number.isFinite(lastSyncedTimeMs) &&
    Number.isFinite(lastErrorTimeMs) &&
    lastSyncedTimeMs > lastErrorTimeMs;
  const hasRecentError = errorAgeMs != null && errorAgeMs < recentErrorThresholdMs && !hasRecoveredAfterError;
  const isSyncError = hasRecentError;
  const isSyncing = (totalPending ?? 0) > 0;
  const isSyncSuccess = !isSyncError && (totalSynced ?? 0) > 0;
  const onlineColor = getStatusColor(online);
  const cloudColor = isOffline
    ? 'text-red-500'
    : isSyncError
      ? 'text-red-500'
      : isSyncing
        ? 'text-amber-400'
        : isSyncSuccess
          ? 'text-emerald-500'
          : 'text-zinc-400';
  const cloudTitle = isOffline
    ? 'Offline'
    : isSyncError
      ? 'Erro de sincronização'
      : isSyncing
        ? 'Sincronizando...'
        : isSyncSuccess
          ? 'Sincronizado'
          : 'Waiting for sync activity';
  const lastSyncLabel = isSyncError
    ? errorAgeMs != null && errorAgeMs < 60_000
      ? `Erro ha ${Math.max(1, Math.floor(errorAgeMs / 1000))}s`
      : `Erro ha ${Math.max(1, Math.floor((errorAgeMs ?? 0) / 60_000))}m`
    : lastSyncedAt
    ? new Date(lastSyncedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
    : 'Nunca sincronizado';

  return (
    <div className="flex items-center gap-2 px-2 py-1 rounded-md bg-zinc-900/70 border border-zinc-800">
      <div
        className="flex items-center justify-center"
        title={online ? 'Online' : 'Sem ligação ao servidor'}
      >
        {online ? <Plug size={18} className={onlineColor} /> : <Unplug size={18} className={onlineColor} />}
      </div>

      <div className="flex items-center justify-center" title={cloudTitle}>
        {isOffline || isSyncError ? (
          <CloudOff size={18} className={cloudColor} />
        ) : (
          <CloudCheck size={18} className={`${cloudColor} ${isSyncing ? 'animate-pulse' : ''}`} />
        )}
        <span className="ml-1 text-[10px] text-zinc-400 whitespace-nowrap">{lastSyncLabel}</span>
      </div>
    </div>
  );
}
