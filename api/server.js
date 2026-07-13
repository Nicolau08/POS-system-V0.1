import path from 'path';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import express from 'express';
import cors from 'cors';
import saasRoutes from './routes/saas.routes.js';
import setupRoutes from './routes/setup.routes.js';

import db, { runPermissionRulesSeedIfEmpty } from './database.js';
import { startSyncService } from './syncService.js';
import stockController from './stockController.js';
import usersRoutes from './routes/users.routes.js';
import tenantRoutes from './routes/tenant.routes.js';
import productsRoutes from './routes/products.routes.js';
import salesRoutes from './routes/sales.routes.js';
import syncRoutes from './routes/sync.routes.js';
import maintenanceRoutes from './routes/maintenance.routes.js';
import categoriasRoutes from './routes/categorias.routes.js';
import clientesRoutes from './routes/clientes.routes.js';
import paymentMethodsRoutes from './routes/payment-methods.routes.js';
import permissionRulesRoutes from './routes/permission-rules.routes.js';
import companyProfileRoutes from './routes/company-profile.routes.js';
import documentosRoutes from './routes/documentos.routes.js';
import reportsRoutes from './routes/reports.routes.js';
import serialRoutes from './routes/serial.routes.js';
import posDraftRoutes from './routes/pos-draft.routes.js';
import appLogsRoutes from './routes/app-logs.routes.js';
import cashSessionRoutes from './routes/cash-session.routes.js';
import { authenticateUser } from './middlewares/auth.js';
import { requireTenantContext } from './middlewares/tenant.middleware.js';
import { globalErrorHandler, notFoundHandler } from './middlewares/error.middleware.js';
import { sendError, sendSuccess } from './utils/response.js';
import {
  attachRequestContext,
  createRateLimiter,
  sanitizeInputMiddleware,
} from './middlewares/security.middleware.js';
import {
  beginCriticalOperation,
  createBackup,
  endCriticalOperation,
  getBackupIntervalHours,
  getBackupIntervalMs,
} from './utils/backup.js';
import { logAudit, logError, logEvent, logInfo, logWarn } from './utils/logger.js';
import { validateLicenseAccess } from './services/user.service.js';
import { getLoginUsers, login } from './controllers/users.controller.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({
  path: path.resolve(__dirname, '../.env'),
});
dotenv.config({
  path: path.resolve(__dirname, '../.env.local'),
  override: true,
});

const app = express();
app.use(cors());
/** Logos em base64 no PUT /company-profile excedem o default (~100kb). */
app.use(express.json({ limit: process.env.API_JSON_BODY_LIMIT || '6mb' }));
app.use(attachRequestContext);
app.use(createRateLimiter());
app.use(sanitizeInputMiddleware);
app.use('/setup', setupRoutes);

function rejectNonLocalAuthRoute(req, res, next) {
  const forwarded = String(req.headers?.['x-forwarded-for'] ?? '').split(',')[0].trim();
  const remote = String(req.socket?.remoteAddress ?? '').trim();
  const candidate = forwarded || remote;
  const normalized = candidate.startsWith('::ffff:') ? candidate.replace('::ffff:', '') : candidate;
  const local = new Set(['127.0.0.1', '::1', 'localhost']);
  if (!local.has(normalized)) {
    return sendError(res, 403, 'Operação permitida apenas localmente.', 'LOCAL_ONLY_OPERATION');
  }
  return next();
}

/** Login screen: sem sessão ainda — antes do middleware de auth. */
app.get('/auth/login-users', rejectNonLocalAuthRoute, getLoginUsers);
app.post('/auth/login', rejectNonLocalAuthRoute, login);

const LICENSE_GRACE_PERIOD_MS = Math.max(
  0,
  Number(process.env.LICENSE_GRACE_PERIOD_MS ?? process.env.LICENSE_EXPIRATION_GRACE_MS ?? 0) || 0
);

app.use(authenticateUser);
app.use(requireTenantContext);

