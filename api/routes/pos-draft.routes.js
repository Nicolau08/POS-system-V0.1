import express from 'express';
import { authenticateUser } from '../middlewares/auth.js';
import { deletePosDraft, getPosDraft, putPosDraft } from '../controllers/pos-draft.controller.js';
import {
  deleteTableOrder,
  getTableOrder,
  getTableOrders,
  putTableOrder,
  streamTableOrders,
} from '../controllers/pos-table-orders.controller.js';

const router = express.Router();

router.get('/pos/draft', authenticateUser, getPosDraft);
router.put('/pos/draft', authenticateUser, putPosDraft);
router.delete('/pos/draft', authenticateUser, deletePosDraft);

/** Pedidos de mesa partilhados entre postos (garçom ↔ caixa). */
router.get('/pos/table-orders/events', authenticateUser, streamTableOrders);
router.get('/pos/table-orders', authenticateUser, getTableOrders);
router.get('/pos/table-orders/:tableKey', authenticateUser, getTableOrder);
router.put('/pos/table-orders/:tableKey', authenticateUser, putTableOrder);
router.delete('/pos/table-orders/:tableKey', authenticateUser, deleteTableOrder);

export default router;
