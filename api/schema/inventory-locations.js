/**
 * Esquema: locais/mesas, armazéns e stock por camadas FIFO, centros de impressão.
 * Inclui a migração transaccional que expande o CHECK de stock_movements para
 * suportar transfer_out/transfer_in em bases antigas.
 * Extraído de database.js — mesma ordem/SQL, sem alterações de comportamento.
 */
export function defineInventoryLocationsSchema(db, { safeRun, ensureTenantGuards }) {
  db.run(`
    CREATE TABLE IF NOT EXISTS locations (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      name TEXT NOT NULL,
      code TEXT,
      type TEXT NOT NULL DEFAULT 'dining',
      active INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0,
      allow_custom_names INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
  safeRun(
    `CREATE INDEX IF NOT EXISTS idx_locations_tenant ON locations(tenant_id, sort_order, name)`,
    'Erro ao criar idx_locations_tenant:'
  );
  safeRun(
    `CREATE UNIQUE INDEX IF NOT EXISTS uq_locations_tenant_name ON locations(tenant_id, name)`,
    'Erro ao criar uq_locations_tenant_name:'
  );
  db.run(`ALTER TABLE locations ADD COLUMN allow_custom_names INTEGER NOT NULL DEFAULT 0`, (err) => {
    if (err && !String(err.message || '').includes('duplicate column name')) {
      console.error('Erro ao adicionar allow_custom_names em locations:', err.message);
    }
  });
  db.run(`ALTER TABLE locations ADD COLUMN warehouse_id TEXT`, (err) => {
    if (err && !String(err.message || '').includes('duplicate column name')) {
      console.error('Erro ao adicionar warehouse_id em locations:', err.message);
    }
  });
  db.run(`ALTER TABLE locations ADD COLUMN display_start INTEGER`, (err) => {
    if (err && !String(err.message || '').includes('duplicate column name')) {
      console.error('Erro ao adicionar display_start em locations:', err.message);
    }
  });

  db.run(`
    CREATE TABLE IF NOT EXISTS warehouses (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      name TEXT NOT NULL,
      code TEXT,
      is_default INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (tenant_id, name)
    )
  `);
  safeRun(
    `CREATE INDEX IF NOT EXISTS idx_warehouses_tenant ON warehouses(tenant_id, name)`,
    'Erro ao criar idx_warehouses_tenant:'
  );
  safeRun(
    `CREATE UNIQUE INDEX IF NOT EXISTS uq_warehouses_tenant_default ON warehouses(tenant_id) WHERE is_default = 1`,
    'Erro ao criar uq_warehouses_tenant_default:'
  );

  db.run(`
    CREATE TABLE IF NOT EXISTS warehouse_stock (
      warehouse_id TEXT NOT NULL,
      product_id INTEGER NOT NULL,
      tenant_id TEXT NOT NULL,
      quantity REAL NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (warehouse_id, product_id)
    )
  `);
  safeRun(
    `CREATE INDEX IF NOT EXISTS idx_warehouse_stock_tenant_product ON warehouse_stock(tenant_id, product_id)`,
    'Erro ao criar idx_warehouse_stock_tenant_product:'
  );
  safeRun(
    `CREATE INDEX IF NOT EXISTS idx_warehouse_stock_warehouse ON warehouse_stock(warehouse_id)`,
    'Erro ao criar idx_warehouse_stock_warehouse:'
  );

  db.run(`
    CREATE TABLE IF NOT EXISTS party_credits (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      party_id TEXT NOT NULL,
      party_kind TEXT NOT NULL CHECK (party_kind IN ('customer', 'supplier')),
      amount REAL NOT NULL,
      remaining REAL NOT NULL,
      source_order_id TEXT,
      source_document_number TEXT,
      source_prefix TEXT,
      notes TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
  safeRun(
    `CREATE INDEX IF NOT EXISTS idx_party_credits_tenant_party ON party_credits(tenant_id, party_kind, party_id)`,
    'Erro ao criar idx_party_credits_tenant_party:'
  );

  db.run(`
    CREATE TABLE IF NOT EXISTS stock_layers (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      warehouse_id TEXT NOT NULL,
      product_id INTEGER NOT NULL,
      qty_remaining REAL NOT NULL,
      unit_cost REAL NOT NULL DEFAULT 0,
      received_at TEXT NOT NULL,
      lot_code TEXT,
      expiry_date TEXT,
      source_ref TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
  safeRun(
    `CREATE INDEX IF NOT EXISTS idx_stock_layers_wh_prod_fifo
     ON stock_layers(tenant_id, warehouse_id, product_id, received_at, id)`,
    'Erro ao criar idx_stock_layers_wh_prod_fifo:'
  );
  safeRun(
    `CREATE INDEX IF NOT EXISTS idx_stock_layers_lot
     ON stock_layers(tenant_id, product_id, lot_code)`,
    'Erro ao criar idx_stock_layers_lot:'
  );

  db.run(`
    CREATE TABLE IF NOT EXISTS stock_layer_consumptions (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      stock_movement_id TEXT,
      layer_id TEXT NOT NULL,
      qty REAL NOT NULL,
      unit_cost REAL NOT NULL,
      created_at TEXT NOT NULL
    )
  `);
  safeRun(
    `CREATE INDEX IF NOT EXISTS idx_slc_movement
     ON stock_layer_consumptions(tenant_id, stock_movement_id)`,
    'Erro ao criar idx_slc_movement:'
  );
  safeRun(
    `CREATE INDEX IF NOT EXISTS idx_slc_layer
     ON stock_layer_consumptions(tenant_id, layer_id)`,
    'Erro ao criar idx_slc_layer:'
  );

  db.run(`ALTER TABLE products ADD COLUMN track_lot INTEGER NOT NULL DEFAULT 0`, (err) => {
    if (err && !String(err.message || '').includes('duplicate column name')) {
      console.error('Erro ao adicionar coluna track_lot em products:', err.message);
    }
  });

  db.run(`ALTER TABLE order_items ADD COLUMN unit_cost REAL`, (err) => {
    if (err && !String(err.message || '').includes('duplicate column name')) {
      console.error('Erro ao adicionar coluna unit_cost em order_items:', err.message);
    }
  });
  db.run(`ALTER TABLE order_items ADD COLUMN cogs_total REAL`, (err) => {
    if (err && !String(err.message || '').includes('duplicate column name')) {
      console.error('Erro ao adicionar coluna cogs_total em order_items:', err.message);
    }
  });

  db.run(`ALTER TABLE stock_movements ADD COLUMN warehouse_id TEXT`, (err) => {
    if (err && !String(err.message || '').includes('duplicate column name')) {
      console.error('Erro ao adicionar warehouse_id em stock_movements:', err.message);
    }
  });
  db.run(`ALTER TABLE stock_movements ADD COLUMN from_warehouse_id TEXT`, (err) => {
    if (err && !String(err.message || '').includes('duplicate column name')) {
      console.error('Erro ao adicionar from_warehouse_id em stock_movements:', err.message);
    }
  });
  db.run(`ALTER TABLE stock_movements ADD COLUMN to_warehouse_id TEXT`, (err) => {
    if (err && !String(err.message || '').includes('duplicate column name')) {
      console.error('Erro ao adicionar to_warehouse_id em stock_movements:', err.message);
    }
    // After warehouse columns exist, expand CHECK for transfer_* on legacy tables.
    db.get(
      `SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'stock_movements'`,
      (smErr, smRow) => {
        if (smErr || !smRow?.sql) return;
        const sql = String(smRow.sql);
        if (sql.includes('transfer_out')) return;
        db.serialize(() => {
          db.run('BEGIN');
          db.run(`
            CREATE TABLE IF NOT EXISTS stock_movements_new (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              cloud_id TEXT UNIQUE,
              tenant_id TEXT NOT NULL,
              product_id INTEGER NOT NULL,
              movement_type TEXT NOT NULL CHECK (movement_type IN ('sale', 'restock', 'adjustment', 'transfer_out', 'transfer_in')),
              quantity REAL NOT NULL,
              reference_id TEXT NOT NULL,
              warehouse_id TEXT,
              from_warehouse_id TEXT,
              to_warehouse_id TEXT,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL DEFAULT (datetime('now'))
            )
          `);
          db.run(`
            INSERT INTO stock_movements_new
              (id, cloud_id, tenant_id, product_id, movement_type, quantity, reference_id,
               warehouse_id, from_warehouse_id, to_warehouse_id, created_at, updated_at)
            SELECT
              id, cloud_id, tenant_id, product_id, movement_type, quantity, reference_id,
              warehouse_id, from_warehouse_id, to_warehouse_id, created_at, updated_at
            FROM stock_movements
          `, (copyErr) => {
            if (copyErr) {
              console.error('Erro ao copiar stock_movements:', copyErr.message);
              db.run('ROLLBACK');
              return;
            }
            db.run(`DROP TABLE stock_movements`);
            db.run(`ALTER TABLE stock_movements_new RENAME TO stock_movements`);
            db.run(
              `CREATE UNIQUE INDEX IF NOT EXISTS uq_stock_movements_local_ref ON stock_movements(product_id, movement_type, reference_id)`
            );
            db.run(`CREATE INDEX IF NOT EXISTS idx_stock_movements_tenant_id ON stock_movements(tenant_id)`);
            db.run('COMMIT', (commitErr) => {
              if (commitErr) {
                console.error('Erro ao migrar stock_movements (transfer types):', commitErr.message);
                db.run('ROLLBACK');
              }
            });
          });
        });
      }
    );
  });

  db.run(`
    CREATE TABLE IF NOT EXISTS location_tables (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      location_id TEXT NOT NULL,
      name TEXT NOT NULL,
      seats INTEGER,
      sort_order INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
  safeRun(
    `CREATE INDEX IF NOT EXISTS idx_location_tables_location ON location_tables(tenant_id, location_id, sort_order)`,
    'Erro ao criar idx_location_tables_location:'
  );
  safeRun(
    `CREATE UNIQUE INDEX IF NOT EXISTS uq_location_tables_name ON location_tables(tenant_id, location_id, name)`,
    'Erro ao criar uq_location_tables_name:'
  );
  safeRun(
    `CREATE UNIQUE INDEX IF NOT EXISTS uq_location_tables_tenant_name ON location_tables(tenant_id, name)`,
    'Erro ao criar uq_location_tables_tenant_name:'
  );

  db.run(`
    CREATE TABLE IF NOT EXISTS print_centers (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      name TEXT NOT NULL,
      connection_type TEXT NOT NULL DEFAULT 'windows',
      windows_printer_name TEXT,
      host TEXT,
      port INTEGER DEFAULT 9100,
      paper_width INTEGER NOT NULL DEFAULT 80,
      enabled INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
  safeRun(
    `CREATE INDEX IF NOT EXISTS idx_print_centers_tenant ON print_centers(tenant_id, sort_order, name)`,
    'Erro ao criar idx_print_centers_tenant:'
  );
  safeRun(
    `CREATE UNIQUE INDEX IF NOT EXISTS uq_print_centers_tenant_name ON print_centers(tenant_id, name)`,
    'Erro ao criar uq_print_centers_tenant_name:'
  );

  db.run(`
    CREATE TABLE IF NOT EXISTS print_center_categories (
      print_center_id TEXT NOT NULL,
      category_id INTEGER NOT NULL,
      tenant_id TEXT NOT NULL,
      PRIMARY KEY (print_center_id, category_id)
    )
  `);
  safeRun(
    `CREATE INDEX IF NOT EXISTS idx_print_center_categories_category
     ON print_center_categories(tenant_id, category_id)`,
    'Erro ao criar idx_print_center_categories_category:'
  );

  ensureTenantGuards();
}
