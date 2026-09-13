import crypto from 'crypto';
import { getOrCreateDefaultTenantId } from '../database.js';
import { HttpError } from '../utils/response.js';
import { logAudit, logError, logEvent } from '../utils/logger.js';
import { createBackup } from '../utils/backup.js';
import {
  closeCashSession,
  getCashSessionById,
  getNextZNumber,
  getOpenCashSession,
  getZReportById,
  insertCashSession,
  insertCashMovement,
  insertWithdrawal,
  insertZReport,
  listCashMovements,
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
  if (role === 'garcom' || role === 'consulta' || role === 'cozinha') {
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
  const raw = String(paymentMethod ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  if (!raw) return false;
  // Pagamentos mistos: "dinheiro + m-pesa" conta como tendo dinheiro.
  return (
    raw === 'cash' ||
    raw.includes('cash') ||
    raw.includes('dinheiro') ||
    raw.includes('numerario') ||
    raw.includes('especie')
  );
}

function businessDateKey(isoOrDate = new Date()) {
  const d = isoOrDate instanceof Date ? isoOrDate : new Date(isoOrDate);
  if (Number.isNaN(d.getTime())) {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  }
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function isPriorBusinessDay(openedAtIso) {
  return businessDateKey(openedAtIso) < businessDateKey(new Date());
}

function tenderLabel(paymentMethod) {
  const raw = String(paymentMethod ?? '').trim();
  if (!raw) return 'OUTROS';
  const lower = raw.toLowerCase();
  if (isCashTender(raw)) return 'Dinheiro';
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

const CASH_IN_KINDS = new Set(['in', 'float', 'advance_in']);
const CASH_OUT_KINDS = new Set(['out', 'advance_out']);

function movementDirection(kind) {
  if (CASH_IN_KINDS.has(kind)) return 1;
  if (CASH_OUT_KINDS.has(kind)) return -1;
  return 0;
}

function mapMovement(row) {
  return {
    id: row.id,
    kind: row.kind,
    amount: Number(row.amount) || 0,
    note: row.note,
    partyKind: row.party_kind,
    partyName: row.party_name,
    userId: row.user_id,
    userName: row.user_name,
    createdAt: row.created_at,
  };
}

const LEDGER_LABELS = {
  sale: 'Venda em dinheiro',
  in: 'Entrada',
  out: 'Saída',
  float: 'Fundo de maneio',
  advance_in: 'Adiantamento de cliente',
  advance_out: 'Adiantamento a fornecedor',
  withdraw: 'Saque',
};

function buildLedger(sales, withdrawals, movements) {
  const rows = [];
  for (const sale of sales) {
    if (!isCashTender(sale.payment_method)) continue;
    rows.push({
      id: `sale-${sale.id}`,
      source: 'sale',
      kind: 'sale',
      amount: round2(sale.total),
      direction: 1,
      label: LEDGER_LABELS.sale,
      note: sale.doc_type ? String(sale.doc_type).toUpperCase() : null,
      partyName: null,
      userName: sale.user_name || null,
      createdAt: sale.data,
    });
  }
  for (const movement of movements) {
    const kind = String(movement.kind);
    const direction = CASH_OUT_KINDS.has(kind) ? -1 : 1;
    rows.push({
      id: movement.id,
      source: 'movement',
      kind,
      amount: round2(movement.amount),
      direction,
      label: LEDGER_LABELS[kind] || kind,
      note: movement.note || null,
      partyName: movement.party_name || movement.partyName || null,
      userName: movement.user_name || movement.userName || null,
      createdAt: movement.created_at || movement.createdAt,
    });
  }
  for (const withdrawal of withdrawals) {
    rows.push({
      id: withdrawal.id,
      source: 'withdraw',
      kind: 'withdraw',
      amount: round2(withdrawal.amount),
      direction: -1,
      label: String(withdrawal.scope) === 'all' ? 'Saque (todos)' : 'Saque',
      note: withdrawal.note || null,
      partyName: null,
      userName: withdrawal.user_name || null,
      createdAt: withdrawal.created_at,
    });
  }
  rows.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  return rows;
}

function buildTotals(sales, withdrawals, { currentUserId = null, movements = [] } = {}) {
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
    const uname = String(sale.user_name || 'Operador');
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
  const movementIn = round2(
    movements
      .filter((m) => CASH_IN_KINDS.has(String(m.kind)))
      .reduce((acc, m) => acc + (Number(m.amount) || 0), 0),
  );
  const movementOut = round2(
    movements
      .filter((m) => CASH_OUT_KINDS.has(String(m.kind)))
      .reduce((acc, m) => acc + (Number(m.amount) || 0), 0),
  );
  const floatTotal = round2(
    movements
      .filter((m) => String(m.kind) === 'float')
      .reduce((acc, m) => acc + (Number(m.amount) || 0), 0),
  );
  const cashAvailable = round2(Math.max(0, cashSalesTotal + movementIn - movementOut - withdrawnTotal));

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
    movementIn,
    movementOut,
    floatTotal,
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
  const movementRows = await listCashMovements(session.id);
  const totals = buildTotals(sales, withdrawals, {
    currentUserId: actorUser?.id,
    movements: movementRows,
  });
  const priorDayPending =
    !session.closed_at &&
    isPriorBusinessDay(session.opened_at) &&
    Number(totals.cashAvailable || 0) > 0.001;

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
    dayCarryOver: priorDayPending
      ? {
          pending: true,
          openedAt: session.opened_at,
          businessDate: businessDateKey(session.opened_at),
          today: businessDateKey(new Date()),
          cashAvailable: Number(totals.cashAvailable || 0),
          message:
            'O caixa de ontem não foi esvaziado. Retire o valor em dinheiro para o sistema passar ao dia de hoje. Enquanto isso, movimentos de caixa ficam bloqueados.',
        }
      : { pending: false, cashAvailable: Number(totals.cashAvailable || 0) },
    withdrawals: withdrawals.map((w) => ({
      id: w.id,
      amount: Number(w.amount) || 0,
      scope: w.scope,
      userId: w.user_id,
      userName: w.user_name,
      createdAt: w.created_at,
      note: w.note,
    })),
    movements: movementRows.map(mapMovement),
    ledger: buildLedger(sales, withdrawals, movementRows),
  };
}

export async function ensureCashSession(actorUser) {
  assertStationCanOperateCash(actorUser);
  const tenantId = await resolveTenantId(actorUser);
  const user = normalizeUser(actorUser);
  const registerCode = resolveRegisterCode(actorUser);
  let session = await getOpenCashSession(tenantId, registerCode);
  let created = false;

  if (session && isPriorBusinessDay(session.opened_at)) {
    const probe = await loadSessionSnapshot(tenantId, session, actorUser);
    // Dia anterior sem dinheiro: fecha e abre o dia de hoje automaticamente.
    if (Number(probe.totals?.cashAvailable || 0) <= 0.001) {
      const now = new Date().toISOString();
      const maxRow = await getNextZNumber(tenantId);
      const zNumber = Number(maxRow?.max_z ?? 0) + 1;
      await closeCashSession(tenantId, session.id, {
        closedAt: now,
        closedById: user.id,
        closedByName: user.name,
        zNumber,
      });
      session = null;
    }
  }

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
    return { session: null, totals: null, withdrawals: [], movements: [], ledger: [] };
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
  const priorDayPending = Boolean(snapshot.dayCarryOver?.pending);
  // Fecho de dia anterior: saque total do caixa.
  const effectiveScope = priorDayPending ? 'all' : scope;
  const available =
    effectiveScope === 'all' ? snapshot.totals.cashAvailable : snapshot.totals.userCashAvailable;
  const requested =
    priorDayPending || payload.amount == null || payload.amount === ''
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
    scope: effectiveScope,
    note: payload.note
      ? String(payload.note)
      : priorDayPending
        ? 'Saque do caixa do dia anterior'
        : effectiveScope === 'all'
          ? 'Saque de todos os utilizadores'
          : 'Saque do operador',
    created_at: new Date().toISOString(),
  });

  await logAudit('CASH_WITHDRAWAL', actorUser, {
    entity: 'cash_session',
    entity_id: session.id,
    description: `Saque ${effectiveScope}: ${requested.toFixed(2)}`,
    amount: requested,
    scope: effectiveScope,
  });

  logEvent('info', 'cash.withdrawal', `Saque registado (${effectiveScope}): ${requested.toFixed(2)}`, {
    module: 'cash-session',
    action: 'withdrawCash',
    who: actorUser,
    tenant_id: tenantId,
    entity: 'cash_withdrawal',
    entity_id: row.id,
    amount: requested,
    scope: effectiveScope,
  });

  let next = await loadSessionSnapshot(tenantId, session, actorUser);

  // Após esvaziar o caixa de ontem → fecha a sessão e abre o dia de hoje.
  if (priorDayPending && Number(next.totals?.cashAvailable || 0) <= 0.001) {
    const now = new Date().toISOString();
    const maxRow = await getNextZNumber(tenantId);
    const zNumber = Number(maxRow?.max_z ?? 0) + 1;
    await closeCashSession(tenantId, session.id, {
      closedAt: now,
      closedById: user.id,
      closedByName: user.name,
      zNumber,
    });
    next = await ensureCashSession(actorUser);
    next.dayAdvanced = true;
  }

  return { withdrawal: row, ...next };
}

const MOVEMENT_KINDS = new Set(['in', 'out', 'float', 'advance_in', 'advance_out']);

export async function createCashMovement(actorUser, payload = {}) {
  assertStationCanOperateCash(actorUser);
  const tenantId = await resolveTenantId(actorUser);
  const user = normalizeUser(actorUser);
  const kind = String(payload.kind ?? '').trim();
  if (!MOVEMENT_KINDS.has(kind)) {
    throw new HttpError(400, 'Tipo de movimento inválido', 'INVALID_MOVEMENT_KIND');
  }

  const amount = round2(payload.amount);
  if (!(amount > 0)) {
    throw new HttpError(400, 'Indique um valor maior do que zero', 'INVALID_AMOUNT');
  }

  const session = await getOpenCashSession(tenantId, resolveRegisterCode(actorUser));
  if (!session) throw new HttpError(409, 'Não existe sessão de caixa aberta', 'CASH_SESSION_CLOSED');

  const snapshot = await loadSessionSnapshot(tenantId, session, actorUser);
  if (snapshot.dayCarryOver?.pending) {
    throw new HttpError(
      409,
      snapshot.dayCarryOver.message ||
        'Caixa do dia anterior não esvaziado. Retire o valor antes de fazer movimentos.',
      'CASH_DAY_PENDING_WITHDRAW',
    );
  }
  if (movementDirection(kind) < 0 && amount > Number(snapshot.totals.cashAvailable || 0) + 0.001) {
    throw new HttpError(
      400,
      `Saída excede o dinheiro em caixa (${Number(snapshot.totals.cashAvailable || 0).toFixed(2)})`,
      'MOVEMENT_EXCEEDS',
    );
  }

  const partyKindRaw = String(payload.partyKind ?? payload.party_kind ?? '').trim();
  const partyKind =
    partyKindRaw === 'customer' || partyKindRaw === 'supplier' ? partyKindRaw : kind === 'advance_in'
      ? 'customer'
      : kind === 'advance_out'
        ? 'supplier'
        : null;
  const partyName = String(payload.partyName ?? payload.party_name ?? '').trim() || null;
  const note = String(payload.note ?? '').trim() || null;

  const row = await insertCashMovement({
    id: crypto.randomUUID(),
    session_id: session.id,
    tenant_id: tenantId,
    kind,
    amount,
    note,
    party_kind: partyKind,
    party_name: partyName,
    user_id: user.id,
    user_name: user.name,
    created_at: new Date().toISOString(),
  });

  await logAudit('CASH_MOVEMENT', actorUser, {
    entity: 'cash_movement',
    entity_id: row.id,
    description: `Movimento de caixa (${kind}): ${amount.toFixed(2)}`,
    amount,
    kind,
  });

  logEvent('info', 'cash.movement', `Movimento de caixa (${kind}): ${amount.toFixed(2)}`, {
    module: 'cash-session',
    action: 'createCashMovement',
    who: actorUser,
    tenant_id: tenantId,
    entity: 'cash_movement',
    entity_id: row.id,
    amount,
    kind,
  });

  const next = await loadSessionSnapshot(tenantId, session, actorUser);
  return { movement: mapMovement(row), ...next };
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
    printItems: true,
    printZ: true,
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
    movements: snapshot.movements,
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

  // Snapshot pós-fecho: protege o dia de vendas mesmo se o disco falhar depois.
  let backup = null;
  try {
    backup = await createBackup();
    await logAudit('BACKUP_CREATE', actorUser, {
      entity: 'database',
      entity_id: 'main',
      description: `Backup automático após fecho de caixa Z nº ${zNumber}`,
      backup_file: backup.fileName,
      backup_path: backup.filePath,
      mode: 'cash_close',
      z_number: zNumber,
    });
    logEvent('info', 'cash.close_backup', `Backup após fecho Z nº ${zNumber}: ${backup.fileName}`, {
      module: 'cash-session',
      action: 'closeCashSessionDay',
      who: actorUser,
      tenant_id: tenantId,
      backup_file: backup.fileName,
      z_number: zNumber,
    });
  } catch (backupError) {
    const msg = backupError instanceof Error ? backupError.message : String(backupError);
    logError('cash_close_backup_failed', {
      error: msg,
      z_number: zNumber,
      tenant_id: tenantId,
    });
    await logAudit('BACKUP_CREATE_FAILED', actorUser, {
      entity: 'database',
      entity_id: 'main',
      description: `Backup falhou após fecho Z nº ${zNumber}`,
      mode: 'cash_close',
      z_number: zNumber,
      error: msg,
    }).catch(() => undefined);
  }

  return {
    zReportId: zId,
    zNumber,
    report: zPayload,
    backup: backup
      ? { fileName: backup.fileName, filePath: backup.filePath, createdAt: backup.createdAt }
      : null,
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
