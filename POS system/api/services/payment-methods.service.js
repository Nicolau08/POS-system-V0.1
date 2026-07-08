import { parseBooleanFilter, parsePagination, parseSearchTerm, withPaginationPayload } from './queryOptions.service.js';
import { HttpError } from '../utils/response.js';
import { assertTenantWrite, requireTenantId } from '../utils/tenant.js';
import {
  countPaymentMethods,
  deleteAllPaymentMethods,
  deletePaymentMethod,
  insertPaymentMethod,
  listPaymentMethods,
  listPaymentMethodsPaginated,
  updatePaymentMethod,
} from '../repositories/payment-methods.repository.js';
import { run, get, all } from '../dbUtils.js';
import {
  buildDefaultPaymentMethodInsertRows,
  DEFAULT_PAYMENT_METHOD_SPECS,
} from '../constants/paymentMethodDefaults.js';

function resolveTenantIdStrict(actorUser) {
  return requireTenantId(actorUser?.tenant_id, {
    status: 401,
    message: 'tenant_id ausente para operacao de meios de pagamento',
  });
}

function normalizePaymentMethodRow(row) {
  return {
    id: String(row.id),
    name: String(row.name ?? ''),
    code: String(row.code ?? '').toLowerCase(),
    shortcut: row.shortcut ?? null,
    position: Number(row.position ?? 1),
    enabled: Boolean(row.enabled),
    quickPayment: Boolean(row.quick_payment),
    requiredCustomer: Boolean(row.required_customer),
    allowChange: Boolean(row.allow_change),
    markAsPaid: Boolean(row.mark_as_paid),
    printReceipt: Boolean(row.print_receipt),
    openCashDrawer: Boolean(row.open_cash_drawer),
  };
}

function buildWritePayload(payload = {}, now) {
  return [
    String(payload.name ?? '').trim(),
    String(payload.code ?? '').trim().toLowerCase(),
    String(payload.shortcut ?? '').trim() || null,
    Math.max(1, Number(payload.position ?? 1) || 1),
    payload.enabled === false ? 0 : 1,
    payload.quickPayment === false ? 0 : 1,
    payload.requiredCustomer ? 1 : 0,
    payload.allowChange ? 1 : 0,
    payload.markAsPaid === false ? 0 : 1,
    payload.printReceipt === false ? 0 : 1,
    payload.openCashDrawer ? 1 : 0,
    now,
    now,
  ];
}

export async function ensureEssentialPaymentMethods(tenantId) {
  const normalizedTenantId = String(tenantId ?? '').trim();
  if (!normalizedTenantId) return;

  const now = new Date().toISOString();
  for (const spec of DEFAULT_PAYMENT_METHOD_SPECS) {
    const existing = await get(
      `SELECT id FROM payment_methods WHERE tenant_id = ? AND code = ? LIMIT 1`,
      [normalizedTenantId, spec.code],
    );
    if (existing?.id) continue;
    await insertPaymentMethod([
      spec.name,
      spec.code,
      normalizedTenantId,
      spec.shortcut,
      spec.position,
      spec.enabled,
      spec.quick_payment,
      spec.required_customer,
      spec.allow_change,
      spec.mark_as_paid,
      spec.print_receipt,
      spec.open_cash_drawer,
      now,
      now,
    ]);
  }

  // Seed antigo (cartão/PIX): desactivar para o POS seguir só Dinheiro + Conta Corrente.
  await run(
    `UPDATE payment_methods
     SET enabled = 0, updated_at = ?
     WHERE tenant_id = ?
       AND code IN ('card', 'pix')`,
    [now, normalizedTenantId],
  );
}

export async function bootstrapPaymentMethodsForAllTenants() {
  const tenants = await all(
    `SELECT id FROM tenants ORDER BY datetime(COALESCE(created_at, '1970-01-01')) ASC, id ASC`,
    [],
  );
  const ids = tenants.map((row) => String(row.id ?? '').trim()).filter(Boolean);
  if (!ids.length) {
    await ensureEssentialPaymentMethods(process.env.DEFAULT_TENANT_ID || 'tenant-1');
    return;
  }
  for (const tenantId of ids) {
    await ensureEssentialPaymentMethods(tenantId);
  }
}

