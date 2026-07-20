import { all, get, run } from '../dbUtils.js';

let colorColumnReady = false;
let colorColumnPromise = null;

/** Garante coluna color mesmo se o processo da API arrancou antes do ALTER em database.js. */
export async function ensureCategoriesColorColumn() {
  if (colorColumnReady) return;
  if (colorColumnPromise) return colorColumnPromise;

  colorColumnPromise = (async () => {
    try {
      await run(`ALTER TABLE categories ADD COLUMN color TEXT`);
    } catch (err) {
      const msg = String(err?.message || '');
      if (!msg.toLowerCase().includes('duplicate column')) {
        // Se a coluna já existir noutro caminho, PRAGMA confirma.
        const cols = await all(`PRAGMA table_info(categories)`);
        const hasColor = (cols || []).some((c) => String(c.name) === 'color');
        if (!hasColor) throw err;
      }
    }
    colorColumnReady = true;
  })();

  try {
    await colorColumnPromise;
  } catch (err) {
    colorColumnPromise = null;
    throw err;
  }
}

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

export async function listCategories(whereSql, params) {
  await ensureCategoriesColorColumn();
  return all(`SELECT id, name, parent_id, color FROM categories ${whereSql} ORDER BY name ASC`, params);
}

export async function listCategoriesPaginated(whereSql, params, limit, offset) {
  await ensureCategoriesColorColumn();
  return all(
    `SELECT id, name, parent_id, color
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

export async function findCategoryById(id, tenantId) {
  await ensureCategoriesColorColumn();
  return get(`SELECT id, name, cloud_id, color FROM categories WHERE id = ? AND tenant_id = ?`, [id, tenantId]);
}

export async function existsCategoryById(id, tenantId) {
  const row = await get(`SELECT id FROM categories WHERE id = ? AND tenant_id = ?`, [id, tenantId]);
  return Boolean(row?.id);
}

export async function insertCategory({ name, parentId, cloudId, updatedAt, tenantId, color }) {
  await ensureCategoriesColorColumn();
  return run(
    `INSERT INTO categories (name, parent_id, cloud_id, updated_at, tenant_id, color) VALUES (?, ?, ?, ?, ?, ?)`,
    [name, parentId, cloudId, updatedAt, tenantId, color ?? null]
  );
}

export async function updateCategory({ id, name, parentId, cloudId, updatedAt, tenantId, color }) {
  await ensureCategoriesColorColumn();
  return run(
    `UPDATE categories SET name = ?, parent_id = ?, cloud_id = ?, updated_at = ?, color = ? WHERE id = ? AND tenant_id = ?`,
    [name, parentId, cloudId, updatedAt, color ?? null, id, tenantId]
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
