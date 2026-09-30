'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  commerceTypeLabel,
  getCommerceFeaturesFromCapabilities,
  normalizeCommerceType,
  type CommerceFeatures,
  type CommerceType,
} from '@/lib/commerceProfile';
import { getPosApiBase, getPosUserAuthHeaders, getStoredAuthToken } from '@/lib/apiBase';
import { bindLoaderToAuthEvents, createCommerceProfileLoader } from '@/lib/commerceProfileLoader.js';
import { getCachedCommerce, setCachedCommerce } from '@/lib/posSessionCache';
import {
  getVerticalPreset,
  hasCapability as capabilityEnabled,
  normalizeCapabilities,
  normalizeVertical,
  type CapabilityId,
  type VerticalId,
} from '@/lib/capabilities';
import { getVerticalUILabels, type VerticalUILabels } from '@/lib/verticalUI';

export type CommerceProfileStatus = 'loading' | 'loaded' | 'error';

export type TenantLicenseInfo = {
  name: string;
  nuit: string;
  licenseType: string;
  commerceType: CommerceType;
  vertical: VerticalId;
  capabilities: CapabilityId[];
  licenseExpiresAt: string | null;
};

export type CommerceProfileState = {
  commerceType: CommerceType;
  vertical: VerticalId;
  capabilities: CapabilityId[];
  features: CommerceFeatures;
  label: string;
  labels: VerticalUILabels;
  hasCapability: (id: CapabilityId) => boolean;
  license: TenantLicenseInfo;
  /** true enquanto ainda não houve nenhum perfil válido nem erro. */
  loading: boolean;
  /** loading | loaded | error — `error` só sem perfil válido (um erro posterior mantém `loaded`). */
  status: CommerceProfileStatus;
  /** Motivo da última falha (http_401, network, …) ou null. */
  error: string | null;
  refresh: () => Promise<void>;
};

const DEFAULT_LICENSE: TenantLicenseInfo = {
  name: '—',
  nuit: '—',
  licenseType: '—',
  commerceType: 'retalho',
  vertical: 'retalho',
  capabilities: getVerticalPreset('retalho'),
  licenseExpiresAt: null,
};

function normalizeLicenseType(value: unknown): string {
  const raw = String(value ?? '').trim().toUpperCase();
  if (!raw) return '—';
  if (raw === 'PRO') return 'Pro';
  if (raw === 'LITE') return 'Lite';
  if (raw === 'BASIC') return 'Basic';
  return raw;
}

async function requestTenantInfo() {
  const base = getPosApiBase().replace(/\/$/, '');
  const res = await fetch(`${base}/tenant/info?_=${Date.now()}`, {
    cache: 'no-store',
    headers: { ...getPosUserAuthHeaders() },
  });
  const json = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, json };
}

/** Só é chamada com um payload de /tenant/info já validado (resposta ok + sucesso + dados). */
function profileFromTenantInfo(data: Record<string, unknown>): TenantLicenseInfo {
  const type = normalizeCommerceType(data.commerce_type);
  const vertical = normalizeVertical(data.vertical, type);
  const capabilities = normalizeCapabilities(data.capabilities ?? data.capabilities_json, vertical, type);
  return {
    name: String(data.name ?? '').trim() || '—',
    nuit: String(data.nuit ?? '').trim() || '—',
    licenseType: normalizeLicenseType(data.license_type),
    commerceType: type,
    vertical,
    capabilities,
    licenseExpiresAt:
      data.license_expires_at != null && String(data.license_expires_at).trim()
        ? String(data.license_expires_at)
        : null,
  };
}

export function useCommerceProfile(): CommerceProfileState {
  const [commerceType, setCommerceType] = useState<CommerceType>(() => getCachedCommerce()?.commerceType ?? 'retalho');
  const [license, setLicense] = useState<TenantLicenseInfo>(
    () => getCachedCommerce()?.license ?? DEFAULT_LICENSE
  );
  const [status, setStatus] = useState<CommerceProfileStatus>(() => (getCachedCommerce() ? 'loaded' : 'loading'));
  const [error, setError] = useState<string | null>(null);
  const loaderRef = useRef<ReturnType<typeof createCommerceProfileLoader> | null>(null);

  useEffect(() => {
    // O PosScreen monta antes da sessão: um 401/erro aqui NÃO é um perfil "retalho". O loader só
    // entrega perfis válidos (e só esses vão ao estado e à cache) e volta a pedir em pos-auth-changed.
    const loader = createCommerceProfileLoader({
      fetchTenantInfo: requestTenantInfo,
      onProfile: (data: Record<string, unknown>) => {
        const next = profileFromTenantInfo(data);
        setCommerceType(next.commerceType);
        setLicense(next);
        setCachedCommerce({ commerceType: next.commerceType, license: next });
      },
      onStatus: (nextStatus: CommerceProfileStatus, reason: string | null) => {
        setStatus(nextStatus);
        setError(reason);
      },
      hasSession: () => Boolean(getStoredAuthToken()),
      hasProfile: Boolean(getCachedCommerce()),
    });
    loaderRef.current = loader;
    const unbind = bindLoaderToAuthEvents(loader, window);
    void loader.refresh({ silent: Boolean(getCachedCommerce()) });
    return () => {
      unbind();
      loader.dispose();
      if (loaderRef.current === loader) loaderRef.current = null;
    };
  }, []);

  // Identidade estável (SettingsModal usa-a como dependência de efeitos).
  const refresh = useCallback(async () => {
    await loaderRef.current?.refresh();
  }, []);

  const features = getCommerceFeaturesFromCapabilities(license.capabilities);
  const labels = getVerticalUILabels(license.vertical);
  const hasCapability = useCallback(
    (id: CapabilityId) => capabilityEnabled(license.capabilities, id),
    [license.capabilities],
  );

  return {
    commerceType,
    vertical: license.vertical,
    capabilities: license.capabilities,
    features,
    label: commerceTypeLabel(commerceType),
    labels,
    hasCapability,
    license,
    loading: status === 'loading',
    status,
    error,
    refresh,
  };
}
