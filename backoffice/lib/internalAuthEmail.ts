/**
 * Etapa 1G.4 Fase 9 — email interno do GoTrue DETERMINÍSTICO para utilizadores criados
 * pelo owner (ao contrário do email aleatório da Fase 8/License Console — ver
 * 20261006000100_backoffice_user_management.sql). Permite recuperar um Auth user órfão
 * num retry: o MESMO (tenant_id, username) produz sempre o MESMO email, por isso um
 * segundo admin.createUser() falha previsivelmente com "already registered" em vez de
 * criar um duplicado — esse erro é o sinal para ir buscar o id existente.
 */
import crypto from 'crypto';

export function deterministicInternalEmail(tenantId: string, username: string): string {
  const hash = crypto.createHash('sha256').update(`${tenantId}:${username.trim().toLowerCase()}`).digest('hex');
  return `${hash}@users.posly.internal`;
}
