'use client';

import { useCallback, useEffect, useRef } from 'react';
import type { Product } from '@/app/pos/types';

type UseBarcodeScannerOpts = {
  isLoggedIn: boolean;
  products: Product[];
  searchQuery: string;
  setSearchQuery: (value: string) => void;
  addToCart: (product: Product) => void;
  showToast: (message: string, type?: 'success' | 'error' | 'info') => void;
};

export function useBarcodeScanner(opts: UseBarcodeScannerOpts) {
  const { isLoggedIn, products, searchQuery, setSearchQuery, addToCart, showToast } = opts;

  const scannerBufferRef = useRef('');
  const scannerResetTimerRef = useRef<number | null>(null);

  const submitSearchValue = useCallback(
    (value: string) => {
      const raw = value.trim();
      if (!raw) return;

      const normalized = raw.toLowerCase();
      const isSellable = (product: Product) =>
        product.active !== false && (product.product_kind ?? 'simple') !== 'ingredient';
      const exactBarcodeMatch = products.find(
        (product) =>
          isSellable(product) && String(product.barcode ?? '').trim().toLowerCase() === normalized,
      );
      const exactCodeMatch = products.find(
        (product) =>
          isSellable(product) && String(product.code ?? '').trim().toLowerCase() === normalized,
      );
      const fuzzyMatches = products.filter((product) => {
        if (!isSellable(product)) return false;
        const productName = String(product.name ?? '').toLowerCase();
        const productBarcode = String(product.barcode ?? '').toLowerCase();
        const productCode = String(product.code ?? '').toLowerCase();
        return (
          productName.includes(normalized) ||
          productBarcode.includes(normalized) ||
          productCode.includes(normalized)
        );
      });
      const fallbackVisibleSingle = fuzzyMatches.length === 1 ? fuzzyMatches[0] : null;
      const selectedProduct = exactBarcodeMatch ?? exactCodeMatch ?? fallbackVisibleSingle;

      if (!selectedProduct) {
        showToast('Produto não encontrado para este código de barras.', 'error');
        return;
      }

      addToCart(selectedProduct);
      setSearchQuery('');
    },
    [addToCart, products, searchQuery, setSearchQuery, showToast],
  );

  const handleSearchSubmit = useCallback(() => {
    submitSearchValue(searchQuery);
  }, [searchQuery, submitSearchValue]);

  useEffect(() => {
    if (!isLoggedIn) return;

    const isTypingElement = (target: EventTarget | null) => {
      if (!(target instanceof HTMLElement)) return false;
      const tag = target.tagName.toLowerCase();
      return (
        tag === 'input' ||
        tag === 'textarea' ||
        tag === 'select' ||
        target.isContentEditable
      );
    };

    const clearScannerBuffer = () => {
      scannerBufferRef.current = '';
      if (scannerResetTimerRef.current !== null) {
        window.clearTimeout(scannerResetTimerRef.current);
        scannerResetTimerRef.current = null;
      }
    };

    const armResetTimer = () => {
      if (scannerResetTimerRef.current !== null) {
        window.clearTimeout(scannerResetTimerRef.current);
      }
      scannerResetTimerRef.current = window.setTimeout(() => {
        scannerBufferRef.current = '';
        scannerResetTimerRef.current = null;
      }, 120);
    };

    const onGlobalScannerKeydown = (event: KeyboardEvent) => {
      if (isTypingElement(event.target)) return;
      if (event.ctrlKey || event.altKey || event.metaKey) return;

      if (event.key === 'Enter') {
        const scanned = scannerBufferRef.current.trim();
        if (scanned) {
          event.preventDefault();
          submitSearchValue(scanned);
          clearScannerBuffer();
        }
        return;
      }

      if (event.key.length === 1) {
        scannerBufferRef.current += event.key;
        armResetTimer();
      }
    };

    window.addEventListener('keydown', onGlobalScannerKeydown);
    return () => {
      window.removeEventListener('keydown', onGlobalScannerKeydown);
      clearScannerBuffer();
    };
  }, [isLoggedIn, submitSearchValue]);

  return {
    handleSearchSubmit,
    submitSearchValue,
  };
}
