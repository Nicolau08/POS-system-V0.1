import { app, BrowserWindow, Menu, ipcMain, dialog, safeStorage } from 'electron';
import { registerStationIpc } from './station/registerStationIpc.js';
import { getOrCreateServerTlsIdentity } from './serverTlsIdentity.js';
import { probeUnpinned } from './station/pinnedHttps.js';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs/promises';
import { spawn, execFile } from 'child_process';
import fsSync from 'fs';
import crypto from 'crypto';
import os from 'os';
import dotenv from 'dotenv';
import electronUpdaterModule from 'electron-updater';
import { getLocalMachineId as resolveSharedLocalMachineId } from '../lib/licensing/localMachineId.js';
import { isDeviceActivationTokenInput } from '../lib/licensing/deviceActivationToken.js';
import { resolveOfflineLicensePublicKeyPem } from '../lib/licensing/offlineLicensePublicKeys.js';
import { electronLogError, electronLogInfo, electronLogWarn } from './logger.js';
import { getOrCreateDbEncryptionKey } from './dbEncryptionKey.js';
import {
  bootstrapDevice as bootstrapDeviceAuth,
  getDeviceIdentity as getDeviceAuthIdentity,
  clearDeviceCredentials as clearDeviceAuthCredentials,
  getValidAccessToken as getValidDeviceAccessToken,
  initDeviceAuthNonBlocking,
} from './deviceAuth/deviceAuthClient.js';
import { startDeviceAuthBridge, stopDeviceAuthBridge } from './deviceAuth/deviceAuthBridge.js';
import {
  requestOfflineLicense,
  installOfflineLicense as installOfflineLicenseLocal,
  getOfflineLicenseState as getOfflineLicenseStateLocal,
} from './deviceAuth/offlineLicenseClient.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, '..');

