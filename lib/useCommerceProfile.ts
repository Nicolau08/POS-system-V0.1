'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  commerceTypeLabel,
  getCommerceFeatures,
  normalizeCommerceType,
  type CommerceFeatures,
  type CommerceType,
} from '@/lib/commerceProfile';
import { getPosApiBase, getPosUserAuthHeaders } from '@/lib/apiBase';

export type TenantLicenseInfo = {
  name: string;
  nuit: string;
  licenseType: string;
  commerceType: CommerceType;
  licenseExpiresAt: string | null;
};

export type CommerceProfileState = {
  commerceType: CommerceType;
  features: CommerceFeatures;
  label: string;
  license: TenantLicenseInfo;
  loading: boolean;
  refresh: () => Promise<void>;
};

const DEFAULT_LICENSE: TenantLicenseInfo = {
  name: '—',
  nuit: '—',
  licenseType: '—',
  commerceType: 'retalho',
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

export function useCommerceProfile(): CommerceProfileState {
  const [commerceType, setCommerceType] = useState<CommerceType>('retalho');
  const [license, setLicense] = useState<TenantLicenseInfo>(DEFAULT_LICENSE);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const base = getPosApiBase().replace(/\/$/, '');
      const res = await fetch(`${base}/tenant/info?_=${Date.now()}`, {
        cache: 'no-store',
        headers: { ...getPosUserAuthHeaders() },
      });
      const json = await res.json().catch(() => null);
      const data = json?.success ? json.data : json;
      const type = normalizeCommerceType(data?.commerce_type);
      const next: TenantLicenseInfo = {
        name: String(data?.name ?? '').trim() || '—',
        nuit: String(data?.nuit ?? '').trim() || '—',
        licenseType: normalizeLicenseType(data?.license_type),
        commerceType: type,
        licenseExpiresAt:
          data?.license_expires_at != null && String(data.license_expires_at).trim()
            ? String(data.license_expires_at)
            : null,
      };
      setCommerceType(type);
      setLicense(next);
    } catch {
      setCommerceType('retalho');
      setLicense(DEFAULT_LICENSE);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const features = getCommerceFeatures(commerceType);
  return {
    commerceType,
    features,
    label: commerceTypeLabel(commerceType),
    license,
    loading,
    refresh,
  };
}
