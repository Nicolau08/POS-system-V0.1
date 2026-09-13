/**
 * Tipos e funções puras usadas por ProductsManager.tsx.
 * Extraído de ProductsManager.tsx — mesmo código, sem alterações de comportamento.
 */
import {
  moneyInputDisplayValue,
  parseMoneyInputValue,
} from '@/lib/numberInput';

export function parseMoneyInput(raw: string): number {
  return parseMoneyInputValue(raw);
}

/** Mostra vazio para o placeholder aparecer; 0 fica como placeholder. */
export function moneyInputValue(value: number | null | undefined): string | number {
  return moneyInputDisplayValue(value);
}

/** Gera EAN-13 interno (prefixo 200) com dígito de controlo. */
export function generateEan13Barcode(existing: Iterable<string | null | undefined> = []): string {
  const used = new Set(
    Array.from(existing, (v) => String(v ?? '').trim()).filter(Boolean)
  );

  const checkDigit = (twelve: string) => {
    let sum = 0;
    for (let i = 0; i < 12; i += 1) {
      const n = Number(twelve[i]);
      sum += i % 2 === 0 ? n : n * 3;
    }
    return String((10 - (sum % 10)) % 10);
  };

  for (let attempt = 0; attempt < 40; attempt += 1) {
    const rand = Math.floor(Math.random() * 1e9)
      .toString()
      .padStart(9, '0');
    const twelve = `200${rand}`.slice(0, 12);
    const code = `${twelve}${checkDigit(twelve)}`;
    if (!used.has(code)) return code;
  }

  const fallback = `200${Date.now().toString().slice(-9)}`.padStart(12, '0').slice(0, 12);
  return `${fallback}${checkDigit(fallback)}`;
}

export interface Product {
  id: string;
  code?: number;
  name: string;
  category_id?: string;
  barcode?: string;
  cost?: number;
  price: number;
  tax_rate_id?: string | null;
  tax_rate_name?: string | null;
  tax_rate_code?: string | null;
  tax_rate_percent?: number;
  tax_rate_is_fixed?: boolean;
  tax_rate_price_includes_tax?: boolean;
  tax?: number;
  final_price?: number;
  active: boolean;
  unit?: string;
  description?: string;
  age_restriction?: number;
  is_service?: boolean;
  product_kind?: 'simple' | 'composed' | 'ingredient' | 'service';
  default_quantity?: boolean;
  track_lot?: boolean;
  stock_quantity: number;
  min_stock?: number;
  color?: string;
  image?: string;
  created_at: string;
  updated_at: string;
  categories?: {
    name: string;
  };
}

export type ProductKind = 'simple' | 'composed' | 'ingredient' | 'service';

export type BomLineDraft = {
  component_product_id: string;
  quantity: number;
  component_name?: string;
  component_unit?: string;
};

export interface Category {
  id: string;
  name: string;
  parent_id?: string | null;
  color?: string | null;
}

export interface TaxRate {
  id: string;
  name: string;
  code: string;
  rate: number;
  isFixed: boolean;
  priceIncludesTax?: boolean;
  isDefault?: boolean;
  enabled: boolean;
}

export function buildCategoryPathLabel(
  categories: Category[],
  categoryId: string | null | undefined,
  options?: { includeSelf?: boolean; leafName?: string }
): string {
  const byId = new Map(categories.map((c) => [String(c.id), c]));
  const parts: string[] = ['Produtos'];
  if (!categoryId) {
    if (options?.leafName) parts.push(options.leafName);
    return parts.join(' › ');
  }

  const chain: string[] = [];
  let current: Category | undefined = byId.get(String(categoryId));
  const guard = new Set<string>();
  while (current && !guard.has(String(current.id))) {
    guard.add(String(current.id));
    chain.unshift(current.name);
    const parentKey = current.parent_id ? String(current.parent_id) : '';
    current = parentKey ? byId.get(parentKey) : undefined;
  }

  if (options?.includeSelf === false && chain.length > 0) {
    chain.pop();
  }
  parts.push(...chain);
  if (options?.leafName) parts.push(options.leafName);
  return parts.join(' › ');
}

/** Árvore plana ordenada (pais antes dos filhos) com profundidade para indentação. */
export function flattenCategoryTree(categories: Category[]): Array<Category & { depth: number }> {
  const byParent = new Map<string, Category[]>();
  for (const cat of categories) {
    const key = cat.parent_id ? String(cat.parent_id) : '';
    const list = byParent.get(key) ?? [];
    list.push(cat);
    byParent.set(key, list);
  }
  for (const list of byParent.values()) {
    list.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  }

  const result: Array<Category & { depth: number }> = [];
  const visit = (parentKey: string, depth: number) => {
    for (const cat of byParent.get(parentKey) ?? []) {
      result.push({ ...cat, depth });
      visit(String(cat.id), depth + 1);
    }
  };
  visit('', 0);

  // Categorias órfãs (parent inexistente) no fim
  const seen = new Set(result.map((c) => String(c.id)));
  for (const cat of categories) {
    if (seen.has(String(cat.id))) continue;
    result.push({ ...cat, depth: 0 });
  }
  return result;
}
