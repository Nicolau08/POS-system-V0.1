'use client';

import { useCallback, useEffect, useState } from 'react';
import { getPosApiBase } from '@/lib/apiBase';
import { unwrapApiSuccessPayload } from '@/lib/apiResponse';

type SyncStatusApiResponse = {
  online?: boolean;
  pending?: number;
  failed?: number;
  lastSync?: string | null;
  total_pending?: number;
  total_failed?: number;
  last_synced_at?: string | null;
  pull_sync_state?: Array<{ id?: string; last_sync_at?: string | null }>;
};

export type SyncStatusState = {
  online: boolean;
  pending: number;
  failed: number;
  lastSync: string | null;
  isLoading: boolean;
};

function resolveLastSync(data: SyncStatusApiResponse): string | null {
  const candidates: string[] = [];
  const pushTs = data.lastSync ?? data.last_synced_at;
  if (pushTs) candidates.push(String(pushTs));

  for (const row of data.pull_sync_state ?? []) {
    const ts = row?.last_sync_at;
    if (ts) candidates.push(String(ts));
  }

  if (candidates.length === 0) return null;

  let best: string | null = null;
  let bestMs = Number.NEGATIVE_INFINITY;
  for (const ts of candidates) {
    const ms = Date.parse(ts);
    if (!Number.isFinite(ms)) continue;
    if (ms >= bestMs) {
      bestMs = ms;
      best = ts;
    }
  }
  return best;
}

export function useSyncStatus() {
  const [status, setStatus] = useState<SyncStatusState>({
    online: typeof navigator !== 'undefined' ? navigator.onLine : true,
    pending: 0,
    failed: 0,
    lastSync: null,
    isLoading: true,
  });

  const fetchStatus = useCallback(async () => {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      setStatus((prev) => ({ ...prev, online: false, isLoading: false }));
      return;
    }

    try {
      const response = await fetch(`${getPosApiBase()}/sync/status`, {
        method: 'GET',
        cache: 'no-store',
      });

      if (!response.ok) {
        setStatus((prev) => ({ ...prev, online: false, isLoading: false }));
        return;
      }

      const payload = await response.json();
      const data = unwrapApiSuccessPayload<SyncStatusApiResponse>(payload) ?? (payload as SyncStatusApiResponse);
      const pending = Number(data.pending ?? data.total_pending ?? 0);
      const failed = Number(data.failed ?? data.total_failed ?? 0);
      const lastSync = resolveLastSync(data);
      const online = typeof data.online === 'boolean' ? data.online : true;

      setStatus({
        online,
        pending,
        failed,
        lastSync,
        isLoading: false,
      });
    } catch {
      setStatus((prev) => ({ ...prev, online: false, isLoading: false }));
    }
  }, []);

  useEffect(() => {
    void fetchStatus();
    const intervalId = window.setInterval(() => {
      void fetchStatus();
    }, 3000);

    return () => window.clearInterval(intervalId);
  }, [fetchStatus]);

  useEffect(() => {
    const handleOnline = () => {
      void fetchStatus();
    };
    const handleOffline = () => {
      setStatus((prev) => ({ ...prev, online: false }));
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [fetchStatus]);

  return status;
}
