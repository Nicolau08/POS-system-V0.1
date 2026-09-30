import express from 'express';
import { requireLoopbackOnly } from '../middlewares/stationAuth.js';
import { authenticateUser, requireAdmin, requireMinLevel } from '../middlewares/auth.js';
import {
  createDatabaseBackup,
  listDatabaseBackups,
  resetDatabase,
  restoreDatabaseBackup,
  getDbEncryptionStatus,
  exportDbRecoveryKey,
  unwrapDbRecoveryKey,
} from '../controllers/maintenance.controller.js';

const router = express.Router();

// Etapa 1G.3.4: reset, restore e chaves de recuperacao da BD do Server -> so loopback
router.post('/maintenance/reset-database', requireLoopbackOnly, authenticateUser, requireAdmin, resetDatabase);
// Etapa 1G.3.5: criar/listar backups da BD do Server expoe caminhos e gera copias da BD -> so loopback (admin local)
router.post('/backup/create', requireLoopbackOnly, authenticateUser, requireAdmin, createDatabaseBackup);
router.get('/backup/list', requireLoopbackOnly, authenticateUser, requireAdmin, listDatabaseBackups);
router.post('/backup/restore', requireLoopbackOnly, authenticateUser, requireAdmin, restoreDatabaseBackup);
router.get(
  '/maintenance/db-encryption-status',
  requireLoopbackOnly,
  authenticateUser,
  requireAdmin,
  getDbEncryptionStatus,
);
router.post(
  '/maintenance/db-recovery-key/export',
  requireLoopbackOnly,
  authenticateUser,
  requireAdmin,
  requireMinLevel(9),
  exportDbRecoveryKey,
);
router.post(
  '/maintenance/db-recovery-key/unwrap',
  requireLoopbackOnly,
  authenticateUser,
  requireAdmin,
  requireMinLevel(9),
  unwrapDbRecoveryKey,
);

export default router;
