/**
 * Etapa 1G.4 Fase 2 — leitura central das variáveis de ambiente do Backoffice.
 * NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY: seguras no browser (mesmo
 * padrão da license-console e do POS — a chave anon nunca é segredo).
 * SUPABASE_SERVICE_ROLE_KEY: NUNCA lida por código que corra no browser — só em Route
 * Handlers / Server Components (ficheiros deste módulo importados só do lado do servidor).
 */
export function supabaseUrl(): string {
  const v = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!v) throw new Error('NEXT_PUBLIC_SUPABASE_URL não configurado');
  return v;
}

export function supabaseAnonKey(): string {
  const v = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!v) throw new Error('NEXT_PUBLIC_SUPABASE_ANON_KEY não configurado');
  return v;
}

/** Só chamar a partir de Route Handlers / Server Components — nunca de um 'use client'. */
export function supabaseServiceRoleKey(): string {
  const v = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!v) throw new Error('SUPABASE_SERVICE_ROLE_KEY não configurado (só necessário server-side)');
  return v;
}
