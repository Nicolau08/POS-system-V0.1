/**
 * Esquema: users, audit_logs, app_logs, permission_rules + regras/hardening.
 * Extraído de database.js — mesma ordem/SQL, sem alterações de comportamento.
 */
export function defineUsersPermissionsSchema(db) {
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

  db.run(
    `INSERT OR IGNORE INTO permission_rules (key, required_level, updated_at) VALUES ('vendas.anular_vd', 5, datetime('now'))`,
    (voidVdErr) => {
      if (voidVdErr && !String(voidVdErr.message || '').includes('no such table')) {
        console.error('[database] Falha ao garantir regra vendas.anular_vd:', voidVdErr.message);
      }
    }
  );

  db.run(
    `UPDATE payment_methods
     SET name = 'Dinheiro', updated_at = datetime('now')
     WHERE LOWER(TRIM(code)) = 'cash'
       AND LOWER(TRIM(COALESCE(name, ''))) IN ('cash', 'dinheiro')`,
    (cashNameErr) => {
      if (cashNameErr && !String(cashNameErr.message || '').includes('no such table')) {
        console.error('[database] Falha ao normalizar nome Dinheiro:', cashNameErr.message);
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
}
