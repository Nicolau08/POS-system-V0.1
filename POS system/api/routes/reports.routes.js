import express from 'express';
import { authenticateUser } from '../middlewares/auth.js';
import { getReportsCustomers, getReportsFilters, getReportsSales } from '../controllers/reports.controller.js';

const router = express.Router();

router.get('/reports/filters', authenticateUser, getReportsFilters);
router.get('/reports/customers', authenticateUser, getReportsCustomers);
router.get('/reports/sales', authenticateUser, getReportsSales);

export default router;