export async function listAllPaymentMethods(query = {}, actorUser = null) {
  const tenantId = resolveTenantIdStrict(actorUser);
  await ensureEssentialPaymentMethods(tenantId);
  const pagination = parsePagination(query);
  const search = parseSearchTerm(query.search);
  const activeFilter = parseBooleanFilter(query.active ?? query.enabled);

  const where = ['tenant_id = ?'];
  const params = [tenantId];

  if (search) {
    const token = `%${search}%`;
    where.push(`(LOWER(COALESCE(name, '')) LIKE LOWER(?) OR LOWER(COALESCE(code, '')) LIKE LOWER(?))`);
    params.push(token, token);
  }
  if (activeFilter != null) {
    where.push(`enabled = ?`);
    params.push(activeFilter ? 1 : 0);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  if (!pagination.hasPagination) {
    const rows = await listPaymentMethods(whereSql, params);
    return rows.map(normalizePaymentMethodRow);
  }

  const rows = await listPaymentMethodsPaginated(whereSql, params, pagination.limit, pagination.offset);
  const total = await countPaymentMethods(whereSql, params);
  return withPaginationPayload(rows.map(normalizePaymentMethodRow), {
    page: pagination.page,
    limit: pagination.limit,
    total,
  });
}

export async function createPaymentMethod(payload = {}, actorUser = null) {
  const tenantId = resolveTenantIdStrict(actorUser);
  assertTenantWrite(tenantId, payload?.tenant_id ?? payload?.tenantId);
  const name = String(payload.name ?? '').trim();
  const code = String(payload.code ?? '').trim().toLowerCase();
  if (!name || !code) throw new HttpError(400, 'name e code sao obrigatorios');

  const now = new Date().toISOString();
  const insertArgs = [name, code, tenantId, ...buildWritePayload(payload, now).slice(2)];
  const result = await insertPaymentMethod(insertArgs);
  return { success: true, id: result.lastID };
}

export async function updatePaymentMethodById(idRaw, payload = {}, actorUser = null) {
  const tenantId = resolveTenantIdStrict(actorUser);
  assertTenantWrite(tenantId, payload?.tenant_id ?? payload?.tenantId);
  const id = Number(idRaw);
  const name = String(payload.name ?? '').trim();
  const code = String(payload.code ?? '').trim().toLowerCase();
  if (!Number.isFinite(id) || !name || !code) {
    throw new HttpError(400, 'id, name e code sao obrigatorios');
  }

  const now = new Date().toISOString();
  const writePayload = [
    String(payload.name ?? '').trim(),
    String(payload.code ?? '').trim().toLowerCase(),
    tenantId,
    String(payload.shortcut ?? '').trim() || null,
    Math.max(1, Number(payload.position ?? 1) || 1),
    payload.enabled === false ? 0 : 1,
    payload.quickPayment === false ? 0 : 1,
    payload.requiredCustomer ? 1 : 0,
    payload.allowChange ? 1 : 0,
    payload.markAsPaid === false ? 0 : 1,
    payload.printReceipt === false ? 0 : 1,
    payload.openCashDrawer ? 1 : 0,
    now,
  ];
  const result = await updatePaymentMethod(id, tenantId, writePayload);
  return { success: true, updated: result.changes > 0 };
}

export async function removePaymentMethod(idRaw, actorUser = null) {
  const tenantId = resolveTenantIdStrict(actorUser);
  const id = Number(idRaw);
  if (!Number.isFinite(id)) throw new HttpError(400, 'id invalido');
  const result = await deletePaymentMethod(id, tenantId);
  return { success: true, deleted: result.changes > 0 };
}

export async function resetPaymentMethodDefaults(actorUser = null) {
  const tenantId = resolveTenantIdStrict(actorUser);
  const now = new Date().toISOString();
  try {
    await run('BEGIN IMMEDIATE TRANSACTION');
    await deleteAllPaymentMethods(tenantId);

    const defaults = buildDefaultPaymentMethodInsertRows(tenantId, now);

    for (const row of defaults) {
      await insertPaymentMethod(row);
    }

    await run('COMMIT');
    return { success: true, count: defaults.length };
  } catch (err) {
    try {
      await run('ROLLBACK');
    } catch {}
    throw err;
  }
}
