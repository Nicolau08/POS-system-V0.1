const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

function toSafeInt(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.trunc(parsed);
}

export function parsePagination(query = {}) {
  const hasPagination =
    query.page !== undefined ||
    query.limit !== undefined;

  const page = Math.max(1, toSafeInt(query.page, DEFAULT_PAGE));
  const requestedLimit = Math.max(1, toSafeInt(query.limit, DEFAULT_LIMIT));
  const limit = Math.min(requestedLimit, MAX_LIMIT);
  const offset = (page - 1) * limit;

  return {
    hasPagination,
    page,
    limit,
    offset,
  };
}

export function parseBooleanFilter(value) {
  if (value === undefined || value === null || value === '') return null;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'sim'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'nao', 'não'].includes(normalized)) return false;
  return null;
}

export function parseSearchTerm(value) {
  const search = String(value ?? '').trim();
  return search || null;
}

export function parseDateFilter(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

export function withPaginationPayload(data, { page, limit, total }) {
  const safeTotal = Math.max(0, Number(total ?? 0));
  const totalPages = Math.max(1, Math.ceil(safeTotal / Math.max(1, limit)));
  return {
    data: data ?? [],
    pagination: {
      page,
      limit,
      total: safeTotal,
      totalPages,
    },
  };
}
