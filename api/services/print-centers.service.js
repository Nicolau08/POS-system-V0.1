import crypto from 'crypto';
import { get } from '../dbUtils.js';
import { HttpError } from '../utils/response.js';
import { requireTenantId } from '../utils/tenant.js';
import {
  clearCategoryFromOtherCenters,
  deleteCategoriesForCenter,
  deletePrintCenter,
  getPrintCenterById,
  insertCategoryMapping,
  insertPrintCenter,
  listAllCategoriesWithNames,
  listAllCategoryMappings,
  listCategoriesForCenter,
  listPrintCenters,
  updatePrintCenter,
} from '../repositories/print-centers.repository.js';

const CONNECTION_TYPES = new Set(['windows', 'network']);

function resolveTenantId(actorUser) {
  return requireTenantId(actorUser?.tenant_id, {
    status: 401,
    message: 'tenant_id ausente para operacao de centros de impressao',
  });
}

function normalizeCenter(row, categories = []) {
  return {
    id: String(row.id),
    name: String(row.name ?? ''),
    connectionType: String(row.connection_type ?? 'windows'),
    windowsPrinterName: row.windows_printer_name != null ? String(row.windows_printer_name) : null,
    host: row.host != null ? String(row.host) : null,
    port: Number(row.port ?? 9100) || 9100,
    paperWidth: Number(row.paper_width ?? 80) === 58 ? 58 : 80,
    enabled: Boolean(row.enabled),
    sortOrder: Number(row.sort_order ?? 0),
    categoryIds: categories.map((c) => String(c.category_id)),
    categories: categories.map((c) => ({
      id: String(c.category_id),
      name: String(c.category_name ?? ''),
      parentId: c.parent_id != null ? String(c.parent_id) : null,
    })),
    createdAt: row.created_at ?? null,
    updatedAt: row.updated_at ?? null,
  };
}

function parseConnectionType(raw) {
  const value = String(raw ?? 'windows').trim().toLowerCase();
  if (!CONNECTION_TYPES.has(value)) {
    throw new HttpError(400, 'Tipo de ligação inválido (windows | network)');
  }
  return value;
}

function validateConnection(connectionType, payload) {
  if (connectionType === 'windows') {
    const name = String(payload.windowsPrinterName ?? payload.windows_printer_name ?? '').trim();
    if (!name) {
      throw new HttpError(400, 'Seleccione a impressora Windows');
    }
    return { windowsPrinterName: name, host: null, port: 9100 };
  }

  const host = String(payload.host ?? '').trim();
  if (!host) throw new HttpError(400, 'Indique o IP da impressora de rede');
  const port = Math.max(1, Math.min(65535, Number(payload.port ?? 9100) || 9100));
  return { windowsPrinterName: null, host, port };
}

async function assertCategoriesExist(categoryIds, tenantId) {
  const ids = [...new Set(categoryIds.map((id) => Number(id)).filter((n) => Number.isFinite(n) && n > 0))];
  for (const categoryId of ids) {
    const row = await get(`SELECT id FROM categories WHERE id = ? AND tenant_id = ?`, [
      categoryId,
      tenantId,
    ]);
    if (!row) throw new HttpError(400, `Família/grupo ${categoryId} não encontrado`);
  }
  return ids;
}

async function replaceCenterCategories(printCenterId, categoryIds, tenantId) {
  const ids = await assertCategoriesExist(categoryIds, tenantId);
  await deleteCategoriesForCenter(printCenterId, tenantId);
  for (const categoryId of ids) {
    await clearCategoryFromOtherCenters(categoryId, tenantId, printCenterId);
    await insertCategoryMapping(printCenterId, categoryId, tenantId);
  }
  return listCategoriesForCenter(printCenterId, tenantId);
}

export async function listAllPrintCenters(actorUser = null) {
  const tenantId = resolveTenantId(actorUser);
  const [centers, categoryRows] = await Promise.all([
    listPrintCenters(tenantId),
    listAllCategoriesWithNames(tenantId),
  ]);
  const byCenter = new Map();
  for (const row of categoryRows || []) {
    const key = String(row.print_center_id);
    if (!byCenter.has(key)) byCenter.set(key, []);
    byCenter.get(key).push(row);
  }
  return (centers || []).map((row) =>
    normalizeCenter(row, byCenter.get(String(row.id)) || []),
  );
}

