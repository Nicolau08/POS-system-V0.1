/**
 * Etapa 1G.4 Fase 2 — logout: limpa as cookies e invalida a sessão no lado do Supabase
 * Auth (best-effort — mesmo que a chamada ao GoTrue falhe, as cookies são sempre limpas).
 */
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { ACCESS_COOKIE, REFRESH_COOKIE } from '@/lib/session';
import { serviceRoleClient } from '@/lib/serverSession';

export async function POST() {
  const store = await cookies();
  const accessToken = store.get(ACCESS_COOKIE)?.value;
  if (accessToken) {
    try {
      // admin.signOut precisa de service_role — o cliente da própria sessão não tem
      // estado interno (nunca chamámos setSession(), só um cabeçalho Authorization
      // manual), por isso client.auth.signOut() seria um no-op silencioso.
      await serviceRoleClient().auth.admin.signOut(accessToken, 'global');
    } catch {
      // best-effort — as cookies são limpas de qualquer forma
    }
  }
  store.delete(ACCESS_COOKIE);
  store.delete(REFRESH_COOKIE);
  return NextResponse.json({ ok: true });
}
