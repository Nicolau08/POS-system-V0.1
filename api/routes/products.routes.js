import express from 'express';
import { authenticateUser, requireAdmin } from '../middlewares/auth.js';
import {
  getProductMovementHistory,
  getProducts,
  postProduct,
  postStockAdjustment,
  putProduct,
  removeProduct,
} from '../controllers/products.controller.js';

const router = express.Router();

router.get('/produtos', authenticateUser, getProducts);
router.post('/produtos', authenticateUser, requireAdmin, postProduct);
router.put('/produtos/:id', authenticateUser, requireAdmin, putProduct);
router.delete('/produtos/:id', authenticateUser, requireAdmin, removeProduct);
router.get('/produtos/:id/historico', authenticateUser, getProductMovementHistory);

router.post('/stock', authenticateUser, requireAdmin, postStockAdjustment);

export default router;
