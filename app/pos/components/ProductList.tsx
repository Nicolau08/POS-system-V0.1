'use client';

import React from 'react';
import { Search } from 'lucide-react';
import { motion } from 'motion/react';
import type { Product } from '@/app/pos/types';
import { getPosApiBase } from '@/lib/apiBase';
import { unwrapApiSuccessPayload } from '@/lib/apiResponse';

// Product search, families and grid section extracted from the POS page.
function getDaysLeft(expiresAt?: string | null) {
  if (!expiresAt) return null;
  const diff = new Date(expiresAt).getTime() - Date.now();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

export function ProductList({
  searchQuery,
  onSearchChange,
  onSearchSubmit,
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
  onSearchSubmit: () => void;
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
  const [tenantInfo, setTenantInfo] = React.useState<{
    name: string;
    nuit: string;
    license_type: string;
    license_expires_at: string | null;
  } | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    const loadTenantInfo = async () => {
      try {
        const apiBase = getPosApiBase().replace(/\/$/, '');
        // Puxa nome/NUIT/plano/expiração da consola antes de ler o rodapé.
        try {
          await fetch(`${apiBase}/setup/license/sync-registry`, { method: 'POST' });
        } catch {
          // offline
        }
        const response = await fetch(`${apiBase}/tenant/info`);
        if (!response.ok) return;
        const raw = await response.json();
        const data = unwrapApiSuccessPayload<any>(raw);
        if (cancelled || !data || typeof data !== 'object') return;
        setTenantInfo({
          name: String(data.name ?? '').trim() || 'Loja',
          nuit: String(data.nuit ?? '').trim() || '--',
          license_type: String(data.license_type ?? '').trim() || 'BASIC',
          license_expires_at:
            data.license_expires_at != null && String(data.license_expires_at).trim()
              ? String(data.license_expires_at)
              : null,
        });
      } catch {}
    };
    void loadTenantInfo();
    const onRefresh = () => {
      void loadTenantInfo();
    };
    window.addEventListener('pos-license-refreshed', onRefresh);
    window.addEventListener('focus', onRefresh);
    return () => {
      cancelled = true;
      window.removeEventListener('pos-license-refreshed', onRefresh);
      window.removeEventListener('focus', onRefresh);
    };
  }, []);

  const licenseVisual = React.useMemo(() => {
    if (!tenantInfo?.license_expires_at) {
      return { text: '--/--/----', className: 'text-zinc-400', daysLeft: null, daysClassName: 'text-zinc-400' };
    }
    const date = new Date(tenantInfo.license_expires_at);
    if (Number.isNaN(date.getTime())) {
      return { text: '--/--/----', className: 'text-zinc-400', daysLeft: null, daysClassName: 'text-zinc-400' };
    }
    const formatted = `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}/${date.getFullYear()}`;
    const daysLeft = getDaysLeft(tenantInfo.license_expires_at);
    if (daysLeft == null) return { text: formatted, className: 'text-zinc-400', daysLeft: null, daysClassName: 'text-zinc-400' };
    if (daysLeft <= 0) return { text: formatted, className: 'text-red-400', daysLeft, daysClassName: 'text-red-400' };
    if (daysLeft <= 3) return { text: formatted, className: 'text-amber-400', daysLeft, daysClassName: 'text-amber-400' };
    return { text: formatted, className: 'text-emerald-400', daysLeft, daysClassName: 'text-emerald-400' };
  }, [tenantInfo]);

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
          {visibleProducts.map((product) => {
            const hasImage = Boolean(product.image);
            return (
              <motion.button
                key={product.id}
                onClick={() => onAddToCart(product)}
                className="relative flex flex-col items-start justify-between h-28 p-4 rounded border border-zinc-800 transition-all bg-zinc-900/30 group text-left"
              >
                {!product.is_service && product.stock_quantity !== undefined && (
                  <span className={`absolute top-2 right-2 text-xs font-bold ${product.stock_quantity > 0 ? 'text-emerald-500/80' : 'text-red-500/80'}`}>
                    {product.stock_quantity}
                  </span>
                )}
                <div className={hasImage ? 'pr-20' : 'pr-8'}>
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
          <div className="h-full flex items-center justify-center text-zinc-600 text-sm">
            Nenhum item encontrado
          </div>
        )}
      </div>

      <footer className="p-2 bg-[#1a1a1a] border-t border-zinc-800 flex items-center justify-between text-xs">
        <div className="truncate text-zinc-400">
          Loja: <span className="text-zinc-200">{tenantInfo?.name ?? 'Loja'}</span>
          {' | '}NUIT: <span className="text-zinc-200">{tenantInfo?.nuit ?? '--'}</span>
          {' | '}Plano: <span className="text-zinc-200">{tenantInfo?.license_type ?? 'BASIC'}</span>
          {' | '}Expira: <span className={licenseVisual.className}>{licenseVisual.text}</span>
          {' | '}Dias restantes: <span className={licenseVisual.daysClassName}>{licenseVisual.daysLeft ?? '--'}</span>
        </div>
      </footer>
    </div>
  );
}
