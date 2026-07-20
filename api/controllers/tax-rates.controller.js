import {
  createTaxRate,
  listAllTaxRates,
  removeTaxRate,
  swapTaxRates,
  updateTaxRateById,
} from '../services/tax-rates.service.js';
import { handleControllerError, sendSuccess } from '../utils/response.js';

export async function getTaxRates(req, res) {
  try {
    return sendSuccess(res, await listAllTaxRates(req.user ?? null));
  } catch (error) {
    return handleControllerError(res, error);
  }
}

export async function postTaxRate(req, res) {
  try {
    return sendSuccess(res, await createTaxRate(req.body ?? {}, req.user ?? null));
  } catch (error) {
    return handleControllerError(res, error);
  }
}

export async function putTaxRate(req, res) {
  try {
    return sendSuccess(res, await updateTaxRateById(req.params?.id, req.body ?? {}, req.user ?? null));
  } catch (error) {
    return handleControllerError(res, error);
  }
}

export async function deleteTaxRateController(req, res) {
  try {
    return sendSuccess(res, await removeTaxRate(req.params?.id, req.user ?? null));
  } catch (error) {
    return handleControllerError(res, error);
  }
}

export async function postSwapTaxRates(req, res) {
  try {
    return sendSuccess(res, await swapTaxRates(req.body ?? {}, req.user ?? null));
  } catch (error) {
    return handleControllerError(res, error);
  }
}
