import crypto from 'crypto';

const SERIAL_BODY = /^[A-Z]_[A-Z0-9]{8}$/;
const SERIAL_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** Gera número de série no formato X_XXXXXXXX (ex.: D_9L6WAKYU). */
export function generateSerialNumber() {
  const letter = String.fromCharCode(65 + crypto.randomInt(0, 26));
  let suffix = '';
  for (let i = 0; i < 8; i += 1) {
    suffix += SERIAL_ALPHABET[crypto.randomInt(0, SERIAL_ALPHABET.length)];
  }
  return `${letter}_${suffix}`;
}

export function extractSerialFromText(raw) {
  const compact = String(raw ?? '')
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/^SÉRIE|SERIE/g, '');
  const match = compact.match(/([A-Z])_([A-Z0-9]{8})/);
  if (!match) return null;
  return `${match[1]}_${match[2]}`;
}

export function tryParseSerialFormat(raw) {
  const normalized = extractSerialFromText(raw);
  if (!normalized || !SERIAL_BODY.test(normalized)) return null;
  return normalized;
}
