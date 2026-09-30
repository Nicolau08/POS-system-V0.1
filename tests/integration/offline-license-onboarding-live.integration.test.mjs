/**
 * Integração REAL (Etapa 1F.5b, itens 35-40) — o novo onboarding Ed25519
 * completo contra um license-console real e um Postgres real
 * (supabase/): Activation Token → bootstrap real (Device Auth,
 * reaproveitado de 1F.1/1F.2) → Device JWT real → POST
 * /device/offline-license real → verificação Ed25519 real (nunca simulada)
 * → armazenamento atómico real → persistência de estado local real
 * (api/server.js real, spawnado como processo) → "restart" real.
 *
 * Prova adicional: independência total de POS_LICENSE_HMAC_SECRET (ausente e
 * envenenado) e revalidação server-side em tempo real (revogar device,
 * incrementar token_version, suspender licença/tenant directamente no
 * Postgres real, entre o bootstrap e o pedido de licença offline).
 *
 * Requer env: POSLY_1F5_ISSUER_URL, POSLY_1F5_ADMIN_TOKEN,
 *   POSLY_1F5_SUPABASE_URL, POSLY_1F5_SUPABASE_SERVICE_ROLE_KEY.
 * Sem eles, os testes são saltados — nunca falham a correr no CI normal.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { test, mock } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');

const ISSUER_URL = process.env.POSLY_1F5_ISSUER_URL || '';
const ADMIN_TOKEN = process.env.POSLY_1F5_ADMIN_TOKEN || '';
const SUPABASE_URL = process.env.POSLY_1F5_SUPABASE_URL || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.POSLY_1F5_SUPABASE_SERVICE_ROLE_KEY || '';
const shouldRun = Boolean(ISSUER_URL && ADMIN_TOKEN && SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);

mock.module('electron', {
  exports: {
    safeStorage: {
      isEncryptionAvailable: () => true,
      encryptString: (s) => Buffer.concat([Buffer.from('FAKEENC:'), Buffer.from(s, 'utf8')]),
      decryptString: (b) => Buffer.from(b).subarray(8).toString('utf8'),
    },
  },
});

async function adminApi(pathSuffix, body) {
  const res = await fetch(`${ISSUER_URL.replace(/\/$/, '')}${pathSuffix}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${ADMIN_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  return { ok: res.ok, status: res.status, data };
}

async function waitForHttp(url, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  let lastErr = null;
  while (Date.now() < deadline) {
    try {
      return await fetch(url);
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 300));
    }
  }
  throw lastErr || new Error('timeout');
}

/** Provisiona tenant+licença+activation token reais para um teste isolado. */
async function provisionRealLicense(adminSupabase, label) {
  const suffix = crypto.randomBytes(3).toString('hex');
  const tenantId = `tenant-1f5b-${label}-${suffix}`;
  const tenantRes = await adminApi('/api/license-issuer/tenants', { id: tenantId, name: `Loja 1F5b ${label}`, nuit: `9${suffix}`.slice(0, 9) });
  assert.equal(tenantRes.ok, true, `criar tenant falhou: ${JSON.stringify(tenantRes.data)}`);

  const licenseRes = await adminApi('/api/license-issuer/licenses', {
    tenant_id: tenantId,
    plan: 'PRO',
    commerce_type: 'retalho',
    vertical: 'retalho',
  });
  assert.equal(licenseRes.ok, true, `criar licença falhou: ${JSON.stringify(licenseRes.data)}`);
  const licenseId = licenseRes.data.license.id;

  const storeRes = await adminApi('/api/license-issuer/stores', {
    tenant_id: tenantId,
    license_id: licenseId,
    name: 'Loja E2E',
  });
  assert.equal(storeRes.ok, true, `criar loja falhou: ${JSON.stringify(storeRes.data)}`);

  const activationRes = await adminApi('/api/license-issuer/device/activation-tokens', {
    tenant_id: tenantId,
    license_id: licenseId,
    store_id: storeRes.data.store.id,
  });
  assert.equal(activationRes.ok, true, `criar activation token falhou: ${JSON.stringify(activationRes.data)}`);

  return { tenantId, licenseId, activationToken: activationRes.data.activation_token };
}

