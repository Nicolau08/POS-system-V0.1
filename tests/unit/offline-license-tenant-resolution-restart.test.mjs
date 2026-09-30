/**
 * Pilot Gate (achado real numa instalação piloto): activar uma Offline
 * License Ed25519 v1 persistia correctamente tenant/tenant_profile/licenses/
 * app_setup_state, mas depois de um RESTART do processo API (mesma BD
 * SQLCipher, "fechar e reabrir" a app) /setup/status e /tenant/info voltavam
 * a resolver o tenant de bootstrap ('tenant-1'/Default Tenant) em vez do
 * tenant real activado.
 *
 * Causa: o auto-seed de uma licença 'AUTO'/LOCAL para tenants sem licença
 * (api/server.js, arranque) corre numa cadeia assíncrona independente do
 * seed do tenant por defeito (schema/bootstrap.js) — numa BD SQLCipher
 * (sempre o caso em produção), o auto-seed pode não apanhar 'tenant-1' no
 * boot 1 (ainda não existe) e só o semear no boot 2, com um created_at MAIS
 * recente do que o activated_at da licença real — vencendo a ordenação por
 * "licença activa mais recente" usada por readFirstRunStatus/resolveLicenseTenantId.
 *
 * Fix: essa ordenação nunca deixa uma licença 'AUTO' vencer uma licença real
 * (license_key != 'AUTO'), e installOfflineLicenseState agora faz um
 * read-back atómico (mesma query) antes de marcar setup_completed — nunca
 * fica "activado" apontando para o tenant errado.
 *
 * Este teste reproduz o cenário completo e real: processo API spawnado (não
 * chamada directa de função), HTTP real, SQLCipher real, e um restart real
 * do processo apontado para a MESMA BD.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const licenseConsoleDir = path.join(repoRoot, 'license-console');

function genFixture(overrides = {}) {
  const result = spawnSync(
    process.execPath,
    ['--experimental-strip-types', path.join(licenseConsoleDir, 'scripts', 'gen-offline-license-fixture.mjs'), JSON.stringify(overrides)],
    { cwd: licenseConsoleDir, encoding: 'utf8' },
  );
  assert.equal(result.status, 0, `gerador de fixture falhou: ${result.stderr}`);
  return JSON.parse(result.stdout);
}

function waitForHttp(url, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  return (async () => {
    let lastErr = null;
    while (Date.now() < deadline) {
      try {
        return await fetch(url);
      } catch (err) {
        lastErr = err;
        await new Promise((r) => setTimeout(r, 200));
      }
    }
    throw lastErr || new Error('timeout à espera de ' + url);
  })();
}

function runServer(env, port) {
  let out = '';
  const child = spawn(process.execPath, [path.join(repoRoot, 'api', 'server.js')], {
    cwd: repoRoot,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (d) => (out += d.toString()));
  child.stderr.on('data', (d) => (out += d.toString()));
  const ready = waitForHttp(`http://127.0.0.1:${port}/setup/status`);
  return { child, ready, getLog: () => out };
}

test(
  'Offline License v2: tenant real sobrevive a um restart do processo API sobre BD SQLCipher (regressão Pilot Gate)',
  async () => {
    const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'posly-tenant-restart-'));
    const dbPath = path.join(userDataPath, 'data', 'database.db');
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });

    const devKey = genFixture();
    const REAL_TENANT_ID = 'tenant-restart-regressao';
    const envelope = genFixture({
      keyId: devKey.keyId,
      reuseKeyPair: { privateKeyPem: devKey.privateKeyPem, publicKeyPem: devKey.publicKeyPem },
      payload: {
        machine_id: 'machine-tenant-restart-regressao',
        tenant_id: REAL_TENANT_ID,
        license_id: 'license-tenant-restart-regressao',
        name: 'Loja Regressão Restart',
        nuit: '111222333',
        plan: 'LITE',
        commerce_type: 'retalho',
      },
    }).envelope;

    // Faixa 5300-5449 escolhida para nunca colidir com as faixas já usadas por
    // outros testes spawn-based (station-pairing-server 4700-4790, station-auth-server
    // 4800-4890, station-client-server 4900-4990, station-hardening-server 5000-5090,
    // station-tls 5200-5290, station-license-matrix 5700-5900) — o test runner corre
    // ficheiros de teste em paralelo, por isso uma colisão de porta aqui falha o boot
    // do servidor spawnado (nao e um bug na correcao em si).
    const port1 = 5300 + Math.floor(Math.random() * 150);
    const dbEncryptionKey = crypto.randomBytes(32).toString('hex');
    const baseEnv = {
      ...process.env,
      POS_DB_PATH: dbPath,
      POS_USER_DATA_PATH: userDataPath,
      NODE_ENV: 'test',
      POS_DEV_OFFLINE_LICENSE_KEY_ID: devKey.keyId,
      POS_DEV_OFFLINE_LICENSE_PUBLIC_KEY: devKey.publicKeyPem,
      // SQLCipher real — é isto que expõe a corrida de arranque (sempre activa em produção).
      POS_DB_ENCRYPTION: '1',
      POS_DB_ENCRYPTION_KEY: dbEncryptionKey,
    };
    delete baseEnv.DEFAULT_TENANT_ID;
    delete baseEnv.POS_DEV_TENANT;
    delete baseEnv.SUPABASE_SERVICE_ROLE_KEY;
    delete baseEnv.POS_LICENSE_HMAC_SECRET;
    delete baseEnv.LICENSE_HMAC_SECRET;

    try {
      const server1 = runServer({ ...baseEnv, POS_API_PORT: String(port1) }, port1);
      await server1.ready;
      await new Promise((r) => setTimeout(r, 400));

      const installRes = await fetch(`http://127.0.0.1:${port1}/setup/license/install-offline-license`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ offline_license: envelope, machine_id: 'machine-tenant-restart-regressao' }),
      });
      const installData = await installRes.json();
      assert.equal(installRes.status, 200, `instalação real via API falhou: ${JSON.stringify(installData)}`);

      const statusSameProcess = await (await fetch(`http://127.0.0.1:${port1}/setup/status`)).json();
      const dataSameProcess = statusSameProcess?.data ?? statusSameProcess;
      assert.equal(dataSameProcess.tenantId, REAL_TENANT_ID, 'mesmo processo: deve resolver o tenant real logo após instalar');
      assert.equal(dataSameProcess.tenantName, 'Loja Regressão Restart');

      server1.child.kill('SIGKILL');
      await new Promise((r) => setTimeout(r, 400));

      // "Fechar e reabrir": processo NOVO, porta nova, MESMA BD SQLCipher.
      const port2 = port1 + 1;
      const server2 = runServer({ ...baseEnv, POS_API_PORT: String(port2) }, port2);
      await server2.ready;
      await new Promise((r) => setTimeout(r, 400));

      const statusAfterRestart = await (await fetch(`http://127.0.0.1:${port2}/setup/status`)).json();
      const dataAfterRestart = statusAfterRestart?.data ?? statusAfterRestart;

      assert.equal(
        dataAfterRestart.tenantId,
        REAL_TENANT_ID,
        `REGRESSÃO: após restart o tenant resolvido foi "${dataAfterRestart.tenantId}" em vez do tenant real "${REAL_TENANT_ID}" — o fallback 'AUTO'/LOCAL venceu a licença real.`,
      );
      assert.equal(dataAfterRestart.tenantName, 'Loja Regressão Restart');
      assert.equal(dataAfterRestart.licenseActivated, true);
      assert.equal(dataAfterRestart.setupCompleted, true);

      server2.child.kill('SIGKILL');
    } finally {
      try {
        fs.rmSync(userDataPath, { recursive: true, force: true });
      } catch {
        // Windows pode manter um handle breve depois de matar o processo filho.
      }
    }
  },
);
