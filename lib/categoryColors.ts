/**
 * Paleta e helpers de cor para grupos (categorias) de produtos.
 */

export const CATEGORY_COLOR_PALETTE = [
  '#2563eb', // blue
  '#3b82f6', // blue lighter
  '#0284c7', // sky
  '#0891b2', // cyan
  '#0d9488', // teal
  '#14b8a6', // teal lighter
  '#059669', // emerald
  '#10b981', // green
  '#65a30d', // lime
  '#84cc16', // lime bright
  '#ca8a04', // yellow
  '#eab308', // yellow bright
  '#d97706', // amber
  '#ea580c', // orange
  '#f97316', // orange bright
  '#dc2626', // red
  '#ef4444', // red bright
  '#e11d48', // rose
  '#db2777', // pink
  '#ec4899', // pink bright
  '#c026d3', // fuchsia
  '#9333ea', // purple
  '#a855f7', // purple bright
  '#7c3aed', // violet
  '#4f46e5', // indigo
  '#6366f1', // indigo bright
  '#64748b', // slate
  '#78716c', // stone
] as const;

export function normalizeHex(value: unknown): string | null {
  if (value == null) return null;
  let raw = String(value).trim();
  if (!raw) return null;
  if (!raw.startsWith('#')) raw = `#${raw}`;
  if (!/^#[0-9A-Fa-f]{6}$/.test(raw)) return null;
  return raw.toLowerCase();
}

export function hashSeed(seed: string): number {
  let hash = 0;
  const s = String(seed ?? '');
  for (let i = 0; i < s.length; i += 1) {
    hash = (hash << 5) - hash + s.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

/** Cor estável a partir de um seed (ex.: nome do grupo). */
export function pickCategoryColor(seed: string): string {
  const idx = hashSeed(seed) % CATEGORY_COLOR_PALETTE.length;
  return CATEGORY_COLOR_PALETTE[idx];
}

/** Cor aleatória da paleta (para “Gerar outra”). */
export function randomCategoryColor(exclude?: string | null): string {
  const normalizedExclude = normalizeHex(exclude);
  const options = CATEGORY_COLOR_PALETTE.filter(
    (c) => c.toLowerCase() !== (normalizedExclude ?? '').toLowerCase()
  );
  const pool = options.length > 0 ? options : CATEGORY_COLOR_PALETTE;
  return pool[Math.floor(Math.random() * pool.length)];
}

/** Preferência: cor guardada; senão fallback estável pelo nome. */
export function resolveCategoryColor(color: unknown, nameFallback: string): string {
  return normalizeHex(color) ?? pickCategoryColor(nameFallback || 'grupo');
}

/** Converte #rrggbb em rgba() para fundos translucidos nos chips. */
export function hexToRgba(hex: string, alpha: number): string {
  const normalized = normalizeHex(hex) ?? '#2563eb';
  const r = parseInt(normalized.slice(1, 3), 16);
  const g = parseInt(normalized.slice(3, 5), 16);
  const b = parseInt(normalized.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Texto legível sobre fundo colorido (luminância relativa). */
export function contrastingTextOnHex(hex: string): '#111827' | '#ffffff' {
  const normalized = normalizeHex(hex) ?? '#2563eb';
  const r = parseInt(normalized.slice(1, 3), 16) / 255;
  const g = parseInt(normalized.slice(3, 5), 16) / 255;
  const b = parseInt(normalized.slice(5, 7), 16) / 255;
  const toLinear = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const luminance = 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
  return luminance > 0.45 ? '#111827' : '#ffffff';
}
