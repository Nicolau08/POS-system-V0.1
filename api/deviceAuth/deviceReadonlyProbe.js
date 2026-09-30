/**
 * Sonda só-leitura do Device JWT em runtime (Pilot Gate — prova isolada):
 * UM `categories?select=id&limit=1` com o access token que JÁ está em cache no
 * Electron, montado exactamente como o cliente de sync (mesma URL/anon key,
 * mesmo `Authorization: Bearer`), mas com um fornecedor de token que NUNCA
 * refresca (getDeviceAccessTokenCachedOnlyViaBridge). Devolve só sucesso,
 * estado HTTP e contagem de linhas — nunca o token, nunca o conteúdo.
 */
import { createClient } from '@supabase/supabase-js';
import { getDeviceAccessTokenCachedOnlyViaBridge } from './deviceAuthBridgeClient.js';
import { resolveSupabaseUrl, resolveAnonKey } from './deviceSupabaseClient.js';

/**
 * @returns {Promise<
 *   { available: false, reason: 'supabase_not_configured' | 'device_token_not_cached' } |
 *   { available: true, success: boolean, status: number | null, row_count: number | null }
 * >}
 */
export async function runDeviceReadonlyCategoriesProbe() {
  const url = resolveSupabaseUrl();
  const anonKey = resolveAnonKey();
  if (!url || !anonKey) return { available: false, reason: 'supabase_not_configured' };

  const token = await getDeviceAccessTokenCachedOnlyViaBridge();
  if (!token) return { available: false, reason: 'device_token_not_cached' };

  const client = createClient(url, anonKey, {
    global: {
      fetch: (input, options = {}) => {
        const headers = new Headers(options.headers);
        headers.set('Authorization', `Bearer ${token}`);
        return fetch(input, { ...options, headers });
      },
    },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    const { data, error, status } = await client.from('categories').select('id').limit(1);
    return {
      available: true,
      success: !error,
      status: typeof status === 'number' ? status : null,
      row_count: !error && Array.isArray(data) ? data.length : null,
    };
  } catch {
    // Falha de rede/transporte — nunca propaga detalhe, nunca o token.
    return { available: true, success: false, status: null, row_count: null };
  }
}
