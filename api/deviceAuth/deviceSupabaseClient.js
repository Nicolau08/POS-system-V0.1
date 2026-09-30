/**
 * Cliente Supabase autenticado por Device JWT (Etapa 1F.2, itens 6-7) — a
 * ÚNICA autoridade cloud do novo caminho de sync é o access JWT do device
 * (via a ponte, deviceAuthBridgeClient.js), nunca SUPABASE_SERVICE_ROLE_KEY.
 *
 * Separação explícita (item 7) face ao antigo cliente legado privilegiado
 * (api/supabaseClient.js — removido na Etapa 1F.4, já sem importadores desde
 * a migração de api/stockController.js na Etapa 1F.3): este módulo é um
 * ficheiro à parte, nunca importa nem lê SUPABASE_SERVICE_ROLE_KEY. Se o Device JWT não estiver disponível, o
 * cliente NUNCA faz fallback silencioso para outra credencial — o `fetch`
 * personalizado lança DeviceAuthUnavailableError ANTES de sair para a rede
 * (nunca chega sequer a chamar o Supabase sem Authorization válido).
 *
 * `anon`/`publishable` key não é segredo (item 6) — pode viver neste
 * processo como qualquer outra config pública; a autorização real vem do
 * Authorization: Bearer <device JWT>, validado por RLS no Postgres.
 */
import { createClient } from '@supabase/supabase-js';
import { getDeviceAccessTokenViaBridge } from './deviceAuthBridgeClient.js';
import { DeviceAuthUnavailableError } from './deviceSyncErrors.js';

let cachedClient = null;
let cachedForUrl = null;

// Cache curta (mesmo padrão de isInternetAvailable em syncService.js) — evita
// um pedido loopback extra por cada uma das várias chamadas Supabase que um
// único ciclo de sync faz, sem deixar de reagir rápido a uma revogação real.
const AVAILABILITY_CACHE_MS = 2000;
let lastAvailabilityCheckAt = 0;
let lastAvailabilityResult = false;

export function resolveSupabaseUrl() {
  return String(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
}

export function resolveAnonKey() {
  return String(process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '').trim();
}

async function deviceAuthenticatedFetch(url, options = {}) {
  const accessToken = await getDeviceAccessTokenViaBridge();
  if (!accessToken) {
    // NUNCA prosseguir sem token — nunca chamar o Supabase só com a anon key
    // (isso simplesmente bateria em RLS deny-by-default, mas gastaria uma
    // chamada de rede real por nada; falhar já aqui é mais rápido e mais claro).
    throw new DeviceAuthUnavailableError();
  }
  const headers = new Headers(options.headers);
  headers.set('Authorization', `Bearer ${accessToken}`);
  return fetch(url, { ...options, headers });
}

/**
 * @returns {import('@supabase/supabase-js').SupabaseClient | null}
 */
export function getDeviceSupabase() {
  const url = resolveSupabaseUrl();
  const anonKey = resolveAnonKey();
  if (!url || !anonKey) return null;

  if (cachedClient && cachedForUrl === url) return cachedClient;

  cachedClient = createClient(url, anonKey, {
    global: { fetch: deviceAuthenticatedFetch },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  cachedForUrl = url;
  return cachedClient;
}

/**
 * Pré-voo barato (item 8/22): confirma que HÁ um access token obtenível
 * ANTES de um ciclo inteiro de sync começar a chamar Supabase, para poder
 * pausar o ciclo de forma limpa em vez de deixar cada chamada individual
 * falhar com DeviceAuthUnavailableError.
 */
export async function isDeviceAuthAvailable() {
  const now = Date.now();
  if (now - lastAvailabilityCheckAt < AVAILABILITY_CACHE_MS) {
    return lastAvailabilityResult;
  }
  const token = await getDeviceAccessTokenViaBridge();
  lastAvailabilityResult = Boolean(token);
  lastAvailabilityCheckAt = Date.now();
  return lastAvailabilityResult;
}

/** Só para testes — nunca chamado em código de produção. */
export function __resetDeviceSupabaseClientForTests() {
  cachedClient = null;
  cachedForUrl = null;
  lastAvailabilityCheckAt = 0;
  lastAvailabilityResult = false;
}
