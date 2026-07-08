import { all, get, run } from '../dbUtils.js';

export function listPermissionRules(whereSql, params) {
  return all(
    `SELECT key, required_level, updated_at
     FROM permission_rules
     ${whereSql}
     ORDER BY key ASC`,
    params
  );
}

export function listPermissionRulesPaginated(whereSql, params, limit, offset) {
  return all(
    `SELECT key, required_level, updated_at
     FROM permission_rules
     ${whereSql}
     ORDER BY key ASC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
}

export async function countPermissionRules(whereSql, params) {
  const row = await get(`SELECT COUNT(*) AS total FROM permission_rules ${whereSql}`, params);
  return Number(row?.total ?? 0);
}

export function upsertPermissionRule({ key, requiredLevel, updatedAt }) {
  return run(
    `INSERT INTO permission_rules (key, required_level, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET
       required_level = excluded.required_level,
       updated_at = excluded.updated_at`,
    [key, requiredLevel, updatedAt]
  );
}
