import express from 'express';
import {
  deleteTaxRateController,
  getTaxRates,
  postSwapTaxRates,
  postTaxRate,
  putTaxRate,
} from '../controllers/tax-rates.controller.js';

const router = express.Router();

router.get('/tax-rates', getTaxRates);
router.post('/tax-rates', postTaxRate);
router.post('/tax-rates/swap', postSwapTaxRates);
router.put('/tax-rates/:id', putTaxRate);
router.delete('/tax-rates/:id', deleteTaxRateController);

export default router;
