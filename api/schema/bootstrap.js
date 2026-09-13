/**
 * Arranque pós-esquema: migração sync_queue → dead-letter (v2), backfill de
 * cloud_id/tenant_id em bases antigas, seed do utilizador admin e dos meios
 * de pagamento predefinidos. Extraído de database.js — mesma ordem/SQL, sem
 * alterações de comportamento.
 */
import { uuidv4 } from '../cloudIdUtils.js';
import { ensureHashedPin } from '../pinAuth.js';
import { buildDefaultPaymentMethodInsertRows } from '../constants/paymentMethodDefaults.js';

function seedDefaultPaymentMethodsForTenant(db, tenantId) {
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
            (name, code, tenant_id, shortcut, position, enabled, quick_payment, required_customer, allow_change, mark_as_paid, print_receipt, open_cash_drawer, color, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          seed,
        );
      }
    },
  );
}

export function runBootstrap(db, { ensureSyncQueueIndexes, getOrCreateDefaultTenantId, runPermissionRulesSeedIfEmpty, defaultTenantName }) {
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
        [defaultTenantId, defaultTenantName, new Date().toISOString(), new Date().toISOString()],
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
      seedDefaultPaymentMethodsForTenant(db, defaultTenantId);
    })
    .catch((tenantErr) => {
      console.error('Erro ao garantir tenant padrao:', tenantErr.message);
    });

  runPermissionRulesSeedIfEmpty((permSeedErr) => {
    if (permSeedErr) {
      console.error('Erro ao verificar permission_rules iniciais:', permSeedErr.message);
    }
  });
}
