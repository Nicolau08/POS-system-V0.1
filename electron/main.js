import { app, BrowserWindow, Menu, ipcMain, dialog } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs/promises';
import { spawn } from 'child_process';
import crypto from 'crypto';
import electronUpdaterModule from 'electron-updater';
import machineIdModule from 'node-machine-id';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_WEB_PORT = 3000;
const APP_API_PORT = 3001;
const { machineIdSync } = machineIdModule;
const { autoUpdater } = electronUpdaterModule;

let backendProcess = null;
let webProcess = null;
let mainWindow = null;
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
  return {
    userDataPath,
    databasePath: path.join(userDataPath, 'data', 'pos.db'),
    configPath: path.join(userDataPath, 'config.json'),
    licensePath: path.join(userDataPath, 'license.json'),
  };
};

const appendBoundedLog = (current, chunk) => {
  const next = `${current}${String(chunk ?? '')}`;
  return next.length > 6000 ? next.slice(-6000) : next;
};

const waitForHttp = async (url, timeoutMs = 45000) => {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok || response.status < 500) return;
    } catch {
      // keep polling until timeout
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Timeout aguardando ${url}`);
};

const resolveLicenseHmacSecret = () =>
  String(process.env.POS_LICENSE_HMAC_SECRET || process.env.LICENSE_HMAC_SECRET || '').trim();

const allowUnsignedLicenseFallback = () => {
  const raw = String(process.env.POS_LICENSE_ALLOW_UNSIGNED || '').trim().toLowerCase();
  return ['1', 'true', 'yes', 'y'].includes(raw);
};

const buildCanonicalLicensePayload = (payload) => ({
  tenant_id: String(payload?.tenant_id ?? '').trim(),
  machine_id: String(payload?.machine_id ?? '').trim(),
  expiration: String(payload?.expiration ?? payload?.expires_at ?? '').trim(),
});

const signCanonicalLicensePayload = (canonicalPayload, secret) =>
  crypto
    .createHmac('sha256', secret)
    .update(JSON.stringify(canonicalPayload))
    .digest('hex');

const timingSafeEqualHex = (a, b) => {
  const left = Buffer.from(String(a ?? ''), 'utf8');
  const right = Buffer.from(String(b ?? ''), 'utf8');
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
};

const verifyLicenseSignature = (payload) => {
  const signature = String(payload?.signature ?? '').trim();
  const secret = resolveLicenseHmacSecret();
  const allowUnsigned = allowUnsignedLicenseFallback();

  if (!signature) {
    if (allowUnsigned) return { ok: true, mode: 'unsigned-fallback' };
    return { ok: false, reason: 'Licença sem assinatura (signature).' };
  }
  if (!secret) {
    return { ok: false, reason: 'POS_LICENSE_HMAC_SECRET não configurado para validar assinatura.' };
  }

  const canonicalPayload = buildCanonicalLicensePayload(payload);
  const expectedSignature = signCanonicalLicensePayload(canonicalPayload, secret);
  if (!timingSafeEqualHex(signature, expectedSignature)) {
    return { ok: false, reason: 'Assinatura da licença inválida (tampering detectado).' };
  }

  return { ok: true, mode: 'signed' };
};

const parseLicenseInput = (rawInput) => {
  const raw = String(rawInput ?? '').trim();
  if (!raw) return { payload: null, error: 'Chave de licença vazia.' };

  const normalizedInput = raw.startsWith('LICENSE_KEY=')
    ? raw.slice('LICENSE_KEY='.length).trim()
    : raw;

  try {
    const parsed = JSON.parse(normalizedInput);
    if (parsed && typeof parsed === 'object') {
      return { payload: parsed, error: null };
    }
  } catch {
    // try base64(JSON)
  }

  try {
    const base64Normalized = normalizedInput.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64Normalized.padEnd(Math.ceil(base64Normalized.length / 4) * 4, '=');
    const decoded = Buffer.from(padded, 'base64').toString('utf8');
    const parsed = JSON.parse(decoded);
    if (parsed && typeof parsed === 'object') {
      return { payload: parsed, error: null };
    }
  } catch {
    // ignore and fallback error
  }

  return {
    payload: null,
    error: 'Formato de licença inválido. Use JSON ou base64(JSON).',
  };
};

const buildActivationCode = (machineId) => {
  const payload = {
    machine_id: String(machineId ?? '').trim(),
  };
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
};

const validateLicensePayload = ({ payload, expectedTenantId = null }) => {
  if (!payload || typeof payload !== 'object') {
    return { ok: false, reason: 'Licença inválida ou corrompida.' };
  }

  const signatureCheck = verifyLicenseSignature(payload);
  if (!signatureCheck.ok) {
    return { ok: false, reason: signatureCheck.reason || 'Assinatura inválida.' };
  }

  const canonicalPayload = buildCanonicalLicensePayload(payload);
  const tenantId = canonicalPayload.tenant_id;
  const machineId = canonicalPayload.machine_id;
  const expiration = canonicalPayload.expiration;

  if (!tenantId) return { ok: false, reason: 'Licença sem tenant_id.' };
  if (!machineId) return { ok: false, reason: 'Licença sem machine_id.' };
  if (!expiration) return { ok: false, reason: 'Licença sem data de expiração.' };

  if (expectedTenantId && tenantId !== String(expectedTenantId).trim()) {
    return { ok: false, reason: 'Licença não pertence ao tenant desta instalação.' };
  }

  const localMachineId = machineIdSync({ original: true });
  if (machineId !== localMachineId) {
    return { ok: false, reason: 'Licença vinculada a outra máquina.' };
  }

  const expiresAt = new Date(expiration);
  if (Number.isNaN(expiresAt.getTime())) {
    return { ok: false, reason: 'Data de expiração inválida na licença.' };
  }
  if (Date.now() > expiresAt.getTime()) {
    return {
      ok: false,
      reason: `Licença expirada em ${expiresAt.toLocaleString()}.`,
    };
  }

  return {
    ok: true,
    tenantId,
    machineId,
    expiration: expiresAt.toISOString(),
  };
};

const resolveExpectedTenantId = async () => {
  const status = await fetchSetupStatus();
  return status?.tenantId ? String(status.tenantId) : null;
};

const getActivationStateInternal = async () => {
  const machineId = machineIdSync({ original: true });
  const activationCode = buildActivationCode(machineId);
  const { licensePath } = getRuntimePaths();
  const expectedTenantId = await resolveExpectedTenantId();

  if (!(await fileExists(licensePath))) {
    return {
      success: true,
      isActivated: false,
      machineId,
      activationCode,
      licensePath,
      reason: 'Licença não encontrada nesta instalação.',
    };
  }

  try {
    const raw = await fs.readFile(licensePath, 'utf8');
    const parsed = JSON.parse(raw);
    const validation = validateLicensePayload({ payload: parsed, expectedTenantId });
    if (!validation.ok) {
      return {
        success: true,
        isActivated: false,
        machineId,
        activationCode,
        licensePath,
        reason: validation.reason || 'Licença inválida.',
      };
    }
    return {
      success: true,
      isActivated: true,
      machineId,
      activationCode,
      licensePath,
    };
  } catch {
    return {
      success: true,
      isActivated: false,
      machineId,
      activationCode,
      licensePath,
      reason: 'Falha ao ler licença local.',
    };
  }
};

const activateLicenseInternal = async (rawLicenseKey) => {
  const machineId = machineIdSync({ original: true });
  const activationCode = buildActivationCode(machineId);
  const { licensePath } = getRuntimePaths();
  const expectedTenantId = await resolveExpectedTenantId();
  const parsedInput = parseLicenseInput(rawLicenseKey);
  if (!parsedInput.payload) {
    return {
      success: false,
      machineId,
      activationCode,
      licensePath,
      error: parsedInput.error || 'Chave de licença inválida.',
    };
  }

  const validation = validateLicensePayload({
    payload: parsedInput.payload,
    expectedTenantId,
  });
  if (!validation.ok) {
    return {
      success: false,
      machineId,
      activationCode,
      licensePath,
      error: validation.reason || 'Licença inválida.',
    };
  }

  await ensureDir(path.dirname(licensePath));
  await fs.writeFile(
    licensePath,
    JSON.stringify(
      {
        ...parsedInput.payload,
        activated_at: new Date().toISOString(),
      },
      null,
      2
    ),
    'utf8'
  );

  return {
    success: true,
    machineId,
    activationCode,
    licensePath,
  };
};

const readAndValidateLicenseFromFile = async (expectedTenantId) => {
  const { licensePath } = getRuntimePaths();
  if (!(await fileExists(licensePath))) {
    return { ok: false, reason: 'Ficheiro local de licença não encontrado.' };
  }

  try {
    const raw = await fs.readFile(licensePath, 'utf8');
    const parsed = JSON.parse(raw);
    return validateLicensePayload({ payload: parsed, expectedTenantId });
  } catch {
    return { ok: false, reason: 'Ficheiro local de licença está inválido.' };
  }
};

const resolveBackendEntry = async () => {
  if (app.isPackaged) {
    const candidates = [
      path.join(process.resourcesPath, 'api', 'server.js'),
      path.join(process.resourcesPath, 'app.asar', 'api', 'server.js'),
    ];
    for (const candidate of candidates) {
      if (await fileExists(candidate)) return candidate;
    }
    throw new Error('Backend não encontrado nos resources (api/server.js).');
  }

  return path.join(__dirname, '..', 'api', 'server.js');
};

const resolveWebEntry = async () => {
  if (!app.isPackaged) return null;
  const webEntry = path.join(process.resourcesPath, 'web', 'server.js');
  if (!(await fileExists(webEntry))) {
    throw new Error('Frontend standalone não encontrado em resources/web/server.js.');
  }
  return webEntry;
};

const spawnNodeService = ({ entryPath, env, cwd, onLog, onExitLogPrefix }) => {
  const child = spawn(process.execPath, [entryPath], {
    cwd: cwd || path.dirname(entryPath),
    env: {
      ...process.env,
      ...env,
      ELECTRON_RUN_AS_NODE: '1',
      NODE_ENV: app.isPackaged ? 'production' : process.env.NODE_ENV || 'development',
    },
    stdio: 'pipe',
  });

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

const startBackend = async () => {
  const paths = getRuntimePaths();
  await ensureDir(path.dirname(paths.databasePath));

  const dbExistedBeforeBoot = await fileExists(paths.databasePath);
  const backendEntry = await resolveBackendEntry();

  backendStartupLogs = '';
  backendProcess = spawnNodeService({
    entryPath: backendEntry,
    env: {
      POS_API_PORT: String(APP_API_PORT),
      POS_DB_PATH: paths.databasePath,
      POS_USER_DATA_PATH: paths.userDataPath,
      POS_CONFIG_PATH: paths.configPath,
      POS_LICENSE_PATH: paths.licensePath,
      POS_DB_EXISTED_BEFORE_BOOT: dbExistedBeforeBoot ? 'true' : 'false',
    },
    onLog: (chunk) => {
      backendStartupLogs = appendBoundedLog(backendStartupLogs, chunk);
    },
    onExitLogPrefix: 'api',
  });

  try {
    await waitForHttp(`http://127.0.0.1:${APP_API_PORT}`);
  } catch (error) {
    const details = backendStartupLogs.trim();
    const suffix = details ? `\n\n${details}` : '';
    throw new Error(`Falha ao iniciar backend.${suffix || ` ${String(error?.message ?? error)}`}`);
  }
};

