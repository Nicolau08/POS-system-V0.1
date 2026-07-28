import {
  bumpKitchenTicketStatus,
  createKitchenTickets,
  adjustKitchenForTable,
  listKitchenTicketsForApi,
} from '../services/kitchen.service.js';
import { subscribeKitchenEvents } from '../services/kitchen-events.js';
import { handleControllerError, sendSuccess } from '../utils/response.js';
import { requireTenantId } from '../utils/tenant.js';

export async function postKitchenTickets(req, res) {
  try {
    const payload = await createKitchenTickets(req.body ?? {}, req.user ?? null);
    return sendSuccess(res, payload, 201);
  } catch (error) {
    return handleControllerError(res, error);
  }
}

export async function postKitchenAdjust(req, res) {
  try {
    const payload = await adjustKitchenForTable(req.body ?? {}, req.user ?? null);
    return sendSuccess(res, payload);
  } catch (error) {
    return handleControllerError(res, error);
  }
}

export async function getKitchenTickets(req, res) {
  try {
    const payload = await listKitchenTicketsForApi(req.query ?? {}, req.user ?? null);
    return sendSuccess(res, payload);
  } catch (error) {
    return handleControllerError(res, error);
  }
}

export async function patchKitchenTicket(req, res) {
  try {
    const payload = await bumpKitchenTicketStatus(req.params?.id, req.body ?? {}, req.user ?? null);
    return sendSuccess(res, payload);
  } catch (error) {
    return handleControllerError(res, error);
  }
}

export async function streamKitchenEvents(req, res) {
  try {
    const tenantId = requireTenantId(req.user?.tenant_id, {
      status: 401,
      message: 'tenant_id ausente',
    });

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();
    res.write(`event: kitchen\ndata: ${JSON.stringify({ type: 'connected', at: new Date().toISOString() })}\n\n`);

    subscribeKitchenEvents(tenantId, res);

    const heartbeat = setInterval(() => {
      try {
        res.write(': ping\n\n');
      } catch {
        clearInterval(heartbeat);
      }
    }, 25000);

    req.on('close', () => clearInterval(heartbeat));
  } catch (error) {
    return handleControllerError(res, error);
  }
}