function runServerScenario({ env, port, timeoutMs = 20000 }) {
  let stdout = '';
  const child = spawn(process.execPath, [path.join(repoRoot, 'api', 'server.js')], {
    cwd: repoRoot,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (d) => (stdout += d.toString()));
  child.stderr.on('data', (d) => (stdout += d.toString()));
  const ready = waitForHttp(`http://127.0.0.1:${port}/setup/status`, timeoutMs);
  return { child, ready, getLog: () => stdout };
}

test(
  'E2E real: activation token -> bootstrap -> Device JWT -> /device/offline-license -> verificação local -> storage -> API real persiste estado -> restart',
  { skip: !shouldRun && 'defina POSLY_1F5_* para correr a integração real' },
  async () => {
    const adminSupabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { bootstrapDevice } = await import('../../electron/deviceAuth/deviceAuthClient.js');
    const { requestOfflineLicense, installOfflineLicense, getOfflineLicenseState } = await import(
      '../../electron/deviceAuth/offlineLicenseClient.js'
    );
    const { verifyOfflineLicense } = await import('../../lib/licensing/offlineLicense.js');

    const { tenantId, licenseId, activationToken } = await provisionRealLicense(adminSupabase, 'e2e');
    const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'posly-1f5b-e2e-'));
    const machineId = `machine-1f5b-e2e-${crypto.randomBytes(3).toString('hex')}`;

    try {
      // 1-2. Activation Token -> bootstrapDevice() real.
      const boot = await bootstrapDevice({ activationToken, machineId, userDataPath, issuerBaseUrl: ISSUER_URL });
      assert.equal(boot.ok, true, `bootstrap real falhou: ${JSON.stringify(boot)}`);

      // 3. Device JWT real (do próprio bootstrap — sem passar por getValidAccessToken aqui).
      const accessToken = boot.accessToken;
      assert.ok(accessToken);

      // 4. POST /device/offline-license real.
      const issuance = await requestOfflineLicense({ accessToken, issuerBaseUrl: ISSUER_URL });
      assert.equal(issuance.ok, true, `emissão real falhou: ${JSON.stringify(issuance)}`);
      assert.equal(issuance.envelope.payload.tenant_id, tenantId);
      // 1G.3.1: o emissor real devolve v2 ao device (store_id do device; limite EXPLICITO, null = ilimitado)
      assert.equal(issuance.envelope.version, 2);
      assert.equal(issuance.envelope.payload.license_version, 2);
      assert.ok(issuance.envelope.payload.store_id);
      assert.ok(Object.prototype.hasOwnProperty.call(issuance.envelope.payload, 'max_stations_per_store'));
      assert.equal(issuance.envelope.payload.max_stations_per_store, null);
      assert.equal(issuance.envelope.payload.license_id, licenseId);
      assert.equal(issuance.envelope.payload.machine_id, machineId);

      // 5-6. Verificação Ed25519 local real, contra a public key resolvida do
      // ambiente de teste do license-console (nunca a private key).
      const publicKeyPem = process.env.POS_OFFLINE_LICENSE_PUBLIC_KEY_FOR_TEST || '';
      assert.ok(publicKeyPem, 'defina POS_OFFLINE_LICENSE_PUBLIC_KEY_FOR_TEST (chave pública correspondente à privada do license-console)');
      const keyId = issuance.envelope.key_id;
      const resolvePem = (kid) => (kid === keyId ? publicKeyPem : null);

      const localVerify = verifyOfflineLicense(issuance.envelope, resolvePem, { machineId });
      assert.equal(localVerify.ok, true, `verificação local real falhou: ${localVerify.error}`);

      // 7. Persistir localmente (só depois de verificado).
      const installed = installOfflineLicense({ envelope: issuance.envelope, userDataPath, resolvePublicKeyPem: resolvePem, machineId });
      assert.equal(installed.ok, true);

      // API local real (spawnada) — persistência de estado + reconfirmação
      // server-side, com SUPABASE_SERVICE_ROLE_KEY, POS_LICENSE_HMAC_SECRET
      // AUSENTES (item 35: novo caminho nunca depende deles).
      const port = 4200 + Math.floor(Math.random() * 500);
      const env = {
        ...process.env,
        POS_API_PORT: String(port),
        POS_DB_PATH: path.join(userDataPath, 'database.db'),
        POS_USER_DATA_PATH: userDataPath,
        NODE_ENV: 'development',
        DEFAULT_TENANT_ID: tenantId,
        POS_DEV_OFFLINE_LICENSE_KEY_ID: keyId,
        POS_DEV_OFFLINE_LICENSE_PUBLIC_KEY: publicKeyPem,
      };
      delete env.SUPABASE_SERVICE_ROLE_KEY;
      delete env.POS_LICENSE_HMAC_SECRET;
      delete env.LICENSE_HMAC_SECRET;

      const server = runServerScenario({ env, port });
      await server.ready;
      await new Promise((r) => setTimeout(r, 800));

      const installRes = await fetch(`http://127.0.0.1:${port}/setup/license/install-offline-license`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ offline_license: issuance.envelope, machine_id: machineId }),
      });
      const installData = await installRes.json();
      assert.equal(installRes.status, 200, `instalação real via API falhou: ${JSON.stringify(installData)}`);

      const statusRes = await fetch(`http://127.0.0.1:${port}/setup/status`);
      const statusData = await statusRes.json();
      assert.equal(statusData?.data?.licenseActivated ?? statusData?.licenseActivated, true);

      server.child.kill('SIGKILL');

      // 8-10. "Restart": novo processo (porta nova), mesmo POS_DB_PATH/
      // POS_USER_DATA_PATH — confirma que o estado persistiu em disco
      // (SQLite + offline-license.json) e volta a ficar activado sem
      // repetir o onboarding.
      const restartPort = port + 1;
      const envRestart = { ...env, POS_API_PORT: String(restartPort) };
      const server2 = runServerScenario({ env: envRestart, port: restartPort, timeoutMs: 20000 });
      await server2.ready;
      const statusAfterRestart = await (await fetch(`http://127.0.0.1:${restartPort}/setup/status`)).json();
      assert.equal(statusAfterRestart?.data?.licenseActivated ?? statusAfterRestart?.licenseActivated, true);
      server2.child.kill('SIGKILL');

      // Reverificação local pura (item 10) depois do "restart" — nunca confia em cache.
      const stateAfterRestart = getOfflineLicenseState({ userDataPath, resolvePublicKeyPem: resolvePem, machineId });
      assert.equal(stateAfterRestart.ok, true);
      assert.equal(stateAfterRestart.kind, 'VALID');
    } finally {
      try {
        try {
        fs.rmSync(userDataPath, { recursive: true, force: true });
      } catch {
        // ignore (Windows pode manter um handle breve depois de matar o processo filho)
      }
      } catch {
        // ignore
      }
    }
  },
);

