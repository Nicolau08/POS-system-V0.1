import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import express from 'express';
import cors from 'cors';
import saasRoutes from './routes/saas.routes.js';
import setupRoutes from './routes/setup.routes.js';

import db, { runPermissionRulesSeedIfEmpty } from './database.js';
import { startSyncService, isCloudSyncConfigured } from './syncService.js';
import stockController from './stockController.js';
import usersRoutes from './routes/users.routes.js';
import tenantRoutes from './routes/tenant.routes.js';
import productsRoutes from './routes/products.routes.js';
import salesRoutes from './routes/sales.routes.js';
import syncRoutes from './routes/sync.routes.js';
import transfersRoutes from './routes/transfers.routes.js';
import { consumePairing } from './services/stationPairing.service.js';
import { authenticateStation, getSocketIp, isLoopbackSocket, requireLoopbackOnly } from './middlewares/stationAuth.js';
import { loadServerTlsIdentity } from './utils/serverTls.js';
import { createLanTlsServers } from './utils/dualProtocolServer.js';
import maintenanceRoutes from './routes/maintenance.routes.js';
import categoriasRoutes from './routes/categorias.routes.js';
import clientesRoutes from './routes/clientes.routes.js';
import paymentMethodsRoutes from './routes/payment-methods.routes.js';
import taxRatesRoutes from './routes/tax-rates.routes.js';
import permissionRulesRoutes from './routes/permission-rules.routes.js';
import companyProfileRoutes from './routes/company-profile.routes.js';
import documentosRoutes from './routes/documentos.routes.js';
import reportsRoutes from './routes/reports.routes.js';
import serialRoutes from './routes/serial.routes.js';
import posDraftRoutes from './routes/pos-draft.routes.js';
import appLogsRoutes from './routes/app-logs.routes.js';
import cashSessionRoutes from './routes/cash-session.routes.js';
import locationsRoutes from './routes/locations.routes.js';
import printCentersRoutes from './routes/print-centers.routes.js';
import stationsRoutes from './routes/stations.routes.js';
import warehousesRoutes from './routes/warehouses.routes.js';
import kitchenRoutes from './routes/kitchen.routes.js';
import { authenticateUser } from './middlewares/auth.js';
import { requireTenantContext } from './middlewares/tenant.middleware.js';
import { globalErrorHandler, notFoundHandler } from './middlewares/error.middleware.js';
import { sendError, sendSuccess } from './utils/response.js';
import {
  buildDiscoverPayload,
  ensureStationTables,
  isRemoteAuthAllowed,
} from './services/station.service.js';
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
  shouldRunStartupBackup,
} from './utils/backup.js';
import { logAudit, logError, logEvent, logInfo, logWarn } from './utils/logger.js';
import { validateLicenseAccess } from './services/user.service.js';
import { getLoginUsers, login } from './controllers/users.controller.js';
import { resolveAuthHmacSecret, getClientIp, isLoopbackIp } from './utils/authSecret.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Pilot Gate Instalação/Recovery — achado do gate anterior: dotenv.config({override:true})
 * apagava ENV explicitamente injectada por quem arrancou este processo (spawn(env), shell
 * export, Electron, etc.) sempre que .env.local definisse a MESMA chave — mesmo com um
 * valor "legítimo" nesse ficheiro (ex.: uma chave de dev fixa), isso não pode vencer um
 * valor passado explicitamente ao arrancar ESTE processo (ex.: os testes Station injectam
 * uma chave FRESCA por cenário via spawn(env) — a fixa do .env.local nunca pode substituir
 * uma injectada de propósito pelo chamador). .env continua só a preencher lacunas (como já
 * era); .env.local continua a ganhar a .env, mas NUNCA a algo já em process.env ANTES deste
 * ficheiro sequer correr — só isso muda.
 */
const externallyProvidedEnvKeys = new Set(Object.keys(process.env));

