import {
  clearSharedTableOrder,
  getSharedTableOrder,
  listSharedTableOrders,
  saveSharedTableOrder,
} from '../services/pos-table-orders.service.js';
import { subscribeTableOrderEvents } from '../services/table-orders-events.js';
import { handleControllerError, sendSuccess } from '../utils/response.js';

export async function getTableOrders(req, res) {
  try {
    const payload = await listSharedTableOrders(req.user ?? null);
    return sendSuccess(res, payload);
  } catch (error) {
    return handleControllerError(res, error);
  }
}

export async function getTableOrder(req, res) {
  try {
    const payload = await getSharedTableOrder(req.params?.tableKey, req.user ?? null);
    return sendSuccess(res, payload);
  } catch (error) {
    return handleControllerError(res, error);
  }
}

export async function putTableOrder(req, res) {
  try {
    const payload = await saveSharedTableOrder(req.params?.tableKey, req.body ?? {}, req.user ?? null);
    return sendSuccess(res, payload);
  } catch (error) {
    return handleControllerError(res, error);
  }
}

export async function deleteTableOrder(req, res) {
  try {
    const payload = await clearSharedTableOrder(req.params?.tableKey, req.user ?? null);
    return sendSuccess(res, payload);
  } catch (error) {
    return handleControllerError(res, error);
  }
}

/** SSE — push quando mesas mudam. */
export async function streamTableOrders(req, res) {
  try {
    const tenantId = String(req.user?.tenant_id ?? req.tenantId ?? '').trim();
    if (!tenantId) {
      return handleControllerError(res, Object.assign(new Error('Unauthorized'), { status: 401 }));
    }

    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    if (typeof res.flushHeaders === 'function') res.flushHeaders();

    res.write(`event: ready\ndata: ${JSON.stringify({ ok: true, tenantId })}\n\n`);

    subscribeTableOrderEvents(tenantId, res);

    const heartbeat = setInterval(() => {
      try {
        res.write(`: ping ${Date.now()}\n\n`);
      } catch {
        clearInterval(heartbeat);
      }
    }, 20000);

    req.on('close', () => clearInterval(heartbeat));
  } catch (error) {
    return handleControllerError(res, error);
  }
}
