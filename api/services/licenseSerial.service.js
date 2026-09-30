import crypto from 'crypto';
import { getLocalMachineId } from '../../lib/licensing/localMachineId.js';

// Etapa 1F.5c: bindSerialToMachine/fetchRemoteSerialBinding/tryParseSerialFormat/
// extractSerialFromText/findLicenseRowBySerial removidos — eram usados
// exclusivamente pelo fluxo de activação por série do POS (setup.service.js),
// agora substituído por Activation Token → Device Auth → Offline License
// Ed25519. generateSerialNumber() continua em uso por
// api/controllers/saas.controller.js (provisionamento SaaS local, sem
// relação com a activação do POS) — mantido.

export function generateSerialNumber() {
  const letter = String.fromCharCode(65 + crypto.randomInt(0, 26));
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let suffix = '';
  for (let i = 0; i < 8; i += 1) {
    suffix += alphabet[crypto.randomInt(0, alphabet.length)];
  }
  return `${letter}_${suffix}`;
}

export { getLocalMachineId };
