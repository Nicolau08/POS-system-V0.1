import path from 'path';
import { fileURLToPath } from 'url';
import { uuidv4 } from './cloudIdUtils.js';
import { ensureHashedPin } from './pinAuth.js';
import { buildDefaultPaymentMethodInsertRows } from './constants/paymentMethodDefaults.js';
import { resolveDatabasePathAfterMigration } from './utils/dbPaths.js';
import { openSqliteDatabase } from './utils/dbEncryption.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const dbPath = resolveDatabasePathAfterMigration();
if (process.env.POS_DEV_TENANT || process.env.POS_DB_PATH) {
  console.log(`[database] SQLite: ${dbPath}`);
}

const { db } = await openSqliteDatabase(dbPath);
const DEFAULT_TENANT_ID = String(
  process.env.DEFAULT_TENANT_ID || process.env.POS_DEV_TENANT || 'tenant-1'
).trim() || 'tenant-1';
const DEFAULT_TENANT_NAME = String(
  process.env.DEFAULT_TENANT_NAME || process.env.POS_DEV_TENANT_NAME || 'Default Tenant'
).trim() || 'Default Tenant';

export function getOrCreateDefaultTenantId() {
  return new Promise((resolve, reject) => {
    db.run(
      `CREATE TABLE IF NOT EXISTS tenants (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`,
      (tableErr) => {
        if (tableErr) return reject(tableErr);
        db.run(
          `INSERT OR IGNORE INTO tenants (id, name, created_at)
           VALUES (?, ?, datetime('now'))`,
          [DEFAULT_TENANT_ID, 'Default Tenant'],
          (insertErr) => {
            if (insertErr) return reject(insertErr);
            resolve(DEFAULT_TENANT_ID);
          }
        );
      }
    );
  });
}

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
      { key: 'painel.relatorios', required_level: 5 },
      { key: 'painel.clientes_fornecedores', required_level: 0 },
      { key: 'painel.promocoes_acoes', required_level: 0 },
      { key: 'painel.usuarios_seguranca', required_level: 0 },
      { key: 'painel.meios_pagamento', required_level: 0 },
      { key: 'painel.taxas_impostos', required_level: 0 },
      { key: 'painel.minha_empresa', required_level: 0 },
      { key: 'painel.emitir_serie', required_level: 9 },
      { key: 'painel.logs_sistema', required_level: 7 },
      { key: 'estoque.inventario_rapido', required_level: 0 },
      { key: 'estoque.ver_preco_custo', required_level: 0 },
      { key: 'vendas.ver_pedidos_em_aberto', required_level: 0 },
      { key: 'vendas.abrir_mesa_outro', required_level: 5 },
      { key: 'vendas.cancelar_pedido', required_level: 0 },
      { key: 'vendas.cancelar_item', required_level: 0 },
      { key: 'vendas.anular_item_enviado', required_level: 5 },
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

  const tenantScopedTables = [
    'products',
    'users',
    'clientes',
    'vendas',
    'orders',
    'categories',
    'deleted_category_tombstones',
    'payment_methods',
    'order_items',
    'stock_movements',
  ];

  const ensureTenantGuards = () => {
    for (const tableName of tenantScopedTables) {
      safeRun(
        `CREATE TRIGGER IF NOT EXISTS trg_${tableName}_tenant_insert
         BEFORE INSERT ON ${tableName}
         FOR EACH ROW
         WHEN NEW.tenant_id IS NULL OR TRIM(COALESCE(NEW.tenant_id, '')) = ''
         BEGIN
           SELECT RAISE(ABORT, 'tenant_id_required_${tableName}');
         END`,
        `Erro ao criar trigger de tenant INSERT em ${tableName}:`
      );
      safeRun(
        `CREATE TRIGGER IF NOT EXISTS trg_${tableName}_tenant_update
         BEFORE UPDATE ON ${tableName}
         FOR EACH ROW
         WHEN NEW.tenant_id IS NULL OR TRIM(COALESCE(NEW.tenant_id, '')) = ''
         BEGIN
           SELECT RAISE(ABORT, 'tenant_id_required_${tableName}');
         END`,
        `Erro ao criar trigger de tenant UPDATE em ${tableName}:`
      );
    }
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
      tenant_id TEXT NOT NULL,
      approved_document_type TEXT,
      approved_document_number TEXT,
      register_code TEXT
    )
  `);
  db.run(`ALTER TABLE vendas ADD COLUMN register_code TEXT`, () => {});

  db.run(`
    CREATE TABLE IF NOT EXISTS clientes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      phone TEXT NOT NULL,
      email TEXT,
      address TEXT,
      tenant_id TEXT NOT NULL,
      cloud_id TEXT UNIQUE,
      updated_at TEXT
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS tenants (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS tenant_profile (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      nuit TEXT,
      license_type TEXT,
      commerce_type TEXT DEFAULT 'retalho',
      created_at TEXT,
      updated_at TEXT
    )
  `);
  db.run(`ALTER TABLE tenant_profile ADD COLUMN commerce_type TEXT DEFAULT 'retalho'`, (err) => {
    if (err && !String(err.message || '').includes('duplicate column name')) {
      console.error('Erro ao adicionar commerce_type em tenant_profile:', err.message);
    }
  });
  db.run(`ALTER TABLE tenant_profile ADD COLUMN vertical TEXT DEFAULT NULL`, (err) => {
    if (err && !String(err.message || '').includes('duplicate column name')) {
      console.error('Erro ao adicionar vertical em tenant_profile:', err.message);
    }
  });
  db.run(`ALTER TABLE tenant_profile ADD COLUMN capabilities_json TEXT DEFAULT NULL`, (err) => {
    if (err && !String(err.message || '').includes('duplicate column name')) {
      console.error('Erro ao adicionar capabilities_json em tenant_profile:', err.message);
    }
  });

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
      is_system INTEGER NOT NULL DEFAULT 0,
      tenant_id TEXT NOT NULL,
      cloud_id TEXT UNIQUE,
      updated_at TEXT
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      action TEXT NOT NULL,
      entity TEXT,
      entity_id TEXT,
      details TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  db.run(`CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id)`);

  db.run(`
    CREATE TABLE IF NOT EXISTS app_logs (
      id TEXT PRIMARY KEY,
      level TEXT NOT NULL,
      event TEXT NOT NULL,
      message TEXT NOT NULL,
      source TEXT,
      module TEXT,
      action TEXT,
      reason TEXT,
      user_id TEXT,
      user_name TEXT,
      tenant_id TEXT,
      request_id TEXT,
      entity TEXT,
      entity_id TEXT,
      payload_json TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  db.run(`CREATE INDEX IF NOT EXISTS idx_app_logs_created_at ON app_logs(created_at)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_app_logs_level ON app_logs(level)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_app_logs_event ON app_logs(event)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_app_logs_user_id ON app_logs(user_id)`);

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

  db.run(
    `INSERT OR IGNORE INTO permission_rules (key, required_level, updated_at) VALUES ('painel.emitir_serie', 9, datetime('now'))`,
    (emitRuleErr) => {
      if (emitRuleErr && !String(emitRuleErr.message || '').includes('no such table')) {
        console.error('[database] Falha ao garantir regra painel.emitir_serie:', emitRuleErr.message);
      }
    }
  );

  db.run(
    `INSERT OR IGNORE INTO permission_rules (key, required_level, updated_at) VALUES ('painel.logs_sistema', 7, datetime('now'))`,
    (logsRuleErr) => {
      if (logsRuleErr && !String(logsRuleErr.message || '').includes('no such table')) {
        console.error('[database] Falha ao garantir regra painel.logs_sistema:', logsRuleErr.message);
      }
    }
  );

  db.run(
    `INSERT OR IGNORE INTO permission_rules (key, required_level, updated_at) VALUES ('vendas.abrir_mesa_outro', 5, datetime('now'))`,
    (openOtherErr) => {
      if (openOtherErr && !String(openOtherErr.message || '').includes('no such table')) {
        console.error('[database] Falha ao garantir regra vendas.abrir_mesa_outro:', openOtherErr.message);
      }
    }
  );

  db.run(
    `INSERT OR IGNORE INTO permission_rules (key, required_level, updated_at) VALUES ('vendas.anular_item_enviado', 5, datetime('now'))`,
    (voidSentErr) => {
      if (voidSentErr && !String(voidSentErr.message || '').includes('no such table')) {
        console.error('[database] Falha ao garantir regra vendas.anular_item_enviado:', voidSentErr.message);
      }
    }
  );

  // Relatórios expõem PII (clientes, dívidas): mínimo nível 5 em bases já existentes.
  db.run(
    `UPDATE permission_rules
     SET required_level = 5, updated_at = datetime('now')
     WHERE key = 'painel.relatorios' AND required_level < 5`,
    (reportsHardeningErr) => {
      if (reportsHardeningErr && !String(reportsHardeningErr.message || '').includes('no such table')) {
        console.error(
          '[database] Falha ao endurecer regra painel.relatorios:',
          reportsHardeningErr.message,
        );
      }
    }
  );

  db.run(
    `INSERT OR IGNORE INTO permission_rules (key, required_level, updated_at) VALUES ('painel.relatorios', 5, datetime('now'))`,
    (reportsSeedErr) => {
      if (reportsSeedErr && !String(reportsSeedErr.message || '').includes('no such table')) {
        console.error('[database] Falha ao garantir regra painel.relatorios:', reportsSeedErr.message);
      }
    }
  );

  db.run(`DELETE FROM permission_rules WHERE key = 'painel.paises'`, (delPaisesErr) => {
    if (delPaisesErr && !String(delPaisesErr.message || '').includes('no such table')) {
      console.error('[database] Falha ao remover regra painel.paises:', delPaisesErr.message);
    }
  });

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
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
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

  db.run(`
    CREATE TABLE IF NOT EXISTS sync_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('sale', 'product', 'stock', 'customer', 'category')),
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
        sql: `CREATE INDEX IF NOT EXISTS idx_sync_queue_tenant_status_retry ON sync_queue(tenant_id, status, retries, next_retry_at, created_at)`,
        label: 'idx_sync_queue_status_retry',
      },
      { sql: `CREATE INDEX IF NOT EXISTS idx_sync_queue_tenant_type ON sync_queue(tenant_id, type)`, label: 'idx_sync_queue_type' },
      {
        sql: `CREATE INDEX IF NOT EXISTS idx_sync_queue_tenant_dedupe_pending ON sync_queue(tenant_id, type, dedupe_key, status)`,
        label: 'idx_sync_queue_dedupe_pending',
      },
      { sql: `CREATE INDEX IF NOT EXISTS idx_sync_queue_tenant_sync_ref ON sync_queue(tenant_id, sync_ref, status)`, label: 'idx_sync_queue_sync_ref' },
      {
        sql: `CREATE UNIQUE INDEX IF NOT EXISTS uq_sync_queue_sync_ref_active
              ON sync_queue(tenant_id, sync_ref)
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
      tenant_id TEXT,
      type TEXT NOT NULL,
      payload TEXT,
      error_message TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  db.run(`ALTER TABLE sync_logs ADD COLUMN tenant_id TEXT`, (err) => {
    if (err && !String(err.message || '').includes('duplicate column name')) {
      console.error('Erro ao adicionar coluna tenant_id em sync_logs:', err.message);
    }
  });

  db.run(`
    CREATE TABLE IF NOT EXISTS checkout_idempotency (
      tenant_id TEXT NOT NULL,
      idempotency_key TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'processing' CHECK (status IN ('processing', 'completed', 'failed')),
      sale_id INTEGER,
      response_json TEXT,
      error_message TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (tenant_id, idempotency_key)
    )
  `);
  safeRun(
    `CREATE INDEX IF NOT EXISTS idx_checkout_idempotency_status_updated
     ON checkout_idempotency(status, updated_at)`,
    'Erro ao criar idx_checkout_idempotency_status_updated:'
  );

  db.run(`
    CREATE TABLE IF NOT EXISTS pos_open_drafts (
      tenant_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (tenant_id, user_id)
    )
  `);
  safeRun(
    `CREATE INDEX IF NOT EXISTS idx_pos_open_drafts_updated
     ON pos_open_drafts(updated_at)`,
    'Erro ao criar idx_pos_open_drafts_updated:'
  );

  db.run(`
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
  safeRun(
    `CREATE INDEX IF NOT EXISTS idx_pos_table_orders_updated
     ON pos_table_orders(tenant_id, updated_at)`,
    'Erro ao criar idx_pos_table_orders_updated:'
  );

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

  db.run(`ALTER TABLE sync_queue ADD COLUMN tenant_id TEXT`, (err) => {
    if (err && !String(err.message || '').includes('duplicate column name')) {
      console.error('Erro ao adicionar coluna tenant_id em sync_queue:', err.message);
    }
  });

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
  db.run(
    `UPDATE sync_queue
     SET tenant_id = COALESCE(NULLIF(TRIM(json_extract(data, '$.tenant_id')), ''), '__missing_tenant__')
     WHERE tenant_id IS NULL OR TRIM(COALESCE(tenant_id, '')) = ''`,
    (err) => {
      if (err) {
        console.error('Erro ao atualizar tenant_id em sync_queue:', err.message);
      }
    }
  );

  db.run(`ALTER TABLE products ADD COLUMN cloud_id TEXT`, (err) => {
    if (err && !String(err.message || '').includes('duplicate column name')) {
      console.error('Erro ao adicionar coluna cloud_id em products:', err.message);
    }
  });
  db.run(`ALTER TABLE products ADD COLUMN tenant_id TEXT`, (err) => {
    if (err && !String(err.message || '').includes('duplicate column name')) {
      console.error('Erro ao adicionar coluna tenant_id em products:', err.message);
    }
  });
  db.run(`ALTER TABLE products ADD COLUMN deleted INTEGER DEFAULT 0`, (err) => {
    if (err && !String(err.message || '').includes('duplicate column name')) {
      console.error('Erro ao adicionar coluna deleted em products:', err.message);
    }
  });
  db.run(`ALTER TABLE products ADD COLUMN tax_rate_id INTEGER`, (err) => {
    if (err && !String(err.message || '').includes('duplicate column name')) {
      console.error('Erro ao adicionar coluna tax_rate_id em products:', err.message);
    }
    safeRun(
      `CREATE INDEX IF NOT EXISTS idx_products_tax_rate_id ON products(tax_rate_id)`,
      'Erro ao criar idx_products_tax_rate_id:'
    );
  });
  db.run(`ALTER TABLE products ADD COLUMN product_kind TEXT DEFAULT 'simple'`, (err) => {
    if (err && !String(err.message || '').includes('duplicate column name')) {
      console.error('Erro ao adicionar coluna product_kind em products:', err.message);
    }
    db.run(
      `UPDATE products SET product_kind = 'simple' WHERE product_kind IS NULL OR TRIM(COALESCE(product_kind, '')) = ''`,
      (updateErr) => {
        if (updateErr) {
          console.error('Erro ao normalizar product_kind em products:', updateErr.message);
        }
      }
    );
    db.run(
      `UPDATE products
       SET product_kind = 'service'
       WHERE COALESCE(is_service, 0) = 1
         AND COALESCE(product_kind, 'simple') = 'simple'
         AND COALESCE(deleted, 0) = 0`,
      (updateErr) => {
        if (updateErr) {
          console.error('Erro ao migrar serviços para product_kind=service:', updateErr.message);
        }
      }
    );
    safeRun(
      `CREATE INDEX IF NOT EXISTS idx_products_product_kind ON products(product_kind)`,
      'Erro ao criar idx_products_product_kind:'
    );
  });
  db.run(`ALTER TABLE tax_rates ADD COLUMN price_includes_tax INTEGER DEFAULT 1`, (err) => {
    if (err && !String(err.message || '').includes('duplicate column name')) {
      console.error('Erro ao adicionar coluna price_includes_tax em tax_rates:', err.message);
    }
    db.run(
      `UPDATE tax_rates SET price_includes_tax = 1 WHERE price_includes_tax IS NULL`,
      (updateErr) => {
        if (updateErr) {
          console.error('Erro ao normalizar price_includes_tax em tax_rates:', updateErr.message);
        }
      }
    );
  });
  db.run(`ALTER TABLE tax_rates ADD COLUMN is_default INTEGER DEFAULT 0`, (err) => {
    if (err && !String(err.message || '').includes('duplicate column name')) {
      console.error('Erro ao adicionar coluna is_default em tax_rates:', err.message);
    }
    db.run(
      `UPDATE tax_rates SET is_default = 0 WHERE is_default IS NULL`,
      (updateErr) => {
        if (updateErr) {
          console.error('Erro ao normalizar is_default em tax_rates:', updateErr.message);
        }
      }
    );
  });
  db.run(`UPDATE products SET deleted = 0 WHERE deleted IS NULL`, (err) => {
    if (err) {
      console.error('Erro ao normalizar deleted em products:', err.message);
    }
  });
  db.run(`ALTER TABLE categories ADD COLUMN cloud_id TEXT`, (err) => {
    if (err && !String(err.message || '').includes('duplicate column name')) {
      console.error('Erro ao adicionar coluna cloud_id em categories:', err.message);
    }
  });
  db.run(`ALTER TABLE categories ADD COLUMN tenant_id TEXT`, (err) => {
    if (err && !String(err.message || '').includes('duplicate column name')) {
      console.error('Erro ao adicionar coluna tenant_id em categories:', err.message);
    }
  });
  db.run(`ALTER TABLE categories ADD COLUMN color TEXT`, (err) => {
    if (err && !String(err.message || '').includes('duplicate column name')) {
      console.error('Erro ao adicionar coluna color em categories:', err.message);
    }
  });
  db.run(`ALTER TABLE deleted_category_tombstones ADD COLUMN tenant_id TEXT`, (err) => {
    if (err && !String(err.message || '').includes('duplicate column name')) {
      console.error('Erro ao adicionar coluna tenant_id em deleted_category_tombstones:', err.message);
    }
  });
  db.run(`ALTER TABLE clientes ADD COLUMN cloud_id TEXT`, (err) => {
    if (err && !String(err.message || '').includes('duplicate column name')) {
      console.error('Erro ao adicionar coluna cloud_id em clientes:', err.message);
    }
  });
  db.run(`ALTER TABLE clientes ADD COLUMN tenant_id TEXT`, (err) => {
    if (err && !String(err.message || '').includes('duplicate column name')) {
      console.error('Erro ao adicionar coluna tenant_id em clientes:', err.message);
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
  db.run(`ALTER TABLE users ADD COLUMN tenant_id TEXT`, (err) => {
    if (err && !String(err.message || '').includes('duplicate column name')) {
      console.error('Erro ao adicionar coluna tenant_id em users:', err.message);
    }
  });
  db.run(`ALTER TABLE users ADD COLUMN is_system INTEGER DEFAULT 0`, (err) => {
    if (err && !String(err.message || '').includes('duplicate column name')) {
      console.error('Erro ao adicionar coluna is_system em users:', err.message);
    }
  });
  db.run(
    `UPDATE users
     SET is_system = 1
     WHERE LOWER(COALESCE(role, '')) = 'admin'`,
    (err) => {
      if (err) {
        console.error('Erro ao marcar usuarios admin como sistema:', err.message);
      }
    }
  );
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
  db.run(`ALTER TABLE vendas ADD COLUMN tenant_id TEXT`, (err) => {
    if (err && !String(err.message || '').includes('duplicate column name')) {
      console.error('Erro ao adicionar coluna tenant_id em vendas:', err.message);
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
  db.run(`ALTER TABLE orders ADD COLUMN external_document TEXT`, (err) => {
    if (err && !String(err.message || '').includes('duplicate column name')) {
      console.error('Erro ao adicionar coluna external_document em orders:', err.message);
    }
  });
  db.run(`ALTER TABLE orders ADD COLUMN notes TEXT`, (err) => {
    if (err && !String(err.message || '').includes('duplicate column name')) {
      console.error('Erro ao adicionar coluna notes em orders:', err.message);
    }
  });
  db.run(`ALTER TABLE orders ADD COLUMN is_waste INTEGER NOT NULL DEFAULT 0`, (err) => {
    if (err && !String(err.message || '').includes('duplicate column name')) {
      console.error('Erro ao adicionar coluna is_waste em orders:', err.message);
    }
  });
  db.run(`ALTER TABLE orders ADD COLUMN tenant_id TEXT`, (err) => {
    if (err && !String(err.message || '').includes('duplicate column name')) {
      console.error('Erro ao adicionar coluna tenant_id em orders:', err.message);
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
  db.run(`ALTER TABLE order_items ADD COLUMN tenant_id TEXT`, (err) => {
    if (err && !String(err.message || '').includes('duplicate column name')) {
      console.error('Erro ao adicionar coluna tenant_id em order_items:', err.message);
    }
  });
  db.run(`ALTER TABLE stock_movements ADD COLUMN tenant_id TEXT`, (err) => {
    if (err && !String(err.message || '').includes('duplicate column name')) {
      console.error('Erro ao adicionar coluna tenant_id em stock_movements:', err.message);
    }
  });
  db.run(`ALTER TABLE payment_methods ADD COLUMN tenant_id TEXT`, (err) => {
    if (err && !String(err.message || '').includes('duplicate column name')) {
      console.error('Erro ao adicionar coluna tenant_id em payment_methods:', err.message);
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
  safeRun(`CREATE INDEX IF NOT EXISTS idx_products_tenant_id ON products(tenant_id)`, 'Erro ao criar idx_products_tenant_id:');
  safeRun(`CREATE INDEX IF NOT EXISTS idx_categories_tenant_id ON categories(tenant_id)`, 'Erro ao criar idx_categories_tenant_id:');
  safeRun(
    `CREATE INDEX IF NOT EXISTS idx_deleted_category_tombstones_tenant_id ON deleted_category_tombstones(tenant_id)`,
    'Erro ao criar idx_deleted_category_tombstones_tenant_id:'
  );
  safeRun(`CREATE INDEX IF NOT EXISTS idx_order_items_tenant_id ON order_items(tenant_id)`, 'Erro ao criar idx_order_items_tenant_id:');
  safeRun(`CREATE INDEX IF NOT EXISTS idx_stock_movements_tenant_id ON stock_movements(tenant_id)`, 'Erro ao criar idx_stock_movements_tenant_id:');
  safeRun(`CREATE INDEX IF NOT EXISTS idx_payment_methods_tenant_id ON payment_methods(tenant_id)`, 'Erro ao criar idx_payment_methods_tenant_id:');
  safeRun(`CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_methods_tenant_code ON payment_methods(tenant_id, code)`, 'Erro ao criar uq_payment_methods_tenant_code:');
  safeRun(`CREATE INDEX IF NOT EXISTS idx_categories_cloud_id ON categories(cloud_id)`, 'Erro ao criar idx_categories_cloud_id:');
  safeRun(`CREATE INDEX IF NOT EXISTS idx_clientes_cloud_id ON clientes(cloud_id)`, 'Erro ao criar idx_clientes_cloud_id:');
  safeRun(`CREATE INDEX IF NOT EXISTS idx_users_cloud_id ON users(cloud_id)`, 'Erro ao criar idx_users_cloud_id:');
  safeRun(`CREATE INDEX IF NOT EXISTS idx_products_updated_at ON products(updated_at)`, 'Erro ao criar idx_products_updated_at:');
  safeRun(`CREATE INDEX IF NOT EXISTS idx_products_deleted ON products(deleted)`, 'Erro ao criar idx_products_deleted:');
  safeRun(`CREATE INDEX IF NOT EXISTS idx_categories_updated_at ON categories(updated_at)`, 'Erro ao criar idx_categories_updated_at:');
  safeRun(`CREATE UNIQUE INDEX IF NOT EXISTS uq_categories_tenant_name ON categories(tenant_id, name)`, 'Erro ao criar uq_categories_tenant_name:');
  safeRun(`CREATE INDEX IF NOT EXISTS idx_categories_parent_id ON categories(parent_id)`, 'Erro ao criar idx_categories_parent_id:');
  safeRun(`CREATE INDEX IF NOT EXISTS idx_clientes_updated_at ON clientes(updated_at)`, 'Erro ao criar idx_clientes_updated_at:');
  safeRun(`CREATE INDEX IF NOT EXISTS idx_clientes_tenant_id ON clientes(tenant_id)`, 'Erro ao criar idx_clientes_tenant_id:');
  safeRun(`CREATE INDEX IF NOT EXISTS idx_clientes_tenant_name ON clientes(tenant_id, name)`, 'Erro ao criar idx_clientes_tenant_name:');
  safeRun(`CREATE INDEX IF NOT EXISTS idx_users_updated_at ON users(updated_at)`, 'Erro ao criar idx_users_updated_at:');
  safeRun(`CREATE INDEX IF NOT EXISTS idx_users_tenant_id ON users(tenant_id)`, 'Erro ao criar idx_users_tenant_id:');
  safeRun(`CREATE INDEX IF NOT EXISTS idx_vendas_tenant_id ON vendas(tenant_id)`, 'Erro ao criar idx_vendas_tenant_id:');
  safeRun(
    `CREATE INDEX IF NOT EXISTS idx_products_category_tenant_deleted ON products(category_id, tenant_id, deleted)`,
    'Erro ao criar idx_products_category_tenant_deleted:'
  );

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

  db.get(
    `SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'sync_queue'`,
    (schemaErr, row) => {
      if (schemaErr) {
        console.error('Erro ao verificar schema de sync_queue:', schemaErr.message);
        ensureSyncQueueIndexes();
        return;
      }

      const schemaSql = String(row?.sql || '').toLowerCase();
      if (!schemaSql.includes("'dead'") || !schemaSql.includes("'category'")) {
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
              tenant_id TEXT NOT NULL,
              type TEXT NOT NULL CHECK (type IN ('sale', 'product', 'stock', 'customer', 'category')),
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
                `INSERT INTO sync_queue_v2 (id, tenant_id, type, data, status, retries, next_retry_at, created_at, updated_at, synced_at, dedupe_key, lock_token, locked_at, sync_ref)
                 SELECT
                   id,
                   COALESCE(NULLIF(TRIM(json_extract(data, '$.tenant_id')), ''), '__missing_tenant__'),
                   type, data, status, retries, next_retry_at, created_at, updated_at, synced_at, dedupe_key, lock_token, locked_at, sync_ref
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

  getOrCreateDefaultTenantId()
    .then((defaultTenantId) => {
      db.run(
        `UPDATE products
         SET tenant_id = ?
         WHERE tenant_id IS NULL OR TRIM(COALESCE(tenant_id, '')) = ''`,
        [defaultTenantId],
        (tenantBackfillErr) => {
          if (tenantBackfillErr) {
            console.error('Erro ao atualizar tenant_id padrao em products:', tenantBackfillErr.message);
          }
        }
      );

      db.run(
        `UPDATE users
         SET tenant_id = ?
         WHERE tenant_id IS NULL OR TRIM(COALESCE(tenant_id, '')) = ''`,
        [defaultTenantId],
        (tenantBackfillErr) => {
          if (tenantBackfillErr) {
            console.error('Erro ao atualizar tenant_id padrao em users:', tenantBackfillErr.message);
          }
        }
      );

      db.run(
        `UPDATE clientes
         SET tenant_id = ?
         WHERE tenant_id IS NULL OR TRIM(COALESCE(tenant_id, '')) = ''`,
        [defaultTenantId],
        (tenantBackfillErr) => {
          if (tenantBackfillErr) {
            console.error('Erro ao atualizar tenant_id padrao em clientes:', tenantBackfillErr.message);
          }
        }
      );

      db.run(
        `UPDATE vendas
         SET tenant_id = ?
         WHERE tenant_id IS NULL OR TRIM(COALESCE(tenant_id, '')) = ''`,
        [defaultTenantId],
        (tenantBackfillErr) => {
          if (tenantBackfillErr) {
            console.error('Erro ao atualizar tenant_id padrao em vendas:', tenantBackfillErr.message);
          }
        }
      );

      db.run(
        `UPDATE orders
         SET tenant_id = ?
         WHERE tenant_id IS NULL OR TRIM(COALESCE(tenant_id, '')) = ''`,
        [defaultTenantId],
        (tenantBackfillErr) => {
          if (tenantBackfillErr) {
            console.error('Erro ao atualizar tenant_id padrao em orders:', tenantBackfillErr.message);
          }
        }
      );

      db.run(
        `UPDATE categories
         SET tenant_id = ?
         WHERE tenant_id IS NULL OR TRIM(COALESCE(tenant_id, '')) = ''`,
        [defaultTenantId],
        (tenantBackfillErr) => {
          if (tenantBackfillErr) {
            console.error('Erro ao atualizar tenant_id padrao em categories:', tenantBackfillErr.message);
          }
        }
      );

      db.run(
        `UPDATE deleted_category_tombstones
         SET tenant_id = ?
         WHERE tenant_id IS NULL OR TRIM(COALESCE(tenant_id, '')) = ''`,
        [defaultTenantId],
        (tenantBackfillErr) => {
          if (tenantBackfillErr) {
            console.error('Erro ao atualizar tenant_id padrao em deleted_category_tombstones:', tenantBackfillErr.message);
          }
        }
      );

      db.run(
        `UPDATE payment_methods
         SET tenant_id = ?
         WHERE tenant_id IS NULL OR TRIM(COALESCE(tenant_id, '')) = ''`,
        [defaultTenantId],
        (tenantBackfillErr) => {
          if (tenantBackfillErr) {
            console.error('Erro ao atualizar tenant_id padrao em payment_methods:', tenantBackfillErr.message);
          }
        }
      );

      db.run(
        `UPDATE stock_movements
         SET tenant_id = ?
         WHERE tenant_id IS NULL OR TRIM(COALESCE(tenant_id, '')) = ''`,
        [defaultTenantId],
        (tenantBackfillErr) => {
          if (tenantBackfillErr) {
            console.error('Erro ao atualizar tenant_id padrao em stock_movements:', tenantBackfillErr.message);
          }
        }
      );

      db.run(
        `UPDATE order_items
         SET tenant_id = COALESCE(
           (SELECT o.tenant_id FROM orders o WHERE CAST(o.id AS TEXT) = CAST(order_items.order_id AS TEXT)),
           ?
         )
         WHERE tenant_id IS NULL OR TRIM(COALESCE(tenant_id, '')) = ''`,
        [defaultTenantId],
        (tenantBackfillErr) => {
          if (tenantBackfillErr) {
            console.error('Erro ao atualizar tenant_id padrao em order_items:', tenantBackfillErr.message);
          }
        }
      );

      db.run(
        `INSERT OR IGNORE INTO tenant_profile (id, name, nuit, license_type, created_at, updated_at)
         VALUES (?, ?, NULL, 'BASIC', ?, ?)`,
        [defaultTenantId, DEFAULT_TENANT_NAME, new Date().toISOString(), new Date().toISOString()],
        (tenantProfileErr) => {
          if (tenantProfileErr) {
            console.error('Erro ao inicializar tenant_profile padrao:', tenantProfileErr.message);
          }
        }
      );

      db.get(`SELECT COUNT(*) AS total FROM users`, async (err, row) => {
        if (err) {
          console.error('Erro ao verificar usuarios iniciais:', err.message);
          return;
        }

        if ((row?.total ?? 0) === 0) {
          try {
            const seededPin = await ensureHashedPin('1234');
            db.run(
              `INSERT INTO users (id, name, surname, email, role, pin, access_level, active, is_system, tenant_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              ['admin-local', 'Administrador', null, null, 'admin', seededPin, 9, 1, 1, defaultTenantId]
            );
          } catch (hashErr) {
            console.error('Erro ao criar PIN inicial do administrador:', hashErr?.message ?? hashErr);
          }
        }
      });
      seedDefaultPaymentMethodsForTenant(defaultTenantId);
    })
    .catch((tenantErr) => {
      console.error('Erro ao garantir tenant padrao:', tenantErr.message);
    });

  runPermissionRulesSeedIfEmpty((permSeedErr) => {
    if (permSeedErr) {
      console.error('Erro ao verificar permission_rules iniciais:', permSeedErr.message);
    }
  });
});

function seedDefaultPaymentMethodsForTenant(tenantId) {
  db.get(
    `SELECT COUNT(*) AS total FROM payment_methods WHERE tenant_id = ?`,
    [tenantId],
    (err, row) => {
      if (err) {
        console.error('Erro ao verificar meios de pagamento iniciais:', err.message);
        return;
      }
      if ((row?.total ?? 0) > 0) return;

      const now = new Date().toISOString();
      for (const seed of buildDefaultPaymentMethodInsertRows(tenantId, now)) {
        db.run(
          `INSERT OR IGNORE INTO payment_methods
            (name, code, tenant_id, shortcut, position, enabled, quick_payment, required_customer, allow_change, mark_as_paid, print_receipt, open_cash_drawer, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          seed,
        );
      }
    },
  );
}

export function getDatabasePath() {
  return dbPath;
}

/** Fecha a ligação SQLite (ex.: antes de trocar o ficheiro no restauro). */
export function closeDatabase() {
  return new Promise((resolve, reject) => {
    db.close((err) => {
      if (err) return reject(err);
      resolve();
    });
  });
}

export default db;