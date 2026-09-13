/**
 * URL base da API Express (SQLite).
 * - Servidor local (browser/dev): proxy Next `/pos-backend`
 * - Electron instalado (porta 3730): API directa 3731 — o rewrite /pos-backend
 *   pode não reencaminhar bem o Authorization Bearer e a UI fica “logada”
 *   sem conseguir autenticar nas rotas protegidas (401).
 * - Posto cliente: URL directa do servidor LAN (`stationClientSettings`)
 */
import {
  isStationClientMode,
  loadStationClientSettings,
} from '@/lib/stationClientSettings';
import { clearPosSessionCache } from '@/lib/posSessionCache';

function resolvePackagedDirectApiBase(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const port = String(window.location.port || '');
    // Portas do instalador (electron-dist): web 3730 → API 3731
    if (port === '3730') {
      const baked = String(process.env.NEXT_PUBLIC_POS_API_DIRECT_URL || '').trim();
      if (baked) return baked.replace(/\/$/, '');
      return 'http://127.0.0.1:3731';
    }
  } catch {
    // ignore
  }
  return null;
}

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
    const packagedDirect = resolvePackagedDirectApiBase();
    if (packagedDirect) return packagedDirect;
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
    const packagedDirect = resolvePackagedDirectApiBase();
    if (packagedDirect) return packagedDirect;
  }
  return (
    process.env.NEXT_PUBLIC_POS_API_DIRECT_URL ||
    process.env.NEXT_PUBLIC_POS_API_URL ||
    'http://127.0.0.1:3001'
  );
}

const AUTH_TOKEN_KEY = 'pos:auth-token';
/** Marca sessão activa nesta janela; some ao fechar o app (sessionStorage). */
const SESSION_ACTIVE_KEY = 'pos:session-active';

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

/** true só enquanto a janela actual mantém login (não sobrevive a fechar o app). */
export function isPosSessionActive(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return sessionStorage.getItem(SESSION_ACTIVE_KEY) === '1';
  } catch {
    return false;
  }
}

export function markPosSessionActive(): void {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.setItem(SESSION_ACTIVE_KEY, '1');
  } catch {
    // ignore
  }
}

export function clearPosSessionActive(): void {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.removeItem(SESSION_ACTIVE_KEY);
  } catch {
    // ignore
  }
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
  clearPosSessionActive();
  clearPosSessionCache();
  window.dispatchEvent(new Event('pos-auth-changed'));
}
