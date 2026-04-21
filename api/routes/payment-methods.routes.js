import express from 'express';
import {
  deletePaymentMethodController,
  getPaymentMethods,
  postPaymentMethod,
  postResetPaymentMethodsDefaults,
  putPaymentMethod,
} from '../controllers/payment-methods.controller.js';
import { validateRequest } from '../middlewares/validation.middleware.js';
import { validatePaymentMethodBody } from '../validators/request.validators.js';

const router = express.Router();

router.get('/payment-methods', getPaymentMethods);
router.post('/payment-methods', validateRequest({ body: validatePaymentMethodBody }), postPaymentMethod);
router.put('/payment-methods/:id', validateRequest({ body: validatePaymentMethodBody }), putPaymentMethod);
router.delete('/payment-methods/:id', deletePaymentMethodController);
router.post('/payment-methods/reset-defaults', postResetPaymentMethodsDefaults);

export default router;
