'use client';

import { useMemo, useState } from 'react';
import { LicenseInUseModal } from '@/components/LicenseInUseModal';
import { isLicenseInUseConflict } from '@/lib/licensing/licenseConflict.js';
import {
  initializeFromSerial,
  lookupSerialStores,
  type SerialStoreOption,
  type SetupStatusPayload,
} from '@/lib/services/posService';

type SetupWizardProps = {
  status: SetupStatusPayload | null;
  onCompleted: () => void | Promise<void>;
};

const TOTAL_STEPS = 2;
const POSLY_BLUE = '#0001fb';

export default function SetupWizard({ onCompleted }: SetupWizardProps) {
  const [step, setStep] = useState(1);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLookingUp, setIsLookingUp] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [conflictOpen, setConflictOpen] = useState(false);
  const [stores, setStores] = useState<SerialStoreOption[]>([]);
  const [selectedStore, setSelectedStore] = useState<SerialStoreOption | null>(null);
  const [resolvedSerial, setResolvedSerial] = useState('');
  const [serial, setSerial] = useState('');

  const progressPercent = useMemo(() => Math.round((step / TOTAL_STEPS) * 100), [step]);

  const showLicenseConflict = (message: string) => {
    if (isLicenseInUseConflict(message)) {
      setConflictOpen(true);
      setErrorMessage(null);
      return true;
    }
    setErrorMessage(message);
    return false;
  };

  const handleLookupSerial = async () => {
    const value = serial.trim();
    if (value.length < 4) {
      setErrorMessage('Informe o número de série.');
      return;
    }

    setIsLookingUp(true);
    setErrorMessage(null);
    setSuccessMessage(null);
    try {
      const result = await lookupSerialStores(value);
      if (!result.stores.length) {
        setErrorMessage('Nenhuma loja encontrada para este número de série.');
        setStores([]);
        setSelectedStore(null);
        return;
      }
      if (result.redeemed) {
        showLicenseConflict(
          'Esta licença já está a ser usada noutra máquina ou base de dados.',
        );
        setStores([]);
        setSelectedStore(null);
        return;
      }
      setResolvedSerial(result.serial);
      setStores(result.stores);
      setSelectedStore(result.stores[0]);
      setStep(2);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Falha ao consultar o número de série.';
      showLicenseConflict(message);
      setStores([]);
      setSelectedStore(null);
    } finally {
      setIsLookingUp(false);
    }
  };

  const handleBack = () => {
    setErrorMessage(null);
    setSuccessMessage(null);
    if (step === 2) {
      setStores([]);
      setSelectedStore(null);
      setResolvedSerial('');
    }
    setStep((prev) => Math.max(1, prev - 1));
  };

  const handleConfirmStore = async () => {
    if (!selectedStore) {
      setErrorMessage('Selecione a loja.');
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);
    setSuccessMessage(null);
    try {
      await initializeFromSerial({
        serial: resolvedSerial || serial.trim(),
        tenantId: selectedStore.tenant_id,
      });
      setSuccessMessage('Licenciamento concluído. A abrir o ecrã de login...');
      await onCompleted();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Falha ao concluir o licenciamento.';
      showLicenseConflict(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[9999] bg-[#121212] text-zinc-100">
      <div className="mx-auto flex min-h-screen w-full max-w-3xl items-center justify-center px-4 py-10">
        <div className="w-full rounded-2xl border border-zinc-800 bg-zinc-900/95 p-6 shadow-2xl">
          <h1 className="text-2xl font-bold">Licenciamento do programa</h1>
          <p className="mt-2 text-sm text-zinc-400">Introduza o número de série.</p>

          <div className="mt-4">
            <div className="h-2 w-full overflow-hidden rounded bg-zinc-800">
              <div
                className="h-full transition-all"
                style={{ width: `${progressPercent}%`, backgroundColor: POSLY_BLUE }}
              />
            </div>
            <p className="mt-2 text-xs text-zinc-400">
              Passo {step} de {TOTAL_STEPS}
            </p>
          </div>

          <div className="mt-6 space-y-4">
            {step === 1 ? (
              <div className="space-y-3 rounded-xl border border-zinc-700 bg-zinc-950/50 p-4">
                <h2 className="text-lg font-semibold text-white">Número de Série</h2>
                <p className="text-sm text-zinc-400">Insira o número de série do seu software:</p>
                <label className="block text-sm">
                  <input
                    value={serial}
                    onChange={(event) => setSerial(event.target.value.toUpperCase())}
                    className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 font-mono text-lg tracking-wider outline-none focus:border-[#0001fb]"
                    placeholder="Ex.: D_9L6WAKYU"
                    autoFocus
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        void handleLookupSerial();
                      }
                    }}
                  />
                </label>
              </div>
            ) : null}

            {step === 2 ? (
              <div className="space-y-3">
                <p className="text-sm text-zinc-300">
                  Série <span className="font-mono text-[#6b6cff]">{resolvedSerial}</span> — confirme a loja:
                </p>
                <div className="space-y-2">
                  {stores.map((store) => {
                    const selected = selectedStore?.tenant_id === store.tenant_id;
                    return (
                      <button
                        key={store.tenant_id}
                        type="button"
                        onClick={() => setSelectedStore(store)}
                        className={`w-full rounded-lg border px-4 py-3 text-left transition-colors ${
                          selected
                            ? 'border-[#0001fb] bg-[#0001fb]/15 text-blue-100'
                            : 'border-zinc-700 bg-zinc-800 text-zinc-200 hover:border-[#0001fb]'
                        }`}
                      >
                        <p className="font-semibold">{store.name}</p>
                        <p className="mt-1 text-xs text-zinc-400">
                          {store.plan}
                          {store.nuit ? ` · NUIT ${store.nuit}` : ''}
                          {store.expires_at
                            ? ` · válida até ${new Date(store.expires_at).toLocaleDateString('pt-PT')}`
                            : ''}
                        </p>
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}
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

          <div className="mt-6 flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={handleBack}
              disabled={step === 1 || isSubmitting || isLookingUp}
              className="rounded-md border border-zinc-700 px-4 py-2 text-sm text-zinc-200 transition-colors hover:border-[#0001fb] disabled:cursor-not-allowed disabled:opacity-40"
            >
              Voltar
            </button>
            {step === 1 ? (
              <button
                type="button"
                onClick={() => void handleLookupSerial()}
                disabled={isLookingUp}
                className="rounded-md bg-[#0001fb] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#1a1bff] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isLookingUp ? 'A consultar...' : 'Seguinte'}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void handleConfirmStore()}
                disabled={!selectedStore || isSubmitting}
                className="rounded-md bg-[#0001fb] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#1a1bff] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isSubmitting ? 'A concluir...' : 'Confirmar loja'}
              </button>
            )}
          </div>
        </div>
      </div>

      <LicenseInUseModal open={conflictOpen} onClose={() => setConflictOpen(false)} />
    </div>
  );
}
