import crypto from 'crypto';
import { HttpError } from '../utils/response.js';
import { requireTenantId } from '../utils/tenant.js';
import {
  countLocations,
  deleteLocation,
  deleteTable,
  deleteTablesByLocation,
  getLocationById,
  getTableById,
  insertLocation,
  insertTable,
  listAllTables,
  listLocations,
  listTablesByLocation,
  updateLocation,
  updateTable,
} from '../repositories/locations.repository.js';

const LOCATION_TYPES = new Set(['dining', 'takeaway', 'delivery', 'counter', 'other']);
const MAX_TABLES_PER_SPEC = 200;

function resolveTenantId(actorUser) {
  return requireTenantId(actorUser?.tenant_id, {
    status: 401,
    message: 'tenant_id ausente para operacao de locais',
  });
}

function normalizeLocation(row, tables = []) {
  const normalizedTables = tables.map(normalizeTable);
  return {
    id: String(row.id),
    name: String(row.name ?? ''),
    code: row.code != null ? String(row.code) : null,
    type: String(row.type ?? 'dining'),
    active: Boolean(row.active),
    sortOrder: Number(row.sort_order ?? 0),
    allowCustomNames: Boolean(row.allow_custom_names),
    tables: normalizedTables,
    tablesSummary: formatTablesRangeFromRows(normalizedTables),
    createdAt: row.created_at ?? null,
    updatedAt: row.updated_at ?? null,
  };
}

function formatTablesRangeFromRows(tables) {
  const nums = [
    ...new Set(
      tables
        .map((t) => Number(String(t.name ?? '').trim()))
        .filter((n) => Number.isFinite(n) && n > 0)
    ),
  ].sort((a, b) => a - b);
  if (!nums.length) return '—';
  if (nums.length === 1) return String(nums[0]);
  const min = nums[0];
  const max = nums[nums.length - 1];
  const contiguous = nums.length === max - min + 1 && nums.every((n, i) => n === min + i);
  if (contiguous) return `${min}:${max}`;
  return nums.join(',');
}

function normalizeTable(row) {
  return {
    id: String(row.id),
    locationId: String(row.location_id),
    name: String(row.name ?? ''),
    seats: row.seats != null ? Number(row.seats) : null,
    sortOrder: Number(row.sort_order ?? 0),
    active: Boolean(row.active),
    createdAt: row.created_at ?? null,
    updatedAt: row.updated_at ?? null,
  };
}

function parseLocationType(raw) {
  const value = String(raw ?? 'dining').trim().toLowerCase();
  if (!LOCATION_TYPES.has(value)) {
    throw new HttpError(400, 'Tipo de local inválido');
  }
  return value;
}

/**
 * Aceita: "1:20", "1-20", "1,3,4", "1, 3-5, 10"
 * Devolve números únicos ordenados (como string de nome da mesa).
 */
export function parseTablesSpec(raw) {
  const text = String(raw ?? '').trim();
  if (!text) return [];

  const numbers = new Set();
  const parts = text.split(/[,;]+/).map((p) => p.trim()).filter(Boolean);

  for (const part of parts) {
    const rangeMatch = part.match(/^(\d+)\s*[:\-–]\s*(\d+)$/);
    if (rangeMatch) {
      let from = Number(rangeMatch[1]);
      let to = Number(rangeMatch[2]);
      if (!Number.isFinite(from) || !Number.isFinite(to)) {
        throw new HttpError(400, `Intervalo inválido: ${part}`);
      }
      if (from > to) [from, to] = [to, from];
      if (to - from + 1 > MAX_TABLES_PER_SPEC) {
        throw new HttpError(400, `Máximo de ${MAX_TABLES_PER_SPEC} mesas por vez`);
      }
      for (let n = from; n <= to; n += 1) numbers.add(n);
      continue;
    }

    if (/^\d+$/.test(part)) {
      numbers.add(Number(part));
      continue;
    }

    throw new HttpError(
      400,
      `Formato inválido «${part}». Use 1:20, 1-20 ou 1,3,4`
    );
  }

  if (numbers.size > MAX_TABLES_PER_SPEC) {
    throw new HttpError(400, `Máximo de ${MAX_TABLES_PER_SPEC} mesas por vez`);
  }

  return [...numbers].sort((a, b) => a - b).map(String);
}

