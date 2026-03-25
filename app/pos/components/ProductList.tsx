'use client';

import React from 'react';
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Home, Search } from 'lucide-react';
import { motion } from 'motion/react';
import type { Product } from '@/app/pos/types';

// Product search, families and grid section extracted from the POS page.
export function ProductList({
  searchQuery,
  onSearchChange,
  productFamilies,
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
  productFamilies: string[];
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
            className="w-full bg-transparent py-2 px-2 outline-none text-sm placeholder:text-zinc-600"
            value={searchQuery ?? ''}
            onChange={(e) => onSearchChange(e.target.value)}
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
              className={`shrink-0 w-[180px] md:w-[190px] lg:w-[210px] xl:w-[220px] h-14 rounded border text-sm font-semibold tracking-tight transition-all ${
                !selectedCategory
                  ? 'border-zinc-700 bg-zinc-800/70 text-white'
                  : 'border-zinc-800 bg-zinc-900/50 text-zinc-300 hover:border-zinc-700 hover:bg-zinc-800/70 hover:text-white'
              }`}
            >
              Todas
            </button>
            {productFamilies.map((family) => (
              <button
                key={family}
                onClick={() => onSelectCategory(family)}
                className={`shrink-0 w-[180px] md:w-[190px] lg:w-[210px] xl:w-[220px] h-14 rounded border text-sm font-semibold tracking-tight transition-all ${
                  selectedCategory === family
                    ? 'border-zinc-700 bg-zinc-800/70 text-white'
                    : 'border-zinc-800 bg-zinc-900/50 text-zinc-300 hover:border-zinc-700 hover:bg-zinc-800/70 hover:text-white'
                }`}
              >
                {family}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2">
          {visibleProducts.map((product) => (
            <motion.button
              key={product.id}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => onAddToCart(product)}
              className={`relative flex flex-col items-start justify-between h-28 p-4 rounded border border-zinc-800 transition-all ${product.color || 'bg-zinc-900/30'} hover:border-zinc-600 hover:bg-zinc-800/50 group text-left`}
            >
              {product.stock_quantity !== undefined && (
                <span className={`absolute top-2 right-2 text-xs font-bold ${product.stock_quantity > 0 ? 'text-emerald-500/80' : 'text-red-500/80'}`}>
                  {product.stock_quantity}
                </span>
              )}
              <div className="pr-8">
                <span className="block text-sm font-medium text-zinc-100 group-hover:text-white transition-colors">
                  {product.name}
                </span>
                <span className="block mt-2 text-[10px] uppercase tracking-[0.18em] text-zinc-500">
                  {product.category || 'Sem familia'}
                </span>
              </div>
              <span className="text-sm font-mono font-medium text-zinc-500 group-hover:text-emerald-400 transition-colors">
                {formatPrice(product.price)}
              </span>
            </motion.button>
          ))}
        </div>

        {visibleProducts.length === 0 && (
          <div className="h-full flex items-center justify-center text-zinc-600 text-sm">
            Nenhum item encontrado
          </div>
        )}
      </div>

      <footer className="p-2 bg-[#1a1a1a] border-t border-zinc-800 flex items-center justify-between text-xs text-zinc-500">
        <div>Página 1 / 1</div>
        <div className="flex items-center gap-1">
          <PaginationButton icon={<Home size={14} />} />
          <PaginationButton icon={<ChevronsLeft size={14} />} />
          <PaginationButton icon={<ChevronLeft size={14} />} />
          <PaginationButton icon={<ChevronRight size={14} />} />
          <PaginationButton icon={<ChevronsRight size={14} />} />
        </div>
      </footer>
    </div>
  );
}

function PaginationButton({ icon }: { icon: React.ReactNode }) {
  return (
    <button className="w-7 h-7 flex items-center justify-center rounded bg-zinc-800 hover:bg-zinc-700 transition-colors">
      {icon}
    </button>
  );
}
