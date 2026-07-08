import { isUuidString, uuidv4 } from '../cloudIdUtils.js';
import { enqueueSync } from '../syncQueue.js';
import { parsePagination, parseSearchTerm, withPaginationPayload } from './queryOptions.service.js';
import { HttpError } from '../utils/response.js';
import { requireTenantId } from '../utils/tenant.js';
import {
  countActiveProductsByCategory,
  countCategories,
  countChildrenByCategoryId,
  deleteCategoryById,
  deleteCategoryTombstonesByNameOrCloudId,
  existsCategoryById,
  findCategoryById,
  insertCategory,
  insertDeletedCategoryTombstone,
  listCategories,
  listCategoriesPaginated,
  purgeCategoriesMatchingTombstones,
  updateCategory,
} from '../repositories/categorias.repository.js';
import { run } from '../dbUtils.js';

function normalizeCategoryRow(row) {
  return {
    ...row,
    id: String(row.id),
    parent_id: row.parent_id ? String(row.parent_id) : null,
  };
}

function resolveParentId(parentIdRaw) {
  if (parentIdRaw === null || parentIdRaw === undefined || String(parentIdRaw).trim() === '') {
    return null;
  }
  return Number(parentIdRaw);
}

function resolveTenantFromUser(user) {
  return requireTenantId(user?.tenant_id, {
    status: 401,
    message: 'tenant_id ausente para operacao de categorias',
  });
}

