'use client';

import { useEffect, useState } from 'react';
import type { PosTheme } from '@/lib/posSettings';

function readDomTheme(): PosTheme {
  if (typeof document === 'undefined') return 'dark';
  return document.documentElement.dataset.theme === 'light' ||
    document.documentElement.classList.contains('light')
    ? 'light'
    : 'dark';
}

/** Tema activo no DOM (data-theme), actualiza em mudanças de settings/classe. */
export function usePosTheme(): PosTheme {
  const [theme, setTheme] = useState<PosTheme>('dark');

  useEffect(() => {
    const sync = () => setTheme(readDomTheme());
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme', 'class'],
    });
    window.addEventListener('pos-settings-changed', sync);
    return () => {
      observer.disconnect();
      window.removeEventListener('pos-settings-changed', sync);
    };
  }, []);

  return theme;
}
