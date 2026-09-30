/**
 * Etapa 1G.3.1 - direito a Stations derivado EXCLUSIVAMENTE da licença offline Ed25519 já verificada.
 * Regras (nunca inferir a partir de ficheiros/colunas não assinados):
 *  - licença v1 (sem limite assinado) continua válida para o resto da app, mas NÃO autoriza Station Pairing;
 *  - v2: max_stations_per_store === null (presente e assinado) = ilimitado; 0 = nenhuma Station; N = até N activas;
 *  - licença inválida/expirada/máquina errada = sem direito.
 */
export const STATION_ENTITLEMENT_REASON = Object.freeze({
  OK: 'OK',
  LICENSE_INVALID: 'LICENSE_INVALID',
  LICENSE_V1_NO_STATION_ENTITLEMENT: 'LICENSE_V1_NO_STATION_ENTITLEMENT',
  STATION_LIMIT_ZERO: 'STATION_LIMIT_ZERO',
  STATION_LIMIT_REACHED: 'STATION_LIMIT_REACHED',
});

/**
 * @param {{ ok: boolean, kind?: string, licenseVersion?: number, payload?: object } | null | undefined} verification
 *   resultado de verifyOfflineLicense() (já com machine binding / expiração aplicados)
 * @returns {{ allowed: boolean, reason: string, unlimited: boolean, max: number | null, storeId: string | null, licenseVersion: number | null }}
 */
export function stationEntitlementFromVerification(verification) {
  const none = (reason, licenseVersion = null) => ({ allowed: false, reason, unlimited: false, max: 0, storeId: null, licenseVersion });
  if (!verification || verification.ok !== true || !verification.payload) return none(STATION_ENTITLEMENT_REASON.LICENSE_INVALID);
  if (verification.licenseVersion !== 2) return none(STATION_ENTITLEMENT_REASON.LICENSE_V1_NO_STATION_ENTITLEMENT, verification.licenseVersion ?? 1);
  const p = verification.payload;
  const max = p.max_stations_per_store;
  const storeId = String(p.store_id);
  if (max === null) return { allowed: true, reason: STATION_ENTITLEMENT_REASON.OK, unlimited: true, max: null, storeId, licenseVersion: 2 };
  if (!(Number.isInteger(max) && max >= 0)) return none(STATION_ENTITLEMENT_REASON.LICENSE_INVALID, 2);
  if (max === 0) return { allowed: false, reason: STATION_ENTITLEMENT_REASON.STATION_LIMIT_ZERO, unlimited: false, max: 0, storeId, licenseVersion: 2 };
  return { allowed: true, reason: STATION_ENTITLEMENT_REASON.OK, unlimited: false, max, storeId, licenseVersion: 2 };
}

/** Pode emparelhar mais uma Station? `activeStations` = Stations activas actuais (disabled/revoked não contam). */
export function canPairAnotherStation(entitlement, activeStations) {
  if (!entitlement?.allowed) return { allowed: false, reason: entitlement?.reason ?? STATION_ENTITLEMENT_REASON.LICENSE_INVALID };
  if (entitlement.unlimited) return { allowed: true, reason: STATION_ENTITLEMENT_REASON.OK };
  const n = Number(activeStations);
  if (!Number.isInteger(n) || n < 0) return { allowed: false, reason: STATION_ENTITLEMENT_REASON.LICENSE_INVALID };
  return n < entitlement.max
    ? { allowed: true, reason: STATION_ENTITLEMENT_REASON.OK }
    : { allowed: false, reason: STATION_ENTITLEMENT_REASON.STATION_LIMIT_REACHED };
}
