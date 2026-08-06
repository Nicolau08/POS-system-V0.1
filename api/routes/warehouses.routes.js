import express from 'express';
import {
  getWarehouses,
  getWarehouseStock,
  postSetDefaultWarehouse,
  postWarehouse,
  postWarehouseTransfer,
  putWarehouse,
} from '../controllers/warehouses.controller.js';

const router = express.Router();

router.get('/warehouses', getWarehouses);
router.get('/warehouses/:id/stock', getWarehouseStock);
router.post('/warehouses', postWarehouse);
router.post('/warehouses/transfer', postWarehouseTransfer);
router.put('/warehouses/:id', putWarehouse);
router.post('/warehouses/:id/set-default', postSetDefaultWarehouse);

export default router;
