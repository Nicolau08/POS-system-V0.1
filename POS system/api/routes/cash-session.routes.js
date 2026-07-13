import express from 'express';
import { authenticateUser } from '../middlewares/auth.js';
import {
  ensureSession,
  getSession,
  getZReport,
  listZReports,
  postClose,
  postReportX,
  postWithdraw,
} from '../controllers/cash-session.controller.js';

const router = express.Router();

router.get('/cash/session', authenticateUser, getSession);
router.post('/cash/session/ensure', authenticateUser, ensureSession);
router.post('/cash/withdraw', authenticateUser, postWithdraw);
router.post('/cash/report-x', authenticateUser, postReportX);
router.post('/cash/close', authenticateUser, postClose);
router.get('/cash/z-reports', authenticateUser, listZReports);
router.get('/cash/z-reports/:id', authenticateUser, getZReport);

export default router;