test(
  'DB revalidation real (item 38): device revogado no Postgres real DEPOIS do JWT emitido -> /device/offline-license FAIL',
  { skip: !shouldRun && 'defina POSLY_1F5_* para correr a integração real' },
  async () => {
    const adminSupabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { bootstrapDevice } = await import('../../electron/deviceAuth/deviceAuthClient.js');
    const { requestOfflineLicense } = await import('../../electron/deviceAuth/offlineLicenseClient.js');

    const { activationToken } = await provisionRealLicense(adminSupabase, 'revoke');
    const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'posly-1f5b-revoke-'));
    const machineId = `machine-1f5b-revoke-${crypto.randomBytes(3).toString('hex')}`;

    try {
      const boot = await bootstrapDevice({ activationToken, machineId, userDataPath, issuerBaseUrl: ISSUER_URL });
      assert.equal(boot.ok, true);

      const { error: revokeErr } = await adminSupabase
        .from('pos_devices')
        .update({ revoked_at: new Date().toISOString(), revoked_reason: 'teste 1f5b' })
        .eq('id', boot.deviceId);
      assert.equal(revokeErr, null);

      const issuance = await requestOfflineLicense({ accessToken: boot.accessToken, issuerBaseUrl: ISSUER_URL });
      assert.equal(issuance.ok, false);
      assert.equal(issuance.code, 'device_revoked');
    } finally {
      try {
        fs.rmSync(userDataPath, { recursive: true, force: true });
      } catch {
        // ignore (Windows pode manter um handle breve depois de matar o processo filho)
      }
    }
  },
);

