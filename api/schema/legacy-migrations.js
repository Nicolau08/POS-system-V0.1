/**
 * Migrações incrementais para bases de dados já existentes (ADD COLUMN idempotente,
 * normalizações e reindexação de retentativa). Extraído de database.js — mesma
 * ordem/SQL, sem alterações de comportamento.
 */
export function defineLegacyMigrationsSchema(db, { safeRun }) {
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
  db.run(`ALTER TABLE payment_methods ADD COLUMN color TEXT`, (err) => {
    if (err && !String(err.message || '').includes('duplicate column name')) {
      console.error('Erro ao adicionar coluna color em payment_methods:', err.message);
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
}