// Pilot Gate Instalação/Recovery — mesmo achado/correcção de api/server.js:
// dotenv.config({override:true}) apagava ENV explicitamente injectada por quem arrancou
// ESTE processo (ex.: o instalador/electron-builder, ou um teste), sempre que .env.local
// definisse a MESMA chave — mesmo com um valor "legítimo" nesse ficheiro. .env continua só
// a preencher lacunas; .env.local continua a ganhar a .env, mas nunca a algo já em
// process.env ANTES deste ficheiro sequer correr.
const externallyProvidedEnvKeys = new Set(Object.keys(process.env));
function loadEnvFile(filePath, { override = false } = {}) {
  if (!fsSync.existsSync(filePath)) return;
  const parsed = dotenv.parse(fsSync.readFileSync(filePath));
  for (const [key, value] of Object.entries(parsed)) {
    if (externallyProvidedEnvKeys.has(key)) continue;
    if (override || process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}
loadEnvFile(path.join(projectRoot, '.env'));
loadEnvFile(path.join(projectRoot, '.env.local'), { override: true });

/** Segredos gerados em build (scripts/inject-pos-build-secrets.mjs) para o instalador. */
const loadPackagedBuildSecrets = () => {
  const candidates = [
    path.join(__dirname, '.build-secrets.json'),
    path.join(process.resourcesPath || '', 'app.asar', 'electron', '.build-secrets.json'),
    path.join(process.resourcesPath || '', 'electron', '.build-secrets.json'),
  ];
  // Em instalado, o ficheiro do build é a fonte de verdade — variáveis de
  // utilizador no Windows não podem ganhar. (Etapa 1F.5c: o injector nunca
  // mais escreve POS_LICENSE_HMAC_SECRET aqui — ver scripts/inject-pos-build-secrets.mjs.)
  let preferPackagedSecrets = false;
  try {
    preferPackagedSecrets = Boolean(app?.isPackaged);
  } catch {
    preferPackagedSecrets = false;
  }
  for (const candidate of candidates) {
    try {
      if (!candidate || !fsSync.existsSync(candidate)) continue;
      const parsed = JSON.parse(fsSync.readFileSync(candidate, 'utf8'));
      if (!parsed || typeof parsed !== 'object') continue;
      for (const [key, value] of Object.entries(parsed)) {
        const text = String(value ?? '').trim();
        if (!text) continue;
        if (preferPackagedSecrets || !String(process.env[key] ?? '').trim()) {
          process.env[key] = text;
        }
      }
      return;
    } catch {
      // try next
    }
  }
};
loadPackagedBuildSecrets();

/** Dev / consola (browser): 3000/3001. Instalador empacotado: 3730/3731 (evita conflito com npm run dev). */
const DEV_WEB_PORT = 3000;
const DEV_API_PORT = 3001;
const PACKAGED_WEB_PORT = 3730;
const PACKAGED_API_PORT = 3731;

/**
 * Em Windows o launcher de dev usa POSly.exe (cópia do electron.exe com ícone).
 * Electron trata qualquer EXE ≠ electron.exe como empacotado — isso quebrava o
 * arranque em busca de resources/web/server.js. Detectamos o dist de node_modules.
 */
const isPackagedBuild = () => {
  const forced = String(process.env.POS_ELECTRON_DEV || '').trim().toLowerCase();
  if (forced === '1' || forced === 'true' || forced === 'yes') return false;
  try {
    const exec = path.normalize(process.execPath).toLowerCase();
    const marker = path
      .normalize(path.join('node_modules', 'electron', 'dist'))
      .toLowerCase();
    if (exec.includes(marker)) return false;
  } catch {
    /* ignore */
  }
  return app.isPackaged;
};

const resolveAppWebPort = () => {
  if (isPackagedBuild()) return PACKAGED_WEB_PORT;
  const fromEnv = Number.parseInt(String(process.env.POS_WEB_PORT || ''), 10);
  if (Number.isFinite(fromEnv) && fromEnv > 0) return fromEnv;
  return DEV_WEB_PORT;
};

const resolveAppApiPort = () => {
  if (isPackagedBuild()) return PACKAGED_API_PORT;
  const fromEnv = Number.parseInt(String(process.env.POS_API_PORT || ''), 10);
  if (Number.isFinite(fromEnv) && fromEnv > 0) return fromEnv;
  return DEV_API_PORT;
};

const resolvePosAppMode = () => 'pos';

const resolveDevWebPort = () => resolveAppWebPort();

const resolveDevWebUrl = () => {
  const port = resolveDevWebPort();
  return `http://localhost:${port}/`;
};

const { autoUpdater } = electronUpdaterModule;

/** Machine ID: em dev pode ser POS_MACHINE_ID (pasta .dev-tenants); instalado = hardware real. */
const resolveLocalMachineId = () => resolveSharedLocalMachineId();

let backendProcess = null;
let webProcess = null;
let deviceAuthBridgeInfo = null;
let mainWindow = null;
let splashWindow = null;
let backendStartupLogs = '';
let webStartupLogs = '';

const fileExists = async (targetPath) => {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
};

const ensureDir = async (targetPath) => {
  await fs.mkdir(targetPath, { recursive: true });
};

const getRuntimePaths = () => {
  const userDataPath = app.getPath('userData');
  // Backups em Documentos (fácil de encontrar/copiar); BD/licença ficam em AppData.
  const backupsPath = path.join(app.getPath('documents'), 'POSly Backup');
  return {
    userDataPath,
    databasePath: path.join(userDataPath, 'data', 'database.db'),
    backupsPath,
    configPath: path.join(userDataPath, 'config.json'),
    licensePath: path.join(userDataPath, 'license.json'),
    stationRuntimePath: path.join(userDataPath, 'station-runtime.json'),
  };
};

/** Pasta canónica em %APPDATA%\POSly (ou POS_APP_USERDATA_SUBDIR). Deve correr ANTES de app.ready.
 * Dev: POS_USER_DATA_PATH aponta para .dev-tenants/<id>/ e isola do instalado.
 * BD/licença/config ficam em AppData; backups em Documentos\POSly Backup.
 * Updates/NSIS só substituem Program Files (deleteAppDataOnUninstall=false). */
const configureCanonicalUserDataPath = () => {
  try {
    const explicit = String(process.env.POS_USER_DATA_PATH ?? '').trim();
    if (explicit) {
      const target = path.resolve(explicit);
      app.setPath('userData', target);
      console.log('[electron] userData DEV isolado:', target);
      return target;
    }
    const override = String(process.env.POS_APP_USERDATA_SUBDIR ?? '').trim();
    const subdir = override || 'POSly';
    const appDataRoot =
      typeof app.getPath === 'function'
        ? app.getPath('appData')
        : process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    const target = path.join(appDataRoot, subdir);
    app.setPath('userData', target);
    console.log('[electron] userData canónico:', target);
    return target;
  } catch (error) {
    console.warn('[electron] Falha a fixar userData canónico:', error?.message ?? error);
    return null;
  }
};

const userDataHasBusinessPayload = async (dir) => {
  if (!dir) return false;
  const checks = [
    path.join(dir, 'license.json'),
    path.join(dir, 'db-encryption.key'),
    path.join(dir, 'data', 'database.db'),
    path.join(dir, 'data', 'pos.db'),
  ];
  for (const candidate of checks) {
    if (await fileExists(candidate)) return true;
  }
  return false;
};

const copyIfExists = async (fromPath, toPath) => {
  if (!(await fileExists(fromPath))) return false;
  await ensureDir(path.dirname(toPath));
  await fs.cp(fromPath, toPath, { recursive: true, force: true });
  return true;
};

/**
 * Se a pasta actual estiver vazia (pós-update / rename), recupera licença+BD+chave
 * de pastas legadas em AppData / LocalAppData.
 */
const migrateLegacyUserDataIfNeeded = async () => {
  // Dev isolado (.dev-tenants): nunca copiar dados do AppData do instalado.
  if (String(process.env.POS_USER_DATA_PATH ?? '').trim()) {
    return { migrated: false, reason: 'dev-user-data-override' };
  }
  const current = app.getPath('userData');
  await ensureDir(current);

  const markerPath = path.join(current, '.userdata-migrated');
  if (await fileExists(markerPath)) return { migrated: false, reason: 'already-migrated' };
  if (await userDataHasBusinessPayload(current)) {
    return { migrated: false, reason: 'current-has-data' };
  }

  const appDataRoot = app.getPath('appData');
  const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  const legacyNames = [
    'POSly',
    'posly',
    'NINO POS',
    'Nino POS',
    'nino-pos',
    'NINO-POS',
    'POS system',
    'pos system',
    'POS-system',
  ];

  const candidates = [];
  for (const name of legacyNames) {
    candidates.push(path.join(appDataRoot, name));
    candidates.push(path.join(localAppData, name));
  }

  const currentNorm = path.normalize(current).toLowerCase();
  for (const candidate of candidates) {
    const candidateNorm = path.normalize(candidate).toLowerCase();
    if (candidateNorm === currentNorm) continue;
    if (!(await userDataHasBusinessPayload(candidate))) continue;

    electronLogInfo(
      'electron.userdata_migrate',
      `A recuperar dados de pasta legada: ${candidate} → ${current}`,
      { module: 'main', from: candidate, to: current },
    );

    const files = [
      'license.json',
      'db-encryption.key',
      'config.json',
      'station-runtime.json',
    ];
    for (const fileName of files) {
      await copyIfExists(path.join(candidate, fileName), path.join(current, fileName));
    }
    await copyIfExists(path.join(candidate, 'data'), path.join(current, 'data'));
    await copyIfExists(path.join(candidate, 'backups'), path.join(current, 'backups'));

    try {
      await fs.writeFile(
        markerPath,
        JSON.stringify({ from: candidate, at: new Date().toISOString() }, null, 2),
        'utf8',
      );
    } catch {
      /* ignore */
    }

    return { migrated: true, from: candidate, to: current };
  }

  return { migrated: false, reason: 'no-legacy-found' };
};


const readStationRuntimeConfig = async () => {
  const { stationRuntimePath } = getRuntimePaths();
  try {
    const raw = await fs.readFile(stationRuntimePath, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') {
      return { mode: 'server', lanAccessEnabled: false, discoveryEnabled: true };
    }
    return {
      mode: String(parsed.mode ?? 'server').toLowerCase() === 'client' ? 'client' : 'server',
      serverApiBaseUrl: String(parsed.serverApiBaseUrl ?? '').trim(),
      stationCode: String(parsed.stationCode ?? 'caixa-1').trim(), // so etiqueta; NUNCA identidade
      stationId: String(parsed.stationId ?? '').trim() || null, // nao secreto; a identidade real e station-identity.json + chave em safeStorage
      lanAccessEnabled: Boolean(parsed.lanAccessEnabled),
      discoveryEnabled: parsed.discoveryEnabled !== false,
    };
  } catch {
    return { mode: 'server', lanAccessEnabled: false, discoveryEnabled: true };
  }
};

const writeStationRuntimeConfig = async (patch = {}) => {
  const current = await readStationRuntimeConfig();
  const next = {
    ...current,
    ...patch,
    mode: String(patch.mode ?? current.mode ?? 'server').toLowerCase() === 'client' ? 'client' : 'server',
  };
  const { stationRuntimePath } = getRuntimePaths();
  await fs.writeFile(stationRuntimePath, JSON.stringify(next, null, 2), 'utf8');
  return next;
};

const appendBoundedLog = (current, chunk) => {
  const next = `${current}${String(chunk ?? '')}`;
  return next.length > 6000 ? next.slice(-6000) : next;
};

const waitForHttp = async (url, timeoutMs = 45000) => {
  const started = Date.now();
  // Preferir /health (público). Raiz antiga também é pública após o fix de auth.
  const probeUrl = (() => {
    try {
      const parsed = new URL(url);
      if (!parsed.pathname || parsed.pathname === '/') {
        parsed.pathname = '/health';
      }
      return parsed.toString();
    } catch {
      return String(url).replace(/\/?$/, '/health');
    }
  })();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(probeUrl, { method: 'GET', cache: 'no-store' });
      if (response.ok || response.status < 500) return;
    } catch {
      // keep polling until timeout
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Timeout aguardando ${probeUrl}`);
};

// Etapa 1F.5c (itens 5-10): toda a implementação HMAC de licença local
// (assinatura/verificação de licença assinada, vouchers, canonicalização,
// leitura/escrita selada baseada em segredo partilhado) foi removida do POS.
// O único mecanismo comercial é Activation Token → Device Auth →
// Offline License Ed25519 (activateViaDeviceActivationToken, abaixo, e
// electron/deviceAuth/offlineLicenseClient.js). Nenhuma função de
// sign/verify baseada em segredo partilhado permanece no runtime
// distribuível — ver relatório da etapa para o inventário completo.

const buildActivationCode = (machineId) => {
  const payload = {
    machine_id: String(machineId ?? '').trim(),
  };
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
};

const getActivationStateInternal = async () => {
  const machineId = resolveLocalMachineId();
  const activationCode = buildActivationCode(machineId);
  const { licensePath } = getRuntimePaths();

  // Electron + npm run dev:tenant (API externa): confiar na licença da BD do tenant.
  if (shouldSkipLocalLicenseGate()) {
    const setup = await fetchSetupStatusReliable();
    if (setup?.licenseActivated) {
      console.log('[electron] Licença local ignorada (API externa / skip) — BD do tenant activa.');
      return {
        success: true,
        isActivated: true,
        machineId,
        activationCode,
        licensePath,
        reason: 'dev-external-api',
      };
    }
    return {
      success: true,
      isActivated: false,
      machineId,
      activationCode,
      licensePath,
      reason: setup
        ? 'A base do tenant ainda não tem licença activada.'
        : 'API do tenant indisponível. Arranque npm run dev:tenant antes do Electron.',
    };
  }

  // Novo caminho Ed25519 (Etapa 1F.5b, item 20; corrigido em 1F.5c item 0) —
  // verificado de novo AGORA, nunca a partir de cache (item 10). "Confirmação
  // da BD" aqui significa EXCLUSIVAMENTE app_setup_state no SQLite local, via
  // /setup/status da API local (127.0.0.1) — NUNCA Supabase/license-console.
  // skipRegistrySync=1 é obrigatório neste ponto: sem ele, /setup/status
  // tentaria syncLicenseRegistry() (chamada de rede real ao license-console)
  // como efeito secundário antes de responder — exactamente a dependência
  // cloud-no-startup-local que esta etapa proíbe. Licença Ed25519 válida +
  // machine binding + não expirada + confirmação SQLite local é suficiente;
  // nenhuma chamada de rede é feita nem esperada para autorizar o arranque.
  const offlineLicenseState = getOfflineLicenseStateLocal({
    userDataPath: app.getPath('userData'),
    resolvePublicKeyPem: resolveOfflineLicensePublicKeyPem,
    machineId,
  });
  if (offlineLicenseState.ok) {
    const setupForOffline = await fetchSetupStatusReliable(6, 250, { skipRegistrySync: true });
    if (setupForOffline?.licenseActivated) {
      return {
        success: true,
        isActivated: true,
        machineId,
        activationCode,
        licensePath,
        reason: 'offline-ed25519',
      };
    }
  }

  if (!(await fileExists(licensePath))) {
    return {
      success: true,
      isActivated: false,
      machineId,
      activationCode,
      licensePath,
      reason: 'Licença não encontrada nesta instalação. Introduza o token de activação.',
    };
  }

  // Etapa 1F.5c (item 7): qualquer license.json encontrado a partir daqui é
  // SEMPRE legado (HMAC) — desde esta etapa o POS nunca mais escreve neste
  // ficheiro (usa offline-license.json, Ed25519, verificado acima). Nunca
  // validar/decifrar/converter uma licença legado localmente: sem fallback,
  // sem migração automática — exige novo onboarding legítimo via backend.
  return {
    success: true,
    isActivated: false,
    machineId,
    activationCode,
    licensePath,
    reason: 'LEGACY_LICENSE_UNSUPPORTED',
  };
};

/**
 * Novo onboarding Ed25519 (Etapa 1F.5b): Activation Token → Device Auth
 * bootstrap → Device JWT → /device/offline-license → verificação local →
 * armazenamento → persistência de estado local via API.
 *
 * Retry-safe após bootstrap (item 17/18): se já existe uma identidade Device
 * Auth local (de uma tentativa anterior que falhou DEPOIS do bootstrap —
 * ex.: emissão da licença ou escrita local falhou), reutiliza-a em vez de
 * tentar bootstrap de novo com um token de activação já consumido (single-use).
 * Nunca cria um device novo só porque um passo posterior falhou.
 */
const activateViaDeviceActivationToken = async (rawToken) => {
  const userDataPath = app.getPath('userData');
  const issuerBaseUrl = String(process.env.POS_LICENSE_ISSUER_BASE_URL ?? '').trim();
  const machineId = resolveLocalMachineId();

  const existingIdentity = getDeviceAuthIdentity({ userDataPath });
  if (!existingIdentity?.hasCredentials) {
    const bootstrap = await bootstrapDeviceAuth({
      activationToken: rawToken,
      machineId,
      userDataPath,
      issuerBaseUrl,
    });
    if (!bootstrap.ok) {
      return {
        success: false,
        error: bootstrap.error || 'Falha ao activar dispositivo.',
        kind: bootstrap.kind,
      };
    }
  }

  // getValidAccessToken devolve o access token (string) ou null — nao um objecto { ok }.
  const deviceAccessToken = await getValidDeviceAccessToken({ userDataPath, issuerBaseUrl });
  if (!deviceAccessToken) {
    // item 18: bootstrap já aconteceu — nunca pedir novo token de activação por isto.
    return {
      success: false,
      error: 'Falha ao obter token de dispositivo (tente novamente).',
      retryable: true,
    };
  }

  const issuance = await requestOfflineLicense({
    accessToken: deviceAccessToken,
    issuerBaseUrl,
  });
  if (!issuance.ok) {
    return { success: false, error: issuance.error, kind: issuance.kind, retryable: true };
  }

  // Verificação local ANTES de qualquer persistência (item 3) — nunca
  // aceita/instala um envelope que não verifique.
  const installLocal = installOfflineLicenseLocal({
    envelope: issuance.envelope,
    userDataPath,
    resolvePublicKeyPem: resolveOfflineLicensePublicKeyPem,
    machineId,
  });
  if (!installLocal.ok) {
    return { success: false, error: installLocal.error, kind: installLocal.kind };
  }

  // Persistência de estado local (tenant/licença/admin) via API local — a API
  // revalida a assinatura de novo (defesa em profundidade, nunca confia no
  // chamador IPC). Se isto falhar, a licença já verificada continua em disco
  // (item 18) — um novo pedido reutiliza o Device Auth existente e tenta
  // instalar de novo, sem pedir novo activation token nem criar novo device.
  try {
    const apiPort = resolveAppApiPort();
    const response = await fetch(`http://127.0.0.1:${apiPort}/setup/license/install-offline-license`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ offline_license: issuance.envelope, machine_id: machineId }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      return {
        success: false,
        error: data?.error || data?.data?.error || 'Falha ao gravar estado local da licença.',
        retryable: true,
      };
    }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'API local indisponível — tente novamente.',
      retryable: true,
    };
  }

  return { success: true, machineId, offlineLicense: true };
};

// Etapa 1F.5c (itens 5-6): único mecanismo comercial do POS — Activation
// Token → Device Auth → Offline License Ed25519. Nunca reconhece
// série/voucher/licença assinada HMAC/reactivation token simétrico — sem
// fallback automático, sem "hidden compatibility".
const activateLicenseInternal = async (rawLicenseKey) => {
  const machineId = resolveLocalMachineId();
  const activationCode = buildActivationCode(machineId);
  const { licensePath } = getRuntimePaths();

  if (isDeviceActivationTokenInput(rawLicenseKey)) {
    const result = await activateViaDeviceActivationToken(rawLicenseKey);
    return { ...result, machineId, activationCode, licensePath };
  }

  return {
    success: false,
    machineId,
    activationCode,
    licensePath,
    error: 'Token de activação inválido. Peça um novo token ao seu fornecedor.',
  };
};

