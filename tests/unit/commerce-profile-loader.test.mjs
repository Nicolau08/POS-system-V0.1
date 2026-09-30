/**
 * Ciclo de vida do perfil comercial (useCommerceProfile → lib/commerceProfileLoader.js).
 *
 * Regressão: no Posly empacotado o PosScreen monta antes do login; o 1.º GET /tenant/info sem
 * token responde 401, o hook tratava-o como perfil "retalho" (sem `tables`), gravava-o na cache
 * e nunca voltava a pedir → botão do local/BALCÃO ausente até remontar. Estes testes usam o mesmo
 * módulo que o hook usa (lógica pura, sem React) com um EventTarget a fazer de `window`.
 *
 * As capabilities são derivadas com api/utils/tenantCapabilities.js (mesmas regras/presets que
 * lib/capabilities.ts — existe um teste de paridade de presets mais abaixo).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  COMMERCE_PROFILE_STATUS,
  POS_AUTH_CHANGED_EVENT,
  bindLoaderToAuthEvents,
  createCommerceProfileLoader,
  parseTenantInfoResponse,
} from '../../lib/commerceProfileLoader.js';
import {
  getVerticalPreset,
  hasCapability,
  normalizeCapabilities,
  normalizeVertical,
} from '../../api/utils/tenantCapabilities.js';

const RESTAURANT = {
  success: true,
  data: {
    tenant_id: 'loja-258',
    name: 'Loja 258',
    license_type: 'LITE',
    commerce_type: 'restauracao',
    vertical: 'restauracao',
    capabilities: ['customers', 'inventory', 'kds', 'multi_station', 'print_centers', 'sales', 'tables'],
  },
};
const UNAUTHORIZED = { success: false, data: null, error: { message: 'Unauthorized', code: 'UNAUTHORIZED' } };

const http = (status, json) => ({ ok: status >= 200 && status < 300, status, json });

/** Harness que espelha o que o hook faz: estado + cache + token + window. */
function makeHarness({ token = null, cached = null } = {}) {
  const win = new EventTarget();
  const h = {
    win,
    token,
    cache: cached, // equivalente a posSessionCache.state.commerce
    profile: cached, // equivalente ao useState do hook
    tables: cached ? cached.tables : false,
    status: cached ? 'loaded' : 'loading',
    error: null,
    statuses: [],
    profileCalls: 0,
    fetchCalls: 0,
    queue: [],
    pending: [],
  };
  h.fetchTenantInfo = () => {
    h.fetchCalls += 1;
    const next = h.queue.shift();
    const p = (async () => {
      const item = typeof next === 'function' ? await next() : next;
      if (item instanceof Error) throw item;
      return item;
    })();
    h.pending.push(p.catch(() => undefined));
    return p;
  };
  h.onProfile = (data) => {
    h.profileCalls += 1;
    const type = String(data.commerce_type);
    const vertical = normalizeVertical(data.vertical, type);
    const capabilities = normalizeCapabilities(data.capabilities ?? data.capabilities_json, vertical, type);
    h.profile = { commerceType: type, capabilities, name: data.name };
    h.tables = hasCapability(capabilities, 'tables');
    h.cache = { ...h.profile, tables: h.tables }; // só perfis válidos chegam aqui
  };
  h.loader = createCommerceProfileLoader({
    fetchTenantInfo: h.fetchTenantInfo,
    onProfile: h.onProfile,
    onStatus: (status, error) => {
      h.status = status;
      h.error = error;
      h.statuses.push(`${status}${error ? ':' + error : ''}`);
    },
    hasSession: () => Boolean(h.token),
    hasProfile: Boolean(cached),
  });
  h.unbind = bindLoaderToAuthEvents(h.loader, win);
  h.settle = async () => {
    for (let i = 0; i < 5; i += 1) {
      await Promise.all(h.pending);
      await new Promise((r) => setImmediate(r));
    }
  };
  h.login = async (token = 'tok.exp.sig') => {
    h.token = token; // useAuth.ts: setStoredAuthToken(token) ANTES do evento
    h.win.dispatchEvent(new Event(POS_AUTH_CHANGED_EVENT));
    await h.settle();
  };
  h.logout = async () => {
    h.token = null; // clearPosAuthSession: remove token, limpa cache, depois emite o evento
    h.cache = null;
    h.win.dispatchEvent(new Event(POS_AUTH_CHANGED_EVENT));
    await h.settle();
  };
  return h;
}

