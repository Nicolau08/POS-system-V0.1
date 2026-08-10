'use client';

import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Download, RefreshCw, X } from 'lucide-react';

type UpdateStatusPayload = {
  status?: 'idle' | 'available' | 'downloading' | 'downloaded' | 'error';
  version?: string | null;
  percent?: number;
  transferred?: number;
  total?: number;
  error?: string | null;
  dismissed?: boolean;
};

function formatBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) return '';
  const mb = value / (1024 * 1024);
  if (mb >= 1) return `${mb.toFixed(1)} MB`;
  const kb = value / 1024;
  return `${kb.toFixed(0)} KB`;
}

/** Notificação de update embutida (Electron) — visual POSly. */
export function UpdateNotification() {
  const [state, setState] = useState<UpdateStatusPayload>({ status: 'idle' });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const api = typeof window !== 'undefined' ? window.electronAPI : undefined;
    if (!api?.getUpdateStatus || !api?.onUpdateStatus) return;

    let disposed = false;
    void api.getUpdateStatus().then((payload) => {
      if (!disposed && payload) setState(payload);
    });

    const unsubscribe = api.onUpdateStatus((payload) => {
      if (payload) setState(payload);
    });

    return () => {
      disposed = true;
      unsubscribe?.();
    };
  }, []);

  const visible = useMemo(() => {
    const status = state.status ?? 'idle';
    return status === 'available' || status === 'downloading' || status === 'downloaded' || status === 'error';
  }, [state.status]);

  const percent = Math.max(0, Math.min(100, Math.round(Number(state.percent) || 0)));
  const versionLabel = state.version ? `v${state.version}` : 'nova versão';

  const handleDismiss = async () => {
    setBusy(true);
    try {
      await window.electronAPI?.dismissUpdate?.();
      setState((prev) => ({ ...prev, status: 'idle', dismissed: true }));
    } finally {
      setBusy(false);
    }
  };

  const handleDownload = async () => {
    setBusy(true);
    try {
      setState((prev) => ({ ...prev, status: 'downloading', percent: Math.max(1, percent), error: null }));
      const result = await window.electronAPI?.downloadUpdate?.();
      if (result && result.ok === false) {
        setState((prev) => ({
          ...prev,
          status: 'error',
          error: String(result.error ?? 'Falha ao baixar atualização'),
        }));
      }
    } catch (error) {
      setState((prev) => ({
        ...prev,
        status: 'error',
        error: String((error as Error)?.message ?? error ?? 'Falha ao baixar atualização'),
      }));
    } finally {
      setBusy(false);
    }
  };

  const handleInstall = async () => {
    setBusy(true);
    try {
      await window.electronAPI?.installUpdate?.();
    } catch (error) {
      setState((prev) => ({
        ...prev,
        status: 'error',
        error: String((error as Error)?.message ?? error ?? 'Falha ao instalar atualização'),
      }));
      setBusy(false);
    }
  };

  const title =
    state.status === 'downloaded'
      ? 'Atualização pronta'
      : state.status === 'downloading'
        ? 'A baixar atualização'
        : state.status === 'error'
          ? 'Erro na atualização'
          : 'Atualização disponível';

  const message =
    state.status === 'downloaded'
      ? `A ${versionLabel} foi descarregada. Reinicie o POSly para concluir a instalação.`
      : state.status === 'downloading'
        ? `A descarregar ${versionLabel}…`
        : state.status === 'error'
          ? state.error || 'Não foi possível concluir a atualização.'
          : `Nova versão disponível (${versionLabel}). Deseja baixar e instalar agora?`;

  return (
    <AnimatePresence>
      {visible ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[300] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
        >
          <motion.div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="posly-update-title"
            initial={{ opacity: 0, scale: 0.96, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 8 }}
            transition={{ type: 'spring', damping: 26, stiffness: 280 }}
            className="w-full max-w-md overflow-hidden rounded-lg border border-zinc-700 bg-[#1f1f1f] shadow-2xl"
          >
            <div className="flex items-center justify-between border-b border-zinc-800 px-5 py-3">
              <h2 id="posly-update-title" className="text-lg font-semibold tracking-tight text-white">
                {title}
              </h2>
              {state.status !== 'downloading' ? (
                <button
                  type="button"
                  onClick={() => void handleDismiss()}
                  disabled={busy}
                  className="rounded p-2 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-white disabled:opacity-50"
                  aria-label="Fechar"
                >
                  <X size={18} />
                </button>
              ) : null}
            </div>

            <div className="flex items-start gap-4 px-5 py-6">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-[#0001fb]/35 bg-[#0001fb]/15 text-[#a5b4fc]">
                {state.status === 'downloaded' ? <RefreshCw size={22} /> : <Download size={22} />}
              </div>
              <div className="min-w-0 flex-1 space-y-3 pt-1">
                <p className="text-[15px] leading-relaxed text-zinc-300">{message}</p>

                {state.status === 'downloading' ? (
                  <div className="space-y-1.5">
                    <div className="h-2 overflow-hidden rounded-full bg-zinc-800">
                      <div
                        className="h-full rounded-full bg-[#0001fb] transition-[width] duration-200"
                        style={{ width: `${percent}%` }}
                      />
                    </div>
                    <div className="flex justify-between text-[11px] text-zinc-500">
                      <span>{percent}%</span>
                      <span>
                        {[formatBytes(Number(state.transferred) || 0), formatBytes(Number(state.total) || 0)]
                          .filter(Boolean)
                          .join(' / ')}
                      </span>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>

            <div className="flex justify-end gap-2 border-t border-zinc-800 bg-[#1a1a1a] px-5 py-3">
              {state.status === 'available' || state.status === 'error' ? (
                <>
                  <button
                    type="button"
                    onClick={() => void handleDismiss()}
                    disabled={busy}
                    className="rounded border border-zinc-600 px-4 py-2 text-sm font-medium text-zinc-200 transition-colors hover:border-[#0001fb] hover:bg-[var(--pos-brand-hover-bg)] hover:text-white disabled:opacity-50"
                  >
                    Depois
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDownload()}
                    disabled={busy}
                    className="pos-on-accent inline-flex items-center gap-2 rounded bg-[#0001fb] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1a1bff] disabled:opacity-50"
                  >
                    <Download size={16} />
                    {state.status === 'error' ? 'Tentar novamente' : 'Atualizar agora'}
                  </button>
                </>
              ) : null}

              {state.status === 'downloading' ? (
                <button
                  type="button"
                  disabled
                  className="inline-flex items-center gap-2 rounded bg-[#0001fb]/40 px-4 py-2 text-sm font-medium text-white"
                >
                  A baixar…
                </button>
              ) : null}

              {state.status === 'downloaded' ? (
                <>
                  <button
                    type="button"
                    onClick={() => void handleDismiss()}
                    disabled={busy}
                    className="rounded border border-zinc-600 px-4 py-2 text-sm font-medium text-zinc-200 transition-colors hover:border-[#0001fb] hover:bg-[var(--pos-brand-hover-bg)] disabled:opacity-50"
                  >
                    Mais tarde
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleInstall()}
                    disabled={busy}
                    className="pos-on-accent inline-flex items-center gap-2 rounded bg-[#00993e] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#00ad46] disabled:opacity-50"
                  >
                    <RefreshCw size={16} />
                    Reiniciar e instalar
                  </button>
                </>
              ) : null}
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
