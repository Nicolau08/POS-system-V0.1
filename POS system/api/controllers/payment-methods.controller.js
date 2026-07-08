import {
  createPaymentMethod,
  listAllPaymentMethods,
  removePaymentMethod,
  resetPaymentMethodDefaults,
  updatePaymentMethodById,
} from '../services/payment-methods.service.js';
import { handleControllerError, sendSuccess } from '../utils/response.js';

export async function getPaymentMethods(req, res) {
  try {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    const payload = await listAllPaymentMethods(req.query ?? {}, req.user ?? null);
    return sendSuccess(res, payload);
  } catch (error) {
    return handleControllerError(res, error);
  }
}

export async function postPaymentMethod(req, res) {
  try {
    const payload = await createPaymentMethod(req.body ?? {}, req.user ?? null);
    return sendSuccess(res, payload);
  } catch (error) {
    return handleControllerError(res, error);
  }
}

export async function putPaymentMethod(req, res) {
  try {
    const payload = await updatePaymentMethodById(req.params?.id, req.body ?? {}, req.user ?? null);
    return sendSuccess(res, payload);
  } catch (error) {
    return handleControllerError(res, error);
  }
}

export async function deletePaymentMethodController(req, res) {
  try {
    const payload = await removePaymentMethod(req.params?.id, req.user ?? null);
    return sendSuccess(res, payload);
  } catch (error) {
    return handleControllerError(res, error);
  }
}

export async function postResetPaymentMethodsDefaults(_req, res) {
  try {
    const payload = await resetPaymentMethodDefaults(_req.user ?? null);
    return sendSuccess(res, payload);
  } catch (error) {
    return handleControllerError(res, error);
  }
}
