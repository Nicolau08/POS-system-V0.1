'use client';

import { FormEvent, useEffect, useState } from 'react';
import { LicenseInUseModal } from '@/components/LicenseInUseModal';
import { isLicenseInUseConflict } from '@/lib/licensing/licenseConflict.js';

type ActivationScreenProps = {
  activationCode: string;
  machineId: string;
  reason: string | null;
  isSubmitting: boolean;
  onRefresh: () => Promise<void> | void;
  onActivate: (licenseKey: string) => Promise<void> | void;
  onRestartNow: () => Promise<void> | void;
  onClearLocalLicense?: () => Promise<void> | void;
};

export default function ActivationScreen({
  activationCode,
  machineId,
  reason,
  isSubmitting,
  onRefresh,
  onActivate,
  onRestartNow,
  onClearLocalLicense,
}: ActivationScreenProps) {
  const [licenseKey, setLicenseKey] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [conflictOpen, setConflictOpen] = useState(false);
  const [isClearing, setIsClearing] = useState(false);

  useEffect(() => {
    if (isLicenseInUseConflict(reason)) {
      setConflictOpen(true);
    }
  }, [reason]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setSuccess(null);
    const trimmedKey = licenseKey.trim();
    if (!trimmedKey) {
      setError('Introduza a chave da licenca.');
      return;
    }

    try {
      await onActivate(trimmedKey);
      setSuccess('Licenca ativada com sucesso. Reinicie a aplicacao para concluir.');
      setLicenseKey('');
    } catch (submitError) {
      const message =
        submitError instanceof Error ? submitError.message : 'Falha ao ativar licenca.';
      if (isLicenseInUseConflict(message)) {
        setConflictOpen(true);
        setError(null);
      } else {
        setError(message);
      }
    }
  };

  const showInlineReason = Boolean(reason) && !isLicenseInUseConflict(reason);

  return (
    <main className="flex min-h-screen items-center justify-center bg-pos-bg px-4 text-pos-fg">
      <section className="w-full max-w-xl rounded border border-pos-border bg-pos-surface p-6 shadow-xl">
        <h1 className="text-xl font-semibold text-pos-fg">Renovação / reativação da licença</h1>
        <p className="mt-2 text-sm text-pos-muted">
          A <strong className="text-pos-fg">primeira instalação</strong> usa o número de série. Neste ecrã pode{' '}
          <strong className="text-pos-fg">renovar ou reativar</strong>: cole o <strong className="text-pos-fg">número de série</strong>, o{' '}
          <strong className="text-pos-fg">token de 12 dígitos</strong> da consola, ou o código Base64/JSON legado. Depois de
          ativar, reinicie se for pedido.
        </p>
        <p className="mt-2 text-sm text-pos-muted">
          Desvincular na consola não apaga a licença neste PC. Use <strong className="text-pos-fg">Limpar licença local</strong>{' '}
          e volte a ativar com o número de série (a máquina tem de estar desvinculada na consola).
        </p>

        <div className="mt-4 space-y-2 rounded border border-pos-border bg-pos-card p-3 text-sm">
          <p>
            <span className="text-pos-muted">Codigo de ativacao:</span>{' '}
            <span className="font-mono text-pos-fg break-all">{activationCode || 'N/A'}</span>
          </p>
          <p>
            <span className="text-pos-muted">Machine ID:</span>{' '}
            <span className="font-mono text-pos-fg">{machineId || 'N/A'}</span>
          </p>
          {showInlineReason ? (
            <p className="rounded border border-amber-600/40 bg-amber-500/15 px-2 py-1.5 text-pos-fg">
              <span className="font-semibold">Motivo:</span> {reason}
            </p>
          ) : null}
        </div>

        <form className="mt-5 space-y-3" onSubmit={handleSubmit}>
          <label className="block text-sm font-medium text-pos-fg">
            Chave ou token
            <input
              value={licenseKey}
              onChange={(event) => setLicenseKey(event.target.value)}
              placeholder="Número de série, token de 12 dígitos ou Base64/JSON"
              className="mt-1 w-full rounded border border-pos-border bg-pos-field px-3 py-2 text-sm text-pos-fg outline-none placeholder:text-pos-muted focus:border-[#0001fb] focus:ring focus:ring-[#0001fb]/30"
              disabled={isSubmitting}
            />
          </label>

          {error ? <p className="text-sm font-medium text-red-600">{error}</p> : null}
          {success ? <p className="text-sm font-medium text-[#15803d]">{success}</p> : null}

          <div className="flex flex-wrap gap-2">
            <button
              type="submit"
              disabled={isSubmitting || isClearing}
              className="pos-btn-brand pos-on-accent rounded px-4 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSubmitting ? 'A ativar...' : 'Ativar licenca'}
            </button>
            <button
              type="button"
              onClick={() => void onRefresh()}
              disabled={isSubmitting || isClearing}
              className="rounded border border-pos-border bg-pos-action px-4 py-2 text-sm text-pos-fg hover:bg-pos-action-hover disabled:cursor-not-allowed disabled:opacity-60"
            >
              Revalidar estado
            </button>
            <button
              type="button"
              onClick={() => void onRestartNow()}
              disabled={isSubmitting || isClearing}
              className="rounded border border-pos-border bg-pos-action px-4 py-2 text-sm text-pos-fg hover:bg-pos-action-hover disabled:cursor-not-allowed disabled:opacity-60"
            >
              Reiniciar aplicacao
            </button>
            {onClearLocalLicense ? (
              <button
                type="button"
                onClick={() => {
                  void (async () => {
                    setError(null);
                    setSuccess(null);
                    setIsClearing(true);
                    try {
                      await onClearLocalLicense();
                      setSuccess('Licença local limpa. Pode colar o número de série e ativar de novo.');
                    } catch (clearError) {
                      setError(
                        clearError instanceof Error
                          ? clearError.message
                          : 'Falha ao limpar licença local.',
                      );
                    } finally {
                      setIsClearing(false);
                    }
                  })();
                }}
                disabled={isSubmitting || isClearing}
                className="rounded border border-red-600 bg-red-600/10 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-600/15 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isClearing ? 'A limpar...' : 'Limpar licença local'}
              </button>
            ) : null}
          </div>
        </form>
      </section>

      <LicenseInUseModal open={conflictOpen} onClose={() => setConflictOpen(false)} />
    </main>
  );
}
