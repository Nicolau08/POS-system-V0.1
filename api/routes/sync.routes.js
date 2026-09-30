import express from 'express';
import { requireLoopbackOnly } from '../middlewares/stationAuth.js';
import { authenticateUser, requireAdmin } from '../middlewares/auth.js';
import {
  getStockReconciliation,
  putStoreProductConfig,
  getSyncLogs,
  getSyncStatus,
  getDeviceAuthDiagnostic,
  pauseSync,
  resumeSync,
  deviceAuthRefreshOnly,
  deviceAuthReadonlyProbe,
  runFullResetSync,
  runSyncCycle,
  getLocalTenantMap,
} from '../controllers/sync.controller.js';

const router = express.Router();

router.get('/status', authenticateUser, getSyncStatus);
router.get('/device-auth-diagnostic', authenticateUser, requireAdmin, getDeviceAuthDiagnostic);
// Prova isolada de Device Auth (Pilot Gate): controlo do sync só a partir da própria máquina.
router.post('/pause', requireLoopbackOnly, authenticateUser, requireAdmin, pauseSync);
router.post('/resume', requireLoopbackOnly, authenticateUser, requireAdmin, resumeSync);
router.post('/device-auth-refresh-only', requireLoopbackOnly, authenticateUser, requireAdmin, deviceAuthRefreshOnly);
router.get('/device-auth-readonly-probe', requireLoopbackOnly, authenticateUser, requireAdmin, deviceAuthReadonlyProbe);
// Diagnóstico só-leitura do mapa de tenant (Pilot Gate): zero escritas, sem refresh, só a partir da própria máquina.
router.get('/local-tenant-map', requireLoopbackOnly, authenticateUser, requireAdmin, getLocalTenantMap);
router.post('/run',authenticateUser, requireAdmin, runSyncCycle);
router.post('/full-reset', requireLoopbackOnly, authenticateUser, requireAdmin, runFullResetSync);
router.get('/logs', authenticateUser, requireAdmin, getSyncLogs);
router.get('/stock-reconciliation', authenticateUser, requireAdmin, getStockReconciliation);
router.put('/store-products/:id', authenticateUser, requireAdmin, putStoreProductConfig);

export default router;
