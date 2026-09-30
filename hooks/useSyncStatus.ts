'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  getPosApiBase,
  getPosUserAuthHeaders,
  getStoredAuthToken,
  isPosSessionActive,
} from '@/lib/apiBase';
import { unwrapApiSuccessPayload } from '@/lib/apiResponse';

// Diagnóstico seguro (Pilot Gate offline): só type -> count por status, nunca
// payload/negócio (ver api/controllers/sync.controller.js#getSyncStatus).
export type SyncQueueByType = {
  pending: Record<string, number>;
  failed: Record<string, number>;
  dead: Record<string, number>;
};

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
  byType?: Partial<SyncQueueByType>;
  tenantDiagnostic?: Partial<TenantDiagnostic>;
  rlsDiagnostic?: Partial<RlsDiagnostic>;
  pull_sync_state?: Array<{ id?: string; last_sync_at?: string | null }>;
};

const EMPTY_BY_TYPE: SyncQueueByType = { pending: {}, failed: {}, dead: {} };

// Diagnóstico de mismatch de tenant (Pilot Gate — RLS em categories): contagens
// puras current/other, nunca o tenant_id em si nem qualquer payload/negócio.
export type CurrentOtherCount = { current: number; other: number };
export type TenantDiagnostic = {
  categories: CurrentOtherCount;
  products: CurrentOtherCount;
  queueDead: { category: CurrentOtherCount; product: CurrentOtherCount };
};

const EMPTY_TENANT_DIAGNOSTIC: TenantDiagnostic = {
  categories: { current: 0, other: 0 },
  products: { current: 0, other: 0 },
  queueDead: { category: { current: 0, other: 0 }, product: { current: 0, other: 0 } },
};

// Diagnóstico de evidência RLS (Pilot Gate): correlação sync_logs <-> itens
// `dead`, só contagens/timestamps — nunca queue_id/tenant_id/payload/mensagem.
export type RlsCategoryDiagnostic = {
  items: number;
  totalAttempts: number;
  firstAttempt: string | null;
  lastAttempt: string | null;
  sameRlsErrorAttempts: number;
};
export type RlsProductDiagnostic = {
  items: number;
  totalAttempts: number;
  firstAttempt: string | null;
  lastAttempt: string | null;
};
export type RlsDiagnostic = {
  category: RlsCategoryDiagnostic;
  product: RlsProductDiagnostic;
};

const EMPTY_RLS_DIAGNOSTIC: RlsDiagnostic = {
  category: { items: 0, totalAttempts: 0, firstAttempt: null, lastAttempt: null, sameRlsErrorAttempts: 0 },
  product: { items: 0, totalAttempts: 0, firstAttempt: null, lastAttempt: null },
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
  byType: SyncQueueByType;
  tenantDiagnostic: TenantDiagnostic;
  rlsDiagnostic: RlsDiagnostic;
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
    byType: EMPTY_BY_TYPE,
    tenantDiagnostic: EMPTY_TENANT_DIAGNOSTIC,
    rlsDiagnostic: EMPTY_RLS_DIAGNOSTIC,
  });
  const authBlockedRef = useRef(false);

  const fetchStatus = useCallback(async () => {
    // Pilot Gate offline (achado real): GET /sync/status é sempre local
    // (loopback, autenticado) — nunca depende de Internet, só de a API estar
    // a correr. navigator.onLine=false nunca deve saltar esta leitura, senão
    // "pending" fica congelado no valor inicial (0) enquanto a loja estiver
    // offline, escondendo vendas/produtos realmente pendentes de sincronizar.
    // Offline impede SYNC com a cloud, nunca a LEITURA local do estado.
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
      const byType: SyncQueueByType = {
        pending: data.byType?.pending ?? {},
        failed: data.byType?.failed ?? {},
        dead: data.byType?.dead ?? {},
      };
      const tenantDiagnostic: TenantDiagnostic = {
        categories: data.tenantDiagnostic?.categories ?? EMPTY_TENANT_DIAGNOSTIC.categories,
        products: data.tenantDiagnostic?.products ?? EMPTY_TENANT_DIAGNOSTIC.products,
        queueDead: data.tenantDiagnostic?.queueDead ?? EMPTY_TENANT_DIAGNOSTIC.queueDead,
      };
      const rlsDiagnostic: RlsDiagnostic = {
        category: data.rlsDiagnostic?.category ?? EMPTY_RLS_DIAGNOSTIC.category,
        product: data.rlsDiagnostic?.product ?? EMPTY_RLS_DIAGNOSTIC.product,
      };

      setStatus({
        online,
        pending,
        failed,
        lastSync,
        isLoading: false,
        cloudConfigured,
        syncActive,
        byType,
        tenantDiagnostic,
        rlsDiagnostic,
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
      // Nunca adivinhar "pending" aqui — o próprio /sync/status local (não
      // depende de Internet) é quem decide online/pending; só refrescamos
      // mais cedo do que o polling de 3s para a UI reagir logo ao evento.
      void fetchStatus();
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
