import { all, get } from '../dbUtils.js';
import {
  processFullSyncCycle,
  isCloudSyncConfigured,
  isInternetAvailable,
  isSyncServiceActive,
  reconcileStockWithCloud,
  pushStoreProductConfig,
  pauseSyncService,
  resumeSyncService,
  getSyncRuntimeState,
} from '../syncService.js';
import {
  isDeviceAuthBridgeConfigured,
  getDeviceAuthDiagnosticViaBridge,
  getDeviceAccessTokenViaBridge,
  getDeviceAccessTokenCachedOnlyViaBridge,
} from '../deviceAuth/deviceAuthBridgeClient.js';
import { buildLocalTenantMap, createReadOnlyQuery } from '../services/localTenantMap.service.js';
import { db } from '../dbUtils.js';
import { runDeviceReadonlyCategoriesProbe } from '../deviceAuth/deviceReadonlyProbe.js';
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
    const [totals, byTypeRows, tenantCategoryRows, tenantProductRows, tenantDeadQueueRows, rlsDiagnosticRows, totalRetriesRow, lastSyncedRow, lastErrorRow, pullStates] = await Promise.all([
      all(
        `SELECT status, COUNT(*) AS count
         FROM sync_queue
         WHERE tenant_id = ?
         GROUP BY status`
        ,
        [tenantId]
      ),
      // Diagnóstico seguro (Pilot Gate offline): só status+type+count — nunca
      // `data` (payload/negócio), nunca ids/nomes de entidades.
      all(
        `SELECT status, type, COUNT(*) AS count
         FROM sync_queue
         WHERE tenant_id = ?
         GROUP BY status, type`,
        [tenantId]
      ),
      // Diagnóstico de mismatch de tenant (Pilot Gate — RLS em categories):
      // conta linhas locais por current/other, nunca devolve o tenant_id em
      // si nem nenhum outro campo — só a comparação booleana já agregada em COUNT.
      get(
        `SELECT
           SUM(CASE WHEN tenant_id = ? THEN 1 ELSE 0 END) AS current_count,
           SUM(CASE WHEN tenant_id != ? THEN 1 ELSE 0 END) AS other_count
         FROM categories`,
        [tenantId, tenantId]
      ),
      get(
        `SELECT
           SUM(CASE WHEN tenant_id = ? THEN 1 ELSE 0 END) AS current_count,
           SUM(CASE WHEN tenant_id != ? THEN 1 ELSE 0 END) AS other_count
         FROM products`,
        [tenantId, tenantId]
      ),
      // Itens `dead` de category/product: classifica pelo tenant_id do PRÓPRIO
      // payload da fila (nunca o resto do payload — só json_extract de um campo).
      all(
        `SELECT
           type,
           SUM(CASE WHEN json_extract(data, '$.tenant_id') = ? THEN 1 ELSE 0 END) AS current_count,
           SUM(CASE WHEN json_extract(data, '$.tenant_id') != ? THEN 1 ELSE 0 END) AS other_count
         FROM sync_queue
         WHERE status = 'dead' AND type IN ('category', 'product')
         GROUP BY type`,
        [tenantId, tenantId]
      ),
      // Diagnóstico RLS (Pilot Gate — evidência de tentativas): correlaciona
      // sync_logs com itens `dead` via queue_id só para contar/datar — nunca
      // devolve queue_id, tenant_id, payload nem a mensagem de erro em si, só
      // COUNT/MIN/MAX. sameRlsErrorAttempts usa um match específico de RLS
      // ("row-level security policy"), nunca "violates" genérico (isso também
      // apanharia FK/unique/check, que não são o mesmo problema).
      all(
        `SELECT
           sq.type AS type,
           COUNT(DISTINCT sq.id) AS items,
           COUNT(sl.id) AS total_attempts,
           MIN(sl.created_at) AS first_attempt,
           MAX(sl.created_at) AS last_attempt,
           SUM(CASE WHEN sl.error_message LIKE '%row-level security policy%' THEN 1 ELSE 0 END) AS same_rls_error_attempts
         FROM sync_queue sq
         LEFT JOIN sync_logs sl ON sl.queue_id = sq.id
         WHERE sq.status = 'dead' AND sq.type IN ('category', 'product') AND sq.tenant_id = ?
         GROUP BY sq.type`,
        [tenantId],
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

    const byType = { pending: {}, failed: {}, dead: {} };
    for (const row of byTypeRows ?? []) {
      const status = String(row?.status ?? '');
      if (!Object.prototype.hasOwnProperty.call(byType, status)) continue;
      const type = String(row?.type ?? '');
      if (!type) continue;
      byType[status][type] = Number(row?.count ?? 0);
    }

    const asCurrentOther = (row) => ({
      current: Number(row?.current_count ?? 0),
      other: Number(row?.other_count ?? 0),
    });
    const queueDead = { category: { current: 0, other: 0 }, product: { current: 0, other: 0 } };
    for (const row of tenantDeadQueueRows ?? []) {
      const type = String(row?.type ?? '');
      if (!Object.prototype.hasOwnProperty.call(queueDead, type)) continue;
      queueDead[type] = asCurrentOther(row);
    }
    const tenantDiagnostic = {
      categories: asCurrentOther(tenantCategoryRows),
      products: asCurrentOther(tenantProductRows),
      queueDead,
    };

    const rlsDiagnostic = {
      category: { items: 0, totalAttempts: 0, firstAttempt: null, lastAttempt: null, sameRlsErrorAttempts: 0 },
      product: { items: 0, totalAttempts: 0, firstAttempt: null, lastAttempt: null },
    };
    for (const row of rlsDiagnosticRows ?? []) {
      const type = String(row?.type ?? '');
      if (type === 'category') {
        rlsDiagnostic.category = {
          items: Number(row?.items ?? 0),
          totalAttempts: Number(row?.total_attempts ?? 0),
          firstAttempt: row?.first_attempt ?? null,
          lastAttempt: row?.last_attempt ?? null,
          sameRlsErrorAttempts: Number(row?.same_rls_error_attempts ?? 0),
        };
      } else if (type === 'product') {
        rlsDiagnostic.product = {
          items: Number(row?.items ?? 0),
          totalAttempts: Number(row?.total_attempts ?? 0),
          firstAttempt: row?.first_attempt ?? null,
          lastAttempt: row?.last_attempt ?? null,
        };
      }
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
      byType,
      tenantDiagnostic,
      rlsDiagnostic,
      pull_sync_state: pullStates ?? [],
      last_error: lastErrorRow ?? null,
    });
  } catch (error) {
    return controllerError(res, error);
  }
}

