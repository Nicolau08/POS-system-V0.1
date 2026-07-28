'use client';

import { useEffect, useState } from 'react';
import {
  loadStationClientSettings,
  normalizeStationMode,
  saveStationClientSettings,
  type StationMode,
} from '@/lib/stationClientSettings';

/**
 * Ecrã de 1.º arranque: Servidor da loja vs Posto remoto.
 */
export function StationModeGate({ children }: { children: React.ReactNode }) {
  // null até montar no cliente — mesmo HTML no SSR e no 1.º paint (evita hydration mismatch).
  const [mode, setMode] = useState<StationMode | null>(null);

  useEffect(() => {
    const s = loadStationClientSettings();
    setMode(s.stationMode);
  }, []);

  if (mode === null) {
    return null;
  }

  if (mode !== 'unset') {
    return <>{children}</>;
  }

  return (
    <div className="flex h-screen flex-col items-center justify-center bg-[#121212] px-6 text-zinc-200">
      <div className="w-full max-w-md space-y-6 rounded border border-zinc-800 bg-[#1a1a1a] p-8 shadow-xl">
        <div>
          <h1 className="text-xl font-semibold text-white">Como vai usar este PC?</h1>
          <p className="mt-2 text-sm text-zinc-400">
            Pode alterar depois em Configurações → Postos. A licença fica no servidor da loja; os postos
            ligam-se a ele na rede.
          </p>
        </div>
        <button
          type="button"
          className="w-full rounded bg-[#0001fb] px-4 py-3 text-left text-sm font-medium text-white hover:bg-[#1a1bff]"
          onClick={() => {
            saveStationClientSettings({
              ...loadStationClientSettings(),
              stationMode: 'server',
            });
            setMode('server');
          }}
        >
          <span className="block">Servidor da loja</span>
          <span className="mt-1 block text-xs font-normal text-white/70">
            Este PC guarda os dados e pode aceitar outros postos na LAN.
          </span>
        </button>
        <button
          type="button"
          className="w-full rounded border border-zinc-600 px-4 py-3 text-left text-sm font-medium text-zinc-100 hover:border-[#0001fb] hover:bg-[var(--pos-brand-hover-bg)]"
          onClick={() => {
            saveStationClientSettings({
              ...loadStationClientSettings(),
              stationMode: 'client',
            });
            setMode(normalizeStationMode('client'));
          }}
        >
          <span className="block">Posto remoto</span>
          <span className="mt-1 block text-xs font-normal text-zinc-400">
            Liga-se a um servidor POSly na rede (URL ou procura automática).
          </span>
        </button>
      </div>
    </div>
  );
}
