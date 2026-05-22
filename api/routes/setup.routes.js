import express from 'express';
import {
  getSetupStatus,
  initializeSetup,
  acknowledgeSetupLicenseFile,
  syncSetupLicenseFromConsole,
  redeemSetupReactivationToken,
} from '../controllers/setup.controller.js';

const router = express.Router();

router.get('/status', getSetupStatus);
router.post('/license/ack-file', acknowledgeSetupLicenseFile);
router.post('/license/reactivate-token', redeemSetupReactivationToken);
router.post('/license/sync-registry', syncSetupLicenseFromConsole);
router.post('/initialize', initializeSetup);

export default router;
