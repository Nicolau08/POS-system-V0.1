/**
 * Registo de chaves PÚBLICAS Ed25519 da licença offline (Etapa 1F.5a, itens
 * 9-10). Não são segredo — mas têm de ser imutáveis no build e nunca vir de
 * fonte editável em runtime (.env, SQLite, localStorage, config do
 * utilizador). key_id desconhecido é sempre FAIL CLOSED (nunca aceita).
 *
 * Suporta rotação: mais do que um key_id pode estar activo em simultâneo
 * (chave antiga + nova coexistem durante uma transição — ver
 * tests/unit/offline-license-crypto.test.mjs, "key rotation").
 *
 * Ainda SEM chave de produção real emitida (o projecto ainda não lançou
 * comercialmente — ver memória "Fresh Supabase" da Etapa 1F.4: chaves reais
 * só são geradas/embarcadas no processo de preparação do lançamento). Este
 * objecto está deliberadamente congelado (Object.freeze) e vazio por agora —
 * populá-lo com uma chave real e dar-lhe um key_id versionado (ex.:
 * "offline-2026-01") é uma acção de preparação de release, não desta etapa.
 */
export const OFFLINE_LICENSE_PUBLIC_KEYS = Object.freeze({
  'posly-license-prod-v1': '-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAp49+Qz7e3gw36S0GDN/HqaTS8QoyLh+7BynMITR3gko=\n-----END PUBLIC KEY-----\n',
  // 'offline-2026-01': '-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----\n',
});

/**
 * @param {string} keyId
 * @returns {string | null}
 */
export function resolveEmbeddedOfflineLicensePublicKeyPem(keyId) {
  const key = String(keyId ?? '').trim();
  if (!key) return null;
  return Object.prototype.hasOwnProperty.call(OFFLINE_LICENSE_PUBLIC_KEYS, key)
    ? OFFLINE_LICENSE_PUBLIC_KEYS[key]
    : null;
}

/**
 * Chave pública de DESENVOLVIMENTO/TESTE (Etapa 1F.5b, item 12) — nunca uma
 * chave de produção. A PRIVADA correspondente vive só no ambiente de teste
 * do license-console (POS_OFFLINE_LICENSE_PRIVATE_KEY em .env.local, nunca
 * gerada dentro do POS). Fonte: POS_DEV_OFFLINE_LICENSE_PUBLIC_KEY/
 * POS_DEV_OFFLINE_LICENSE_KEY_ID no .env do POS de desenvolvimento.
 *
 * Fail-closed por construção em produção: usa exactamente o mesmo duplo
 * gate já usado por allowUnsignedLicenseFallback() (api/services/
 * setup.service.js) — NODE_ENV=production OU POS_APP_MODE=pos desactivam
 * isto incondicionalmente, e um build empacotado força sempre
 * NODE_ENV=production (electron/main.js). Nenhuma variável de ambiente
 * consegue reactivar esta chave de teste num instalador real.
 */
function isDevOrTestRuntime() {
  const nodeEnv = String(process.env.NODE_ENV ?? '').toLowerCase();
  const appMode = String(process.env.POS_APP_MODE ?? '').toLowerCase();
  return nodeEnv !== 'production' && appMode !== 'pos';
}

/**
 * @param {string} keyId
 * @returns {string | null}
 */
export function resolveDevOfflineLicensePublicKeyPem(keyId) {
  if (!isDevOrTestRuntime()) return null;
  const configuredKeyId = String(process.env.POS_DEV_OFFLINE_LICENSE_KEY_ID ?? '').trim();
  const configuredPem = String(process.env.POS_DEV_OFFLINE_LICENSE_PUBLIC_KEY ?? '').trim();
  if (!configuredKeyId || !configuredPem) return null;
  return String(keyId ?? '').trim() === configuredKeyId ? configuredPem : null;
}

/**
 * Resolvedor completo usado pelo POS em runtime: regista embarcada primeiro
 * (produção), depois a de dev/teste (nunca activa num build empacotado).
 * key_id desconhecido em ambos -> null (fail closed).
 * @param {string} keyId
 * @returns {string | null}
 */
export function resolveOfflineLicensePublicKeyPem(keyId) {
  return resolveEmbeddedOfflineLicensePublicKeyPem(keyId) ?? resolveDevOfflineLicensePublicKeyPem(keyId);
}
