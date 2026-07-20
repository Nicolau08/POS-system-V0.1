import {
  createPrintCenter,
  listAllPrintCenters,
  removePrintCenter,
  updatePrintCenterById,
} from '../services/print-centers.service.js';
import { submitBillPrint, submitProductionOrder } from '../services/production-print.service.js';
import { handleControllerError, sendSuccess } from '../utils/response.js';

export async function getPrintCenters(req, res) {
  try {
    const payload = await listAllPrintCenters(req.user ?? null);
    return sendSuccess(res, payload);
  } catch (error) {
    return handleControllerError(res, error);
  }
}

export async function postPrintCenter(req, res) {
  try {
    const payload = await createPrintCenter(req.body ?? {}, req.user ?? null);
    return sendSuccess(res, payload);
  } catch (error) {
    return handleControllerError(res, error);
  }
}

export async function putPrintCenter(req, res) {
  try {
    const payload = await updatePrintCenterById(req.params?.id, req.body ?? {}, req.user ?? null);
    return sendSuccess(res, payload);
  } catch (error) {
    return handleControllerError(res, error);
  }
}

export async function deletePrintCenterController(req, res) {
  try {
    const payload = await removePrintCenter(req.params?.id, req.user ?? null);
    return sendSuccess(res, payload);
  } catch (error) {
    return handleControllerError(res, error);
  }
}

/** Pedido de produção (postos Android / LAN) → impressoras configuradas. */
export async function postProductionOrder(req, res) {
  try {
    const payload = await submitProductionOrder(req.body ?? {}, req.user ?? null);
    return sendSuccess(res, payload);
  } catch (error) {
    return handleControllerError(res, error);
  }
}

/** Conta da mesa (postos Android / LAN) → impressoras de recibo. */
export async function postBillPrint(req, res) {
  try {
    const payload = await submitBillPrint(req.body ?? {}, req.user ?? null);
    return sendSuccess(res, payload);
  } catch (error) {
    return handleControllerError(res, error);
  }
}
