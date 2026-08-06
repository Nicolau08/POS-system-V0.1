import { app, BrowserWindow, Menu, ipcMain, dialog } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs/promises';
import { spawn, execFile } from 'child_process';
import fsSync from 'fs';
import crypto from 'crypto';
import os from 'os';
import dotenv from 'dotenv';
import electronUpdaterModule from 'electron-updater';
import machineIdModule from 'node-machine-id';
import {
  isReactivationTokenInput,
  normalizeReactivationTokenInput,
} from '../lib/licensing/reactivationToken.js';
import { LICENSE_IN_USE_MESSAGE } from '../lib/licensing/licenseConflict.js';
import {
  resignMachineLicensePayload,
  verifyOfflineReactivationToken,
} from '../lib/licensing/offlineReactivationToken.js';
import { electronLogError, electronLogInfo, electronLogWarn } from './logger.js';
import { getOrCreateDbEncryptionKey } from './dbEncryptionKey.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, '..');
dotenv.config({ path: path.join(projectRoot, '.env') });
dotenv.config({ path: path.join(projectRoot, '.env.local'), override: true });

/** Segredos gerados em build (scripts/inject-pos-build-secrets.mjs) para o instalador. */
const loadPackagedBuildSecrets = () => {
  const candidates = [
    path.join(__dirname, '.build-secrets.json'),
    path.join(process.resourcesPath || '', 'app.asar', 'electron', '.build-secrets.json'),
    path.join(process.resourcesPath || '', 'electron', '.build-secrets.json'),
  ];
  for (const candidate of candidates) {
    try {
      if (!candidate || !fsSync.existsSync(candidate)) continue;
      const parsed = JSON.parse(fsSync.readFileSync(candidate, 'utf8'));
      if (!parsed || typeof parsed !== 'object') continue;
      for (const [key, value] of Object.entries(parsed)) {
        const text = String(value ?? '').trim();
        if (!text) continue;
        if (!String(process.env[key] ?? '').trim()) {
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

const { machineIdSync } = machineIdModule;
const { autoUpdater } = electronUpdaterModule;

let backendProcess = null;
let webProcess = null;
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
  return {
    userDataPath,
    databasePath: path.join(userDataPath, 'data', 'database.db'),
    backupsPath: path.join(userDataPath, 'backups'),
    configPath: path.join(userDataPath, 'config.json'),
    licensePath: path.join(userDataPath, 'license.json'),
    stationRuntimePath: path.join(userDataPath, 'station-runtime.json'),
  };
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
      stationCode: String(parsed.stationCode ?? 'caixa-1').trim(),
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
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Timeout aguardando ${probeUrl}`);
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

const ACTIVATION_VOUCHER_KIND = 'pos_activation_v1';

const buildCanonicalVoucherPayload = (payload) => ({
  kind: ACTIVATION_VOUCHER_KIND,
  tenant_id: String(payload?.tenant_id ?? '').trim(),
  expiration: String(payload?.expiration ?? payload?.expires_at ?? '').trim(),
  nonce: String(payload?.nonce ?? '').trim(),
});

const signCanonicalVoucherPayload = (canonicalPayload, secret) =>
  crypto
    .createHmac('sha256', secret)
    .update(JSON.stringify(canonicalPayload))
    .digest('hex');

const verifyVoucherPayload = (payload) => {
  const secret = resolveLicenseHmacSecret();
  if (!secret) {
    return { ok: false, reason: 'POS_LICENSE_HMAC_SECRET não configurado para validar o código.' };
  }
  if (String(payload?.kind ?? '').trim() !== ACTIVATION_VOUCHER_KIND) {
    return { ok: false, reason: 'Código de ativação inválido.' };
  }
  const signature = String(payload?.signature ?? '').trim();
  if (!signature) {
    return { ok: false, reason: 'Código de ativação sem assinatura.' };
  }
  const canonical = buildCanonicalVoucherPayload(payload);
  if (!canonical.tenant_id || !canonical.expiration || !canonical.nonce) {
    return { ok: false, reason: 'Código de ativação incompleto.' };
  }
  const expectedSignature = signCanonicalVoucherPayload(canonical, secret);
  if (!timingSafeEqualHex(signature, expectedSignature)) {
    return { ok: false, reason: 'Assinatura do código de ativação inválida.' };
  }
  const expiresAt = new Date(canonical.expiration);
  if (Number.isNaN(expiresAt.getTime())) {
    return { ok: false, reason: 'Data de expiração do código inválida.' };
  }
  if (Date.now() > expiresAt.getTime()) {
    return { ok: false, reason: 'Este código de ativação já expirou.' };
  }
  return {
    ok: true,
    tenantId: canonical.tenant_id,
    expirationIso: expiresAt.toISOString(),
    nonce: canonical.nonce,
  };
};

const materializeLicenseFromVerifiedVoucher = (payload, localMachineId, expirationIso) => {
  const secret = resolveLicenseHmacSecret();
  if (!secret) {
    throw new Error('missing_license_secret');
  }
  const tenantId = String(payload?.tenant_id ?? '').trim();
  const canonicalPayload = buildCanonicalLicensePayload({
    tenant_id: tenantId,
    machine_id: localMachineId,
    expiration: expirationIso,
  });
  const signature = signCanonicalLicensePayload(canonicalPayload, secret);
  return {
    tenant_id: canonicalPayload.tenant_id,
    machine_id: canonicalPayload.machine_id,
    expiration: canonicalPayload.expiration,
    signature,
  };
};

const redeemReactivationTokenFromIssuer = async (rawInput, machineId) => {
  const issuerBaseUrl = String(process.env.POS_LICENSE_ISSUER_BASE_URL ?? '').trim();
  if (!issuerBaseUrl) {
    return {
      ok: false,
      error:
        'POS_LICENSE_ISSUER_BASE_URL não definido — não é possível validar o token de reativação.',
    };
  }
  const url = `${issuerBaseUrl.replace(/\/$/, '')}/api/license-issuer/reactivate`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: normalizeReactivationTokenInput(rawInput) ?? String(rawInput ?? '').trim(),
        machine_id: machineId,
      }),
      signal: ctrl.signal,
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body?.success) {
      return { ok: false, error: body?.error || `${res.status} ${res.statusText}` };
    }
    const licenseKey = String(body.license_key ?? '').trim();
    if (!licenseKey) {
      return { ok: false, error: 'Resposta da consola sem license_key.' };
    }
    return { ok: true, licenseKey, license: body.license ?? null };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  } finally {
    clearTimeout(timer);
  }
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

  if (isReactivationTokenInput(rawInput)) {
    return {
      payload: null,
      error:
        'Token de 12 dígitos: reinicie a app POS (fecha e volta a abrir o Electron) ou use «Revalidar» após prolongar na consola. Confirme POS_LICENSE_ISSUER_BASE_URL no .env.local.',
    };
  }

  return {
    payload: null,
    error: 'Formato de licença inválido. Use JSON ou base64(JSON), ou o token de 12 dígitos da consola.',
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
    return {
      ok: false,
      reason: LICENSE_IN_USE_MESSAGE,
    };
  }

  const localMachineId = machineIdSync({ original: true });
  if (machineId !== localMachineId) {
    return {
      ok: false,
      reason: LICENSE_IN_USE_MESSAGE,
    };
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
  const status = await fetchSetupStatusReliable();
  if (!status || typeof status !== 'object') return null;
  // Antes da licença estar registada na BD, não comparar com o tenant seed (ex.: tenant-1):
  // o tenant correcto vem da licença / voucher de ativação.
  const licenseActivated = Boolean(
    status.licenseActivated ?? status.license_activated
  );
  if (!licenseActivated) return null;
  const id = status.tenantId ?? status.tenant_id;
  return id ? String(id).trim() : null;
};

const getActivationStateInternal = async () => {
  const machineId = machineIdSync({ original: true });
  const activationCode = buildActivationCode(machineId);
  const { licensePath } = getRuntimePaths();
  const expectedTenantId = await resolveExpectedTenantId();

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

    const setup = await fetchSetupStatusReliable();
    // Só considerar activado quando a API confirma license_activated. Nunca assumir "ok" em dev
    // quando setup é null — isso saltava o ecrã de ativação e deixava o assistente com licença pendente.
    const licenseAckedInDb = Boolean(setup?.licenseActivated);
    if (!licenseAckedInDb) {
      const reason = setup
        ? 'Introduza de novo o código ou a chave de licença para registar nesta base de dados (instalação nova ou base reposta).'
        : 'API local indisponível. Aguarde uns segundos ou reinicie a aplicação; depois introduza o código de ativação se for pedido.';
      return {
        success: true,
        isActivated: false,
        machineId,
        activationCode,
        licensePath,
        reason,
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

const tryOfflineReactivationInElectron = async (
  rawLicenseKey,
  machineId,
  licensePath,
  expectedTenantId,
) => {
  const tokenDigits = normalizeReactivationTokenInput(rawLicenseKey);
  if (!tokenDigits) return { ok: false, skipped: true };

  const secret = resolveLicenseHmacSecret();
  if (!secret) {
    return { ok: false, error: 'POS_LICENSE_HMAC_SECRET não configurado para validação offline.' };
  }

  let localPayload;
  try {
    const raw = await fs.readFile(licensePath, 'utf8');
    const parsed = parseLicenseInput(raw);
    if (!parsed.payload) {
      return { ok: false, offlineInvalid: true, error: 'Licença local não encontrada.' };
    }
    localPayload = parsed.payload;
  } catch {
    return { ok: false, offlineInvalid: true, error: 'Licença local não encontrada.' };
  }

  const verified = verifyOfflineReactivationToken(tokenDigits, {
    secret,
    tenantId: localPayload.tenant_id,
    expectedMachineId: machineId,
    licenseMachineId: localPayload.machine_id,
    voucherNonce: localPayload.voucher_nonce,
  });
  if (!verified.ok) {
    return { ok: false, offlineInvalid: true, error: verified.error || 'Token offline inválido.' };
  }

  const licenseToWrite = resignMachineLicensePayload(localPayload, verified.expirationIso, secret);
  const validation = validateLicensePayload({
    payload: licenseToWrite,
    expectedTenantId,
  });
  if (!validation.ok) {
    return { ok: false, error: validation.reason || 'Licença inválida após reativação offline.' };
  }

  await ensureDir(path.dirname(licensePath));
  await fs.writeFile(licensePath, JSON.stringify(licenseToWrite, null, 2), 'utf8');
  return { ok: true, offline: true };
};

const activateLicenseInternal = async (rawLicenseKey) => {
  const machineId = machineIdSync({ original: true });
  const activationCode = buildActivationCode(machineId);
  const { licensePath } = getRuntimePaths();
  const expectedTenantId = await resolveExpectedTenantId();

  if (isReactivationTokenInput(rawLicenseKey)) {
    const offline = await tryOfflineReactivationInElectron(
      rawLicenseKey,
      machineId,
      licensePath,
      expectedTenantId,
    );
    if (offline.ok) {
      return {
        success: true,
        machineId,
        activationCode,
        licensePath,
        offline: true,
      };
    }

    const redeem = await redeemReactivationTokenFromIssuer(rawLicenseKey, machineId);
    if (!redeem.ok) {
      const offlineHint = offline.offlineInvalid && offline.error ? `${offline.error} ` : '';
      return {
        success: false,
        machineId,
        activationCode,
        licensePath,
        error: `${offlineHint}${redeem.error || 'Token de reativação inválido.'}`.trim(),
      };
    }
    const parsedInput = parseLicenseInput(redeem.licenseKey);
    if (!parsedInput.payload) {
      return {
        success: false,
        machineId,
        activationCode,
        licensePath,
        error: parsedInput.error || 'Licença devolvida pela consola inválida.',
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
    const licenseToWrite = redeem.license && typeof redeem.license === 'object'
      ? redeem.license
      : { ...parsedInput.payload, activated_at: new Date().toISOString() };
    await ensureDir(path.dirname(licensePath));
    await fs.writeFile(licensePath, JSON.stringify(licenseToWrite, null, 2), 'utf8');
    return {
      success: true,
      machineId,
      activationCode,
      licensePath,
    };
  }

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

  const rawPayload = parsedInput.payload;
  const isActivationVoucher =
    rawPayload &&
    typeof rawPayload === 'object' &&
    String(rawPayload.kind ?? '').trim() === ACTIVATION_VOUCHER_KIND;

  if (isActivationVoucher) {
    const voucherCheck = verifyVoucherPayload(rawPayload);
    if (!voucherCheck.ok) {
      return {
        success: false,
        machineId,
        activationCode,
        licensePath,
        error: voucherCheck.reason || 'Código de ativação inválido.',
      };
    }
    if (expectedTenantId && voucherCheck.tenantId !== String(expectedTenantId).trim()) {
      return {
        success: false,
        machineId,
        activationCode,
        licensePath,
        error: LICENSE_IN_USE_MESSAGE,
      };
    }
    let finalLicense;
    try {
      finalLicense = materializeLicenseFromVerifiedVoucher(
        rawPayload,
        machineId,
        voucherCheck.expirationIso
      );
    } catch {
      return {
        success: false,
        machineId,
        activationCode,
        licensePath,
        error: 'Falha ao gerar licença para esta máquina.',
      };
    }
    await ensureDir(path.dirname(licensePath));
    await fs.writeFile(
      licensePath,
      JSON.stringify(
        {
          ...finalLicense,
          activated_at: new Date().toISOString(),
          voucher_nonce: voucherCheck.nonce,
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

/** Alinha o processo Node da API com o tenant da licença (ficheiro escrito pelo Electron). */
const licenseEnvForBackend = async () => {
  if (!isPackagedBuild()) return {};
  const v = await readAndValidateLicenseFromFile(null);
  if (!v.ok || !v.tenantId) return {};
  const { licensePath } = getRuntimePaths();
  let storeName = '';
  try {
    const raw = await fs.readFile(licensePath, 'utf8');
    const parsed = JSON.parse(raw);
    storeName = String(parsed?.store_name ?? parsed?.tenant_name ?? parsed?.storeName ?? '').trim();
  } catch {
    // ignore
  }
  return {
    DEFAULT_TENANT_ID: String(v.tenantId).trim(),
    DEFAULT_TENANT_NAME: storeName || 'Loja',
  };
};

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

const isApiAlreadyUp = async (timeoutMs = 1500) => {
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
  const stationRuntime = await readStationRuntimeConfig();

  // Posto remoto: não inicia API local — a UI fala com o servidor LAN.
  if (stationRuntime.mode === 'client' && stationRuntime.serverApiBaseUrl) {
    console.log(
      `[electron] Modo posto remoto — API no servidor ${stationRuntime.serverApiBaseUrl} (não inicia api/server.js).`,
    );
    return;
  }

  if (useExternalApi() || (await isApiAlreadyUp())) {
    console.log(
      `[electron] A usar API externa em http://127.0.0.1:${apiPort} (não inicia api/server.js).`,
    );
    await waitForHttp(`http://127.0.0.1:${apiPort}`, 10_000);
    return;
  }

  const paths = getRuntimePaths();
  await ensureDir(path.dirname(paths.databasePath));
  await ensureDir(paths.backupsPath);

  // Migração one-shot: pos.db → database.db
  const legacyDbPath = path.join(path.dirname(paths.databasePath), 'pos.db');
  try {
    const legacyExists = await fileExists(legacyDbPath);
    const newExists = await fileExists(paths.databasePath);
    if (legacyExists && !newExists) {
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
  const backendEntry = await resolveBackendEntry();
  const licenseEnv = await licenseEnvForBackend();
  const issuerBaseUrl = String(process.env.POS_LICENSE_ISSUER_BASE_URL ?? '').trim();
  const licenseHmacSecret = String(
    process.env.POS_LICENSE_HMAC_SECRET ?? process.env.LICENSE_HMAC_SECRET ?? '',
  ).trim();

  const lanAccess = Boolean(stationRuntime.lanAccessEnabled);
  const bindHost = lanAccess ? '0.0.0.0' : '127.0.0.1';
  // Segredo estável por instalação para Bearer em login LAN
  let authHmac = String(process.env.POS_AUTH_HMAC_SECRET || process.env.AUTH_BEARER_SHARED_SECRET || '').trim();
  if (!authHmac) {
    authHmac = crypto.createHash('sha256').update(`posly-auth:${paths.userDataPath}`).digest('hex').slice(0, 48);
  }

  let dbEncryptionKeyHex = '';
  try {
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
      ...(issuerBaseUrl ? { POS_LICENSE_ISSUER_BASE_URL: issuerBaseUrl } : {}),
      ...(licenseHmacSecret ? { POS_LICENSE_HMAC_SECRET: licenseHmacSecret } : {}),
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
    await waitForHttp(`http://127.0.0.1:${apiPort}`);
  } catch (error) {
    const details = backendStartupLogs.trim();
    const suffix = details ? `\n\n${details}` : '';
    throw new Error(`Falha ao iniciar backend.${suffix || ` ${String(error?.message ?? error)}`}`);
  }
};

const startStandaloneWeb = async () => {
  if (!isPackagedBuild()) return;

  const webPort = resolveAppWebPort();
  const apiPort = resolveAppApiPort();
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
};

const fetchSetupStatus = async () => {
  try {
    const response = await fetch(`http://127.0.0.1:${resolveAppApiPort()}/setup/status`);
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
const fetchSetupStatusReliable = async (attempts = 6, delayMs = 250) => {
  for (let i = 0; i < attempts; i += 1) {
    const row = await fetchSetupStatus();
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

const buildSplashHtml = () => `
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
      }
      .mark {
        width: 104px;
        height: 104px;
        border-radius: 22px;
        box-shadow: 0 18px 48px rgba(0, 1, 251, 0.35);
        animation: pulse 1.4s ease-in-out infinite;
      }
      .label {
        font-size: 12px;
        letter-spacing: 0.18em;
        text-transform: uppercase;
        color: #a1a1aa;
        animation: fade 1.4s ease-in-out infinite;
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
      @keyframes fade {
        0%,
        100% {
          opacity: 1;
        }
        50% {
          opacity: 0.45;
        }
      }
      @media (prefers-reduced-motion: reduce) {
        .mark,
        .label {
          animation: none;
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
      <div class="label">A iniciar POSly…</div>
    </div>
  </body>
</html>
`;

/** Feedback visual imediato: sem isto o arranque fica sem janela e o utilizador reabre a app várias vezes. */
const createSplashWindow = () => {
  if (splashWindow && !splashWindow.isDestroyed()) return splashWindow;
  const splash = new BrowserWindow({
    width: 320,
    height: 320,
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
    backgroundColor: '#121212',
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

  if (blockedReason) {
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(buildLicenseBlockedHtml(blockedReason))}`);
    revealMainWindow(win);
    return;
  }

  if (!isPackagedBuild()) {
    const targetUrl = resolveDevWebUrl();
    try {
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
  await win.loadURL(`http://127.0.0.1:${resolveAppWebPort()}`);
  revealMainWindow(win);
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
    const cfg = await writeStationRuntimeConfig(patch ?? {});
    return { success: true, ...cfg };
  } catch (error) {
    return { success: false, error: String(error?.message ?? error) };
  }
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
      const url = `http://${host}:${port}`;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 350);
      try {
        const res = await fetch(`${url}/station/discover`, { signal: controller.signal });
        clearTimeout(timer);
        if (!res.ok) return;
        const json = await res.json().catch(() => null);
        const data = json?.success ? json.data : json;
        if (data?.app !== 'posly') return;
        if (seen.has(url)) return;
        seen.add(url);
        servers.push({
          url,
          store_name: data.store_name,
          tenant_id: data.tenant_id,
          port: data.port || port,
        });
      } catch {
        clearTimeout(timer);
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
  if (!isPackagedBuild()) return;
  if (process.platform !== 'win32') return;
  if (process.env.PORTABLE_EXECUTABLE_FILE) return;
  if (String(process.env.POS_DISABLE_AUTO_UPDATE ?? '').trim() === '1') return;

  const channel = resolveAutoUpdaterChannel();
  autoUpdater.allowPrerelease = channel.allowPrerelease;
  console.log(
    `[autoUpdater] Canal: ${channel.label} (allowPrerelease=${String(channel.allowPrerelease)})`
  );

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

// Windows: tem de ser ANTES do ready — caso contrário a taskbar fica com o
// ícone Atom em cache associado ao AppUserModelId antigo.
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
  try {
    await startBackend();
    electronLogInfo('electron.api_started', 'API local iniciada ou já disponível', {
      module: 'main',
      action: 'startBackend',
    });
    await startStandaloneWeb();
  } catch (error) {
    electronLogError('electron.boot_failed', 'Falha ao iniciar serviços do Electron', {
      module: 'main',
      action: 'whenReady',
      reason: 'Erro ao subir API/web antes da janela',
      error: String(error?.message ?? error),
    });
    closeSplashWindow();
    dialog.showErrorBox('Falha ao iniciar', String(error?.message ?? error ?? 'Erro desconhecido'));
    stopServices();
    app.quit();
    return;
  }

  try {
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