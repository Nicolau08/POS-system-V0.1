import { getReportCustomers, getReportFilters, getReportSales } from '../services/reports.service.js';
import { sendError, sendSuccess } from '../utils/response.js';
import { logError } from '../utils/logger.js';

function controllerError(res, error) {
  logError('controller_error', {
    module: 'reports',
    reason: 'Erro não tratado no controller',
    error,
  });
  return sendError(res, 500, 'Erro interno do servidor', 'INTERNAL_ERROR');
}

export async function getReportsFilters(req, res) {
  try {
    const payload = await getReportFilters(req.user ?? null);
    return sendSuccess(res, payload);
  } catch (error) {
    return controllerError(res, error);
  }
}

export async function getReportsCustomers(req, res) {
  try {
    const payload = await getReportCustomers(req.query ?? {}, req.user ?? null);
    return sendSuccess(res, payload);
  } catch (error) {
    return controllerError(res, error);
  }
}

export async function getReportsSales(req, res) {
  try {
    const payload = await getReportSales(req.query ?? {}, req.user ?? null);
    return sendSuccess(res, payload);
  } catch (error) {
    return controllerError(res, error);
  }
}
