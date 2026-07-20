/**
 * Paleta e helpers de cor para grupos (categorias) — API (CommonJS).
 */

export const CATEGORY_COLOR_PALETTE = [
  '#2563eb',
  '#3b82f6',
  '#0284c7',
  '#0891b2',
  '#0d9488',
  '#14b8a6',
  '#059669',
  '#10b981',
  '#65a30d',
  '#84cc16',
  '#ca8a04',
  '#eab308',
  '#d97706',
  '#ea580c',
  '#f97316',
  '#dc2626',
  '#ef4444',
  '#e11d48',
  '#db2777',
  '#ec4899',
  '#c026d3',
  '#9333ea',
  '#a855f7',
  '#7c3aed',
  '#4f46e5',
  '#6366f1',
  '#64748b',
  '#78716c',
];

export function normalizeHex(value) {
  if (value == null) return null;
  let raw = String(value).trim();
  if (!raw) return null;
  if (!raw.startsWith('#')) raw = `#${raw}`;
  if (!/^#[0-9A-Fa-f]{6}$/.test(raw)) return null;
  return raw.toLowerCase();
}

export function hashSeed(seed) {
  let hash = 0;
  const s = String(seed ?? '');
  for (let i = 0; i < s.length; i += 1) {
    hash = (hash << 5) - hash + s.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

export function pickCategoryColor(seed) {
  const idx = hashSeed(seed) % CATEGORY_COLOR_PALETTE.length;
  return CATEGORY_COLOR_PALETTE[idx];
}

export function resolveCategoryColor(color, nameFallback) {
  return normalizeHex(color) ?? pickCategoryColor(nameFallback || 'grupo');
}
