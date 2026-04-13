'use client';

import { useCallback, useEffect, useState } from 'react';
import { getPosApiBase } from '@/lib/apiBase';

type SyncStatusApiResponse = {
  online?: boolean;
  pending?: number;
  failed?: number;
  lastSync?: string | null;
  total_pending?: number;
  total_failed?: number;
  last_synced_at?: string | null;
};

export type SyncStatusState = {
  online: boolean;
  pending: number;
  failed: number;
  lastSync: string | null;
  isLoading: boolean;
};

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

      const data = (await response.json()) as SyncStatusApiResponse;
      const pending = Number(data.pending ?? data.total_pending ?? 0);
      const failed = Number(data.failed ?? data.total_failed ?? 0);
      const lastSync = data.lastSync ?? data.last_synced_at ?? null;
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