function loadEnvFile(filePath, { override = false } = {}) {
  if (!fs.existsSync(filePath)) return;
  const parsed = dotenv.parse(fs.readFileSync(filePath));
  for (const [key, value] of Object.entries(parsed)) {
    if (externallyProvidedEnvKeys.has(key)) continue;
    if (override || process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}
loadEnvFile(path.resolve(__dirname, '../.env'));
loadEnvFile(path.resolve(__dirname, '../.env.local'), { override: true });

// Segredo Bearer por instalação (env → ficheiro junto à BD → gerar). Sem fallback fixo.
resolveAuthHmacSecret();

const app = express();
const allowedCorsOrigins = String(process.env.POS_CORS_ORIGINS ?? '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
const defaultCorsOrigins = [
  'http://127.0.0.1:3000',
  'http://localhost:3000',
  'http://127.0.0.1:3730',
  'http://localhost:3730',
];
app.use(
  cors({
    origin(origin, callback) {
      // Pedidos same-origin / Electron / curl sem Origin.
      if (!origin) return callback(null, true);
      const allowlist = allowedCorsOrigins.length ? allowedCorsOrigins : defaultCorsOrigins;
      if (allowlist.includes(origin)) return callback(null, true);
      return callback(new Error(`CORS origin blocked: ${origin}`));
    },
    credentials: true,
  }),
);
/** Logos em base64 no PUT /company-profile excedem o default (~100kb). */
// `verify` guarda os BYTES exactos do corpo (req.rawBody): a assinatura da Station cobre o corpo transmitido, nunca JSON reserializado.
app.use(
  express.json({
    limit: process.env.API_JSON_BODY_LIMIT || '6mb',
    verify: (req, _res, buf) => {
      req.rawBody = Buffer.from(buf);
    },
  }),
);
app.use(attachRequestContext);
app.use(createRateLimiter());
app.use(sanitizeInputMiddleware);
// Etapa 1G.3.3: pedidos NAO-loopback (so o socket conta) exigem Station assinada; excepcoes: descoberta, pairing, health.
app.use(authenticateStation);
app.use('/setup', setupRoutes);

async function rejectNonLocalAuthRoute(req, res, next) {
  // so o socket decide (X-Forwarded-For/TRUST_PROXY nunca tornam um pedido remoto "local")
  if (isLoopbackSocket(req)) return next();
  try {
    if (await isRemoteAuthAllowed()) return next();
  } catch {
    // fall through
  }
  return sendError(
    res,
    403,
    'Login remoto desactivado. Active «Acesso LAN» em Configurações → Postos no servidor.',
    'LOCAL_ONLY_OPERATION',
  );
}

/** Descoberta de postos na LAN (público; só responde se LAN+descoberta activos). */
app.get('/station/discover', async (_req, res) => {
  try {
    const payload = await buildDiscoverPayload();
    if (!payload) {
      return sendError(res, 404, 'Descoberta desactivada neste servidor.', 'DISCOVERY_OFF');
    }
    return sendSuccess(res, payload);
  } catch (err) {
    return sendError(res, 500, err?.message || 'Erro na descoberta');
  }
});

/**
 * Emparelhamento de Station (Etapa 1G.3.2): UNICO endpoint publico de postos alem da descoberta. Sem sessão de operador;
 * protegido por código de uso único + rate limit por IP + limite de licença. Só fora do loopback se a LAN estiver activa.
 */
app.post('/station/pair', rejectNonLocalAuthRoute, async (req, res) => {
  try {
    const result = await consumePairing({
      code: req.body?.code,
      publicKey: req.body?.public_key,
      machineId: req.body?.machine_id,
      ip: getSocketIp(req),
    });
    return sendSuccess(res, result, 201);
  } catch (err) {
    return sendError(res, err?.status || 500, err?.status ? err.message : 'Erro no emparelhamento', err?.code);
  }
});

/** Login screen: sem sessão ainda — antes do middleware de auth. */
app.get('/auth/login-users', rejectNonLocalAuthRoute, getLoginUsers);
app.post('/auth/login', rejectNonLocalAuthRoute, login);

/** Readiness (wait-on / Electron) — público; sem dados sensíveis. */
app.get(['/health', '/'], (_req, res) => {
  return sendSuccess(res, { ok: true, message: 'API OK' });
});

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
app.use('/saas', requireLoopbackOnly, saasRoutes); // 1G.3.5: ferramentas de tenant/licenca do proprio Server
app.use('/', usersRoutes);
app.use(tenantRoutes);
console.log('[SERVER] SaaS routes registered');
app.use('/', productsRoutes);
app.use('/', salesRoutes);
app.use('/', categoriasRoutes);
app.use('/', clientesRoutes);
app.use('/', paymentMethodsRoutes);
app.use('/', taxRatesRoutes);
app.use('/', permissionRulesRoutes);
app.use('/', companyProfileRoutes);
app.use('/', documentosRoutes);
app.use('/', reportsRoutes);
app.use('/', serialRoutes);
app.use('/', posDraftRoutes);
app.use('/', appLogsRoutes);
app.use('/', cashSessionRoutes);
app.use('/', locationsRoutes);
app.use('/', warehousesRoutes);
app.use('/', printCentersRoutes);
app.use('/', stationsRoutes);
app.use('/', kitchenRoutes);
app.use('/sync', syncRoutes);
app.use('/transfers', transfersRoutes);
app.use('/stock', stockController);
app.use('/', maintenanceRoutes);
console.log('[SERVER] Tenant routes registered');

// Etapa 1F.3: sync usa Device JWT + anon key desde 1F.2 — nunca
// SUPABASE_SERVICE_ROLE_KEY. isCloudSyncConfigured() reflecte exactamente o
// que getSupabase() (syncService.js) usa, evitando um log enganador aqui.
logInfo('env_check', {
  supabase_configured: isCloudSyncConfigured(),
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
  void (async () => {
    // Tabelas de Stations existem desde o arranque: o login consulta `stations` e, sem isto, falha em instalacoes novas.
    try {
      await ensureStationTables();
    } catch (err) {
      logWarn('stations_bootstrap_failed', { module: 'server', error: err });
    }
    let bindHost = String(process.env.POS_API_BIND || '127.0.0.1').trim() || '127.0.0.1';
    try {
      if (!process.env.POS_API_BIND) {
        const { getServerStationSettings } = await import('./services/station.service.js');
        const settings = await getServerStationSettings();
        if (settings.lanAccessEnabled || settings.effectiveLanAccess) {
          bindHost = '0.0.0.0';
          process.env.POS_LAN_ACCESS = process.env.POS_LAN_ACCESS || '1';
        }
      }
    } catch {
      // keep default bind
    }

    // Etapa 1G.3.6: LAN activa => HTTPS obrigatorio para ligacoes remotas (loopback continua a aceitar HTTP para o POS do Server).
    // Sem identidade TLS protegida a LAN NAO arranca (falha fechada): fica so em loopback.
    let tls = null;
    if (!['127.0.0.1', '::1', 'localhost'].includes(bindHost)) {
      tls = await loadServerTlsIdentity().catch(() => null);
      if (!tls) {
        logError('lan_tls_unavailable', {
          module: 'server',
          reason: 'LAN activa mas sem identidade TLS protegida (POS_TLS_CERT_PEM/POS_TLS_KEY_PEM): a API fica apenas em loopback',
        });
        bindHost = '127.0.0.1';
        process.env.POS_LAN_ACCESS = '0';
      }
    }
    const server = (tls ? createLanTlsServers(app, { cert: tls.certPem, key: tls.keyPem }) : app).listen(PORT, bindHost, () => {
      logEvent('info', 'api.started', `API POSly a escutar em ${tls ? 'https(LAN)+http(loopback)' : 'http'}://${bindHost}:${PORT}`, {
        source: 'api',
        module: 'server',
        action: 'listen',
        reason: 'Processo da API iniciado com sucesso',
        port: PORT,
        bind: bindHost,
        lan_access: String(process.env.POS_LAN_ACCESS ?? ''),
        node_env: process.env.NODE_ENV ?? 'development',
        tenant: process.env.DEFAULT_TENANT_ID ?? process.env.POS_DEV_TENANT ?? null,
        db_path: process.env.POS_DB_PATH ?? null,
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

      // Etapa 1F.3 — CORREÇÃO CRÍTICA: esta gate ainda exigia
      // SUPABASE_SERVICE_ROLE_KEY, apesar de syncService.js já usar Device
      // JWT + anon key desde 1F.2. Resultado real antes desta correção: com
      // SUPABASE_SERVICE_ROLE_KEY ausente (exactamente o cenário que esta
      // etapa quer provar que funciona), startSyncService() NUNCA era
      // chamada — o sync automático simplesmente não arrancava, apesar do
      // Device JWT estar perfeitamente configurado e funcional.
      if (!isCloudSyncConfigured()) {
        logWarn('sync_offline_only', {
          event: 'sync.offline_only',
          message: 'Credenciais Supabase em falta — modo apenas offline',
          module: 'sync',
          action: 'boot',
          reason: 'SUPABASE_URL ou SUPABASE_ANON_KEY não configurados',
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
      void (async () => {
        try {
          if (await shouldRunStartupBackup()) {
            await runAutoBackupCycle();
          }
        } catch (err) {
          logError('auto_backup_startup_failed', {
            error: err instanceof Error ? err.message : String(err),
          });
        }
      })();
    });

    server.on('error', (err) => {
      const code = err && typeof err === 'object' ? err.code : null;
      if (code === 'EADDRINUSE') {
        console.error(
          `[fatal] Porta ${PORT} já em uso. Fecha a API/tenant anterior (Ctrl+C) antes de arrancar outro tenant.`,
        );
        process.exit(1);
      }
      console.error('[fatal] Falha ao iniciar a API:', err?.message ?? err);
      process.exit(1);
    });
  })();
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