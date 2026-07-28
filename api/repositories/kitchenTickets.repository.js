import { get, all, run } from '../dbUtils.js';

export async function ensureKitchenTicketsSchema() {
  await run(`
    CREATE TABLE IF NOT EXISTS kitchen_tickets (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      table_key TEXT,
      table_label TEXT,
      ticket_number INTEGER NOT NULL DEFAULT 1,
      print_center_id TEXT,
      print_center_name TEXT,
      status TEXT NOT NULL DEFAULT 'queued'
        CHECK (status IN ('queued','preparing','ready','served','cancelled')),
      source TEXT NOT NULL DEFAULT 'pos_desktop',
      sale_order_id TEXT,
      created_by_user_id TEXT,
      created_by_user_name TEXT,
      station_code TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
  await run(`
    CREATE TABLE IF NOT EXISTS kitchen_ticket_items (
      id TEXT PRIMARY KEY,
      ticket_id TEXT NOT NULL,
      product_id TEXT,
      cloud_id TEXT,
      name TEXT NOT NULL,
      quantity REAL NOT NULL DEFAULT 1,
      category_id TEXT,
      category_name TEXT,
      notes TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'queued'
        CHECK (status IN ('queued','preparing','ready','served','cancelled')),
      FOREIGN KEY (ticket_id) REFERENCES kitchen_tickets(id) ON DELETE CASCADE
    )
  `);
  await run(
    `CREATE INDEX IF NOT EXISTS idx_kitchen_tickets_tenant_status
     ON kitchen_tickets(tenant_id, status, created_at)`,
  );
  await run(
    `CREATE INDEX IF NOT EXISTS idx_kitchen_tickets_center
     ON kitchen_tickets(tenant_id, print_center_id, status)`,
  );
  await run(
    `CREATE INDEX IF NOT EXISTS idx_kitchen_ticket_items_ticket
     ON kitchen_ticket_items(ticket_id, sort_order)`,
  );
  await run(
    `CREATE TABLE IF NOT EXISTS kitchen_ticket_seq (
      tenant_id TEXT PRIMARY KEY,
      last_number INTEGER NOT NULL DEFAULT 0
    )`,
  );
}

export async function nextKitchenTicketNumber(tenantId) {
  await ensureKitchenTicketsSchema();
  await run(
    `INSERT INTO kitchen_ticket_seq (tenant_id, last_number) VALUES (?, 1)
     ON CONFLICT(tenant_id) DO UPDATE SET last_number = last_number + 1`,
    [tenantId],
  );
  const row = await get(`SELECT last_number FROM kitchen_ticket_seq WHERE tenant_id = ?`, [
    tenantId,
  ]);
  return Number(row?.last_number) || 1;
}

export async function insertKitchenTicket(row) {
  await ensureKitchenTicketsSchema();
  await run(
    `INSERT INTO kitchen_tickets (
      id, tenant_id, table_key, table_label, ticket_number, print_center_id, print_center_name,
      status, source, sale_order_id, created_by_user_id, created_by_user_name, station_code,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      row.id,
      row.tenant_id,
      row.table_key,
      row.table_label,
      row.ticket_number,
      row.print_center_id,
      row.print_center_name,
      row.status,
      row.source,
      row.sale_order_id,
      row.created_by_user_id,
      row.created_by_user_name,
      row.station_code,
      row.created_at,
      row.updated_at,
    ],
  );
}

