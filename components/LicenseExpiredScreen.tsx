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

/** Mensagens longas de formato/token → texto curto no ecrã. */
function normalizeActivationError(message: string): string {
  const text = String(message ?? '').trim();
  if (!text) return 'Token errado.';
  if (/já foi utilizado/i.test(text)) {
    return 'Este token já foi utilizado. Peça um novo na consola.';
  }
  if (/Token expirado/i.test(text) || /token.*expirad/i.test(text)) {
    return 'Token expirado. Gere outro na consola de licenças.';
  }
  if (
    /formato de licen/i.test(text) ||
    /formato da chave/i.test(text) ||
    /base64/i.test(text) ||
    /chave de licen[cç]a inv[aá]lida/i.test(text)
  ) {
    return 'Token errado.';
  }
  // Não colapsar "Token inválido..." genérico se a mensagem já for clara da consola.
  if (/ainda está expirada na consola/i.test(text)) {
    return text;
  }
  if (/token (de reativa[cç][aã]o )?inv[aá]lido/i.test(text) && text.length < 80) {
    return 'Token errado.';
  }
  return text;
}

export default function LicenseExpiredScreen({
  tenantName,
  expiresAt,
  isRevalidating = false,
  isActivating = false,
  hasElectronActivation = false,
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
      setError('Introduza o token de ativação.');
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
      setError(normalizeActivationError(message));
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-pos-bg px-4 text-zinc-200">
      <section className="relative w-full max-w-2xl rounded border border-[#0001fb]/70 bg-pos-bg p-8 shadow-2xl">
        <p className="text-center text-2xl font-bold tracking-wide text-[#0001fb]">POSLY</p>
        <h1 className="mt-3 text-center text-2xl font-bold text-amber-400 sm:text-3xl">
          Sua licença expirou!
        </h1>
        <p className="mt-3 text-center text-sm leading-relaxed text-zinc-300">
          Para continuar usando o POSLY, insira o código de renovação ou entre em contato com o
          suporte para renovar sua licença.
        </p>

        <div className="mt-6 rounded border border-pos-border bg-pos-bg/80 p-4 text-sm text-zinc-200">
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
            Token de ativação
            <input
              value={licenseKey}
              onChange={(event) => setLicenseKey(event.target.value)}
              placeholder="introduza o token"
              className="mt-2 w-full rounded border border-pos-border bg-zinc-950 px-3 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-500 outline-none ring-[rgba(0, 1, 251,0.45)] focus:ring"
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
              className="rounded bg-[#0001fb] px-4 py-2 text-sm font-medium text-white hover:bg-[#1a1bff] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isActivating ? 'A ativar…' : 'Ativar'}
            </button>
          </div>
        </form>

        <div className="mt-8">
          <div className="mb-4 flex items-center gap-3" role="separator" aria-label="Suporte">
            <span className="h-px flex-1 bg-zinc-800" />
            <span className="shrink-0 text-xs font-normal tracking-wide text-zinc-500">
              Suporte
            </span>
            <span className="h-px flex-1 bg-zinc-800" />
          </div>
          <ul className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
            <li className="flex items-center justify-center gap-2.5 text-sm font-medium text-zinc-200 sm:justify-start">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#0001fb]/15 ring-1 ring-[#0001fb]/35">
                <Phone className="h-4 w-4 text-[#a5b4fc]" aria-hidden />
              </span>
              <span className="truncate">{SUPPORT_PHONE}</span>
            </li>
            <li className="flex items-center justify-center gap-2.5 text-sm font-medium text-zinc-200 sm:justify-start">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#0001fb]/15 ring-1 ring-[#0001fb]/35">
                <Mail className="h-4 w-4 text-[#a5b4fc]" aria-hidden />
              </span>
              <span className="truncate">{SUPPORT_EMAIL}</span>
            </li>
            <li className="flex items-center justify-center gap-2.5 text-sm font-medium text-zinc-200 sm:justify-start">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#0001fb]/15 ring-1 ring-[#0001fb]/35">
                <MessageCircle className="h-4 w-4 text-[#a5b4fc]" aria-hidden />
              </span>
              <span className="truncate">{SUPPORT_WHATSAPP}</span>
            </li>
          </ul>
        </div>
      </section>
    </main>
  );
}
