/**
 * Hub SSE para tickets KDS (cozinha).
 */
const tenants = new Map();

function tenantKey(tenantId) {
  return String(tenantId ?? '').trim() || '_';
}

/**
 * @param {string} tenantId
 * @param {import('express').Response} res
 */
export function subscribeKitchenEvents(tenantId, res) {
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
 * @param {{ type: string, ticketId?: string|null, printCenterId?: string|null, status?: string|null }} payload
 */
export function publishKitchenEvent(tenantId, payload) {
  const key = tenantKey(tenantId);
  const set = tenants.get(key);
  if (!set || set.size === 0) return;

  const body = `event: kitchen\ndata: ${JSON.stringify({
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

export function kitchenSubscriberCount(tenantId) {
  return tenants.get(tenantKey(tenantId))?.size ?? 0;
}
