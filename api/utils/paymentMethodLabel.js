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

function normalizePaymentMethodKey(raw) {
  return String(raw ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/_/g, '-')
    .replace(/\s+/g, ' ');
}

const PAYMENT_METHOD_FALLBACK_COLORS = ['#6c70f6', '#e88989', '#f5f4fb', '#8386f8', '#d97a7a', '#c4c6fc'];

export function getPaymentMethodColor(raw, fallbackIndex = 0) {
  const key = normalizePaymentMethodKey(raw);
  const labelKey = normalizePaymentMethodKey(formatPaymentMethodLabel(raw, ''));

  if (key.includes('mpesa') || key.includes('m-pesa') || labelKey.includes('m-pesa')) return '#e60000';
  if (key.includes('emola') || key.includes('e-mola') || labelKey.includes('emola')) return '#f37227';
  if (
    (key.includes('conta') && key.includes('corrente')) ||
    labelKey.includes('conta corrente')
  ) {
    return '#eab308';
  }
  if (key === 'cash' || key === 'dinheiro' || key.includes('dinheiro') || labelKey === 'dinheiro') {
    return '#66c013';
  }
  if (key.includes('pos') || labelKey.includes('pos')) return '#8386f8';
  if (key.includes('cartao') || key.includes('card') || labelKey.includes('cartao')) return '#c4c6fc';
  if (key.includes('pix')) return '#a5b4fc';

  return PAYMENT_METHOD_FALLBACK_COLORS[fallbackIndex % PAYMENT_METHOD_FALLBACK_COLORS.length];
}
