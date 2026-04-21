import { ApiError, HttpError, sendError } from '../utils/response.js';

export function notFoundHandler(req, res) {
  return sendError(res, 404, `Rota não encontrada: ${req.originalUrl}`, 'ROUTE_NOT_FOUND');
}

export function globalErrorHandler(err, _req, res, _next) {
  if (err instanceof ApiError || err instanceof HttpError) {
    return sendError(res, err.status, err.message, err.code);
  }

  console.error('❌ GLOBAL ERROR:', err);
  return sendError(res, 500, 'Erro interno do servidor', 'INTERNAL_ERROR');
}
