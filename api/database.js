import path from 'path';
import { fileURLToPath } from 'url';
import { resolveDatabasePathAfterMigration } from './utils/dbPaths.js';
import { openSqliteDatabase } from './utils/dbEncryption.js';

import { defineSalesCoreSchema } from './schema/sales-core.js';
import { defineTenantsSchema } from './schema/tenants.js';
import { defineUsersPermissionsSchema } from './schema/users-permissions.js';
import { defineSetupStateSchema } from './schema/setup-state.js';
import { defineCatalogSchema } from './schema/catalog.js';
import { defineOperationsSchema } from './schema/operations.js';
import { defineSyncRuntimeSchema, createEnsureSyncQueueIndexes } from './schema/sync-runtime.js';
import { defineKitchenCashSchema } from './schema/kitchen-cash.js';
import { defineLegacyMigrationsSchema } from './schema/legacy-migrations.js';
import { defineInventoryLocationsSchema } from './schema/inventory-locations.js';
import { runBootstrap } from './schema/bootstrap.js';

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
      { key: 'vendas.anular_vd', required_level: 5 },
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

  const ctx = { safeRun, ensureTenantGuards };

  // Ordem preservada 1:1 com o database.js monolítico anterior — cada módulo
  // é um bloco contíguo movido tal e qual, sem reordenar SQL entre tabelas.
  defineSalesCoreSchema(db);
  defineTenantsSchema(db);
  defineUsersPermissionsSchema(db);
  defineSetupStateSchema(db);
  defineCatalogSchema(db, ctx);
  defineOperationsSchema(db, ctx);
  defineSyncRuntimeSchema(db, ctx);
  defineKitchenCashSchema(db, ctx);
  defineLegacyMigrationsSchema(db, ctx);
  defineInventoryLocationsSchema(db, ctx);

  const ensureSyncQueueIndexes = createEnsureSyncQueueIndexes(db);

  runBootstrap(db, {
    ensureSyncQueueIndexes,
    getOrCreateDefaultTenantId,
    runPermissionRulesSeedIfEmpty,
    defaultTenantName: DEFAULT_TENANT_NAME,
  });
});

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