app.use(async (req, res, next) => {
  try {
    const result = await validateLicenseAccess(
      LICENSE_GRACE_PERIOD_MS,
      req.user ?? null
    );

    if (result.isExpired) {
      logWarn('license_expired_blocked', {
        event: 'license.expired',
        message: 'Pedido bloqueado porque a licença está expirada',
        module: 'license.middleware',
        action: 'validateLicenseAccess',
        reason: 'Licença do tenant fora do prazo de validade',
        request_id: req.requestId ?? null,
        who: req.user ?? null,
        tenant_id: req.user?.tenant_id ?? null,
      });
      return sendError(res, 403, 'Licença expirada');
    }

    return next();
  } catch (err) {
    logError('license_middleware_failed', {
      event: 'license.middleware_error',
      message: 'Falha ao validar licença no middleware',
      module: 'license.middleware',
      action: 'validateLicenseAccess',
      reason: 'Excepção durante verificação de licença',
      request_id: req.requestId ?? null,
      who: req.user ?? null,
      error: err,
    });
    return sendError(res, 500, 'erro interno licença');
  }
});

app.get('/test-license', (req, res) => {
  return sendError(res, 403, 'Licença expirada');
});

app.use((req, res, next) => {
  const isMutation = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(String(req.method).toUpperCase());
  const isBackupRoute = String(req.path ?? '').startsWith('/backup/');
  if (!isMutation || isBackupRoute) return next();

  beginCriticalOperation();
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    endCriticalOperation();
  };

  res.on('finish', release);
  res.on('close', release);
  res.on('error', release);
  return next();
});
app.use('/saas', saasRoutes);
app.use('/', usersRoutes);
app.use(tenantRoutes);
console.log('[SERVER] SaaS routes registered');
app.use('/', productsRoutes);
app.use('/', salesRoutes);
app.use('/', categoriasRoutes);
app.use('/', clientesRoutes);
app.use('/', paymentMethodsRoutes);
app.use('/', permissionRulesRoutes);
app.use('/', companyProfileRoutes);
app.use('/', documentosRoutes);
app.use('/', reportsRoutes);
app.use('/', serialRoutes);
app.use('/', posDraftRoutes);
app.use('/', appLogsRoutes);
app.use('/', cashSessionRoutes);
app.use('/sync', syncRoutes);
app.use('/stock', stockController);
app.use('/', maintenanceRoutes);
console.log('[SERVER] Tenant routes registered');

logInfo('env_check', {
  supabase_configured: Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY),
});

// 🔹 TESTE
app.get('/', (req, res) => {
  return sendSuccess(res, { message: 'API OK 🚀' });
});

app.use(notFoundHandler);
app.use(globalErrorHandler);

// 🔥 START SERVER (SEMPRE NO FINAL)
const PORT = process.env.POS_API_PORT || process.env.PORT || 3001;
let autoBackupScheduler = null;