async function insertTableNumber(locationId, tenantId, tableNumber, now) {
  const name = String(tableNumber);
  const sortOrder = Number(tableNumber) || 0;
  const id = crypto.randomUUID();
  try {
    await insertTable([
      id,
      tenantId,
      String(locationId),
      name,
      null,
      sortOrder,
      1,
      now,
      now,
    ]);
    return normalizeTable({
      id,
      location_id: String(locationId),
      name,
      seats: null,
      sort_order: sortOrder,
      active: 1,
      created_at: now,
      updated_at: now,
    });
  } catch (error) {
    if (String(error?.message || '').includes('UNIQUE')) {
      return null; // já existe — ignorar
    }
    throw error;
  }
}

async function addTablesFromSpec(locationId, tenantId, spec) {
  const numbers = parseTablesSpec(spec);
  if (!numbers.length) return [];
  const now = new Date().toISOString();
  const created = [];
  for (const num of numbers) {
    const row = await insertTableNumber(locationId, tenantId, num, now);
    if (row) created.push(row);
  }
  return created;
}

export async function ensureDefaultBalcao(tenantId) {
  const countRow = await countLocations(tenantId);
  if (Number(countRow?.total ?? 0) > 0) return false;

  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  await insertLocation([
    id,
    tenantId,
    'Balcão',
    'BALCAO',
    'counter',
    1,
    0,
    0,
    now,
    now,
  ]);
  await addTablesFromSpec(id, tenantId, '1:20');
  return true;
}

export async function listAllLocations(actorUser = null) {
  const tenantId = resolveTenantId(actorUser);
  await ensureDefaultBalcao(tenantId);
  const locations = await listLocations(tenantId);
  const tables = await listAllTables(tenantId);
  const byLocation = new Map();
  for (const table of tables) {
    const key = String(table.location_id);
    if (!byLocation.has(key)) byLocation.set(key, []);
    byLocation.get(key).push(table);
  }
  return locations.map((row) => normalizeLocation(row, byLocation.get(String(row.id)) || []));
}

export async function createLocation(payload = {}, actorUser = null) {
  const tenantId = resolveTenantId(actorUser);
  const name = String(payload.name ?? '').trim();
  if (!name) throw new HttpError(400, 'Nome do local é obrigatório');

  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const allowCustomNames = payload.allowCustomNames === true || payload.allow_custom_names === true;
  try {
    await insertLocation([
      id,
      tenantId,
      name,
      String(payload.code ?? '').trim() || null,
      parseLocationType(payload.type),
      payload.active === false ? 0 : 1,
      Math.max(0, Number(payload.sortOrder ?? payload.sort_order ?? 0) || 0),
      allowCustomNames ? 1 : 0,
      now,
      now,
    ]);
  } catch (error) {
    if (String(error?.message || '').includes('UNIQUE')) {
      throw new HttpError(409, 'Já existe um local com este nome');
    }
    throw error;
  }

  const tablesSpec = payload.tablesSpec ?? payload.tables_spec ?? payload.tables ?? '';
  let tables = [];
  if (String(tablesSpec).trim()) {
    tables = await addTablesFromSpec(id, tenantId, tablesSpec);
  }

  return normalizeLocation(
    {
      id,
      name,
      code: String(payload.code ?? '').trim() || null,
      type: parseLocationType(payload.type),
      active: payload.active === false ? 0 : 1,
      sort_order: Math.max(0, Number(payload.sortOrder ?? 0) || 0),
      allow_custom_names: allowCustomNames ? 1 : 0,
      created_at: now,
      updated_at: now,
    },
    tables.map((t) => ({
      id: t.id,
      location_id: t.locationId,
      name: t.name,
      seats: t.seats,
      sort_order: t.sortOrder,
      active: t.active ? 1 : 0,
      created_at: t.createdAt,
      updated_at: t.updatedAt,
    }))
  );
}

export async function updateLocationById(id, payload = {}, actorUser = null) {
  const tenantId = resolveTenantId(actorUser);
  const existing = await getLocationById(String(id), tenantId);
  if (!existing) throw new HttpError(404, 'Local não encontrado');

  const name = String(payload.name ?? existing.name).trim();
  if (!name) throw new HttpError(400, 'Nome do local é obrigatório');

  const now = new Date().toISOString();
  const allowCustomNames =
    payload.allowCustomNames === true || payload.allow_custom_names === true
      ? 1
      : payload.allowCustomNames === false || payload.allow_custom_names === false
        ? 0
        : existing.allow_custom_names
          ? 1
          : 0;

  try {
    await updateLocation(String(id), tenantId, [
      name,
      String(payload.code ?? existing.code ?? '').trim() || null,
      parseLocationType(payload.type ?? existing.type),
      payload.active === false ? 0 : payload.active === true ? 1 : existing.active ? 1 : 0,
      Math.max(0, Number(payload.sortOrder ?? payload.sort_order ?? existing.sort_order ?? 0) || 0),
      allowCustomNames,
      now,
    ]);
  } catch (error) {
    if (String(error?.message || '').includes('UNIQUE')) {
      throw new HttpError(409, 'Já existe um local com este nome');
    }
    throw error;
  }

  const tables = await listTablesByLocation(String(id), tenantId);
  const updated = await getLocationById(String(id), tenantId);
  return normalizeLocation(updated, tables);
}

