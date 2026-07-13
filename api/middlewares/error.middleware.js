import { ApiError, HttpError, sendError } from '../utils/response.js';
import { logError, logWarn } from '../utils/logger.js';

export function notFoundHandler(req, res) {
  logWarn('http_route_not_found', {
    event: 'http.route_not_found',
    message: `Rota não encontrada: ${req.method} ${req.originalUrl}`,
    module: 'http',
    action: 'notFound',
    reason: 'O cliente pediu um endpoint que não existe nesta API',
    request_id: req.requestId ?? null,
    method: req.method,
    path: req.originalUrl,
    who: req.user ?? null,
    tenant_id: req.tenantId ?? req.user?.tenant_id ?? null,
  });
  return sendError(res, 404, `Rota não encontrada: ${req.originalUrl}`, 'ROUTE_NOT_FOUND');
}

export function globalErrorHandler(err, req, res, _next) {
  if (err instanceof ApiError || err instanceof HttpError) {
    if (Number(err.status) >= 500) {
      logError('http_handled_error', {
        event: 'http.handled_error',
        message: err.message || 'Erro HTTP tratado',
        module: 'http',
        action: 'globalErrorHandler',
        reason: err.code || 'Erro de negócio/API com status elevado',
        request_id: req?.requestId ?? null,
        status_code: err.status,
        code: err.code,
        who: req?.user ?? null,
        error: err,
      });
    }
    return sendError(res, err.status, err.message, err.code);
  }

  logError('http_unhandled_error', {
    event: 'http.unhandled_error',
    message: 'Erro interno não tratado na API',
    module: 'http',
    action: 'globalErrorHandler',
    reason: 'Excepção sem HttpError/ApiError — possível bug ou falha de infraestrutura',
    request_id: req?.requestId ?? null,
    method: req?.method ?? null,
    path: req?.originalUrl ?? null,
    who: req?.user ?? null,
    tenant_id: req?.tenantId ?? req?.user?.tenant_id ?? null,
    error: err,
  });

  return sendError(res, 500, 'Erro interno do servidor', 'INTERNAL_ERROR');
}
