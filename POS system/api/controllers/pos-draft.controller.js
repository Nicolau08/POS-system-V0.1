import {
  clearOpenPosDraft,
  getOpenPosDraft,
  saveOpenPosDraft,
} from '../services/pos-draft.service.js';
import { logError } from '../utils/logger.js';
import { sendError, sendSuccess } from '../utils/response.js';

function controllerError(res, error) {
  const status = Number(error?.status) || 500;
  if (status >= 400 && status < 500) {
    return sendError(res, status, error?.message || 'Pedido inválido', error?.code);
  }
  console.error('❌ pos-draft controller error:', error);
  return sendError(res, 500, 'Erro interno do servidor', 'INTERNAL_ERROR');
}

export async function getPosDraft(req, res) {
  try {
    const result = await getOpenPosDraft(req.user, req.query ?? {});
    return sendSuccess(res, result);
  } catch (error) {
    logError('get_pos_draft_error', { error: error?.message ?? String(error) });
    return controllerError(res, error);
  }
}

export async function putPosDraft(req, res) {
  try {
    const result = await saveOpenPosDraft(req.body ?? {}, req.user);
    return sendSuccess(res, result);
  } catch (error) {
    logError('put_pos_draft_error', { error: error?.message ?? String(error) });
    return controllerError(res, error);
  }
}

export async function deletePosDraft(req, res) {
  try {
    const result = await clearOpenPosDraft(req.user, req.query ?? {});
    return sendSuccess(res, result);
  } catch (error) {
    logError('delete_pos_draft_error', { error: error?.message ?? String(error) });
    return controllerError(res, error);
  }
}
