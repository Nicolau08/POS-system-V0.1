import fs from 'fs/promises';
import path from 'path';
import db from '../database.js';
import { validateAdminPassword } from '../services/user.service.js';
import { requireTenantId } from '../utils/tenant.js';
import { logAudit, logError } from '../utils/logger.js';
import { sendSuccess } from '../utils/response.js';
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

export async function getDbEncryptionStatus(req, res) {
  try {
    const { getDbEncryptionRuntimeStatus } = await import('../utils/dbRecoveryKey.js');
    const status = getDbEncryptionRuntimeStatus();
    return sendSuccess(res, status);
  } catch (err) {
    return controllerError(res, err);
  }
}

/**
 * Exporta a chave SQLCipher desta instalação num ficheiro cifrado (senha escolhida).
 * Sem master global. Só loopback + admin nível 9 + PIN do utilizador actual.
 */
export async function exportDbRecoveryKey(req, res) {
  try {
    const { isLocalRequest } = await import('../middlewares/auth.js');
    if (!isLocalRequest(req)) {
      return res.status(403).json({
        error: 'Exportação da chave só é permitida no próprio PC do servidor (loopback).',
        code: 'LOCAL_ONLY_OPERATION',
      });
    }

    const level = Number(req.user?.access_level ?? req.user?.accessLevel ?? 0);
    if (!Number.isFinite(level) || level < 9) {
      return res.status(403).json({
        error: 'Apenas administrador de nível 9 pode exportar a chave de recuperação.',
        code: 'FORBIDDEN',
      });
    }

    const enteredPin = String(req.body?.enteredPin ?? '').trim();
    const wrapPassword = String(req.body?.wrapPassword ?? '');
    const wrapPasswordConfirm = String(req.body?.wrapPasswordConfirm ?? '');
    if (wrapPassword !== wrapPasswordConfirm) {
      return res.status(400).json({ error: 'As senhas do ficheiro de recuperação não coincidem.' });
    }

    const { verifyCurrentUserPin } = await import('../services/user.service.js');
    const pinCheck = await verifyCurrentUserPin(req.user?.id, enteredPin);
    if (!pinCheck.ok) {
      return res.status(403).json({ error: 'PIN incorrecto.', code: 'INVALID_PIN' });
    }

    const { getDbEncryptionKey } = await import('../utils/dbEncryption.js');
    const {
      wrapRecoveryKeyPackage,
      getDbEncryptionRuntimeStatus,
    } = await import('../utils/dbRecoveryKey.js');

    const status = getDbEncryptionRuntimeStatus();
    const keyHex = getDbEncryptionKey();
    if (!keyHex) {
      return res.status(409).json({
        error:
          'Esta instalação não tem chave SQLCipher no processo (BD em modo desenvolvimento sem encriptação, ou API sem Electron).',
        code: 'DB_KEY_UNAVAILABLE',
        ...status,
      });
    }

    const tenantId = String(req.tenantId ?? req.user?.tenant_id ?? '');
    const recoveryPackage = wrapRecoveryKeyPackage(
      {
        keyHex,
        tenantId,
        exportedBy: String(req.user?.id ?? ''),
      },
      wrapPassword,
    );

    await logAudit('DB_RECOVERY_KEY_EXPORTED', req.user, {
      entity: 'database',
      entity_id: 'encryption-key',
      description: 'Database recovery key exported (wrapped; key material not logged)',
      tenant_id: tenantId,
      encryptionConfigured: status.encryptionConfigured,
      databaseMarkedEncrypted: status.databaseMarkedEncrypted,
    });

    return sendSuccess(res, {
      recoveryPackage,
      fileName: `posly-db-recovery-${tenantId || 'tenant'}-${new Date()
        .toISOString()
        .slice(0, 10)}.json`,
      warning:
        'Guarde o ficheiro offline. Quem tiver o ficheiro e a senha pode ler a base desta loja. Não existe senha master global.',
    });
  } catch (err) {
    const status = Number(err?.status) || 500;
    const message = err instanceof Error ? err.message : String(err);
    await logAudit('DB_RECOVERY_KEY_EXPORT_FAILED', req.user, {
      entity: 'database',
      entity_id: 'encryption-key',
      description: 'Database recovery key export failed',
      error: message,
    });
    if (status !== 500) {
      return res.status(status).json({ error: message, code: err?.code ?? null });
    }
    return controllerError(res, err);
  }
}

/**
 * Revela a chave a partir do ficheiro de recuperação (suporte / migração).
 * Só loopback + admin 9 + PIN. A chave nunca é persistida de novo automaticamente.
 */
export async function unwrapDbRecoveryKey(req, res) {
  try {
    const { isLocalRequest } = await import('../middlewares/auth.js');
    if (!isLocalRequest(req)) {
      return res.status(403).json({
        error: 'Desbloquear chave só é permitido no próprio PC do servidor (loopback).',
        code: 'LOCAL_ONLY_OPERATION',
      });
    }

    const level = Number(req.user?.access_level ?? req.user?.accessLevel ?? 0);
    if (!Number.isFinite(level) || level < 9) {
      return res.status(403).json({
        error: 'Apenas administrador de nível 9 pode desbloquear a chave de recuperação.',
        code: 'FORBIDDEN',
      });
    }

    const enteredPin = String(req.body?.enteredPin ?? '').trim();
    const wrapPassword = String(req.body?.wrapPassword ?? '');
    const recoveryPackage = req.body?.recoveryPackage;

    const { verifyCurrentUserPin } = await import('../services/user.service.js');
    const pinCheck = await verifyCurrentUserPin(req.user?.id, enteredPin);
    if (!pinCheck.ok) {
      return res.status(403).json({ error: 'PIN incorrecto.', code: 'INVALID_PIN' });
    }

    const { unwrapRecoveryKeyPackage } = await import('../utils/dbRecoveryKey.js');
    const unlocked = unwrapRecoveryKeyPackage(recoveryPackage, wrapPassword);

    await logAudit('DB_RECOVERY_KEY_UNWRAPPED', req.user, {
      entity: 'database',
      entity_id: 'encryption-key',
      description: 'Database recovery key unwrapped for support (key material not logged)',
      package_tenant_id: unlocked.tenantId || null,
    });

    return sendSuccess(res, {
      keyHex: unlocked.keyHex,
      tenantId: unlocked.tenantId,
      exportedAt: unlocked.exportedAt,
      warning:
        'Use a chave só para abrir esta BD (SQLCipher) ou migrar esta instalação. Não a partilhe nem a grave em chat/email.',
    });
  } catch (err) {
    const status = Number(err?.status) || 500;
    const message = err instanceof Error ? err.message : String(err);
    if (status !== 500) {
      return res.status(status).json({ error: message, code: err?.code ?? null });
    }
    return controllerError(res, err);
  }
}
