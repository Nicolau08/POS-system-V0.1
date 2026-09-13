'use client';

import { useEffect, useState } from 'react';
import { parsePosTheme, type PosTheme } from '@/lib/posSettings';

function readDomTheme(): PosTheme {
  if (typeof document === 'undefined') return 'violet';
  const fromData = document.documentElement.dataset.theme;
  if (fromData === 'light' || fromData === 'violet' || fromData === 'dark') {
    return fromData;
  }
  if (document.documentElement.classList.contains('light')) return 'light';
  if (document.documentElement.classList.contains('dark')) return 'dark';
  return 'violet';
}

/** Tema activo no DOM (data-theme), actualiza em mudanças de settings/classe. */
export function usePosTheme(): PosTheme {
  const [theme, setTheme] = useState<PosTheme>('violet');

  useEffect(() => {
    const sync = () => setTheme(parsePosTheme(readDomTheme()));
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
