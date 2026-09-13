import { all, get, run } from '../dbUtils.js';

export function listLocations(tenantId) {
  return all(
    `SELECT id, tenant_id, name, code, type, active, sort_order,
            COALESCE(allow_custom_names, 0) AS allow_custom_names,
            warehouse_id,
            display_start,
            created_at, updated_at
     FROM locations
    WHERE tenant_id = ?
     ORDER BY sort_order ASC, name ASC`,
    [tenantId]
  );
}

export function getLocationById(id, tenantId) {
  return get(
    `SELECT id, tenant_id, name, code, type, active, sort_order,
            COALESCE(allow_custom_names, 0) AS allow_custom_names,
            warehouse_id,
            display_start,
            created_at, updated_at
     FROM locations
     WHERE id = ? AND tenant_id = ?`,
    [id, tenantId]
  );
}

export function countLocations(tenantId) {
  return get(`SELECT COUNT(*) AS total FROM locations WHERE tenant_id = ?`, [tenantId]);
}

export function insertLocation(row) {
  return run(
    `INSERT INTO locations
      (id, tenant_id, name, code, type, active, sort_order, allow_custom_names, warehouse_id, display_start, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    row
  );
}

export function updateLocation(id, tenantId, payload) {
  return run(
    `UPDATE locations SET
      name = ?,
      code = ?,
      type = ?,
      active = ?,
      sort_order = ?,
      allow_custom_names = ?,
      warehouse_id = ?,
      display_start = ?,
      updated_at = ?
     WHERE id = ? AND tenant_id = ?`,
    [...payload, id, tenantId]
  );
}

export function deleteLocation(id, tenantId) {
  return run(`DELETE FROM locations WHERE id = ? AND tenant_id = ?`, [id, tenantId]);
}

export function listTablesByLocation(locationId, tenantId) {
  return all(
    `SELECT id, tenant_id, location_id, name, seats, sort_order, active, created_at, updated_at
     FROM location_tables
     WHERE location_id = ? AND tenant_id = ?
     ORDER BY sort_order ASC, name ASC`,
    [locationId, tenantId]
  );
}

export function listAllTables(tenantId) {
  return all(
    `SELECT id, tenant_id, location_id, name, seats, sort_order, active, created_at, updated_at
     FROM location_tables
     WHERE tenant_id = ?
     ORDER BY sort_order ASC, name ASC`,
    [tenantId]
  );
}

export function getTableById(id, tenantId) {
  return get(
    `SELECT id, tenant_id, location_id, name, seats, sort_order, active, created_at, updated_at
     FROM location_tables
     WHERE id = ? AND tenant_id = ?`,
    [id, tenantId]
  );
}

export function insertTable(row) {
  return run(
    `INSERT INTO location_tables
      (id, tenant_id, location_id, name, seats, sort_order, active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    row
  );
}

export function updateTable(id, tenantId, payload) {
  return run(
    `UPDATE location_tables SET
      name = ?,
      seats = ?,
      sort_order = ?,
      active = ?,
      updated_at = ?
     WHERE id = ? AND tenant_id = ?`,
    [...payload, id, tenantId]
  );
}

export function deleteTable(id, tenantId) {
  return run(`DELETE FROM location_tables WHERE id = ? AND tenant_id = ?`, [id, tenantId]);
}

export function deleteTablesByLocation(locationId, tenantId) {
  return run(`DELETE FROM location_tables WHERE location_id = ? AND tenant_id = ?`, [
    locationId,
    tenantId,
  ]);
}

export function findTablesByNames(tenantId, names) {
  const list = Array.isArray(names) ? names.map((name) => String(name)).filter(Boolean) : [];
  if (!list.length) return [];
  const placeholders = list.map(() => '?').join(', ');
  return all(
    `SELECT t.id, t.name, t.location_id, l.name AS location_name
       FROM location_tables t
       JOIN locations l ON l.id = t.location_id AND l.tenant_id = t.tenant_id
      WHERE t.tenant_id = ? AND t.name IN (${placeholders})
      ORDER BY t.name ASC`,
    [tenantId, ...list]
  );
}
