import express from 'express';
import {
  getSetupStatus,
  installOfflineLicense,
  resetLocalLicense,
  setAdminPassword,
  syncLicenseRegistryHandler,
} from '../controllers/setup.controller.js';

import { requireLoopbackOnly } from '../middlewares/stationAuth.js';

const router = express.Router();

router.get('/status', getSetupStatus);
// Etapa 1G.3.4: estas operacoes alteram/apagam estado do Store Server -> so loopback (uma Station emparelhada nao as faz)
router.post('/admin-password', requireLoopbackOnly, setAdminPassword);
router.post('/license/sync-registry', requireLoopbackOnly, syncLicenseRegistryHandler);
router.post('/license/reset-local', requireLoopbackOnly, resetLocalLicense);
router.post('/license/install-offline-license', requireLoopbackOnly, installOfflineLicense);

export default router;
