import { all, get } from '../dbUtils.js';
import {
  processFullSyncCycle,
  fullSyncFromCloud,
  isCloudSyncConfigured,
  isInternetAvailable,
  isSyncServiceActive,
} from '../syncService.js';
import { parsePagination, parseSearchTerm, withPaginationPayload } from '../services/queryOptions.service.js';
import { logAudit, logError } from '../utils/logger.js';
import { sendError, sendSuccess } from '../utils/response.js';

function controllerError(res, error) {
  logError('controller_error', {
    module: 'sync',
    reason: 'Erro não tratado no controller',
    error,
  });
  return sendError(res, 500, 'Erro interno do servidor', 'INTERNAL_ERROR');
}

export async function getSyncStatus(req, res) {
  try {
    const tenantId = String(req.tenantId ?? req.user?.tenant_id ?? '').trim();
    const [totals, totalRetriesRow, lastSyncedRow, lastErrorRow, pullStates] = await Promise.all([
      all(
        `SELECT status, COUNT(*) AS count
         FROM sync_queue
         WHERE tenant_id = ?
         GROUP BY status`
        ,
        [tenantId]
      ),
      get(`SELECT COALESCE(SUM(retries), 0) AS total_retries FROM sync_queue WHERE tenant_id = ?`, [tenantId]),
      get(`SELECT MAX(synced_at) AS last_synced_at FROM sync_queue WHERE tenant_id = ? AND status = 'synced'`, [tenantId]),
      get(
        `SELECT id, queue_id, type, error_message, payload, created_at
         FROM sync_logs
         WHERE tenant_id = ?
         ORDER BY id DESC
         LIMIT 1`,
        [tenantId]
      ),
      all(
        `SELECT id, last_sync_at
         FROM sync_state
         WHERE id LIKE ?
         ORDER BY id ASC`,
        [`%:${tenantId}`]
      ),
    ]);

    const pushLast = lastSyncedRow?.last_synced_at ?? null;
    const pullLast = (pullStates ?? []).reduce((best, row) => {
      const ts = row?.last_sync_at ? String(row.last_sync_at) : null;
      if (!ts) return best;
      if (!best) return ts;
      return Date.parse(ts) >= Date.parse(best) ? ts : best;
    }, null);
    let lastSyncedAt = pushLast;
    if (pullLast && (!lastSyncedAt || Date.parse(pullLast) > Date.parse(lastSyncedAt))) {
      lastSyncedAt = pullLast;
    }

    const cloudConfigured = isCloudSyncConfigured();
    const syncActive = isSyncServiceActive();
    const online = cloudConfigured ? await isInternetAvailable() : false;
    const pending = Number(totals.find((r) => r.status === 'pending')?.count ?? 0);
    const failed = Number(totals.find((r) => r.status === 'failed')?.count ?? 0);
    let mode = 'online';
    let reason = null;
    if (!cloudConfigured) {
      mode = 'offline_only';
      reason = 'supabase_not_configured';
    } else if (!online) {
      mode = 'offline';
      reason = 'no_internet';
    } else if (!syncActive) {
      mode = 'idle';
      reason = 'sync_service_inactive';
    }

    return sendSuccess(res, {
      total_pending: pending,
      total_failed: failed,
      total_synced: Number(totals.find((r) => r.status === 'synced')?.count ?? 0),
      total_retries: Number(totalRetriesRow?.total_retries ?? 0),
      last_synced_at: lastSyncedAt,
      lastSync: lastSyncedAt,
      online,
      cloud_configured: cloudConfigured,
      sync_active: syncActive,
      mode,
      reason,
      pending,
      failed,
      pull_sync_state: pullStates ?? [],
      last_error: lastErrorRow ?? null,
    });
  } catch (error) {
    return controllerError(res, error);
  }
}

