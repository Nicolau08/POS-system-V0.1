/**
 * Etapa 1G.3.3 - authenticateStation + Request Signing v1 + anti-replay. Middleware REAL (api/middlewares/stationAuth.js)
 * montado num express com o MESMO express.json({verify}) do servidor, BD SQLite real temporaria, Stations criadas
 * pelo pairing real. Sem cloud/Internet.
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import express from 'express';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'posly-1g33-'));
process.env.POS_DB_PATH = path.join(tmpDir, 'database.db');
process.env.DEFAULT_TENANT_ID = 'tenant-1g33';

const db = (await import('../../api/database.js')).default;
const svc = await import('../../api/services/station.service.js');
const pairing = await import('../../api/services/stationPairing.service.js');
const { createStationGate, cleanupStationNonces, isLoopbackSocket } = await import('../../api/middlewares/stationAuth.js');
const { signStationRequest, buildCanonicalRequest } = await import('../../lib/stationAuth/stationRequestSigning.js');

const T = 'tenant-1g33';
const runDb = (s, p = []) => new Promise((res, rej) => db.run(s, p, (e) => (e ? rej(e) : res())));
const allDb = (s, p = []) => new Promise((res, rej) => db.all(s, p, (e, r) => (e ? rej(e) : res(r))));
const admin = { id: 'a', role: 'admin', access_level: 9, tenant_id: T };
const ent = () => ({ allowed: true, reason: 'OK', unlimited: true, max: null, storeId: 'store-A', licenseVersion: 2 });

let clock = Date.now();
const gate = createStationGate({ isLoopbackRequest: () => false, now: () => clock });
const loopGate = createStationGate({ isLoopbackRequest: () => true, now: () => clock });

function makeApp(g) {
  const app = express();
  app.use(express.json({ verify: (req, _res, buf) => { req.rawBody = Buffer.from(buf); } }));
  app.use(g);
  app.post('/station/pair', (_req, res) => res.json({ pair: true }));
  app.all('/echo', (req, res) => res.json({ station: req.station ?? null, origin: req.stationOrigin, body: req.body ?? null, query: req.query }));
  return app;
}
const listen = (app) => new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });

async function newStation(name, role = 'caixa') {
  const p = await pairing.createPairing({ name, role, actorUser: admin, entitlementProvider: ent });
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const r = await pairing.consumePairing({ code: p.code, publicKey: publicKey.export({ type: 'spki', format: 'der' }).toString('base64url'), ip: `10.0.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`, entitlementProvider: ent });
  return { id: r.station_id, code: r.code, privateKey };
}

let server, base, A, B;
async function call(method, target, { station = A, body, headers = {}, authorization, sign = {}, signedBody, signedMethod, signedTarget, signedAuthorization, ts, nonce } = {}) {
  const raw = body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body);
  const sigHeaders = station
    ? signStationRequest({
        privateKey: station.privateKey, stationId: sign.stationId ?? station.id, method: signedMethod ?? method, target: signedTarget ?? target,
        body: signedBody !== undefined ? Buffer.from(signedBody) : raw === undefined ? Buffer.alloc(0) : Buffer.from(raw),
        authorization: signedAuthorization ?? authorization ?? '', timestamp: ts ?? Math.floor(clock / 1000), ...(nonce ? { nonce } : {}),
      })
    : {};
  const res = await fetch(base + target, {
    method,
    headers: { ...(raw !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(authorization ? { Authorization: authorization } : {}), ...sigHeaders, ...headers },
    body: raw,
  });
  return { status: res.status, json: await res.json().catch(() => ({})), signed: sigHeaders };
}

test('setup: duas Stations emparelhadas (A caixa, B garcom)', async () => {
  await svc.ensureStationTables();
  A = await newStation('Caixa A', 'caixa');
  B = await newStation('Garcom B', 'garcom');
  server = await listen(makeApp(gate));
  base = `http://127.0.0.1:${server.address().port}`;
});

test('assinatura valida: req.station vem da BD (id/code/role); GET com query, POST com corpo e com Authorization', async () => {
  const r = await call('GET', '/echo?b=2&a=1&a=0');
  assert.equal(r.status, 200);
  assert.deepEqual([r.json.data?.station ?? r.json.station].map((s) => [s.id, s.code, s.role])[0], [A.id, A.code, 'caixa']);
  assert.equal((await call('POST', '/echo', { body: { x: 1 }, authorization: 'Bearer abc.123.def' })).status, 200);
  assert.equal((await call('POST', '/echo', { body: '{ "espacos":   1 }' })).status, 200, 'corpo assinado byte-a-byte, incluindo espacamento');
});

test('X-Station-Code / X-Station-Role / X-Station-Store forjados nao alteram a identidade nem o papel', async () => {
  const r = await call('GET', '/echo', { headers: { 'X-Station-Code': B.code, 'X-Station-Role': 'admin', 'X-Station-Name': 'root' } });
  assert.equal(r.status, 200);
  const s = r.json.station;
  assert.deepEqual([s.id, s.code, s.role], [A.id, A.code, 'caixa']);
  // sem assinatura os headers de etiqueta nao chegam a lado nenhum
  const noSig = await call('GET', '/echo', { station: null, headers: { 'X-Station-Code': A.code, 'X-Station-Role': 'admin' } });
  assert.equal(noSig.status, 401);
  assert.equal(noSig.json.error?.code ?? noSig.json.code, 'STATION_AUTH_REQUIRED');
});

test('assinatura invalida / Station inexistente / cabecalhos mal formados: 401 generico', async () => {
  const good = await call('GET', '/echo');
  const flip = { ...good.signed, 'X-Station-Signature': good.signed['X-Station-Signature'].replace(/^./, (c) => (c === 'A' ? 'B' : 'A')) };
  const r1 = await fetch(base + '/echo', { headers: flip });
  assert.equal(r1.status, 401);
  const ghost = { id: crypto.randomUUID(), privateKey: crypto.generateKeyPairSync('ed25519').privateKey };
  assert.equal((await call('GET', '/echo', { station: ghost })).status, 401);
  // assinada por outra chave mas com o id da A
  const rogue = { id: A.id, privateKey: crypto.generateKeyPairSync('ed25519').privateKey };
  assert.equal((await call('GET', '/echo', { station: rogue })).status, 401);
  for (const bad of [{ 'X-Station-Auth-Version': '2' }, { 'X-Station-Nonce': 'curto' }, { 'X-Station-Timestamp': 'abc' }, { 'X-Station-Id': 'nao-uuid' }]) {
    assert.equal((await fetch(base + '/echo', { headers: { ...good.signed, ...bad } })).status, 401);
  }
});

test('adulteracao: metodo, path, query, corpo (bytes), Authorization; assinatura da Station A nao serve como B', async () => {
  assert.equal((await call('POST', '/echo', { body: { x: 1 }, signedMethod: 'PUT' })).status, 401, 'metodo');
  assert.equal((await call('GET', '/echo', { signedTarget: '/echo/' })).status, 401, 'path (barra final)');
  assert.equal((await call('GET', '/echo?a=1', { signedTarget: '/echo?a=2' })).status, 401, 'query valor');
  assert.equal((await call('GET', '/echo?a=1&b=2', { signedTarget: '/echo?b=2&a=1' })).status, 401, 'query reordenada (ordem exacta)');
  assert.equal((await call('POST', '/echo', { body: { x: 1 }, signedBody: '{"x":2}' })).status, 401, 'corpo');
  assert.equal((await call('POST', '/echo', { body: '{"x":1}', signedBody: '{ "x":1 }' })).status, 401, 'mesmo JSON, bytes diferentes');
  assert.equal((await call('GET', '/echo', { authorization: 'Bearer B', signedAuthorization: 'Bearer A' })).status, 401, 'outro Bearer');
  assert.equal((await call('GET', '/echo', { signedAuthorization: 'Bearer A' })).status, 401, 'Bearer acrescentado depois');
  const good = await call('GET', '/echo');
  const asB = await fetch(base + '/echo', { headers: { ...good.signed, 'X-Station-Id': B.id } });
  assert.equal(asB.status, 401, 'assinatura de A com o id de B');
  const asA2 = await fetch(base + '/echo', { headers: { ...(await call('GET', '/echo', { station: B })).signed, 'X-Station-Id': A.id } });
  assert.equal(asA2.status, 401);
});

test('timestamp: velho e futuro -> 401 STATION_CLOCK_SKEW com server_time; dentro da janela ok', async () => {
  const nowS = Math.floor(clock / 1000);
  for (const ts of [nowS - 121, nowS + 121, nowS - 3600]) {
    const r = await call('GET', '/echo', { ts });
    assert.equal(r.status, 401);
    const err = r.json.error?.code ? r.json.error : r.json;
    assert.equal(err.code ?? r.json.code, 'STATION_CLOCK_SKEW');
    assert.equal(Number((r.json.data ?? r.json.error?.data ?? {}).server_time), nowS);
  }
  assert.equal((await call('GET', '/echo', { ts: nowS - 119 })).status, 200);
  assert.equal((await call('GET', '/echo', { ts: nowS + 119 })).status, 200);
});

test('anti-replay: mesmo pedido repetido = 401; concorrentes com o mesmo nonce = exactamente 1; nonces diferentes = todos; nonce scoped por Station', async () => {
  const nonce = crypto.randomBytes(18).toString('base64url');
  assert.equal((await call('GET', '/echo?r=1', { nonce })).status, 200);
  assert.equal((await call('GET', '/echo?r=1', { nonce })).status, 401, 'replay');
  const n2 = crypto.randomBytes(18).toString('base64url');
  const res = await Promise.all(Array.from({ length: 8 }, () => call('GET', '/echo?c=1', { nonce: n2 })));
  assert.equal(res.filter((x) => x.status === 200).length, 1, JSON.stringify(res.map((x) => x.status)));
  const many = await Promise.all(Array.from({ length: 8 }, () => call('GET', '/echo?d=1')));
  assert.ok(many.every((x) => x.status === 200));
  // o mesmo valor de nonce noutra Station e independente
  const shared = crypto.randomBytes(18).toString('base64url');
  assert.equal((await call('GET', '/echo?s=1', { station: A, nonce: shared })).status, 200);
  assert.equal((await call('GET', '/echo?s=1', { station: B, nonce: shared })).status, 200);
});

test('restart do Server: replay recente continua rejeitado (nonces persistidos); cleanup remove so os expirados e a tabela nao cresce', async () => {
  const nonce = crypto.randomBytes(18).toString('base64url');
  assert.equal((await call('GET', '/echo?p=1', { nonce })).status, 200);
  const server2 = await listen(makeApp(createStationGate({ isLoopbackRequest: () => false, now: () => clock }))); // "novo processo"
  const oldBase = base;
  base = `http://127.0.0.1:${server2.address().port}`;
  try {
    assert.equal((await call('GET', '/echo?p=1', { nonce })).status, 401);
  } finally {
    base = oldBase;
    server2.close();
  }
  const before = (await allDb(`SELECT COUNT(*) AS n FROM station_nonces`))[0].n;
  assert.ok(before > 0);
  const nowS = Math.floor(clock / 1000);
  await runDb(`INSERT INTO station_nonces (station_id, nonce, expires_at) VALUES (?, 'velho-1', ?), (?, 'velho-2', ?)`, [A.id, nowS - 10, B.id, nowS - 1]);
  assert.equal(await cleanupStationNonces(nowS), 2);
  assert.equal((await allDb(`SELECT COUNT(*) AS n FROM station_nonces`))[0].n, before);
  // avancando o relogio para depois da janela, todos expiram
  const removed = await cleanupStationNonces(nowS + 250);
  assert.equal(removed, before);
  assert.equal((await allDb(`SELECT COUNT(*) AS n FROM station_nonces`))[0].n, 0);
});

test('revogacao imediata: disabled/revoked falham no pedido seguinte; reactivar volta a funcionar; legado sem chave nunca autentica', async () => {
  const C = await newStation('Temp C');
  assert.equal((await call('GET', '/echo', { station: C })).status, 200);
  await pairing.setStationStatus(C.id, 'disabled', { actorUser: admin });
  assert.equal((await call('GET', '/echo', { station: C })).status, 401);
  await pairing.setStationStatus(C.id, 'active', { actorUser: admin, entitlementProvider: ent });
  assert.equal((await call('GET', '/echo', { station: C })).status, 200);
  await pairing.setStationStatus(C.id, 'revoked', { actorUser: admin });
  assert.equal((await call('GET', '/echo', { station: C })).status, 401);
  await runDb(`INSERT INTO stations (id, tenant_id, code, name, role, active, created_at, updated_at) VALUES (?, ?, 'legado-x', 'Legado', 'caixa', 1, datetime('now'), datetime('now'))`, [crypto.randomUUID(), T]);
  const leg = (await allDb(`SELECT id FROM stations WHERE code = 'legado-x'`))[0].id;
  assert.equal((await call('GET', '/echo', { station: { id: leg, privateKey: crypto.generateKeyPairSync('ed25519').privateKey } })).status, 401);
});

test('last_seen: so depois de autenticar, e com throttle (1x/min)', async () => {
  const D = await newStation('Vista D');
  const seen = async () => (await allDb(`SELECT last_seen FROM stations WHERE id = ?`, [D.id]))[0].last_seen;
  assert.equal(await seen(), null);
  await call('GET', '/echo', { station: D, ts: Math.floor(clock / 1000), nonce: crypto.randomBytes(18).toString('base64url'), signedTarget: '/echo?x=1' }); // assinatura invalida -> nao actualiza
  assert.equal(await seen(), null, 'pedido nao autenticado nao escreve last_seen');
  assert.equal((await call('GET', '/echo', { station: D })).status, 200);
  await new Promise((r) => setTimeout(r, 50));
  const first = await seen();
  assert.ok(first);
  clock += 10_000;
  await call('GET', '/echo', { station: D });
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(await seen(), first, 'dentro de 60 s nao volta a escrever');
  clock += 61_000;
  await call('GET', '/echo', { station: D });
  await new Promise((r) => setTimeout(r, 50));
  assert.notEqual(await seen(), first);
});

test('publico e loopback: /station/pair sem Station passa; loopback mantem bypass explicito; corpo nao-JSON assinado falha fechado', async () => {
  const pairRes = await fetch(base + '/station/pair', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(pairRes.status, 200);
  assert.equal((await fetch(base + '/echo')).status, 401);
  const s2 = await listen(makeApp(loopGate));
  try {
    const r = await (await fetch(`http://127.0.0.1:${s2.address().port}/echo`)).json();
    assert.deepEqual([r.origin, r.station], ['loopback', null]);
  } finally { s2.close(); }
  const good = await call('POST', '/echo', { body: 'texto simples', headers: { 'Content-Type': 'text/plain' } });
  assert.equal(good.status, 400, 'corpo que o parser JSON nao capta: sem corpo bruto -> recusa (nunca hash reconstruido)');
});

test('origem local so pelo socket: X-Forwarded-For/Forwarded/Host/TRUST_PROXY nunca tornam remoto em loopback', () => {
  const remote = (headers) => ({ socket: { remoteAddress: '::ffff:192.168.1.50' }, headers });
  for (const env of ['false', 'true']) {
    process.env.TRUST_PROXY = env;
    assert.equal(isLoopbackSocket(remote({ 'x-forwarded-for': '127.0.0.1', forwarded: 'for=127.0.0.1', host: '127.0.0.1', 'x-real-ip': '127.0.0.1' })), false);
  }
  delete process.env.TRUST_PROXY;
  assert.equal(isLoopbackSocket({ socket: { remoteAddress: '127.0.0.1' }, headers: {} }), true);
  assert.equal(isLoopbackSocket({ socket: { remoteAddress: '::1' }, headers: {} }), true);
  assert.equal(isLoopbackSocket({ socket: { remoteAddress: '::ffff:127.0.0.1' }, headers: {} }), true);
});

test('formato canonico v1 e determinista e nao ambiguo (campos nao aceitam quebras de linha; hashes do corpo e do Authorization)', () => {
  const args = { stationId: crypto.randomUUID(), timestamp: 1700000000, nonce: crypto.randomBytes(18).toString('base64url'), method: 'post', path: '/a/b', query: 'x=1&y=2', body: Buffer.from('{"k":1}'), authorization: 'Bearer t' };
  const c1 = buildCanonicalRequest(args).toString('utf8').split('\n');
  assert.equal(c1.length, 9);
  assert.deepEqual([c1[0], c1[4], c1[5], c1[6]], ['POSLY-STATION-REQ-V1', 'POST', '/a/b', 'x=1&y=2']);
  assert.equal(c1[7], crypto.createHash('sha256').update('{"k":1}').digest('hex'));
  assert.equal(c1[8], crypto.createHash('sha256').update('Bearer t').digest('hex'));
  assert.deepEqual(buildCanonicalRequest(args), buildCanonicalRequest({ ...args }));
  for (const bad of [{ path: '/a\n/b' }, { query: 'a=1\nb=2' }, { authorization: 'x\ny' }, { method: 'PO ST' }, { path: 'sem-barra' }, { timestamp: '1e9' }]) {
    assert.throws(() => buildCanonicalRequest({ ...args, ...bad }));
  }
  server.close();
});
