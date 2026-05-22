import crypto from 'crypto';

export {
  REACTIVATION_TOKEN_DIGITS,
  normalizeReactivationTokenInput,
  isReactivationTokenInput,
  formatReactivationTokenDisplay,
} from './reactivationToken.js';

export function generateReactivationTokenDigits(): string {
  let out = '';
  for (let i = 0; i < 12; i += 1) {
    out += String(crypto.randomInt(0, 10));
  }
  return out;
}
