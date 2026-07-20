import express from 'express';
import {
  deletePrintCenterController,
  getPrintCenters,
  postBillPrint,
  postPrintCenter,
  postProductionOrder,
  putPrintCenter,
} from '../controllers/print-centers.controller.js';

const router = express.Router();

router.get('/print-centers', getPrintCenters);
router.post('/print-centers', postPrintCenter);
router.post('/print-centers/production', postProductionOrder);
router.post('/print-centers/bill', postBillPrint);
router.put('/print-centers/:id', putPrintCenter);
router.delete('/print-centers/:id', deletePrintCenterController);

export default router;
