'use client';

import { useEffect } from 'react';
import { loadPosSettings, parsePosTheme, type PosTheme } from '@/lib/posSettings';

export function applyPosTheme(theme: PosTheme) {
  if (typeof document === 'undefined') return;
  const next = parsePosTheme(theme);
  const root = document.documentElement;
  root.dataset.theme = next;
  root.classList.toggle('dark', next === 'dark');
  root.classList.toggle('light', next === 'light');
  root.classList.toggle('violet', next === 'violet');
  try {
    root.style.colorScheme = next === 'light' ? 'light' : 'dark';
  } catch {
    // ignore
  }
}

/**
 * Aplica o tema guardado em pos:settings e reage a alterações.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    applyPosTheme(loadPosSettings().theme);

    const onSettings = (event: Event) => {
      const detail = (event as CustomEvent)?.detail as { theme?: PosTheme } | undefined;
      applyPosTheme(parsePosTheme(detail?.theme ?? loadPosSettings().theme));
    };

    window.addEventListener('pos-settings-changed', onSettings as EventListener);
    return () => window.removeEventListener('pos-settings-changed', onSettings as EventListener);
  }, []);

  return children;
}
