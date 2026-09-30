/**
 * DeviceAuthClient — Etapa 1F.1.
 *
 * Troca uma credencial de activação (uso único, nunca persistida) por uma
 * identidade de dispositivo cloud (device_id + refresh token opaco,
 * guardados via electron/deviceAuth/deviceAuthStorage.js com safeStorage) e
 * mantém um access token (ES256, curto) só em memória — nunca em disco.
 *
 * Contrato HTTP confirmado no código real do license-console (Etapa 1F.1,
 * mapeamento):
 *  - POST {issuerBaseUrl}/api/license-issuer/device/bootstrap
 *      body: { activation_token, machine_id, station_code? }
 *      200:  { device_id, refresh_token, refresh_token_expires_at, access_token, access_token_expires_at }
 *      erro: { error, code } — códigos em lib/deviceAuth/errors.ts (license-console)
 *  - POST {issuerBaseUrl}/api/license-issuer/device/token
 *      body: { refresh_token }
 *      200:  { access_token, access_token_expires_at, refresh_token, refresh_token_expires_at } (rotação)
 *      erro: { error, code }
 *
 * REGRA P0: nada aqui usa POS_LICENSE_HMAC_SECRET nem SUPABASE_SERVICE_ROLE_KEY
 * — a única autoridade cloud deste módulo é o refresh token opaco devolvido
 * pelo bootstrap. Este módulo NUNCA substitui a licença offline (Ed25519/HMAC)
 * — é uma identidade de TERMINAL para sync, não prova de licença nem de
 * autoridade humana.
 */
import {
  readDeviceAuthState,
  writeDeviceAuthState,
  clearDeviceAuthState,
} from './deviceAuthStorage.js';

/**
 * Decode (nunca verifica) o header e o payload de um JWT compacto usando só
 * built-ins do Node (Buffer 'base64url' + JSON.parse) — deliberadamente sem a
 * dependência `jose`, que nunca é empacotada no runtime do Electron main
 * (só existe no node_modules de desenvolvimento/scripts, nunca listada em
 * package.json `dependencies`; o electron-builder não a inclui no app.asar,
 * causando ERR_MODULE_NOT_FOUND no VM). Este diagnóstico nunca precisou de
 * verificar assinatura — só ler claims já confiadas pelo próprio processo que
 * as gerou — por isso um decode local, sem dependências, é estritamente
 * suficiente e mais seguro para empacotar.
 *
 * Falha fechado: qualquer forma inesperada (não são 3 partes, base64url
 * inválido, JSON inválido, header/payload não são objectos) devolve
 * `{ header: null, payload: null }` — nunca lança para o chamador tratar
 * como "unknown", nunca devolve um valor parcial/adivinhado.
 * @param {string} token
 * @returns {{ header: object|null, payload: object|null }}
 */
function decodeJwtLocally(token) {
  try {
    const parts = String(token).split('.');
    if (parts.length !== 3) return { header: null, payload: null };
    const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
    if (!isPlainObject(header) || !isPlainObject(payload)) {
      return { header: null, payload: null };
    }
    return { header, payload };
  } catch {
    return { header: null, payload: null };
  }
}

const BOOTSTRAP_PATH = '/api/license-issuer/device/bootstrap';
const TOKEN_PATH = '/api/license-issuer/device/token';
const HTTP_TIMEOUT_MS = 15000;
// Margem de segurança do Token Provider (Etapa 1F.2 item 1) — 90s, não um
// valor assumido às cegas. Justificação: cobre (a) o round-trip da PRÓXIMA
// chamada real que vai usar o token (a ponte local Electron<->API + o pedido
// a Supabase, tipicamente <1s, mas com folga generosa para uma rede lenta),
// (b) desvio de relógio entre a máquina do POS e o servidor (NTP normalmente
// <1s de deriva, mas sem sincronização garantida em todas as lojas), e (c) a
// possibilidade de várias operações de sync pedirem o token quase ao mesmo
// tempo (single-flight architecte para isso, mas a margem ainda dá folga ao
// refresh single-flight para completar antes de QUALQUER chamador ver um
// token expirado). Face ao TTL mais curto a testar nesta etapa (15 min), 90s
// é 10% do tempo de vida — proporcional, nunca refresca cedo demais a ponto
// de desperdiçar a maior parte da validade do token.
const ACCESS_TOKEN_SAFETY_MARGIN_MS = 90_000;

// Estado em memória — access token NUNCA persiste em disco/safeStorage/SQLite.
// Isolado por userDataPath para nunca misturar identidades entre instalações
// (relevante em dev, onde vários .dev-tenants/<id>/ correm com userDataPath diferentes).
const memoryByUserDataPath = new Map();

