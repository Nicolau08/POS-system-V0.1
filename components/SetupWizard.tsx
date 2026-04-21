'use client';

import { useEffect, useMemo, useState } from 'react';
import { initializeSetupWizard, type SetupStatusPayload } from '@/lib/services/posService';

type SetupWizardProps = {
  status: SetupStatusPayload | null;
  onCompleted: () => void | Promise<void>;
};

type SetupFormState = {
  storeName: string;
  nuit: string;
  adminName: string;
  adminPin: string;
  adminPinConfirm: string;
  printerType: string;
  licenseKey: string;
};

const TOTAL_STEPS = 4;

const PRINTER_OPTIONS = [
  { id: 'thermal-58', label: 'Térmica 58mm' },
  { id: 'thermal-80', label: 'Térmica 80mm' },
  { id: 'a4', label: 'A4 / Laser' },
];

export default function SetupWizard({ status, onCompleted }: SetupWizardProps) {
  const [step, setStep] = useState(1);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [electronPaths, setElectronPaths] = useState<{
    userDataPath: string;
    databasePath: string;
    configPath: string;
    licensePath: string;
  } | null>(null);
  const [form, setForm] = useState<SetupFormState>({
    storeName: status?.tenantName || '',
    nuit: '',
    adminName: 'Administrador',
    adminPin: '',
    adminPinConfirm: '',
    printerType: PRINTER_OPTIONS[1].id,
    licenseKey: '',
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

  const validateStep = () => {
    if (step === 1) {
      if (form.storeName.trim().length < 2) return 'Informe o nome da loja.';
      if (!form.nuit.trim()) return 'Informe o NUIT.';
      return null;
    }
    if (step === 2) {
      if (form.adminName.trim().length < 2) return 'Informe o nome do utilizador admin.';
      if (form.adminPin.trim().length < 4) return 'O PIN deve conter pelo menos 4 caracteres.';
      if (form.adminPin !== form.adminPinConfirm) return 'A confirmação do PIN não confere.';
      return null;
    }
    if (step === 3) {
      if (!form.printerType) return 'Selecione o tipo de impressora.';
      return null;
    }
    if (step === 4) {
      if (form.licenseKey.trim().length < 4) return 'Informe o número de série ou chave de licença.';
      return null;
    }
    return null;
  };

  const handleNext = () => {
    const validationError = validateStep();
    if (validationError) {
      setErrorMessage(validationError);
      return;
    }
    setErrorMessage(null);
    setStep((prev) => Math.min(TOTAL_STEPS, prev + 1));
  };

  const handleBack = () => {
    setErrorMessage(null);
    setStep((prev) => Math.max(1, prev - 1));
  };

  const handleSubmit = async () => {
    const validationError = validateStep();
    if (validationError) {
      setErrorMessage(validationError);
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);
    setSuccessMessage(null);
    try {
      await initializeSetupWizard({
        storeName: form.storeName.trim(),
        nuit: form.nuit.trim(),
        adminName: form.adminName.trim(),
        adminPin: form.adminPin.trim(),
        printerType: form.printerType,
        licenseKey: form.licenseKey.trim(),
      });
      setSuccessMessage('Configuração concluída com sucesso. A abrir o sistema...');
      await onCompleted();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Falha ao concluir configuração inicial.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[9999] bg-[#121212] text-zinc-100">
      <div className="mx-auto flex min-h-screen w-full max-w-3xl items-center justify-center px-4 py-10">
        <div className="w-full rounded-2xl border border-zinc-800 bg-zinc-900/95 p-6 shadow-2xl">
          <h1 className="text-2xl font-bold">Configuração Inicial do POS</h1>
          <p className="mt-2 text-sm text-zinc-400">
            Configure a instalação uma única vez para ativar loja, utilizador admin, impressora e licença.
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
              <>
                <label className="block text-sm">
                  Nome da Loja
                  <input
                    value={form.storeName}
                    onChange={(event) => updateField('storeName', event.target.value)}
                    className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 outline-none focus:border-emerald-500"
                    placeholder="Ex.: Minha Loja"
                  />
                </label>
                <label className="block text-sm">
                  NUIT
                  <input
                    value={form.nuit}
                    onChange={(event) => updateField('nuit', event.target.value)}
                    className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 outline-none focus:border-emerald-500"
                    placeholder="Ex.: 400123456"
                  />
                </label>
              </>
            ) : null}

            {step === 2 ? (
              <>
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
              </>
            ) : null}

            {step === 3 ? (
              <div className="space-y-2">
                <p className="text-sm text-zinc-300">Tipo de Impressora</p>
                <div className="grid gap-2 sm:grid-cols-3">
                  {PRINTER_OPTIONS.map((option) => {
                    const selected = form.printerType === option.id;
                    return (
                      <button
                        key={option.id}
                        type="button"
                        onClick={() => updateField('printerType', option.id)}
                        className={`rounded-md border px-3 py-2 text-sm transition-colors ${
                          selected
                            ? 'border-emerald-500 bg-emerald-500/20 text-emerald-300'
                            : 'border-zinc-700 bg-zinc-800 text-zinc-200 hover:border-zinc-500'
                        }`}
                      >
                        {option.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}

            {step === 4 ? (
              <label className="block text-sm">
                Número de série (ou chave assinada)
                <input
                  value={form.licenseKey}
                  onChange={(event) => updateField('licenseKey', event.target.value)}
                  className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 outline-none focus:border-emerald-500"
                  placeholder="Ex.: D_9L6WAKYU (vincula a este PC na primeira vez)"
                />
                <p className="mt-2 text-xs text-zinc-500">
                  Cadastre o cliente no sistema e use o número de série indicado (formato letra + _ + 8 caracteres). Na
                  primeira configuração neste computador, a licença fica restrita a esta máquina.
                </p>
              </label>
            ) : null}
          </div>

          <div className="mt-5 space-y-2">
            {errorMessage ? <div className="rounded border border-red-700/50 bg-red-950/40 px-3 py-2 text-sm text-red-300">{errorMessage}</div> : null}
            {successMessage ? (
              <div className="rounded border border-emerald-700/50 bg-emerald-950/40 px-3 py-2 text-sm text-emerald-300">{successMessage}</div>
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
              disabled={step === 1 || isSubmitting}
              className="rounded-md border border-zinc-700 px-4 py-2 text-sm text-zinc-200 transition-colors hover:border-zinc-500 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Voltar
            </button>
            {step < TOTAL_STEPS ? (
              <button
                type="button"
                onClick={handleNext}
                disabled={isSubmitting}
                className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Próximo
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void handleSubmit()}
                disabled={isSubmitting}
                className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isSubmitting ? 'A concluir...' : 'Concluir Configuração'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
