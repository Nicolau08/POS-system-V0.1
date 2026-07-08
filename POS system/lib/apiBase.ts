/**
 * URL base da API Express (SQLite). No browser usa o proxy do Next (`/pos-backend`)
 * para evitar 404/CORS e falhas com `localhost` em alguns ambientes.
 */
export function getPosApiBase(): string {
  if (typeof window !== 'undefined') {
    return `${window.location.origin}/pos-backend`;
  }
  return process.env.NEXT_PUBLIC_POS_API_URL || process.env.POS_API_URL || 'http://127.0.0.1:3001';
}

/**
 * URL direta da API (sem proxy Next). PUT /company-profile com logo em base64 pode receber
 * HTTP 413 no proxy do dev server; gravações grandes devem usar esta base.
 */
export function getPosApiDirectBase(): string {
  return (
    process.env.NEXT_PUBLIC_POS_API_DIRECT_URL ||
    process.env.NEXT_PUBLIC_POS_API_URL ||
    'http://127.0.0.1:3001'
  );
}

/**
 * Cabeçalhos para a API Express resolver o utilizador (middleware `authenticateUser`).
 * Só envia `x-user-id` com sessão activa (`isLoggedIn`), para não bloquear o fallback
 * local quando há `currentUser` obsoleto no localStorage.
 */
export function getPosUserAuthHeaders(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  try {
    if (localStorage.getItem('isLoggedIn') !== 'true') return {};
    const raw = window.localStorage.getItem('currentUser');
    if (!raw) return {};
    const u = JSON.parse(raw) as { id?: string };
    const id = String(u?.id ?? '').trim();
    if (!id) return {};
    return { 'x-user-id': id };
  } catch {
    return {};
  }
}

/** Limpa sessão local obsoleta (ex.: utilizador removido ou BD resetada). */
export function clearPosAuthSession(): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem('isLoggedIn', 'false');
  localStorage.removeItem('currentUser');
  window.dispatchEvent(new Event('pos-auth-changed'));
}
