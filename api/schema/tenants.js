/**
 * Esquema: tenants e tenant_profile (perfil comercial, vertical, capacidades).
 * Extraído de database.js — mesma ordem/SQL, sem alterações de comportamento.
 */
export function defineTenantsSchema(db) {
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
}
