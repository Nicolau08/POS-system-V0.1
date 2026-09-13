/**
 * Cache local offline-first do catálogo POS (produtos / famílias / cores).
 * Após mutações no Gerenciamento, publica no cache de sessão e notifica o POS.
 */
import type { Product } from '@/app/pos/types';
import { resolveCategoryColor } from '@/lib/categoryColors';
import {
  getPosCatalogCache,
  patchPosCatalogCache,
  setCachedCategories,
} from '@/lib/posSessionCache';

export const CATALOG_CHANGED_EVENT = 'pos-catalog-changed';

export type CatalogCategoryRow = {
  id?: string;
  name?: string;
  color?: string | null;
  parent_id?: string | null;
};

/** Normaliza linha da API local para o formato da grelha POS. */
export function normalizeCatalogProduct(row: any): Product {
  const basePrice = Number(row?.price ?? 0) || 0;
  const finalPriceRaw = Number(row?.final_price);
  const chargePrice = Number.isFinite(finalPriceRaw) ? finalPriceRaw : basePrice;
  return {
    ...row,
    id: String(row?.id ?? ''),
    price: chargePrice,
    category: String(row?.category ?? row?.categories?.name ?? ''),
    category_id: row?.category_id != null ? String(row.category_id) : null,
    tax_rate_id: row?.tax_rate_id != null ? String(row.tax_rate_id) : null,
    tax_rate_name: row?.tax_rate_name != null ? String(row.tax_rate_name) : null,
    tax_rate_code: row?.tax_rate_code != null ? String(row.tax_rate_code) : null,
    tax_rate_percent: Number(row?.tax_rate_percent ?? 0),
    tax_rate_is_fixed: Boolean(row?.tax_rate_is_fixed),
    tax_rate_price_includes_tax:
      row?.tax_rate_price_includes_tax == null
        ? true
        : Boolean(row.tax_rate_price_includes_tax),
    stock_quantity: row?.stock_quantity != null ? Number(row.stock_quantity) : undefined,
    min_stock: row?.min_stock != null ? Number(row.min_stock) : undefined,
    active: row?.active === false ? false : Boolean(row?.active ?? true),
    is_service: Boolean(row?.is_service),
    product_kind: row?.product_kind ?? 'simple',
    cloud_id: row?.cloud_id != null ? String(row.cloud_id) : undefined,
    color: row?.color != null ? String(row.color) : undefined,
    image: row?.image != null ? String(row.image) : undefined,
    barcode: row?.barcode != null ? String(row.barcode) : undefined,
    name: String(row?.name ?? ''),
    code: Number(row?.code ?? 0) || 0,
  } as Product;
}

export function buildFamilyColorsFromCategories(
  categories: CatalogCategoryRow[],
  products: Product[] = [],
): Record<string, string> {
  const colors: Record<string, string> = {};
  for (const cat of categories) {
    const name = String(cat?.name ?? '').trim();
    if (!name) continue;
    colors[name] = resolveCategoryColor(cat?.color, name);
  }
  for (const product of products) {
    const name = String(product?.category ?? '').trim();
    if (!name || colors[name]) continue;
    colors[name] = resolveCategoryColor(product?.color, name);
  }
  return colors;
}

export function notifyCatalogChanged(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(CATALOG_CHANGED_EVENT));
}

/**
 * Grava produtos+categorias no cache de sessão (formato POS) e avisa a grelha.
 */
export function publishLocalCatalog(input: {
  products?: any[];
  categories?: CatalogCategoryRow[] | unknown[];
  customers?: any[];
}): void {
  const prev = getPosCatalogCache();
  const rawProducts = input.products ?? prev?.products ?? [];
  const products = (Array.isArray(rawProducts) ? rawProducts : []).map((row) =>
    normalizeCatalogProduct(row),
  );
  const categories = (Array.isArray(input.categories)
    ? input.categories
    : []) as CatalogCategoryRow[];

  if (categories.length) {
    setCachedCategories(categories);
  }

  const familyColors = buildFamilyColorsFromCategories(
    categories.length
      ? categories
      : ((prev?.familyColors
          ? Object.keys(prev.familyColors).map((name) => ({
              name,
              color: prev.familyColors[name],
            }))
          : []) as CatalogCategoryRow[]),
    products,
  );

  patchPosCatalogCache({
    products,
    familyColors,
    ...(input.customers
      ? { customers: input.customers }
      : prev?.customers
        ? { customers: prev.customers }
        : {}),
    ...(prev?.paymentMethods ? { paymentMethods: prev.paymentMethods } : {}),
    ...(prev?.companyProfile !== undefined
      ? { companyProfile: prev.companyProfile }
      : {}),
  });

  notifyCatalogChanged();
}

export function applyCatalogCacheToPosHandlers(handlers: {
  setProducts: (products: Product[]) => void;
  setFamilyColors: (colors: Record<string, string>) => void;
  setCustomers?: (customers: any[]) => void;
}): void {
  const cache = getPosCatalogCache();
  if (!cache) return;
  handlers.setProducts(cache.products ?? []);
  handlers.setFamilyColors(cache.familyColors ?? {});
  if (handlers.setCustomers && cache.customers) {
    handlers.setCustomers(cache.customers);
  }
}
