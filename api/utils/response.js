function defaultErrorCodeByStatus(status) {
  switch (Number(status)) {
    case 400:
      return 'BAD_REQUEST';
    case 401:
      return 'UNAUTHORIZED';
    case 403:
      return 'FORBIDDEN';
    case 404:
      return 'NOT_FOUND';
    case 409:
      return 'CONFLICT';
    case 422:
      return 'UNPROCESSABLE_ENTITY';
    case 429:
      return 'TOO_MANY_REQUESTS';
    default:
      return 'INTERNAL_ERROR';
  }
}

function normalizeSuccessData(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return payload;
  if (!Object.prototype.hasOwnProperty.call(payload, 'success')) return payload;
  if (typeof payload.success !== 'boolean') return payload;
  const { success: _success, ...rest } = payload;
  return rest;
}

export class ApiError extends Error {
  constructor(status, message, code, data = null) {
    super(message);
    this.name = 'ApiError';
    this.status = Number(status) || 500;
    this.code = String(code || defaultErrorCodeByStatus(this.status));
    this.data = data ?? null;
  }
}

// Compatibilidade com codigo legado que usa HttpError.
export class HttpError extends ApiError {}

export function sendSuccess(res, data, status = 200) {
  return res.status(Number(status) || 200).json({
    success: true,
    data: normalizeSuccessData(data),
    error: null,
  });
}

export function sendError(res, status, message, code, data = null) {
  const safeStatus = Number(status) || 500;
  return res.status(safeStatus).json({
    success: false,
    data: data ?? null,
    error: {
      message: String(message ?? 'Erro interno do servidor'),
      code: String(code || defaultErrorCodeByStatus(safeStatus)),
    },
  });
}

export function handleControllerError(res, error) {
  if (error instanceof ApiError || error instanceof HttpError) {
    return sendError(res, error.status, error.message, error.code, error.data ?? null);
  }
  return sendError(res, 500, 'Erro interno do servidor', 'INTERNAL_ERROR');
}