// ---------------------------------------------------------------------------------------------
// Caso A — arranque sem token
// ---------------------------------------------------------------------------------------------
test('A: arranque sem token — 401 não vira perfil retalho, não vai à cache e não desativa tables', async () => {
  const h = makeHarness({ token: null });
  h.queue.push(http(401, UNAUTHORIZED));

  const result = await h.loader.refresh();

  assert.equal(result.ok, false);
  assert.equal(h.profileCalls, 0, 'nenhum perfil entregue ao estado');
  assert.equal(h.cache, null, 'cache não contaminada com fallback');
  assert.equal(h.profile, null, 'não há perfil "retalho" inventado');
  assert.equal(h.status, COMMERCE_PROFILE_STATUS.ERROR);
  assert.equal(h.error, 'http_401');
  // "tables" não ficou definitivamente desligado: o próximo login ainda o pode ligar (caso B).
  assert.notEqual(h.status, COMMERCE_PROFILE_STATUS.LOADED);
});

test('A2: evento de auth sem sessão (o boot limpa o token) não faz pedidos inúteis', async () => {
  const h = makeHarness({ token: null });
  h.queue.push(http(401, UNAUTHORIZED));
  await h.loader.refresh();
  const before = h.fetchCalls;

  h.win.dispatchEvent(new Event(POS_AUTH_CHANGED_EVENT)); // readBootAuth → clearPosAuthSession
  await h.settle();

  assert.equal(h.fetchCalls, before);
});

// ---------------------------------------------------------------------------------------------
// Caso B — login posterior
// ---------------------------------------------------------------------------------------------
test('B: sem sessão → login → pos-auth-changed → novo /tenant/info → tables=true sem remontar', async () => {
  const h = makeHarness({ token: null });
  const loaderInstance = h.loader;
  h.queue.push(http(401, UNAUTHORIZED), http(200, RESTAURANT));

  await h.loader.refresh(); // arranque (antes do login)
  assert.equal(h.tables, false);
  assert.equal(h.cache, null);

  await h.login(); // token criado + evento

  assert.equal(h.fetchCalls, 2, 'o login fez o hook refazer /tenant/info');
  assert.equal(h.loader, loaderInstance, 'mesmo loader/hook, sem remontar o PosScreen');
  assert.equal(h.profile.commerceType, 'restauracao');
  assert.equal(h.tables, true);
  assert.equal(h.cache.tables, true, 'cache só agora recebe o perfil válido');
  assert.equal(h.status, COMMERCE_PROFILE_STATUS.LOADED);
  assert.equal(h.error, null);
});

// ---------------------------------------------------------------------------------------------
// Caso C — token válido no arranque
// ---------------------------------------------------------------------------------------------
test('C: token válido no arranque — 200 normal, sem regressão', async () => {
  const h = makeHarness({ token: 'leftover.exp.sig' });
  h.queue.push(http(200, RESTAURANT));

  await h.loader.refresh();

  assert.equal(h.tables, true);
  assert.equal(h.profile.name, 'Loja 258');
  assert.equal(h.status, 'loaded');
  assert.deepEqual(h.statuses, ['loading', 'loaded']);
  assert.equal(h.profileCalls, 1);

  // logout posterior não refaz pedidos nem perde o perfil (mesmo tenant)
  await h.logout();
  assert.equal(h.fetchCalls, 1);
  assert.equal(h.profile.commerceType, 'restauracao');
  assert.equal(h.tables, true);
});

