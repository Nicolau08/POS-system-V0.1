import express from 'express';
import { createLicense, createTenantWithSerial, listTenants } from '../controllers/saas.controller.js';

const router = express.Router();

router.post('/tenants', createTenantWithSerial);
router.get('/tenants', listTenants);
router.post('/license', createLicense);

export default router;