export async function removeLocation(id, actorUser = null) {
  const tenantId = resolveTenantId(actorUser);
  const existing = await getLocationById(String(id), tenantId);
  if (!existing) throw new HttpError(404, 'Local não encontrado');
  await deleteTablesByLocation(String(id), tenantId);
  await deleteLocation(String(id), tenantId);
  return { id: String(id), deleted: true };
}

export async function createLocationTable(locationId, payload = {}, actorUser = null) {
  const tenantId = resolveTenantId(actorUser);
  const location = await getLocationById(String(locationId), tenantId);
  if (!location) throw new HttpError(404, 'Local não encontrado');

  const tablesSpec = payload.tablesSpec ?? payload.tables_spec ?? payload.spec ?? '';
  if (String(tablesSpec).trim()) {
    const created = await addTablesFromSpec(String(locationId), tenantId, tablesSpec);
    const all = await listTablesByLocation(String(locationId), tenantId);
    return {
      created: created.length,
      tables: all.map(normalizeTable),
    };
  }

  const allowCustom = Boolean(location.allow_custom_names);
  let name = String(payload.name ?? '').trim();
  if (!name) throw new HttpError(400, 'Indique mesas (ex.: 1:20 ou 1,3,4) ou um nome');

  // Sem nomes personalizados, só números
  if (!allowCustom && !/^\d+$/.test(name)) {
    throw new HttpError(400, 'Com nomes desactivados use números (ex.: 1:20 ou 5)');
  }

  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const sortOrder = /^\d+$/.test(name) ? Number(name) : Math.max(0, Number(payload.sortOrder ?? 0) || 0);
  try {
    await insertTable([
      id,
      tenantId,
      String(locationId),
      name,
      payload.seats != null && payload.seats !== '' ? Number(payload.seats) || null : null,
      sortOrder,
      payload.active === false ? 0 : 1,
      now,
      now,
    ]);
  } catch (error) {
    if (String(error?.message || '').includes('UNIQUE')) {
      throw new HttpError(409, 'Já existe uma mesa com este nome neste local');
    }
    throw error;
  }

  return normalizeTable({
    id,
    location_id: String(locationId),
    name,
    seats: payload.seats != null && payload.seats !== '' ? Number(payload.seats) || null : null,
    sort_order: sortOrder,
    active: payload.active === false ? 0 : 1,
    created_at: now,
    updated_at: now,
  });
}

export async function updateLocationTable(id, payload = {}, actorUser = null) {
  const tenantId = resolveTenantId(actorUser);
  const existing = await getTableById(String(id), tenantId);
  if (!existing) throw new HttpError(404, 'Mesa não encontrada');

  const location = await getLocationById(String(existing.location_id), tenantId);
  const allowCustom = Boolean(location?.allow_custom_names);

  const name = String(payload.name ?? existing.name).trim();
  if (!name) throw new HttpError(400, 'Nome da mesa é obrigatório');
  if (!allowCustom && name !== String(existing.name) && !/^\d+$/.test(name)) {
    throw new HttpError(400, 'Active «Dar nome às mesas» para usar nomes personalizados');
  }

  const now = new Date().toISOString();
  try {
    await updateTable(String(id), tenantId, [
      name,
      payload.seats !== undefined
        ? payload.seats != null && payload.seats !== ''
          ? Number(payload.seats) || null
          : null
        : existing.seats,
      Math.max(0, Number(payload.sortOrder ?? payload.sort_order ?? existing.sort_order ?? 0) || 0),
      payload.active === false ? 0 : payload.active === true ? 1 : existing.active ? 1 : 0,
      now,
    ]);
  } catch (error) {
    if (String(error?.message || '').includes('UNIQUE')) {
      throw new HttpError(409, 'Já existe uma mesa com este nome neste local');
    }
    throw error;
  }

  const updated = await getTableById(String(id), tenantId);
  return normalizeTable(updated);
}

export async function removeLocationTable(id, actorUser = null) {
  const tenantId = resolveTenantId(actorUser);
  const existing = await getTableById(String(id), tenantId);
  if (!existing) throw new HttpError(404, 'Mesa não encontrada');
  await deleteTable(String(id), tenantId);
  return { id: String(id), deleted: true };
}
