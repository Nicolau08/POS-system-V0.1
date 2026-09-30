import { resolveLicensePath } from './setup.service.js';

function normalizeText(value) {
  return String(value ?? '').trim();
}

/**
 * Etapa 1F.5c (item 7): qualquer conteúdo encontrado em `license.json` é
 * SEMPRE legado (o formato HMAC antigo) — desde esta etapa o POS nunca mais
 * escreve neste ficheiro (usa `offline-license.json`, Ed25519, gerido por
 * setup.service.js/installOfflineLicenseState). Nunca valida, decifra ou
 * converte um ficheiro legado encontrado — não estamos em produção, não
 * precisamos preservar compatibilidade; exige sempre novo onboarding
 * legítimo via Device Auth. Mantida (nunca removida) porque continua a ser
 * usada como fallback de leitura por api/middlewares/auth.js e
 * api/services/tenant.service.js — para ambos, `ok:false` significa
 * simplesmente "sem fallback aqui, usa a BD".
 */
export async function readLocalLicenseFile() {
  const fs = await import('fs/promises');
  const licensePath = resolveLicensePath();
  try {
    await fs.access(licensePath);
    return { ok: false, error: 'LEGACY_LICENSE_UNSUPPORTED', legacy: true, licensePath };
  } catch (err) {
    if (err?.code === 'ENOENT') {
      return { ok: false, error: 'Licença não encontrada nesta instalação.', licensePath };
    }
    return { ok: false, error: err instanceof Error ? err.message : 'Falha ao ler licença local.', licensePath };
  }
}

/**
 * Etapa 1F.5c (item 11): antes desta etapa, sincronizava plano/expiração a
 * partir da consola para os modos legado (serial/HMAC) — ambos removidos do
 * POS. Sem substituto de renovação cloud definido ainda para Ed25519 (fora
 * do escopo desta etapa); mantida como stub sem rede/HMAC para não obrigar a
 * alterar os chamadores existentes (tenant.service.js, setup.controller.js),
 * que já tratam `skipped:true` como "sem novidade, continua com dados locais".
 */
export async function syncLicenseRegistry() {
  return { synced: false, skipped: true, error: null, expiresAt: null };
}

/**
 * Resolve a expiração local autoritativa: BD primeiro, ficheiro legado nunca
 * (readLocalLicenseFile nunca devolve payload). Pura, sem HMAC.
 */
export function resolveLocalLicenseExpiry(setupRow, licenseFile = null) {
  const fromDb = normalizeText(setupRow?.license_expires_at);
  const fromFile = licenseFile
    ? normalizeText(licenseFile.expiration || licenseFile.expires_at)
    : '';
  const candidate = fromDb || fromFile;
  if (!candidate) return { licenseExpiresAt: null, licenseExpired: false };
  const ms = Date.parse(candidate);
  if (Number.isNaN(ms)) return { licenseExpiresAt: null, licenseExpired: false };
  return {
    licenseExpiresAt: new Date(ms).toISOString(),
    licenseExpired: Date.now() > ms,
  };
}
