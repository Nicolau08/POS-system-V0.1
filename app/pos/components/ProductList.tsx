'use client';

import React from 'react';
import { Search } from 'lucide-react';
import { motion } from 'motion/react';
import type { Product } from '@/app/pos/types';
import { contrastingTextOnHex, hexToRgba, resolveCategoryColor } from '@/lib/categoryColors';
import { usePosTheme } from '@/hooks/usePosTheme';

// Product search, families and grid section extracted from the POS page.
function familyChipStyle(
  family: string,
  selected: boolean,
  light: boolean,
  familyColors?: Record<string, string>,
) {
  const color = resolveCategoryColor(familyColors?.[family], family);
  if (light) {
    return {
      backgroundColor: hexToRgba(color, selected ? 0.38 : 0.22),
      color: '#111827',
      border: `1px solid ${hexToRgba(color, selected ? 0.55 : 0.35)}`,
    };
  }
  if (selected) {
    return {
      backgroundColor: hexToRgba(color, 0.45),
      color: contrastingTextOnHex(color),
    };
  }
  return {
    backgroundColor: hexToRgba(color, 0.18),
    color: '#e8efff',
  };
}

export function ProductList({
  searchQuery,
  onSearchChange,
  onSearchSubmit,
  productFamilies,
  familyColors,
  selectedCategory,
  onSelectCategory,
  visibleProducts,
  formatPrice,
  onAddToCart,
  familiesScrollRef,
  onFamiliesPointerDown,
  onFamiliesPointerMove,
  onFamiliesPointerRelease,
  onFamiliesClickCapture,
}: {
  searchQuery: string;
  onSearchChange: (value: string) => void;
  onSearchSubmit: () => void;
  productFamilies: string[];
  familyColors?: Record<string, string>;
  selectedCategory: string | null;
  onSelectCategory: (value: string | null) => void;
  visibleProducts: Product[];
  formatPrice: (value: number) => string;
  onAddToCart: (product: Product) => void;
  familiesScrollRef: React.RefObject<HTMLDivElement | null>;
  onFamiliesPointerDown: (event: React.PointerEvent<HTMLDivElement>) => void;
  onFamiliesPointerMove: (event: React.PointerEvent<HTMLDivElement>) => void;
  onFamiliesPointerRelease: (event: React.PointerEvent<HTMLDivElement>) => void;
  onFamiliesClickCapture: (event: React.MouseEvent<HTMLDivElement>) => void;
}) {
  const theme = usePosTheme();
  const light = theme === 'light';

  return (
    <div className="flex-1 min-w-0 flex flex-col bg-[#121212]">
      <div className="h-14 p-2 flex items-center gap-2 bg-[#1a1a1a] border-b border-zinc-800">
        <div className="flex items-center gap-3 px-3 text-zinc-500 border-r border-zinc-800">
          <Search size={18} />
        </div>
        <div className="flex-1 relative">
          <input
            type="text"
            placeholder="Pesquisar produto por nome"
            className="w-full bg-transparent py-2 px-2 outline-none text-sm text-zinc-200 placeholder:text-zinc-500"
            value={searchQuery ?? ''}
            autoFocus
            onChange={(e) => onSearchChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                onSearchSubmit();
              }
            }}
          />
        </div>
      </div>

      <div className="flex-1 p-4 overflow-y-auto scrollbar-hide">
        <div
          ref={familiesScrollRef}
          className="mb-4 max-w-full overflow-x-auto scrollbar-hide cursor-grab active:cursor-grabbing select-none [touch-action:pan-y]"
          onPointerDown={onFamiliesPointerDown}
          onPointerMove={onFamiliesPointerMove}
          onPointerUp={onFamiliesPointerRelease}
          onPointerCancel={onFamiliesPointerRelease}
          onLostPointerCapture={onFamiliesPointerRelease}
          onClickCapture={onFamiliesClickCapture}
        >
          <div className="flex gap-2 w-max min-w-full pr-1">
            <button
              onClick={() => onSelectCategory(null)}
              className={`shrink-0 w-[180px] md:w-[190px] lg:w-[210px] xl:w-[220px] h-14 rounded text-sm font-semibold tracking-tight transition-all ${
                !selectedCategory
                  ? light
                    ? 'bg-zinc-300 text-zinc-900 border border-zinc-400'
                    : 'bg-zinc-800/70 text-white'
                  : light
                    ? 'bg-zinc-200/80 text-zinc-700 border border-zinc-300 hover:bg-zinc-300 hover:text-zinc-900'
                    : 'bg-zinc-900/50 text-zinc-300 hover:bg-zinc-800/70 hover:text-white'
              }`}
            >
              Todas
            </button>
            {productFamilies.map((family) => {
              const selected = selectedCategory === family;
              return (
                <button
                  key={family}
                  onClick={() => onSelectCategory(family)}
                  style={familyChipStyle(family, selected, light, familyColors)}
                  className={`shrink-0 w-[180px] md:w-[190px] lg:w-[210px] xl:w-[220px] h-14 rounded text-sm font-semibold tracking-tight transition-all ${
                    selected ? '' : 'hover:brightness-110'
                  }`}
                >
                  {family}
                </button>
              );
            })}
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2">
          {visibleProducts.map((product) => {
            const hasImage = Boolean(product.image);
            const familyName = product.category || '';
            const cardColor = resolveCategoryColor(
              product.color || familyColors?.[familyName],
              familyName || product.name || 'produto'
            );
            return (
              <motion.button
                key={product.id}
                onClick={() => onAddToCart(product)}
                style={{
                  backgroundColor: hexToRgba(cardColor, light ? 0.28 : 0.2),
                  border: light ? `1px solid ${hexToRgba(cardColor, 0.4)}` : undefined,
                }}
                className="relative flex flex-col items-start justify-between h-28 p-4 rounded transition-all group text-left hover:brightness-110"
              >
                {!product.is_service && product.stock_quantity !== undefined && (
                  <span
                    className={`absolute top-2 right-2 text-xs font-bold ${
                      product.stock_quantity <= 0
                        ? 'text-red-600'
                        : product.min_stock !== undefined &&
                            product.min_stock > 0 &&
                            product.stock_quantity <= product.min_stock
                          ? 'text-amber-600'
                          : 'text-emerald-600'
                    }`}
                  >
                    {product.stock_quantity}
                  </span>
                )}
                <div className={hasImage ? 'pr-20' : 'pr-8'}>
                  <span className="block text-sm font-semibold text-zinc-100 group-hover:text-white transition-colors">
                    {product.name}
                  </span>
                  <span className="block mt-2 text-[10px] uppercase tracking-[0.18em] text-zinc-400">
                    {product.category || 'Sem familia'}
                  </span>
                </div>
                <span className="text-sm font-mono font-semibold text-zinc-200 group-hover:text-white transition-colors">
                  {formatPrice(product.price)}
                </span>

                {hasImage && (
                  <div className="absolute right-3 bottom-3 w-[56px] h-[56px] rounded border border-zinc-700 bg-zinc-900/70 overflow-hidden">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={product.image} alt={product.name} className="w-full h-full object-cover" />
                  </div>
                )}
              </motion.button>
            );
          })}
        </div>

        {visibleProducts.length === 0 && (
          <div className="h-full flex items-center justify-center text-zinc-500 text-sm">
            Nenhum item encontrado
          </div>
        )}
      </div>
    </div>
  );
}