function memoryFor(userDataPath) {
  let entry = memoryByUserDataPath.get(userDataPath);
  if (!entry) {
    entry = { accessToken: null, accessTokenExpiresAt: null, refreshInFlight: null };
    memoryByUserDataPath.set(userDataPath, entry);
  }
  return entry;
}

/**
 * Classificação de erro (transitório vs. definitivo) — nomes alinhados com o
 * pedido do utilizador (NETWORK_ERROR / TOKEN_EXPIRED-INVALID / DEVICE_REVOKED /
 * LICENSE_SUSPENDED / TENANT_SUSPENDED / SERVER_ERROR).
 * @returns {'NETWORK_ERROR'|'INVALID_OR_EXPIRED_REFRESH'|'DEVICE_REVOKED'|'LICENSE_OR_TENANT_SUSPENDED'|'RATE_LIMITED'|'SERVER_ERROR'|'INVALID_REQUEST'}
 */
function classifyErrorCode(code) {
  switch (code) {
    case 'invalid_refresh':
    case 'refresh_expired':
    case 'refresh_replay':
    case 'device_not_found':
    case 'device_token_version_mismatch':
      return 'INVALID_OR_EXPIRED_REFRESH';
    case 'device_revoked':
      return 'DEVICE_REVOKED';
    case 'license_suspended':
    case 'license_revoked':
    case 'license_expired':
    case 'tenant_suspended':
    case 'license_not_found':
      return 'LICENSE_OR_TENANT_SUSPENDED';
    case 'rate_limited':
      return 'RATE_LIMITED';
    case 'server_misconfigured':
      return 'SERVER_ERROR';
    case 'invalid_activation':
    case 'activation_expired':
    case 'activation_used':
    case 'activation_revoked':
    case 'max_devices_reached':
    case 'store_not_found':
    case 'store_suspended':
      // Só relevantes no bootstrap — nunca leva a apagar credenciais existentes
      // (não há credenciais existentes neste caminho).
      return 'INVALID_REQUEST';
    default:
      return 'INVALID_REQUEST';
  }
}

/** Erros que exigem apagar a credencial local e voltar a pedir activação. */
function isDefinitiveInvalidCredential(kind) {
  return kind === 'INVALID_OR_EXPIRED_REFRESH' || kind === 'DEVICE_REVOKED';
}

/** Erros transitórios — nunca apagar a credencial, só voltar a tentar mais tarde. */
function isTransient(kind) {
  return kind === 'NETWORK_ERROR' || kind === 'RATE_LIMITED' || kind === 'SERVER_ERROR';
}

