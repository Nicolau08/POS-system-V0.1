import express from 'express';
import { authenticateUser, requirePermission } from '../middlewares/auth.js';
import { getReportsCustomers, getReportsFilters, getReportsSales } from '../controllers/reports.controller.js';

const router = express.Router();

const requireReports = requirePermission('painel.relatorios', 5);

router.get('/reports/filters', authenticateUser, requireReports, getReportsFilters);
router.get('/reports/customers', authenticateUser, requireReports, getReportsCustomers);
router.get('/reports/sales', authenticateUser, requireReports, getReportsSales);

export default router;
