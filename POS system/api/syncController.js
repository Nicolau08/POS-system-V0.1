import express from 'express';
import { all, get } from './dbUtils.js';
import { processFullSyncCycle, fullSyncFromCloud } from './syncService.js';

const router = express.Router();

router.get('/status', async (_req, res) => {
  try {
    const tenantId = String(_req.tenantId ?? _req.user?.tenant_id ?? '').trim();
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
      all(`SELECT id, last_sync_at FROM sync_state WHERE id LIKE ? ORDER BY id ASC`, [`%:${tenantId}`]),
    ]);

    res.json({
      total_pending: Number(totals.find((r) => r.status === 'pending')?.count ?? 0),
      total_failed: Number(totals.find((r) => r.status === 'failed')?.count ?? 0),
      total_synced: Number(totals.find((r) => r.status === 'synced')?.count ?? 0),
      total_retries: Number(totalRetriesRow?.total_retries ?? 0),
      last_synced_at: lastSyncedRow?.last_synced_at ?? null,
      pull_sync_state: pullStates ?? [],
      last_error: lastErrorRow ?? null,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/run', async (_req, res) => {
  try {
    const result = await processFullSyncCycle();
    res.json({
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
    res.status(500).json({ error: error.message });
  }
});

router.post('/full-reset', async (_req, res) => {
  try {
    const isEnabled = process.env.ENABLE_FULL_RESET_SYNC === 'true';
    const confirmation = String(_req.headers['x-sync-confirm'] || _req.body?.confirm || '').toUpperCase();
    if (!isEnabled) {
      return res.status(403).json({ error: 'Full reset sync is disabled' });
    }
    if (confirmation !== 'FULL_RESET') {
      return res.status(400).json({
        error: 'confirmacao obrigatoria. Envie x-sync-confirm: FULL_RESET ou body.confirm="FULL_RESET".',
      });
    }

    const tenantId = String(_req.tenantId ?? _req.user?.tenant_id ?? '').trim();
    const result = await fullSyncFromCloud(tenantId);
    if (result?.success) {
      res.json(result);
      return;
    }
    const statusCode = result?.skipped ? 409 : 500;
    res.status(statusCode).json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/logs', async (_req, res) => {
  try {
    const tenantId = String(_req.tenantId ?? _req.user?.tenant_id ?? '').trim();
    const logs = await all(
      `SELECT id, queue_id, type, error_message, payload, created_at
       FROM sync_logs
       WHERE tenant_id = ?
       ORDER BY id DESC
       LIMIT 50`,
      [tenantId]
    );
    res.json(logs);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
