import express from 'express';
import { authenticateUser, requireAdmin } from '../middlewares/auth.js';
import {
  createDatabaseBackup,
  listDatabaseBackups,
  resetDatabase,
  restoreDatabaseBackup,
} from '../controllers/maintenance.controller.js';

const router = express.Router();

router.post('/maintenance/reset-database', authenticateUser, requireAdmin, resetDatabase);
router.post('/backup/create', authenticateUser, requireAdmin, createDatabaseBackup);
router.get('/backup/list', authenticateUser, requireAdmin, listDatabaseBackups);
router.post('/backup/restore', authenticateUser, requireAdmin, restoreDatabaseBackup);

export default router;