/**
 * Etapa 1F.5c: deixou de derivar DEFAULT_TENANT_ID do legacy license.json
 * (nunca mais escrito). O tenant da instalação Ed25519 já fica persistido em
 * `licenses`/`tenants` pela própria API (installOfflineLicenseState) — a API
 * resolve o tenant a partir da BD, nunca precisando deste env var para o
 * caminho novo. Mantido como stub (nunca lança, nunca bloqueia arranque) só
 * para não obrigar a tocar em todos os chamadores de spawnNodeService.
 */
const licenseEnvForBackend = async () => ({});

/** Raiz lógica do app (app.asar) — resolução de `node_modules` no pacote. */
const resolvePackagedAppRoot = () => app.getAppPath();

/** Diretório real para `cwd` do processo filho (não usar o ficheiro .asar no Windows). */
const resolvePackagedCwd = () => {
  const appPath = app.getAppPath();
  if (appPath.endsWith('.asar')) {
    return path.dirname(appPath);
  }
  return appPath;
};

const resolveNodeBinaryForChild = () => {
  const candidates = [process.execPath, process.argv[0]].filter(Boolean).map((p) => path.normalize(p));
  for (const candidate of candidates) {
    try {
      fsSync.accessSync(candidate, fsSync.constants.F_OK);
      return candidate;
    } catch {
      // try next
    }
  }
  return path.normalize(process.execPath);
};

const resolveBackendEntry = async () => {
  if (isPackagedBuild()) {
    const appRoot = resolvePackagedAppRoot();
    const candidates = [
      path.join(appRoot, 'api', 'server.js'),
      path.join(process.resourcesPath, 'app.asar', 'api', 'server.js'),
      path.join(process.resourcesPath, 'api', 'server.js'),
    ];
    for (const candidate of candidates) {
      if (await fileExists(candidate)) return candidate;
    }
    throw new Error('Backend não encontrado (api/server.js no app.asar).');
  }

  return path.join(__dirname, '..', 'api', 'server.js');
};

const resolveWebEntry = async () => {
  if (!isPackagedBuild()) return null;
  const webEntry = path.join(process.resourcesPath, 'web', 'server.js');
  if (!(await fileExists(webEntry))) {
    throw new Error('Frontend standalone não encontrado em resources/web/server.js.');
  }
  return webEntry;
};

const spawnNodeService = ({ entryPath, env, cwd, onLog, onExitLogPrefix }) => {
  const nodeBin = resolveNodeBinaryForChild();
  const workDir =
    cwd ||
    (isPackagedBuild() && String(entryPath).includes('.asar')
      ? resolvePackagedCwd()
      : path.dirname(entryPath));

  const childEnv = {
    ...process.env,
    ...env,
    ELECTRON_RUN_AS_NODE: '1',
    NODE_ENV: isPackagedBuild() ? 'production' : process.env.NODE_ENV || 'development',
    ...(isPackagedBuild()
      ? {
          POS_APP_MODE: 'pos',
          NODE_PATH: resolvePackagedAppRoot(),
        }
      : {}),
  };
  // Empacotado: nunca propagar fallback de licença sem assinatura para a API.
  if (isPackagedBuild()) {
    delete childEnv.POS_LICENSE_ALLOW_UNSIGNED;
  }

  const options = {
    cwd: workDir,
    env: childEnv,
    stdio: 'pipe',
    windowsHide: process.platform === 'win32',
  };

  const child =
    process.platform === 'win32'
      ? execFile(nodeBin, [entryPath], options)
      : spawn(nodeBin, [entryPath], options);

  child.stdout?.on('data', (chunk) => onLog(chunk));
  child.stderr?.on('data', (chunk) => onLog(chunk));
  child.on('exit', (code, signal) => {
    onLog(`\n[${onExitLogPrefix} exited code=${code ?? 'null'} signal=${signal ?? 'null'}]\n`);
  });
  child.on('error', (error) => {
    onLog(`\n[${onExitLogPrefix} spawn error: ${String(error?.message ?? error)}]\n`);
  });

  return child;
};

const useExternalApi = () => {
  const raw = String(process.env.POS_ELECTRON_USE_EXTERNAL_API || '').trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes';
};

/** Dev com API do tenant (ex.: qa02): não bloquear pelo license.json antigo do AppData. */
const shouldSkipLocalLicenseGate = () => {
  const raw = String(process.env.POS_ELECTRON_SKIP_LICENSE || '').trim().toLowerCase();
  if (['1', 'true', 'yes', 'y'].includes(raw)) return true;
  return useExternalApi() && !isPackagedBuild();
};

const isApiAlreadyUp = async (timeoutMs = 400) => {
  const apiPort = resolveAppApiPort();
  try {
    await waitForHttp(`http://127.0.0.1:${apiPort}`, timeoutMs);
    return true;
  } catch {
    return false;
  }
};

const startBackend = async () => {
  const apiPort = resolveAppApiPort();
  setSplashStatus('A ler configuração do posto…');
  const stationRuntime = await readStationRuntimeConfig();

  // Posto remoto: não inicia API local — a UI fala com o servidor LAN.
  if (stationRuntime.mode === 'client' && stationRuntime.serverApiBaseUrl) {
    setSplashStatus('A ligar ao servidor da loja…');
    console.log(
      `[electron] Modo posto remoto — API no servidor ${stationRuntime.serverApiBaseUrl} (não inicia api/server.js).`,
    );
    return;
  }

  if (useExternalApi()) {
    setSplashStatus('A ligar à API local…');
    console.log(
      `[electron] A usar API externa em http://127.0.0.1:${apiPort} (não inicia api/server.js).`,
    );
    await waitForHttp(`http://127.0.0.1:${apiPort}`, 10_000);
    return;
  }

  // Em instalado nunca reutilizar um processo 3731 “órfão” (ex.: crash / outro teste no
  // mesmo PC) — esse processo pode gravar license.json noutro sítio e a UI fica em
  // “Licença não encontrada” depois do número de série.
  if (!isPackagedBuild() && (await isApiAlreadyUp())) {
    setSplashStatus('A ligar à API em execução…');
    console.log(
      `[electron] A usar API já activa em http://127.0.0.1:${apiPort} (dev).`,
    );
    await waitForHttp(`http://127.0.0.1:${apiPort}`, 10_000);
    return;
  }

  const paths = getRuntimePaths();
  setSplashStatus('A preparar pastas de dados…');
  await ensureDir(path.dirname(paths.databasePath));
  await ensureDir(paths.backupsPath);

  // Migração one-shot: pos.db → database.db
  const legacyDbPath = path.join(path.dirname(paths.databasePath), 'pos.db');
  try {
    const legacyExists = await fileExists(legacyDbPath);
    const newExists = await fileExists(paths.databasePath);
    if (legacyExists && !newExists) {
      setSplashStatus('A migrar base de dados…');
      await fs.rename(legacyDbPath, paths.databasePath);
      for (const suffix of ['-wal', '-shm']) {
        const from = `${legacyDbPath}${suffix}`;
        const to = `${paths.databasePath}${suffix}`;
        if (await fileExists(from)) {
          await fs.rename(from, to);
        }
      }
      console.log('[electron] Migrado pos.db → database.db');
    }
  } catch (err) {
    console.warn('[electron] Falha ao migrar pos.db:', err);
  }

  const dbExistedBeforeBoot =
    (await fileExists(paths.databasePath)) || (await fileExists(legacyDbPath));
  setSplashStatus('A verificar licença…');
  const backendEntry = await resolveBackendEntry();
  const licenseEnv = await licenseEnvForBackend();
  const issuerBaseUrl = String(process.env.POS_LICENSE_ISSUER_BASE_URL ?? '').trim();
  // Etapa 1F.5c: POS_LICENSE_HMAC_SECRET deixou de ser lida/encaminhada aqui —
  // o POS runtime não depende dela (licença offline Ed25519 + Device Auth).
  // Nunca reintroduzir esta variável no env do processo API filho.
  const supabaseUrl = String(
    process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
  ).trim();
  // Etapa 1F.4: SUPABASE_SERVICE_ROLE_KEY deixou de ser lida/encaminhada aqui de
  // propósito — o POS runtime não depende dela desde a Etapa 1F.3 (Device JWT).
  // Nunca reintroduzir esta variável no env do processo API filho.
  const supabaseAnonKey = String(
    process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
  ).trim();
  // Etapa 1G.4 (Fase 1 do Backoffice): o processo API precisa de saber a SUA PRÓPRIA
  // identidade de Device para o pull de stock_movements distinguir "movimento que eu
  // próprio enviei" (nunca reaplicar) de "movimento de outro Device/Backoffice" (aplicar
  // uma vez). Reutiliza a identidade Device Auth já existente e protegida por safeStorage
  // (electron/deviceAuth) — nunca um armazenamento paralelo. device_id não é segredo (já
  // viaja em claro dentro do JWT que o próprio processo API envia à cloud); só o refresh
  // token é que nunca sai daqui.
  const deviceIdentity = getDeviceAuthIdentity({ userDataPath: paths.userDataPath });
  const deviceId = deviceIdentity?.deviceId ? String(deviceIdentity.deviceId).trim() : '';

  const lanAccess = Boolean(stationRuntime.lanAccessEnabled);
  const bindHost = lanAccess ? '0.0.0.0' : '127.0.0.1';
  // Segredo estável por instalação para Bearer (env → ficheiro existente → derivar).
  const secretPath = path.join(path.dirname(paths.databasePath), 'auth-hmac.secret');
  let authHmac = String(process.env.POS_AUTH_HMAC_SECRET || process.env.AUTH_BEARER_SHARED_SECRET || '').trim();
  if (!authHmac) {
    try {
      authHmac = String(await fs.readFile(secretPath, 'utf8')).trim();
    } catch {
      authHmac = '';
    }
  }
  if (!authHmac) {
    authHmac = crypto.createHash('sha256').update(`posly-auth:${paths.userDataPath}`).digest('hex').slice(0, 48);
  }
  try {
    await fs.writeFile(secretPath, `${authHmac}\n`, { encoding: 'utf8', mode: 0o600 });
  } catch (err) {
    console.warn('[electron] Não foi possível gravar auth-hmac.secret:', err?.message ?? err);
  }

  let dbEncryptionKeyHex = '';
  try {
    setSplashStatus('A preparar encriptação da base de dados…');
    const dbKey = getOrCreateDbEncryptionKey(paths.userDataPath);
    dbEncryptionKeyHex = dbKey.keyHex;
    if (dbKey.created) {
      electronLogInfo(
        `[electron] Chave SQLCipher criada (${dbKey.storage}) — sem senha ao operador`,
      );
    }
  } catch (err) {
    electronLogError('[electron] Falha ao obter chave de encriptação da BD:', err);
    throw err;
  }

  // Etapa 1G.3.6: identidade TLS do Server (chave so cifrada com safeStorage). Sem ela a API nao abre a LAN.
  let serverTls = null;
  if (lanAccess) {
    try {
      serverTls = await getOrCreateServerTlsIdentity({ userDataPath: paths.userDataPath, safeStorage });
      if (!serverTls) electronLogError('[electron] LAN activa mas safeStorage indisponivel: sem identidade TLS, a LAN fica desligada.');
    } catch (err) {
      electronLogError('[electron] Falha ao preparar a identidade TLS do Server:', err);
    }
  }

  setSplashStatus('A iniciar base de dados…');
  backendStartupLogs = '';
  backendProcess = spawnNodeService({
    entryPath: backendEntry,
    env: {
      POS_API_PORT: String(apiPort),
      POS_API_BIND: bindHost,
      POS_LAN_ACCESS: lanAccess ? '1' : '0',
      POS_STATION_DISCOVERY: stationRuntime.discoveryEnabled === false ? '0' : '1',
      POS_AUTH_HMAC_SECRET: authHmac,
      AUTH_BEARER_SHARED_SECRET: authHmac,
      POS_DB_PATH: paths.databasePath,
      POS_BACKUP_DIR: paths.backupsPath,
      POS_USER_DATA_PATH: paths.userDataPath,
      POS_CONFIG_PATH: paths.configPath,
      POS_LICENSE_PATH: paths.licensePath,
      POS_DB_EXISTED_BEFORE_BOOT: dbExistedBeforeBoot ? 'true' : 'false',
      POS_DB_ENCRYPTION_KEY: dbEncryptionKeyHex,
      POS_DB_ENCRYPTION: '1',
      ...(serverTls ? { POS_TLS_CERT_PEM: serverTls.certPem, POS_TLS_KEY_PEM: serverTls.keyPem } : {}),
      ...(issuerBaseUrl ? { POS_LICENSE_ISSUER_BASE_URL: issuerBaseUrl } : {}),
      ...(supabaseUrl ? { SUPABASE_URL: supabaseUrl } : {}),
      // Etapa 1F.4: nunca encaminhar SUPABASE_SERVICE_ROLE_KEY para api/server.js —
      // ver comentário acima. O processo API nunca recebe esta variável.
      ...(supabaseAnonKey ? { SUPABASE_ANON_KEY: supabaseAnonKey } : {}),
      ...(deviceId ? { POS_DEVICE_ID: deviceId } : {}),
      // Ponte Device Auth (Etapa 1F.2): só URL+segredo efémero da ponte local —
      // NUNCA o refresh token. A API pede um access token actual por pedido.
      ...(deviceAuthBridgeInfo?.url
        ? {
            POS_DEVICE_AUTH_BRIDGE_URL: deviceAuthBridgeInfo.url,
            POS_DEVICE_AUTH_BRIDGE_SECRET: deviceAuthBridgeInfo.secret,
          }
        : {}),
      ...licenseEnv,
      // Nunca activar AUTH_ALLOW_LEGACY_LOCAL em builds empacotados: o proxy
      // Next (/pos-backend → 127.0.0.1) faria a API tratar pedidos LAN como
      // loopback e devolveria /clientes sem credenciais.
    },
    onLog: (chunk) => {
      backendStartupLogs = appendBoundedLog(backendStartupLogs, chunk);
    },
    onExitLogPrefix: 'api',
  });

  try {
    setSplashStatus('A aguardar serviço local…');
    await waitForHttp(`http://127.0.0.1:${apiPort}`);
    setSplashStatus('Base de dados pronta');
  } catch (error) {
    const details = backendStartupLogs.trim();
    // Etapa 1F.6.1 (item 3): reutiliza o MESMO mecanismo de erro fatal de
    // arranque (dialog.showErrorBox mais abaixo) mas com uma mensagem
    // específica quando a causa é a BD existente não poder ser aberta/
    // validada — nunca apaga/renomeia/substitui nada, só informa que os
    // dados precisam de recuperação/restauro técnico.
    if (details.includes('DATABASE_CORRUPTED')) {
      throw new Error(
        'A base de dados existente não pôde ser aberta ou validada (ficheiro corrompido ou chave de encriptação incorrecta).\n\n' +
          'Os seus dados NÃO foram apagados nem substituídos — a aplicação recusou-se a continuar para os proteger.\n\n' +
          'Contacte o suporte técnico para recuperação/restauro (ex.: a partir de uma cópia de segurança em Definições → Cópias de segurança).\n\n' +
          `Detalhe técnico:\n${details}`,
      );
    }
    const suffix = details ? `\n\n${details}` : '';
    throw new Error(`Falha ao iniciar backend.${suffix || ` ${String(error?.message ?? error)}`}`);
  }
};

