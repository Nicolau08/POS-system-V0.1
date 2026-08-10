/**
 * Rótulo amigável para meios de pagamento.
 * Ex.: cash / DINHEIRO → Dinheiro (também em pagamentos compostos com "+").
 */
export function formatPaymentMethodLabel(raw: unknown, fallback = '-'): string {
  if (raw == null) return fallback;
  const text = String(raw).trim();
  if (!text) return fallback;

  return text
    .split(/\s*\+\s*/)
    .map((part) => formatPaymentMethodPart(part))
    .filter(Boolean)
    .join(' + ');
}

function formatPaymentMethodPart(part: string): string {
  const trimmed = String(part ?? '').trim();
  if (!trimmed) return trimmed;
  const key = trimmed.toLowerCase().replace(/_/g, '-').replace(/\s+/g, ' ');
  if (key === 'cash' || key === 'dinheiro') return 'Dinheiro';
  if (key === 'conta-corrente' || key === 'conta corrente') return 'Conta corrente';
  return trimmed;
}

/** True se o código/nome representar dinheiro (cash). */
export function isCashPaymentMethodCode(raw: unknown): boolean {
  const key = String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/_/g, '-')
    .replace(/\s+/g, ' ');
  return key === 'cash' || key === 'dinheiro' || key.includes('cash') || key.includes('dinheiro');
}