const DEVICE_AUTH_DIAGNOSTIC_UNKNOWN_FIELDS = {
  credentials_present: 'unknown',
  refresh_token_present: 'unknown',
  refresh_token_expired: 'unknown',
  last_refresh_known: 'unknown',
  last_refresh_succeeded: 'unknown',
  refresh_error_present: 'unknown',
  token_present: 'unknown',
  token_expired: 'unknown',
  alg_is_ES256: 'unknown',
  kid_present: 'unknown',
  kid_matches_configured_signer: 'unknown',
  device_claim_matches_stored_device: 'unknown',
  tenant_claim_matches_local_tenant: 'unknown',
  role_is_authenticated: 'unknown',
  token_version_present: 'unknown',
  license_console_base_url_present: 'unknown',
};

/**
 * Pilot Gate — diagnóstico de runtime do Device Auth, só-leitura: nunca
 * dispara refresh/rede externa, nunca devolve JWT/refresh token/device_id/
 * tenant_id/license_id/kid em bruto — só booleanos (ou "unknown" quando o
 * processo Electron não está acessível ou o dado nunca existe localmente).
 */
export async function getDeviceAuthDiagnostic(req, res) {
  try {
    const tenantId = String(req.tenantId ?? req.user?.tenant_id ?? '').trim() || null;
    const bridgeConfigured = isDeviceAuthBridgeConfigured();
    const diagnostic = bridgeConfigured ? await getDeviceAuthDiagnosticViaBridge(tenantId) : null;

    return sendSuccess(res, {
      bridge_reachable: Boolean(diagnostic),
      supabase_url_present: Boolean(String(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim()),
      device_supabase_uses_runtime_token: bridgeConfigured,
      // Facto estrutural do código (getSupabase() é o único ponto de acesso
      // Supabase de todas as 4 entidades) — não um valor lido em runtime.
      same_token_path_used_by_category_customer_product_sale: true,
      ...(diagnostic ?? DEVICE_AUTH_DIAGNOSTIC_UNKNOWN_FIELDS),
    });
  } catch (error) {
    return controllerError(res, error);
  }
}

/** Motivo pelo qual o sync NÃO está garantidamente em pausa, ou null se está. */
function syncNotPausedReason(state) {
  if (!state.paused_by_operator) return 'sync_not_paused';
  if (state.sync_active) return 'sync_timer_active';
  if (state.cycle_running) return 'sync_cycle_running';
  return null;
}

function rejectIfSyncNotPaused(res) {
  const reason = syncNotPausedReason(getSyncRuntimeState());
  if (!reason) return false;
  sendError(res, 409, 'O sync tem de estar em pausa (POST /sync/pause) e sem ciclo em curso.', 'SYNC_NOT_PAUSED', { reason });
  return true;
}

/** Pilot Gate — pausa o sync (timer + gate nos ciclos). Idempotente; devolve o estado real. */
export async function pauseSync(req, res) {
  try {
    pauseSyncService();
    const state = getSyncRuntimeState();
    await logAudit('SYNC_PAUSED', req.user, {
      entity: 'sync',
      entity_id: 'pause',
      description: 'Sync pausado pelo operador',
      ...state,
    });
    return sendSuccess(res, state);
  } catch (error) {
    return controllerError(res, error);
  }
}

/** Retoma o sync (nunca cria um 2.º timer). Devolve o estado real. */
export async function resumeSync(req, res) {
  try {
    resumeSyncService();
    const state = getSyncRuntimeState();
    await logAudit('SYNC_RESUMED', req.user, {
      entity: 'sync',
      entity_id: 'resume',
      description: 'Sync retomado pelo operador',
      ...state,
    });
    return sendSuccess(res, { ...state, cloud_configured: isCloudSyncConfigured() });
  } catch (error) {
    return controllerError(res, error);
  }
}

/**
 * Pilot Gate — dispara UMA obtenção de access token via ponte (refresh só se a
 * cache não tiver um token válido). Exige sync em pausa; nunca corre ciclo de
 * sync; nunca devolve token nem claims.
 */
export async function deviceAuthRefreshOnly(req, res) {
  try {
    if (rejectIfSyncNotPaused(res)) return;
    const token = await getDeviceAccessTokenViaBridge();
    const ok = Boolean(token);
    await logAudit('DEVICE_AUTH_REFRESH_ONLY', req.user, {
      entity: 'device_auth',
      entity_id: 'refresh-only',
      description: 'Refresh isolado do Device Auth (sync em pausa)',
      ok,
    });
    return sendSuccess(res, { ok });
  } catch (error) {
    return controllerError(res, error);
  }
}

/**
 * Pilot Gate — UM `categories?select=id&limit=1` só-leitura com o token JÁ em
 * cache (nunca refresca). Exige sync em pausa. Devolve só success/status/row_count.
 */
export async function deviceAuthReadonlyProbe(_req, res) {
  try {
    if (rejectIfSyncNotPaused(res)) return;
    const result = await runDeviceReadonlyCategoriesProbe();
    if (!result.available) {
      return sendError(
        res,
        409,
        result.reason === 'supabase_not_configured'
          ? 'Supabase não configurado neste processo.'
          : 'Não há Device JWT válido em cache (a sonda nunca faz refresh).',
        result.reason === 'supabase_not_configured' ? 'SUPABASE_NOT_CONFIGURED' : 'DEVICE_TOKEN_NOT_CACHED',
      );
    }
    // `success` chamar-se-ia como o envelope da API, e sendSuccess() remove um
    // `success` booleano de dentro de `data` — daí `probe_success`.
    return sendSuccess(res, { probe_success: result.success, status: result.status, row_count: result.row_count });
  } catch (error) {
    return controllerError(res, error);
  }
}

/**
 * Pilot Gate — mapa só-leitura dos tenant_id locais vs. licença activa vs. Device JWT em cache.
 * Zero escritas, sem auditoria, sem refresh (só o token JÁ em cache, /access-token-cached), sem
 * rede externa, sem conteúdo de negócio (só contagens e ids sanitizados). Ver localTenantMap.service.js.
 * `deps` é injectável para testes.
 */
export function createLocalTenantMapHandler(deps = {}) {
  const query = deps.query ?? createReadOnlyQuery(db);
  const getCachedDeviceToken = deps.getCachedDeviceToken ?? getDeviceAccessTokenCachedOnlyViaBridge;
  return async function getLocalTenantMap(req, res) {
    try {
      const requestTenantId = String(req.tenantId ?? req.user?.tenant_id ?? '').trim();
      const map = await buildLocalTenantMap({ query, getCachedDeviceToken, requestTenantId });
      return sendSuccess(res, map);
    } catch (error) {
      return controllerError(res, error);
    }
  };
}

export const getLocalTenantMap = createLocalTenantMapHandler();

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

/**
 * Etapa 1F.3 (itens 6/7/8) — DESACTIVADO EXPLICITAMENTE, sempre, independente
 * de ENABLE_FULL_RESET_SYNC. Decisão C do pedido ("desactivar é preferível a
 * manter perigoso"): fullSyncFromCloud() faz DELETE FROM orders/order_items/
 * stock_movements/products/categories/customers/users WHERE tenant_id=? e
 * volta a inserir a partir de um snapshot da cloud — isto apagaria
 * PERMANENTEMENTE qualquer venda/stock_movement local ainda não sincronizado
 * (sync_queue pending), porque o local_sale_id local nunca chegou a existir
 * na cloud para vir de volta no snapshot. Não é hipotético: é o comportamento
 * real do código (ver fullSyncFromCloud em syncService.js). Nunca reactivar
 * sem antes redesenhar para nunca apagar dados locais não sincronizados.
 * Também tem incompatibilidades já conhecidas e não corrigidas com o
 * baseline novo (tenant_profile inexistente, users.pin_hash, image_url).
 */
export async function runFullResetSync(req, res) {
  await logAudit('SYNC_FULL_RESET_BLOCKED', req.user, {
    entity: 'sync',
    entity_id: 'full-reset',
    description: 'Full reset sync está desactivado (Etapa 1F.3) — risco de apagar vendas locais não sincronizadas',
  });
  return sendError(
    res,
    501,
    'Full reset sync está desactivado (Etapa 1F.3): o desenho actual pode apagar vendas/stock local ainda não sincronizados. Requer redesenho antes de ser reactivado.',
    'FULL_RESET_DISABLED_PENDING_REDESIGN',
  );
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

// Etapa 1G.2B.3: compara saldo local vs ledger cloud. Só reporta; nunca altera stock.
export async function getStockReconciliation(_req, res) {
  try {
    if (!isCloudSyncConfigured()) {
      return sendError(res, 503, 'Sync cloud não configurado', 'SYNC_NOT_CONFIGURED');
    }
    const reports = await reconcileStockWithCloud();
    return sendSuccess(res, { reports });
  } catch (error) {
    return controllerError(res, error);
  }
}

// Etapa 1G.2B.4: configura um produto NA Store deste Device (status / price_override / min_stock). Só admin, exige cloud.
export async function putStoreProductConfig(req, res) {
  try {
    if (!isCloudSyncConfigured()) return sendError(res, 503, 'Sync cloud não configurado', 'SYNC_NOT_CONFIGURED');
    const productId = Number(req.params?.id);
    if (!Number.isFinite(productId) || productId <= 0) return sendError(res, 400, 'Produto inválido', 'INVALID_PRODUCT');
    const result = await pushStoreProductConfig(productId, req.body ?? {});
    await logAudit('STORE_PRODUCT_CONFIG', req.user, { entity: 'product', entity_id: String(productId), description: JSON.stringify(req.body ?? {}) });
    return sendSuccess(res, result);
  } catch (error) {
    const code = String(error?.code ?? '');
    if (code === 'PRODUCT_NOT_SYNCED') return sendError(res, 409, error.message, code);
    if (code === 'SYNC_UNAVAILABLE') return sendError(res, 503, 'Sem ligação à cloud', code);
    const msg = String(error?.message ?? '');
    if (/^(status_invalid|config_invalid|product_not_in_tenant|store_not_in_tenant)$/.test(msg) || error?.code === '23514') {
      return sendError(res, 400, msg, 'STORE_PRODUCT_CONFIG_REJECTED');
    }
    return controllerError(res, error);
  }
}
