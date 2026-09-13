'use client';

import React from 'react';
import { getPosApiBase, getPosUserAuthHeaders } from '@/lib/apiBase';
import { unwrapApiSuccessPayload } from '@/lib/apiResponse';

type TenantFooterInfo = {
  name: string;
  nuit: string;
  license_type: string;
  license_expires_at: string | null;
};

const CACHE_KEY = 'pos:tenant-footer-cache';

function getDaysLeft(expiresAt?: string | null) {
  if (!expiresAt) return null;
  const diff = new Date(expiresAt).getTime() - Date.now();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

function readCachedTenant(): TenantFooterInfo | null {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as TenantFooterInfo;
    if (!parsed || typeof parsed !== 'object') return null;
    return {
      name: String(parsed.name ?? '').trim() || 'Loja',
      nuit: String(parsed.nuit ?? '').trim() || '--',
      license_type: String(parsed.license_type ?? '').trim() || 'BASIC',
      license_expires_at:
        parsed.license_expires_at != null && String(parsed.license_expires_at).trim()
          ? String(parsed.license_expires_at)
          : null,
    };
  } catch {
    return null;
  }
}

function writeCachedTenant(info: TenantFooterInfo) {
  try {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify(info));
  } catch {
    /* ignore */
  }
}

function readStationLabel(): string | null {
  try {
    const rawStation = localStorage.getItem('pos:station-settings');
    if (!rawStation) return null;
    const st = JSON.parse(rawStation) as { stationCode?: string; stationName?: string };
    return st.stationName || st.stationCode || null;
  } catch {
    return null;
  }
}

/** Rodapé partilhado (produtos / mesas): loja, licença, posto. */
export function PosStatusFooter() {
  const [tenantInfo, setTenantInfo] = React.useState<TenantFooterInfo | null>(() => readCachedTenant());
  const [stationLabel, setStationLabel] = React.useState<string | null>(() => readStationLabel());

  React.useEffect(() => {
    const readStation = () => setStationLabel(readStationLabel());
    readStation();
    window.addEventListener('pos-station-settings-changed', readStation);
    return () => window.removeEventListener('pos-station-settings-changed', readStation);
  }, []);

  React.useEffect(() => {
    let cancelled = false;

    const applyTenant = (data: Record<string, unknown>) => {
      const next: TenantFooterInfo = {
        name: String(data.name ?? '').trim() || 'Loja',
        nuit: String(data.nuit ?? '').trim() || '--',
        license_type: String(data.license_type ?? '').trim() || 'BASIC',
        license_expires_at:
          data.license_expires_at != null && String(data.license_expires_at).trim()
            ? String(data.license_expires_at)
            : null,
      };
      writeCachedTenant(next);
      if (!cancelled) setTenantInfo(next);
    };

    const loadTenantInfo = async () => {
      try {
        const apiBase = getPosApiBase().replace(/\/$/, '');
        const authHeaders = getPosUserAuthHeaders();
        // Mostra dados já guardados; /tenant/info é rápido — sync-registry em background.
        const response = await fetch(`${apiBase}/tenant/info`, { headers: { ...authHeaders } });
        if (response.ok) {
          const raw = await response.json();
          const data = unwrapApiSuccessPayload<Record<string, unknown>>(raw);
          if (!cancelled && data && typeof data === 'object') applyTenant(data);
        } else {
          // Fallback sem auth de utilizador (instalado: proxy local)
          const statusRes = await fetch(`${apiBase}/setup/status?skipRegistrySync=1`);
          if (statusRes.ok) {
            const statusRaw = await statusRes.json();
            const status = unwrapApiSuccessPayload<Record<string, unknown>>(statusRaw);
            if (!cancelled && status && typeof status === 'object') {
              applyTenant({
                name: status.tenantName ?? status.storeName ?? 'Loja',
                nuit: '--',
                license_type: 'BASIC',
                license_expires_at: status.licenseExpiresAt ?? status.license_expires_at ?? null,
              });
            }
          }
        }
        // Actualização da consola sem bloquear o rodapé
        void fetch(`${apiBase}/setup/license/sync-registry`, {
          method: 'POST',
          headers: { ...authHeaders },
        })
          .then(async () => {
            if (cancelled) return;
            const refreshed = await fetch(`${apiBase}/tenant/info`, {
              headers: { ...getPosUserAuthHeaders() },
            });
            if (!refreshed.ok) return;
            const raw = await refreshed.json();
            const data = unwrapApiSuccessPayload<Record<string, unknown>>(raw);
            if (!cancelled && data && typeof data === 'object') applyTenant(data);
          })
          .catch(() => undefined);
      } catch {
        /* ignore */
      }
    };

    void loadTenantInfo();
    const onRefresh = () => {
      void loadTenantInfo();
    };
    window.addEventListener('pos-license-refreshed', onRefresh);
    window.addEventListener('focus', onRefresh);
    return () => {
      cancelled = true;
      window.removeEventListener('pos-license-refreshed', onRefresh);
      window.removeEventListener('focus', onRefresh);
    };
  }, []);

  const licenseVisual = React.useMemo(() => {
    if (!tenantInfo?.license_expires_at) {
      return {
        text: '--/--/----',
        className: 'text-zinc-400',
        daysLeft: null as number | null,
        daysClassName: 'text-zinc-400',
      };
    }
    const date = new Date(tenantInfo.license_expires_at);
    if (Number.isNaN(date.getTime())) {
      return { text: '--/--/----', className: 'text-zinc-400', daysLeft: null, daysClassName: 'text-zinc-400' };
    }
    const formatted = `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}/${date.getFullYear()}`;
    const daysLeft = getDaysLeft(tenantInfo.license_expires_at);
    if (daysLeft == null) {
      return { text: formatted, className: 'text-zinc-400', daysLeft: null, daysClassName: 'text-zinc-400' };
    }
    if (daysLeft <= 0) {
      return { text: formatted, className: 'text-red-400', daysLeft, daysClassName: 'text-red-400' };
    }
    if (daysLeft <= 3) {
      return { text: formatted, className: 'text-amber-400', daysLeft, daysClassName: 'text-amber-400' };
    }
    return { text: formatted, className: 'text-emerald-400', daysLeft, daysClassName: 'text-emerald-400' };
  }, [tenantInfo]);

  const licenseLabel =
    String(tenantInfo?.license_type ?? 'BASIC').toUpperCase() === 'PRO' ? 'Pro' : 'Lite';

  return (
    <footer className="pos-chrome flex shrink-0 items-center justify-between gap-3 border-t border-pos-border bg-pos-surface p-2 text-xs">
      <div className="min-w-0 truncate text-pos-muted">
        Loja: <span className="text-pos-fg-soft">{tenantInfo?.name ?? 'Loja'}</span>
        {'    |    '}Licença: <span className="text-pos-fg-soft">{licenseLabel}</span>
        {'    |    '}Validade licenca: <span className={licenseVisual.className}>{licenseVisual.text}</span>
        {'    |    '}Dias restantes:{' '}
        <span className={licenseVisual.daysClassName}>{licenseVisual.daysLeft ?? '--'}</span>
      </div>
      {stationLabel ? (
        <span className="shrink-0 rounded border border-pos-border bg-pos-action px-2 py-1 text-[11px] font-medium text-white">
          Posto: {stationLabel}
        </span>
      ) : null}
    </footer>
  );
}
