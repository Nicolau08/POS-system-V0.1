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
  // Etapa 1G.3.3: identidade AUTENTICADA da Station que fez a venda (null = venda no proprio Server/loopback)
  db.run(`ALTER TABLE vendas ADD COLUMN station_id TEXT`, () => {});

  // Pilot Gate POS/Dinheiro — breakdown real por forma de pagamento (nunca inferido de
  // payment_method string). amount = valor APLICADO à venda (SUM(amount) = vendas.total,
  // sempre); tendered_amount só preenchido quando difere de amount (ex.: dinheiro
  // recebido acima do total — o troco nunca infla o dinheiro líquido em amount).
  // Vendas antigas sem linhas aqui continuam a usar o fallback por payment_method.
  db.run(`
    CREATE TABLE IF NOT EXISTS sale_payments (
      id TEXT PRIMARY KEY,
      sale_id INTEGER NOT NULL,
      tenant_id TEXT NOT NULL,
      method TEXT NOT NULL,
      amount REAL NOT NULL,
      tendered_amount REAL,
      created_at TEXT NOT NULL
    )
  `);
  db.run(`CREATE INDEX IF NOT EXISTS idx_sale_payments_sale ON sale_payments (sale_id, tenant_id)`);

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