const startStandaloneWeb = async () => {
  if (!app.isPackaged) return;

  const webEntry = await resolveWebEntry();
  webStartupLogs = '';
  webProcess = spawnNodeService({
    entryPath: webEntry,
    env: {
      PORT: String(APP_WEB_PORT),
      POS_API_URL: `http://127.0.0.1:${APP_API_PORT}`,
      NEXT_PUBLIC_POS_API_URL: `http://127.0.0.1:${APP_API_PORT}`,
      NEXT_PUBLIC_POS_API_DIRECT_URL: `http://127.0.0.1:${APP_API_PORT}`,
    },
    onLog: (chunk) => {
      webStartupLogs = appendBoundedLog(webStartupLogs, chunk);
    },
    onExitLogPrefix: 'web',
  });

  try {
    await waitForHttp(`http://127.0.0.1:${APP_WEB_PORT}`);
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
};

const fetchSetupStatus = async () => {
  try {
    const response = await fetch(`http://127.0.0.1:${APP_API_PORT}/setup/status`);
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

const createWindow = async (opts = {}) => {
  const { blockedReason = null } = opts;
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    icon: path.join(__dirname, '../assets/icon.ico'),
    webPreferences: {
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  Menu.setApplicationMenu(null);
  win.setMenuBarVisibility(false);
  mainWindow = win;

  if (blockedReason) {
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(buildLicenseBlockedHtml(blockedReason))}`);
    return;
  }

  if (!app.isPackaged) {
    await win.loadURL('http://localhost:3000');
    return;
  }
  await win.loadURL(`http://127.0.0.1:${APP_WEB_PORT}`);
};

ipcMain.handle('dialog:selectFolder', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory', 'createDirectory'],
    title: 'Selecionar pasta de backup',
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
    configPath: paths.configPath,
    licensePath: paths.licensePath,
    databaseExists: await fileExists(paths.databasePath),
    configExists: await fileExists(paths.configPath),
    licenseExists: await fileExists(paths.licensePath),
  };
});

ipcMain.handle('system:getMachineId', async () => {
  try {
    return {
      success: true,
      machineId: machineIdSync({ original: true }),
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

ipcMain.handle('print:receipt', async (_event, payload) => {
  const html = String(payload?.html ?? '');
  if (!html.trim()) {
    return { success: false, error: 'Conteúdo de impressão vazio.' };
  }

  const printWindow = new BrowserWindow({
    show: false,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
    },
  });

  try {
    await printWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    const printers = await printWindow.webContents.getPrintersAsync();
    const defaultPrinter = printers.find((printer) => printer.isDefault) ?? null;
    if (!defaultPrinter) {
      return { success: false, error: 'Nenhuma impressora padrão definida no Windows.' };
    }

    const printResult = await new Promise((resolve) => {
      printWindow.webContents.print(
        {
          silent: true,
          printBackground: true,
          deviceName: defaultPrinter.name,
        },
        (success, failureReason) => {
          resolve({
            success,
            failureReason: failureReason ? String(failureReason) : null,
          });
        }
      );
    });

    if (!printResult.success) {
      return {
        success: false,
        error: printResult.failureReason || 'Falha na impressão silenciosa.',
      };
    }
    return { success: true, printer: defaultPrinter.name };
  } catch (error) {
    return {
      success: false,
      error: String(error?.message ?? error ?? 'Falha desconhecida de impressão.'),
    };
  } finally {
    if (!printWindow.isDestroyed()) {
      printWindow.destroy();
    }
  }
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
  });
};

const setupAutoUpdates = () => {
  if (!app.isPackaged) return;
  if (process.platform !== 'win32') return;
  if (process.env.PORTABLE_EXECUTABLE_FILE) return;
  if (String(process.env.POS_DISABLE_AUTO_UPDATE ?? '').trim() === '1') return;

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('update-available', async (info) => {
    const result = await dialog.showMessageBox(mainWindow, {
      type: 'info',
      buttons: ['Atualizar agora', 'Depois'],
      defaultId: 0,
      cancelId: 1,
      title: 'Atualização disponível',
      message: `Nova versão disponível (${info.version}).`,
      detail: 'Deseja baixar e instalar agora?',
    });

    if (result.response === 0) {
      autoUpdater.downloadUpdate();
    }
  });

  autoUpdater.on('update-downloaded', async () => {
    const result = await dialog.showMessageBox(mainWindow, {
      type: 'info',
      buttons: ['Reiniciar e instalar', 'Mais tarde'],
      defaultId: 0,
      cancelId: 1,
      title: 'Atualização pronta',
      message: 'A atualização foi baixada com sucesso.',
      detail: 'Reiniciar o app agora para concluir a instalação?',
    });

    if (result.response === 0) {
      autoUpdater.quitAndInstall();
    }
  });

  autoUpdater.on('error', async (error) => {
    if (isBenignUpdateCheckFailure(error)) {
      console.warn('[autoUpdater]', String(error?.message ?? error ?? ''));
      return;
    }
    await dialog.showMessageBox(mainWindow, {
      type: 'warning',
      buttons: ['OK'],
      defaultId: 0,
      title: 'Erro ao atualizar',
      message: 'Não foi possível verificar/baixar atualização.',
      detail: String(error?.message ?? error ?? 'Erro desconhecido'),
    });
  });

  safeCheckForUpdates();
  setInterval(() => {
    safeCheckForUpdates();
  }, 15 * 60 * 1000);
};

app.whenReady().then(async () => {
  try {
    await startBackend();
    await startStandaloneWeb();
  } catch (error) {
    dialog.showErrorBox('Falha ao iniciar', String(error?.message ?? error ?? 'Erro desconhecido'));
    stopServices();
    app.quit();
    return;
  }

  await createWindow();
  setupAutoUpdates();
});

app.on('window-all-closed', () => {
  stopServices();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  stopServices();
});