import { useMemo } from 'react';
import type { Product } from '@/app/pos/types';

// Provides sorted/filter views of products without mutating source state.
export function useProducts(
  products: Product[],
  searchQuery: string,
  selectedCategory: string | null
) {
  const sortedProducts = useMemo(() => {
    return [...products].sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
    );
  }, [products]);

  const productFamilies = useMemo(() => {
    return Array.from(
      new Set(
        sortedProducts
          .filter(
            (p) =>
              p.active !== false &&
              (p.product_kind ?? 'simple') !== 'ingredient' &&
              p.category &&
              p.category !== 'Category'
          )
          .map((p) => p.category)
      )
    ).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  }, [sortedProducts]);

  const sellableProducts = useMemo(
    () =>
      sortedProducts.filter(
        (p) => p.active !== false && (p.product_kind ?? 'simple') !== 'ingredient'
      ),
    [sortedProducts]
  );

  const visibleProducts = useMemo(() => {
    return sellableProducts.filter((p) => {
      const matchesCategory = !selectedCategory || p.category === selectedCategory;
      const query = searchQuery.trim().toLowerCase();
      const productName = String(p.name ?? '').toLowerCase();
      const productBarcode = String(p.barcode ?? '').toLowerCase();
      const productCode = String(p.code ?? '').toLowerCase();
      const matchesSearch =
        query.length === 0 ||
        productName.includes(query) ||
        productBarcode.includes(query) ||
        productCode.includes(query);
      return matchesCategory && matchesSearch;
    });
  }, [sellableProducts, selectedCategory, searchQuery]);

  return {
    sortedProducts,
    productFamilies,
    sellableProducts,
    visibleProducts,
  };
}
