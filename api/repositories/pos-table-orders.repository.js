import { get, all, run } from '../dbUtils.js';

export function ensurePosTableOrdersSchema() {
  return run(`
    CREATE TABLE IF NOT EXISTS pos_table_orders (
      tenant_id TEXT NOT NULL,
      table_key TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      updated_by_id TEXT,
      updated_by_name TEXT,
      station_code TEXT,
      PRIMARY KEY (tenant_id, table_key)
    )
  `);
}

export async function listPosTableOrders(tenantId) {
  await ensurePosTableOrdersSchema();
  return all(
    `SELECT tenant_id, table_key, payload_json, updated_at, updated_by_id, updated_by_name, station_code
       FROM pos_table_orders
      WHERE tenant_id = ?
      ORDER BY table_key ASC`,
    [tenantId],
  );
}

export async function getPosTableOrder(tenantId, tableKey) {
  await ensurePosTableOrdersSchema();
  return get(
    `SELECT tenant_id, table_key, payload_json, updated_at, updated_by_id, updated_by_name, station_code
       FROM pos_table_orders
      WHERE tenant_id = ?
        AND table_key = ?`,
    [tenantId, tableKey],
  );
}

export async function upsertPosTableOrder(
  tenantId,
  tableKey,
  payloadJson,
  updatedAt,
  updatedById,
  updatedByName,
  stationCode,
) {
  await ensurePosTableOrdersSchema();
  return run(
    `INSERT INTO pos_table_orders
      (tenant_id, table_key, payload_json, updated_at, updated_by_id, updated_by_name, station_code)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(tenant_id, table_key) DO UPDATE SET
       payload_json = excluded.payload_json,
       updated_at = excluded.updated_at,
       updated_by_id = excluded.updated_by_id,
       updated_by_name = excluded.updated_by_name,
       station_code = excluded.station_code`,
    [tenantId, tableKey, payloadJson, updatedAt, updatedById, updatedByName, stationCode],
  );
}

export async function deletePosTableOrder(tenantId, tableKey) {
  await ensurePosTableOrdersSchema();
  return run(
    `DELETE FROM pos_table_orders
      WHERE tenant_id = ?
        AND table_key = ?`,
    [tenantId, tableKey],
  );
}
