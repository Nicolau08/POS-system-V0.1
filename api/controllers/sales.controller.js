import { createSale, listSales, updateSalePaymentStatus } from '../services/sales.service.js';
import { logAudit, logError } from '../utils/logger.js';
import { sendError, sendSuccess } from '../utils/response.js';

function controllerError(res, error) {
  console.error('❌ controller error:', error);
  return sendError(res, 500, 'Erro interno do servidor', 'INTERNAL_ERROR');
}

export async function getSales(req, res) {
  try {
    const rows = await listSales(req.query ?? {}, req.user);
    return sendSuccess(res, rows ?? []);
  } catch (error) {
    return controllerError(res, error);
  }
}

export async function patchSalePaymentStatus(req, res) {
  try {
    const result = await updateSalePaymentStatus(req.params?.id, req.body?.paid, req.user);
    if (result?.error) return sendError(res, result.status ?? 400, result.error, result.code);
    await logAudit('SALE_PAYMENT_STATUS_UPDATE', req.user, {
      entity: 'sale',
      entity_id: String(req.params?.id ?? ''),
      description: 'Sale payment status updated',
      paid: Boolean(req.body?.paid),
      status: result?.status ?? null,
    });
    return sendSuccess(res, result);
  } catch (error) {
    logError('update_sale_payment_status_error', { error: error?.message ?? String(error), sale_id: req.params?.id });
    return controllerError(res, error);
  }
}

export async function postSale(req, res) {
  try {
    const idempotencyKey = req.headers['x-idempotency-key'];
    const result = await createSale(req.body ?? {}, req.user, { idempotencyKey });
    if (result?.error) return sendError(res, result.status ?? 500, result.error, result.code);
    return sendSuccess(res, result);
  } catch (error) {
    logError('create_sale_error', { error: error?.message ?? String(error) });
    return controllerError(res, error);
  }
}
