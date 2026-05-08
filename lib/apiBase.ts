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
 * Sem isto, pedidos feitos a partir de outro host que não 127.0.0.1/localhost falham com 401
 * porque o fallback "legacy local" não se aplica.
 */
export function getPosUserAuthHeaders(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  try {
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
