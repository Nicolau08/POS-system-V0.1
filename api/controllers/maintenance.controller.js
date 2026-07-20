import fs from 'fs/promises';
import path from 'path';
import db from '../database.js';
import { validateAdminPassword } from '../services/user.service.js';
import { requireTenantId } from '../utils/tenant.js';
import { logAudit, logError } from '../utils/logger.js';
import {
  createBackup,
  getActiveCriticalOperations,
  hasCriticalOperations,
  listBackups,
  restoreBackup,
} from '../utils/backup.js';

const runDb = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) return reject(err);
      resolve(this);
    });
  });

function controllerError(res, error) {
  console.error('❌ controller error:', error);
  return res.status(500).json({
    error: 'Erro interno',
    message: error instanceof Error ? error.message : String(error),
  });
}

export async function resetDatabase(req, res) {
  const payload = req.body ?? {};
  const backupDirRaw = String(payload.backupDir ?? '').trim();
  const adminPassword = String(payload.adminPassword ?? '').trim();
  const resetProducts = Boolean(payload.resetProducts);
  const resetCustomers = Boolean(payload.resetCustomers);
  const resetDocuments = Boolean(payload.resetDocuments);

  if (!backupDirRaw) return res.status(400).json({ error: 'backupDir obrigatorio' });
  if (!path.isAbsolute(backupDirRaw)) return res.status(400).json({ error: 'backupDir deve ser absoluto' });
  if (!adminPassword) return res.status(400).json({ error: 'senha do administrador obrigatoria' });
  if (!resetProducts && !resetCustomers && !resetDocuments) {
    return res.status(400).json({ error: 'selecione pelo menos uma entidade para redefinir' });
  }

  try {
    const tenantId = requireTenantId(req.tenantId ?? req.user?.tenant_id, {
      status: 401,
      message: 'tenant_id ausente para manutencao',
    });
    const adminUser = await validateAdminPassword(adminPassword, tenantId);
    if (!adminUser) return res.status(403).json({ error: 'senha do administrador invalida' });

    await fs.mkdir(backupDirRaw, { recursive: true });

    const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
    const backupFilePath = path.join(backupDirRaw, `database-backup-${stamp}.db`);
    const escapedBackupPath = backupFilePath.replace(/'/g, "''");

    await runDb(`VACUUM INTO '${escapedBackupPath}'`);

    const stats = {
      products: 0,
      customers: 0,
      documents: 0,
    };

    await runDb('BEGIN IMMEDIATE TRANSACTION');
    try {
      if (resetDocuments) {
        const deletedOrderItems = await runDb(
          `DELETE FROM order_items
           WHERE tenant_id = ?`,
          [tenantId]
        );
        const deletedOrders = await runDb(
          `DELETE FROM orders
           WHERE tenant_id = ?`,
          [tenantId]
        );
        const deletedSales = await runDb(
          `DELETE FROM vendas
           WHERE tenant_id = ?`,
          [tenantId]
        );
        stats.documents =
          Number(deletedOrderItems?.changes ?? 0) +
          Number(deletedOrders?.changes ?? 0) +
          Number(deletedSales?.changes ?? 0);
      }

      if (resetProducts) {
        await runDb(
          `DELETE FROM stock_movements
           WHERE product_id IN (
             SELECT id
             FROM products
             WHERE tenant_id = ?
           )`,
          [tenantId]
        );
        const deletedProducts = await runDb(
          `UPDATE products
           SET deleted = 1,
               updated_at = CURRENT_TIMESTAMP
           WHERE tenant_id = ?
             AND COALESCE(deleted, 0) = 0`,
          [tenantId]
        );
        stats.products = Number(deletedProducts?.changes ?? 0);
      }

      if (resetCustomers) {
        const deletedCustomers = await runDb(
          `DELETE FROM clientes
           WHERE tenant_id = ?`,
          [tenantId]
        );
        stats.customers = Number(deletedCustomers?.changes ?? 0);
      }

      await runDb('COMMIT');
    } catch (txErr) {
      await runDb('ROLLBACK');
      throw txErr;
    }

    await logAudit('DATABASE_RESET', req.user, {
      entity: 'database',
      entity_id: 'main',
      description: 'Database reset operation executed',
      reset: {
        products: resetProducts,
        customers: resetCustomers,
        documents: resetDocuments,
      },
      deleted: stats,
    });

    return res.json({
      success: true,
      backupFile: backupFilePath,
      reset: {
        products: resetProducts,
        customers: resetCustomers,
        documents: resetDocuments,
      },
      deleted: stats,
    });
  } catch (err) {
    await logAudit('DATABASE_RESET_FAILED', req.user, {
      entity: 'database',
      entity_id: 'main',
      description: 'Database reset failed',
      error: err instanceof Error ? err.message : String(err),
    });
    logError('database_reset_error', {
      error: err instanceof Error ? err.message : String(err),
      requested_by: req.user?.id ?? null,
    });
    return controllerError(res, err);
  }
}

export async function createDatabaseBackup(req, res) {
  try {
    const backup = await createBackup();
    await logAudit('BACKUP_CREATE', req.user, {
      entity: 'database',
      entity_id: 'main',
      description: 'Manual database backup created',
      backup_file: backup.fileName,
      backup_path: backup.filePath,
      mode: 'manual',
    });
    return res.json({ success: true, backup });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    await logAudit('BACKUP_CREATE_FAILED', req.user, {
      entity: 'database',
      entity_id: 'main',
      description: 'Manual database backup failed',
      error: errorMessage,
      mode: 'manual',
    });
    logError('backup_create_error', {
      error: errorMessage,
      requested_by: req.user?.id ?? null,
    });
    return controllerError(res, err);
  }
}

export async function listDatabaseBackups(_req, res) {
  try {
    const backups = await listBackups();
    const { getBackupsDirectory, getLiveDatabasePath } = await import('../utils/backup.js');
    return res.json({
      success: true,
      backups,
      backupsDir: getBackupsDirectory(),
      databasePath: getLiveDatabasePath(),
    });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    logError('backup_list_error', { error: errorMessage });
    return controllerError(res, err);
  }
}

export async function restoreDatabaseBackup(req, res) {
  const backupFile = String(req.body?.backupFile ?? '').trim();
  if (!backupFile) {
    return res.status(400).json({ error: 'backupFile obrigatorio' });
  }
  if (hasCriticalOperations()) {
    return res.status(409).json({
      error: 'restore bloqueado: sistema com operacoes criticas em andamento',
      activeCriticalOperations: getActiveCriticalOperations(),
    });
  }

  try {
    const restored = await restoreBackup(backupFile);
    await logAudit('BACKUP_RESTORE', req.user, {
      entity: 'database',
      entity_id: 'main',
      description: 'Database restored from backup',
      backup_file: restored.fileName,
      backup_path: restored.filePath,
    });
    return res.json({ success: true, restored });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    await logAudit('BACKUP_RESTORE_FAILED', req.user, {
      entity: 'database',
      entity_id: 'main',
      description: 'Database restore failed',
      backup_file: backupFile,
      error: errorMessage,
    });
    logError('backup_restore_error', {
      error: errorMessage,
      requested_by: req.user?.id ?? null,
      backup_file: backupFile,
    });
    const statusCode = errorMessage.toLowerCase().includes('no such file') ? 404 : 500;
    if (statusCode !== 500) {
      return res.status(statusCode).json({ error: errorMessage });
    }
    return controllerError(res, err);
  }
}
