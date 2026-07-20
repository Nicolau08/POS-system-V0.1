/**
 * Bloqueio de mesa entre postos (restauração).
 */
import { getPosApiDirectBase, getPosUserAuthHeaders } from '@/lib/apiBase';
import { extractApiErrorMessage } from '@/lib/apiResponse';
import { loadStationClientSettings } from '@/lib/stationClientSettings';

function base() {
  return getPosApiDirectBase().replace(/\/$/, '');
}

export async function claimTableLock(tableKey: string): Promise<{ ok: boolean; error?: string }> {
  const key = String(tableKey ?? '').trim();
  if (!key) return { ok: false, error: 'Mesa inválida' };
  const station = loadStationClientSettings();
  try {
    const res = await fetch(`${base()}/table-locks/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getPosUserAuthHeaders() },
      body: JSON.stringify({
        tableKey: key,
        stationCode: station.stationCode,
        role: station.stationRole,
      }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ok: false, error: extractApiErrorMessage(json, `HTTP ${res.status}`) };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function releaseTableLock(tableKey: string): Promise<void> {
  const key = String(tableKey ?? '').trim();
  if (!key) return;
  const station = loadStationClientSettings();
  try {
    await fetch(`${base()}/table-locks/release`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getPosUserAuthHeaders() },
      body: JSON.stringify({
        tableKey: key,
        stationCode: station.stationCode,
        role: station.stationRole,
      }),
    });
  } catch {
    // ignore
  }
}