test(
  'DB revalidation real (item 38): token_version incrementado no Postgres real -> JWT antigo FAIL',
  { skip: !shouldRun && 'defina POSLY_1F5_* para correr a integração real' },
  async () => {
    const adminSupabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { bootstrapDevice } = await import('../../electron/deviceAuth/deviceAuthClient.js');
    const { requestOfflineLicense } = await import('../../electron/deviceAuth/offlineLicenseClient.js');

    const { activationToken } = await provisionRealLicense(adminSupabase, 'tokver');
    const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'posly-1f5b-tokver-'));
    const machineId = `machine-1f5b-tokver-${crypto.randomBytes(3).toString('hex')}`;

    try {
      const boot = await bootstrapDevice({ activationToken, machineId, userDataPath, issuerBaseUrl: ISSUER_URL });
      assert.equal(boot.ok, true);

      const { error: bumpErr } = await adminSupabase.from('pos_devices').update({ token_version: 999 }).eq('id', boot.deviceId);
      assert.equal(bumpErr, null);

      const issuance = await requestOfflineLicense({ accessToken: boot.accessToken, issuerBaseUrl: ISSUER_URL });
      assert.equal(issuance.ok, false);
      assert.equal(issuance.code, 'device_token_version_mismatch');
    } finally {
      try {
        fs.rmSync(userDataPath, { recursive: true, force: true });
      } catch {
        // ignore (Windows pode manter um handle breve depois de matar o processo filho)
      }
    }
  },
);

test(
  'DB revalidation real (item 38): licença suspensa no Postgres real -> FAIL; JWT válido + tudo activo -> PASS',
  { skip: !shouldRun && 'defina POSLY_1F5_* para correr a integração real' },
  async () => {
    const adminSupabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { bootstrapDevice } = await import('../../electron/deviceAuth/deviceAuthClient.js');
    const { requestOfflineLicense } = await import('../../electron/deviceAuth/offlineLicenseClient.js');

    const { licenseId, activationToken } = await provisionRealLicense(adminSupabase, 'suspend');
    const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'posly-1f5b-suspend-'));
    const machineId = `machine-1f5b-suspend-${crypto.randomBytes(3).toString('hex')}`;

    try {
      const boot = await bootstrapDevice({ activationToken, machineId, userDataPath, issuerBaseUrl: ISSUER_URL });
      assert.equal(boot.ok, true);

      // JWT válido + tudo activo -> PASS (baseline antes de suspender).
      const issuanceBefore = await requestOfflineLicense({ accessToken: boot.accessToken, issuerBaseUrl: ISSUER_URL });
      assert.equal(issuanceBefore.ok, true, `deveria passar com tudo activo: ${JSON.stringify(issuanceBefore)}`);

      const { error: suspendErr } = await adminSupabase.from('licenses').update({ status: 'suspended' }).eq('id', licenseId);
      assert.equal(suspendErr, null);

      const issuanceAfter = await requestOfflineLicense({ accessToken: boot.accessToken, issuerBaseUrl: ISSUER_URL });
      assert.equal(issuanceAfter.ok, false);
      assert.equal(issuanceAfter.code, 'license_suspended');
    } finally {
      try {
        fs.rmSync(userDataPath, { recursive: true, force: true });
      } catch {
        // ignore (Windows pode manter um handle breve depois de matar o processo filho)
      }
    }
  },
);

