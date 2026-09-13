/**
 * Esquema: categorias, taxas de imposto, produtos e linhas de BOM (kits/receitas).
 * Extraído de database.js — mesma ordem/SQL, sem alterações de comportamento.
 */
export function defineCatalogSchema(db, { safeRun }) {
  db.run(`
    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      parent_id INTEGER,
      cloud_id TEXT UNIQUE,
      updated_at TEXT,
      tenant_id TEXT NOT NULL,
      color TEXT
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS deleted_category_tombstones (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cloud_id TEXT,
      name TEXT,
      deleted_at TEXT NOT NULL DEFAULT (datetime('now')),
      tenant_id TEXT NOT NULL
    )
  `);
  safeRun(
    `CREATE INDEX IF NOT EXISTS idx_deleted_category_tombstones_cloud_id
     ON deleted_category_tombstones(cloud_id)`,
    'Erro ao criar idx_deleted_category_tombstones_cloud_id:'
  );
  safeRun(
    `CREATE INDEX IF NOT EXISTS idx_deleted_category_tombstones_name
     ON deleted_category_tombstones(name)`,
    'Erro ao criar idx_deleted_category_tombstones_name:'
  );

  db.run(`
    CREATE TABLE IF NOT EXISTS tax_rates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL,
      name TEXT NOT NULL,
      code TEXT NOT NULL,
      rate REAL NOT NULL DEFAULT 0,
      is_fixed INTEGER NOT NULL DEFAULT 0,
      price_includes_tax INTEGER NOT NULL DEFAULT 1,
      is_default INTEGER NOT NULL DEFAULT 0,
      enabled INTEGER NOT NULL DEFAULT 1,
      is_system INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cloud_id TEXT UNIQUE,
      tenant_id TEXT NOT NULL,
      code INTEGER,
      name TEXT NOT NULL,
      category_id INTEGER,
      barcode TEXT,
      cost REAL DEFAULT 0,
      price REAL NOT NULL,
      tax_rate_id INTEGER,
      tax REAL DEFAULT 0,
      final_price REAL DEFAULT 0,
      active INTEGER DEFAULT 1,
      unit TEXT DEFAULT 'un',
      description TEXT,
      age_restriction INTEGER,
      is_service INTEGER DEFAULT 0,
      product_kind TEXT NOT NULL DEFAULT 'simple',
      default_quantity INTEGER DEFAULT 1,
      stock_quantity REAL DEFAULT 0,
      min_stock REAL DEFAULT 0,
      color TEXT,
      image TEXT,
      deleted INTEGER DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS product_bom_lines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL,
      parent_product_id INTEGER NOT NULL,
      component_product_id INTEGER NOT NULL,
      quantity REAL NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
}
