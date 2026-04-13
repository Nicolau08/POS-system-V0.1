import path from 'path';
import { fileURLToPath } from 'url';
import sqlite3Import from 'sqlite3';
import { uuidv4 } from './cloudIdUtils.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sqlite3 = sqlite3Import.verbose();

const dbPath = path.join(__dirname, 'pos.db');
const db = new sqlite3.Database(dbPath);
db.configure('busyTimeout', 5000);

/** Repõe regras predefinidas quando a tabela está vazia (ex.: base antiga sem permission_rules). */
export function runPermissionRulesSeedIfEmpty(callback) {
  db.get(`SELECT COUNT(*) AS total FROM permission_rules`, (err, row) => {
    if (err) return callback(err);
    if ((row?.total ?? 0) > 0) return callback(null);

    const now = new Date().toISOString();
    const DEFAULT_RULES = [
      { key: 'gerenciamento.acesso', required_level: 0 },
      { key: 'painel.painel_controle', required_level: 0 },
      { key: 'gerenciamento.configuracoes', required_level: 0 },
      { key: 'gerenciamento.fechamento_diario', required_level: 0 },
      { key: 'gerenciamento.perfil_usuario', required_level: 0 },
      { key: 'gerenciamento.design_floor_plans', required_level: 0 },
      { key: 'painel.documentos', required_level: 0 },
      { key: 'painel.produtos', required_level: 0 },
      { key: 'painel.estoque', required_level: 0 },
      { key: 'painel.relatorios', required_level: 0 },
      { key: 'painel.clientes_fornecedores', required_level: 0 },
      { key: 'painel.promocoes_acoes', required_level: 0 },
      { key: 'painel.usuarios_seguranca', required_level: 0 },
      { key: 'painel.meios_pagamento', required_level: 0 },
      { key: 'painel.paises', required_level: 0 },
      { key: 'painel.taxas_impostos', required_level: 0 },
      { key: 'painel.minha_empresa', required_level: 0 },
      { key: 'estoque.inventario_rapido', required_level: 0 },
      { key: 'estoque.ver_preco_custo', required_level: 0 },
      { key: 'vendas.ver_pedidos_em_aberto', required_level: 0 },
      { key: 'vendas.cancelar_pedido', required_level: 0 },
      { key: 'vendas.cancelar_item', required_level: 0 },
      { key: 'vendas.bloquear_venda', required_level: 0 },
      { key: 'vendas.desbloquear_venda', required_level: 0 },
      { key: 'vendas.dividir_pedido', required_level: 0 },
      { key: 'vendas.aplicar_desconto', required_level: 0 },
      { key: 'vendas.apagar_documento', required_level: 0 },
      { key: 'vendas.devolucao', required_level: 0 },
      { key: 'vendas.override_taxes', required_level: 0 },
      { key: 'vendas.ver_historico_vendas', required_level: 0 },
      { key: 'vendas.reimprimir_recibo', required_level: 0 },
      { key: 'vendas.credit_payments', required_level: 0 },
      { key: 'vendas.abrir_caixa', required_level: 0 },
      { key: 'vendas.abrir_gaveta_dinheiro', required_level: 0 },
      { key: 'vendas.venda_estoque_zero', required_level: 0 },
    ];

    let completed = 0;
    const total = DEFAULT_RULES.length;
    for (const rule of DEFAULT_RULES) {
      db.run(
        `INSERT OR IGNORE INTO permission_rules (key, required_level, updated_at) VALUES (?, ?, ?)`,
        [rule.key, rule.required_level, now],
        () => {
          completed += 1;
          if (completed === total) {
            console.log(`[seed] permission_rules seeded (${DEFAULT_RULES.length})`);
            callback(null);
          }
        }
      );
    }
  });
}

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
      data TEXT NOT NULL,
      doc_type TEXT NOT NULL DEFAULT 'VD',
      doc_sequence INTEGER,
      status TEXT,
      customer_id TEXT,
      customer_name TEXT,
      payment_method TEXT,
      user_id TEXT,
      user_name TEXT,
      approved_document_type TEXT,
      approved_document_number TEXT
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
      surname TEXT,
      email TEXT,
      role TEXT NOT NULL,
      pin TEXT NOT NULL,
      access_level INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      cloud_id TEXT UNIQUE,
      updated_at TEXT
    )
  `);

  db.run(
    `
    CREATE TABLE IF NOT EXISTS permission_rules (
      key TEXT PRIMARY KEY,
      required_level INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `,
    (permErr) => {
      if (permErr) {
        console.error('[database] Falha ao criar permission_rules:', permErr.message);
      }
    }
  );

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
      user_id TEXT,
      user_name TEXT,
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
      updated_at TEXT,
      cloud_id TEXT
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS payment_methods (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      code TEXT NOT NULL UNIQUE,
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
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  safeRun(`CREATE INDEX IF NOT EXISTS idx_orders_customer_id ON orders(customer_id)`, 'Erro ao criar idx_orders_customer_id:');
  safeRun(`CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id)`, 'Erro ao criar idx_order_items_order_id:');
  safeRun(`CREATE INDEX IF NOT EXISTS idx_vendas_user_id ON vendas(user_id)`, 'Erro ao criar idx_vendas_user_id:');

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
  db.run(`ALTER TABLE users ADD COLUMN surname TEXT`, (err) => {
    if (err && !String(err.message || '').includes('duplicate column name')) {
      console.error('Erro ao adicionar coluna surname em users:', err.message);
    }
  });
  db.run(`ALTER TABLE users ADD COLUMN email TEXT`, (err) => {
    if (err && !String(err.message || '').includes('duplicate column name')) {
      console.error('Erro ao adicionar coluna email em users:', err.message);
    }
  });
  db.run(`ALTER TABLE users ADD COLUMN access_level INTEGER DEFAULT 0`, (err) => {
    if (err && !String(err.message || '').includes('duplicate column name')) {
      console.error('Erro ao adicionar coluna access_level em users:', err.message);
    }
  });
  db.run(`ALTER TABLE users ADD COLUMN active INTEGER DEFAULT 1`, (err) => {
    if (err && !String(err.message || '').includes('duplicate column name')) {
      console.error('Erro ao adicionar coluna active em users:', err.message);
    }
  });
  db.run(`ALTER TABLE vendas ADD COLUMN customer_id TEXT`, (err) => {
    if (err && !String(err.message || '').includes('duplicate column name')) {
      console.error('Erro ao adicionar coluna customer_id em vendas:', err.message);
    }
  });
  db.run(`ALTER TABLE vendas ADD COLUMN customer_name TEXT`, (err) => {
    if (err && !String(err.message || '').includes('duplicate column name')) {
      console.error('Erro ao adicionar coluna customer_name em vendas:', err.message);
    }
  });
  db.run(`ALTER TABLE vendas ADD COLUMN payment_method TEXT`, (err) => {
    if (err && !String(err.message || '').includes('duplicate column name')) {
      console.error('Erro ao adicionar coluna payment_method em vendas:', err.message);
    }
  });
  db.run(`ALTER TABLE vendas ADD COLUMN user_id TEXT`, (err) => {
    if (err && !String(err.message || '').includes('duplicate column name')) {
      console.error('Erro ao adicionar coluna user_id em vendas:', err.message);
    }
  });
  db.run(`ALTER TABLE vendas ADD COLUMN user_name TEXT`, (err) => {
    if (err && !String(err.message || '').includes('duplicate column name')) {
      console.error('Erro ao adicionar coluna user_name em vendas:', err.message);
    }
  });
  db.run(`ALTER TABLE vendas ADD COLUMN doc_type TEXT DEFAULT 'VD'`, (err) => {
    if (err && !String(err.message || '').includes('duplicate column name')) {
      console.error('Erro ao adicionar coluna doc_type em vendas:', err.message);
    }
  });
  db.run(`ALTER TABLE vendas ADD COLUMN doc_sequence INTEGER`, (err) => {
    if (err && !String(err.message || '').includes('duplicate column name')) {
      console.error('Erro ao adicionar coluna doc_sequence em vendas:', err.message);
    }
  });
  db.run(`ALTER TABLE vendas ADD COLUMN status TEXT`, (err) => {
    if (err && !String(err.message || '').includes('duplicate column name')) {
      console.error('Erro ao adicionar coluna status em vendas:', err.message);
    }
  });
  db.run(`ALTER TABLE vendas ADD COLUMN approved_document_type TEXT`, (err) => {
    if (err && !String(err.message || '').includes('duplicate column name')) {
      console.error('Erro ao adicionar coluna approved_document_type em vendas:', err.message);
    }
  });
  db.run(`ALTER TABLE vendas ADD COLUMN approved_document_number TEXT`, (err) => {
    if (err && !String(err.message || '').includes('duplicate column name')) {
      console.error('Erro ao adicionar coluna approved_document_number em vendas:', err.message);
    }
  });
  db.run(`ALTER TABLE orders ADD COLUMN user_id TEXT`, (err) => {
    if (err && !String(err.message || '').includes('duplicate column name')) {
      console.error('Erro ao adicionar coluna user_id em orders:', err.message);
    }
  });
  db.run(`ALTER TABLE orders ADD COLUMN user_name TEXT`, (err) => {
    if (err && !String(err.message || '').includes('duplicate column name')) {
      console.error('Erro ao adicionar coluna user_name em orders:', err.message);
    }
  });
  db.run(`ALTER TABLE orders ADD COLUMN doc_prefix TEXT`, (err) => {
    if (err && !String(err.message || '').includes('duplicate column name')) {
      console.error('Erro ao adicionar coluna doc_prefix em orders:', err.message);
    }
  });
  db.run(`ALTER TABLE orders ADD COLUMN doc_year INTEGER`, (err) => {
    if (err && !String(err.message || '').includes('duplicate column name')) {
      console.error('Erro ao adicionar coluna doc_year em orders:', err.message);
    }
  });
  db.run(`ALTER TABLE orders ADD COLUMN doc_sequence INTEGER`, (err) => {
    if (err && !String(err.message || '').includes('duplicate column name')) {
      console.error('Erro ao adicionar coluna doc_sequence em orders:', err.message);
    }
  });
  db.run(`ALTER TABLE orders ADD COLUMN approved_document_type TEXT`, (err) => {
    if (err && !String(err.message || '').includes('duplicate column name')) {
      console.error('Erro ao adicionar coluna approved_document_type em orders:', err.message);
    }
  });
  db.run(`ALTER TABLE orders ADD COLUMN approved_document_number TEXT`, (err) => {
    if (err && !String(err.message || '').includes('duplicate column name')) {
      console.error('Erro ao adicionar coluna approved_document_number em orders:', err.message);
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

  db.run(`ALTER TABLE order_items ADD COLUMN cloud_id TEXT`, (err) => {
    if (err && !String(err.message || '').includes('duplicate column name')) {
      console.error('Erro ao adicionar coluna cloud_id em order_items:', err.message);
    }
  });

  safeRun(
    `CREATE INDEX IF NOT EXISTS idx_order_items_cloud_id ON order_items(cloud_id)`,
    'Erro ao criar idx_order_items_cloud_id:'
  );
  safeRun(`CREATE INDEX IF NOT EXISTS idx_payment_methods_enabled ON payment_methods(enabled)`, 'Erro ao criar idx_payment_methods_enabled:');
  safeRun(`CREATE INDEX IF NOT EXISTS idx_payment_methods_position ON payment_methods(position)`, 'Erro ao criar idx_payment_methods_position:');
  safeRun(`CREATE INDEX IF NOT EXISTS idx_vendas_doc_type_seq ON vendas(doc_type, doc_sequence)`, 'Erro ao criar idx_vendas_doc_type_seq:');
  safeRun(`CREATE INDEX IF NOT EXISTS idx_orders_doc_prefix_year_seq ON orders(doc_prefix, doc_year, doc_sequence)`, 'Erro ao criar idx_orders_doc_prefix_year_seq:');

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

  db.all(
    `SELECT id, cloud_id FROM products WHERE cloud_id IS NULL OR TRIM(COALESCE(cloud_id, '')) = ''`,
    [],
    (backfillErr, rows) => {
      if (backfillErr) {
        console.error('Erro ao listar produtos para cloud_id:', backfillErr.message);
        return;
      }
      for (const row of rows ?? []) {
        const nextId = uuidv4();
        db.run(`UPDATE products SET cloud_id = ? WHERE id = ?`, [nextId, row.id], (runErr) => {
          if (runErr) console.error(`Erro ao definir cloud_id para produto ${row.id}:`, runErr.message);
        });
      }
      if ((rows ?? []).length > 0) {
        console.log(`[migrate] cloud_id atribuido a ${rows.length} produto(s) sem UUID.`);
      }
    }
  );

  db.all(
    `SELECT id FROM clientes WHERE cloud_id IS NULL OR TRIM(COALESCE(cloud_id, '')) = ''`,
    [],
    (backfillErr, rows) => {
      if (backfillErr) {
        console.error('Erro ao listar clientes para cloud_id:', backfillErr.message);
        return;
      }
      for (const row of rows ?? []) {
        const nextId = uuidv4();
        db.run(`UPDATE clientes SET cloud_id = ? WHERE id = ?`, [nextId, row.id], (runErr) => {
          if (runErr) console.error(`Erro ao definir cloud_id para cliente ${row.id}:`, runErr.message);
        });
      }
      if ((rows ?? []).length > 0) {
        console.log(`[migrate] cloud_id atribuido a ${rows.length} cliente(s) sem UUID.`);
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
        `INSERT INTO users (id, name, surname, email, role, pin, access_level, active) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        ['admin-1', 'Administrador', null, null, 'admin', '1234', 9, 1]
      );
    }
  });

  runPermissionRulesSeedIfEmpty((permSeedErr) => {
    if (permSeedErr) {
      console.error('Erro ao verificar permission_rules iniciais:', permSeedErr.message);
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
              (cloud_id, code, name, category_id, barcode, cost, price, tax, final_price, active, unit, is_service, default_quantity, stock_quantity, min_stock, color, image, created_at, updated_at)
             VALUES (?, ?, ?, (SELECT id FROM categories WHERE name = ? LIMIT 1), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              uuidv4(),
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
                  (cloud_id, code, name, category_id, barcode, cost, price, tax, final_price, active, unit, is_service, default_quantity, stock_quantity, min_stock, color, image, created_at, updated_at)
                 VALUES (?, ?, ?, (SELECT id FROM categories WHERE name = ? LIMIT 1), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                  uuidv4(),
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

  db.get(`SELECT COUNT(*) AS total FROM payment_methods`, (err, row) => {
    if (err) {
      console.error('Erro ao verificar meios de pagamento iniciais:', err.message);
      return;
    }

    if ((row?.total ?? 0) === 0) {
      const now = new Date().toISOString();
      const seedRows = [
        ['DINHEIRO', 'cash', '', 1, 1, 1, 0, 1, 1, 1, 1, now, now],
        ['CARTAO', 'card', '', 2, 1, 1, 0, 0, 1, 1, 0, now, now],
        ['PIX', 'pix', '', 3, 1, 1, 0, 0, 1, 1, 0, now, now],
      ];
      for (const seed of seedRows) {
        db.run(
          `INSERT OR IGNORE INTO payment_methods
            (name, code, shortcut, position, enabled, quick_payment, required_customer, allow_change, mark_as_paid, print_receipt, open_cash_drawer, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          seed
        );
      }
    }
  });
});

export default db;