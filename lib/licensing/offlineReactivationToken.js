import crypto from 'crypto';
import { REACTIVATION_TOKEN_DIGITS } from './reactivationToken.js';

/** Minutos desde 2020-01-01 UTC (7 dígitos ≈ até ~2039). */
const OFFLINE_EPOCH_MS = Date.UTC(2020, 0, 1, 0, 0, 0, 0);
const OFFLINE_MINUTE_MAX = 9_999_999;
const OFFLINE_MAC_MOD = 100_000;
const OFFLINE_KIND = 'pos_reactivate_offline_v1';

export function normalizeLicenseHmacSecret(value) {
  return String(value ?? '').trim();
}

export function buildOfflineReactivationCanonical(input) {
  const tenantId = String(input?.tenantId ?? input?.tenant_id ?? '').trim();
  const machineId = String(input?.machineId ?? input?.machine_id ?? '').trim();
  const expirationIso = String(input?.expirationIso ?? input?.expiration ?? '').trim();
  const voucherNonce = String(input?.voucherNonce ?? input?.voucher_nonce ?? '').trim();
  return `${OFFLINE_KIND}|${tenantId}|${machineId}|${expirationIso}|${voucherNonce}`;
}

/** Alinha ao minuto UTC (o token guarda minutos, não segundos). */
export function normalizeExpirationToMinuteIso(expirationIso) {
  const ms = Date.parse(String(expirationIso ?? ''));
  if (!Number.isFinite(ms)) return null;
  const alignedMs = OFFLINE_EPOCH_MS + Math.floor((ms - OFFLINE_EPOCH_MS) / 60_000) * 60_000;
  return new Date(alignedMs).toISOString();
}

function expirationToMinuteOffset(expirationIso) {
  const normalized = normalizeExpirationToMinuteIso(expirationIso);
  if (!normalized) return null;
  const ms = Date.parse(normalized);
  const offset = Math.floor((ms - OFFLINE_EPOCH_MS) / 60_000);
  if (offset < 0 || offset > OFFLINE_MINUTE_MAX) return null;
  return offset;
}

export function minuteOffsetToExpirationIso(offset) {
  const minute = Number(offset);
  if (!Number.isFinite(minute) || minute < 0 || minute > OFFLINE_MINUTE_MAX) return null;
  return new Date(OFFLINE_EPOCH_MS + minute * 60_000).toISOString();
}

function offlineMac5(canonical, secret) {
  const digest = crypto.createHmac('sha256', secret).update(canonical).digest();
  return digest.readUInt32BE(0) % OFFLINE_MAC_MOD;
}

/**
 * Gera token de 12 dígitos verificável offline (7 minutos + 5 dígitos HMAC).
 */
export function generateOfflineReactivationToken(input) {
  const secret = normalizeLicenseHmacSecret(input?.secret);
  if (!secret) {
    return { ok: false, error: 'Segredo HMAC em falta.' };
  }

  const tenantId = String(input?.tenantId ?? '').trim();
  const machineId = String(input?.machineId ?? '').trim();
  const expirationRaw = String(input?.expirationIso ?? '').trim();
  const voucherNonce = String(input?.voucherNonce ?? '').trim();

  if (!tenantId || !machineId || !expirationRaw) {
    return { ok: false, error: 'tenantId, machineId e expirationIso são obrigatórios.' };
  }

  const expirationIso = normalizeExpirationToMinuteIso(expirationRaw);
  if (!expirationIso) {
    return { ok: false, error: 'Data de expiração inválida ou fora do intervalo suportado.' };
  }

  const minuteOffset = expirationToMinuteOffset(expirationIso);
  if (minuteOffset == null) {
    return { ok: false, error: 'Data fora do intervalo suportado pelo token offline.' };
  }

  const canonical = buildOfflineReactivationCanonical({
    tenantId,
    machineId,
    expirationIso,
    voucherNonce,
  });
  const mac = offlineMac5(canonical, secret);
  const token = `${String(minuteOffset).padStart(7, '0')}${String(mac).padStart(5, '0')}`;

  if (token.length !== REACTIVATION_TOKEN_DIGITS) {
    return { ok: false, error: 'Falha ao gerar token offline.' };
  }

  return {
    ok: true,
    token,
    expirationIso,
    minuteOffset,
  };
}

/**
 * Valida token offline com licença local (tenant, machine_id, voucher_nonce).
 */
export function verifyOfflineReactivationToken(tokenDigits, input) {
  const secret = normalizeLicenseHmacSecret(input?.secret);
  if (!secret) {
    return { ok: false, error: 'POS_LICENSE_HMAC_SECRET não configurado.' };
  }

  const digits = String(tokenDigits ?? '').replace(/\D/g, '');
  if (digits.length !== REACTIVATION_TOKEN_DIGITS) {
    return { ok: false, error: 'Token deve ter 12 dígitos.' };
  }

  const localTenantId = String(input?.tenantId ?? '').trim();
  const localMachineId = String(input?.machineId ?? input?.licenseMachineId ?? '').trim();
  const expectedMachineId = String(input?.expectedMachineId ?? localMachineId).trim();
  const voucherNonce = String(input?.voucherNonce ?? '').trim();

  if (!localTenantId || !expectedMachineId) {
    return { ok: false, error: 'Licença local sem tenant ou machine_id.' };
  }

  const minuteOffset = Number.parseInt(digits.slice(0, 7), 10);
  const macGiven = Number.parseInt(digits.slice(7, 12), 10);
  if (!Number.isFinite(minuteOffset) || !Number.isFinite(macGiven)) {
    return { ok: false, error: 'Token inválido.' };
  }

  const expirationIso = minuteOffsetToExpirationIso(minuteOffset);
  if (!expirationIso) {
    return { ok: false, error: 'Token inválido (data).' };
  }

  const expMs = Date.parse(expirationIso);
  if (!Number.isFinite(expMs) || Date.now() > expMs) {
    return { ok: false, error: 'O código refere uma licença ainda expirada.' };
  }

  const canonical = buildOfflineReactivationCanonical({
    tenantId: localTenantId,
    machineId: expectedMachineId,
    expirationIso,
    voucherNonce,
  });
  const macExpected = offlineMac5(canonical, secret);
  if (macGiven !== macExpected) {
    return { ok: false, error: 'Token inválido ou não corresponde a esta máquina/loja.' };
  }

  if (localMachineId && localMachineId !== expectedMachineId) {
    return { ok: false, error: 'Licença local não corresponde à máquina esperada.' };
  }

  return {
    ok: true,
    expirationIso,
    tenantId: localTenantId,
    machineId: expectedMachineId,
    offline: true,
  };
}

/** Actualiza expiração e reassina license.json (mesmo formato que POS/Electron). */
export function resignMachineLicensePayload(localPayload, expirationIso, secret) {
  const tenant_id = String(localPayload?.tenant_id ?? '').trim();
  const machine_id = String(localPayload?.machine_id ?? '').trim();
  const expiration = String(expirationIso ?? '').trim();
  const canonical = { tenant_id, machine_id, expiration };
  const signature = crypto.createHmac('sha256', secret).update(JSON.stringify(canonical)).digest('hex');
  return {
    ...localPayload,
    tenant_id,
    machine_id,
    expiration,
    expires_at: expiration,
    signature,
    activated_at: localPayload?.activated_at || new Date().toISOString(),
  };
}
