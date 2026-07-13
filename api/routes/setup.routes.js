import express from 'express';
import {
  ackLicenseFile,
  bindSerialLicense,
  getSetupStatus,
  initializeFromSerial,
  initializeSetup,
  lookupSerial,
  reactivateLicenseToken,
  setAdminPassword,
  syncLicenseRegistryHandler,
} from '../controllers/setup.controller.js';

const router = express.Router();

router.get('/status', getSetupStatus);
router.post('/initialize', initializeSetup);
router.post('/serial/lookup', lookupSerial);
router.post('/initialize-from-serial', initializeFromSerial);
router.post('/admin-password', setAdminPassword);
router.post('/license/bind-serial', bindSerialLicense);
router.post('/license/ack-file', ackLicenseFile);
router.post('/license/sync-registry', syncLicenseRegistryHandler);
router.post('/license/reactivate-token', reactivateLicenseToken);

export default router;
