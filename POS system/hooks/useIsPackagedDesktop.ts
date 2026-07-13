'use client';

import { useEffect, useState } from 'react';

/**
 * True quando a UI corre dentro do Electron empacotado (instalador/NSIS).
 * Em browser ou `electron .` (dev) fica false — permite Emitir série só fora do exe de produção.
 */
export function useIsPackagedDesktop() {
  const [isPackaged, setIsPackaged] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        if (!window.electronAPI?.getRuntimeInfo) return;
        const info = await window.electronAPI.getRuntimeInfo();
        if (!cancelled && info?.success) {
          setIsPackaged(Boolean(info.packaged));
        }
      } catch {
        if (!cancelled) setIsPackaged(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return isPackaged;
}