export async function insertKitchenTicketItem(row) {
  await ensureKitchenTicketsSchema();
  await run(
    `INSERT INTO kitchen_ticket_items (
      id, ticket_id, product_id, cloud_id, name, quantity, category_id, category_name,
      notes, sort_order, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      row.id,
      row.ticket_id,
      row.product_id,
      row.cloud_id,
      row.name,
      row.quantity,
      row.category_id,
      row.category_name,
      row.notes,
      row.sort_order,
      row.status,
    ],
  );
}

export async function listKitchenTickets(tenantId, filters = {}) {
  await ensureKitchenTicketsSchema();
  const where = ['t.tenant_id = ?'];
  const params = [tenantId];

  if (filters.status) {
    const statuses = Array.isArray(filters.status)
      ? filters.status
      : String(filters.status)
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
    if (statuses.length === 1) {
      where.push('t.status = ?');
      params.push(statuses[0]);
    } else if (statuses.length > 1) {
      where.push(`t.status IN (${statuses.map(() => '?').join(',')})`);
      params.push(...statuses);
    }
  } else {
    where.push(`t.status IN ('queued','preparing','ready')`);
  }

  if (filters.printCenterId) {
    where.push('t.print_center_id = ?');
    params.push(String(filters.printCenterId));
  }

  if (filters.since) {
    where.push('t.updated_at >= ?');
    params.push(String(filters.since));
  }

  const tickets = await all(
    `SELECT t.*
       FROM kitchen_tickets t
      WHERE ${where.join(' AND ')}
      ORDER BY t.created_at ASC`,
    params,
  );

  if (!tickets.length) return [];

  const ids = tickets.map((t) => t.id);
  const placeholders = ids.map(() => '?').join(',');
  const items = await all(
    `SELECT *
       FROM kitchen_ticket_items
      WHERE ticket_id IN (${placeholders})
      ORDER BY sort_order ASC, name ASC`,
    ids,
  );

  const byTicket = new Map();
  for (const item of items) {
    const list = byTicket.get(item.ticket_id) || [];
    list.push(item);
    byTicket.set(item.ticket_id, list);
  }

  return tickets.map((t) => ({
    ...t,
    items: byTicket.get(t.id) || [],
  }));
}

export async function getKitchenTicket(tenantId, ticketId) {
  await ensureKitchenTicketsSchema();
  const ticket = await get(
    `SELECT * FROM kitchen_tickets WHERE tenant_id = ? AND id = ?`,
    [tenantId, ticketId],
  );
  if (!ticket) return null;
  const items = await all(
    `SELECT * FROM kitchen_ticket_items WHERE ticket_id = ? ORDER BY sort_order ASC, name ASC`,
    [ticketId],
  );
  return { ...ticket, items };
}

export async function updateKitchenTicketStatus(tenantId, ticketId, status, updatedAt) {
  await ensureKitchenTicketsSchema();
  const result = await run(
    `UPDATE kitchen_tickets
        SET status = ?, updated_at = ?
      WHERE tenant_id = ? AND id = ?`,
    [status, updatedAt, tenantId, ticketId],
  );
  await run(
    `UPDATE kitchen_ticket_items
        SET status = ?
      WHERE ticket_id = ?`,
    [status, ticketId],
  );
  return result;
}

export async function listOpenKitchenTicketsForTable(tenantId, tableKey) {
  await ensureKitchenTicketsSchema();
  const key = String(tableKey ?? '').trim();
  if (!key) return [];
  const tickets = await all(
    `SELECT t.*
       FROM kitchen_tickets t
      WHERE t.tenant_id = ?
        AND t.table_key = ?
        AND t.status IN ('queued','preparing','ready')
      ORDER BY t.created_at ASC`,
    [tenantId, key],
  );
  if (!tickets.length) return [];
  const ids = tickets.map((t) => t.id);
  const placeholders = ids.map(() => '?').join(',');
  const items = await all(
    `SELECT *
       FROM kitchen_ticket_items
      WHERE ticket_id IN (${placeholders})
      ORDER BY sort_order ASC, name ASC`,
    ids,
  );
  const byTicket = new Map();
  for (const item of items) {
    const list = byTicket.get(item.ticket_id) || [];
    list.push(item);
    byTicket.set(item.ticket_id, list);
  }
  return tickets.map((t) => ({
    ...t,
    items: byTicket.get(t.id) || [],
  }));
}

export async function touchKitchenTicket(tenantId, ticketId, updatedAt) {
  await ensureKitchenTicketsSchema();
  return run(
    `UPDATE kitchen_tickets
        SET updated_at = ?
      WHERE tenant_id = ? AND id = ?`,
    [updatedAt, tenantId, ticketId],
  );
}

export async function updateKitchenTicketItemFields(itemId, fields = {}) {
  await ensureKitchenTicketsSchema();
  const sets = [];
  const params = [];
  if (fields.quantity != null) {
    sets.push('quantity = ?');
    params.push(Number(fields.quantity) || 0);
  }
  if ('notes' in fields) {
    sets.push('notes = ?');
    params.push(fields.notes == null ? null : String(fields.notes));
  }
  if (fields.status != null) {
    sets.push('status = ?');
    params.push(String(fields.status));
  }
  if (!sets.length) return { changes: 0 };
  params.push(String(itemId));
  return run(
    `UPDATE kitchen_ticket_items SET ${sets.join(', ')} WHERE id = ?`,
    params,
  );
}
