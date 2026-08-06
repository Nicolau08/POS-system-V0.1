import express from 'express';
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

router.post('/maintenance/reset-database', authenticateUser, requireAdmin, resetDatabase);
router.post('/backup/create', authenticateUser, requireAdmin, createDatabaseBackup);
router.get('/backup/list', authenticateUser, requireAdmin, listDatabaseBackups);
router.post('/backup/restore', authenticateUser, requireAdmin, restoreDatabaseBackup);
router.get(
  '/maintenance/db-encryption-status',
  authenticateUser,
  requireAdmin,
  getDbEncryptionStatus,
);
router.post(
  '/maintenance/db-recovery-key/export',
  authenticateUser,
  requireAdmin,
  requireMinLevel(9),
  exportDbRecoveryKey,
);
router.post(
  '/maintenance/db-recovery-key/unwrap',
  authenticateUser,
  requireAdmin,
  requireMinLevel(9),
  unwrapDbRecoveryKey,
);

export default router;
