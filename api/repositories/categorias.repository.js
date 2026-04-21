import { all, get, run } from '../dbUtils.js';

export async function purgeCategoriesMatchingTombstones(tenantId) {
  try {
    await run(
      `DELETE FROM categories
       WHERE EXISTS (
         SELECT 1 FROM deleted_category_tombstones t
         WHERE t.tenant_id = ?
           AND categories.tenant_id = ?
           AND (
             (
               TRIM(COALESCE(t.cloud_id, '')) <> ''
               AND TRIM(COALESCE(t.cloud_id, '')) = TRIM(COALESCE(categories.cloud_id, ''))
             )
             OR (
               TRIM(COALESCE(t.name, '')) <> ''
               AND LOWER(TRIM(COALESCE(categories.name, ''))) = LOWER(TRIM(COALESCE(t.name, '')))
             )
           )
       )`,
      [tenantId, tenantId]
    );
  } catch (err) {
    if (!String(err?.message || '').toLowerCase().includes('no such table')) {
      throw err;
    }
  }
}

export function listCategories(whereSql, params) {
  return all(`SELECT id, name, parent_id FROM categories ${whereSql} ORDER BY name ASC`, params);
}

export function listCategoriesPaginated(whereSql, params, limit, offset) {
  return all(
    `SELECT id, name, parent_id
     FROM categories
     ${whereSql}
     ORDER BY name ASC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
}

export async function countCategories(whereSql, params) {
  const row = await get(`SELECT COUNT(*) AS total FROM categories ${whereSql}`, params);
  return Number(row?.total ?? 0);
}

export function findCategoryById(id, tenantId) {
  return get(`SELECT id, name, cloud_id FROM categories WHERE id = ? AND tenant_id = ?`, [id, tenantId]);
}

export async function existsCategoryById(id, tenantId) {
  const row = await get(`SELECT id FROM categories WHERE id = ? AND tenant_id = ?`, [id, tenantId]);
  return Boolean(row?.id);
}

export function insertCategory({ name, parentId, cloudId, updatedAt, tenantId }) {
  return run(
    `INSERT INTO categories (name, parent_id, cloud_id, updated_at, tenant_id) VALUES (?, ?, ?, ?, ?)`,
    [name, parentId, cloudId, updatedAt, tenantId]
  );
}

export function updateCategory({ id, name, parentId, cloudId, updatedAt, tenantId }) {
  return run(
    `UPDATE categories SET name = ?, parent_id = ?, cloud_id = ?, updated_at = ? WHERE id = ? AND tenant_id = ?`,
    [name, parentId, cloudId, updatedAt, id, tenantId]
  );
}

export function deleteCategoryById(id, tenantId) {
  return run(`DELETE FROM categories WHERE id = ? AND tenant_id = ?`, [id, tenantId]);
}

export function deleteCategoryTombstonesByNameOrCloudId(name, cloudId, tenantId) {
  return run(
    `DELETE FROM deleted_category_tombstones
     WHERE tenant_id = ?
       AND (
         LOWER(TRIM(COALESCE(name, ''))) = LOWER(TRIM(?))
         OR (cloud_id IS NOT NULL AND cloud_id = ?)
       )`,
    [tenantId, name, cloudId]
  );
}

export function insertDeletedCategoryTombstone({ cloudId, name, deletedAt, tenantId }) {
  return run(
    `INSERT INTO deleted_category_tombstones (cloud_id, name, deleted_at, tenant_id)
     VALUES (?, ?, ?, ?)`,
    [cloudId, name, deletedAt, tenantId]
  );
}

export async function countActiveProductsByCategory(categoryId, tenantId) {
  const row = await get(
    `SELECT COUNT(*) AS total
     FROM products
     WHERE category_id = ?
       AND COALESCE(deleted, 0) = 0
       AND tenant_id = ?`,
    [categoryId, tenantId]
  );
  return Number(row?.total ?? 0);
}

export async function countChildrenByCategoryId(categoryId, tenantId) {
  const row = await get(`SELECT COUNT(*) AS total FROM categories WHERE parent_id = ? AND tenant_id = ?`, [categoryId, tenantId]);
  return Number(row?.total ?? 0);
}
