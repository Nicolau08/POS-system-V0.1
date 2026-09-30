/**
 * Etapa 1G.4 Fase 8 — tokens de reset/verificação. Só o hash é persistido
 * (public.backoffice_auth_tokens.token_hash); o valor em claro só existe em memória e no
 * link enviado por email — nunca em logs/DB.
 */
import crypto from 'crypto';

export function generateToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function tokenExpiryIso(minutes = 30): string {
  return new Date(Date.now() + minutes * 60_000).toISOString();
}