test('C2: resposta 200 sem envelope (payload já desembrulhado) continua a ser aceite', async () => {
  const h = makeHarness({ token: 't' });
  h.queue.push(http(200, RESTAURANT.data));
  await h.loader.refresh();
  assert.equal(h.tables, true);
});

// ---------------------------------------------------------------------------------------------
// Caso D — erro transitório não substitui perfil válido
// ---------------------------------------------------------------------------------------------
test('D: 500 / 403 / 401 / rede / payload inválido NÃO substituem um perfil válido por retalho', async () => {
  const h = makeHarness({ token: 't' });
  h.queue.push(http(200, RESTAURANT));
  await h.loader.refresh();
  const validProfile = h.profile;
  const validCache = h.cache;
  assert.equal(h.tables, true);

  const failures = [
    http(500, { success: false, error: { message: 'boom' } }),
    http(403, { success: false, error: { message: 'Forbidden' } }),
    http(401, UNAUTHORIZED),
    new Error('fetch failed'),
    http(200, { success: false, data: null }),
    http(200, { success: true, data: null }),
    http(200, null),
    http(200, { success: true, data: { name: 'sem identidade comercial' } }),
  ];
  for (const failure of failures) {
    h.queue.push(failure);
    await h.loader.refresh();
    assert.equal(h.profile, validProfile, 'perfil válido mantido');
    assert.equal(h.cache, validCache, 'cache intacta');
    assert.equal(h.tables, true);
    assert.equal(h.status, 'loaded', 'estado continua loaded (há perfil válido)');
  }
  assert.equal(h.profileCalls, 1, 'só a resposta válida chegou ao estado');
});

test('D2: erro de rede no arranque sem perfil → status error, sem perfil inventado', async () => {
  const h = makeHarness({ token: 't' });
  h.queue.push(new Error('ECONNREFUSED'));
  await h.loader.refresh();
  assert.equal(h.status, 'error');
  assert.equal(h.error, 'network');
  assert.equal(h.profile, null);
  assert.equal(h.cache, null);

  // recupera sozinho quando a sessão muda (login após a API ficar disponível)
  h.queue.push(http(200, RESTAURANT));
  await h.login();
  assert.equal(h.tables, true);
  assert.equal(h.status, 'loaded');
});

// ---------------------------------------------------------------------------------------------
// Caso E — logout/login
// ---------------------------------------------------------------------------------------------
test('E: logout limpa a cache; novo login volta a pedir /tenant/info e repõe a cache', async () => {
  const h = makeHarness({ token: 't' });
  h.queue.push(http(200, RESTAURANT), http(200, RESTAURANT));
  await h.loader.refresh();
  assert.ok(h.cache);

  await h.logout(); // clearPosSessionCache + token removido
  assert.equal(h.cache, null, 'cache limpa (compatível com clearPosSessionCache)');
  assert.equal(h.fetchCalls, 1, 'logout não faz pedidos sem sessão');

  await h.login('novo.exp.sig');
  assert.equal(h.fetchCalls, 2, 'novo login → novo fetch');
  assert.ok(h.cache, 'cache reposta com perfil válido');
  assert.equal(h.cache.tables, true);
  assert.equal(h.tables, true);
});

// ---------------------------------------------------------------------------------------------
// Ordenação de respostas / dispose / parsing
// ---------------------------------------------------------------------------------------------
test('ordem: resposta válida atrasada (pedido antigo) ainda é aplicada; falha antiga não sobrepõe estado mais recente', async () => {
  const h = makeHarness({ token: null });
  let releaseOld;
  const oldRequest = () => new Promise((resolve) => { releaseOld = () => resolve(http(200, RESTAURANT)); });
  h.queue.push(oldRequest, http(401, UNAUTHORIZED));

  const first = h.loader.refresh(); // pedido 1 (lento, válido)
  const second = h.loader.refresh(); // pedido 2 (401)
  await second;
  assert.equal(h.status, 'error');
  assert.equal(h.tables, false);

  releaseOld();
  await first;
  assert.equal(h.tables, true, 'perfil válido tardio é aplicado');
  assert.equal(h.status, 'loaded');
});

