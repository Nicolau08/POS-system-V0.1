import {
  buildReportX,
  closeCashSessionDay,
  ensureCashSession,
  getCashSession,
  getZReportDetail,
  getZReportHistory,
  withdrawCash,
} from '../services/cash-session.service.js';
import { logError } from '../utils/logger.js';
import { sendError, sendSuccess } from '../utils/response.js';

function controllerError(res, error) {
  const status = Number(error?.status) || 500;
  if (status >= 400 && status < 500) {
    return sendError(res, status, error?.message || 'Pedido inválido', error?.code);
  }
  console.error('❌ cash-session controller error:', error);
  return sendError(res, 500, 'Erro interno do servidor', 'INTERNAL_ERROR');
}

export async function getSession(req, res) {
  try {
    const result = await getCashSession(req.user);
    return sendSuccess(res, result);
  } catch (error) {
    logError('cash_session_get_failed', { error, module: 'cash-session' });
    return controllerError(res, error);
  }
}

export async function ensureSession(req, res) {
  try {
    const result = await ensureCashSession(req.user);
    return sendSuccess(res, result);
  } catch (error) {
    logError('cash_session_ensure_failed', { error, module: 'cash-session' });
    return controllerError(res, error);
  }
}

export async function postWithdraw(req, res) {
  try {
    const result = await withdrawCash(req.user, req.body ?? {});
    return sendSuccess(res, result);
  } catch (error) {
    logError('cash_withdraw_failed', { error, module: 'cash-session' });
    return controllerError(res, error);
  }
}

export async function postReportX(req, res) {
  try {
    const result = await buildReportX(req.user);
    return sendSuccess(res, result);
  } catch (error) {
    logError('cash_report_x_failed', { error, module: 'cash-session' });
    return controllerError(res, error);
  }
}

export async function postClose(req, res) {
  try {
    const result = await closeCashSessionDay(req.user, req.body ?? {});
    return sendSuccess(res, result);
  } catch (error) {
    logError('cash_close_failed', { error, module: 'cash-session' });
    return controllerError(res, error);
  }
}

export async function listZReports(req, res) {
  try {
    const result = await getZReportHistory(req.user, req.query ?? {});
    return sendSuccess(res, result);
  } catch (error) {
    logError('cash_z_list_failed', { error, module: 'cash-session' });
    return controllerError(res, error);
  }
}

export async function getZReport(req, res) {
  try {
    const result = await getZReportDetail(req.user, req.params.id);
    return sendSuccess(res, result);
  } catch (error) {
    logError('cash_z_get_failed', { error, module: 'cash-session' });
    return controllerError(res, error);
  }
}
