import crypto from 'crypto';
import db from '../database.js';
import { getLocalMachineId } from '../../lib/licensing/localMachineId.js';

const runDb = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) return reject(err);
      resolve(this);
    });
  });

const getDb = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row ?? null);
    });
  });

function normalizeText(value) {
  return String(value ?? '').trim();
}

const SERIAL_BODY = /^[A-Z]_[A-Z0-9]{8}$/;

export function generateSerialNumber() {
  const letter = String.fromCharCode(65 + crypto.randomInt(0, 26));
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let suffix = '';
  for (let i = 0; i < 8; i += 1) {
    suffix += alphabet[crypto.randomInt(0, alphabet.length)];
  }
  return `${letter}_${suffix}`;
}

export function tryParseSerialFormat(raw) {
  const normalized = extractSerialFromText(raw);
  if (!normalized || !SERIAL_BODY.test(normalized)) return null;
  return normalized;
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

export { getLocalMachineId };

export async function findLicenseRowBySerial(serial) {
  const s = normalizeText(serial).toUpperCase();
  if (!s) return null;
  return getDb(
    `SELECT *
     FROM licenses
     WHERE (serial_number IS NOT NULL AND UPPER(TRIM(serial_number)) = ?)
        OR UPPER(TRIM(license_key)) = ?
     LIMIT 1`,
    [s, s]
  );
}

/**
 * Liga o número de série à máquina (primeira vez) ou confirma a mesma máquina.
 * @returns {{ ok: true, tenantId: string, expiresAt: string|null, plan: string|null, licenseId: string, licenseRow: object } | { ok: false, error: string, status?: number }}
 */
export async function bindSerialToMachine(serial, machineId) {
  const normalizedSerial = tryParseSerialFormat(serial) || extractSerialFromText(serial);
  if (!normalizedSerial) {
    return { ok: false, error: 'Formato de número de série inválido. Use o formato X_XXXXXXXX (ex.: D_9L6WAKYU).', status: 400 };
  }

  const mid = normalizeText(machineId);
  if (!mid) {
    return { ok: false, error: 'Identificador da máquina em falta.', status: 400 };
  }

  const row = await findLicenseRowBySerial(normalizedSerial);
  if (!row) {
    return { ok: false, error: 'Número de série não encontrado.', status: 404 };
  }

  if (Number(row.active ?? 1) !== 1) {
    return { ok: false, error: 'Licença inactiva.', status: 400 };
  }

  const expiresRaw = row.expires_at ? String(row.expires_at) : '';
  if (expiresRaw) {
    const expiresAt = new Date(expiresRaw);
    if (!Number.isNaN(expiresAt.getTime()) && Date.now() > expiresAt.getTime()) {
      return { ok: false, error: 'Licença expirada.', status: 400 };
    }
  }

  const existing = row.machine_id != null ? normalizeText(row.machine_id) : '';
  if (existing && existing !== mid) {
    return {
      ok: false,
      error: 'Esta licença já foi activada noutro computador.',
      status: 403,
    };
  }

  const now = new Date().toISOString();
  if (!existing) {
    await runDb(
      `UPDATE licenses
       SET machine_id = ?,
           activated_at = ?,
           serial_number = COALESCE(serial_number, ?)
       WHERE id = ?`,
      [mid, now, normalizedSerial, row.id]
    );
  }

  const tenantRow = await getDb(`SELECT id, name FROM tenants WHERE id = ? LIMIT 1`, [row.tenant_id]);
  const profileRow = await getDb(`SELECT name, nuit FROM tenant_profile WHERE id = ? LIMIT 1`, [row.tenant_id]);

  const refreshed = await getDb(`SELECT * FROM licenses WHERE id = ? LIMIT 1`, [row.id]);

  return {
    ok: true,
    tenantId: String(row.tenant_id),
    expiresAt: expiresRaw || null,
    plan: row.plan != null ? String(row.plan) : null,
    licenseId: String(row.id),
    licenseRow: refreshed || row,
    tenantName: tenantRow?.name != null ? String(tenantRow.name) : '',
    profileName: profileRow?.name != null ? String(profileRow.name) : null,
    profileNuit: profileRow?.nuit != null ? String(profileRow.nuit) : null,
  };
}

export async function fetchRemoteSerialBinding(serial, machineId) {
  const base = normalizeText(process.env.POS_LICENSE_SERVER_URL);
  if (!base) return null;

  const secret = normalizeText(
    process.env.POS_LICENSE_SERVER_SECRET || process.env.POS_LICENSE_ACTIVATION_SECRET
  );
  const url = `${base.replace(/\/$/, '')}/setup/license/bind-serial`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(secret ? { 'X-License-Activation-Secret': secret } : {}),
    },
    body: JSON.stringify({
      serial_number: serial,
      machine_id: machineId,
    }),
  });

  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    throw new Error('Servidor de licenças: resposta inválida.');
  }

  if (!response.ok) {
    const msg =
      json?.error?.message ||
      json?.message ||
      (typeof json?.error === 'string' ? json.error : null) ||
      text ||
      `HTTP ${response.status}`;
    throw new Error(String(msg));
  }

  const data = json && typeof json === 'object' && json.success === true && json.data != null ? json.data : json;
  return data;
}
