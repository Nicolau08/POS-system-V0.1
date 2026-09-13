/**
 * Esquema: tickets de cozinha (KDS) e sessões/movimentos de caixa + relatórios Z.
 * Extraído de database.js — mesma ordem/SQL, sem alterações de comportamento.
 */
export function defineKitchenCashSchema(db, { safeRun }) {
  // KDS — tickets de cozinha (fila independente do pagamento)
  db.run(`
    CREATE TABLE IF NOT EXISTS kitchen_tickets (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      table_key TEXT,
      table_label TEXT,
      ticket_number INTEGER NOT NULL DEFAULT 1,
      print_center_id TEXT,
      print_center_name TEXT,
      status TEXT NOT NULL DEFAULT 'queued',
      source TEXT NOT NULL DEFAULT 'pos_desktop',
      sale_order_id TEXT,
      created_by_user_id TEXT,
      created_by_user_name TEXT,
      station_code TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
  db.run(`
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
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS kitchen_ticket_seq (
      tenant_id TEXT PRIMARY KEY,
      last_number INTEGER NOT NULL DEFAULT 0
    )
  `);
  safeRun(
    `CREATE INDEX IF NOT EXISTS idx_kitchen_tickets_tenant_status
     ON kitchen_tickets(tenant_id, status, created_at)`,
    'Erro ao criar idx_kitchen_tickets_tenant_status:'
  );

  db.run(`
    CREATE TABLE IF NOT EXISTS cash_sessions (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      register_code TEXT NOT NULL DEFAULT 'caixa-1',
      status TEXT NOT NULL CHECK (status IN ('open', 'closed')),
      opened_at TEXT NOT NULL,
      opened_by_id TEXT,
      opened_by_name TEXT,
      closed_at TEXT,
      closed_by_id TEXT,
      closed_by_name TEXT,
      z_number INTEGER
    )
  `);
  safeRun(
    `CREATE INDEX IF NOT EXISTS idx_cash_sessions_tenant_status ON cash_sessions(tenant_id, status, opened_at)`,
    'Erro ao criar idx_cash_sessions_tenant_status:'
  );

  db.run(`
    CREATE TABLE IF NOT EXISTS cash_withdrawals (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      tenant_id TEXT NOT NULL,
      user_id TEXT,
      user_name TEXT,
      amount REAL NOT NULL DEFAULT 0,
      scope TEXT NOT NULL CHECK (scope IN ('user', 'all')),
      note TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  safeRun(
    `CREATE INDEX IF NOT EXISTS idx_cash_withdrawals_session ON cash_withdrawals(session_id, created_at)`,
    'Erro ao criar idx_cash_withdrawals_session:'
  );

  db.run(`
    CREATE TABLE IF NOT EXISTS cash_movements (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      tenant_id TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('in', 'out', 'float', 'advance_in', 'advance_out')),
      amount REAL NOT NULL DEFAULT 0,
      note TEXT,
      party_kind TEXT,
      party_name TEXT,
      user_id TEXT,
      user_name TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  safeRun(
    `CREATE INDEX IF NOT EXISTS idx_cash_movements_session ON cash_movements(session_id, created_at)`,
    'Erro ao criar idx_cash_movements_session:'
  );

  db.run(`
    CREATE TABLE IF NOT EXISTS z_reports (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      tenant_id TEXT NOT NULL,
      z_number INTEGER NOT NULL,
      generated_at TEXT NOT NULL,
      generated_by_id TEXT,
      generated_by_name TEXT,
      payload_json TEXT NOT NULL
    )
  `);
  safeRun(
    `CREATE INDEX IF NOT EXISTS idx_z_reports_tenant_generated ON z_reports(tenant_id, generated_at DESC)`,
    'Erro ao criar idx_z_reports_tenant_generated:'
  );
  safeRun(
    `CREATE UNIQUE INDEX IF NOT EXISTS uq_z_reports_tenant_number ON z_reports(tenant_id, z_number)`,
    'Erro ao criar uq_z_reports_tenant_number:'
  );
}
