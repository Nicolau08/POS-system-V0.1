/**
 * Detecta o formato de um Device Activation Token (Etapa 1F.5b) — o mesmo
 * campo único "Chave ou token" do ActivationScreen aceita agora este formato
 * além de número de série / token de reactivação / Base64-JSON legado
 * (mesmo padrão de auto-detecção já usado por reactivationToken.js /
 * licenseSerial.service.js — nunca um campo novo na UI).
 *
 * Formato real: crypto.randomBytes(32).toString('base64url') do
 * license-console (lib/deviceAuth/activation.ts) — 43 caracteres
 * [A-Za-z0-9_-], sem "=". Nunca colide com o formato de série (X_XXXXXXXX,
 * um único "_" numa posição fixa) nem com o token de reactivação (12
 * dígitos).
 */
const DEVICE_ACTIVATION_TOKEN_LENGTH = 43;
const DEVICE_ACTIVATION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function normalizeDeviceActivationTokenInput(raw) {
  const trimmed = String(raw ?? '').trim();
  if (trimmed.length !== DEVICE_ACTIVATION_TOKEN_LENGTH) return null;
  if (!DEVICE_ACTIVATION_TOKEN_PATTERN.test(trimmed)) return null;
  // Nunca só dígitos (evita colidir com um eventual token de reactivação
  // maior) nem um único underscore isolado a meio (formato de série).
  if (/^\d+$/.test(trimmed)) return null;
  return trimmed;
}

export function isDeviceActivationTokenInput(raw) {
  return normalizeDeviceActivationTokenInput(raw) != null;
}