async function postJson(issuerBaseUrl, pathSuffix, body) {
  if (!issuerBaseUrl) {
    return { ok: false, network: true, error: 'POS_LICENSE_ISSUER_BASE_URL não configurado.' };
  }
  const url = `${String(issuerBaseUrl).replace(/\/$/, '')}${pathSuffix}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), HTTP_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ok: false, network: false, status: res.status, code: data?.code, error: data?.error };
    }
    return { ok: true, data };
  } catch (err) {
    // fetch failed / abort / DNS / ECONNREFUSED — sempre tratado como rede, nunca
    // como credencial inválida (nunca apaga o refresh token guardado).
    return { ok: false, network: true, error: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * @param {{ activationToken: string, machineId: string, stationCode?: string|null, userDataPath: string, issuerBaseUrl: string }} params
 */
export async function bootstrapDevice({ activationToken, machineId, stationCode = null, userDataPath, issuerBaseUrl }) {
  const token = String(activationToken ?? '').trim();
  const machine = String(machineId ?? '').trim();
  if (!token || !machine) {
    return { ok: false, kind: 'INVALID_REQUEST', error: 'activation_token e machine_id são obrigatórios.' };
  }

  const result = await postJson(issuerBaseUrl, BOOTSTRAP_PATH, {
    activation_token: token,
    machine_id: machine,
    station_code: stationCode,
  });
  // A partir daqui, `token` (activation_token) nunca é referenciado outra vez
  // neste módulo — não é escrito em storage, não é logado, não é devolvido.

  if (!result.ok) {
    if (result.network) return { ok: false, kind: 'NETWORK_ERROR', error: result.error };
    return { ok: false, kind: classifyErrorCode(result.code), code: result.code, error: result.error };
  }

  const data = result.data || {};
  if (!data.device_id || !data.refresh_token || !data.access_token) {
    return { ok: false, kind: 'SERVER_ERROR', error: 'Resposta de bootstrap incompleta.' };
  }

  const written = writeDeviceAuthState(userDataPath, {
    deviceId: String(data.device_id),
    refreshToken: String(data.refresh_token),
    refreshTokenExpiresAt: data.refresh_token_expires_at ?? null,
  });
  if (!written.ok) {
    // CORREÇÃO 1F.2 item 0: sem armazenamento seguro, nunca usar o refresh
    // token recebido (nem sequer o access token desta resposta) — falhar
    // fechado e claro, em vez de deixar o device auth "meio a funcionar" até
    // o access token expirar e não haver nada persistido para o renovar.
    // Nunca lança: quem chamar trata isto como device cloud auth não configurado.
    return {
      ok: false,
      kind: 'SECURE_STORAGE_UNAVAILABLE',
      error: 'Armazenamento seguro (safeStorage) indisponível — device cloud auth não fica configurado.',
    };
  }

  const mem = memoryFor(userDataPath);
  mem.accessToken = String(data.access_token);
  mem.accessTokenExpiresAt = data.access_token_expires_at ?? null;

  return {
    ok: true,
    deviceId: String(data.device_id),
    accessToken: mem.accessToken,
    accessTokenExpiresAt: mem.accessTokenExpiresAt,
  };
}

/**
 * Troca o refresh token guardado por um access token novo. Em sucesso, roda o
 * refresh token (o servidor devolve sempre um novo — Etapa 1E device rotation)
 * e só grava o novo depois de confirmado, nunca apagando o antigo antes de o
 * novo estar persistido (nunca há uma janela sem credencial válida em disco).
 *
 * @param {{ userDataPath: string, issuerBaseUrl: string }} params
 */
export async function refreshAccessToken({ userDataPath, issuerBaseUrl }) {
  const existing = readDeviceAuthState(userDataPath);
  if (!existing.ok) {
    return { ok: false, kind: 'NO_CREDENTIALS' };
  }

  const result = await postJson(issuerBaseUrl, TOKEN_PATH, {
    refresh_token: existing.state.refreshToken,
  });

  if (!result.ok) {
    if (result.network) {
      // Transitório: nunca tocar na credencial guardada.
      return { ok: false, kind: 'NETWORK_ERROR', error: result.error };
    }
    const kind = classifyErrorCode(result.code);
    if (isDefinitiveInvalidCredential(kind)) {
      // A credencial está morta no servidor (revogada/replay/expirada) — mantê-la
      // localmente só arriscaria voltar a tentar para sempre. Limpa e exige novo
      // bootstrap (nova activação, emitida por um admin).
      clearDeviceAuthState(userDataPath);
      const mem = memoryFor(userDataPath);
      mem.accessToken = null;
      mem.accessTokenExpiresAt = null;
      return { ok: false, kind, code: result.code, error: result.error, requiresReactivation: true };
    }
    // LICENSE_OR_TENANT_SUSPENDED / RATE_LIMITED / SERVER_ERROR / INVALID_REQUEST:
    // não apagar — pode voltar a ficar válido (reactivação de licença, fim do
    // rate-limit, etc.) sem exigir um novo bootstrap.
    return { ok: false, kind, code: result.code, error: result.error };
  }

  const data = result.data || {};
  if (!data.access_token || !data.refresh_token) {
    return { ok: false, kind: 'SERVER_ERROR', error: 'Resposta de refresh incompleta.' };
  }

  // Grava o par novo ANTES de expor o access token novo em memória — se o
  // processo morrer entre o fetch e aqui, a credencial antiga (ainda válida no
  // servidor dentro da janela de graça) continua em disco.
  const written = writeDeviceAuthState(userDataPath, {
    deviceId: existing.state.deviceId,
    refreshToken: String(data.refresh_token),
    refreshTokenExpiresAt: data.refresh_token_expires_at ?? null,
    createdAt: existing.state.createdAt,
  });
  if (!written.ok) {
    // CORREÇÃO 1F.2 item 0: o servidor já rodou o refresh token (devolveu B),
    // mas não o podemos gravar em plaintext. Nunca usamos B (seria perdido no
    // próximo restart de qualquer forma) — o credential A antigo permanece
    // intacto em disco (nunca chegámos a sobrescrevê-lo) e pode continuar
    // válido durante a janela de graça do servidor. Tratado como transitório:
    // nunca limpa nem marca requiresReactivation — só falha esta tentativa.
    return {
      ok: false,
      kind: 'SECURE_STORAGE_UNAVAILABLE',
      error: 'Armazenamento seguro (safeStorage) indisponível — refresh não persistido.',
    };
  }

  const mem = memoryFor(userDataPath);
  mem.accessToken = String(data.access_token);
  mem.accessTokenExpiresAt = data.access_token_expires_at ?? null;

  return {
    ok: true,
    deviceId: existing.state.deviceId,
    accessToken: mem.accessToken,
    accessTokenExpiresAt: mem.accessTokenExpiresAt,
  };
}

function accessTokenStillValid(mem) {
  if (!mem.accessToken || !mem.accessTokenExpiresAt) return false;
  const expiresAtMs = Date.parse(mem.accessTokenExpiresAt);
  if (Number.isNaN(expiresAtMs)) return false;
  return Date.now() < expiresAtMs - ACCESS_TOKEN_SAFETY_MARGIN_MS;
}

/**
 * Só espreita: devolve o access token JÁ em memória se ainda for válido (mesma
 * margem de segurança que getValidAccessToken), senão null. NUNCA refresca,
 * nunca toca em rede/disco — usado pela sonda só-leitura, que tem de provar
 * "sem refresh" de forma determinística (getValidAccessToken poderia refrescar
 * se o token cruzasse a margem entre uma verificação e o uso).
 * @param {{ userDataPath: string }} params
 */
export function peekValidAccessToken({ userDataPath }) {
  const mem = memoryFor(userDataPath);
  return accessTokenStillValid(mem) ? mem.accessToken : null;
}

/**
 * Token Provider (Etapa 1F.2 item 1): devolve um access token válido,
 * actualizando-o via refresh se necessário. Nunca lança — falha de cloud auth
 * nunca deve propagar para quem chama e bloquear operação local; devolve null
 * em qualquer falha.
 *
 * Passos (conforme pedido, item 1):
 *  1-3. verifica o access token em memória e a sua expiração;
 *  3.   se ainda válido com margem segura (ACCESS_TOKEN_SAFETY_MARGIN_MS): devolve-o;
 *  4-7. senão executa refresh (rotacionando e persistindo o novo refresh token
 *       dentro de refreshAccessToken), guarda o novo access JWT só em memória,
 *       devolve-o.
 *
 * Single-flight (item 2): concorrência protegida por `mem.refreshInFlight` —
 * a PRIMEIRA chamada com o token expirado cria a promise de refresh; qualquer
 * chamada concorrente subsequente (mesmo userDataPath) reutiliza a MESMA
 * promise em vez de disparar um novo pedido HTTP — nunca há dois refreshes do
 * mesmo refresh token em voo ao mesmo tempo. Ver
 * tests/unit/device-auth-client.test.mjs para o teste de concorrência real
 * (5 chamadas simultâneas → 1 único pedido de rede).
 *
 * @param {{ userDataPath: string, issuerBaseUrl: string }} params
 */
export async function getValidAccessToken({ userDataPath, issuerBaseUrl }) {
  const mem = memoryFor(userDataPath);
  if (accessTokenStillValid(mem)) return mem.accessToken;

  if (!mem.refreshInFlight) {
    mem.refreshInFlight = refreshAccessToken({ userDataPath, issuerBaseUrl }).finally(() => {
      mem.refreshInFlight = null;
    });
  }

  const result = await mem.refreshInFlight;
  return result.ok ? result.accessToken : null;
}

/**
 * Identidade local — nunca inclui o refresh token (só metadados seguros para
 * expor à renderer/UI via IPC).
 * @param {{ userDataPath: string }} params
 */
export function getDeviceIdentity({ userDataPath }) {
  const existing = readDeviceAuthState(userDataPath);
  const mem = memoryFor(userDataPath);
  if (!existing.ok) {
    return {
      hasCredentials: false,
      deviceId: null,
      refreshTokenExpiresAt: null,
      hasAccessToken: false,
    };
  }
  return {
    hasCredentials: true,
    deviceId: existing.state.deviceId,
    refreshTokenExpiresAt: existing.state.refreshTokenExpiresAt,
    hasAccessToken: accessTokenStillValid(mem),
  };
}

/**
 * @param {{ userDataPath: string }} params
 */
export function clearDeviceCredentials({ userDataPath }) {
  clearDeviceAuthState(userDataPath);
  const mem = memoryFor(userDataPath);
  mem.accessToken = null;
  mem.accessTokenExpiresAt = null;
  mem.refreshInFlight = null;
}

/**
 * Diagnóstico de runtime só-leitura (Pilot Gate — VM device auth): nunca
 * chama getValidAccessToken()/refreshAccessToken() — só espreita o estado já
 * em disco (readDeviceAuthState, sem safeStorage extra) e o access token já
 * em memória, se algum. Nunca dispara rede, nunca muda nada. Devolve só
 * booleanos/"unknown" — nunca o JWT, refresh token, device_id, tenant_id ou
 * qualquer claim em bruto.
 *
 * `kid_matches_configured_signer` fica sempre "unknown": este processo nunca
 * recebe o kid que a Supabase confia actualmente — isso só existe no
 * license-console (POS_DEVICE_JWT_KID), nunca partilhado com o POS. Não é uma
 * limitação de rede, é arquitectural — não há fonte de verdade local.
 *
 * @param {{ userDataPath: string, localTenantId?: string|null }} params
 */
export function peekDeviceAuthDiagnostic({ userDataPath, localTenantId = null }) {
  const stored = readDeviceAuthState(userDataPath);
  const mem = memoryFor(userDataPath);

  const result = {
    credentials_present: stored.ok,
    refresh_token_present: stored.ok ? Boolean(stored.state.refreshToken) : false,
    refresh_token_expired: 'unknown',
    // Só verdadeiro se já houve pelo menos uma escrita depois da inicial —
    // writeDeviceAuthState só é chamado em bootstrap (1x) e em refresh bem-
    // sucedido (nunca em falha) — logo isto prova "houve refresh e teve sucesso".
    last_refresh_known: stored.ok ? stored.state.updatedAt !== stored.state.createdAt : false,
    token_present: Boolean(mem.accessToken),
    token_expired: 'unknown',
    alg_is_ES256: 'unknown',
    kid_present: 'unknown',
    kid_matches_configured_signer: 'unknown',
    device_claim_matches_stored_device: 'unknown',
    tenant_claim_matches_local_tenant: 'unknown',
    role_is_authenticated: 'unknown',
    token_version_present: 'unknown',
  };

  result.last_refresh_succeeded = result.last_refresh_known ? true : 'unknown';
  // Nenhum estado/erro de refresh falhado é persistido em lado nenhum deste
  // módulo (por desenho — nunca grava nada em disco numa tentativa falhada) —
  // não há forma de saber isto sem uma tentativa de rede nova, que é proibida aqui.
  result.refresh_error_present = 'unknown';

  if (stored.ok && stored.state.refreshTokenExpiresAt) {
    const exp = Date.parse(stored.state.refreshTokenExpiresAt);
    result.refresh_token_expired = Number.isNaN(exp) ? 'unknown' : Date.now() >= exp;
  }

  if (mem.accessToken) {
    const { header, payload } = decodeJwtLocally(mem.accessToken);
    if (header) {
      result.alg_is_ES256 = header.alg === 'ES256';
      result.kid_present = Boolean(header.kid);
    }
    if (payload) {
      result.token_expired = typeof payload.exp === 'number' ? Date.now() >= payload.exp * 1000 : 'unknown';
      result.role_is_authenticated = payload.role === 'authenticated';
      result.token_version_present = payload.token_version != null;
      if (stored.ok) {
        result.device_claim_matches_stored_device = payload.device_id === stored.state.deviceId;
      }
      if (localTenantId) {
        result.tenant_claim_matches_local_tenant = payload.tenant_id === localTenantId;
      }
    }
  }

  return result;
}

/**
 * Sequência de arranque não-bloqueante (instrução #12 da Etapa 1F.1): tenta
 * obter um access token em segundo plano; nunca atrasa nem falha o arranque
 * do POS. Chamar com `void` — nunca `await` no caminho crítico de arranque.
 *
 * @param {{ userDataPath: string, issuerBaseUrl: string }} params
 * @returns {Promise<{ attempted: boolean, ok: boolean, kind?: string }>}
 */
export async function initDeviceAuthNonBlocking({ userDataPath, issuerBaseUrl }) {
  try {
    const existing = readDeviceAuthState(userDataPath);
    if (!existing.ok) {
      // Sem credencial ainda (instalação por activar, ou a usar só a fila
      // antiga) — nada a fazer; sync cloud fica PAUSED/WAITING_FOR_AUTH, venda
      // local continua normal.
      return { attempted: false, ok: false, kind: 'NO_CREDENTIALS' };
    }
    const token = await getValidAccessToken({ userDataPath, issuerBaseUrl });
    return { attempted: true, ok: Boolean(token) };
  } catch (err) {
    // Nunca deixar uma excepção aqui chegar ao chamador — o arranque do POS
    // não pode falhar por causa disto.
    return { attempted: true, ok: false, kind: 'UNEXPECTED_ERROR', error: String(err?.message ?? err) };
  }
}
