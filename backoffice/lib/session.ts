/**
 * Etapa 1G.4 Fase 2 — sessão humana do Backoffice (Supabase Auth), SEPARADA do Device
 * Auth/POS. Sem @supabase/ssr (dependência nova não usada no resto do repo) — gestão de
 * cookies feita aqui, à mão, com @supabase/supabase-js puro (mesmo pacote já usado em
 * todo o projecto).
 *
 * Duas cookies httpOnly: bo_at (access token) e bo_rt (refresh token). Nunca legíveis por
 * JavaScript do browser. A verificação REAL de quem pode ver o quê é sempre feita pelo
 * Postgres (RLS + backoffice_current_tenant_id()/backoffice_can_access_store()) — este
 * módulo só resolve "quem está autenticado", nunca decide autorização por si.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { supabaseAnonKey, supabaseUrl } from './env';

export const ACCESS_COOKIE = 'bo_at';
export const REFRESH_COOKIE = 'bo_rt';

export const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/',
};

/** Cliente anónimo simples — nunca persiste sessão (as cookies são geridas por nós). */
export function anonClient(): SupabaseClient {
  return createClient(supabaseUrl(), supabaseAnonKey(), { auth: { persistSession: false } });
}

/** Cliente com a sessão do utilizador actual (RLS aplica-se sempre a este cliente). */
export function sessionedClient(accessToken: string): SupabaseClient {
  return createClient(supabaseUrl(), supabaseAnonKey(), {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false },
  });
}

export type BackofficeSessionUser = {
  userId: string;
  tenantId: string;
  role: string;
  username: string | null;
};

export type SessionResolution =
  | { status: 'unauthenticated' } // sem cookie, ou token inválido/expirado — 401
  | { status: 'forbidden' } // sessão Supabase Auth válida, mas sem membership activa (ou primeiro acesso por concluir) — 403
  | { status: 'ok'; user: BackofficeSessionUser };

/**
 * Variante detalhada, usada SÓ pelo login e pelo fluxo de primeiro acesso — distingue
 * "primeiro acesso por concluir" de "ok"/"forbidden". Todos os outros ~15 Route
 * Handlers/páginas continuam a usar resolveSession()/resolveSessionUser() sem qualquer
 * alteração: para eles, "primeiro acesso por concluir" dobra-se em 'forbidden', o mesmo
 * 403 de sempre — defesa em profundidade automática, sem tocar em nenhum ficheiro
 * existente (o proxy.ts já redirecciona /login->/first-access no caminho normal).
 */
export type DetailedSessionResolution =
  | { status: 'unauthenticated' }
  | { status: 'forbidden' }
  | {
      status: 'first_access_required';
      user: BackofficeSessionUser;
      mustChangePassword: boolean;
      recoveryEmail: string | null;
      recoveryEmailVerified: boolean;
    }
  | { status: 'ok'; user: BackofficeSessionUser };

type MembershipRow = {
  tenant_id: string;
  role: string;
  username: string | null;
  status: string;
  requires_first_access: boolean;
  must_change_password: boolean;
  recovery_email: string | null;
  recovery_email_verified: boolean;
};

async function loadMembership(client: SupabaseClient, userId: string): Promise<MembershipRow | null> {
  const { data, error } = await client
    .from('backoffice_users')
    .select('tenant_id,role,username,status,requires_first_access,must_change_password,recovery_email,recovery_email_verified')
    .eq('user_id', userId)
    .maybeSingle();
  if (error || !data) return null;
  return data as MembershipRow;
}

/**
 * Resolve a sessão actual a partir do access token da cookie, distinguindo "não
 * autenticado" (401), "autenticado mas sem acesso ou primeiro acesso por concluir" (403)
 * e "ok" (200) — sem nunca distinguir o motivo exacto ao chamador, para nunca dar pistas.
 */
export async function resolveDetailedSession(accessToken: string | undefined): Promise<DetailedSessionResolution> {
  if (!accessToken) return { status: 'unauthenticated' };
  const client = sessionedClient(accessToken);
  // getUser() SEM argumento usa a sessão interna do SDK (vazia — nunca chamámos
  // setSession()), ignorando o cabeçalho Authorization definido acima em sessionedClient;
  // tem de receber o token explicitamente para validar ESTE access token.
  const { data: userData, error: userError } = await client.auth.getUser(accessToken);
  if (userError || !userData?.user) return { status: 'unauthenticated' };

  const row = await loadMembership(client, userData.user.id);
  if (!row || row.status !== 'active') return { status: 'forbidden' };

  const user: BackofficeSessionUser = { userId: userData.user.id, tenantId: row.tenant_id, role: row.role, username: row.username };
  if (row.requires_first_access && (row.must_change_password || !row.recovery_email_verified)) {
    return {
      status: 'first_access_required',
      user,
      mustChangePassword: row.must_change_password,
      recoveryEmail: row.recovery_email,
      recoveryEmailVerified: row.recovery_email_verified,
    };
  }
  return { status: 'ok', user };
}

export async function resolveSession(accessToken: string | undefined): Promise<SessionResolution> {
  const detailed = await resolveDetailedSession(accessToken);
  if (detailed.status === 'ok' || detailed.status === 'unauthenticated') return detailed;
  return { status: 'forbidden' };
}

/** Atalho para quem só precisa de "autenticado ou não" (páginas: qualquer não-ok redirecciona para /login). */
export async function resolveSessionUser(accessToken: string | undefined): Promise<BackofficeSessionUser | null> {
  const result = await resolveSession(accessToken);
  return result.status === 'ok' ? result.user : null;
}
