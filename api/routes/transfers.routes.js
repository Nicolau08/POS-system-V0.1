import express from 'express';
import { authenticateUser, requireAdmin } from '../middlewares/auth.js';
import { sendError, sendSuccess } from '../utils/response.js';
import { logError } from '../utils/logger.js';
import {
  cancelDraft,
  createDraft,
  dispatchLocal,
  listTransfers,
  receiveLocal,
} from '../services/storeTransfers.service.js';
import { cancelTransferViaCloud } from '../syncService.js';

// Etapa 1G.2B.5 - endpoints minimos (sem UI) das transferencias Store -> Store. Todos admin.
const router = express.Router();
const tenantOf = (req) => String(req.tenantId ?? req.user?.tenant_id ?? '').trim();

const handle = (fn) => async (req, res) => {
  try {
    return sendSuccess(res, await fn(req));
  } catch (error) {
    const status = Number(error?.status ?? error?.statusCode ?? 0);
    if (status >= 400 && status < 500) return sendError(res, status, error.message, 'TRANSFER_REJECTED');
    if (error?.code === 'SYNC_UNAVAILABLE') return sendError(res, 503, 'Sem ligação à cloud', 'SYNC_UNAVAILABLE');
    logError('controller_error', { module: 'transfers', reason: 'Erro não tratado', error });
    return sendError(res, 500, 'Erro interno do servidor', 'INTERNAL_ERROR');
  }
};

router.get('/', authenticateUser, requireAdmin, handle((req) => listTransfers(tenantOf(req))));
router.post('/', authenticateUser, requireAdmin, handle((req) => createDraft({ tenantId: tenantOf(req), ...(req.body ?? {}) })));
router.post('/:id/cancel-draft', authenticateUser, requireAdmin, handle((req) => cancelDraft(req.params.id, tenantOf(req))));
router.post('/:id/dispatch', authenticateUser, requireAdmin, handle((req) => dispatchLocal(req.params.id, tenantOf(req))));
router.post('/:id/receive', authenticateUser, requireAdmin, handle((req) => receiveLocal(req.params.id, tenantOf(req), req.body ?? {})));
// pos-dispatch: so via cloud (exige ligação); o resultado é aplicado localmente com movimento compensatório
router.post('/:id/cancel', authenticateUser, requireAdmin, handle((req) => cancelTransferViaCloud(req.params.id, req.body?.reason ?? null)));

export default router;
