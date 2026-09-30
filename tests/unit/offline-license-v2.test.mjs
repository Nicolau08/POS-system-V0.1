/**
 * Etapa 1G.3.1 - Offline License v2 (store_id + max_stations_per_store assinados). Interop REAL: os envelopes
 * saem do signer do license-console (subprocesso), nunca forjados a mao (excepto os casos negativos que precisam de
 * um payload que o signer real recusa assinar).
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { verifyOfflineLicense, canonicalize } from '../../lib/licensing/offlineLicense.js';
import { canPairAnotherStation, stationEntitlementFromVerification, STATION_ENTITLEMENT_REASON as R } from '../../lib/licensing/stationEntitlement.js';
import { getStationEntitlement } from '../../api/services/stationEntitlement.service.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const licenseConsoleDir = path.join(repoRoot, 'license-console');
const script = path.join(licenseConsoleDir, 'scripts', 'gen-offline-license-fixture.mjs');

function gen(overrides = {}) {
  const r = spawnSync(process.execPath, ['--experimental-strip-types', script, JSON.stringify(overrides)], { cwd: licenseConsoleDir, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}
const resolver = (f) => (kid) => (kid === f.keyId ? f.publicKeyPem : null);
const M = 'machine-fixture-1';
const verify = (f, opts = {}) => verifyOfflineLicense(f.envelope, resolver(f), { machineId: M, ...opts });
const clone = (o) => JSON.parse(JSON.stringify(o));
const ent = (f, opts) => stationEntitlementFromVerification(verify(f, opts));

test('v2 valida (signer real): VALID, licenseVersion 2, store_id e limite lidos do payload assinado', () => {
  const f = gen({ v2: true });
  assert.equal(f.envelope.version, 2);
  const v = verify(f);
  assert.equal(v.ok, true);
  assert.equal(v.licenseVersion, 2);
  assert.equal(v.payload.store_id, 'store-fixture-1');
  assert.equal(v.payload.max_stations_per_store, 3);
  assert.deepEqual(ent(f), { allowed: true, reason: R.OK, unlimited: false, max: 3, storeId: 'store-fixture-1', licenseVersion: 2 });
});

test('adulteracao: assinatura, store_id, max_stations (numero e null) e remocao da chave invalidam a licenca', () => {
  const f = gen({ v2: true });
  const bad = (mut) => {
    const e = clone(f.envelope);
    mut(e);
    return verifyOfflineLicense(e, resolver(f), { machineId: M });
  };
  for (const mut of [
    (e) => { e.signature = e.signature.slice(0, -4) + 'AAAA'; },
    (e) => { e.payload.store_id = 'store-OUTRA'; },
    (e) => { e.payload.max_stations_per_store = 99; },
    (e) => { e.payload.max_stations_per_store = null; },
    (e) => { delete e.payload.max_stations_per_store; },
    (e) => { e.version = 1; },
  ]) {
    const r = bad(mut);
    assert.equal(r.ok, false);
    assert.equal(stationEntitlementFromVerification(r).allowed, false);
  }
  assert.equal(bad((e) => { e.payload.store_id = 'x'; }).kind, 'INVALID_SIGNATURE');
});

test('limites 0/1/2/3: 0 = sem Stations; N = ate N activas; NULL assinado explicitamente = ilimitado', () => {
  const zero = ent(gen({ v2: true, payload: { max_stations_per_store: 0 } }));
  assert.deepEqual([zero.allowed, zero.reason], [false, R.STATION_LIMIT_ZERO]);
  assert.equal(canPairAnotherStation(zero, 0).allowed, false);
  for (const n of [1, 2, 3]) {
    const e = ent(gen({ v2: true, payload: { max_stations_per_store: n } }));
    for (let active = 0; active <= n + 1; active += 1) {
      const r = canPairAnotherStation(e, active);
      assert.equal(r.allowed, active < n, `max=${n} active=${active}`);
      if (!r.allowed) assert.equal(r.reason, R.STATION_LIMIT_REACHED);
    }
  }
  const unlimited = ent(gen({ v2: true, payload: { max_stations_per_store: null } }));
  assert.deepEqual([unlimited.allowed, unlimited.unlimited, unlimited.max], [true, true, null]);
  assert.equal(canPairAnotherStation(unlimited, 100000).allowed, true);
  assert.equal(canPairAnotherStation(e0(), -1).allowed, false);
  function e0() { return ent(gen({ v2: true, payload: { max_stations_per_store: 2 } })); }
});

test('ausencia/valores invalidos assinados NUNCA significam ilimitado (assinatura valida mas payload malformado)', () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  const pub = publicKey.export({ type: 'spki', format: 'pem' });
  const base = () => ({
    license_version: 2, license_id: 'l', tenant_id: 't', name: 'n', nuit: null, plan: 'PRO', commerce_type: 'retalho', vertical: null,
    capabilities: [], machine_id: M, issued_at: new Date().toISOString(), expires_at: new Date(Date.now() + 1e9).toISOString(),
    store_id: 'store-A', max_stations_per_store: 2,
  });
  const signRaw = (payload, version = 2) => ({
    version, key_id: 'k', payload,
    signature: crypto.sign(null, Buffer.from(canonicalize({ version, key_id: 'k', payload }), 'utf8'), privateKey).toString('base64url'),
  });
  const check = (payload, version) => verifyOfflineLicense(signRaw(payload, version), () => pub, { machineId: M });
  assert.equal(check(base()).ok, true);
  const noMax = base(); delete noMax.max_stations_per_store;
  const undefMax = base(); undefMax.max_stations_per_store = undefined;
  for (const p of [noMax, undefMax]) {
    const r = check(p);
    assert.deepEqual([r.ok, r.kind], [false, 'MALFORMED']);
    assert.equal(stationEntitlementFromVerification(r).allowed, false);
  }
  for (const bad of [-1, 1.5, '3', 10001, NaN, true]) assert.equal(check({ ...base(), max_stations_per_store: bad }).ok, false, String(bad));
  assert.equal(check({ ...base(), store_id: '' }).ok, false);
  const noStore = base(); delete noStore.store_id;
  assert.equal(check(noStore).ok, false);
  assert.equal(check({ ...base(), license_version: 1 }).ok, false, 'license_version do payload tem de ser 2 na v2');
});

test('licenca expirada, maquina diferente, Store diferente: sem direito', () => {
  const expired = gen({ v2: true, payload: { expires_at: new Date(Date.now() - 1000).toISOString() } });
  assert.equal(verify(expired).kind, 'EXPIRED');
  assert.equal(stationEntitlementFromVerification(verify(expired)).allowed, false);
  const f = gen({ v2: true });
  const wrong = verifyOfflineLicense(f.envelope, resolver(f), { machineId: 'outra-maquina' });
  assert.equal(wrong.kind, 'WRONG_MACHINE');
  assert.equal(stationEntitlementFromVerification(wrong).allowed, false);
  assert.equal(verify(f, { expectedStoreId: 'store-fixture-1' }).ok, true);
  const ws = verify(f, { expectedStoreId: 'store-de-outro-server' });
  assert.equal(ws.kind, 'WRONG_STORE');
  assert.equal(stationEntitlementFromVerification(ws).allowed, false);
});

test('v1 continua valida (comportamento legado) mas NAO autoriza Station Pairing, mesmo com um limite "assinado" a mais', () => {
  const f = gen();
  const v = verify(f);
  assert.equal(v.ok, true);
  assert.equal(v.licenseVersion, 1);
  const e = stationEntitlementFromVerification(v);
  assert.deepEqual([e.allowed, e.reason, e.unlimited], [false, R.LICENSE_V1_NO_STATION_ENTITLEMENT, false]);
  assert.equal(canPairAnotherStation(e, 0).allowed, false);
  // um emissor que assinasse max_stations_per_store numa v1 continua sem efeito: so a v2 tem semantica de limite
  const withExtra = gen({ payload: { max_stations_per_store: null } });
  assert.equal(ent(withExtra).reason, R.LICENSE_V1_NO_STATION_ENTITLEMENT);
  assert.equal(ent(withExtra).unlimited, false);
  // e um limite injectado numa v1 SEM assinar de novo invalida a licenca inteira
  const tampered = clone(f.envelope);
  tampered.payload.max_stations_per_store = null;
  assert.equal(verifyOfflineLicense(tampered, resolver(f), { machineId: M }).ok, false);
});

test('servico offline completo: le o ficheiro instalado, reverifica sempre; v1/ausente/adulterado/expirado = sem direito', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'posly-lic-v2-'));
  const file = path.join(dir, 'offline-license.json');
  const f = gen({ v2: true, payload: { max_stations_per_store: 2 } });
  const get = (extra = {}) => getStationEntitlement({ userDataPath: dir, resolvePublicKeyPem: resolver(f), machineId: M, ...extra });
  assert.equal(get().reason, R.LICENSE_INVALID, 'sem ficheiro');
  fs.writeFileSync(file, JSON.stringify(f.envelope));
  assert.deepEqual([get().allowed, get().max, get().storeId], [true, 2, 'store-fixture-1']);
  assert.equal(get({ expectedStoreId: 'outra' }).allowed, false);
  const edited = clone(f.envelope);
  edited.payload.max_stations_per_store = null; // alguem edita o ficheiro para "ilimitado"
  fs.writeFileSync(file, JSON.stringify(edited));
  assert.equal(get().allowed, false, 'ficheiro adulterado nunca da direito');
  fs.writeFileSync(file, '{ nao e json');
  assert.equal(get().allowed, false);
  const v1 = gen();
  fs.writeFileSync(file, JSON.stringify(v1.envelope));
  assert.equal(getStationEntitlement({ userDataPath: dir, resolvePublicKeyPem: resolver(v1), machineId: M }).reason, R.LICENSE_V1_NO_STATION_ENTITLEMENT);
  const exp = gen({ v2: true, payload: { expires_at: new Date(Date.now() - 1000).toISOString() } });
  fs.writeFileSync(file, JSON.stringify(exp.envelope));
  assert.equal(getStationEntitlement({ userDataPath: dir, resolvePublicKeyPem: resolver(exp), machineId: M }).allowed, false);
});
