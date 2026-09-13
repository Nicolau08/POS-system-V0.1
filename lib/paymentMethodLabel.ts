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

function normalizePaymentMethodKey(raw: unknown): string {
  return String(raw ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/_/g, '-')
    .replace(/\s+/g, ' ');
}

const PAYMENT_METHOD_FALLBACK_COLORS = ['#6c70f6', '#e88989', '#f5f4fb', '#8386f8', '#d97a7a', '#c4c6fc'];

/** Cor consistente por método de pagamento (gráficos, legendas). */
export function getPaymentMethodColor(raw: unknown, fallbackIndex = 0): string {
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

/** Texto legível sobre a cor do método (amarelo claro → texto escuro). */
export function getPaymentMethodContrastColor(hex: string): string {
  const raw = String(hex ?? '').replace('#', '').trim();
  if (raw.length !== 6) return '#ffffff';
  const r = Number.parseInt(raw.slice(0, 2), 16);
  const g = Number.parseInt(raw.slice(2, 4), 16);
  const b = Number.parseInt(raw.slice(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.55 ? '#1a1a1a' : '#ffffff';
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