export async function listCategorias(query = {}, user = null) {
  const tenantId = resolveTenantFromUser(user);
  await purgeCategoriesMatchingTombstones(tenantId);
  const pagination = parsePagination(query);
  const search = parseSearchTerm(query.search);
  const where = ['tenant_id = ?'];
  const params = [tenantId];

  if (search) {
    where.push(`LOWER(COALESCE(name, '')) LIKE LOWER(?)`);
    params.push(`%${search}%`);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  if (!pagination.hasPagination) {
    const rows = await listCategories(whereSql, params);
    return rows.map(normalizeCategoryRow);
  }

  const rows = await listCategoriesPaginated(whereSql, params, pagination.limit, pagination.offset);
  const total = await countCategories(whereSql, params);
  return withPaginationPayload(rows.map(normalizeCategoryRow), {
    page: pagination.page,
    limit: pagination.limit,
    total,
  });
}

export async function createCategoria(payload = {}, user = null) {
  const tenantId = resolveTenantFromUser(user);
  const name = String(payload.name ?? '').trim();
  const parentIdParsed = resolveParentId(payload.parent_id);

  if (!name) throw new HttpError(400, 'name e obrigatorio');
  if (parentIdParsed !== null && !Number.isInteger(parentIdParsed)) {
    throw new HttpError(400, 'parent_id invalido');
  }

  if (parentIdParsed !== null) {
    const parentExists = await existsCategoryById(parentIdParsed, tenantId);
    if (!parentExists) throw new HttpError(400, 'Grupo pai nao encontrado');
  }

  const cloudId = uuidv4();
  const now = new Date().toISOString();

  let insertResult;
  try {
    insertResult = await insertCategory({
      name,
      parentId: parentIdParsed,
      cloudId,
      updatedAt: now,
      tenantId,
    });
  } catch (err) {
    if (String(err?.message || '').includes('UNIQUE constraint failed')) {
      throw new HttpError(409, 'Ja existe um grupo com este nome');
    }
    throw err;
  }

  await deleteCategoryTombstonesByNameOrCloudId(name, cloudId, tenantId).catch(() => {});

  try {
    await enqueueSync('category', {
      id: Number(insertResult.lastID),
      cloud_id: cloudId,
      name,
      parent_id: parentIdParsed ?? null,
      tenant_id: tenantId,
      updated_at: now,
      deleted: false,
    });
  } catch (queueErr) {
    console.warn('[categorias] falha ao enfileirar criacao para sync:', queueErr?.message || queueErr);
  }

  return {
    success: true,
    id: String(insertResult.lastID),
    name,
    parent_id: parentIdParsed ? String(parentIdParsed) : null,
  };
}

export async function updateCategoria(categoryIdRaw, payload = {}, user = null) {
  const tenantId = resolveTenantFromUser(user);
  const categoryId = Number(categoryIdRaw);
  const name = String(payload.name ?? '').trim();
  const parentIdParsed = resolveParentId(payload.parent_id);

  if (!Number.isInteger(categoryId)) throw new HttpError(400, 'id invalido');
  if (!name) throw new HttpError(400, 'name e obrigatorio');
  if (parentIdParsed !== null && !Number.isInteger(parentIdParsed)) {
    throw new HttpError(400, 'parent_id invalido');
  }
  if (parentIdParsed !== null && parentIdParsed === categoryId) {
    throw new HttpError(400, 'Um grupo nao pode ser pai dele mesmo');
  }

  const currentRow = await findCategoryById(categoryId, tenantId);
  if (!currentRow) throw new HttpError(404, 'Grupo nao encontrado');

  const ensuredCloudId =
    currentRow?.cloud_id && isUuidString(String(currentRow.cloud_id)) ? String(currentRow.cloud_id) : uuidv4();
  const now = new Date().toISOString();

  if (parentIdParsed !== null) {
    const parentExists = await existsCategoryById(parentIdParsed, tenantId);
    if (!parentExists) throw new HttpError(400, 'Grupo pai nao encontrado');
  }

  let updateResult;
  try {
    updateResult = await updateCategory({
      id: categoryId,
      name,
      parentId: parentIdParsed,
      cloudId: ensuredCloudId,
      updatedAt: now,
      tenantId,
    });
  } catch (err) {
    if (String(err?.message || '').includes('UNIQUE constraint failed')) {
      throw new HttpError(409, 'Ja existe um grupo com este nome');
    }
    throw err;
  }

  await deleteCategoryTombstonesByNameOrCloudId(name, ensuredCloudId, tenantId).catch(() => {});

  try {
    await enqueueSync('category', {
      id: Number(categoryId),
      cloud_id: ensuredCloudId,
      name,
      parent_id: parentIdParsed ?? null,
      tenant_id: tenantId,
      updated_at: now,
      deleted: false,
    });
  } catch (queueErr) {
    console.warn('[categorias] falha ao enfileirar edicao para sync:', queueErr?.message || queueErr);
  }

  return {
    success: true,
    updated: updateResult.changes > 0,
    id: String(categoryId),
    name,
    parent_id: parentIdParsed ? String(parentIdParsed) : null,
  };
}

export async function deleteCategoria(categoryIdRaw, user = null) {
  const categoryId = Number(categoryIdRaw);
  if (!Number.isInteger(categoryId)) throw new HttpError(400, 'id invalido');

  const tenantId = resolveTenantFromUser(user);
  const currentRow = await findCategoryById(categoryId, tenantId);
  if (!currentRow) throw new HttpError(404, 'Grupo nao encontrado');

  const deletedAt = new Date().toISOString();
  const cloudId =
    currentRow?.cloud_id && isUuidString(String(currentRow.cloud_id)) ? String(currentRow.cloud_id) : null;
  const trimmedName = String(currentRow?.name ?? '').trim();
  let deleteResult;
  try {
    await run('BEGIN IMMEDIATE TRANSACTION');

    const productsCount = await countActiveProductsByCategory(categoryId, tenantId);
    if (productsCount > 0) {
      throw new HttpError(409, 'Este grupo possui produtos associados e nao pode ser removido');
    }

    const childrenCount = await countChildrenByCategoryId(categoryId, tenantId);
    if (childrenCount > 0) {
      throw new HttpError(409, 'Este grupo possui subgrupos e nao pode ser removido');
    }

    deleteResult = await deleteCategoryById(categoryId, tenantId);
    await insertDeletedCategoryTombstone({
      cloudId,
      name: trimmedName,
      deletedAt,
      tenantId,
    });
    await run('COMMIT');
  } catch (err) {
    try {
      await run('ROLLBACK');
    } catch {}
    if (!(err instanceof HttpError)) {
      console.warn('[categorias] falha ao gravar tombstone:', err?.message || err);
    }
    throw err;
  }

  try {
    await enqueueSync('category', {
      id: Number(categoryId),
      cloud_id: cloudId,
      name: trimmedName,
      tenant_id: tenantId,
      updated_at: deletedAt,
      deleted: true,
    });
  } catch (queueErr) {
    console.warn('[categorias] falha ao enfileirar remocao para sync:', queueErr?.message || queueErr);
  }

  return {
    success: true,
    deleted: deleteResult.changes > 0,
    id: String(categoryId),
  };
}
