/**
 * Etapa 1G.4 Fase 2 — gate de UX (redireciona para /login sem sessão) + refresh
 * silencioso do access token perto da expiração. NUNCA é a fronteira de segurança real
 * — essa é sempre o Postgres (RLS + backoffice_current_tenant_id()/
 * backoffice_can_access_store()), que qualquer Route Handler/Server Component volta a
 * verificar de qualquer forma. Um bypass deste middleware nunca dá acesso a dados: só
 * pioraria a experiência (ficar preso numa página sem dados).
 */
import { NextResponse, type NextRequest } from 'next/server';
import { ACCESS_COOKIE, anonClient, COOKIE_OPTIONS, REFRESH_COOKIE } from './lib/session';

const PUBLIC_PATHS = ['/login', '/reset'];

function isPublic(pathname: string) {
  return PUBLIC_PATHS.some((p) => pathname === p) || pathname.startsWith('/api/auth/');
}

/** /api/* (fora de /api/auth/*, já público) devolve 401 JSON sem sessão; páginas redireccionam para /login. */
function isApiPath(pathname: string) {
  return pathname.startsWith('/api/');
}

function unauthenticated(req: NextRequest) {
  if (isApiPath(req.nextUrl.pathname)) {
    return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });
  }
  return NextResponse.redirect(new URL('/login', req.url));
}

/** exp (segundos, epoch) do JWT — só decodificado, NUNCA verificado aqui (decisão de UX, não de segurança). */
function jwtExpiry(token: string): number | null {
  try {
    const payload = token.split('.')[1];
    const json = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return typeof json.exp === 'number' ? json.exp : null;
  } catch {
    return null;
  }
}

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (isPublic(pathname)) return NextResponse.next();

  const accessToken = req.cookies.get(ACCESS_COOKIE)?.value;
  const refreshToken = req.cookies.get(REFRESH_COOKIE)?.value;

  if (!accessToken) {
    return unauthenticated(req);
  }

  const exp = jwtExpiry(accessToken);
  const nearExpiry = exp != null && exp * 1000 - Date.now() < 60_000;
  if (!nearExpiry) return NextResponse.next();

  if (!refreshToken) {
    const res = unauthenticated(req);
    res.cookies.delete(ACCESS_COOKIE);
    return res;
  }

  const { data, error } = await anonClient().auth.refreshSession({ refresh_token: refreshToken });
  if (error || !data.session) {
    const res = unauthenticated(req);
    res.cookies.delete(ACCESS_COOKIE);
    res.cookies.delete(REFRESH_COOKIE);
    return res;
  }

  const res = NextResponse.next();
  res.cookies.set(ACCESS_COOKIE, data.session.access_token, COOKIE_OPTIONS);
  res.cookies.set(REFRESH_COOKIE, data.session.refresh_token, COOKIE_OPTIONS);
  return res;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
