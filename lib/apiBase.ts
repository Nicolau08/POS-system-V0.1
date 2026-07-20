/**
 * URL base da API Express (SQLite).
 * - Servidor local: proxy Next `/pos-backend`
 * - Posto cliente: URL directa do servidor LAN (`stationClientSettings`)
 */
import {
  isStationClientMode,
  loadStationClientSettings,
} from '@/lib/stationClientSettings';

export function getPosApiBase(): string {
  if (typeof window !== 'undefined') {
    try {
      const station = loadStationClientSettings();
      if (isStationClientMode(station)) {
        return station.serverApiBaseUrl.replace(/\/$/, '');
      }
    } catch {
      // fall through
    }
    return `${window.location.origin}/pos-backend`;
  }
  return process.env.NEXT_PUBLIC_POS_API_URL || process.env.POS_API_URL || 'http://127.0.0.1:3001';
}

/**
 * URL direta da API (sem proxy Next). PUT /company-profile com logo em base64 pode receber
 * HTTP 413 no proxy do dev server; gravações grandes devem usar esta base.
 * Em modo posto cliente, coincide com getPosApiBase().
 */
export function getPosApiDirectBase(): string {
  if (typeof window !== 'undefined') {
    try {
      const station = loadStationClientSettings();
      if (isStationClientMode(station)) {
        return station.serverApiBaseUrl.replace(/\/$/, '');
      }
    } catch {
      // fall through
    }
  }
  return (
    process.env.NEXT_PUBLIC_POS_API_DIRECT_URL ||
    process.env.NEXT_PUBLIC_POS_API_URL ||
    'http://127.0.0.1:3001'
  );
}

const AUTH_TOKEN_KEY = 'pos:auth-token';

export function getStoredAuthToken(): string {
  if (typeof window === 'undefined') return '';
  try {
    return String(localStorage.getItem(AUTH_TOKEN_KEY) ?? '').trim();
  } catch {
    return '';
  }
}

export function setStoredAuthToken(token: string | null | undefined) {
  if (typeof window === 'undefined') return;
  const t = String(token ?? '').trim();
  if (!t) localStorage.removeItem(AUTH_TOKEN_KEY);
  else localStorage.setItem(AUTH_TOKEN_KEY, t);
}

/**
 * Cabeçalhos para a API Express resolver o utilizador (middleware `authenticateUser`).
 * Preferir Bearer se existir; senão `x-user-id`. Inclui `X-Station-Code` do posto local.
 */
export function getPosUserAuthHeaders(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  const headers: Record<string, string> = {};
  try {
    const station = loadStationClientSettings();
    const code = String(station.stationCode ?? '').trim();
    if (code) headers['X-Station-Code'] = code;
    if (station.stationRole) headers['X-Station-Role'] = station.stationRole;
  } catch {
    // ignore
  }
  try {
    const token = getStoredAuthToken();
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    if (localStorage.getItem('isLoggedIn') !== 'true') return headers;
    const raw = window.localStorage.getItem('currentUser');
    if (!raw) return headers;
    const u = JSON.parse(raw) as { id?: string };
    const id = String(u?.id ?? '').trim();
    if (id && !headers.Authorization) {
      headers['x-user-id'] = id;
    } else if (id) {
      // Bearer presente; x-user-id ainda ajuda em alguns fluxos legados
      headers['x-user-id'] = id;
    }
    return headers;
  } catch {
    return headers;
  }
}

/** Limpa sessão local obsoleta (ex.: utilizador removido ou BD resetada). */
export function clearPosAuthSession(): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem('isLoggedIn', 'false');
  localStorage.removeItem('currentUser');
  setStoredAuthToken(null);
  window.dispatchEvent(new Event('pos-auth-changed'));
}
