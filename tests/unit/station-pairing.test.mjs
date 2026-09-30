/**
 * Etapa 1G.3.2 - schema local de Stations + Station Pairing (servico, BD SQLite real temporaria, sem cloud).
 * A licenca e injectada como provider (a leitura real do ficheiro v2 e provada em offline-license-v2.test.mjs e no
 * E2E station-pairing-server.test.mjs).
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import express from 'express';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'posly-1g3-'));
process.env.POS_DB_PATH = path.join(tmpDir, 'database.db');
process.env.DEFAULT_TENANT_ID = 'tenant-1g3';

const db = (await import('../../api/database.js')).default;
const T = 'tenant-1g3';
const runDb = (s, p = []) => new Promise((res, rej) => db.run(s, p, (e) => (e ? rej(e) : res())));
const allDb = (s, p = []) => new Promise((res, rej) => db.all(s, p, (e, r) => (e ? rej(e) : res(r))));

// estado legado ANTES de o servico evoluir a tabela: posto antigo so com etiqueta
async function waitDb() {
  const deadline = Date.now() + 8000;
  for (;;) {
    try { await allDb('SELECT 1 FROM users LIMIT 1'); return; } catch (e) { if (Date.now() > deadline) throw e; await new Promise((r) => setTimeout(r, 100)); }
  }
}
await waitDb();
await runDb(`DROP TABLE IF EXISTS stations`);
await runDb(`CREATE TABLE stations (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, code TEXT NOT NULL, name TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'caixa', active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(tenant_id, code))`);
await runDb(`INSERT INTO stations (id, tenant_id, code, name, role, active, created_at, updated_at) VALUES ('legacy-1', ?, 'caixa-1', 'Caixa antiga', 'caixa', 1, datetime('now'), datetime('now'))`, [T]);

const svc = await import('../../api/services/station.service.js');
const pairing = await import('../../api/services/stationPairing.service.js');
const { default: stationsRouter } = await import('../../api/routes/stations.routes.js');

const admin = { id: 'admin-1', role: 'admin', access_level: 9, tenant_id: T };
const ent = (max) => ({ allowed: max === null || max > 0, reason: max === 0 ? 'STATION_LIMIT_ZERO' : 'OK', unlimited: max === null, max, storeId: 'store-A', licenseVersion: 2 });
const v1 = () => ({ allowed: false, reason: 'LICENSE_V1_NO_STATION_ENTITLEMENT', unlimited: false, max: 0, storeId: null, licenseVersion: 1 });
const invalid = () => ({ allowed: false, reason: 'LICENSE_INVALID', unlimited: false, max: 0, storeId: null, licenseVersion: null });
const newKey = () => crypto.generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'der' }).toString('base64url');
const mk = (max) => ({ entitlementProvider: () => (typeof max === 'function' ? max() : ent(max)) });
const pair = async (code, opts = {}) => pairing.consumePairing({ code, publicKey: opts.key ?? newKey(), machineId: 'pc-1', ip: opts.ip ?? '10.0.0.1', entitlementProvider: opts.entitlementProvider ?? (() => ent(3)) });
const create = (name, opts = {}) => pairing.createPairing({ name, role: 'caixa', actorUser: admin, entitlementProvider: opts.entitlementProvider ?? (() => ent(3)) });
const status = (p) => p.then(() => 'ok', (e) => `${e.status}:${e.code}`);
const active = async () => (await allDb(`SELECT COUNT(*) AS n FROM stations WHERE status='active' AND public_key IS NOT NULL`))[0].n;
const clearAll = async () => { await runDb(`DELETE FROM station_pairings`); await runDb(`DELETE FROM stations WHERE public_key IS NOT NULL`); pairing.resetPairingRateLimit(); };

test('legado: migracao preserva o posto antigo como etiqueta SEM identidade (status disabled, sem chave); reexecutar e idempotente', async () => {
  await svc.ensureStationTables();
  await svc.ensureStationTables();
  const list = await svc.listStations(admin);
  const legacy = list.find((s) => s.code === 'caixa-1');
  assert.deepEqual([legacy.name, legacy.status, legacy.has_identity, legacy.identity_valid, legacy.active], ['Caixa antiga', 'disabled', false, false, true]);
  assert.equal(await active(), 0, 'legado nao conta como Station');
  await assert.rejects(pairing.setStationStatus('legacy-1', 'active', { actorUser: admin, entitlementProvider: () => ent(3) }), /legado/);
});

test('pairing normal: codigo de 8 digitos, so o hash e guardado; a Station recebe UUID do servidor; id/codigo do cliente ignorados', async () => {
  const p = await create('Caixa 2');
  assert.match(p.code, /^\d{8}$/);
  const row = (await allDb(`SELECT * FROM station_pairings WHERE id = ?`, [p.pairing_id]))[0];
  assert.match(row.code_hash, /^[0-9a-f]{32}:[0-9a-f]{64}$/);
  assert.equal(JSON.stringify(row).includes(p.code), false, 'o codigo nunca e guardado em claro');
  assert.equal(row.attempts, 0);
  assert.equal(row.max_attempts, 5);
  assert.ok(Date.parse(row.expires_at) - Date.now() > 9 * 60 * 1000 && Date.parse(row.expires_at) - Date.now() <= 10 * 60 * 1000);
  const key = newKey();
  const r = await pairing.consumePairing({ code: p.code, publicKey: key, machineId: 'PC-LOJA-01', ip: '10.0.0.2', entitlementProvider: () => ent(3), station_id: 'forjado' });
  assert.match(r.station_id, /^[0-9a-f-]{36}$/);
  assert.notEqual(r.station_id, 'forjado');
  const st = (await svc.listStations(admin)).find((s) => s.id === r.station_id);
  assert.deepEqual([st.status, st.identity_valid, st.role, st.name, st.machine_id], ['active', true, 'caixa', 'Caixa 2', 'PC-LOJA-01']);
  const dbRow = (await allDb(`SELECT public_key, store_id, paired_at FROM stations WHERE id = ?`, [r.station_id]))[0];
  assert.equal(dbRow.public_key, key);
  assert.equal(dbRow.store_id, 'store-A');
  assert.ok(dbRow.paired_at);
  // uso unico
  assert.equal(await status(pair(p.code)), '401:INVALID_PAIRING');
  // nada de segredos nos logs/auditoria
  const logs = JSON.stringify([...(await allDb(`SELECT * FROM audit_logs`)), ...(await allDb(`SELECT * FROM app_logs`).catch(() => []))]);
  assert.equal(logs.includes(p.code), false, 'codigo nunca registado');
  assert.equal(logs.includes(row.code_hash.split(':')[1]), false, 'hash nunca registado');
  assert.equal(logs.includes(key), false);
});

test('codigo errado, expiracao e 5 tentativas: respostas genericas; esgotado nem o codigo certo funciona', async () => {
  await clearAll();
  const p = await create('Balcao');
  assert.equal(await status(pair('00000000' === p.code ? '11111111' : '00000000')), '401:INVALID_PAIRING');
  assert.equal((await allDb(`SELECT attempts FROM station_pairings WHERE id = ?`, [p.pairing_id]))[0].attempts, 1);
  for (let i = 0; i < 4; i += 1) await status(pair('12345678' === p.code ? '87654321' : '12345678'));
  assert.equal((await allDb(`SELECT attempts FROM station_pairings WHERE id = ?`, [p.pairing_id]))[0].attempts, 5);
  assert.equal(await status(pair(p.code)), '401:INVALID_PAIRING', 'tentativas esgotadas');
  assert.equal(await active(), 0);

  await clearAll();
  const q = await create('Expira');
  await runDb(`UPDATE station_pairings SET expires_at = ? WHERE id = ?`, [new Date(Date.now() - 1000).toISOString(), q.pairing_id]);
  assert.equal(await status(pair(q.code)), '401:INVALID_PAIRING', 'expirado');
  await clearAll();
  assert.equal(await status(pair('abc')), '400:INVALID_PAIRING_CODE_FORMAT');
});

test('rate limit por IP: excedido -> 429, IP diferente continua a poder tentar', async () => {
  await clearAll();
  const results = [];
  for (let i = 0; i < 12; i += 1) results.push(await status(pair('00000001', { ip: '10.9.9.9' })));
  assert.equal(results.filter((r) => r === '429:PAIRING_RATE_LIMITED').length, 2);
  assert.equal(await status(pair('00000001', { ip: '10.9.9.10' })), '401:INVALID_PAIRING');
});

test('consumo concorrente do MESMO codigo: exactamente 1 Station', async () => {
  await clearAll();
  const p = await create('Corrida');
  const res = await Promise.all(Array.from({ length: 6 }, (_, i) => status(pair(p.code, { ip: `10.1.0.${i}` }))));
  assert.equal(res.filter((r) => r === 'ok').length, 1, JSON.stringify(res));
  assert.equal(await active(), 1);
});

test('dois pairings a disputar o ULTIMO slot (max=1): so um vence; o perdedor nao fica queimado', async () => {
  await clearAll();
  const [a, b] = [await create('Slot A', { entitlementProvider: () => ent(1) }), await create('Slot B', { entitlementProvider: () => ent(1) })];
  const res = await Promise.all([pair(a.code, { ip: '10.2.0.1', entitlementProvider: () => ent(1) }), pair(b.code, { ip: '10.2.0.2', entitlementProvider: () => ent(1) })].map(status));
  assert.equal(res.filter((r) => r === 'ok').length, 1, JSON.stringify(res));
  assert.equal(await active(), 1);
  const loser = (await allDb(`SELECT used_at FROM station_pairings WHERE id IN (?, ?) AND used_at IS NULL`, [a.pairing_id, b.pairing_id]));
  assert.equal(loser.length, 1, 'o pairing perdedor continua utilizavel');
});

test('limites: v1 bloqueada; v2 max=0; max=1/2/3 contam so activas; null explicito = ilimitado; licenca invalida/expirada', async () => {
  await clearAll();
  await assert.rejects(create('V1', { entitlementProvider: v1 }), (e) => e.code === 'LICENSE_V1_NO_STATION_ENTITLEMENT' && e.status === 403);
  await assert.rejects(create('Zero', { entitlementProvider: () => ent(0) }), (e) => e.code === 'STATION_LIMIT_ZERO');
  await assert.rejects(create('Inv', { entitlementProvider: invalid }), (e) => e.code === 'LICENSE_INVALID');
  // pairing criado com licenca boa mas a licenca muda antes do consumo -> revalidada
  const p = await create('Muda');
  assert.equal(await status(pair(p.code, { entitlementProvider: v1 })), '403:LICENSE_V1_NO_STATION_ENTITLEMENT');
  assert.equal(await status(pair(p.code, { entitlementProvider: invalid })), '403:LICENSE_INVALID');
  assert.equal(await status(pair(p.code, { entitlementProvider: () => ent(0) })), '403:STATION_LIMIT_ZERO');
  assert.equal(await active(), 0);
  assert.equal(await status(pair(p.code)), 'ok', 'as falhas de licenca nao queimaram o pairing');

  for (const max of [1, 2, 3]) {
    await clearAll();
    const stations = [];
    for (let i = 0; i < max; i += 1) {
      const c = await create(`S${max}-${i}`, { entitlementProvider: () => ent(max) });
      const r = await pairing.consumePairing({ code: c.code, publicKey: newKey(), ip: '10.3.0.1', entitlementProvider: () => ent(max) });
      stations.push(r.station_id);
    }
    assert.equal(await active(), max);
    await assert.rejects(create('extra', { entitlementProvider: () => ent(max) }), (e) => e.code === 'STATION_LIMIT_REACHED');
    // desactivar liberta um slot; reactivar respeita o limite
    await pairing.setStationStatus(stations[0], 'disabled', { actorUser: admin });
    assert.equal(await active(), max - 1);
    const c = await create('depois', { entitlementProvider: () => ent(max) });
    await pairing.consumePairing({ code: c.code, publicKey: newKey(), ip: '10.3.0.2', entitlementProvider: () => ent(max) });
    await assert.rejects(pairing.setStationStatus(stations[0], 'active', { actorUser: admin, entitlementProvider: () => ent(max) }), (e) => e.code === 'STATION_LIMIT_REACHED');
    await pairing.setStationStatus(stations[1 % stations.length], 'revoked', { actorUser: admin });
    if (max > 1) await pairing.setStationStatus(stations[0], 'active', { actorUser: admin, entitlementProvider: () => ent(max) });
    await assert.rejects(pairing.setStationStatus(stations[1 % stations.length], 'active', { actorUser: admin, entitlementProvider: () => ent(max) }), (e) => e.code === 'STATION_REVOKED');
  }
  await clearAll();
  for (let i = 0; i < 6; i += 1) {
    const c = await create(`Ilim${i}`, { entitlementProvider: () => ent(null) });
    await pairing.consumePairing({ code: c.code, publicKey: newKey(), ip: '10.4.0.1', entitlementProvider: () => ent(null) });
  }
  assert.equal(await active(), 6, 'null assinado = sem limite');
});

test('chave publica: invalida/RSA/privada recusadas; duplicada activa -> 409 sem queimar; revogada NAO volta a emparelhar', async () => {
  await clearAll();
  const p = await create('Chaves');
  const rsa = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).publicKey.export({ type: 'spki', format: 'der' }).toString('base64url');
  const edPriv = crypto.generateKeyPairSync('ed25519').privateKey;
  const privPem = edPriv.export({ type: 'pkcs8', format: 'pem' });
  const privDer = edPriv.export({ type: 'pkcs8', format: 'der' }).toString('base64url');
  for (const bad of ['', 'nao-e-chave', rsa, privPem, privDer, 'A'.repeat(5000)]) {
    assert.equal(await status(pair(p.code, { key: bad })), '400:INVALID_PUBLIC_KEY');
  }
  assert.equal((await allDb(`SELECT used_at FROM station_pairings WHERE id = ?`, [p.pairing_id]))[0].used_at, null, 'chave invalida nao queima o pairing');
  const pem = crypto.generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'pem' });
  const key = newKey();
  const r1 = await pair(p.code, { key });
  const p2 = await create('Clone');
  assert.equal(await status(pair(p2.code, { key })), '409:PUBLIC_KEY_IN_USE');
  assert.equal((await allDb(`SELECT used_at FROM station_pairings WHERE id = ?`, [p2.pairing_id]))[0].used_at, null);
  await pairing.setStationStatus(r1.station_id, 'revoked', { actorUser: admin });
  assert.equal(await status(pair(p2.code, { key })), '409:PUBLIC_KEY_RETIRED', 'chave revogada nunca volta a emparelhar (1G.3.5)');
  assert.equal((await allDb(`SELECT used_at FROM station_pairings WHERE id = ?`, [p2.pairing_id]))[0].used_at, null);
  assert.equal(await status(pair(p2.code)), 'ok', 'nova identidade (nova chave) emparelha');
  pairing.resetPairingRateLimit();
  const p3 = await create('Pem');
  assert.equal(await status(pair(p3.code, { key: pem })), 'ok', 'PEM SPKI publica aceite');
});

test('admin: nao-admin nao cria pairing, nao cria/apaga postos; Station com identidade nao se apaga; legado apaga-se; nada cria Station autenticada sem pairing', async () => {
  await clearAll();
  let current = { id: 'op-1', role: 'caixa', access_level: 1, tenant_id: T };
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = current; next(); });
  app.use(stationsRouter);
  const server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, url, body) => {
    const res = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, body: await res.json().catch(() => ({})) };
  };
  try {
    assert.equal((await call('POST', '/stations/pairings', { name: 'X', role: 'caixa' })).status, 403);
    assert.equal((await call('POST', '/stations', { code: 'forjado', name: 'Forjado', role: 'caixa' })).status, 403);
    assert.equal((await call('DELETE', '/stations/caixa-1')).status, 403);
    assert.equal((await call('POST', '/stations/legacy-1/status', { status: 'active' })).status, 403);
    current = admin;
    const created = await call('POST', '/stations', { code: 'etiqueta-2', name: 'Etiqueta', role: 'garcom', active: true, status: 'active', public_key: newKey() });
    assert.equal(created.status, 200);
    const row = (await allDb(`SELECT status, public_key FROM stations WHERE code = 'etiqueta-2'`))[0];
    assert.deepEqual([row.status, row.public_key], ['disabled', null], 'endpoint legado nunca cria identidade');
    assert.equal((await call('DELETE', '/stations/etiqueta-2')).status, 200);
    const p = await pairing.createPairing({ name: 'Identidade', role: 'caixa', actorUser: admin, entitlementProvider: () => ent(3) });
    const r = await pair(p.code);
    const code = (await allDb(`SELECT code FROM stations WHERE id = ?`, [r.station_id]))[0].code;
    assert.equal((await call('DELETE', `/stations/${code}`)).status, 409, 'com identidade: revogar, nao apagar');
    // upsert por codigo nao altera a identidade nem o estado
    await call('POST', '/stations', { code, name: 'Renomeada', role: 'caixa', active: false });
    const after = (await allDb(`SELECT status, public_key, name FROM stations WHERE id = ?`, [r.station_id]))[0];
    assert.deepEqual([after.status, !!after.public_key, after.name], ['active', true, 'Renomeada']);
  } finally {
    server.close();
  }
});
