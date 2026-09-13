/**
 * Esquema: company_profile e app_setup_state (estado do assistente de instalação/licença).
 * Extraído de database.js — mesma ordem/SQL, sem alterações de comportamento.
 */
export function defineSetupStateSchema(db) {
  db.run(`
    CREATE TABLE IF NOT EXISTS company_profile (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      name TEXT,
      tax_id TEXT,
      street TEXT,
      building_number TEXT,
      additional_street TEXT,
      plot_identification TEXT,
      district TEXT,
      cep TEXT,
      city TEXT,
      state TEXT,
      country TEXT,
      phone TEXT,
      email TEXT,
      bank_account_number TEXT,
      bank_details TEXT,
      logo_data_url TEXT,
      void_reasons TEXT,
      updated_at TEXT
    )
  `);

  db.run(
    `INSERT OR IGNORE INTO company_profile (id, updated_at) VALUES (1, datetime('now'))`,
    (cpErr) => {
      if (cpErr) {
        console.error('[database] Falha ao inicializar company_profile:', cpErr.message);
      }
    }
  );

  db.run(`
    CREATE TABLE IF NOT EXISTS app_setup_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      admin_password_set INTEGER NOT NULL DEFAULT 0,
      license_activated INTEGER NOT NULL DEFAULT 0,
      license_token_hash TEXT,
      license_expires_at TEXT,
      printer_type TEXT,
      setup_completed INTEGER NOT NULL DEFAULT 0,
      setup_completed_at TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  db.run(
    `INSERT OR IGNORE INTO app_setup_state (id, admin_password_set, license_activated, updated_at) VALUES (1, 0, 0, datetime('now'))`,
    (setupErr) => {
      if (setupErr) {
        console.error('[database] Falha ao inicializar app_setup_state:', setupErr.message);
      }
    }
  );

  db.run(`ALTER TABLE app_setup_state ADD COLUMN license_expires_at TEXT`, (err) => {
    if (err && !String(err.message || '').includes('duplicate column name')) {
      console.error('Erro ao adicionar coluna license_expires_at em app_setup_state:', err.message);
    }
  });
  db.run(`ALTER TABLE app_setup_state ADD COLUMN printer_type TEXT`, (err) => {
    if (err && !String(err.message || '').includes('duplicate column name')) {
      console.error('Erro ao adicionar coluna printer_type em app_setup_state:', err.message);
    }
  });
  db.run(`ALTER TABLE app_setup_state ADD COLUMN setup_completed INTEGER NOT NULL DEFAULT 0`, (err) => {
    if (err && !String(err.message || '').includes('duplicate column name')) {
      console.error('Erro ao adicionar coluna setup_completed em app_setup_state:', err.message);
    }
  });
  db.run(`ALTER TABLE app_setup_state ADD COLUMN setup_completed_at TEXT`, (err) => {
    if (err && !String(err.message || '').includes('duplicate column name')) {
      console.error('Erro ao adicionar coluna setup_completed_at em app_setup_state:', err.message);
    }
  });
}
