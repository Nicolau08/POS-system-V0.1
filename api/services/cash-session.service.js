import crypto from 'crypto';
import { getOrCreateDefaultTenantId } from '../database.js';
import { HttpError } from '../utils/response.js';
import { logAudit, logEvent } from '../utils/logger.js';
import {
  closeCashSession,
  getCashSessionById,
  getNextZNumber,
  getOpenCashSession,
  getZReportById,
  insertCashSession,
  insertWithdrawal,
  insertZReport,
  listSessionSaleItems,
  listSessionSales,
  listWithdrawals,
  listZReports,
} from '../repositories/cash-session.repository.js';

const REGISTER_CODE = 'caixa-1';

function resolveRegisterCode(actorUser, payload) {
  const fromUser = String(actorUser?.station_code ?? '').trim();
  if (fromUser) return fromUser;
  const fromPayload = String(payload?.register_code ?? payload?.registerCode ?? '').trim();
  if (fromPayload) return fromPayload;
  return REGISTER_CODE;
}

function normalizeStationRole(actorUser) {
  return String(actorUser?.station_role ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function assertStationCanOperateCash(actorUser) {
  const role = normalizeStationRole(actorUser);
  if (role === 'garcom' || role === 'consulta') {
    throw new HttpError(403, 'Só postos com papel Caixa podem operar a sessão de caixa.');
  }
}

async function resolveTenantId(actorUser) {
  const fromUser = String(actorUser?.tenant_id ?? '').trim();
  if (fromUser) return fromUser;
  return getOrCreateDefaultTenantId();
}

function normalizeUser(actorUser) {
  return {
    id: actorUser?.id == null ? null : String(actorUser.id),
    name: actorUser?.name == null ? null : String(actorUser.name),
  };
}

function isCashTender(paymentMethod) {
  const raw = String(paymentMethod ?? '').trim().toLowerCase();
  if (!raw) return false;
  return (
    raw === 'cash' ||
    raw.includes('dinheiro') ||
    raw.includes('cash') ||
    raw.includes('numerario')
  );
}

function tenderLabel(paymentMethod) {
  const raw = String(paymentMethod ?? '').trim();
  if (!raw) return 'OUTROS';
  const lower = raw.toLowerCase();
  if (isCashTender(raw)) return 'DINHEIRO';
  if (lower.includes('conta corrente') || lower.includes('conta-corrente') || lower === 'account') {
    return 'CONTA CORRENTE';
  }
  if (lower.includes('cart') || lower === 'cc' || lower.includes('card') || lower.includes('visa')) {
    return 'CC';
  }
  if (lower.includes('mpesa') || lower.includes('m-pesa')) return 'M-PESA';
  return raw.toUpperCase();
}

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function buildTotals(sales, withdrawals, { currentUserId = null } = {}) {
  const byTenderMap = new Map();
  const byUserMap = new Map();
  let salesTotal = 0;
  let cashSalesTotal = 0;

  for (const sale of sales) {
    const total = round2(sale.total);
    salesTotal += total;
    const label = tenderLabel(sale.payment_method);
    byTenderMap.set(label, round2((byTenderMap.get(label) || 0) + total));
    if (isCashTender(sale.payment_method)) cashSalesTotal += total;

    const uid = String(sale.user_id ?? 'unknown');
    const uname = String(sale.user_name || 'Operador').toUpperCase();
    if (!byUserMap.has(uid)) {
      byUserMap.set(uid, { userId: uid, userName: uname, byTender: {}, total: 0, cashTotal: 0 });
    }
    const bucket = byUserMap.get(uid);
    bucket.byTender[label] = round2((bucket.byTender[label] || 0) + total);
    bucket.total = round2(bucket.total + total);
    if (isCashTender(sale.payment_method)) bucket.cashTotal = round2(bucket.cashTotal + total);
  }

  const withdrawnTotal = round2(
    withdrawals.reduce((acc, w) => acc + (Number(w.amount) || 0), 0),
  );
  const cashAvailable = round2(Math.max(0, cashSalesTotal - withdrawnTotal));

  let userCashSales = 0;
  let userWithdrawn = 0;
  if (currentUserId) {
    const uid = String(currentUserId);
    userCashSales = round2(byUserMap.get(uid)?.cashTotal || 0);
    userWithdrawn = round2(
      withdrawals
        .filter((w) => String(w.user_id ?? '') === uid || w.scope === 'all')
        .reduce((acc, w) => {
          if (w.scope === 'all') return acc;
          return acc + (Number(w.amount) || 0);
        }, 0),
    );
  }
  const userCashAvailable = round2(
    Math.max(0, Math.min(userCashSales - userWithdrawn, cashAvailable)),
  );

  const byTender = Array.from(byTenderMap.entries())
    .map(([label, amount]) => ({ label, amount: round2(amount) }))
    .sort((a, b) => b.amount - a.amount);

  const byUser = Array.from(byUserMap.values())
    .map((u) => ({
      ...u,
      byTender: Object.entries(u.byTender)
        .map(([label, amount]) => ({ label, amount: round2(amount) }))
        .sort((a, b) => b.amount - a.amount),
    }))
    .sort((a, b) => b.total - a.total);

  return {
    salesTotal: round2(salesTotal),
    cashSalesTotal: round2(cashSalesTotal),
    withdrawnTotal,
    cashAvailable,
    userCashAvailable,
    byTender,
    byUser,
    saleCount: sales.length,
  };
}

async function loadSessionSnapshot(tenantId, session, actorUser = null) {
  const sales = await listSessionSales(tenantId, session.opened_at, session.closed_at);
  const withdrawals = await listWithdrawals(session.id);
  const totals = buildTotals(sales, withdrawals, { currentUserId: actorUser?.id });
  return {
    session: {
      id: session.id,
      tenantId: session.tenant_id,
      registerCode: session.register_code,
      status: session.status,
      openedAt: session.opened_at,
      openedById: session.opened_by_id,
      openedByName: session.opened_by_name,
      closedAt: session.closed_at,
      closedById: session.closed_by_id,
      closedByName: session.closed_by_name,
      zNumber: session.z_number,
    },
    totals,
    withdrawals: withdrawals.map((w) => ({
      id: w.id,
      amount: Number(w.amount) || 0,
      scope: w.scope,
      userId: w.user_id,
      userName: w.user_name,
      createdAt: w.created_at,
      note: w.note,
    })),
  };
}

export async function ensureCashSession(actorUser) {
  assertStationCanOperateCash(actorUser);
  const tenantId = await resolveTenantId(actorUser);
  const user = normalizeUser(actorUser);
  const registerCode = resolveRegisterCode(actorUser);
  let session = await getOpenCashSession(tenantId, registerCode);
  let created = false;
  if (!session) {
    const now = new Date().toISOString();
    session = {
      id: crypto.randomUUID(),
      tenant_id: tenantId,
      register_code: registerCode,
      status: 'open',
      opened_at: now,
      opened_by_id: user.id,
      opened_by_name: user.name,
      closed_at: null,
      closed_by_id: null,
      closed_by_name: null,
      z_number: null,
    };
    await insertCashSession(session);
    created = true;
    logEvent('info', 'cash.session_opened', 'Sessão de caixa aberta automaticamente', {
      source: 'api',
      module: 'cash-session',
      action: 'ensureCashSession',
      reason: created ? 'Nenhuma sessão aberta — abertura automática' : 'Sessão já existia',
      who: actorUser,
      tenant_id: tenantId,
      entity: 'cash_session',
      entity_id: session.id,
    });
    await logAudit('CASH_SESSION_OPEN', actorUser, {
      entity: 'cash_session',
      entity_id: session.id,
      description: 'Sessão de caixa aberta',
    });
  }
  const snapshot = await loadSessionSnapshot(tenantId, session, actorUser);
  return { ...snapshot, created };
}

export async function getCashSession(actorUser) {
  const tenantId = await resolveTenantId(actorUser);
  const session = await getOpenCashSession(tenantId, resolveRegisterCode(actorUser));
  if (!session) {
    return { session: null, totals: null, withdrawals: [] };
  }
  return loadSessionSnapshot(tenantId, session, actorUser);
}

export async function withdrawCash(actorUser, payload = {}) {
  assertStationCanOperateCash(actorUser);
  const tenantId = await resolveTenantId(actorUser);
  const user = normalizeUser(actorUser);
  const scope = String(payload.scope ?? 'user') === 'all' ? 'all' : 'user';
  const session = await getOpenCashSession(tenantId, resolveRegisterCode(actorUser));
  if (!session) throw new HttpError(409, 'Não existe sessão de caixa aberta', 'CASH_SESSION_CLOSED');

  const snapshot = await loadSessionSnapshot(tenantId, session, actorUser);
  const available =
    scope === 'all' ? snapshot.totals.cashAvailable : snapshot.totals.userCashAvailable;
  const requested =
    payload.amount == null || payload.amount === ''
      ? available
      : round2(payload.amount);

  if (!(requested > 0)) {
    throw new HttpError(400, 'Não há valor em dinheiro disponível para saque', 'NO_CASH');
  }
  if (requested > available + 0.001) {
    throw new HttpError(400, `Saque excede o disponível (${available.toFixed(2)})`, 'WITHDRAW_EXCEEDS');
  }

  const row = await insertWithdrawal({
    id: crypto.randomUUID(),
    session_id: session.id,
    tenant_id: tenantId,
    user_id: user.id,
    user_name: user.name,
    amount: requested,
    scope,
    note: payload.note ? String(payload.note) : scope === 'all' ? 'Saque de todos os utilizadores' : 'Saque do operador',
    created_at: new Date().toISOString(),
  });

  await logAudit('CASH_WITHDRAWAL', actorUser, {
    entity: 'cash_session',
    entity_id: session.id,
    description: `Saque ${scope}: ${requested.toFixed(2)}`,
    amount: requested,
    scope,
  });

  logEvent('info', 'cash.withdrawal', `Saque registado (${scope}): ${requested.toFixed(2)}`, {
    module: 'cash-session',
    action: 'withdrawCash',
    who: actorUser,
    tenant_id: tenantId,
    entity: 'cash_withdrawal',
    entity_id: row.id,
    amount: requested,
    scope,
  });

  const next = await loadSessionSnapshot(tenantId, session, actorUser);
  return { withdrawal: row, ...next };
}

export async function buildReportX(actorUser) {
  const tenantId = await resolveTenantId(actorUser);
  const session = await getOpenCashSession(tenantId, resolveRegisterCode(actorUser));
  if (!session) throw new HttpError(409, 'Não existe sessão de caixa aberta', 'CASH_SESSION_CLOSED');
  const snapshot = await loadSessionSnapshot(tenantId, session, actorUser);
  const items = await listSessionSaleItems(tenantId, session.opened_at, null);

  await logAudit('CASH_X_REPORT', actorUser, {
    entity: 'cash_session',
    entity_id: session.id,
    description: 'Relatório X gerado (sessão aberta)',
  });

  return {
    type: 'X',
    generatedAt: new Date().toISOString(),
    ...snapshot,
    items: items.map((i) => ({
      name: i.name,
      quantity: Number(i.quantity) || 0,
      total: round2(i.total),
    })),
  };
}

export async function closeCashSessionDay(actorUser, payload = {}) {
  assertStationCanOperateCash(actorUser);
  const tenantId = await resolveTenantId(actorUser);
  const user = normalizeUser(actorUser);
  const printItems = payload.printItems !== false;
  const printZ = payload.printZ !== false;

  const session = await getOpenCashSession(tenantId, resolveRegisterCode(actorUser));
  if (!session) throw new HttpError(409, 'Não existe sessão de caixa aberta', 'CASH_SESSION_CLOSED');

  const closedAt = new Date().toISOString();
  const snapshot = await loadSessionSnapshot(tenantId, session, actorUser);
  const items = printItems
    ? await listSessionSaleItems(tenantId, session.opened_at, closedAt)
    : [];

  const maxRow = await getNextZNumber(tenantId);
  const zNumber = Number(maxRow?.max_z ?? 0) + 1;
  const zId = crypto.randomUUID();

  const zPayload = {
    type: 'Z',
    zNumber,
    generatedAt: closedAt,
    printItems,
    printZ,
    session: {
      ...snapshot.session,
      closedAt,
      closedById: user.id,
      closedByName: user.name,
      zNumber,
      status: 'closed',
    },
    totals: snapshot.totals,
    withdrawals: snapshot.withdrawals,
    items: items.map((i) => ({
      name: i.name,
      quantity: Number(i.quantity) || 0,
      total: round2(i.total),
    })),
  };

  await insertZReport({
    id: zId,
    session_id: session.id,
    tenant_id: tenantId,
    z_number: zNumber,
    generated_at: closedAt,
    generated_by_id: user.id,
    generated_by_name: user.name,
    payload_json: JSON.stringify(zPayload),
  });

  await closeCashSession(tenantId, session.id, {
    closedAt,
    closedById: user.id,
    closedByName: user.name,
    zNumber,
  });

  await logAudit('CASH_Z_CLOSE', actorUser, {
    entity: 'z_report',
    entity_id: zId,
    description: `Fecho de caixa — Relatório Z nº ${zNumber}`,
    z_number: zNumber,
  });

  logEvent('info', 'cash.session_closed', `Caixa fechado — Relatório Z nº ${zNumber}`, {
    module: 'cash-session',
    action: 'closeCashSessionDay',
    who: actorUser,
    tenant_id: tenantId,
    entity: 'z_report',
    entity_id: zId,
    z_number: zNumber,
  });

  return {
    zReportId: zId,
    zNumber,
    report: zPayload,
  };
}

export async function getZReportHistory(actorUser, query = {}) {
  const tenantId = await resolveTenantId(actorUser);
  const rows = await listZReports(tenantId, {
    from: query.from || null,
    to: query.to || null,
    limit: query.limit,
  });
  return {
    items: rows.map((r) => ({
      id: r.id,
      sessionId: r.session_id,
      zNumber: r.z_number,
      generatedAt: r.generated_at,
      generatedById: r.generated_by_id,
      generatedByName: r.generated_by_name,
    })),
  };
}

export async function getZReportDetail(actorUser, id) {
  const tenantId = await resolveTenantId(actorUser);
  const row = await getZReportById(tenantId, id);
  if (!row) throw new HttpError(404, 'Relatório Z não encontrado', 'Z_NOT_FOUND');
  let payload = null;
  try {
    payload = JSON.parse(row.payload_json);
  } catch {
    payload = null;
  }
  return {
    id: row.id,
    zNumber: row.z_number,
    generatedAt: row.generated_at,
    generatedById: row.generated_by_id,
    generatedByName: row.generated_by_name,
    report: payload,
  };
}

export async function getClosedSessionSnapshot(actorUser, sessionId) {
  const tenantId = await resolveTenantId(actorUser);
  const session = await getCashSessionById(tenantId, sessionId);
  if (!session) throw new HttpError(404, 'Sessão não encontrada', 'SESSION_NOT_FOUND');
  return loadSessionSnapshot(tenantId, session, actorUser);
}
