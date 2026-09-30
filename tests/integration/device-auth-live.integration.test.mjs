/**
 * Integração REAL (Etapa 1F.1, instrução #16) — o electron/deviceAuth/deviceAuthClient.js
 * REAL a falar HTTP com um license-console real (`next dev`) ligado a um Postgres
 * real (supabase/, Docker). Não é simulado/mockado no nível de rede.
 *
 * Pré-condições (preparadas manualmente antes de correr este ficheiro, nunca
 * automatizadas aqui — script de teste não deve gerir infraestrutura):
 *   1. `npx supabase --workdir supabase/ db reset`
 *   2. license-console a correr em :3999 com .env.local temporário
 *      (SUPABASE_URL/SERVICE_ROLE_KEY do baseline + POS_DEVICE_JWT_* + LICENSE_ISSUER_ADMIN_TOKEN)
 *   3. Um tenant + license + activation_token reais criados via
 *      POST /api/license-issuer/{tenants,licenses,device/activation-tokens}
 *
 * Corre com: node --experimental-test-module-mocks --test tests/integration/device-auth-live.integration.test.mjs
 * Requer env: POSLY_1F1_ISSUER_URL, POSLY_1F1_ACTIVATION_TOKEN, POSLY_1F1_ADMIN_TOKEN,
 *             POSLY_1F1_LICENSE_ID, POSLY_1F1_TENANT_ID, POSLY_1F1_STORE_ID
 * Se em falta, os testes são saltados (skip) — nunca falham a correr no CI normal.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, mock } from 'node:test';

const ISSUER_URL = process.env.POSLY_1F1_ISSUER_URL || '';
const ACTIVATION_TOKEN = process.env.POSLY_1F1_ACTIVATION_TOKEN || '';
const ADMIN_TOKEN = process.env.POSLY_1F1_ADMIN_TOKEN || '';
const LICENSE_ID = process.env.POSLY_1F1_LICENSE_ID || '';
const TENANT_ID = process.env.POSLY_1F1_TENANT_ID || '';
const STORE_ID = process.env.POSLY_1F1_STORE_ID || '';
const shouldRun = Boolean(ISSUER_URL && ACTIVATION_TOKEN && ADMIN_TOKEN);

// safeStorage real do Electron não corre em `node --test` — mock mínimo,
// suficiente para provar round-trip real (o comportamento de encriptação em
// si já está coberto contra o Electron real nos testes unitários existentes,
// db-encryption.test.mjs, e é o MESMO padrão aqui).
mock.module('electron', {
  exports: {
    safeStorage: {
      isEncryptionAvailable: () => true,
      encryptString: (s) => Buffer.concat([Buffer.from('FAKEENC:'), Buffer.from(s, 'utf8')]),
      decryptString: (b) => Buffer.from(b).subarray(8).toString('utf8'),
    },
  },
});

const { bootstrapDevice, refreshAccessToken, getDeviceIdentity } = await import(
  '../../electron/deviceAuth/deviceAuthClient.js'
);

function decodeJwtPayload(jwt) {
  const parts = String(jwt).split('.');
  assert.equal(parts.length, 3, 'access token deve ser um JWT de 3 partes');
  const payload = Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
  return JSON.parse(payload);
}

async function adminFetch(pathSuffix, body, method = 'POST') {
  const res = await fetch(`${ISSUER_URL}${pathSuffix}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ADMIN_TOKEN}` },
    body: JSON.stringify(body),
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

test(
  'DeviceAuthClient real: bootstrap contra license-console+Postgres reais devolve JWT com claims correctas',
  { skip: !shouldRun && 'defina POSLY_1F1_ISSUER_URL / POSLY_1F1_ACTIVATION_TOKEN / POSLY_1F1_ADMIN_TOKEN para correr' },
  async () => {
    const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'posly-1f1-live-'));

    const result = await bootstrapDevice({
      activationToken: ACTIVATION_TOKEN,
      machineId: 'machine-1f1-live-test',
      stationCode: 'CAIXA-1',
      userDataPath,
      issuerBaseUrl: ISSUER_URL,
    });

    assert.equal(result.ok, true, `bootstrap real falhou: ${JSON.stringify(result)}`);
    assert.ok(result.deviceId);
    assert.ok(result.accessToken);

    const claims = decodeJwtPayload(result.accessToken);
    assert.equal(claims.role, 'authenticated');
    assert.equal(claims.tenant_id, TENANT_ID);
    assert.equal(claims.device_id, result.deviceId);
    assert.equal(claims.license_id, LICENSE_ID);
    assert.equal(claims.token_version, 1);
    assert.equal(claims.app_role, undefined, 'nunca deve existir app_role — identidade de device != autoridade humana');
    assert.equal(claims.role !== 'admin' && claims.role !== 'cashier' && claims.role !== 'manager', true);

    const identity = getDeviceIdentity({ userDataPath });
    assert.equal(identity.hasCredentials, true);
    assert.equal(identity.deviceId, result.deviceId);

    // Refresh real: prova rotação ponta-a-ponta contra a RPC real
    // rotate_pos_device_refresh_token (Etapa 1E) — não simulada.
    const refreshed = await refreshAccessToken({ userDataPath, issuerBaseUrl: ISSUER_URL });
    assert.equal(refreshed.ok, true, `refresh real falhou: ${JSON.stringify(refreshed)}`);
    assert.equal(refreshed.deviceId, result.deviceId, 'mesma identidade de dispositivo após refresh real');
    assert.notEqual(refreshed.accessToken, result.accessToken, 'access token deve ser novo após refresh');

    const claims2 = decodeJwtPayload(refreshed.accessToken);
    assert.equal(claims2.device_id, result.deviceId);
    assert.equal(claims2.tenant_id, TENANT_ID);

    // "Restart": ler do disco como um novo processo Electron faria — a
    // identidade sobrevive sem depender de nada em memória.
    const identityAfterRestart = getDeviceIdentity({ userDataPath });
    assert.equal(identityAfterRestart.deviceId, result.deviceId);

    fs.rmSync(userDataPath, { recursive: true, force: true });
  },
);

test(
  'DeviceAuthClient real: licença suspensa no servidor real — refresh falha mas credencial local sobrevive',
  { skip: !shouldRun && 'defina env de integração' },
  async () => {
    const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'posly-1f1-live-'));
    // Precisa de um bootstrap novo (activation token de cima já foi consumido) —
    // pedir um novo token real ao admin e activar antes de suspender a licença.
    const actRes = await adminFetch('/api/license-issuer/device/activation-tokens', {
      tenant_id: TENANT_ID,
      license_id: LICENSE_ID,
      store_id: STORE_ID,
    });
    assert.equal(actRes.status, 200, JSON.stringify(actRes));

    const boot = await bootstrapDevice({
      activationToken: actRes.data.activation_token,
      machineId: 'machine-1f1-live-test-2',
      userDataPath,
      issuerBaseUrl: ISSUER_URL,
    });
    assert.equal(boot.ok, true, JSON.stringify(boot));

    const suspend = await adminFetch('/api/license-issuer/licenses', {
      license_id: LICENSE_ID,
      status: 'suspended',
      reason: 'teste real 1F.1',
    }, 'PATCH');
    assert.equal(suspend.status, 200, JSON.stringify(suspend));

    const refreshed = await refreshAccessToken({ userDataPath, issuerBaseUrl: ISSUER_URL });
    assert.equal(refreshed.ok, false);
    assert.equal(refreshed.kind, 'LICENSE_OR_TENANT_SUSPENDED');

    const identity = getDeviceIdentity({ userDataPath });
    assert.equal(identity.hasCredentials, true, 'credencial local NUNCA deve ser apagada por suspensão — pode reactivar');

    // Reverter para não afectar outros testes que reusem a mesma licença.
    await adminFetch('/api/license-issuer/licenses', { license_id: LICENSE_ID, status: 'active' }, 'PATCH');

    fs.rmSync(userDataPath, { recursive: true, force: true });
  },
);
