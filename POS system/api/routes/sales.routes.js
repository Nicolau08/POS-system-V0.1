import express from 'express';
import { authenticateUser } from '../middlewares/auth.js';
import { getSales, patchSalePaymentStatus, postSale } from '../controllers/sales.controller.js';

const router = express.Router();

router.get('/vendas', authenticateUser, getSales);
router.patch('/vendas/:id/payment-status', authenticateUser, patchSalePaymentStatus);
router.post('/vendas', authenticateUser, postSale);

export default router;
