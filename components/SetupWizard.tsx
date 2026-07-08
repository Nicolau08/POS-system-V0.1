'use client';

import { useEffect, useMemo, useState } from 'react';
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

type SetupFormState = {
  serial: string;
  adminName: string;
  adminPin: string;
  adminPinConfirm: string;
};

const TOTAL_STEPS = 3;

export default function SetupWizard({ status, onCompleted }: SetupWizardProps) {
  const [step, setStep] = useState(1);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLookingUp, setIsLookingUp] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [stores, setStores] = useState<SerialStoreOption[]>([]);
  const [selectedStore, setSelectedStore] = useState<SerialStoreOption | null>(null);
  const [resolvedSerial, setResolvedSerial] = useState('');
  const [electronPaths, setElectronPaths] = useState<{
    userDataPath: string;
    databasePath: string;
    configPath: string;
    licensePath: string;
  } | null>(null);
  const [form, setForm] = useState<SetupFormState>({
    serial: '',
    adminName: 'Administrador',
    adminPin: '',
    adminPinConfirm: '',
  });

  const progressPercent = useMemo(() => Math.round((step / TOTAL_STEPS) * 100), [step]);

  useEffect(() => {
    if (!window.electronAPI?.getAppPaths) return;
    void window.electronAPI
      .getAppPaths()
      .then((payload) => {
        setElectronPaths({
          userDataPath: payload.userDataPath,
          databasePath: payload.databasePath,
          configPath: payload.configPath,
          licensePath: payload.licensePath,
        });
      })
      .catch(() => {
        setElectronPaths(null);
      });
  }, []);

  const updateField = <K extends keyof SetupFormState>(key: K, value: SetupFormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const handleLookupSerial = async () => {
    const serial = form.serial.trim();
    if (serial.length < 4) {
      setErrorMessage('Informe o número de série.');
      return;
    }

    setIsLookingUp(true);
    setErrorMessage(null);
    setSuccessMessage(null);
    try {
      const result = await lookupSerialStores(serial);
      if (!result.stores.length) {
        setErrorMessage('Nenhuma loja encontrada para este número de série.');
        setStores([]);
        setSelectedStore(null);
        return;
      }
      setResolvedSerial(result.serial);
      setStores(result.stores);
      setSelectedStore(result.stores[0]);
      setStep(2);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Falha ao consultar o número de série.');
      setStores([]);
      setSelectedStore(null);
    } finally {
      setIsLookingUp(false);
    }
  };

  const validateAdminStep = () => {
    if (form.adminName.trim().length < 2) return 'Informe o nome do utilizador admin.';
    if (form.adminPin.trim().length < 4) return 'O PIN deve conter pelo menos 4 caracteres.';
    if (form.adminPin !== form.adminPinConfirm) return 'A confirmação do PIN não confere.';
    return null;
  };

  const handleConfirmStore = () => {
    if (!selectedStore) {
      setErrorMessage('Selecione a loja.');
      return;
    }
    setErrorMessage(null);
    setStep(3);
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

  const handleSubmit = async () => {
    const validationError = validateAdminStep();
    if (validationError) {
      setErrorMessage(validationError);
      return;
    }
    if (!selectedStore) {
      setErrorMessage('Selecione a loja.');
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);
    setSuccessMessage(null);
    try {
      await initializeFromSerial({
        serial: resolvedSerial || form.serial.trim(),
        tenantId: selectedStore.tenant_id,
        adminName: form.adminName.trim(),
        adminPin: form.adminPin.trim(),
      });
      setSuccessMessage('Instalação concluída. A abrir o sistema...');
      await onCompleted();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Falha ao concluir a instalação.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[9999] bg-[#121212] text-zinc-100">
      <div className="mx-auto flex min-h-screen w-full max-w-3xl items-center justify-center px-4 py-10">
        <div className="w-full rounded-2xl border border-zinc-800 bg-zinc-900/95 p-6 shadow-2xl">
          <h1 className="text-2xl font-bold">Instalação do POS</h1>
          <p className="mt-2 text-sm text-zinc-400">
            Introduza o número de série da consola de licenças. A loja é obtida do servidor; o resto da configuração
            faz-se dentro do sistema.
          </p>

          <div className="mt-4">
            <div className="h-2 w-full overflow-hidden rounded bg-zinc-800">
              <div className="h-full bg-emerald-500 transition-all" style={{ width: `${progressPercent}%` }} />
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
                    value={form.serial}
                    onChange={(event) => updateField('serial', event.target.value.toUpperCase())}
                    className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 font-mono text-lg tracking-wider outline-none focus:border-emerald-500"
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
                  Série <span className="font-mono text-emerald-300">{resolvedSerial}</span> — confirme a loja:
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
                            ? 'border-emerald-500 bg-emerald-500/15 text-emerald-100'
                            : 'border-zinc-700 bg-zinc-800 text-zinc-200 hover:border-zinc-500'
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

            {step === 3 ? (
              <>
                <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 px-3 py-2 text-sm text-zinc-300">
                  Loja: <strong className="text-white">{selectedStore?.name}</strong>
                  <span className="text-zinc-500"> · </span>
                  Série: <span className="font-mono text-emerald-300">{resolvedSerial}</span>
                </div>
                <label className="block text-sm">
                  Nome do Admin
                  <input
                    value={form.adminName}
                    onChange={(event) => updateField('adminName', event.target.value)}
                    className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 outline-none focus:border-emerald-500"
                    placeholder="Ex.: Administrador"
                  />
                </label>
                <label className="block text-sm">
                  PIN do Admin
                  <input
                    type="password"
                    value={form.adminPin}
                    onChange={(event) => updateField('adminPin', event.target.value)}
                    className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 outline-none focus:border-emerald-500"
                    placeholder="Mínimo 4 caracteres"
                  />
                </label>
                <label className="block text-sm">
                  Confirmar PIN
                  <input
                    type="password"
                    value={form.adminPinConfirm}
                    onChange={(event) => updateField('adminPinConfirm', event.target.value)}
                    className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 outline-none focus:border-emerald-500"
                    placeholder="Repita o PIN"
                  />
                </label>
                <p className="text-xs text-zinc-500">
                  Depois de instalar, configure NUIT, impressora e dados da empresa em Gestão.
                </p>
              </>
            ) : null}
          </div>

          <div className="mt-5 space-y-2">
            {errorMessage ? (
              <div className="rounded border border-red-700/50 bg-red-950/40 px-3 py-2 text-sm text-red-300">
                {errorMessage}
              </div>
            ) : null}
            {successMessage ? (
              <div className="rounded border border-emerald-700/50 bg-emerald-950/40 px-3 py-2 text-sm text-emerald-300">
                {successMessage}
              </div>
            ) : null}
            <div className="rounded border border-zinc-800 bg-zinc-950/60 px-3 py-2 text-xs text-zinc-400">
              {status?.dbPath ? <p>Base de dados local: {status.dbPath}</p> : null}
              {status?.setupConfigPath ? <p>Configuração: {status.setupConfigPath}</p> : null}
              {status?.licensePath ? <p>Licença (API): {status.licensePath}</p> : null}
              {electronPaths?.configPath ? <p>Config local: {electronPaths.configPath}</p> : null}
              {electronPaths?.licensePath ? <p>Licença local: {electronPaths.licensePath}</p> : null}
              {electronPaths?.userDataPath ? <p>Electron userData: {electronPaths.userDataPath}</p> : null}
            </div>
          </div>

          <div className="mt-6 flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={handleBack}
              disabled={step === 1 || isSubmitting || isLookingUp}
              className="rounded-md border border-zinc-700 px-4 py-2 text-sm text-zinc-200 transition-colors hover:border-zinc-500 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Voltar
            </button>
            {step === 1 ? (
              <button
                type="button"
                onClick={() => void handleLookupSerial()}
                disabled={isLookingUp}
                className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isLookingUp ? 'A consultar...' : 'Seguinte'}
              </button>
            ) : null}
            {step === 2 ? (
              <button
                type="button"
                onClick={handleConfirmStore}
                disabled={!selectedStore}
                className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Confirmar loja
              </button>
            ) : null}
            {step === 3 ? (
              <button
                type="button"
                onClick={() => void handleSubmit()}
                disabled={isSubmitting}
                className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isSubmitting ? 'A concluir...' : 'Terminar instalação'}
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