test(
  'HMAC poison (item 36): POS_LICENSE_HMAC_SECRET envenenado -> novo caminho Ed25519 continua a funcionar',
  { skip: !shouldRun && 'defina POSLY_1F5_* para correr a integração real' },
  async () => {
    const adminSupabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { bootstrapDevice } = await import('../../electron/deviceAuth/deviceAuthClient.js');
    const { requestOfflineLicense, installOfflineLicense } = await import('../../electron/deviceAuth/offlineLicenseClient.js');
    const { verifyOfflineLicense } = await import('../../lib/licensing/offlineLicense.js');

    const { tenantId, licenseId, activationToken } = await provisionRealLicense(adminSupabase, 'poison');
    const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'posly-1f5b-poison-'));
    const machineId = `machine-1f5b-poison-${crypto.randomBytes(3).toString('hex')}`;

    try {
      const boot = await bootstrapDevice({ activationToken, machineId, userDataPath, issuerBaseUrl: ISSUER_URL });
      assert.equal(boot.ok, true);

      const issuance = await requestOfflineLicense({ accessToken: boot.accessToken, issuerBaseUrl: ISSUER_URL });
      assert.equal(issuance.ok, true);
      assert.equal(issuance.envelope.payload.tenant_id, tenantId);
      assert.equal(issuance.envelope.payload.license_id, licenseId);

      const publicKeyPem = process.env.POS_OFFLINE_LICENSE_PUBLIC_KEY_FOR_TEST || '';
      const keyId = issuance.envelope.key_id;
      const resolvePem = (kid) => (kid === keyId ? publicKeyPem : null);

      const port = 4700 + Math.floor(Math.random() * 200);
      const env = {
        ...process.env,
        POS_API_PORT: String(port),
        POS_DB_PATH: path.join(userDataPath, 'database.db'),
        POS_USER_DATA_PATH: userDataPath,
        NODE_ENV: 'development',
        DEFAULT_TENANT_ID: tenantId,
        POS_DEV_OFFLINE_LICENSE_KEY_ID: keyId,
        POS_DEV_OFFLINE_LICENSE_PUBLIC_KEY: publicKeyPem,
        POS_LICENSE_HMAC_SECRET: 'INVALID_HMAC_SHOULD_NOT_BE_USED',
      };
      delete env.SUPABASE_SERVICE_ROLE_KEY;

      let stdout = '';
      const child = spawn(process.execPath, [path.join(repoRoot, 'api', 'server.js')], { cwd: repoRoot, env, stdio: ['ignore', 'pipe', 'pipe'] });
      child.stdout.on('data', (d) => (stdout += d.toString()));
      child.stderr.on('data', (d) => (stdout += d.toString()));
      try {
        await waitForHttp(`http://127.0.0.1:${port}/setup/status`, 20000);
        const installRes = await fetch(`http://127.0.0.1:${port}/setup/license/install-offline-license`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ offline_license: issuance.envelope, machine_id: machineId }),
        });
        assert.equal(installRes.status, 200, `Ed25519 install falhou mesmo com HMAC ausente/envenenado, sem ligação: ${await installRes.text()}`);
        assert.equal(stdout.includes('INVALID_HMAC_SHOULD_NOT_BE_USED'), false, 'valor poison nunca deve aparecer nos logs');
      } finally {
        child.kill('SIGKILL');
      }
    } finally {
      try {
        fs.rmSync(userDataPath, { recursive: true, force: true });
      } catch {
        // ignore (Windows pode manter um handle breve depois de matar o processo filho)
      }
    }
  },
);
