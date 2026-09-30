/**
 * Etapa 1G.3.1 - lê o direito a Stations da licença offline INSTALADA (ficheiro no userData), reverificando SEMPRE a
 * assinatura Ed25519, a máquina e a expiração (nunca uma coluna/flag da BD local, que não é assinada).
 * Sem cloud: funciona totalmente offline.
 */
import fs from 'fs';
import path from 'path';
import { verifyOfflineLicense } from '../../lib/licensing/offlineLicense.js';
import { resolveOfflineLicensePublicKeyPem } from '../../lib/licensing/offlineLicensePublicKeys.js';
import { getLocalMachineId } from '../../lib/licensing/localMachineId.js';
import { stationEntitlementFromVerification, STATION_ENTITLEMENT_REASON } from '../../lib/licensing/stationEntitlement.js';

const OFFLINE_LICENSE_FILE = 'offline-license.json'; // mesmo nome de electron/deviceAuth/offlineLicenseClient.js

export function getStationEntitlement({
  userDataPath = process.env.POS_USER_DATA_PATH,
  resolvePublicKeyPem = resolveOfflineLicensePublicKeyPem,
  machineId,
  expectedStoreId,
} = {}) {
  const invalid = { allowed: false, reason: STATION_ENTITLEMENT_REASON.LICENSE_INVALID, unlimited: false, max: 0, storeId: null, licenseVersion: null };
  const dir = String(userDataPath ?? '').trim();
  if (!dir) return invalid;
  let envelope;
  try {
    envelope = JSON.parse(fs.readFileSync(path.join(dir, OFFLINE_LICENSE_FILE), 'utf8'));
  } catch {
    return invalid;
  }
  const verification = verifyOfflineLicense(envelope, resolvePublicKeyPem, {
    machineId: machineId ?? getLocalMachineId(),
    expectedStoreId,
  });
  return stationEntitlementFromVerification(verification);
}