const startStandaloneWeb = async () => {
  if (!isPackagedBuild()) return;

  const webPort = resolveAppWebPort();
  const apiPort = resolveAppApiPort();
  setSplashStatus('A carregar interface…');
  const webEntry = await resolveWebEntry();
  webStartupLogs = '';
  webProcess = spawnNodeService({
    entryPath: webEntry,
    env: {
      PORT: String(webPort),
      // Só a janela Electron precisa do frontend; postos LAN falam com a API.
      // 0.0.0.0 + rewrite /pos-backend expunha clientes sem autenticação.
      HOSTNAME: '127.0.0.1',
      POS_API_URL: `http://127.0.0.1:${apiPort}`,
      NEXT_PUBLIC_POS_API_URL: `http://127.0.0.1:${apiPort}`,
      NEXT_PUBLIC_POS_API_DIRECT_URL: `http://127.0.0.1:${apiPort}`,
    },
    onLog: (chunk) => {
      webStartupLogs = appendBoundedLog(webStartupLogs, chunk);
    },
    onExitLogPrefix: 'web',
  });

  try {
    setSplashStatus('A preparar ecrã principal…');
    await waitForHttp(`http://127.0.0.1:${webPort}`);
  } catch (error) {
    const details = webStartupLogs.trim();
    const suffix = details ? `\n\n${details}` : '';
    throw new Error(`Falha ao iniciar frontend standalone.${suffix || ` ${String(error?.message ?? error)}`}`);
  }
};

const stopServices = () => {
  if (webProcess && !webProcess.killed) webProcess.kill();
  if (backendProcess && !backendProcess.killed) backendProcess.kill();
  webProcess = null;
  backendProcess = null;
  stopDeviceAuthBridge();
};

const fetchSetupStatus = async ({ skipRegistrySync = false } = {}) => {
  try {
    const query = skipRegistrySync ? '?skipRegistrySync=1' : '';
    const response = await fetch(`http://127.0.0.1:${resolveAppApiPort()}/setup/status${query}`);
    if (!response.ok) return null;
    const payload = await response.json().catch(() => null);
    if (payload && typeof payload === 'object' && payload.data && typeof payload.data === 'object') {
      return payload.data;
    }
    return payload;
  } catch {
    return null;
  }
};

