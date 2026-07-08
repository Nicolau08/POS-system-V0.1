import express from 'express';
import { authenticateUser } from '../middlewares/auth.js';
import { getTenantInfo } from '../controllers/tenant.controller.js';

const router = express.Router();

router.get('/tenant/info', authenticateUser, getTenantInfo);

export default router;