export async function runSyncCycle(_req, res) {
  try {
    const result = await processFullSyncCycle();
    await logAudit('SYNC_RUN', _req.user, {
      entity: 'sync',
      entity_id: 'cycle',
      description: 'Manual sync cycle triggered',
      push_processed: Number(result?.push?.processed ?? 0),
      pull_processed: Number(result?.pull?.processed ?? 0),
      push_failed: Number(result?.push?.failed ?? 0),
      pull_conflicts: Number(result?.pull?.conflicts ?? 0),
    });
    return sendSuccess(res, {
      push: {
        processed: Number(result?.push?.processed ?? 0),
        success: Number(result?.push?.success ?? 0),
        failed: Number(result?.push?.failed ?? 0),
        dead: Number(result?.push?.dead ?? 0),
        skipped: Boolean(result?.push?.skipped ?? false),
        reason: result?.push?.reason ?? null,
      },
      pull: {
        processed: Number(result?.pull?.processed ?? 0),
        inserted: Number(result?.pull?.inserted ?? 0),
        updated: Number(result?.pull?.updated ?? 0),
        skipped: Number(result?.pull?.skipped ?? 0),
        conflicts: Number(result?.pull?.conflicts ?? 0),
        stock_inserted: Number(result?.pull?.stock_inserted ?? 0),
        skipped_entities: result?.pull?.skippedEntities ?? [],
        cycle_skipped: Boolean(result?.pull?.skipped ?? false),
        reason: result?.pull?.reason ?? null,
      },
    });
  } catch (error) {
    await logAudit('SYNC_RUN_FAILED', _req.user, {
      entity: 'sync',
      entity_id: 'cycle',
      description: 'Manual sync cycle failed',
      error: error?.message ?? String(error),
    });
    logError('sync_cycle_error', { error: error?.message ?? String(error), requested_by: _req.user?.id ?? null });
    return controllerError(res, error);
  }
}

export async function runFullResetSync(req, res) {
  try {
    const isEnabled = process.env.ENABLE_FULL_RESET_SYNC === 'true';
    const confirmation = String(req.headers['x-sync-confirm'] || req.body?.confirm || '').toUpperCase();
    if (!isEnabled) return sendError(res, 403, 'Full reset sync is disabled', 'FULL_RESET_DISABLED');
    if (confirmation !== 'FULL_RESET') {
      return sendError(
        res,
        400,
        'confirmacao obrigatoria. Envie x-sync-confirm: FULL_RESET ou body.confirm="FULL_RESET".',
        'FULL_RESET_CONFIRMATION_REQUIRED'
      );
    }

    const tenantId = String(req.tenantId ?? req.user?.tenant_id ?? '').trim();
    const result = await fullSyncFromCloud(tenantId);
    await logAudit('SYNC_FULL_RESET', req.user, {
      entity: 'sync',
      entity_id: 'full-reset',
      description: 'Full reset sync requested',
      success: Boolean(result?.success),
      skipped: Boolean(result?.skipped),
    });
    if (result?.success) return sendSuccess(res, result);
    return sendError(res, result?.skipped ? 409 : 500, result?.reason ?? 'full_reset_error', 'FULL_RESET_FAILED');
  } catch (error) {
    await logAudit('SYNC_FULL_RESET_FAILED', req.user, {
      entity: 'sync',
      entity_id: 'full-reset',
      description: 'Full reset sync failed',
      error: error?.message ?? String(error),
    });
    logError('sync_full_reset_error', { error: error?.message ?? String(error), requested_by: req.user?.id ?? null });
    return controllerError(res, error);
  }
}

export async function getSyncLogs(_req, res) {
  try {
    const tenantId = String(_req.tenantId ?? _req.user?.tenant_id ?? '').trim();
    const pagination = parsePagination(_req.query ?? {});
    const search = parseSearchTerm(_req.query?.search);
    const where = ['tenant_id = ?'];
    const params = [tenantId];
    if (search) {
      where.push(`(
        LOWER(COALESCE(type, '')) LIKE LOWER(?)
        OR LOWER(COALESCE(error_message, '')) LIKE LOWER(?)
      )`);
      const token = `%${search}%`;
      params.push(token, token);
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const sqlBase = `SELECT id, queue_id, type, error_message, payload, created_at
       FROM sync_logs
       ${whereSql}
       ORDER BY id DESC`;

    if (!pagination.hasPagination) {
      const logs = await all(`${sqlBase} LIMIT 50`, params);
      return sendSuccess(res, logs);
    }

    const logs = await all(`${sqlBase} LIMIT ? OFFSET ?`, [...params, pagination.limit, pagination.offset]);
    const totalRow = await get(`SELECT COUNT(*) AS total FROM sync_logs ${whereSql}`, params);
    return sendSuccess(
      res,
      withPaginationPayload(logs, {
        page: pagination.page,
        limit: pagination.limit,
        total: Number(totalRow?.total ?? 0),
      })
    );
  } catch (error) {
    return controllerError(res, error);
  }
}
