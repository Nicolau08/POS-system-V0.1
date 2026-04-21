import { parsePagination, parseSearchTerm, withPaginationPayload } from './queryOptions.service.js';
import { HttpError } from '../utils/httpResponse.js';
import {
  countPermissionRules,
  listPermissionRules,
  listPermissionRulesPaginated,
  upsertPermissionRule,
} from '../repositories/permission-rules.repository.js';

function normalize(rows) {
  return (rows ?? []).map((row) => ({
    key: String(row.key),
    required_level: Number(row.required_level ?? 0),
  }));
}

export async function getPermissionRules(query = {}) {
  const pagination = parsePagination(query);
  const search = parseSearchTerm(query.search);
  const where = [];
  const params = [];

  if (search) {
    where.push(`LOWER(COALESCE(key, '')) LIKE LOWER(?)`);
    params.push(`%${search}%`);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  if (!pagination.hasPagination) {
    const rows = await listPermissionRules(whereSql, params);
    return normalize(rows);
  }

  const rows = await listPermissionRulesPaginated(whereSql, params, pagination.limit, pagination.offset);
  const total = await countPermissionRules(whereSql, params);
  return withPaginationPayload(normalize(rows), {
    page: pagination.page,
    limit: pagination.limit,
    total,
  });
}

export async function putPermissionRules(payload = {}) {
  const rulesInput = payload.rules ?? payload;
  const rulesArray = Array.isArray(rulesInput) ? rulesInput : payload.rules;
  if (!Array.isArray(rulesArray)) {
    throw new HttpError(400, 'payload.rules precisa ser um array');
  }

  const now = new Date().toISOString();
  const normalized = rulesArray
    .filter((rule) => rule && rule.key != null)
    .map((rule) => ({
      key: String(rule.key),
      required_level: Number(rule.required_level ?? rule.requiredLevel ?? 0),
    }));

  if (normalized.length === 0) {
    throw new HttpError(400, 'nenhuma regra fornecida');
  }

  let updated = 0;
  for (const rule of normalized) {
    const level = Math.max(0, Math.min(9, Number.isFinite(rule.required_level) ? rule.required_level : 0));
    await upsertPermissionRule({
      key: rule.key,
      requiredLevel: level,
      updatedAt: now,
    });
    updated += 1;
  }

  return { success: true, updated };
}
