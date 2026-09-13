'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  getPosApiBase,
  getPosUserAuthHeaders,
  getStoredAuthToken,
  isPosSessionActive,
} from '@/lib/apiBase';
import { unwrapApiSuccessPayload } from '@/lib/apiResponse';

type SyncStatusApiResponse = {
  online?: boolean;
  pending?: number;
  failed?: number;
  lastSync?: string | null;
  total_pending?: number;
  total_failed?: number;
  last_synced_at?: string | null;
  cloud_configured?: boolean;
  sync_active?: boolean;
  mode?: string | null;
  reason?: string | null;
  pull_sync_state?: Array<{ id?: string; last_sync_at?: string | null }>;
};

export type SyncStatusState = {
  online: boolean;
  pending: number;
  failed: number;
  lastSync: string | null;
  isLoading: boolean;
  cloudConfigured: boolean;
  syncActive: boolean;
  mode: string | null;
  reason: string | null;
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

function canPollSyncStatus(): boolean {
  if (typeof window === 'undefined') return false;
  if (!isPosSessionActive()) return false;
  try {
    if (localStorage.getItem('isLoggedIn') !== 'true') return false;
  } catch {
    return false;
  }
  return Boolean(getStoredAuthToken());
}

export function useSyncStatus() {
  const [status, setStatus] = useState<SyncStatusState>({
    online: typeof navigator !== 'undefined' ? navigator.onLine : true,
    pending: 0,
    failed: 0,
    lastSync: null,
    isLoading: true,
    cloudConfigured: true,
    syncActive: false,
    mode: null,
    reason: null,
  });
  const authBlockedRef = useRef(false);

  const fetchStatus = useCallback(async () => {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      setStatus((prev) => ({
        ...prev,
        online: false,
        mode: prev.cloudConfigured ? 'offline' : 'offline_only',
        reason: prev.cloudConfigured ? 'no_internet' : 'supabase_not_configured',
        isLoading: false,
      }));
      return;
    }

    if (!canPollSyncStatus()) {
      setStatus((prev) => ({ ...prev, isLoading: false }));
      return;
    }

    // Evita spam de 401/403 nos logs enquanto a sessão não permite sync.
    if (authBlockedRef.current) {
      setStatus((prev) => ({ ...prev, isLoading: false }));
      return;
    }

    try {
      const response = await fetch(`${getPosApiBase()}/sync/status`, {
        method: 'GET',
        cache: 'no-store',
        headers: { ...getPosUserAuthHeaders() },
      });

      if (!response.ok) {
        // 401/403/500 de auth ≠ cloud offline — manter estado anterior e só marcar loading.
        if (response.status === 401 || response.status === 403 || response.status === 500) {
          if (response.status === 401 || response.status === 403) {
            authBlockedRef.current = true;
          }
          setStatus((prev) => ({ ...prev, isLoading: false }));
          return;
        }
        setStatus((prev) => ({ ...prev, online: false, isLoading: false }));
        return;
      }

      authBlockedRef.current = false;
      const payload = await response.json();
      const data = unwrapApiSuccessPayload<SyncStatusApiResponse>(payload) ?? (payload as SyncStatusApiResponse);
      const pending = Number(data.pending ?? data.total_pending ?? 0);
      const failed = Number(data.failed ?? data.total_failed ?? 0);
      const lastSync = resolveLastSync(data);
      const cloudConfigured = typeof data.cloud_configured === 'boolean' ? data.cloud_configured : true;
      const syncActive = Boolean(data.sync_active);
      const online = typeof data.online === 'boolean' ? data.online : cloudConfigured;
      const mode = data.mode != null ? String(data.mode) : null;
      const reason = data.reason != null ? String(data.reason) : null;

      setStatus({
        online,
        pending,
        failed,
        lastSync,
        isLoading: false,
        cloudConfigured,
        syncActive,
        mode,
        reason,
      });
    } catch {
      setStatus((prev) => ({ ...prev, online: false, isLoading: false }));
    }
  }, []);

  useEffect(() => {
    const resumePolling = () => {
      authBlockedRef.current = false;
      void fetchStatus();
    };

    void fetchStatus();
    const intervalId = window.setInterval(() => {
      void fetchStatus();
    }, 3000);

    window.addEventListener('pos-auth-changed', resumePolling);
    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener('pos-auth-changed', resumePolling);
    };
  }, [fetchStatus]);

  useEffect(() => {
    const handleOnline = () => {
      authBlockedRef.current = false;
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

  return { ...status, refresh: fetchStatus };
}
