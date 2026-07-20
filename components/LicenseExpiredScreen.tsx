'use client';

import { FormEvent, useMemo, useState } from 'react';
import { Mail, MessageCircle, Phone } from 'lucide-react';

type LicenseExpiredScreenProps = {
  tenantName: string | null;
  expiresAt: string | null;
  isRevalidating?: boolean;
  isActivating?: boolean;
  hasElectronActivation?: boolean;
  onRevalidate: () => Promise<void> | void;
  onActivate?: (licenseKey: string) => Promise<void> | void;
};

const SUPPORT_PHONE = process.env.NEXT_PUBLIC_POSLY_SUPPORT_PHONE ?? '+258 123 456 789';
const SUPPORT_EMAIL = process.env.NEXT_PUBLIC_POSLY_SUPPORT_EMAIL ?? 'suporte@posly.com';
const SUPPORT_WHATSAPP = process.env.NEXT_PUBLIC_POSLY_SUPPORT_WHATSAPP ?? '+258 987 654 321';

function formatExpirationPt(iso: string | null): string {
  if (!iso) return 'N/A';
  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed)) return iso;
  return new Intl.DateTimeFormat('pt-PT', {
    dateStyle: 'long',
    timeStyle: 'short',
  }).format(new Date(parsed));
}

function digitsOnly(value: string): string {
  return value.replace(/\D/g, '');
}

export default function LicenseExpiredScreen({
  tenantName,
  expiresAt,
  isRevalidating = false,
  isActivating = false,
  hasElectronActivation = false,
  onRevalidate,
  onActivate,
}: LicenseExpiredScreenProps) {
  const [licenseKey, setLicenseKey] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const formattedExpiration = useMemo(() => formatExpirationPt(expiresAt), [expiresAt]);
  const isBusy = isRevalidating || isActivating;

  const handleActivateSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setSuccess(null);
    const trimmedKey = licenseKey.trim();
    if (!trimmedKey) {
      setError('Introduza o código de renovação.');
      return;
    }
    if (!onActivate) {
      setError('Ativação disponível apenas na app POSly para desktop.');
      return;
    }

    try {
      await onActivate(trimmedKey);
      setSuccess('Licença renovada. A revalidar o POSly…');
      setLicenseKey('');
    } catch (submitError) {
      const message =
        submitError instanceof Error ? submitError.message : 'Falha ao ativar licença.';
      setError(message);
    }
  };

  const handleContactSupport = () => {
    window.location.href = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent('Renovação de licença POSly')}`;
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#121212] px-4 text-zinc-200">
      <section className="w-full max-w-2xl rounded-xl border border-rose-900/70 bg-[#0f0f0f] p-8 shadow-2xl">
        <p className="text-center text-2xl font-bold tracking-wide text-rose-500">POSLY</p>
        <h1 className="mt-3 text-center text-2xl font-bold text-amber-400 sm:text-3xl">
          Sua licença expirou!
        </h1>
        <p className="mt-3 text-center text-sm leading-relaxed text-zinc-300">
          Para continuar usando o POSLY, insira o código de renovação ou entre em contato com o
          suporte para renovar sua licença.
        </p>

        <div className="mt-6 rounded-lg border border-zinc-800 bg-zinc-950/80 p-4 text-sm text-zinc-200">
          <p>
            <span className="text-zinc-400">Loja:</span>{' '}
            <strong>{tenantName || 'N/A'}</strong>
          </p>
          <p className="mt-1">
            <span className="text-zinc-400">Dia de Bloqueio:</span>{' '}
            <strong>{formattedExpiration}</strong>
          </p>
        </div>

        <form className="mt-6 space-y-4" onSubmit={handleActivateSubmit}>
          <label className="block text-sm font-medium text-zinc-200">
            Código de Renovação
            <input
              value={licenseKey}
              onChange={(event) => setLicenseKey(event.target.value)}
              placeholder="Token 12 dígitos ou Base64/JSON"
              className="mt-2 w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-500 outline-none ring-[rgba(0,1,251,0.45)] focus:ring"
              disabled={isBusy}
              autoComplete="off"
            />
          </label>
          {error ? <p className="text-sm text-rose-400">{error}</p> : null}
          {success ? <p className="text-sm text-[#a5b4fc]">{success}</p> : null}
          <p className="text-xs text-zinc-500">
            O token de 12 dígitos funciona <strong className="text-zinc-400">sem internet</strong> (validação
            local). Com rede, a consola também pode sincronizar a nova data automaticamente.
          </p>
          {!hasElectronActivation ? (
            <p className="text-xs text-zinc-500">
              A ativação com código requer a app POSly para desktop (Electron).
            </p>
          ) : null}

          <div className="flex flex-wrap gap-2 pt-1">
            <button
              type="submit"
              disabled={isBusy}
              className="rounded-md bg-[#0001fb] px-4 py-2 text-sm font-medium text-white hover:bg-[#1a1bff] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isActivating ? 'A ativar…' : 'Ativar licença'}
            </button>
            <button
              type="button"
              onClick={() => void onRevalidate()}
              disabled={isBusy}
              className="rounded-md border border-zinc-600 bg-transparent px-4 py-2 text-sm text-zinc-100 hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isRevalidating ? 'A revalidar…' : 'Revalidar'}
            </button>
            <button
              type="button"
              onClick={handleContactSupport}
              className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500"
            >
              <MessageCircle className="h-4 w-4" aria-hidden />
              Contactar Suporte
            </button>
          </div>
        </form>

        <div className="mt-8 border-t border-zinc-800 pt-6">
          <p className="text-sm text-zinc-300">
            <strong>Precisa de ajuda?</strong> Contacte nosso suporte:
          </p>
          <ul className="mt-3 space-y-2 text-sm text-zinc-300">
            <li className="flex items-center gap-2">
              <Phone className="h-4 w-4 shrink-0 text-emerald-500" aria-hidden />
              <span>
                Telefone:{' '}
                <a href={`tel:${digitsOnly(SUPPORT_PHONE)}`} className="hover:text-white">
                  {SUPPORT_PHONE}
                </a>
              </span>
            </li>
            <li className="flex items-center gap-2">
              <Mail className="h-4 w-4 shrink-0 text-amber-500" aria-hidden />
              <span>
                E-mail:{' '}
                <a href={`mailto:${SUPPORT_EMAIL}`} className="hover:text-white">
                  {SUPPORT_EMAIL}
                </a>
              </span>
            </li>
            <li className="flex items-center gap-2">
              <MessageCircle className="h-4 w-4 shrink-0 text-emerald-500" aria-hidden />
              <span>
                WhatsApp:{' '}
                <a
                  href={`https://wa.me/${digitsOnly(SUPPORT_WHATSAPP)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-white"
                >
                  {SUPPORT_WHATSAPP}
                </a>
              </span>
            </li>
          </ul>
        </div>
      </section>
    </main>
  );
}
