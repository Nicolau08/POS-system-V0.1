/**
 * Hub SSE para pedidos de mesa partilhados (multiposto).
 * Clientes ligam a GET /pos/table-orders/events e recebem push quando há mudanças.
 */
const tenants = new Map();

function tenantKey(tenantId) {
  return String(tenantId ?? '').trim() || '_';
}

/**
 * @param {string} tenantId
 * @param {import('express').Response} res
 */
export function subscribeTableOrderEvents(tenantId, res) {
  const key = tenantKey(tenantId);
  let set = tenants.get(key);
  if (!set) {
    set = new Set();
    tenants.set(key, set);
  }
  set.add(res);

  const remove = () => {
    set.delete(res);
    if (set.size === 0) tenants.delete(key);
  };

  res.on('close', remove);
  res.on('error', remove);
  return remove;
}

/**
 * @param {string} tenantId
 * @param {{ type: string, tableKey?: string|null, updatedAt?: string|null, cleared?: boolean }} payload
 */
export function publishTableOrderEvent(tenantId, payload) {
  const key = tenantKey(tenantId);
  const set = tenants.get(key);
  if (!set || set.size === 0) return;

  const body = `event: table-orders\ndata: ${JSON.stringify({
    ...payload,
    at: new Date().toISOString(),
  })}\n\n`;

  for (const res of [...set]) {
    try {
      res.write(body);
    } catch {
      try {
        set.delete(res);
      } catch {
        /* ignore */
      }
    }
  }
}

export function tableOrderSubscriberCount(tenantId) {
  return tenants.get(tenantKey(tenantId))?.size ?? 0;
}
