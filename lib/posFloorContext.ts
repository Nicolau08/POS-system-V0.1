/** Último local do POS — sobrevive a logout e a fechar a app. */

export type PosFloorContext = {
  locationId: string | null;
  tableId: string | null;
  /** Se true, no próximo login abre a grelha de mesas desse local. */
  resumeFloor: boolean;
};

const STORAGE_KEY = 'posly:last-floor-context';

const EMPTY: PosFloorContext = { locationId: null, tableId: null, resumeFloor: false };

export function readPosFloorContext(): PosFloorContext {
  if (typeof window === 'undefined') return { ...EMPTY };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...EMPTY };
    const parsed = JSON.parse(raw) as Partial<PosFloorContext>;
    return {
      locationId:
        typeof parsed.locationId === 'string' && parsed.locationId.trim()
          ? parsed.locationId.trim()
          : null,
      tableId:
        typeof parsed.tableId === 'string' && parsed.tableId.trim()
          ? parsed.tableId.trim()
          : null,
      resumeFloor: Boolean(parsed.resumeFloor),
    };
  } catch {
    return { ...EMPTY };
  }
}

export function writePosFloorContext(partial: Partial<PosFloorContext>): void {
  if (typeof window === 'undefined') return;
  try {
    const prev = readPosFloorContext();
    const next: PosFloorContext = {
      locationId: partial.locationId !== undefined ? partial.locationId : prev.locationId,
      tableId: partial.tableId !== undefined ? partial.tableId : prev.tableId,
      resumeFloor: partial.resumeFloor !== undefined ? partial.resumeFloor : prev.resumeFloor,
    };
    if (!next.locationId && !next.tableId && !next.resumeFloor) {
      window.localStorage.removeItem(STORAGE_KEY);
      return;
    }
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // quota / private mode
  }
}
