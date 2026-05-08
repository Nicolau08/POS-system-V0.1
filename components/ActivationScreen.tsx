'use client';

import { useMemo, useState } from 'react';

type ActivationScreenProps = {
  activationCode: string;
  machineId: string;
  reason?: string | null;
  isSubmitting: boolean;
  onActivate: (licenseKey: string) => Promise<void>;
  onRestartNow: () => Promise<void>;
  onRefresh?: () => Promise<void>;
};

export default function ActivationScreen({
  activationCode,
  machineId,
  reason,
  isSubmitting,
  onActivate,
  onRestartNow,
  onRefresh,
}: ActivationScreenProps) {
  const [licenseKey, setLicenseKey] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [isRestarting, setIsRestarting] = useState(false);

  const activationInstructions = useMemo(
    () =>
      [
        '1) Copie o código de ativação desta máquina.',
        '2) Envie o código para o suporte/licenciamento.',
        '3) Receba a licença assinada (base64 ou JSON).',
        '4) Cole a chave no campo abaixo e clique em Ativar.',
      ].join('\n'),
    []
  );

  const copyToClipboard = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setStatusMessage(`${label} copiado com sucesso.`);
      setErrorMessage(null);
    } catch {
      setErrorMessage(`Não foi possível copiar ${label.toLowerCase()}.`);
    }
  };

  const handleActivate = async () => {
    const normalizedKey = licenseKey.trim();
    if (!normalizedKey) {
      setErrorMessage('Cole a chave de licença para ativar.');
      return;
    }

    setErrorMessage(null);
    setStatusMessage(null);
    try {
      await onActivate(normalizedKey);
      setStatusMessage(null);
      setShowSuccessModal(true);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Falha na ativação.');
    }
  };

  const handleRestartNow = async () => {
    setIsRestarting(true);
    setErrorMessage(null);
    try {
      await onRestartNow();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Falha ao reiniciar aplicação.');
      setIsRestarting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[9999] bg-[#111111] text-zinc-100">
      <div className="mx-auto flex min-h-screen w-full max-w-4xl items-center justify-center px-4 py-10">
        <div className="w-full rounded-2xl border border-zinc-800 bg-zinc-900/95 p-6 shadow-2xl">
          <h1 className="text-2xl font-bold">Ativação de Licença</h1>
          <p className="mt-2 text-sm text-zinc-400">
            O POS está bloqueado até a licença ser ativada nesta máquina.
          </p>
          {reason ? (
            <div className="mt-3 rounded border border-amber-700/50 bg-amber-950/30 px-3 py-2 text-sm text-amber-300">
              {reason}
            </div>
          ) : null}

          <div className="mt-5 grid gap-4 md:grid-cols-2">
            <div className="space-y-3">
              <p className="text-sm font-semibold text-zinc-300">Código de ativação (machine-bound)</p>
              <textarea
                readOnly
                value={activationCode}
                className="h-40 w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 font-mono text-xs text-zinc-100"
              />
              <p className="text-xs text-zinc-500 break-all">machine_id: {machineId}</p>
              <button
                type="button"
                onClick={() => void copyToClipboard(activationCode, 'Código de ativação')}
                className="rounded-md border border-zinc-700 px-4 py-2 text-sm hover:border-zinc-500"
              >
                Copiar código
              </button>
            </div>

            <div className="space-y-3">
              <p className="text-sm font-semibold text-zinc-300">Instruções</p>
              <textarea
                readOnly
                value={activationInstructions}
                className="h-40 w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs text-zinc-300"
              />
            </div>
          </div>

          <div className="mt-5 space-y-3">
            <label className="block text-sm">
              Cole a chave de licença (JSON ou base64)
              <textarea
                value={licenseKey}
                onChange={(event) => setLicenseKey(event.target.value)}
                className="mt-1 h-28 w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 font-mono text-xs text-zinc-100 outline-none focus:border-emerald-500"
                placeholder="Cole a licença assinada aqui..."
              />
            </label>
            {errorMessage ? (
              <div className="rounded border border-red-700/50 bg-red-950/40 px-3 py-2 text-sm text-red-300">
                {errorMessage}
              </div>
            ) : null}
            {statusMessage ? (
              <div className="rounded border border-emerald-700/50 bg-emerald-950/30 px-3 py-2 text-sm text-emerald-300">
                {statusMessage}
              </div>
            ) : null}
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => void handleActivate()}
                disabled={isSubmitting || isRestarting}
                className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
              >
                {isSubmitting ? 'A ativar...' : 'Ativar licença'}
              </button>
              {onRefresh ? (
                <button
                  type="button"
                  onClick={() => void onRefresh()}
                  disabled={isSubmitting || isRestarting}
                  className="rounded-md border border-zinc-700 px-4 py-2 text-sm hover:border-zinc-500 disabled:opacity-50"
                >
                  Atualizar estado
                </button>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      {showSuccessModal ? (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/70 px-4">
          <div className="w-full max-w-md rounded-xl border border-zinc-800 bg-zinc-900 p-6 shadow-2xl">
            <h2 className="text-xl font-bold text-emerald-400">Activation successful</h2>
            <p className="mt-3 text-sm text-zinc-300">
              The application will restart to apply changes.
            </p>
            <div className="mt-5 flex justify-end">
              <button
                type="button"
                onClick={() => void handleRestartNow()}
                disabled={isRestarting}
                className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
              >
                {isRestarting ? 'Restarting...' : 'Restart now'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
