import express from 'express';
import {
  approveCotacaoController,
  getDashboardSummaryController,
  getDocumentosController,
  getDocumentosItensController,
  getDocumentosNextNumberController,
  getNextVdController,
  patchDocumentoPaymentStatusController,
  postDocumentoController,
  previewDocumentPaymentController,
  registerDocumentPaymentController,
} from '../controllers/documentos.controller.js';
import { validateRequest } from '../middlewares/validation.middleware.js';
import {
  validateApproveCotacaoBody,
  validateDocumentoBody,
  validateDocumentosNextNumberQuery,
  validateDocumentPaymentPreviewQuery,
  validateRegisterDocumentPaymentBody,
} from '../validators/request.validators.js';

const router = express.Router();

router.get('/documentos', getDocumentosController);
router.get(
  '/documentos/pagamento/preview',
  validateRequest({ query: validateDocumentPaymentPreviewQuery }),
  previewDocumentPaymentController
);
router.post('/cotacoes/aprovar', validateRequest({ body: validateApproveCotacaoBody }), approveCotacaoController);
router.post(
  '/documentos/registar-pagamento',
  validateRequest({ body: validateRegisterDocumentPaymentBody }),
  registerDocumentPaymentController
);
router.patch('/documentos/:id/payment-status', patchDocumentoPaymentStatusController);
router.get('/documentos-itens', getDocumentosItensController);
router.get('/documentos/next-number', validateRequest({ query: validateDocumentosNextNumberQuery }), getDocumentosNextNumberController);
router.post('/documentos', validateRequest({ body: validateDocumentoBody }), postDocumentoController);
router.get('/dashboard-summary', getDashboardSummaryController);
router.get('/next-vd', getNextVdController);

export default router;
