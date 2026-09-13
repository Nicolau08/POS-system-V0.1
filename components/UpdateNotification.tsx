'use client';

import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Download, Minus, RefreshCw, X } from 'lucide-react';

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
  const [minimized, setMinimized] = useState(false);

  useEffect(() => {
    const api = typeof window !== 'undefined' ? window.electronAPI : undefined;
    if (!api?.getUpdateStatus || !api?.onUpdateStatus) return;

    let disposed = false;
    void api
      .getUpdateStatus()
      .then((payload) => {
        if (!disposed && payload) setState(payload);
      })
      .catch(() => {
        /* Dev/unpackaged: o main pode ainda não ter auto-updater. */
      });

    const unsubscribe = api.onUpdateStatus((payload) => {
      if (payload) setState(payload);
    });

    return () => {
      disposed = true;
      unsubscribe?.();
    };
  }, []);

  // Download terminou (ou falhou): reabrir o popup para instalar / ver o erro.
  useEffect(() => {
    if (state.status === 'downloaded' || state.status === 'error') {
      setMinimized(false);
    }
    if (state.status === 'idle' || state.status === 'available') {
      setMinimized(false);
    }
  }, [state.status]);

  const visible = useMemo(() => {
    const status = state.status ?? 'idle';
    return status === 'available' || status === 'downloading' || status === 'downloaded' || status === 'error';
  }, [state.status]);

  const percent = Math.max(0, Math.min(100, Math.round(Number(state.percent) || 0)));
  const versionLabel = state.version ? `v${state.version}` : 'nova versão';
  const showModal = visible && !minimized;
  const showMiniBar = visible && minimized && state.status === 'downloading';

  const handleDismiss = async () => {
    setBusy(true);
    try {
      await window.electronAPI?.dismissUpdate?.();
      setMinimized(false);
      setState((prev) => ({ ...prev, status: 'idle', dismissed: true }));
    } finally {
      setBusy(false);
    }
  };

  const handleDownload = async () => {
    setBusy(true);
    try {
      setMinimized(false);
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
    <>
      <AnimatePresence>
        {showModal ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[300] flex items-center justify-center p-4 pos-modal-overlay"
          >
            <motion.div
              role="alertdialog"
              aria-modal="true"
              aria-labelledby="posly-update-title"
              initial={{ opacity: 0, scale: 0.96, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 8 }}
              transition={{ type: 'spring', damping: 26, stiffness: 280 }}
              className="pos-modal w-full max-w-md"
            >
              <div className="pos-modal-header">
                <h2 id="posly-update-title" className="text-lg font-semibold tracking-tight text-pos-fg">
                  {title}
                </h2>
                <div className="flex items-center gap-1">
                  {state.status === 'downloading' ? (
                    <button
                      type="button"
                      onClick={() => setMinimized(true)}
                      className="rounded p-2 text-pos-muted transition-colors hover:bg-pos-surface-3 hover:text-pos-fg"
                      aria-label="Minimizar"
                      title="Minimizar"
                    >
                      <Minus size={18} />
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void handleDismiss()}
                      disabled={busy}
                      className="rounded p-2 text-pos-muted transition-colors hover:bg-pos-surface-3 hover:text-pos-fg disabled:opacity-50"
                      aria-label="Fechar"
                    >
                      <X size={18} />
                    </button>
                  )}
                </div>
              </div>

              <div className="pos-modal-body flex items-start gap-4 !py-6">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-[#0001fb]/35 bg-[#0001fb]/15 text-[#a5b4fc]">
                  {state.status === 'downloaded' ? <RefreshCw size={22} /> : <Download size={22} />}
                </div>
                <div className="min-w-0 flex-1 space-y-3 pt-1">
                  <p className="text-[15px] leading-relaxed text-pos-muted">{message}</p>

                  {state.status === 'downloading' ? (
                    <div className="space-y-1.5">
                      <div className="h-2 overflow-hidden rounded-full bg-pos-surface-3">
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

              <div className="pos-modal-footer">
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
                    onClick={() => setMinimized(true)}
                    className="inline-flex items-center gap-2 rounded border border-zinc-600 px-4 py-2 text-sm font-medium text-zinc-200 transition-colors hover:border-[#0001fb] hover:bg-[var(--pos-brand-hover-bg)] hover:text-white"
                  >
                    <Minus size={16} />
                    Minimizar
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

      <AnimatePresence>
        {showMiniBar ? (
          <motion.button
            type="button"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 12 }}
            onClick={() => setMinimized(false)}
            className="fixed bottom-4 right-4 z-[300] flex w-[min(100vw-2rem,20rem)] items-center gap-3 rounded border border-pos-border bg-pos-surface px-4 py-3 text-left shadow-2xl transition-colors hover:border-[#0001fb]/60"
            aria-label="Expandir actualização"
            title="Clique para expandir"
          >
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[#0001fb]/35 bg-[#0001fb]/15 text-[#a5b4fc]">
              <Download size={16} />
            </div>
            <div className="min-w-0 flex-1 space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-medium text-zinc-100">A baixar {versionLabel}</span>
                <span className="shrink-0 text-[11px] text-zinc-400">{percent}%</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-pos-surface-3">
                <div
                  className="h-full rounded-full bg-[#0001fb] transition-[width] duration-200"
                  style={{ width: `${percent}%` }}
                />
              </div>
            </div>
          </motion.button>
        ) : null}
      </AnimatePresence>
    </>
  );
}