test('dispose: nada é entregue depois de desmontar; listener removido', async () => {
  const h = makeHarness({ token: 't' });
  h.queue.push(http(200, RESTAURANT));
  const pending = h.loader.refresh();
  h.loader.dispose();
  h.unbind();
  await pending;
  assert.equal(h.profileCalls, 0);

  const calls = h.fetchCalls;
  h.win.dispatchEvent(new Event(POS_AUTH_CHANGED_EVENT));
  await h.settle();
  assert.equal(h.fetchCalls, calls);
});

test('parseTenantInfoResponse: só resposta ok + sucesso + dados com identidade comercial é perfil', () => {
  assert.equal(parseTenantInfoResponse(null).ok, false);
  assert.deepEqual(parseTenantInfoResponse(http(401, UNAUTHORIZED)), { ok: false, reason: 'http_401' });
  assert.deepEqual(parseTenantInfoResponse(http(403, {})), { ok: false, reason: 'http_403' });
  assert.deepEqual(parseTenantInfoResponse(http(500, {})), { ok: false, reason: 'http_500' });
  assert.deepEqual(parseTenantInfoResponse(http(200, null)), { ok: false, reason: 'invalid_payload' });
  assert.deepEqual(parseTenantInfoResponse(http(200, [])), { ok: false, reason: 'invalid_payload' });
  assert.deepEqual(parseTenantInfoResponse(http(200, { success: false })), { ok: false, reason: 'api_error' });
  assert.deepEqual(parseTenantInfoResponse(http(200, { success: true, data: [] })), { ok: false, reason: 'invalid_payload' });
  assert.deepEqual(parseTenantInfoResponse(http(200, { success: true, data: { name: 'x' } })), { ok: false, reason: 'invalid_payload' });
  const ok = parseTenantInfoResponse(http(200, RESTAURANT));
  assert.equal(ok.ok, true);
  assert.equal(ok.data.tenant_id, 'loja-258');
  assert.equal(parseTenantInfoResponse(http(200, { capabilities_json: '["tables"]' })).ok, true);
});

// ---------------------------------------------------------------------------------------------
// Guardas de regressão
// ---------------------------------------------------------------------------------------------
test('guarda: o hook usa o loader e já não normaliza respostas sem validar (bug 401 → retalho)', () => {
  const source = fs.readFileSync(new URL('../../lib/useCommerceProfile.ts', import.meta.url), 'utf8');
  assert.match(source, /createCommerceProfileLoader/);
  assert.match(source, /bindLoaderToAuthEvents\(loader, window\)/);
  assert.doesNotMatch(source, /json\?\.success \? json\.data : json/, 'fallback antigo que aceitava 401 como perfil');
  // setCachedCommerce só pode aparecer dentro de onProfile (perfil já validado)
  const occurrences = source.match(/setCachedCommerce\(/g) ?? [];
  assert.equal(occurrences.length, 1);
  const idx = source.indexOf('setCachedCommerce(');
  assert.ok(source.lastIndexOf('onProfile', idx) > source.lastIndexOf('createCommerceProfileLoader', idx) - 1);
});

test('paridade: preset de restauração inclui tables (base da regra de Mesas/BALCÃO)', () => {
  assert.ok(getVerticalPreset('restauracao').includes('tables'));
  assert.ok(!getVerticalPreset('retalho').includes('tables'));
  const frontend = fs.readFileSync(new URL('../../lib/capabilities.ts', import.meta.url), 'utf8');
  assert.match(frontend, /restauracao: \[[^\]]*'tables'[^\]]*\]/);
  assert.doesNotMatch(frontend.match(/retalho: \[[^\]]*\]/)?.[0] ?? '', /'tables'/);
});
