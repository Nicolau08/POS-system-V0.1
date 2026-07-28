'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  commerceTypeLabel,
  getCommerceFeaturesFromCapabilities,
  normalizeCommerceType,
  type CommerceFeatures,
  type CommerceType,
} from '@/lib/commerceProfile';
import { getPosApiBase, getPosUserAuthHeaders } from '@/lib/apiBase';
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
  loading: boolean;
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

export function useCommerceProfile(): CommerceProfileState {
  const [commerceType, setCommerceType] = useState<CommerceType>(() => getCachedCommerce()?.commerceType ?? 'retalho');
  const [license, setLicense] = useState<TenantLicenseInfo>(
    () => getCachedCommerce()?.license ?? DEFAULT_LICENSE
  );
  const [loading, setLoading] = useState(() => !getCachedCommerce());

  const refresh = useCallback(async (options?: { silent?: boolean }) => {
    const silent = Boolean(options?.silent) || Boolean(getCachedCommerce());
    if (!silent) setLoading(true);
    try {
      const base = getPosApiBase().replace(/\/$/, '');
      const res = await fetch(`${base}/tenant/info?_=${Date.now()}`, {
        cache: 'no-store',
        headers: { ...getPosUserAuthHeaders() },
      });
      const json = await res.json().catch(() => null);
      const data = json?.success ? json.data : json;
      const type = normalizeCommerceType(data?.commerce_type);
      const vertical = normalizeVertical(data?.vertical, type);
      const capabilities = normalizeCapabilities(data?.capabilities ?? data?.capabilities_json, vertical, type);
      const next: TenantLicenseInfo = {
        name: String(data?.name ?? '').trim() || '—',
        nuit: String(data?.nuit ?? '').trim() || '—',
        licenseType: normalizeLicenseType(data?.license_type),
        commerceType: type,
        vertical,
        capabilities,
        licenseExpiresAt:
          data?.license_expires_at != null && String(data.license_expires_at).trim()
            ? String(data.license_expires_at)
            : null,
      };
      setCommerceType(type);
      setLicense(next);
      setCachedCommerce({ commerceType: type, license: next });
    } catch {
      if (!getCachedCommerce()) {
        setCommerceType('retalho');
        setLicense(DEFAULT_LICENSE);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh({ silent: Boolean(getCachedCommerce()) });
  }, [refresh]);

  const features = getCommerceFeaturesFromCapabilities(license.capabilities);
  const labels = getVerticalUILabels(license.vertical);
  const hasCapability = useCallback(
    (id: CapabilityId) => capabilityEnabled(license.capabilities, id),
    [license.capabilities],
  );
  const refreshPublic = useCallback(() => refresh({ silent: false }), [refresh]);

  return {
    commerceType,
    vertical: license.vertical,
    capabilities: license.capabilities,
    features,
    label: commerceTypeLabel(commerceType),
    labels,
    hasCapability,
    license,
    loading,
    refresh: refreshPublic,
  };
}
