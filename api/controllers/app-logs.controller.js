import { getSystemLogs } from '../services/app-logs.service.js';
import { logError, logEvent } from '../utils/logger.js';
import { sendError, sendSuccess } from '../utils/response.js';

export async function listSystemLogs(req, res) {
  try {
    const result = await getSystemLogs({
      ...(req.query ?? {}),
      tenantId: req.tenantId ?? req.user?.tenant_id ?? req.query?.tenantId ?? null,
    });
    return sendSuccess(res, result);
  } catch (error) {
    logError('system_logs_list_failed', {
      event: 'logs.list_failed',
      message: 'Falha ao listar logs do sistema',
      module: 'app-logs.controller',
      action: 'listSystemLogs',
      reason: 'Erro ao consultar app_logs/audit_logs/sync_logs',
      request_id: req.requestId ?? null,
      who: req.user ?? null,
      error,
    });
    return sendError(res, 500, 'Erro ao listar logs', 'LOGS_LIST_FAILED');
  }
}

/** Erros reportados pelo browser/POS (autenticado). */
export async function ingestClientLog(req, res) {
  try {
    const body = req.body ?? {};
    const event = String(body.event ?? 'client.error').slice(0, 120);
    const message = String(body.message ?? 'Erro no cliente').slice(0, 500);
    logEvent('error', event, message, {
      source: 'web',
      module: body.module ?? 'client',
      action: body.action ?? 'report',
      reason: body.reason ?? 'Erro reportado pela interface',
      who: req.user ?? null,
      request_id: req.requestId ?? null,
      tenant_id: req.user?.tenant_id ?? null,
      ...(body.context && typeof body.context === 'object' ? body.context : {}),
    });
    return sendSuccess(res, { ok: true });
  } catch (error) {
    logError('client_log_ingest_failed', {
      event: 'logs.client_ingest_failed',
      message: 'Falha ao ingerir log do cliente',
      module: 'app-logs.controller',
      error,
    });
    return sendError(res, 500, 'Erro ao registar log do cliente', 'CLIENT_LOG_FAILED');
  }
}