/** Evita falso "licença não ack" / "precisa reintroduzir" quando a API ainda não respondeu ao primeiro fetch. */
const fetchSetupStatusReliable = async (attempts = 6, delayMs = 250, opts = {}) => {
  for (let i = 0; i < attempts; i += 1) {
    const row = await fetchSetupStatus(opts);
    if (row && typeof row === 'object') return row;
    if (i < attempts - 1) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  return null;
};

const buildLicenseBlockedHtml = (reason) => `
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Licença inválida</title>
    <style>
      body {
        margin: 0;
        font-family: Segoe UI, sans-serif;
        background: #0f0f10;
        color: #f4f4f5;
        display: flex;
        align-items: center;
        justify-content: center;
        min-height: 100vh;
      }
      .card {
        width: min(560px, 92vw);
        background: #18181b;
        border: 1px solid #27272a;
        border-radius: 14px;
        padding: 24px;
        box-shadow: 0 20px 80px rgba(0, 0, 0, 0.45);
      }
      h1 {
        margin: 0 0 10px;
        color: #f87171;
        font-size: 28px;
      }
      p {
        margin: 0;
        line-height: 1.55;
        color: #d4d4d8;
      }
      code {
        display: block;
        margin-top: 12px;
        padding: 10px;
        border-radius: 8px;
        background: #09090b;
        color: #fef08a;
      }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>Licença inválida</h1>
      <p>Não foi possível iniciar o POS porque a licença local não passou na validação.</p>
      <code>${String(reason ?? 'Erro desconhecido').replace(/</g, '&lt;')}</code>
    </div>
  </body>
</html>
`;

const buildSplashHtml = () => {
  return `
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>POSly</title>
    <style>
      html,
      body {
        margin: 0;
        height: 100%;
        background: transparent;
        overflow: hidden;
        -webkit-user-select: none;
        user-select: none;
      }
      .stage {
        height: 100%;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 18px;
        font-family: Segoe UI, sans-serif;
        padding: 0 28px;
        box-sizing: border-box;
      }
      .mark {
        width: 104px;
        height: 104px;
        border-radius: 22px;
        animation: pulse 1.4s ease-in-out infinite;
      }
      .brand {
        font-size: 12px;
        letter-spacing: 0.18em;
        text-transform: uppercase;
        color: #a1a1aa;
      }
      .status {
        margin: -8px 0 0;
        min-height: 2.6em;
        max-width: 260px;
        font-size: 12px;
        font-weight: 500;
        letter-spacing: 0.02em;
        line-height: 1.35;
        color: #a1a1aa;
        text-align: center;
      }
      .bar {
        width: 160px;
        height: 3px;
        border-radius: 999px;
        background: rgba(161, 161, 170, 0.22);
        overflow: hidden;
      }
      .bar > i {
        display: block;
        height: 100%;
        width: 40%;
        border-radius: inherit;
        background: #0001fb;
        animation: barSlide 1.1s ease-in-out infinite;
      }
      @keyframes pulse {
        0%,
        100% {
          transform: scale(1);
          opacity: 1;
        }
        50% {
          transform: scale(0.9);
          opacity: 0.65;
        }
      }
      @keyframes barSlide {
        0% {
          transform: translateX(-120%);
        }
        100% {
          transform: translateX(320%);
        }
      }
      @media (prefers-reduced-motion: reduce) {
        .mark,
        .bar > i {
          animation: none;
        }
        .bar > i {
          width: 100%;
          transform: none;
          opacity: 0.85;
        }
      }
    </style>
  </head>
  <body>
    <div class="stage">
      <svg class="mark" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 374 374" aria-hidden="true">
        <rect width="374" height="374" rx="62.25" ry="62.25" fill="#0001fb" />
        <path
          fill="#fff"
          d="M296.5,122.76v103.43c0,13.72-11.12,24.84-24.84,24.84h-83.25c-5.34,0-10.2,3.07-12.48,7.9l-18,38.1c-2.28,4.82-7.14,7.9-12.48,7.9h-67.95v-108.01c0-4.1,1.62-8.03,4.52-10.93l23.56-23.56c2.9-2.9,6.82-4.52,10.92-4.52h126.65c3.17,0,5.74,2.57,5.74,5.74,0,1.59-.64,3.02-1.68,4.07-1.03,1.03-2.47,1.68-4.06,1.68h-92.64c-14.61,0-26.45,11.84-26.45,26.45v79.65h14.12c5.39,0,10.29-3.14,12.54-8.04l7.55-16.44,17.71-38.53c2.25-4.89,7.15-8.03,12.54-8.03h39.21c7.68,0,14.9-1.97,21.16-5.43,11.07-6.11,19.2-16.86,21.78-29.63.58-2.83.88-5.76.88-8.76v-2.72h-.08c-.28-4.45-1.19-8.71-2.7-12.7-3.68-9.81-10.8-17.96-19.88-22.97-6.26-3.48-13.48-5.45-21.16-5.45h-76.5l.03-47.75h91.54c4.09,0,8.02,1.62,10.92,4.52l17.83,17.83,20.43,20.42c2.9,2.9,4.53,6.82,4.53,10.93Z"
        />
      </svg>
      <div class="brand">Posly</div>
      <div class="status" id="boot-status" role="status" aria-live="polite">A iniciar…</div>
      <div class="bar" role="progressbar" aria-label="A carregar">
        <i></i>
      </div>
    </div>
  </body>
</html>
`;
};

/** Actualiza a mensagem de arranque no splash (sem versão). */
const setSplashStatus = (message) => {
  const text = String(message ?? '').trim() || 'A iniciar…';
  if (!splashWindow || splashWindow.isDestroyed()) return;
  const apply = () => {
    if (!splashWindow || splashWindow.isDestroyed()) return;
    void splashWindow.webContents
      .executeJavaScript(
        `(() => {
          const el = document.getElementById('boot-status');
          if (el) el.textContent = ${JSON.stringify(text)};
        })();`,
        true,
      )
      .catch(() => {});
  };
  if (splashWindow.webContents.isLoadingMainFrame?.() || splashWindow.webContents.isLoading()) {
    splashWindow.webContents.once('did-finish-load', apply);
    return;
  }
  apply();
};

/** Feedback visual imediato: sem isto o arranque fica sem janela e o utilizador reabre a app várias vezes. */
const createSplashWindow = () => {
  if (splashWindow && !splashWindow.isDestroyed()) return splashWindow;
  const splash = new BrowserWindow({
    width: 340,
    height: 360,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    center: true,
    show: false,
    skipTaskbar: false,
    alwaysOnTop: true,
    title: 'POSly',
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
    },
  });
  splash.on('closed', () => {
    splashWindow = null;
  });
  splash.once('ready-to-show', () => {
    if (!splash.isDestroyed()) splash.show();
  });
  void splash.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(buildSplashHtml())}`);
  splashWindow = splash;
  return splash;
};

const closeSplashWindow = () => {
  if (splashWindow && !splashWindow.isDestroyed()) splashWindow.close();
  splashWindow = null;
};

const revealMainWindow = (win) => {
  closeSplashWindow();
  if (!win || win.isDestroyed()) return;
  if (!win.isVisible()) win.show();
  win.focus();
};

const createWindow = async (opts = {}) => {
  const { blockedReason = null } = opts;
  if (typeof app.setName === 'function') {
    app.setName('POSly');
  }
  const winIcon = path.join(projectRoot, 'assets', 'icon.ico');
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    title: 'POSly',
    icon: winIcon,
    show: false,
    backgroundColor: '#4a4ed4',
    webPreferences: {
      contextIsolation: true,
      sandbox: false,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  Menu.setApplicationMenu(null);
  win.setMenuBarVisibility(false);
  win.setTitle('POSly');
  try {
    if (fsSync.existsSync(winIcon)) win.setIcon(winIcon);
  } catch {
    /* ignore */
  }
  mainWindow = win;

  // Etapa 1F.6 (item 42): hardening pequeno e seguro — a app nunca precisa
  // de abrir popups nem navegar para fora da própria origem local
  // (127.0.0.1:porta ou data: do ecrã de licença bloqueada). Sem isto, uma
  // navegação de topo (ex.: via XSS injectado, link malicioso) levaria o
  // preload.js/contextBridge (window.electronAPI, com acesso a impressão,
  // licenciamento, Device Auth) para dentro de uma página externa arbitrária.
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event, targetUrl) => {
    try {
      const target = new URL(targetUrl);
      const isLoopbackHttp =
        (target.protocol === 'http:' || target.protocol === 'https:') &&
        (target.hostname === '127.0.0.1' || target.hostname === 'localhost');
      const isDataUrl = target.protocol === 'data:';
      if (!isLoopbackHttp && !isDataUrl) {
        event.preventDefault();
        electronLogWarn('[electron] Navegação bloqueada (fora da origem local):', targetUrl);
      }
    } catch {
      event.preventDefault();
    }
  });

  if (blockedReason) {
    setSplashStatus('Licença inválida');
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(buildLicenseBlockedHtml(blockedReason))}`);
    revealMainWindow(win);
    return;
  }

  if (!isPackagedBuild()) {
    const targetUrl = resolveDevWebUrl();
    try {
      setSplashStatus('A ligar ao ambiente de desenvolvimento…');
      await waitForHttp(targetUrl, 90_000);
    } catch (error) {
      const hint =
        ' Confirme que "npm run dev" está activo na porta ' + String(resolveDevWebPort()) + '.';
      await win.loadURL(
        `data:text/html;charset=utf-8,${encodeURIComponent(buildLicenseBlockedHtml(`${String(error?.message ?? error)}${hint}`))}`,
      );
      revealMainWindow(win);
      return;
    }
    try {
      setSplashStatus('A abrir a aplicação…');
      await win.loadURL(targetUrl);
    } catch (error) {
      console.error('[electron] loadURL failed:', error);
      await win.loadURL(
        `data:text/html;charset=utf-8,${encodeURIComponent(buildLicenseBlockedHtml(String(error?.message ?? error)))}`,
      );
    }
    revealMainWindow(win);
    return;
  }
  setSplashStatus('A abrir a aplicação…');
  await win.loadURL(`http://127.0.0.1:${resolveAppWebPort()}`);
  revealMainWindow(win);
};

ipcMain.handle('dialog:selectFolder', async () => {
  const paths = getRuntimePaths();
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory', 'createDirectory'],
    title: 'Selecionar pasta de backup',
    defaultPath: paths.backupsPath,
  });

  if (result.canceled || !Array.isArray(result.filePaths) || result.filePaths.length === 0) {
    return null;
  }
  return result.filePaths[0] ?? null;
});

ipcMain.handle('app:getPaths', async () => {
  const paths = getRuntimePaths();
  return {
    userDataPath: paths.userDataPath,
    databasePath: paths.databasePath,
    backupsPath: paths.backupsPath,
    configPath: paths.configPath,
    licensePath: paths.licensePath,
    databaseExists: await fileExists(paths.databasePath),
    configExists: await fileExists(paths.configPath),
    licenseExists: await fileExists(paths.licensePath),
  };
});

ipcMain.handle('station:getRuntimeConfig', async () => {
  try {
    const cfg = await readStationRuntimeConfig();
    return { success: true, ...cfg };
  } catch (error) {
    return { success: false, error: String(error?.message ?? error) };
  }
});

ipcMain.handle('station:saveRuntimeConfig', async (_event, patch) => {
  try {
    // o renderer nunca escolhe o stationId (so o pairing o define)
    const { stationId: _ignored, ...safePatch } = patch ?? {};
    const cfg = await writeStationRuntimeConfig(safePatch);
    return { success: true, ...cfg };
  } catch (error) {
    return { success: false, error: String(error?.message ?? error) };
  }
});

registerStationIpc({
  ipcMain,
  safeStorage,
  getUserDataPath: () => getRuntimePaths().userDataPath,
  readRuntimeConfig: readStationRuntimeConfig,
  writeRuntimeConfig: writeStationRuntimeConfig,
});

ipcMain.handle('station:scanLan', async () => {
  try {
    const ports = new Set([resolveAppApiPort(), 3731, 3001]);
    const hosts = [];
    const nets = os.networkInterfaces();
    for (const entries of Object.values(nets)) {
      if (!entries) continue;
      for (const net of entries) {
        if ((net.family !== 'IPv4' && net.family !== 4) || net.internal) continue;
        const parts = String(net.address).split('.').map(Number);
        if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) continue;
        const base = `${parts[0]}.${parts[1]}.${parts[2]}`;
        // Sonda hosts comuns + varredura limitada (.1–.40 e .100–.120) para não demorar demais
        const octets = new Set([1, 2, parts[3], 10, 20, 50, 100, 101, 150, 200, 254]);
        for (let i = 1; i <= 40; i += 1) octets.add(i);
        for (let i = 100; i <= 120; i += 1) octets.add(i);
        for (const o of octets) {
          if (o < 1 || o > 254) continue;
          hosts.push(`${base}.${o}`);
        }
      }
    }
    const uniqueHosts = [...new Set(hosts)].slice(0, 120);
    const servers = [];
    const seen = new Set();
    const probe = async (host, port) => {
      // 1G.3.6: descoberta por HTTPS, SEM confianca (so localiza; nao envia credenciais nem estabelece identidade)
      const url = `https://${host}:${port}`;
      try {
        const probe = await probeUnpinned(`${url}/station/discover`, { timeoutMs: 700 });
        if (probe.status !== 200) return;
        const json = probe.json;
        const data = json?.success ? json.data : json;
        if (data?.app !== 'posly') return;
        if (seen.has(url)) return;
        seen.add(url);
        // discovery minimo (1G.3.5): so URL/porta; nenhuma identidade da loja e exposta
        // fingerprint OBSERVADA (nao confiavel): so para o admin comparar com a que o Server mostra
        servers.push({ url, port: data.port || port, observedFingerprint: probe.fingerprint });
      } catch {
        // sem resposta TLS/HTTP neste host
      }
    };
    const tasks = [];
    for (const host of uniqueHosts) {
      for (const port of ports) {
        tasks.push(probe(host, port));
      }
    }
    // lotes de 40
    for (let i = 0; i < tasks.length; i += 40) {
      await Promise.all(tasks.slice(i, i + 40));
    }
    return { success: true, servers };
  } catch (error) {
    return { success: false, error: String(error?.message ?? error), servers: [] };
  }
});

ipcMain.handle('system:getMachineId', async () => {
  try {
    return {
      success: true,
      machineId: resolveLocalMachineId(),
    };
  } catch (error) {
    return {
      success: false,
      error: String(error?.message ?? error ?? 'Falha ao obter machine ID.'),
    };
  }
});

