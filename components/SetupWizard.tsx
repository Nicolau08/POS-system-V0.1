'use client';

import { useMemo, useState } from 'react';
import { LicenseInUseModal } from '@/components/LicenseInUseModal';
import { isLicenseInUseConflict } from '@/lib/licensing/licenseConflict.js';
import type { SetupStatusPayload } from '@/lib/services/posService';

type SetupWizardProps = {
  status: SetupStatusPayload | null;
  onCompleted: () => void | Promise<void>;
};

const POSLY_BLUE = '#0001fb';

/**
 * Primeira instalação (Etapa 1F.5c) — exclusivamente Activation Token →
 * Device Auth → Offline License Ed25519 (electron/deviceAuth/*). Nunca
 * número de série/voucher/HMAC: essas rotas continuam a existir só para a
 * consola administrativa interna (app/license-admin), nunca para o POS.
 * Nenhum fallback automático — se a activação falhar, o utilizador tenta de
 * novo com o mesmo token (retry-safe, ver activateViaDeviceActivationToken).
 */
export default function SetupWizard({ onCompleted }: SetupWizardProps) {
  const [token, setToken] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [conflictOpen, setConflictOpen] = useState(false);

  const canSubmit = useMemo(() => token.trim().length >= 20 && !isSubmitting, [token, isSubmitting]);

  const showLicenseConflict = (message: string) => {
    if (isLicenseInUseConflict(message)) {
      setConflictOpen(true);
      setErrorMessage(null);
      return true;
    }
    setErrorMessage(message);
    return false;
  };

  const handleActivate = async () => {
    const value = token.trim();
    if (value.length < 20) {
      setErrorMessage('Introduza o token de activação fornecido pelo seu fornecedor.');
      return;
    }
    if (!window.electronAPI?.activateLicense) {
      setErrorMessage('Activação disponível apenas na aplicação Electron.');
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);
    setSuccessMessage(null);
    try {
      const result = await window.electronAPI.activateLicense(value);
      if (!result?.success) {
        showLicenseConflict(result?.error || 'Falha ao activar. Verifique o token e tente de novo.');
        return;
      }
      setSuccessMessage('Licenciamento concluído. A abrir o ecrã de login...');
      await onCompleted();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Falha ao concluir o licenciamento.';
      showLicenseConflict(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[9999] bg-pos-bg text-zinc-100">
      <div className="mx-auto flex min-h-screen w-full max-w-3xl items-center justify-center px-4 py-10">
        <div className="w-full rounded-2xl border border-pos-border bg-pos-surface/95 p-6 shadow-2xl">
          <h1 className="text-2xl font-bold">Licenciamento do programa</h1>
          <p className="mt-2 text-sm text-zinc-400">
            Introduza o token de activação de dispositivo fornecido pelo seu fornecedor.
          </p>

          <div className="mt-6 space-y-3 rounded border border-pos-border bg-pos-bg/50 p-4">
            <h2 className="text-lg font-semibold text-white">Token de activação</h2>
            <label className="block text-sm">
              <input
                value={token}
                onChange={(event) => setToken(event.target.value.trim())}
                className="mt-1 w-full rounded border border-pos-border bg-zinc-800 px-3 py-2 font-mono text-sm tracking-wide outline-none focus:border-[#0001fb]"
                placeholder="Token de activação"
                autoFocus
                disabled={isSubmitting}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    void handleActivate();
                  }
                }}
              />
            </label>
          </div>

          <div className="mt-5 space-y-2">
            {errorMessage ? (
              <div className="rounded border border-red-700/50 bg-red-950/40 px-3 py-2 text-sm text-red-300">
                {errorMessage}
              </div>
            ) : null}
            {successMessage ? (
              <div className="rounded border border-[#0001fb]/40 bg-[#0001fb]/10 px-3 py-2 text-sm text-[#9ea0ff]">
                {successMessage}
              </div>
            ) : null}
          </div>

          <div className="mt-6 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={() => void handleActivate()}
              disabled={!canSubmit}
              className="rounded bg-[#0001fb] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#1a1bff] disabled:cursor-not-allowed disabled:opacity-50"
              style={{ backgroundColor: POSLY_BLUE }}
            >
              {isSubmitting ? 'A activar...' : 'Activar'}
            </button>
          </div>
        </div>
      </div>

      <LicenseInUseModal open={conflictOpen} onClose={() => setConflictOpen(false)} />
    </div>
  );
}
