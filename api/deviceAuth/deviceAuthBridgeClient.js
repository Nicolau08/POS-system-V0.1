/**
 * Cliente da ponte Device Auth (Etapa 1F.2, itens 26-31) — corre dentro do
 * processo `api/server.js`. NUNCA vê o refresh token; só pede ao Electron
 * (via a ponte loopback local, electron/deviceAuth/deviceAuthBridge.js) o
 * access JWT actual, a cada chamada que precise de um.
 *
 * `POS_DEVICE_AUTH_BRIDGE_URL` / `POS_DEVICE_AUTH_BRIDGE_SECRET` são
 * injectados pelo Electron no spawn deste processo (electron/main.js,
 * startBackend) — nunca escritos em disco, nunca logados.
 */
const BRIDGE_TIMEOUT_MS = 5000;

// Single-flight local (item 2, aplicado também neste lado da ponte): evita
// N pedidos HTTP loopback simultâneos quando várias operações de sync pedem
// um token ao mesmo tempo — coalescem numa única chamada à ponte.
let inFlight = null;

function resolveBridgeConfig() {
  const url = String(process.env.POS_DEVICE_AUTH_BRIDGE_URL ?? '').trim();
  const secret = String(process.env.POS_DEVICE_AUTH_BRIDGE_SECRET ?? '').trim();
  if (!url || !secret) return null;
  return { url, secret };
}

/** @returns {boolean} true se a ponte está configurada neste processo (não implica que o token esteja disponível AGORA). */
export function isDeviceAuthBridgeConfigured() {
  return Boolean(resolveBridgeConfig());
}

async function callBridge() {
  const config = resolveBridgeConfig();
  if (!config) {
    return { ok: false, reason: 'bridge_not_configured' };
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), BRIDGE_TIMEOUT_MS);
  try {
    const res = await fetch(config.url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.secret}`, 'Content-Type': 'application/json' },
      body: '{}',
      signal: ctrl.signal,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data?.ok) {
      return { ok: false, reason: data?.error || `bridge_http_${res.status}` };
    }
    return { ok: true, accessToken: String(data.accessToken) };
  } catch (error) {
    // Ponte inacessível (Electron a reiniciar, servidor loopback ainda a
    // subir, etc.) — tratado como device auth temporariamente indisponível,
    // nunca como erro fatal do processo da API.
    return { ok: false, reason: 'bridge_unreachable', error: String(error?.message ?? error) };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Devolve o access token actual via a ponte, ou null se indisponível. Nunca
 * lança. Coalesce pedidos concorrentes deste processo numa única chamada à
 * ponte (o Electron já faz o seu próprio single-flight sobre o refresh HTTP
 * real — isto evita apenas o tráfego loopback redundante).
 */
export async function getDeviceAccessTokenViaBridge() {
  if (!inFlight) {
    inFlight = callBridge().finally(() => {
      inFlight = null;
    });
  }
  const result = await inFlight;
  return result.ok ? result.accessToken : null;
}

/**
 * Só-leitura estrito (Pilot Gate): devolve o access token JÁ em cache no
 * Electron, se ainda válido — nunca provoca refresh (a ponte responde por
 * /access-token-cached, que nunca chama getValidAccessToken). Null se ausente,
 * expirado, ponte não configurada ou inacessível. Nunca lança.
 */
export async function getDeviceAccessTokenCachedOnlyViaBridge() {
  const config = resolveBridgeConfig();
  if (!config) return null;

  const cachedUrl = config.url.replace(/\/access-token$/, '/access-token-cached');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), BRIDGE_TIMEOUT_MS);
  try {
    const res = await fetch(cachedUrl, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.secret}`, 'Content-Type': 'application/json' },
      body: '{}',
      signal: ctrl.signal,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data?.ok || !data.accessToken) return null;
    return String(data.accessToken);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Diagnóstico só-leitura (Pilot Gate — VM device auth): chama /diagnostic na
 * ponte, que NUNCA invoca getValidAccessToken()/refresh — só espreita o
 * estado já existente. Nunca lança; devolve null se a ponte não estiver
 * configurada/acessível (o chamador trata cada campo como "unknown").
 * @param {string|null} localTenantId
 */
export async function getDeviceAuthDiagnosticViaBridge(localTenantId = null) {
  const config = resolveBridgeConfig();
  if (!config) return null;

  const diagnosticUrl = config.url.replace(/\/access-token$/, '/diagnostic');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), BRIDGE_TIMEOUT_MS);
  try {
    const res = await fetch(diagnosticUrl, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.secret}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ localTenantId }),
      signal: ctrl.signal,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data?.ok) return null;
    return data.diagnostic ?? null;
  } catch {
    // Ponte inacessível — cada campo fica "unknown" no controller, nunca lança.
    return null;
  } finally {
    clearTimeout(timer);
  }
}
