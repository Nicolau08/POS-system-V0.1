const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const dbPath = path.join(__dirname, 'pos.db');
const db = new sqlite3.Database(dbPath);
db.configure('busyTimeout', 5000);

db.serialize(() => {
  const safeRun = (sql, errorLabel) => {
    db.run(sql, (err) => {
      if (!err) return;
      const message = String(err.message || '').toLowerCase();
      if (message.includes('duplicate column name')) return;
      if (message.includes('already exists')) return;
      if (message.includes('no such column')) return;
      console.error(errorLabel, err.message);
    });
  };

  db.run(`PRAGMA journal_mode = WAL`);
  db.run(`PRAGMA synchronous = NORMAL`);
  db.run(`PRAGMA foreign_keys = ON`);

  db.run(`
    CREATE TABLE IF NOT EXISTS vendas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      total REAL NOT NULL,
      data TEXT NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS clientes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      phone TEXT NOT NULL,
      email TEXT,
      address TEXT,
      cloud_id TEXT UNIQUE,
      updated_at TEXT
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      role TEXT NOT NULL,
      pin TEXT NOT NULL,
      cloud_id TEXT UNIQUE,
      updated_at TEXT
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      parent_id INTEGER,
      cloud_id TEXT UNIQUE,
      updated_at TEXT
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cloud_id TEXT UNIQUE,
      code INTEGER,
      name TEXT NOT NULL,
      category_id INTEGER,
      barcode TEXT,
      cost REAL DEFAULT 0,
      price REAL NOT NULL,
      tax REAL DEFAULT 0,
      final_price REAL DEFAULT 0,
      active INTEGER DEFAULT 1,
      unit TEXT DEFAULT 'un',
      description TEXT,
      age_restriction INTEGER,
      is_service INTEGER DEFAULT 0,
      default_quantity INTEGER DEFAULT 1,
      stock_quantity REAL DEFAULT 0,
      min_stock REAL DEFAULT 0,
      color TEXT,
      image TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

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
      product_id INTEGER NOT NULL,
      movement_type TEXT NOT NULL CHECK (movement_type IN ('sale', 'restock', 'adjustment')),
      quantity REAL NOT NULL,
      reference_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      customer_id TEXT,
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
      document_number TEXT,
      created_at TEXT,
      updated_at TEXT
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS order_items (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL,
      product_id TEXT,
      product_name TEXT NOT NULL,
      quantity REAL NOT NULL DEFAULT 0,
      price REAL NOT NULL DEFAULT 0,
      discount_amount REAL DEFAULT 0,
      created_at TEXT,
      updated_at TEXT
    )
  `);

  safeRun(`CREATE INDEX IF NOT EXISTS idx_orders_customer_id ON orders(customer_id)`, 'Erro ao criar idx_orders_customer_id:');
  safeRun(`CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id)`, 'Erro ao criar idx_order_items_order_id:');

  safeRun(
    `CREATE UNIQUE INDEX IF NOT EXISTS uq_stock_movements_local_ref
     ON stock_movements(product_id, movement_type, reference_id)`,
    'Erro ao criar indice uq_stock_movements_local_ref:'
  );
  safeRun(`CREATE INDEX IF NOT EXISTS idx_products_cloud_id ON products(cloud_id)`, 'Erro ao criar idx_products_cloud_id:');
  safeRun(`CREATE INDEX IF NOT EXISTS idx_categories_cloud_id ON categories(cloud_id)`, 'Erro ao criar idx_categories_cloud_id:');
  safeRun(`CREATE INDEX IF NOT EXISTS idx_clientes_cloud_id ON clientes(cloud_id)`, 'Erro ao criar idx_clientes_cloud_id:');
  safeRun(`CREATE INDEX IF NOT EXISTS idx_users_cloud_id ON users(cloud_id)`, 'Erro ao criar idx_users_cloud_id:');
  safeRun(`CREATE INDEX IF NOT EXISTS idx_products_updated_at ON products(updated_at)`, 'Erro ao criar idx_products_updated_at:');
  safeRun(`CREATE INDEX IF NOT EXISTS idx_categories_updated_at ON categories(updated_at)`, 'Erro ao criar idx_categories_updated_at:');
  safeRun(`CREATE INDEX IF NOT EXISTS idx_clientes_updated_at ON clientes(updated_at)`, 'Erro ao criar idx_clientes_updated_at:');
  safeRun(`CREATE INDEX IF NOT EXISTS idx_users_updated_at ON users(updated_at)`, 'Erro ao criar idx_users_updated_at:');
  safeRun(
    `CREATE INDEX IF NOT EXISTS idx_stock_movements_created_at ON stock_movements(created_at)`,
    'Erro ao criar idx_stock_movements_created_at:'
  );

  db.run(`
    CREATE TABLE IF NOT EXISTS sync_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL CHECK (type IN ('sale', 'product', 'stock', 'customer')),
      data TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'synced', 'failed', 'dead')),
      retries INTEGER NOT NULL DEFAULT 0,
      next_retry_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      synced_at TEXT
    )
  `);

  const ensureSyncQueueIndexes = (done = () => {}) => {
    const statements = [
      {
        sql: `CREATE INDEX IF NOT EXISTS idx_sync_queue_status_retry ON sync_queue(status, retries, next_retry_at, created_at)`,
        label: 'idx_sync_queue_status_retry',
      },
      { sql: `CREATE INDEX IF NOT EXISTS idx_sync_queue_type ON sync_queue(type)`, label: 'idx_sync_queue_type' },
      {
        sql: `CREATE INDEX IF NOT EXISTS idx_sync_queue_dedupe_pending ON sync_queue(type, dedupe_key, status)`,
        label: 'idx_sync_queue_dedupe_pending',
      },
      { sql: `CREATE INDEX IF NOT EXISTS idx_sync_queue_sync_ref ON sync_queue(sync_ref, status)`, label: 'idx_sync_queue_sync_ref' },
      {
        sql: `CREATE UNIQUE INDEX IF NOT EXISTS uq_sync_queue_sync_ref_active
              ON sync_queue(sync_ref)
              WHERE sync_ref IS NOT NULL AND status IN ('pending', 'failed', 'dead')`,
        label: 'uq_sync_queue_sync_ref_active',
      },
    ];

    const errors = [];
    const runNext = (index) => {
      if (index >= statements.length) {
        done(errors);
        return;
      }
      const current = statements[index];
      db.run(current.sql, (err) => {
        if (err) {
          errors.push(err);
          console.error(`Erro ao criar indice ${current.label}:`, err.message);
        }
        runNext(index + 1);
      });
    };

    runNext(0);
  };

  db.run(`
    CREATE TABLE IF NOT EXISTS sync_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      queue_id INTEGER,
      type TEXT NOT NULL,
      payload TEXT,
      error_message TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  db.run(`ALTER TABLE sync_queue ADD COLUMN dedupe_key TEXT`, (err) => {
    if (err && !String(err.message || '').includes('duplicate column name')) {
      console.error('Erro ao adicionar coluna dedupe_key em sync_queue:', err.message);
    }
  });

  db.run(`ALTER TABLE sync_queue ADD COLUMN lock_token TEXT`, (err) => {
    if (err && !String(err.message || '').includes('duplicate column name')) {
      console.error('Erro ao adicionar coluna lock_token em sync_queue:', err.message);
    }
  });

  db.run(`ALTER TABLE sync_queue ADD COLUMN locked_at TEXT`, (err) => {
    if (err && !String(err.message || '').includes('duplicate column name')) {
      console.error('Erro ao adicionar coluna locked_at em sync_queue:', err.message);
    }
  });

  db.run(`ALTER TABLE sync_queue ADD COLUMN sync_ref TEXT`, (err) => {
    if (err && !String(err.message || '').includes('duplicate column name')) {
      console.error('Erro ao adicionar coluna sync_ref em sync_queue:', err.message);
    }
  });

  db.run(`ALTER TABLE products ADD COLUMN cloud_id TEXT`, (err) => {
    if (err && !String(err.message || '').includes('duplicate column name')) {
      console.error('Erro ao adicionar coluna cloud_id em products:', err.message);
    }
  });
  db.run(`ALTER TABLE categories ADD COLUMN cloud_id TEXT`, (err) => {
    if (err && !String(err.message || '').includes('duplicate column name')) {
      console.error('Erro ao adicionar coluna cloud_id em categories:', err.message);
    }
  });
  db.run(`ALTER TABLE clientes ADD COLUMN cloud_id TEXT`, (err) => {
    if (err && !String(err.message || '').includes('duplicate column name')) {
      console.error('Erro ao adicionar coluna cloud_id em clientes:', err.message);
    }
  });
  db.run(`ALTER TABLE users ADD COLUMN cloud_id TEXT`, (err) => {
    if (err && !String(err.message || '').includes('duplicate column name')) {
      console.error('Erro ao adicionar coluna cloud_id em users:', err.message);
    }
  });
  db.run(`ALTER TABLE categories ADD COLUMN updated_at TEXT`, (err) => {
    if (err && !String(err.message || '').includes('duplicate column name')) {
      console.error('Erro ao adicionar coluna updated_at em categories:', err.message);
    }
  });
  db.run(`ALTER TABLE clientes ADD COLUMN updated_at TEXT`, (err) => {
    if (err && !String(err.message || '').includes('duplicate column name')) {
      console.error('Erro ao adicionar coluna updated_at em clientes:', err.message);
    }
  });
  db.run(`ALTER TABLE users ADD COLUMN updated_at TEXT`, (err) => {
    if (err && !String(err.message || '').includes('duplicate column name')) {
      console.error('Erro ao adicionar coluna updated_at em users:', err.message);
    }
  });

  // Retry index creation after ALTER statements for legacy databases.
  safeRun(`CREATE INDEX IF NOT EXISTS idx_products_cloud_id ON products(cloud_id)`, 'Erro ao criar idx_products_cloud_id:');
  safeRun(`CREATE INDEX IF NOT EXISTS idx_categories_cloud_id ON categories(cloud_id)`, 'Erro ao criar idx_categories_cloud_id:');
  safeRun(`CREATE INDEX IF NOT EXISTS idx_clientes_cloud_id ON clientes(cloud_id)`, 'Erro ao criar idx_clientes_cloud_id:');
  safeRun(`CREATE INDEX IF NOT EXISTS idx_users_cloud_id ON users(cloud_id)`, 'Erro ao criar idx_users_cloud_id:');
  safeRun(`CREATE INDEX IF NOT EXISTS idx_products_updated_at ON products(updated_at)`, 'Erro ao criar idx_products_updated_at:');
  safeRun(`CREATE INDEX IF NOT EXISTS idx_categories_updated_at ON categories(updated_at)`, 'Erro ao criar idx_categories_updated_at:');
  safeRun(`CREATE INDEX IF NOT EXISTS idx_clientes_updated_at ON clientes(updated_at)`, 'Erro ao criar idx_clientes_updated_at:');
  safeRun(`CREATE INDEX IF NOT EXISTS idx_users_updated_at ON users(updated_at)`, 'Erro ao criar idx_users_updated_at:');

  db.get(
    `SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'sync_queue'`,
    (schemaErr, row) => {
      if (schemaErr) {
        console.error('Erro ao verificar schema de sync_queue:', schemaErr.message);
        ensureSyncQueueIndexes();
        return;
      }

      const schemaSql = String(row?.sql || '').toLowerCase();
      if (!schemaSql.includes("'dead'")) {
        db.run('BEGIN TRANSACTION', (beginErr) => {
          if (beginErr) {
            console.error('Erro ao iniciar transacao de migracao de sync_queue:', beginErr.message);
            ensureSyncQueueIndexes();
            return;
          }

          const rollbackMigration = (errorMessage, originalError) => {
            console.error(errorMessage, originalError.message);
            db.run('ROLLBACK', (rollbackErr) => {
              if (
                rollbackErr &&
                !String(rollbackErr.message || '').toLowerCase().includes('no transaction is active')
              ) {
                console.error('Erro ao fazer rollback da migracao de sync_queue:', rollbackErr.message);
              }
              ensureSyncQueueIndexes();
            });
          };

          db.run(
            `CREATE TABLE IF NOT EXISTS sync_queue_v2 (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              type TEXT NOT NULL CHECK (type IN ('sale', 'product', 'stock', 'customer')),
              data TEXT NOT NULL,
              status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'synced', 'failed', 'dead')),
              retries INTEGER NOT NULL DEFAULT 0,
              next_retry_at TEXT,
              created_at TEXT NOT NULL DEFAULT (datetime('now')),
              updated_at TEXT NOT NULL DEFAULT (datetime('now')),
              synced_at TEXT,
              dedupe_key TEXT,
              lock_token TEXT,
              locked_at TEXT,
              sync_ref TEXT
            )`,
            (createErr) => {
              if (createErr) {
                rollbackMigration('Erro ao criar tabela sync_queue_v2:', createErr);
                return;
              }

              db.run(
                `INSERT INTO sync_queue_v2 (id, type, data, status, retries, next_retry_at, created_at, updated_at, synced_at, dedupe_key, lock_token, locked_at, sync_ref)
                 SELECT id, type, data, status, retries, next_retry_at, created_at, updated_at, synced_at, dedupe_key, lock_token, locked_at, sync_ref
                 FROM sync_queue`,
                (insertErr) => {
                  if (insertErr) {
                    rollbackMigration('Erro ao copiar dados para sync_queue_v2:', insertErr);
                    return;
                  }

                  db.run(`DROP TABLE sync_queue`, (dropErr) => {
                    if (dropErr) {
                      rollbackMigration('Erro ao remover tabela sync_queue antiga:', dropErr);
                      return;
                    }

                    db.run(`ALTER TABLE sync_queue_v2 RENAME TO sync_queue`, (renameErr) => {
                      if (renameErr) {
                        rollbackMigration('Erro ao renomear sync_queue_v2 para sync_queue:', renameErr);
                        return;
                      }

                      db.run('COMMIT', (commitErr) => {
                        if (commitErr) {
                          rollbackMigration('Erro ao migrar sync_queue para suporte dead-letter:', commitErr);
                          return;
                        }
                        ensureSyncQueueIndexes();
                      });
                    });
                  });
                }
              );
            }
          );
        });
      } else {
        ensureSyncQueueIndexes();
      }
    }
  );

  db.get(`SELECT COUNT(*) AS total FROM users`, (err, row) => {
    if (err) {
      console.error('Erro ao verificar usuarios iniciais:', err.message);
      return;
    }

    if ((row?.total ?? 0) === 0) {
      db.run(
        `INSERT INTO users (id, name, role, pin) VALUES (?, ?, ?, ?)`,
        ['admin-1', 'Administrador', 'admin', '1234']
      );
    }
  });

  db.get(`SELECT COUNT(*) AS total FROM categories`, (err, row) => {
    if (err) {
      console.error('Erro ao verificar categorias iniciais:', err.message);
      return;
    }

    if ((row?.total ?? 0) === 0) {
      ['Bebidas', 'Comidas', 'Petiscos', 'Sobremesas'].forEach((name) => {
        db.run(`INSERT OR IGNORE INTO categories (name) VALUES (?)`, [name]);
      });
    }
  });

  db.get(`SELECT COUNT(*) AS total FROM products`, (err, row) => {
    if (err) {
      console.error('Erro ao verificar produtos iniciais:', err.message);
      return;
    }

    if ((row?.total ?? 0) === 0) {
      db.run(
        `INSERT OR IGNORE INTO categories (name) VALUES (?), (?), (?), (?)`,
        ['Bebidas', 'Comidas', 'Petiscos', 'Sobremesas'],
        (categoriesErr) => {
          if (categoriesErr) {
            console.error('Erro ao preparar categorias iniciais para produtos:', categoriesErr.message);
            return;
          }

          db.run(
            `INSERT INTO products
              (code, name, category_id, barcode, cost, price, tax, final_price, active, unit, is_service, default_quantity, stock_quantity, min_stock, color, image, created_at, updated_at)
             VALUES (?, ?, (SELECT id FROM categories WHERE name = ? LIMIT 1), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              1,
              'Coca-Cola',
              'Bebidas',
              null,
              0,
              50,
              0,
              50,
              1,
              'un',
              0,
              1,
              20,
              5,
              '#ff0000',
              '',
              new Date().toISOString(),
              new Date().toISOString(),
            ],
            (productOneErr) => {
              if (productOneErr) {
                console.error('Erro ao inserir produto inicial Coca-Cola:', productOneErr.message);
                return;
              }

              db.run(
                `INSERT INTO products
                  (code, name, category_id, barcode, cost, price, tax, final_price, active, unit, is_service, default_quantity, stock_quantity, min_stock, color, image, created_at, updated_at)
                 VALUES (?, ?, (SELECT id FROM categories WHERE name = ? LIMIT 1), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                  2,
                  'Água',
                  'Bebidas',
                  null,
                  0,
                  25,
                  0,
                  25,
                  1,
                  'un',
                  0,
                  1,
                  50,
                  10,
                  '#00aaff',
                  '',
                  new Date().toISOString(),
                  new Date().toISOString(),
                ],
                (productTwoErr) => {
                  if (productTwoErr) {
                    console.error('Erro ao inserir produto inicial Água:', productTwoErr.message);
                  }
                }
              );
            }
          );
        }
      );
    }
  });
});

module.exports = db;