async function runAutoBackupCycle() {
  try {
    const backup = await createBackup();
    await logAudit('BACKUP_AUTO_CREATE', null, {
      entity: 'database',
      entity_id: 'main',
      description: 'Automatic backup created by scheduler',
      backup_file: backup.fileName,
      backup_path: backup.filePath,
      mode: 'automatic',
    });
    logInfo('auto_backup_created', {
      backup_file: backup.fileName,
      backup_path: backup.filePath,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    await logAudit('BACKUP_AUTO_CREATE_FAILED', null, {
      entity: 'database',
      entity_id: 'main',
      description: 'Automatic backup failed',
      mode: 'automatic',
      error: errorMessage,
    });
    logError('auto_backup_create_failed', {
      error: errorMessage,
    });
  }
}

function startAutoBackupScheduler() {
  if (autoBackupScheduler) {
    clearInterval(autoBackupScheduler);
    autoBackupScheduler = null;
  }

  const intervalMs = getBackupIntervalMs();
  const intervalHours = getBackupIntervalHours();
  autoBackupScheduler = setInterval(() => {
    void runAutoBackupCycle();
  }, intervalMs);

  logInfo('auto_backup_scheduler_started', {
    interval_hours: intervalHours,
    interval_ms: intervalMs,
  });
}

function startApiServer() {
  app.listen(PORT, () => {
    logEvent('info', 'api.started', `API POSly a escutar em http://localhost:${PORT}`, {
      source: 'api',
      module: 'server',
      action: 'listen',
      reason: 'Processo da API iniciado com sucesso',
      port: PORT,
      node_env: process.env.NODE_ENV ?? 'development',
      tenant: process.env.POS_DEV_TENANT ?? process.env.DEFAULT_TENANT_ID ?? null,
    });

    const fullResetEnabled = process.env.ENABLE_FULL_RESET_SYNC === 'true';
    logInfo('sync_mode', {
      event: 'sync.config',
      message: fullResetEnabled
        ? 'Sync full-reset activado'
        : 'Sync full-reset desactivado',
      module: 'sync',
      action: 'boot',
      full_reset_enabled: fullResetEnabled,
    });

    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      logWarn('sync_offline_only', {
        event: 'sync.offline_only',
        message: 'Credenciais Supabase em falta — modo apenas offline',
        module: 'sync',
        action: 'boot',
        reason: 'SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY não configurados',
      });
    } else {
      logInfo('sync_supabase_ready', {
        event: 'sync.supabase_ready',
        message: 'Supabase configurado — a iniciar serviço de sync',
        module: 'sync',
        action: 'boot',
      });
      startSyncService();
    }

    startAutoBackupScheduler();
  });
}

// Garante tabela em bases antigas ou se o CREATE inicial falhou (evita 500 em /permission-rules)
db.run(
  `
  CREATE TABLE IF NOT EXISTS permission_rules (
    key TEXT PRIMARY KEY,
    required_level INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
`,
  (schemaErr) => {
    if (schemaErr) {
      console.error('[fatal] permission_rules:', schemaErr.message);
      process.exit(1);
    }

    db.run(
      `
      CREATE TABLE IF NOT EXISTS licenses (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        license_key TEXT,
        plan TEXT,
        expires_at TEXT,
        active INTEGER,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `,
      (licenseSchemaErr) => {
        if (licenseSchemaErr) {
          console.error('[fatal] licenses:', licenseSchemaErr.message);
          process.exit(1);
        }

        db.run(
          `CREATE INDEX IF NOT EXISTS idx_licenses_tenant_id ON licenses(tenant_id)`,
          (licenseIndexErr) => {
            if (licenseIndexErr) {
              console.error('[fatal] licenses index:', licenseIndexErr.message);
              process.exit(1);
            }
          }
        );

        db.run(`ALTER TABLE licenses ADD COLUMN serial_number TEXT`, () => {});
        db.run(`ALTER TABLE licenses ADD COLUMN machine_id TEXT`, () => {});
        db.run(`ALTER TABLE licenses ADD COLUMN activated_at TEXT`, () => {});
        db.run(
          `CREATE UNIQUE INDEX IF NOT EXISTS idx_licenses_serial_number ON licenses(serial_number) WHERE serial_number IS NOT NULL AND TRIM(serial_number) != ''`,
          () => {}
        );

        db.run(
          `
          INSERT INTO licenses (id, tenant_id, license_key, plan, expires_at, active, created_at)
          SELECT
            'license-auto-' || t.id,
            t.id,
            'AUTO',
            'LOCAL',
            datetime('now', '+10 years'),
            1,
            datetime('now')
          FROM tenants t
          WHERE NOT EXISTS (SELECT 1 FROM licenses l WHERE l.tenant_id = t.id)
        `,
          (autoLicErr) => {
            if (autoLicErr) {
              console.error('[licenses] auto-seed:', autoLicErr.message);
            }
          }
        );

        runPermissionRulesSeedIfEmpty((seedErr) => {
          if (seedErr) {
            console.error('[fatal] permission_rules seed:', seedErr.message);
            process.exit(1);
          }
          startApiServer();
        });
      }
    );
  }
);