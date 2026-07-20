export const API_BASE =
  (process.env.POS_API_URL || process.env.POS_API_DIRECT_URL || 'http://127.0.0.1:3001').replace(
    /\/$/,
    '',
  );

export const WEB_BASE = (process.env.POS_BASE_URL || 'http://localhost:3002').replace(/\/$/, '');

export function isCi(): boolean {
  return (
    process.env.CI === 'true' ||
    process.env.CI === '1' ||
    Boolean(process.env.GITHUB_ACTIONS)
  );
}

export async function probeUrl(url: string, timeoutMs = 4000): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    await fetch(url, { signal: controller.signal, cache: 'no-store' });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export async function isApiAvailable(): Promise<boolean> {
  return probeUrl(`${API_BASE}/setup/status`);
}

export async function isWebAvailable(): Promise<boolean> {
  return probeUrl(WEB_BASE);
}

export function hasSupabaseEnv(): boolean {
  const url = String(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
  const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  return Boolean(url && key);
}
