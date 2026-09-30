/**
 * Etapa 1G.4 Fase 2 — helpers server-only (Server Components / Route Handlers). Nunca
 * importar este ficheiro de um componente 'use client'.
 */
import { cookies } from 'next/headers';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  ACCESS_COOKIE,
  resolveDetailedSession,
  resolveSession,
  resolveSessionUser,
  sessionedClient,
  type BackofficeSessionUser,
  type DetailedSessionResolution,
  type SessionResolution,
} from './session';
import { supabaseServiceRoleKey, supabaseUrl } from './env';

/** Lê a sessão a partir das cookies do pedido actual. Null = não autenticado OU sem acesso. */
export async function getCurrentUser(): Promise<BackofficeSessionUser | null> {
  const store = await cookies();
  const accessToken = store.get(ACCESS_COOKIE)?.value;
  return resolveSessionUser(accessToken);
}

/**
 * Igual a getCurrentUser(), mas distingue "não autenticado" (401) de "autenticado sem
 * acesso" (403) — usar em Route Handlers de /api/* que precisem dessa distinção; páginas
 * continuam a usar getCurrentUser() (para elas, qualquer não-ok é sempre "vai para /login").
 */
export async function getCurrentSession(): Promise<SessionResolution> {
  const store = await cookies();
  const accessToken = store.get(ACCESS_COOKIE)?.value;
  return resolveSession(accessToken);
}

/**
 * Etapa 1G.4 Fase 8 — variante que distingue 'first_access_required'. Usar SÓ no login e
 * no fluxo de primeiro acesso (página + Route Handlers de /api/auth/first-access/*);
 * todo o resto do Backoffice continua a usar getCurrentUser()/getSessionClient().
 */
export async function getDetailedSession(): Promise<DetailedSessionResolution> {
  const store = await cookies();
  const accessToken = store.get(ACCESS_COOKIE)?.value;
  return resolveDetailedSession(accessToken);
}

export type SessionClientResolution =
  | { status: 'unauthenticated' }
  | { status: 'forbidden' }
  | { status: 'ok'; user: BackofficeSessionUser; client: SupabaseClient };

/**
 * Etapa 1G.4 Fase 3A — sessão + cliente pronto com a MESMA sessão (RLS aplica-se sempre).
 * products/categories/store_products já têm policy própria do Backoffice — não precisam
 * de service_role (ao contrário de `stores`, que continua REVOKE ALL de authenticated).
 */
export async function getSessionClient(): Promise<SessionClientResolution> {
  const store = await cookies();
  const accessToken = store.get(ACCESS_COOKIE)?.value;
  const result = await resolveSession(accessToken);
  if (result.status !== 'ok') return result;
  return { status: 'ok', user: result.user, client: sessionedClient(accessToken as string) };
}

/**
 * service_role — só aqui, só server-side, só quando realmente necessário (ex.: ler
 * `stores`, que nunca concede SELECT a `authenticated` — fronteira do Device Auth,
 * intocada). Todo o uso desta função tem de filtrar explicitamente pelo tenant/store já
 * validado por getCurrentUser()/backoffice_can_access_store() — nunca uma query aberta.
 */
export function serviceRoleClient(): SupabaseClient {
  return createClient(supabaseUrl(), supabaseServiceRoleKey(), { auth: { persistSession: false } });
}
