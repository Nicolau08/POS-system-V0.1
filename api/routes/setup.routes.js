import express from 'express';
import { bindSerialLicense, getSetupStatus, initializeSetup } from '../controllers/setup.controller.js';

const router = express.Router();

router.get('/status', getSetupStatus);
router.post('/initialize', initializeSetup);
router.post('/license/bind-serial', bindSerialLicense);

export default router;
