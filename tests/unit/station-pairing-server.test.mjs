/**
 * Etapa 1G.3.2 - E2E do Store Server REAL (api/server.js spawnado, SQLite real, SEM Internet/cloud/service_role):
 * licenca offline v2 real (signer do license-console) -> pairing admin -> POST publico /station/pair -> restart preserva.
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { getLocalMachineId } from '../../lib/licensing/localMachineId.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const lcDir = path.join(repoRoot, 'license-console');
const fixtureScript = path.join(lcDir, 'scripts', 'gen-offline-license-fixture.mjs');
const TENANT = 'tenant-e2e-pairing';
const MACHINE = getLocalMachineId();

function gen(overrides) {
  const r = spawnSync(process.execPath, ['--experimental-strip-types', fixtureScript, JSON.stringify(overrides)], { cwd: lcDir, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'posly-pair-e2e-'));
const userData = path.join(tmp, 'userData');
fs.mkdirSync(userData, { recursive: true });
const licPath = path.join(userData, 'offline-license.json');
const base = { license_id: 'lic-e2e', tenant_id: TENANT, machine_id: MACHINE, name: 'Loja E2E' };
const v2 = gen({ v2: true, payload: { ...base, store_id: 'store-e2e', max_stations_per_store: 2 } });
const resolveEnv = { POS_DEV_OFFLINE_LICENSE_KEY_ID: v2.keyId, POS_DEV_OFFLINE_LICENSE_PUBLIC_KEY: v2.publicKeyPem };
const port = 4700 + Math.floor(Math.random() * 90);

function spawnServer() {
  const env = {
    ...process.env, POS_API_PORT: String(port), NODE_ENV: 'development', POS_DB_PATH: path.join(tmp, 'database.db'),
    POS_USER_DATA_PATH: userData, DEFAULT_TENANT_ID: TENANT, ...resolveEnv,
  };
  for (const k of ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'POS_DEVICE_AUTH_BRIDGE_URL', 'POS_LICENSE_HMAC_SECRET']) delete env[k];
  const child = spawn(process.execPath, [path.join(repoRoot, 'api', 'server.js')], { cwd: repoRoot, env, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', () => {});
  child.stderr.on('data', () => {});
  return child;
}
async function waitUp() {
  const deadline = Date.now() + 30000;
  for (;;) {
    try { if ((await fetch(`http://127.0.0.1:${port}/health`)).ok) return; } catch { /* ainda a arrancar */ }
    if (Date.now() > deadline) throw new Error('servidor nao arrancou');
    await new Promise((r) => setTimeout(r, 250));
  }
}
const ADMIN = JSON.stringify({ id: 'admin-local', role: 'admin', tenant_id: TENANT });
async function api(method, url, { body, admin = false } = {}) {
  const res = await fetch(`http://127.0.0.1:${port}${url}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(admin ? { 'x-auth-user': ADMIN } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: (await res.json().catch(() => ({}))).data ?? null, raw: null };
}
const newKey = () => crypto.generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'der' }).toString('base64url');

test('Store Server real, offline: licenca v2 -> pairing admin -> /station/pair publico -> limite -> restart preserva -> v1/expirada bloqueiam', async () => {
  fs.writeFileSync(licPath, JSON.stringify(v2.envelope));
  let child = spawnServer();
  try {
    await waitUp();
    const inst = await api('POST', '/setup/license/install-offline-license', { body: { offline_license: v2.envelope, machine_id: MACHINE } });
    assert.equal(inst.status, 200);

    // sem admin: nada de pairing
    assert.ok([401, 403].includes((await api('POST', '/stations/pairings', { body: { name: 'Caixa 2', role: 'caixa' } })).status));

    const p = await api('POST', '/stations/pairings', { admin: true, body: { name: 'Caixa 2', role: 'caixa' } });
    assert.equal(p.status, 201, JSON.stringify(p));
    assert.match(p.data.code, /^\d{8}$/);

    // POST publico (sem sessao/Bearer/X-Station-Code): consome
    const r = await api('POST', '/station/pair', { body: { code: p.data.code, public_key: newKey(), machine_id: 'PC-2' } });
    assert.equal(r.status, 201, JSON.stringify(r));
    assert.match(r.data.station_id, /^[0-9a-f-]{36}$/);
    assert.equal((await api('POST', '/station/pair', { body: { code: p.data.code, public_key: newKey() } })).status, 401, 'uso unico');
    assert.equal((await api('POST', '/station/pair', { body: { code: '12345678', public_key: 'lixo' } })).status, 400);

    const list = (await api('GET', '/stations', { admin: true })).data;
    const st = list.find((s) => s.id === r.data.station_id);
    assert.deepEqual([st.status, st.identity_valid, st.has_identity], ['active', true, true]);

    // limite 2: segunda cabe, terceira nao
    const p2 = await api('POST', '/stations/pairings', { admin: true, body: { name: 'Cozinha', role: 'cozinha' } });
    assert.equal((await api('POST', '/station/pair', { body: { code: p2.data.code, public_key: newKey() } })).status, 201);
    const p3 = await api('POST', '/stations/pairings', { admin: true, body: { name: 'Extra', role: 'caixa' } });
    assert.equal(p3.status, 403);
    assert.equal(p3.data, null);

    // restart: Stations preservadas
    child.kill();
    await new Promise((r2) => child.once('exit', r2));
    child = spawnServer();
    await waitUp();
    const after = (await api('GET', '/stations', { admin: true })).data;
    assert.equal(after.filter((s) => s.identity_valid).length, 2);
    assert.ok(after.find((s) => s.id === r.data.station_id && s.paired_at));

    // licenca v1 (ficheiro trocado) e licenca v2 expirada: pairing indisponivel; o resto do servidor continua a funcionar
    const v1 = gen({ payload: { ...base }, keyId: v2.keyId, reuseKeyPair: { privateKeyPem: v2.privateKeyPem, publicKeyPem: v2.publicKeyPem } });
    fs.writeFileSync(licPath, JSON.stringify(v1.envelope));
    assert.equal((await api('POST', '/stations/pairings', { admin: true, body: { name: 'V1', role: 'caixa' } })).status, 403);
    const expired = gen({ v2: true, keyId: v2.keyId, reuseKeyPair: { privateKeyPem: v2.privateKeyPem, publicKeyPem: v2.publicKeyPem }, payload: { ...base, store_id: 'store-e2e', max_stations_per_store: null, expires_at: new Date(Date.now() - 1000).toISOString() } });
    fs.writeFileSync(licPath, JSON.stringify(expired.envelope));
    assert.equal((await api('POST', '/stations/pairings', { admin: true, body: { name: 'Exp', role: 'caixa' } })).status, 403);
    assert.equal((await api('GET', '/stations', { admin: true })).status, 200);
  } finally {
    child.kill();
  }
});