ipcMain.handle('activation:getState', async () => {
  try {
    return await getActivationStateInternal();
  } catch (error) {
    return {
      success: false,
      isActivated: false,
      machineId: '',
      activationCode: '',
      reason: String(error?.message ?? error ?? 'Falha ao obter estado de ativação.'),
    };
  }
});

ipcMain.handle('activation:activate', async (_event, payload) => {
  try {
    const licenseKey = String(payload?.licenseKey ?? '').trim();
    if (!licenseKey) {
      return { success: false, error: 'Chave de licença é obrigatória.' };
    }
    return await activateLicenseInternal(licenseKey);
  } catch (error) {
    return {
      success: false,
      error: String(error?.message ?? error ?? 'Falha ao ativar licença.'),
    };
  }
});

// Device-auth cloud (Etapa 1F.1) — canais explícitos, nunca genéricos.
// Nenhum destes devolve o refresh token à renderer; só metadados e o
// resultado success/error do bootstrap (nem esse devolve o refresh token —
// só device_id + expiração do access token, para a UI confirmar sucesso).
ipcMain.handle('device-auth:bootstrap', async (_event, payload) => {
  try {
    const activationToken = String(payload?.activationToken ?? '').trim();
    if (!activationToken) {
      return { ok: false, error: 'Token de activação é obrigatório.' };
    }
    const result = await bootstrapDeviceAuth({
      activationToken,
      machineId: resolveLocalMachineId(),
      stationCode: payload?.stationCode ?? null,
      userDataPath: app.getPath('userData'),
      issuerBaseUrl: String(process.env.POS_LICENSE_ISSUER_BASE_URL ?? '').trim(),
    });
    if (!result.ok) {
      return { ok: false, kind: result.kind, error: result.error };
    }
    return {
      ok: true,
      deviceId: result.deviceId,
      accessTokenExpiresAt: result.accessTokenExpiresAt,
    };
  } catch (error) {
    return { ok: false, error: String(error?.message ?? error ?? 'Falha ao activar dispositivo.') };
  }
});

ipcMain.handle('device-auth:getStatus', async () => {
  try {
    return { ok: true, ...getDeviceAuthIdentity({ userDataPath: app.getPath('userData') }) };
  } catch (error) {
    return { ok: false, error: String(error?.message ?? error) };
  }
});

ipcMain.handle('device-auth:clearCredentials', async () => {
  try {
    clearDeviceAuthCredentials({ userDataPath: app.getPath('userData') });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: String(error?.message ?? error) };
  }
});

ipcMain.handle('activation:clearLocalLicense', async () => {
  try {
    const { licensePath } = getRuntimePaths();
    // Preferir API: também reabre o wizard (setup_completed / license_activated).
    try {
      const apiPort = resolveAppApiPort();
      const response = await fetch(`http://127.0.0.1:${apiPort}/setup/license/reset-local`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      if (response.ok) {
        electronLogInfo('electron.license_cleared', 'Licença local limpa via API (wizard reaberto)', {
          module: 'main',
          action: 'clearLocalLicense',
          licensePath,
        });
        return {
          success: true,
          licensePath,
          ...(await getActivationStateInternal()),
        };
      }
    } catch {
      // Fallback: só apaga o ficheiro se a API ainda não estiver pronta.
    }

    if (await fileExists(licensePath)) {
      await fs.unlink(licensePath);
    }
    electronLogInfo('electron.license_cleared', 'Licença local apagada (ficheiro)', {
      module: 'main',
      action: 'clearLocalLicense',
      licensePath,
    });
    return {
      success: true,
      licensePath,
      ...(await getActivationStateInternal()),
    };
  } catch (error) {
    return {
      success: false,
      error: String(error?.message ?? error ?? 'Falha ao limpar licença local.'),
    };
  }
});

ipcMain.handle('app:getRuntimeInfo', async () => {
  try {
    return {
      success: true,
      packaged: isPackagedBuild(),
      platform: process.platform,
      version: String(app.getVersion?.() ?? ''),
    };
  } catch (error) {
    return {
      success: false,
      packaged: false,
      platform: process.platform,
      version: '',
      error: String(error?.message ?? error ?? 'Falha ao obter runtime info.'),
    };
  }
});

ipcMain.handle('app:restart', async () => {
  try {
    app.relaunch();
    app.exit(0);
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: String(error?.message ?? error ?? 'Falha ao reiniciar aplicação.'),
    };
  }
});

ipcMain.handle('window:toggleMaximize', async (event) => {
  try {
    const win = BrowserWindow.fromWebContents(event.sender) ?? mainWindow;
    if (!win || win.isDestroyed()) {
      return { success: false, maximized: false, error: 'Janela não disponível.' };
    }
    // Botão "maximizar" no desktop = ecrã inteiro (fullscreen).
    if (win.isFullScreen()) {
      win.setFullScreen(false);
      return { success: true, maximized: false };
    }
    win.setFullScreen(true);
    return { success: true, maximized: true };
  } catch (error) {
    return {
      success: false,
      maximized: false,
      error: String(error?.message ?? error ?? 'Falha ao alternar ecrã inteiro.'),
    };
  }
});

ipcMain.handle('window:isMaximized', async (event) => {
  try {
    const win = BrowserWindow.fromWebContents(event.sender) ?? mainWindow;
    if (!win || win.isDestroyed()) {
      return { success: false, maximized: false };
    }
    return { success: true, maximized: win.isFullScreen() };
  } catch (error) {
    return {
      success: false,
      maximized: false,
      error: String(error?.message ?? error ?? 'Falha ao consultar estado da janela.'),
    };
  }
});

ipcMain.handle('app:quit', async () => {
  try {
    app.quit();
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: String(error?.message ?? error ?? 'Falha ao fechar aplicação.'),
    };
  }
});

ipcMain.handle('serial:listPorts', async () => {
  try {
    const { listSerialPorts } = await import('./customerDisplay.js');
    const ports = await listSerialPorts();
    return { success: true, ports };
  } catch (error) {
    return {
      success: false,
      ports: [],
      error: String(error?.message ?? error ?? 'Falha ao listar portas.'),
    };
  }
});

ipcMain.handle('customerDisplay:write', async (_event, payload) => {
  try {
    const { writeCustomerDisplay } = await import('./customerDisplay.js');
    return await writeCustomerDisplay(payload ?? {});
  } catch (error) {
    return {
      success: false,
      error: String(error?.message ?? error ?? 'Falha ao escrever no display.'),
    };
  }
});

ipcMain.handle('print:listPrinters', async () => {
  const probe = new BrowserWindow({
    show: false,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
    },
  });
  try {
    await probe.loadURL('data:text/html,<html></html>');
    const printers = await probe.webContents.getPrintersAsync();
    return {
      success: true,
      printers: (printers ?? []).map((printer) => ({
        name: String(printer.name ?? ''),
        displayName: String(printer.displayName || printer.name || ''),
        isDefault: Boolean(printer.isDefault),
        status: printer.status,
      })),
    };
  } catch (error) {
    return {
      success: false,
      printers: [],
      error: String(error?.message ?? error ?? 'Falha ao listar impressoras.'),
    };
  } finally {
    if (!probe.isDestroyed()) probe.destroy();
  }
});

ipcMain.handle('print:openDrawer', async (_event, payload) => {
  try {
    const { openCashDrawer } = await import('./rawPrinter.js');
    return await openCashDrawer({
      printer: payload?.printer,
      command: payload?.command,
      tryBothPins: payload?.tryBothPins !== false,
    });
  } catch (error) {
    return {
      success: false,
      error: String(error?.message ?? error ?? 'Falha ao abrir gaveta.'),
    };
  }
});

ipcMain.handle('print:raw', async (_event, payload) => {
  try {
    const { parseEscPosHexCommand, sendRawToWindowsPrinter } = await import('./rawPrinter.js');
    const bytes = payload?.bytesBase64
      ? Buffer.from(String(payload.bytesBase64), 'base64')
      : parseEscPosHexCommand(payload?.command);
    if (!bytes?.length) {
      return { success: false, error: 'Comando RAW inválido.' };
    }
    return await sendRawToWindowsPrinter(payload?.printer, bytes);
  } catch (error) {
    return {
      success: false,
      error: String(error?.message ?? error ?? 'Falha no envio RAW.'),
    };
  }
});

ipcMain.handle('print:network', async (_event, payload) => {
  const host = String(payload?.host ?? '').trim();
  const port = Math.max(1, Math.min(65535, Number(payload?.port ?? 9100) || 9100));
  const bytesBase64 = String(payload?.bytesBase64 ?? '');
  if (!host) {
    return { success: false, error: 'IP da impressora em falta.' };
  }
  if (!bytesBase64) {
    return { success: false, error: 'Conteúdo de impressão vazio.' };
  }

  let bytes;
  try {
    bytes = Buffer.from(bytesBase64, 'base64');
  } catch {
    return { success: false, error: 'Payload base64 inválido.' };
  }
  if (!bytes.length) {
    return { success: false, error: 'Conteúdo de impressão vazio.' };
  }

  const net = await import('net');
  return await new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      try {
        socket.destroy();
      } catch {
        /* ignore */
      }
      resolve(result);
    };

    socket.setTimeout(8000);
    socket.once('timeout', () => finish({ success: false, error: `Timeout a ligar a ${host}:${port}` }));
    socket.once('error', (error) =>
      finish({ success: false, error: String(error?.message ?? error ?? 'Erro de rede') }),
    );
    socket.connect(port, host, () => {
      socket.write(bytes, (writeErr) => {
        if (writeErr) {
          finish({ success: false, error: String(writeErr.message || writeErr) });
          return;
        }
        socket.end(() => finish({ success: true, host, port }));
      });
    });
  });
});

/** Janela oculta reutilizada — criar BrowserWindow a cada recibo atrasava a impressão. */
let receiptPrintWindow = null;
/** Serializa uso da janela de impressão. */
let receiptPrintMutex = Promise.resolve();
let cachedReceiptPrinterName = '';
/** Recibo já carregado na janela (pré-montado no ecrã de pagamento). */
let receiptHtmlPrepared = false;
let receiptPreparedOpts = {
  copies: 1,
  widthMm: 72,
  heightMm: 200,
  printer: '',
};

function getOrCreateReceiptPrintWindow(widthMm, heightMm) {
  const width = Math.max(120, Math.round(widthMm * 3.78));
  const height = Math.max(200, Math.round(heightMm * 3.78));
  if (receiptPrintWindow && !receiptPrintWindow.isDestroyed()) {
    try {
      receiptPrintWindow.setSize(width, height);
    } catch {
      /* ignore */
    }
    return receiptPrintWindow;
  }
  receiptPrintWindow = new BrowserWindow({
    show: false,
    width,
    height,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      backgroundThrottling: false,
    },
  });
  try {
    receiptPrintWindow.webContents.setBackgroundThrottling(false);
  } catch {
    /* ignore */
  }
  receiptPrintWindow.on('closed', () => {
    receiptPrintWindow = null;
    receiptHtmlPrepared = false;
  });
  return receiptPrintWindow;
}

