import express from 'express';
import { authenticateUser } from '../middlewares/auth.js';
import { ingestClientLog, listSystemLogs } from '../controllers/app-logs.controller.js';
import { sendError } from '../utils/response.js';

const router = express.Router();

function requireLogsAccess(req, res, next) {
  void (async () => {
    try {
      const { default: db } = await import('../database.js');
      const row = await new Promise((resolve, reject) => {
        db.get(
          `SELECT required_level FROM permission_rules WHERE key = ? LIMIT 1`,
          ['painel.logs_sistema'],
          (err, result) => (err ? reject(err) : resolve(result ?? null))
        );
      });
      const required = Number(row?.required_level ?? 7);
      const level = Number(req.user?.access_level ?? req.user?.accessLevel ?? 0);
      if (!Number.isFinite(level) || level < required) {
        return sendError(res, 403, 'Sem permissão para ver logs do sistema', 'FORBIDDEN');
      }
      return next();
    } catch {
      const level = Number(req.user?.access_level ?? req.user?.accessLevel ?? 0);
      if (!Number.isFinite(level) || level < 7) {
        return sendError(res, 403, 'Sem permissão para ver logs do sistema', 'FORBIDDEN');
      }
      return next();
    }
  })();
}

router.get('/system/logs', authenticateUser, requireLogsAccess, listSystemLogs);
router.post('/system/client-log', authenticateUser, ingestClientLog);

export default router;
