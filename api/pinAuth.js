import bcrypt from 'bcrypt';

export const PIN_SALT_ROUNDS = 10;

export function normalizePinInput(pin) {
  return String(pin ?? '');
}

export function isBcryptHash(value) {
  const candidate = String(value ?? '').trim();
  return /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/.test(candidate);
}

export async function hashPin(pin) {
  return bcrypt.hash(normalizePinInput(pin), PIN_SALT_ROUNDS);
}

export async function ensureHashedPin(pinOrHash) {
  const candidate = normalizePinInput(pinOrHash);
  if (!candidate) return '';
  if (isBcryptHash(candidate)) return candidate;
  return hashPin(candidate);
}

export async function verifyPinAgainstStored(enteredPin, storedPin) {
  const entered = normalizePinInput(enteredPin);
  const stored = normalizePinInput(storedPin);
  if (!stored) {
    return { valid: false, needsMigration: false };
  }

  if (isBcryptHash(stored)) {
    const valid = await bcrypt.compare(entered, stored);
    return { valid, needsMigration: false };
  }

  const valid = entered === stored;
  return { valid, needsMigration: valid };
}
