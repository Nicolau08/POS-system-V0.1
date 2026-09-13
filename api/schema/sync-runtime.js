/**
 * Esquema: sync_queue, sync_logs, checkout_idempotency, pos_open_drafts, pos_table_orders.
 * Extraído de database.js — mesma ordem/SQL, sem alterações de comportamento.
 */
export function defineSyncRuntimeSchema(db, { safeRun }) {
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
}

/**
 * ensureSyncQueueIndexes: recria os índices de sync_queue (chamado após o
 * CREATE inicial acima e, mais tarde, após a migração dead-letter em bootstrap.js).
 */
export function createEnsureSyncQueueIndexes(db) {
  return function ensureSyncQueueIndexes(done = () => {}) {
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
}
