'use client';

import { FormEvent, useState } from 'react';

type ActivationScreenProps = {
  activationCode: string;
  machineId: string;
  reason: string | null;
  isSubmitting: boolean;
  onRefresh: () => Promise<void> | void;
  onActivate: (licenseKey: string) => Promise<void> | void;
  onRestartNow: () => Promise<void> | void;
};

export default function ActivationScreen({
  activationCode,
  machineId,
  reason,
  isSubmitting,
  onRefresh,
  onActivate,
  onRestartNow,
}: ActivationScreenProps) {
  const [licenseKey, setLicenseKey] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

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
      setError(message);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#121212] px-4 text-zinc-200">
      <section className="w-full max-w-xl rounded-xl border border-zinc-800 bg-zinc-900/90 p-6 shadow-xl">
        <h1 className="text-xl font-semibold text-white">Renovação / reativação da licença</h1>
        <p className="mt-2 text-sm text-zinc-400">
          A <strong>primeira instalação</strong> usa o número de série no ecrã de instalação. Este ecrã serve para{' '}
          <strong>renovar ou reativar</strong>: cole o <strong>token de 12 dígitos</strong> gerado na consola, ou o
          código Base64/JSON legado. Depois de ativar, reinicie a aplicação.
        </p>

        <div className="mt-4 space-y-2 rounded-lg border border-zinc-800 bg-zinc-950/70 p-3 text-sm">
          <p>
            <span className="text-zinc-400">Codigo de ativacao:</span>{' '}
            <span className="font-mono text-zinc-200">{activationCode || 'N/A'}</span>
          </p>
          <p>
            <span className="text-zinc-400">Machine ID:</span>{' '}
            <span className="font-mono text-zinc-200">{machineId || 'N/A'}</span>
          </p>
          {reason ? (
            <p className="text-amber-300">
              <span className="text-zinc-400">Motivo:</span> {reason}
            </p>
          ) : null}
        </div>

        <form className="mt-5 space-y-3" onSubmit={handleSubmit}>
          <label className="block text-sm text-zinc-300">
            Chave ou token
            <input
              value={licenseKey}
              onChange={(event) => setLicenseKey(event.target.value)}
              placeholder="Base64/JSON de ativação ou token de 12 dígitos"
              className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none ring-emerald-500/40 focus:ring"
              disabled={isSubmitting}
            />
          </label>

          {error ? <p className="text-sm text-rose-400">{error}</p> : null}
          {success ? <p className="text-sm text-emerald-400">{success}</p> : null}

          <div className="flex flex-wrap gap-2">
            <button
              type="submit"
              disabled={isSubmitting}
              className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSubmitting ? 'A ativar...' : 'Ativar licenca'}
            </button>
            <button
              type="button"
              onClick={() => void onRefresh()}
              disabled={isSubmitting}
              className="rounded-md border border-zinc-700 px-4 py-2 text-sm text-zinc-200 hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Revalidar estado
            </button>
            <button
              type="button"
              onClick={() => void onRestartNow()}
              disabled={isSubmitting}
              className="rounded-md border border-zinc-700 px-4 py-2 text-sm text-zinc-200 hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Reiniciar aplicacao
            </button>
          </div>
        </form>
      </section>
    </main>
  );
}
