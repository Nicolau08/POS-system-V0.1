'use client';

import { useEffect } from 'react';
import { loadPosSettings, type PosTheme } from '@/lib/posSettings';

export function applyPosTheme(theme: PosTheme) {
  if (typeof document === 'undefined') return;
  const next = theme === 'light' ? 'light' : 'dark';
  const root = document.documentElement;
  root.dataset.theme = next;
  root.classList.toggle('dark', next === 'dark');
  root.classList.toggle('light', next === 'light');
  try {
    root.style.colorScheme = next;
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
      if (detail?.theme === 'light' || detail?.theme === 'dark') {
        applyPosTheme(detail.theme);
        return;
      }
      applyPosTheme(loadPosSettings().theme);
    };

    window.addEventListener('pos-settings-changed', onSettings as EventListener);
    return () => window.removeEventListener('pos-settings-changed', onSettings as EventListener);
  }, []);

  return children;
}
