'use client';

import { useMemo, useState } from 'react';
import { getPosApiBase } from '@/lib/apiBase';

type LicenseExpiredScreenProps = {
  tenantName?: string | null;
  expiresAt?: string | null;
  onActivated?: () => void;
};

function getDaysLeft(expiresAt?: string | null) {
  if (!expiresAt) return null;
  const diff = new Date(expiresAt).getTime() - Date.now();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

export default function LicenseExpiredScreen({ tenantName, expiresAt, onActivated }: LicenseExpiredScreenProps) {
  const [token, setToken] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const formattedExpiresAt = useMemo(() => {
    if (!expiresAt) return null;
    const parsed = new Date(expiresAt);
    if (Number.isNaN(parsed.getTime())) return expiresAt;
    return parsed.toLocaleString();
  }, [expiresAt]);
  const daysLeft = useMemo(() => getDaysLeft(expiresAt), [expiresAt]);
  const daysLeftColor =
    daysLeft == null ? 'text-zinc-300' : daysLeft <= 0 ? 'text-red-400' : daysLeft <= 3 ? 'text-amber-400' : 'text-emerald-400';

  const handleActivate = async () => {
    const normalizedToken = token.trim();
    if (!normalizedToken) {
      setErrorMessage('Informe uma chave de licença válida.');
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);
    try {
      const response = await fetch(`${getPosApiBase().replace(/\/$/, '')}/setup/license/activate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: normalizedToken }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(String(payload?.error ?? 'Falha ao ativar nova licença.'));
      }
      onActivated?.();
      window.location.reload();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Falha ao ativar nova licença.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[9999] bg-black/95 backdrop-blur-sm">
      <div className="flex min-h-screen items-center justify-center px-4">
        <div className="w-full max-w-md rounded-xl border border-zinc-800 bg-zinc-900 p-6 text-white shadow-2xl">
          <h1 className="text-3xl font-bold tracking-tight text-red-400">Licença Expirada</h1>
          <p className="mt-2 text-sm text-zinc-300">Entre em contacto para renovar o sistema</p>
          <p className={`mt-1 text-sm font-semibold ${daysLeftColor}`}>
            {daysLeft != null && daysLeft > 0 ? `Restam ${daysLeft} dias` : 'Licença expirada'}
          </p>

          <div className="mt-6 space-y-2 rounded-lg border border-zinc-800 bg-zinc-950/70 p-4 text-sm">
            <p className="text-zinc-200">
              <span className="text-zinc-400">Tenant: </span>
              {tenantName || 'Não identificado'}
            </p>
            <p className="text-zinc-200">
              <span className="text-zinc-400">Expira em: </span>
              {formattedExpiresAt || 'N/A'}
            </p>
          </div>

          <div className="mt-5 space-y-3">
            <input
              type="text"
              value={token}
              onChange={(event) => setToken(event.target.value)}
              className="w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white outline-none focus:border-emerald-500"
              placeholder="Cole a nova chave de licença"
            />
            {errorMessage ? <p className="text-sm text-red-400">{errorMessage}</p> : null}
            <button
              type="button"
              onClick={() => void handleActivate()}
              disabled={isSubmitting}
              className="w-full rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isSubmitting ? 'A ativar...' : 'Inserir nova licença'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
