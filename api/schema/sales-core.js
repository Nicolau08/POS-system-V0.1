/**
 * Esquema: vendas (documentos legados VD) e clientes.
 * Extraído de database.js — mesma ordem/SQL, sem alterações de comportamento.
 */
export function defineSalesCoreSchema(db) {
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
}