export async function createPrintCenter(payload = {}, actorUser = null) {
  const tenantId = resolveTenantId(actorUser);
  const name = String(payload.name ?? '').trim();
  if (!name) throw new HttpError(400, 'Nome do centro de impressão é obrigatório');

  const connectionType = parseConnectionType(payload.connectionType ?? payload.connection_type);
  const connection = validateConnection(connectionType, payload);
  const now = new Date().toISOString();
  const id = crypto.randomUUID();

  try {
    await insertPrintCenter([
      id,
      tenantId,
      name,
      connectionType,
      connection.windowsPrinterName,
      connection.host,
      connection.port,
      Number(payload.paperWidth ?? payload.paper_width ?? 80) === 58 ? 58 : 80,
      payload.enabled === false ? 0 : 1,
      Math.max(0, Number(payload.sortOrder ?? payload.sort_order ?? 0) || 0),
      now,
      now,
    ]);
  } catch (error) {
    if (String(error?.message || '').includes('UNIQUE')) {
      throw new HttpError(409, 'Já existe um centro com este nome');
    }
    throw error;
  }

  const categoryIds = Array.isArray(payload.categoryIds)
    ? payload.categoryIds
    : Array.isArray(payload.category_ids)
      ? payload.category_ids
      : [];
  const categories = await replaceCenterCategories(id, categoryIds, tenantId);
  const row = await getPrintCenterById(id, tenantId);
  return normalizeCenter(row, categories);
}

export async function updatePrintCenterById(id, payload = {}, actorUser = null) {
  const tenantId = resolveTenantId(actorUser);
  const existing = await getPrintCenterById(String(id), tenantId);
  if (!existing) throw new HttpError(404, 'Centro de impressão não encontrado');

  const name = String(payload.name ?? existing.name).trim();
  if (!name) throw new HttpError(400, 'Nome do centro de impressão é obrigatório');

  const connectionType = parseConnectionType(
    payload.connectionType ?? payload.connection_type ?? existing.connection_type
  );
  const connection = validateConnection(connectionType, {
    windowsPrinterName: payload.windowsPrinterName ?? payload.windows_printer_name ?? existing.windows_printer_name,
    host: payload.host ?? existing.host,
    port: payload.port ?? existing.port,
  });

  const now = new Date().toISOString();
  try {
    await updatePrintCenter(String(id), tenantId, [
      name,
      connectionType,
      connection.windowsPrinterName,
      connection.host,
      connection.port,
      Number(payload.paperWidth ?? payload.paper_width ?? existing.paper_width ?? 80) === 58 ? 58 : 80,
      payload.enabled === false ? 0 : payload.enabled === true ? 1 : existing.enabled ? 1 : 0,
      Math.max(0, Number(payload.sortOrder ?? payload.sort_order ?? existing.sort_order ?? 0) || 0),
      now,
    ]);
  } catch (error) {
    if (String(error?.message || '').includes('UNIQUE')) {
      throw new HttpError(409, 'Já existe um centro com este nome');
    }
    throw error;
  }

  let categories;
  if (payload.categoryIds != null || payload.category_ids != null) {
    const categoryIds = Array.isArray(payload.categoryIds)
      ? payload.categoryIds
      : Array.isArray(payload.category_ids)
        ? payload.category_ids
        : [];
    categories = await replaceCenterCategories(String(id), categoryIds, tenantId);
  } else {
    categories = await listCategoriesForCenter(String(id), tenantId);
  }

  const row = await getPrintCenterById(String(id), tenantId);
  return normalizeCenter(row, categories);
}

export async function removePrintCenter(id, actorUser = null) {
  const tenantId = resolveTenantId(actorUser);
  const existing = await getPrintCenterById(String(id), tenantId);
  if (!existing) throw new HttpError(404, 'Centro de impressão não encontrado');
  await deleteCategoriesForCenter(String(id), tenantId);
  await deletePrintCenter(String(id), tenantId);
  return { id: String(id), deleted: true };
}

/** Resolve centro activo para uma categoria (sobe parent_id se necessário). */
export async function resolvePrintCenterForCategory(categoryId, actorUser = null) {
  const tenantId = resolveTenantId(actorUser);
  const centers = await listAllPrintCenters(actorUser);
  const enabled = centers.filter((c) => c.enabled);
  if (!enabled.length) return null;

  const mapping = await listAllCategoryMappings(tenantId);
  const categoryToCenter = new Map(
    mapping.map((row) => [String(row.category_id), String(row.print_center_id)])
  );

  let currentId = categoryId != null ? String(categoryId) : '';
  const visited = new Set();
  while (currentId && !visited.has(currentId)) {
    visited.add(currentId);
    const centerId = categoryToCenter.get(currentId);
    if (centerId) {
      return enabled.find((c) => c.id === centerId) || null;
    }
    const cat = await get(`SELECT parent_id FROM categories WHERE id = ? AND tenant_id = ?`, [
      Number(currentId),
      tenantId,
    ]);
    currentId = cat?.parent_id != null ? String(cat.parent_id) : '';
  }
  return null;
}