function destroyReceiptPrintWindow() {
  if (receiptPrintWindow && !receiptPrintWindow.isDestroyed()) {
    try {
      receiptPrintWindow.destroy();
    } catch {
      /* ignore */
    }
  }
  receiptPrintWindow = null;
  receiptHtmlPrepared = false;
}

function receiptPrintTempPath() {
  return path.join(app.getPath('userData'), 'posly-receipt-print.html');
}

function resolvePrintGeometry(payload) {
  const copies = Math.max(1, Math.min(5, Number(payload?.copies) || 1));
  const rollMm = Number(payload?.widthMm) === 58 ? 58 : 80;
  const widthMm = rollMm === 58 ? 58 : 72;
  const heightMm = Math.max(80, Math.min(2000, Number(payload?.heightMm) || 200));
  return { copies, widthMm, heightMm };
}

async function resolvePrintDeviceName(printWindow, preferredName) {
  const printers = await printWindow.webContents.getPrintersAsync();
  if (!Array.isArray(printers) || printers.length === 0) return null;

  const preferred = String(preferredName || cachedReceiptPrinterName || '').trim();
  if (preferred) {
    const preferredLower = preferred.toLowerCase();
    const match =
      printers.find((p) => String(p.name ?? '') === preferred) ||
      printers.find((p) => String(p.displayName ?? '') === preferred) ||
      printers.find((p) => String(p.name ?? '').toLowerCase() === preferredLower) ||
      printers.find((p) => String(p.displayName ?? '').toLowerCase() === preferredLower) ||
      printers.find((p) => String(p.name ?? '').toLowerCase().includes(preferredLower)) ||
      printers.find((p) => String(p.displayName ?? '').toLowerCase().includes(preferredLower));
    if (match?.name) {
      cachedReceiptPrinterName = String(match.name);
      return cachedReceiptPrinterName;
    }
  }

  // Sem preferência ou impressora removida do Windows → usar a padrão do SO.
  const selected = printers.find((printer) => printer.isDefault) ?? printers[0] ?? null;
  if (!selected?.name) return null;
  cachedReceiptPrinterName = String(selected.name);
  return cachedReceiptPrinterName;
}

function acquireReceiptPrintMutex() {
  let releaseMutex = () => {};
  const previous = receiptPrintMutex;
  receiptPrintMutex = new Promise((resolve) => {
    releaseMutex = resolve;
  });
  return { previous, releaseMutex };
}

async function loadReceiptHtml(printWindow, html) {
  const tmpPath = receiptPrintTempPath();
  try {
    fsSync.writeFileSync(tmpPath, html, { encoding: 'utf8', mode: 0o600 });
    await printWindow.loadFile(tmpPath);
    await printWindow.webContents
      .executeJavaScript('document.body ? document.body.offsetHeight : 0', true)
      .catch(() => null);
  } finally {
    try {
      fsSync.unlinkSync(tmpPath);
    } catch {
      /* ignore */
    }
  }
}

function buildSilentPrintOptions({ deviceName, copies, widthMm, heightMm, useNativePageSize }) {
  const options = {
    silent: true,
    printBackground: false,
    deviceName,
    copies,
    margins: { marginType: 'none' },
    scaleFactor: 100,
  };
  // pageSize custom (térmico) pode falhar em drivers Windows genéricos —
  // nesse caso usamos o tamanho nativo da impressora do SO.
  if (!useNativePageSize) {
    options.pageSize = {
      width: widthMm * 1000,
      height: heightMm * 1000,
    };
  }
  return options;
}

function startSilentPrint(printWindow, opts, onDone) {
  const tryPrint = (useNativePageSize) => {
    printWindow.webContents.print(
      buildSilentPrintOptions({ ...opts, useNativePageSize }),
      (success, failureReason) => {
        if (!success && !useNativePageSize) {
          console.warn(
            '[print:receipt] pageSize térmico rejeitado; a repetir com tamanho nativo do Windows:',
            failureReason || 'unknown',
          );
          tryPrint(true);
          return;
        }
        if (!success) {
          console.error(
            '[print:receipt]',
            failureReason || 'Falha na impressão silenciosa.',
          );
        }
        if (typeof onDone === 'function') onDone(success);
      },
    );
  };
  tryPrint(Boolean(opts.useNativePageSize));
}

async function runReceiptPrintJob(payload) {
  const html = String(payload?.html ?? '');
  if (!html.trim()) {
    return { success: false, error: 'Conteúdo de impressão vazio.' };
  }

  const preferredName = String(payload?.printer ?? '').trim();
  const { copies, widthMm, heightMm } = resolvePrintGeometry(payload);
  const { previous, releaseMutex } = acquireReceiptPrintMutex();
  await previous;

  try {
    receiptHtmlPrepared = false;
    const printWindow = getOrCreateReceiptPrintWindow(widthMm, heightMm);
    await loadReceiptHtml(printWindow, html);

    const deviceName = await resolvePrintDeviceName(printWindow, preferredName);
    if (!deviceName) {
      releaseMutex();
      return {
        success: false,
        error: 'Nenhuma impressora disponível no Windows. Instale uma impressora ou defina a padrão do sistema.',
      };
    }

    await new Promise((resolve) => {
      startSilentPrint(
        printWindow,
        { deviceName, copies, widthMm, heightMm },
        () => resolve(undefined),
      );
    });

    releaseMutex();
    return { success: true, printer: deviceName };
  } catch (error) {
    destroyReceiptPrintWindow();
    releaseMutex();
    return {
      success: false,
      error: String(error?.message ?? error ?? 'Falha desconhecida de impressão.'),
    };
  }
}

/** Pré-carrega o HTML do recibo (ecrã de pagamento) — Finalizar só imprime. */
ipcMain.handle('print:prepareReceipt', async (_event, payload) => {
  const html = String(payload?.html ?? '');
  if (!html.trim()) {
    return { success: false, error: 'Conteúdo de impressão vazio.' };
  }

  const preferredName = String(payload?.printer ?? '').trim();
  const { copies, widthMm, heightMm } = resolvePrintGeometry(payload);
  const { previous, releaseMutex } = acquireReceiptPrintMutex();
  await previous;

  try {
    const printWindow = getOrCreateReceiptPrintWindow(widthMm, heightMm);
    await loadReceiptHtml(printWindow, html);
    const deviceName = await resolvePrintDeviceName(printWindow, preferredName);
    if (!deviceName) {
      receiptHtmlPrepared = false;
      releaseMutex();
      return {
        success: false,
        error: 'Nenhuma impressora disponível no Windows. Instale uma impressora ou defina a padrão do sistema.',
      };
    }

    receiptPreparedOpts = { copies, widthMm, heightMm, printer: deviceName };
    receiptHtmlPrepared = true;
    releaseMutex();
    return { success: true, printer: deviceName, prepared: true };
  } catch (error) {
    receiptHtmlPrepared = false;
    destroyReceiptPrintWindow();
    releaseMutex();
    return {
      success: false,
      error: String(error?.message ?? error ?? 'Falha ao preparar recibo.'),
    };
  }
});

/** Imprime o recibo já pré-carregado (opcionalmente atualiza o nº do documento). */
ipcMain.handle('print:commitReceipt', async (_event, payload) => {
  const preferredName = String(
    payload?.printer || receiptPreparedOpts.printer || cachedReceiptPrinterName || '',
  ).trim();
  const copies = Math.max(
    1,
    Math.min(5, Number(payload?.copies) || receiptPreparedOpts.copies || 1),
  );
  const widthMm = Number(payload?.widthMm) || receiptPreparedOpts.widthMm || 72;
  const heightMm = Number(payload?.heightMm) || receiptPreparedOpts.heightMm || 200;
  const docLine = payload?.patch?.docLine != null ? String(payload.patch.docLine) : '';

  // Esperar prepare em curso — NÃO devolver needFullPrint antes do mutex
  // (senão Finalizar durante o prepare força reload completo).
  const { previous, releaseMutex } = acquireReceiptPrintMutex();
  await previous;

  try {
    if (
      !receiptHtmlPrepared ||
      !receiptPrintWindow ||
      receiptPrintWindow.isDestroyed()
    ) {
      releaseMutex();
      return { success: false, error: 'not_prepared', needFullPrint: true };
    }

    const printWindow = receiptPrintWindow;

    // Resolver sempre contra a lista real do Windows (impressora pode ter sido removida).
    const deviceName = await resolvePrintDeviceName(
      printWindow,
      preferredName || receiptPreparedOpts.printer,
    );
    if (!deviceName) {
      receiptHtmlPrepared = false;
      releaseMutex();
      return {
        success: false,
        error: 'Nenhuma impressora disponível no Windows. Instale ou defina a impressora padrão.',
        needFullPrint: true,
      };
    }

    if (docLine) {
      await printWindow.webContents
        .executeJavaScript(
          `(() => {
            const el = document.querySelector('[data-receipt-doc]');
            if (!el) return false;
            if (el.textContent === ${JSON.stringify(docLine)}) return true;
            el.textContent = ${JSON.stringify(docLine)};
            return true;
          })()`,
          true,
        )
        .catch(() => null);
    }

    receiptHtmlPrepared = false;
    startSilentPrint(printWindow, { deviceName, copies, widthMm, heightMm }, () => {});
    releaseMutex();

    return { success: true, printer: deviceName };
  } catch (error) {
    receiptHtmlPrepared = false;
    releaseMutex();
    return {
      success: false,
      error: String(error?.message ?? error ?? 'Falha ao imprimir recibo preparado.'),
      needFullPrint: true,
    };
  }
});

ipcMain.handle('print:receipt', async (_event, payload) => {
  const html = String(payload?.html ?? '');
  if (!html.trim()) {
    return { success: false, error: 'Conteúdo de impressão vazio.' };
  }

  const preferredName = String(payload?.printer ?? '').trim();
  // Responder já — a notificação do UI não deve esperar load/spooler.
  void runReceiptPrintJob(payload).then((result) => {
    if (result && result.success === false) {
      console.error('[print:receipt]', result.error || 'Falha na impressão.');
    }
  });

  return {
    success: true,
    printer: preferredName || cachedReceiptPrinterName || undefined,
  };
});

const isBenignUpdateCheckFailure = (error) => {
  const msg = String(error?.message ?? error ?? '');
  return (
    /\b404\b/.test(msg) ||
    msg.includes('Not Found') ||
    msg.includes('net::ERR_') ||
    msg.includes('ENOTFOUND')
  );
};

/**
 * Canal GitHub (electron-updater): `POS_UPDATE_CHANNEL=beta` ou `test` → pré-releases;
 * omitido ou `stable` → apenas releases finais. Definir no arranque (ex.: atalho / variável de sistema no Windows).
 */
