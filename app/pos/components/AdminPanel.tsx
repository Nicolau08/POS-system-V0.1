'use client';

import React, { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  Activity,
  Banknote,
  Download,
  History,
  Layers,
  LogOut,
  Maximize2,
  MessageSquare,
  Minimize2,
  Power,
  Sliders,
  UserCircle,
  Wrench,
  X,
} from 'lucide-react';
import { SettingsModal } from '@/app/pos/components/SettingsModal';
import { ConfirmDialog, quitPoslyApp } from '@/app/pos/components/ConfirmDialog';
import { usePermissions } from '@/hooks/usePermissions';

export function AdminPanel({
  isOpen,
  onClose,
  currentUserName,
  currentDate,
  onGoToManagement,
  onOpenSalesHistory,
  onOpenEndOfDay,
  onOpenCashMovement,
  onLogout,
  accessLevel,
  onAccessDenied,
}: {
  isOpen: boolean;
  onClose: () => void;
  currentUserName: string | null;
  currentDate: string;
  onGoToManagement: () => void;
  onOpenSalesHistory: () => void;
  onOpenEndOfDay?: () => void;
  onOpenCashMovement?: () => void;
  onLogout: () => void;
  accessLevel?: number | null;
  onAccessDenied?: (message: string) => void;
}) {
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isMaximized, setIsMaximized] = useState(false);
  const [isQuitConfirmOpen, setIsQuitConfirmOpen] = useState(false);
  const { can, denyMessage } = usePermissions(accessLevel);

  useEffect(() => {
    if (!isOpen) return;

    let cancelled = false;
    void (async () => {
      if (window.electronAPI?.isMaximized) {
        try {
          const result = await window.electronAPI.isMaximized();
          if (!cancelled && result?.success) setIsMaximized(Boolean(result.maximized));
          return;
        } catch {
          /* fallback below */
        }
      }
      if (!cancelled) setIsMaximized(Boolean(document.fullscreenElement));
    })();

    const onFullscreenChange = () => {
      setIsMaximized(Boolean(document.fullscreenElement));
    };
    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () => {
      cancelled = true;
      document.removeEventListener('fullscreenchange', onFullscreenChange);
    };
  }, [isOpen]);

  const guard = (key: string, label: string, action?: () => void) => {
    if (!can(key)) {
      onAccessDenied?.(denyMessage(label));
      return;
    }
    action?.();
  };

  const handleOpenSettings = () => {
    guard('gerenciamento.configuracoes', 'Configurações', () => {
      setIsSettingsOpen(true);
      onClose();
    });
  };

  const handleToggleMaximize = async () => {
    if (window.electronAPI?.toggleMaximize) {
      try {
        const result = await window.electronAPI.toggleMaximize();
        if (result?.success) {
          setIsMaximized(Boolean(result.maximized));
          return;
        }
      } catch {
        /* fallback below */
      }
    }

    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
        setIsMaximized(false);
      } else {
        await document.documentElement.requestFullscreen();
        setIsMaximized(true);
      }
    } catch {
      // Browser may block fullscreen without user gesture or policy.
    }
  };

  const handleQuit = async () => {
    setIsQuitConfirmOpen(false);
    await quitPoslyApp({
      onFallbackLogout: () => {
        onLogout();
        onClose();
      },
    });
  };

  return (
    <>
      <AnimatePresence>
        {isOpen && (
          <>
            {/* Overlay */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={onClose}
              className="fixed inset-0 z-[80] pos-modal-overlay"
            />

            {/* Modal centrado */}
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 8 }}
              transition={{ type: 'spring', damping: 28, stiffness: 260 }}
              className="fixed inset-0 z-[90] flex items-center justify-center p-4 pointer-events-none"
            >
              <div
                className="pointer-events-auto w-full max-w-md bg-pos-surface border border-pos-border rounded shadow-2xl flex flex-col overflow-hidden"
                onClick={(e) => e.stopPropagation()}
              >
                {/* Cabeçalho */}
                <div className="flex items-center justify-between gap-3 px-5 pt-5 pb-4">
                  <div className="min-w-0">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-pos-muted">Sessão</p>
                    <h2 className="mt-0.5 truncate text-lg font-semibold text-pos-fg-soft">
                      {currentUserName || 'POS'}
                    </h2>
                  </div>
                  <button
                    type="button"
                    onClick={onClose}
                    className="rounded p-2 text-pos-muted transition-colors hover:bg-pos-surface-3 hover:text-pos-fg"
                    aria-label="Fechar menu"
                  >
                    <X size={18} />
                  </button>
                </div>

                {/* Separador */}
                <div className="h-px bg-pos-border mx-5" />

                {/* Grelha de acções — Operações */}
                <div className="px-5 pt-4 pb-2">
                  <p className="mb-3 text-[10px] font-semibold uppercase tracking-wider text-pos-muted">Operações</p>
                  <div className="grid grid-cols-3 gap-3">
                    {can('gerenciamento.acesso') && (
                      <button
                        type="button"
                        onClick={() => guard('gerenciamento.acesso', 'Gestão', onGoToManagement)}
                        className="pos-header-action !min-h-[64px] !min-w-0 w-full flex-col gap-1.5"
                      >
                        <Wrench size={20} strokeWidth={2} />
                        <span className="text-[10px] font-bold uppercase tracking-wide">Gestão</span>
                      </button>
                    )}
                    {can('vendas.ver_historico_vendas') && (
                      <button
                        type="button"
                        onClick={() => guard('vendas.ver_historico_vendas', 'Histórico de vendas', onOpenSalesHistory)}
                        className="pos-header-action !min-h-[64px] !min-w-0 w-full flex-col gap-1.5"
                      >
                        <History size={20} strokeWidth={2} />
                        <span className="text-[10px] font-bold uppercase tracking-wide leading-tight text-center">Histórico</span>
                      </button>
                    )}
                    {can('vendas.ver_pedidos_em_aberto') && (
                      <button
                        type="button"
                        className="pos-header-action !min-h-[64px] !min-w-0 w-full flex-col gap-1.5 opacity-50 cursor-not-allowed"
                        disabled
                      >
                        <Layers size={20} strokeWidth={2} />
                        <span className="text-[10px] font-bold uppercase tracking-wide leading-tight text-center">Em aberto</span>
                      </button>
                    )}
                    {can('vendas.abrir_caixa') && (
                      <button
                        type="button"
                        onClick={() => guard('vendas.abrir_caixa', 'Movimento de caixa', () => { onOpenCashMovement?.(); onClose(); })}
                        className="pos-header-action !min-h-[64px] !min-w-0 w-full flex-col gap-1.5"
                      >
                        <Download size={20} strokeWidth={2} />
                        <span className="text-[10px] font-bold uppercase tracking-wide leading-tight text-center">Movimento</span>
                      </button>
                    )}
                    {can('vendas.credit_payments') && (
                      <button
                        type="button"
                        className="pos-header-action !min-h-[64px] !min-w-0 w-full flex-col gap-1.5 opacity-50 cursor-not-allowed"
                        disabled
                      >
                        <Banknote size={20} strokeWidth={2} />
                        <span className="text-[10px] font-bold uppercase tracking-wide leading-tight text-center">Crédito</span>
                      </button>
                    )}
                    {can('gerenciamento.fechamento_diario') && (
                      <button
                        type="button"
                        onClick={() => guard('gerenciamento.fechamento_diario', 'Fecho do dia', () => { onOpenEndOfDay?.(); onClose(); })}
                        className="pos-header-action !min-h-[64px] !min-w-0 w-full flex-col gap-1.5"
                      >
                        <Activity size={20} strokeWidth={2} />
                        <span className="text-[10px] font-bold uppercase tracking-wide leading-tight text-center">Fecho dia</span>
                      </button>
                    )}
                  </div>
                </div>

                {/* Separador */}
                <div className="h-px bg-pos-border mx-5 mt-4" />

                {/* Fila de acções — Sessão + Janela */}
                <div className="px-5 pt-4 pb-5 grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={handleOpenSettings}
                    disabled={!can('gerenciamento.configuracoes')}
                    className="pos-header-action !min-h-[52px] !min-w-0 w-full disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <Sliders size={18} strokeWidth={2.25} />
                    <span className="text-[10px] font-bold uppercase tracking-wide">Configurações</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleToggleMaximize()}
                    className="pos-header-action !min-h-[52px] !min-w-0 w-full"
                  >
                    {isMaximized ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
                    <span className="text-[10px] font-bold uppercase tracking-wide">
                      {isMaximized ? 'Restaurar' : 'Ecrã inteiro'}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={onLogout}
                    className="pos-header-action pos-header-action--danger !min-h-[52px] !min-w-0 w-full"
                  >
                    <LogOut size={18} strokeWidth={2.25} />
                    <span className="text-[10px] font-bold uppercase tracking-wide">Sair</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsQuitConfirmOpen(true)}
                    className="pos-header-action pos-header-action--danger !min-h-[52px] !min-w-0 w-full"
                  >
                    <Power size={18} />
                    <span className="text-[10px] font-bold uppercase tracking-wide">Fechar app</span>
                  </button>
                </div>

                {/* Data */}
                <div className="pb-4 text-center">
                  <span className="text-xs text-pos-muted">{currentDate}</span>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      <ConfirmDialog
        isOpen={isQuitConfirmOpen}
        title="Fechar sistema"
        message="Deseja fechar o sistema? O POSly será encerrado neste computador."
        confirmLabel="Fechar"
        cancelLabel="Cancelar"
        tone="danger"
        onCancel={() => setIsQuitConfirmOpen(false)}
        onConfirm={() => void handleQuit()}
      />

      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        initialSection="basicas"
      />
    </>
  );
}
