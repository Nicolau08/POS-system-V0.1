/**
 * Ciclo de vida do perfil comercial (GET /tenant/info) — sem React, sem aliases, testável em Node.
 *
 * Problema que resolve: o PosScreen (e o ecrã de login, que vive nele) monta ANTES de existir
 * sessão; o primeiro /tenant/info pode por isso responder 401. Tratar esse 401 como perfil
 * ("retalho") desligava `tables` (botão do local/BALCÃO) até ao próximo remount.
 *
 * Regras:
 *  - só uma resposta HTTP ok + payload de sucesso com dados de perfil conta como perfil válido;
 *  - 401/403/5xx/erro de rede/payload inválido NUNCA chegam a `onProfile` (logo nunca à cache) e
 *    nunca substituem um perfil válido já carregado;
 *  - `pos-auth-changed` (emitido no login e no clearPosAuthSession) volta a pedir o perfil, mas só
 *    quando existe sessão (token) — o logout mantém o último perfil válido (o tenant é o mesmo);
 *  - sem polling e sem timers.
 */

export const COMMERCE_PROFILE_STATUS = Object.freeze({
  LOADING: 'loading',
  LOADED: 'loaded',
  ERROR: 'error',
});

export const POS_AUTH_CHANGED_EVENT = 'pos-auth-changed';

/**
 * @param {{ ok?: boolean, status?: number, json?: unknown } | null | undefined} response
 * @returns {{ ok: true, data: Record<string, unknown> } | { ok: false, reason: string }}
 */
export function parseTenantInfoResponse(response) {
  if (!response || response.ok !== true) {
    return { ok: false, reason: `http_${Number(response?.status ?? 0) || 'error'}` };
  }
  const json = response.json;
  if (!json || typeof json !== 'object' || Array.isArray(json)) {
    return { ok: false, reason: 'invalid_payload' };
  }
  // Envelope da API: { success, data }. `success: false` nunca é perfil.
  if (json.success === false) return { ok: false, reason: 'api_error' };
  const data = json.success === true ? json.data : json;
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { ok: false, reason: 'invalid_payload' };
  }
  // Um perfil real traz sempre a identidade comercial (tenant.service.readTenantInfo).
  const hasCommerceIdentity =
    'commerce_type' in data || 'vertical' in data || 'capabilities' in data || 'capabilities_json' in data;
  if (!hasCommerceIdentity) return { ok: false, reason: 'invalid_payload' };
  return { ok: true, data };
}

/**
 * @param {{
 *   fetchTenantInfo: () => Promise<{ ok?: boolean, status?: number, json?: unknown }>,
 *   onProfile: (data: Record<string, unknown>) => void,
 *   onStatus?: (status: 'loading' | 'loaded' | 'error', error: string | null) => void,
 *   hasSession?: () => boolean,
 *   hasProfile?: boolean,
 * }} options
 */
export function createCommerceProfileLoader({
  fetchTenantInfo,
  onProfile,
  onStatus,
  hasSession = () => true,
  hasProfile = false,
}) {
  let generation = 0;
  let disposed = false;
  let everLoaded = Boolean(hasProfile);

  const emit = (status, error = null) => {
    if (!disposed && typeof onStatus === 'function') onStatus(status, error);
  };

  /** @param {{ silent?: boolean }} [options] */
  async function refresh(options) {
    const gen = ++generation;
    if (!everLoaded && !options?.silent) emit(COMMERCE_PROFILE_STATUS.LOADING, null);

    let parsed;
    try {
      parsed = parseTenantInfoResponse(await fetchTenantInfo());
    } catch {
      parsed = { ok: false, reason: 'network' };
    }
    if (disposed) return parsed;

    if (parsed.ok) {
      // Um perfil válido é sempre aplicado (é do mesmo tenant), mesmo vindo de um pedido anterior.
      everLoaded = true;
      onProfile(parsed.data);
      emit(COMMERCE_PROFILE_STATUS.LOADED, null);
      return parsed;
    }

    // Falhas: nunca tocam no perfil/cache. Só o pedido mais recente reporta o estado.
    if (gen === generation) {
      emit(everLoaded ? COMMERCE_PROFILE_STATUS.LOADED : COMMERCE_PROFILE_STATUS.ERROR, parsed.reason);
    }
    return parsed;
  }

  /** Chamado em `pos-auth-changed`: só refaz o pedido quando há sessão (login), não no logout. */
  async function handleAuthChanged() {
    if (disposed || !hasSession()) return null;
    return refresh();
  }

  function dispose() {
    disposed = true;
  }

  return { refresh, handleAuthChanged, dispose };
}

/**
 * Liga o loader ao evento de autenticação existente. Devolve a função de remoção.
 * @param {{ handleAuthChanged: () => unknown }} loader
 * @param {{ addEventListener: Function, removeEventListener: Function }} target
 */
export function bindLoaderToAuthEvents(loader, target, eventName = POS_AUTH_CHANGED_EVENT) {
  const listener = () => {
    void loader.handleAuthChanged();
  };
  target.addEventListener(eventName, listener);
  return () => target.removeEventListener(eventName, listener);
}