const resolveAutoUpdaterChannel = () => {
  const original = String(process.env.POS_UPDATE_CHANNEL ?? '').trim();
  const raw = original.toLowerCase();
  if (raw === 'beta' || raw === 'test') {
    return { allowPrerelease: true, label: 'beta' };
  }
  if (!raw || raw === 'stable') {
    return { allowPrerelease: false, label: 'stable' };
  }
  console.warn(
    `[autoUpdater] POS_UPDATE_CHANNEL desconhecido (${JSON.stringify(original)}); a usar stable.`
  );
  return { allowPrerelease: false, label: 'stable' };
};

/** Estado partilhado com o renderer (UI embutida). */
let updateUiState = {
  status: 'idle', // idle | available | downloading | downloaded | error
  version: null,
  percent: 0,
  transferred: 0,
  total: 0,
  error: null,
  dismissed: false,
};

const broadcastUpdateStatus = (patch = {}) => {
  updateUiState = { ...updateUiState, ...patch };
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue;
    try {
      win.webContents.send('update:status', updateUiState);
    } catch {
      /* ignore */
    }
  }
};

const safeCheckForUpdates = () => {
  void autoUpdater.checkForUpdates().catch((error) => {
    if (isBenignUpdateCheckFailure(error)) {
      console.warn(
        '[autoUpdater] Verificação ignorada (feed indisponível ou sem releases).',
        String(error?.message ?? error ?? '')
      );
      return;
    }
    console.warn('[autoUpdater]', error);
    broadcastUpdateStatus({
      status: 'error',
      error: String(error?.message ?? error ?? 'Erro ao verificar atualização'),
    });
  });
};

let autoUpdatesReady = false;

const registerUpdateIpcHandlers = () => {
  for (const channel of ['update:getStatus', 'update:dismiss', 'update:download', 'update:install']) {
    try {
      ipcMain.removeHandler(channel);
    } catch {
      /* not registered yet */
    }
  }

  ipcMain.handle('update:getStatus', async () => updateUiState);

  ipcMain.handle('update:dismiss', async () => {
    broadcastUpdateStatus({ dismissed: true, status: 'idle', error: null });
    return { ok: true };
  });

  ipcMain.handle('update:download', async () => {
    if (!autoUpdatesReady) {
      return { ok: false, error: 'Atualizações automáticas indisponíveis neste modo.' };
    }
    try {
      broadcastUpdateStatus({
        status: 'downloading',
        percent: Math.max(1, Number(updateUiState.percent) || 1),
        error: null,
        dismissed: false,
      });
      await autoUpdater.downloadUpdate();
      return { ok: true };
    } catch (error) {
      const message = String(error?.message ?? error ?? 'Falha ao baixar atualização');
      console.warn('[autoUpdater] download failed', message);
      broadcastUpdateStatus({ status: 'error', error: message });
      return { ok: false, error: message };
    }
  });

  ipcMain.handle('update:install', async () => {
    if (!autoUpdatesReady) {
      return { ok: false, error: 'Atualizações automáticas indisponíveis neste modo.' };
    }
    try {
      // isSilent=false, isForceRunAfter=true — reinicia de imediato no Windows.
      setImmediate(() => {
        try {
          autoUpdater.quitAndInstall(false, true);
        } catch (error) {
          console.warn('[autoUpdater] quitAndInstall', error);
        }
      });
      return { ok: true };
    } catch (error) {
      const message = String(error?.message ?? error ?? 'Falha ao instalar atualização');
      broadcastUpdateStatus({ status: 'error', error: message });
      return { ok: false, error: message };
    }
  });
};

const setupAutoUpdates = () => {
  // Sempre expor os canais IPC — em dev/unpackaged o renderer ainda pergunta o estado.
  registerUpdateIpcHandlers();

  if (!isPackagedBuild()) return;
  if (process.platform !== 'win32') return;
  if (process.env.PORTABLE_EXECUTABLE_FILE) return;
  if (String(process.env.POS_DISABLE_AUTO_UPDATE ?? '').trim() === '1') return;

  autoUpdatesReady = true;

  const channel = resolveAutoUpdaterChannel();
  autoUpdater.allowPrerelease = channel.allowPrerelease;
  console.log(
    `[autoUpdater] Canal: ${channel.label} (allowPrerelease=${String(channel.allowPrerelease)})`
  );

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('update-available', (info) => {
    const version = String(info?.version ?? '').trim() || null;
    console.log('[autoUpdater] update-available', version);
    if (updateUiState.dismissed && updateUiState.version === version) {
      return;
    }
    broadcastUpdateStatus({
      status: 'available',
      version,
      percent: 0,
      transferred: 0,
      total: 0,
      error: null,
      dismissed: false,
    });
  });

  autoUpdater.on('download-progress', (progress) => {
    const percent = Math.max(0, Math.min(100, Number(progress?.percent) || 0));
    broadcastUpdateStatus({
      status: 'downloading',
      percent,
      transferred: Number(progress?.transferred) || 0,
      total: Number(progress?.total) || 0,
      error: null,
    });
  });

  autoUpdater.on('update-downloaded', (info) => {
    const version = String(info?.version ?? updateUiState.version ?? '').trim() || null;
    console.log('[autoUpdater] update-downloaded', version);
    broadcastUpdateStatus({
      status: 'downloaded',
      version,
      percent: 100,
      error: null,
      dismissed: false,
    });
  });

  autoUpdater.on('error', (error) => {
    const message = String(error?.message ?? error ?? 'Erro desconhecido');
    if (isBenignUpdateCheckFailure(error) && updateUiState.status === 'idle') {
      console.warn('[autoUpdater]', message);
      return;
    }
    console.warn('[autoUpdater] error', message);
    broadcastUpdateStatus({
      status: 'error',
      error: message,
    });
  });

  safeCheckForUpdates();
  setInterval(() => {
    safeCheckForUpdates();
  }, 15 * 60 * 1000);
};

// Windows: tem de ser ANTES do ready — caso contrário a taskbar fica com o
// ícone Atom em cache associado ao AppUserModelId antigo.
// userData canónico também ANTES do ready (senão AppData pode divergir após updates).
configureCanonicalUserDataPath();
if (typeof app.setName === 'function') {
  app.setName('POSly');
}
if (process.platform === 'win32' && typeof app.setAppUserModelId === 'function') {
  app.setAppUserModelId('com.nicol.posly');
}

// Reabrir o atalho durante o arranque deve focar a instância a carregar, não abrir outra.
const hasSingleInstanceLock =
  typeof app.requestSingleInstanceLock === 'function' ? app.requestSingleInstanceLock() : true;

if (!hasSingleInstanceLock) {
  app.quit();
}

app.on('second-instance', () => {
  const target = mainWindow && !mainWindow.isDestroyed() ? mainWindow : splashWindow;
  if (!target || target.isDestroyed()) return;
  if (target.isMinimized()) target.restore();
  target.show();
  target.focus();
});

app.whenReady().then(async () => {
  if (!hasSingleInstanceLock) return;
  electronLogInfo('electron.app_ready', 'Electron pronto — a iniciar serviços', {
    module: 'main',
    action: 'whenReady',
    reason: 'Arranque normal da aplicação desktop',
    packaged: isPackagedBuild(),
    mode: resolvePosAppMode(),
  });
  createSplashWindow();
  setSplashStatus('A iniciar…');
  try {
    setSplashStatus('A preparar dados locais…');
    const migration = await migrateLegacyUserDataIfNeeded();
    if (migration?.migrated) {
      setSplashStatus('A recuperar dados anteriores…');
      electronLogInfo('electron.userdata_migrated', 'Dados/licença recuperados de pasta anterior', {
        module: 'main',
        from: migration.from,
        to: migration.to,
      });
    } else {
      electronLogInfo('electron.userdata_path', 'Pasta de dados da instalação', {
        module: 'main',
        userDataPath: app.getPath('userData'),
        reason: migration?.reason ?? 'ok',
      });
    }
    // Ponte Device Auth (Etapa 1F.2, itens 26-31): servidor loopback local,
    // sem custo de rede real (bind local), por isso pode ser aguardado aqui
    // sem violar "nunca bloquear o arranque" — é só preparação local, não uma
    // chamada à cloud. O processo da API (syncService.js) recebe a URL+segredo
    // via env do spawn (startBackend), nunca o refresh token.
    try {
      deviceAuthBridgeInfo = await startDeviceAuthBridge({
        userDataPath: app.getPath('userData'),
        issuerBaseUrl: String(process.env.POS_LICENSE_ISSUER_BASE_URL ?? '').trim(),
      });
    } catch (bridgeError) {
      electronLogWarn('electron.device_auth_bridge_failed', 'Falha a iniciar a ponte de device auth — sync cloud ficará indisponível', {
        module: 'main',
        reason: String(bridgeError?.message ?? bridgeError),
      });
      deviceAuthBridgeInfo = null;
    }

    // Device-auth cloud (Etapa 1F.1): nunca aguardado, nunca pode atrasar nem
    // falhar o arranque — só actualiza o access token em memória se conseguir.
    // Falha/ausência de rede aqui nunca bloqueia login local, venda, pagamento,
    // impressão, stock local ou a fila de sync (essa continua OFFLINE_ONLY/
    // WAITING_FOR_AUTH até haver um access token válido).
    void initDeviceAuthNonBlocking({
      userDataPath: app.getPath('userData'),
      issuerBaseUrl: String(process.env.POS_LICENSE_ISSUER_BASE_URL ?? '').trim(),
    }).catch(() => {});

    // API + frontend standalone em paralelo (antes era sequencial e somava os tempos).
    setSplashStatus('A iniciar serviços…');
    await Promise.all([startBackend(), startStandaloneWeb()]);
    electronLogInfo('electron.services_started', 'API e frontend prontos (ou web ignorado em dev)', {
      module: 'main',
      action: 'startServices',
      packaged: isPackagedBuild(),
    });
  } catch (error) {
    electronLogError('electron.boot_failed', 'Falha ao iniciar serviços do Electron', {
      module: 'main',
      action: 'whenReady',
      reason: 'Erro ao subir API/web antes da janela',
      error: String(error?.message ?? error),
    });
    closeSplashWindow();
    const errorMessage = String(error?.message ?? error ?? 'Erro desconhecido');
    const dialogTitle = errorMessage.includes('base de dados existente não pôde ser aberta')
      ? 'Base de dados corrompida'
      : 'Falha ao iniciar';
    dialog.showErrorBox(dialogTitle, errorMessage);
    stopServices();
    app.quit();
    return;
  }

  try {
    setSplashStatus('A abrir a aplicação…');
    await createWindow();
    electronLogInfo('electron.window_created', 'Janela principal criada', {
      module: 'main',
      action: 'createWindow',
    });
  } finally {
    closeSplashWindow();
  }
  setupAutoUpdates();
});

app.on('window-all-closed', () => {
  stopServices();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  stopServices();
});