export function unwrapApiSuccessPayload<T = unknown>(payload: unknown): T {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return payload as T;
  }
  const candidate = payload as Record<string, unknown>;
  if (typeof candidate.success !== 'boolean') {
    return payload as T;
  }
  if (candidate.success) {
    return candidate.data as T;
  }
  const errorObject =
    candidate.error && typeof candidate.error === 'object'
      ? (candidate.error as Record<string, unknown>)
      : null;
  const message = String(errorObject?.message ?? 'Erro API');
  throw new Error(message);
}
