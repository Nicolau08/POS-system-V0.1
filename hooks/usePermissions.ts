'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { getPosApiBase, getPosUserAuthHeaders } from '@/lib/apiBase';
import {
  canAccess,
  denyAccessMessage,
  type PermissionKey,
  type PermissionRulesMap,
  clampAccessLevel,
} from '@/lib/permissions';

function unwrapRulesPayload(payload: unknown): PermissionRulesMap {
  const root = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};
  const rows = Array.isArray(payload)
    ? payload
    : Array.isArray(root.data)
      ? root.data
      : Array.isArray(root.rules)
        ? root.rules
        : [];

  const normalized: PermissionRulesMap = {};
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const item = row as Record<string, unknown>;
    const key = String(item.key ?? '').trim();
    if (!key) continue;
    normalized[key] = clampAccessLevel(item.required_level ?? item.requiredLevel ?? 0);
  }
  return normalized;
}

function readAccessLevelFromSession(): number {
  if (typeof window === 'undefined') return 0;
  try {
    const raw = localStorage.getItem('currentUser');
    if (!raw) return 0;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return clampAccessLevel(parsed.accessLevel ?? parsed.access_level ?? 0);
  } catch {
    return 0;
  }
}

/**
 * Carrega permission_rules e expõe can(key) com o accessLevel da sessão.
 */
export function usePermissions(accessLevelOverride?: number | null) {
  const [rules, setRules] = useState<PermissionRulesMap | null>(null);
  const [loading, setLoading] = useState(true);
  const [sessionLevel, setSessionLevel] = useState(0);

  useEffect(() => {
    const syncLevel = () => setSessionLevel(readAccessLevelFromSession());
    syncLevel();
    window.addEventListener('pos-auth-changed', syncLevel);
    window.addEventListener('storage', syncLevel);
    return () => {
      window.removeEventListener('pos-auth-changed', syncLevel);
      window.removeEventListener('storage', syncLevel);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      try {
        const res = await fetch(`${getPosApiBase()}/permission-rules`, {
          headers: { ...getPosUserAuthHeaders() },
          cache: 'no-store',
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        if (!cancelled) setRules(unwrapRulesPayload(json));
      } catch {
        if (!cancelled) setRules({});
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionLevel]);

  const accessLevel = useMemo(() => {
    if (accessLevelOverride != null && Number.isFinite(Number(accessLevelOverride))) {
      return clampAccessLevel(accessLevelOverride);
    }
    return sessionLevel;
  }, [accessLevelOverride, sessionLevel]);

  const can = useCallback(
    (key: PermissionKey, fallbackRequired = 0) => canAccess(accessLevel, rules, key, fallbackRequired),
    [accessLevel, rules]
  );

  const denyMessage = useCallback((actionLabel?: string) => denyAccessMessage(actionLabel), []);

  return {
    rules,
    loading,
    accessLevel,
    can,
    denyMessage,
  };
}
