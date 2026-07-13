import {
  approveCotacao,
  getDashboardSummary,
  getDocumentos,
  getDocumentosItens,
  getDocumentosNextNumber,
  getNextVd,
  postDocumento,
  previewDocumentPayment,
  registerDocumentPayment,
  updateDocumentoPaymentStatus,
} from '../services/documentos.service.js';
import { handleControllerError, sendSuccess } from '../utils/response.js';

export async function getDocumentosController(req, res) {
  try {
    const payload = await getDocumentos(req.query ?? {}, req.user ?? null);
    return sendSuccess(res, payload);
  } catch (error) {
    return handleControllerError(res, error);
  }
}

export async function approveCotacaoController(req, res) {
  try {
    const payload = await approveCotacao(req.body ?? {}, req.user ?? null);
    return sendSuccess(res, payload);
  } catch (error) {
    return handleControllerError(res, error);
  }
}

export async function patchDocumentoPaymentStatusController(req, res) {
  try {
    const payload = await updateDocumentoPaymentStatus(req.params?.id, req.body ?? {}, req.user ?? null);
    return sendSuccess(res, payload);
  } catch (error) {
    return handleControllerError(res, error);
  }
}

export async function getDocumentosItensController(req, res) {
  try {
    const payload = await getDocumentosItens(req.query ?? {}, req.user ?? null);
    return sendSuccess(res, payload);
  } catch (error) {
    return handleControllerError(res, error);
  }
}

export async function getDocumentosNextNumberController(req, res) {
  try {
    const payload = await getDocumentosNextNumber(req.query ?? {}, req.user ?? null);
    return sendSuccess(res, payload);
  } catch (error) {
    return handleControllerError(res, error);
  }
}

export async function postDocumentoController(req, res) {
  try {
    const payload = await postDocumento(req.body ?? {}, req.user ?? null);
    return sendSuccess(res, payload);
  } catch (error) {
    return handleControllerError(res, error);
  }
}

export async function getDashboardSummaryController(req, res) {
  try {
    const payload = await getDashboardSummary(req.query ?? {}, req.user ?? null);
    return sendSuccess(res, payload);
  } catch (error) {
    return handleControllerError(res, error);
  }
}

export async function getNextVdController(_req, res) {
  try {
    const payload = await getNextVd(_req.user ?? null);
    return sendSuccess(res, payload);
  } catch (error) {
    return handleControllerError(res, error);
  }
}

export async function previewDocumentPaymentController(req, res) {
  try {
    const payload = await previewDocumentPayment(req.query ?? {}, req.user ?? null);
    return sendSuccess(res, payload);
  } catch (error) {
    return handleControllerError(res, error);
  }
}

export async function registerDocumentPaymentController(req, res) {
  try {
    const payload = await registerDocumentPayment(req.body ?? {}, req.user ?? null);
    return sendSuccess(res, payload);
  } catch (error) {
    return handleControllerError(res, error);
  }
}
