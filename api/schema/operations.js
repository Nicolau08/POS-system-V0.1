/**
 * Esquema: sync_state, stock_movements, orders, order_items, payment_methods
 * e o grande bloco de índices associado.
 * Extraído de database.js — mesma ordem/SQL, sem alterações de comportamento.
 */
export function defineOperationsSchema(db, { safeRun }) {
  db.run(`
    CREATE TABLE IF NOT EXISTS sync_state (
      id TEXT PRIMARY KEY,
      last_sync_at TEXT
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS stock_movements (
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
    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      customer_id TEXT,
      user_id TEXT,
      user_name TEXT,
      tenant_id TEXT NOT NULL,
      table_number TEXT,
      total REAL NOT NULL DEFAULT 0,
      subtotal REAL NOT NULL DEFAULT 0,
      tax REAL NOT NULL DEFAULT 0,
      discount REAL DEFAULT 0,
      payment_method TEXT,
      received_amount REAL,
      change_amount REAL,
      status TEXT,
      local_sale_id TEXT,
      doc_type TEXT,
      doc_prefix TEXT,
      doc_year INTEGER,
      doc_sequence INTEGER,
      document_number TEXT,
      approved_document_type TEXT,
      approved_document_number TEXT,
      external_document TEXT,
      notes TEXT,
      is_waste INTEGER NOT NULL DEFAULT 0,
      created_at TEXT,
      updated_at TEXT
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS order_items (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL,
      tenant_id TEXT NOT NULL,
      product_id TEXT,
      product_name TEXT NOT NULL,
      quantity REAL NOT NULL DEFAULT 0,
      price REAL NOT NULL DEFAULT 0,
      discount_amount REAL DEFAULT 0,
      created_at TEXT,
      updated_at TEXT,
      cloud_id TEXT
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS payment_methods (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      code TEXT NOT NULL,
      tenant_id TEXT NOT NULL,
      shortcut TEXT,
      position INTEGER NOT NULL DEFAULT 1,
      enabled INTEGER NOT NULL DEFAULT 1,
      quick_payment INTEGER NOT NULL DEFAULT 1,
      required_customer INTEGER NOT NULL DEFAULT 0,
      allow_change INTEGER NOT NULL DEFAULT 0,
      mark_as_paid INTEGER NOT NULL DEFAULT 1,
      print_receipt INTEGER NOT NULL DEFAULT 1,
      open_cash_drawer INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      color TEXT
    )
  `);

  safeRun(`CREATE INDEX IF NOT EXISTS idx_orders_customer_id ON orders(customer_id)`, 'Erro ao criar idx_orders_customer_id:');
  safeRun(`CREATE INDEX IF NOT EXISTS idx_orders_tenant_id ON orders(tenant_id)`, 'Erro ao criar idx_orders_tenant_id:');
  safeRun(`CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id)`, 'Erro ao criar idx_order_items_order_id:');
  safeRun(`CREATE INDEX IF NOT EXISTS idx_order_items_tenant_id ON order_items(tenant_id)`, 'Erro ao criar idx_order_items_tenant_id:');
  safeRun(`CREATE INDEX IF NOT EXISTS idx_vendas_user_id ON vendas(user_id)`, 'Erro ao criar idx_vendas_user_id:');

  safeRun(
    `CREATE UNIQUE INDEX IF NOT EXISTS uq_stock_movements_local_ref
     ON stock_movements(product_id, movement_type, reference_id)`,
    'Erro ao criar indice uq_stock_movements_local_ref:'
  );
  safeRun(`CREATE INDEX IF NOT EXISTS idx_products_cloud_id ON products(cloud_id)`, 'Erro ao criar idx_products_cloud_id:');
  safeRun(`CREATE INDEX IF NOT EXISTS idx_products_tenant_id ON products(tenant_id)`, 'Erro ao criar idx_products_tenant_id:');
  safeRun(`CREATE INDEX IF NOT EXISTS idx_products_product_kind ON products(product_kind)`, 'Erro ao criar idx_products_product_kind:');
  safeRun(`CREATE INDEX IF NOT EXISTS idx_tax_rates_tenant_id ON tax_rates(tenant_id)`, 'Erro ao criar idx_tax_rates_tenant_id:');
  safeRun(
    `CREATE UNIQUE INDEX IF NOT EXISTS uq_tax_rates_tenant_code ON tax_rates(tenant_id, code)`,
    'Erro ao criar uq_tax_rates_tenant_code:'
  );
  safeRun(
    `CREATE INDEX IF NOT EXISTS idx_product_bom_parent ON product_bom_lines(tenant_id, parent_product_id)`,
    'Erro ao criar idx_product_bom_parent:'
  );
  safeRun(
    `CREATE UNIQUE INDEX IF NOT EXISTS uq_product_bom_parent_component
     ON product_bom_lines(tenant_id, parent_product_id, component_product_id)`,
    'Erro ao criar uq_product_bom_parent_component:'
  );
  safeRun(`CREATE INDEX IF NOT EXISTS idx_categories_tenant_id ON categories(tenant_id)`, 'Erro ao criar idx_categories_tenant_id:');
  safeRun(
    `CREATE INDEX IF NOT EXISTS idx_deleted_category_tombstones_tenant_id ON deleted_category_tombstones(tenant_id)`,
    'Erro ao criar idx_deleted_category_tombstones_tenant_id:'
  );
  safeRun(`CREATE INDEX IF NOT EXISTS idx_stock_movements_tenant_id ON stock_movements(tenant_id)`, 'Erro ao criar idx_stock_movements_tenant_id:');
  safeRun(`CREATE INDEX IF NOT EXISTS idx_payment_methods_tenant_id ON payment_methods(tenant_id)`, 'Erro ao criar idx_payment_methods_tenant_id:');
  safeRun(`CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_methods_tenant_code ON payment_methods(tenant_id, code)`, 'Erro ao criar uq_payment_methods_tenant_code:');
  safeRun(`CREATE INDEX IF NOT EXISTS idx_categories_cloud_id ON categories(cloud_id)`, 'Erro ao criar idx_categories_cloud_id:');
  safeRun(`CREATE INDEX IF NOT EXISTS idx_clientes_cloud_id ON clientes(cloud_id)`, 'Erro ao criar idx_clientes_cloud_id:');
  safeRun(`CREATE INDEX IF NOT EXISTS idx_clientes_tenant_id ON clientes(tenant_id)`, 'Erro ao criar idx_clientes_tenant_id:');
  safeRun(`CREATE INDEX IF NOT EXISTS idx_users_cloud_id ON users(cloud_id)`, 'Erro ao criar idx_users_cloud_id:');
  safeRun(`CREATE INDEX IF NOT EXISTS idx_users_name_active ON users(name, active)`, 'Erro ao criar idx_users_name_active:');
  safeRun(`CREATE INDEX IF NOT EXISTS idx_products_updated_at ON products(updated_at)`, 'Erro ao criar idx_products_updated_at:');
  safeRun(`CREATE INDEX IF NOT EXISTS idx_products_name_active ON products(name, active)`, 'Erro ao criar idx_products_name_active:');
  safeRun(`CREATE INDEX IF NOT EXISTS idx_products_deleted ON products(deleted)`, 'Erro ao criar idx_products_deleted:');
  safeRun(`CREATE INDEX IF NOT EXISTS idx_categories_updated_at ON categories(updated_at)`, 'Erro ao criar idx_categories_updated_at:');
  safeRun(`CREATE INDEX IF NOT EXISTS idx_categories_name ON categories(name)`, 'Erro ao criar idx_categories_name:');
  safeRun(`CREATE UNIQUE INDEX IF NOT EXISTS uq_categories_tenant_name ON categories(tenant_id, name)`, 'Erro ao criar uq_categories_tenant_name:');
  safeRun(`CREATE INDEX IF NOT EXISTS idx_categories_parent_id ON categories(parent_id)`, 'Erro ao criar idx_categories_parent_id:');
  safeRun(`CREATE INDEX IF NOT EXISTS idx_clientes_updated_at ON clientes(updated_at)`, 'Erro ao criar idx_clientes_updated_at:');
  safeRun(`CREATE INDEX IF NOT EXISTS idx_clientes_name ON clientes(name)`, 'Erro ao criar idx_clientes_name:');
  safeRun(`CREATE INDEX IF NOT EXISTS idx_clientes_tenant_name ON clientes(tenant_id, name)`, 'Erro ao criar idx_clientes_tenant_name:');
  safeRun(`CREATE INDEX IF NOT EXISTS idx_users_updated_at ON users(updated_at)`, 'Erro ao criar idx_users_updated_at:');
  safeRun(`CREATE INDEX IF NOT EXISTS idx_users_tenant_id ON users(tenant_id)`, 'Erro ao criar idx_users_tenant_id:');
  safeRun(`CREATE INDEX IF NOT EXISTS idx_vendas_data_status ON vendas(data, status)`, 'Erro ao criar idx_vendas_data_status:');
  safeRun(`CREATE INDEX IF NOT EXISTS idx_vendas_tenant_id ON vendas(tenant_id)`, 'Erro ao criar idx_vendas_tenant_id:');
  safeRun(
    `CREATE INDEX IF NOT EXISTS idx_products_category_tenant_deleted ON products(category_id, tenant_id, deleted)`,
    'Erro ao criar idx_products_category_tenant_deleted:'
  );
  safeRun(
    `CREATE INDEX IF NOT EXISTS idx_stock_movements_created_at ON stock_movements(created_at)`,
    'Erro ao criar idx_stock_movements_created_at:'
  );
}
