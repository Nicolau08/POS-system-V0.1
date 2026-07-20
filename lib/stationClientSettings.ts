/**
 * Definições de posto / multi-estação (cliente local).
 * Persistidas em localStorage; espelhadas em Electron userData para o arranque.
 */

export type StationMode = 'server' | 'client' | 'unset';
export type StationRole = 'caixa' | 'garcom' | 'consulta';

export type StationClientSettings = {
  /** undefined/unset = ainda não escolheu no 1.º arranque */
  stationMode: StationMode;
  /** URL da API do servidor (modo cliente), ex. http://192.168.1.20:3731 */
  serverApiBaseUrl: string;
  /** Código do posto nesta máquina */
  stationCode: string;
  stationName: string;
  stationRole: StationRole;
  /** Preferência UI: pedir descoberta no arranque (cliente) */
  preferLanDiscovery: boolean;
};

export const STATION_SETTINGS_STORAGE_KEY = 'pos:station-settings';

export const DEFAULT_STATION_CLIENT_SETTINGS: StationClientSettings = {
  stationMode: 'unset',
  serverApiBaseUrl: '',
  stationCode: 'caixa-1',
  stationName: 'Caixa 1',
  stationRole: 'caixa',
  preferLanDiscovery: true,
};

function cloneDefaults(): StationClientSettings {
  return { ...DEFAULT_STATION_CLIENT_SETTINGS };
}

export function normalizeStationMode(value: unknown): StationMode {
  const raw = String(value ?? '')
    .trim()
    .toLowerCase();
  if (raw === 'server' || raw === 'servidor') return 'server';
  if (raw === 'client' || raw === 'cliente' || raw === 'posto') return 'client';
  return 'unset';
}

export function normalizeStationRole(value: unknown): StationRole {
  const raw = String(value ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  if (raw === 'garcom' || raw === 'waiter') return 'garcom';
  if (raw === 'consulta' || raw === 'viewer') return 'consulta';
  return 'caixa';
}

export function normalizeServerApiBaseUrl(value: unknown): string {
  let raw = String(value ?? '').trim();
  if (!raw) return '';
  if (!/^https?:\/\//i.test(raw)) raw = `http://${raw}`;
  try {
    const u = new URL(raw);
    // remove trailing slash
    return `${u.protocol}//${u.host}`;
  } catch {
    return raw.replace(/\/+$/, '');
  }
}

export function loadStationClientSettings(): StationClientSettings {
  if (typeof window === 'undefined') return cloneDefaults();
  try {
    const stored = localStorage.getItem(STATION_SETTINGS_STORAGE_KEY);
    if (!stored) return cloneDefaults();
    const parsed = JSON.parse(stored) as Partial<StationClientSettings>;
    return {
      ...cloneDefaults(),
      ...parsed,
      stationMode: normalizeStationMode(parsed.stationMode ?? 'unset'),
      serverApiBaseUrl: normalizeServerApiBaseUrl(parsed.serverApiBaseUrl),
      stationCode: String(parsed.stationCode ?? 'caixa-1').trim() || 'caixa-1',
      stationName: String(parsed.stationName ?? 'Caixa 1').trim() || 'Caixa 1',
      stationRole: normalizeStationRole(parsed.stationRole),
      preferLanDiscovery: parsed.preferLanDiscovery !== false,
    };
  } catch {
    return cloneDefaults();
  }
}

export function saveStationClientSettings(settings: StationClientSettings) {
  if (typeof window === 'undefined') return;
  const next: StationClientSettings = {
    stationMode: normalizeStationMode(settings.stationMode),
    serverApiBaseUrl: normalizeServerApiBaseUrl(settings.serverApiBaseUrl),
    stationCode: String(settings.stationCode ?? '').trim() || 'caixa-1',
    stationName: String(settings.stationName ?? '').trim() || 'Caixa 1',
    stationRole: normalizeStationRole(settings.stationRole),
    preferLanDiscovery: settings.preferLanDiscovery !== false,
  };
  localStorage.setItem(STATION_SETTINGS_STORAGE_KEY, JSON.stringify(next));
  window.dispatchEvent(new CustomEvent('pos-station-settings-changed', { detail: next }));
  // Espelhar no Electron para o próximo arranque (spawn API ou não)
  void window.electronAPI?.saveStationRuntimeConfig?.({
    mode: next.stationMode === 'unset' ? 'server' : next.stationMode,
    serverApiBaseUrl: next.serverApiBaseUrl,
    stationCode: next.stationCode,
  });
}

export function isStationClientMode(settings?: StationClientSettings | null): boolean {
  const s = settings ?? (typeof window !== 'undefined' ? loadStationClientSettings() : null);
  return s?.stationMode === 'client' && Boolean(normalizeServerApiBaseUrl(s.serverApiBaseUrl));
}

export function stationRoleLabel(role: StationRole): string {
  if (role === 'garcom') return 'Garçom';
  if (role === 'consulta') return 'Consulta';
  return 'Caixa';
}
