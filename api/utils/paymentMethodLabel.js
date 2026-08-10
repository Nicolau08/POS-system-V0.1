/**
 * Rótulo / valor normalizado para meios de pagamento (cash → Dinheiro).
 */
export function formatPaymentMethodLabel(raw, fallback = '-') {
  if (raw == null) return fallback;
  const text = String(raw).trim();
  if (!text) return fallback;

  return text
    .split(/\s*\+\s*/)
    .map((part) => formatPaymentMethodPart(part))
    .filter(Boolean)
    .join(' + ');
}

function formatPaymentMethodPart(part) {
  const trimmed = String(part ?? '').trim();
  if (!trimmed) return trimmed;
  const key = trimmed.toLowerCase().replace(/_/g, '-').replace(/\s+/g, ' ');
  if (key === 'cash' || key === 'dinheiro') return 'Dinheiro';
  if (key === 'conta-corrente' || key === 'conta corrente') return 'Conta corrente';
  return trimmed;
}
