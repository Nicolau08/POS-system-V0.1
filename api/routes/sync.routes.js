import express from 'express';
import { authenticateUser, requireAdmin } from '../middlewares/auth.js';
import { getSyncLogs, getSyncStatus, runFullResetSync, runSyncCycle } from '../controllers/sync.controller.js';

const router = express.Router();

router.get('/status', authenticateUser, requireAdmin, getSyncStatus);
router.post('/run', authenticateUser, requireAdmin, runSyncCycle);
router.post('/full-reset', authenticateUser, requireAdmin, runFullResetSync);
router.get('/logs', authenticateUser, requireAdmin, getSyncLogs);

export default router;
