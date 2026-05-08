'use client';

import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';

type LicenseGuardState = {
  licenseExpired: boolean;
  tenantName: string | null;
  expiresAt: string | null;
  clearLicenseExpired: () => void;
  setLicenseExpired: (next: {
    tenantName?: string | null;
    expiresAt?: string | null;
  }) => void;
};

const LicenseGuardContext = createContext<LicenseGuardState | null>(null);

function resolveTenantNameFromSession() {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem('currentUser');
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return String(parsed.tenant_name ?? parsed.tenant_id ?? parsed.name ?? '').trim() || null;
  } catch {
    return null;
  }
}

function parseLicensePayload(payload: unknown) {
  const data = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};
  return {
    isExpiredError: String(data.error ?? '') === 'Licença expirada',
    tenantName:
      String(data.tenant_name ?? data.tenantName ?? '').trim() || resolveTenantNameFromSession(),
    expiresAt: String(data.expires_at ?? data.expiresAt ?? data.effectiveExpiresAt ?? '').trim() || null,
  };
}

export function LicenseGuardProvider({ children }: { children: React.ReactNode }) {
  const [licenseExpired, setLicenseExpiredState] = useState(false);
  const [tenantName, setTenantName] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);

  useEffect(() => {
    const originalFetch = window.fetch.bind(window);

    window.fetch = async (...args: Parameters<typeof fetch>) => {
      const response = await originalFetch(...args);
      if (response.status !== 403) return response;

      try {
        const clone = response.clone();
        const text = await clone.text();
        const payload = text ? JSON.parse(text) : {};
        const parsed = parseLicensePayload(payload);
        if (parsed.isExpiredError) {
          setLicenseExpiredState(true);
          setTenantName(parsed.tenantName);
          setExpiresAt(parsed.expiresAt);
        }
      } catch {
        // Ignore malformed error payloads and keep original response behavior.
      }

      return response;
    };

    return () => {
      window.fetch = originalFetch;
    };
  }, []);

  const value = useMemo<LicenseGuardState>(
    () => ({
      licenseExpired,
      tenantName,
      expiresAt,
      clearLicenseExpired: () => {
        setLicenseExpiredState(false);
        setTenantName(null);
        setExpiresAt(null);
      },
      setLicenseExpired: (next) => {
        setLicenseExpiredState(true);
        setTenantName(next.tenantName ?? resolveTenantNameFromSession());
        setExpiresAt(next.expiresAt ?? null);
      },
    }),
    [expiresAt, licenseExpired, tenantName]
  );

  return <LicenseGuardContext.Provider value={value}>{children}</LicenseGuardContext.Provider>;
}

export function useLicenseGuard() {
  const context = useContext(LicenseGuardContext);
  if (!context) {
    throw new Error('useLicenseGuard must be used within LicenseGuardProvider');
  }
  return context;
}
