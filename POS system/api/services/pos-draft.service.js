import { getOrCreateDefaultTenantId } from '../database.js';
import { HttpError } from '../utils/response.js';
import { logEvent } from '../utils/logger.js';
import {
  deletePosOpenDraft,
  getPosOpenDraft,
  upsertPosOpenDraft,
} from '../repositories/pos-draft.repository.js';

async function resolveTenantId(actorUser) {
  const fromUser = String(actorUser?.tenant_id ?? '').trim();
  if (fromUser) return fromUser;
  return getOrCreateDefaultTenantId();
}

function resolveUserId(actorUser, fallbackUserId) {
  const fromUser = String(actorUser?.id ?? '').trim();
  if (fromUser) return fromUser;
  const fromFallback = String(fallbackUserId ?? '').trim();
  if (fromFallback) return fromFallback;
  throw new HttpError(401, 'Utilizador obrigatório');
}

function parsePayload(raw) {
  if (raw == null || raw === '') return null;
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function cartSummary(draft) {
  const cart = Array.isArray(draft?.cart) ? draft.cart : [];
  return {
    item_count: cart.length,
    has_customer: Boolean(draft?.selectedCustomer),
  };
}

export async function getOpenPosDraft(actorUser, query = {}) {
  const tenantId = await resolveTenantId(actorUser);
  const userId = resolveUserId(actorUser, query.userId);
  const row = await getPosOpenDraft(tenantId, userId);
  if (!row) {
    return { draft: null, updatedAt: null };
  }
  return {
    draft: parsePayload(row.payload_json),
    updatedAt: row.updated_at ?? null,
  };
}

export async function saveOpenPosDraft(payload, actorUser) {
  const tenantId = await resolveTenantId(actorUser);
  const userId = resolveUserId(actorUser, payload?.userId);
  const draft = payload?.draft;
  if (!draft || typeof draft !== 'object' || Array.isArray(draft)) {
    throw new HttpError(400, 'draft inválido');
  }
  const now = new Date().toISOString();
  await upsertPosOpenDraft(tenantId, userId, JSON.stringify(draft), now);
  const summary = cartSummary(draft);
  logEvent('info', 'pos.draft.saved', `Rascunho do carrinho guardado (${summary.item_count} itens)`, {
    source: 'api',
    module: 'pos-draft.service',
    action: 'saveOpenPosDraft',
    reason: 'Persistência anti-queda de energia do carrinho aberto',
    who: actorUser,
    user_id: userId,
    tenant_id: tenantId,
    entity: 'pos_draft',
    entity_id: userId,
    persist: summary.item_count > 0,
    ...summary,
  });
  return { success: true, updatedAt: now };
}

export async function clearOpenPosDraft(actorUser, query = {}) {
  const tenantId = await resolveTenantId(actorUser);
  const userId = resolveUserId(actorUser, query.userId);
  await deletePosOpenDraft(tenantId, userId);
  logEvent('info', 'pos.draft.cleared', 'Rascunho do carrinho apagado', {
    source: 'api',
    module: 'pos-draft.service',
    action: 'clearOpenPosDraft',
    reason: 'Venda finalizada, pedido cancelado ou logout',
    who: actorUser,
    user_id: userId,
    tenant_id: tenantId,
    entity: 'pos_draft',
    entity_id: userId,
  });
  return { success: true };
}
