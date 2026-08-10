'use client';

import React, { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  Activity,
  ArrowRight,
  Download,
  FileText,
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
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={onClose}
              className="fixed inset-0 z-[80] bg-black/60 backdrop-blur-sm"
            />
            <motion.div
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className="fixed right-0 top-0 bottom-0 z-[90] w-full max-w-[320px] bg-[#1a1a1a] border-l border-zinc-800 flex flex-col overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="p-6 flex items-center justify-between border-b border-zinc-800/50">
                <h2 className="text-xl font-bold text-white tracking-tight">{currentUserName || 'POS - Admin'}</h2>
                <button onClick={onClose} className="p-2 hover:bg-zinc-800 rounded-full text-zinc-400 hover:text-white transition-colors">
                  <ArrowRight size={20} />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto py-4 scrollbar-hide">
                <div className="px-2 space-y-1">
                  {can('gerenciamento.acesso') && (
                    <SidebarItem
                      icon={<Wrench size={18} />}
                      label="Gerenciamento"
                      onClick={() => guard('gerenciamento.acesso', 'Gerenciamento', onGoToManagement)}
                    />
                  )}
                  <div className="h-px bg-zinc-800/50 mx-4 my-2" />
                  {can('vendas.ver_historico_vendas') && (
                    <SidebarItem
                      icon={<History size={18} />}
                      label="Ver histórico de vendas"
                      onClick={() =>
                        guard('vendas.ver_historico_vendas', 'Ver histórico de vendas', onOpenSalesHistory)
                      }
                    />
                  )}
                  {can('vendas.ver_pedidos_em_aberto') && (
                    <SidebarItem icon={<Layers size={18} />} label="Ver vendas abertas" />
                  )}
                  {can('vendas.abrir_caixa') && (
                    <SidebarItem icon={<Download size={18} />} label="Entrada / Saída de Dinheiro" />
                  )}
                  {can('vendas.credit_payments') && (
                    <SidebarItem icon={<FileText size={18} />} label="Credit payments" />
                  )}
                  {can('gerenciamento.fechamento_diario') && (
                    <SidebarItem
                      icon={<Activity size={18} />}
                      label="Fim do dia"
                      onClick={() =>
                        guard('gerenciamento.fechamento_diario', 'Fim do dia', () => {
                          onOpenEndOfDay?.();
                          onClose();
                        })
                      }
                    />
                  )}
                </div>

                <div className="px-6 mt-6 mb-2">
                  <span className="text-xs font-medium capitalize text-zinc-600">Usuário</span>
                  <div className="h-px bg-zinc-800/50 flex-1 ml-2 inline-block align-middle w-24" />
                </div>

                <div className="px-2 space-y-1">
                  {can('gerenciamento.perfil_usuario') && (
                    <SidebarItem icon={<UserCircle size={18} />} label="Info do Usuário" />
                  )}
                  <SidebarItem icon={<LogOut size={18} />} label="Logout" onClick={onLogout} />
                </div>

                <div className="h-px bg-zinc-800/50 mx-6 my-4" />

                <div className="px-2">
                  <SidebarItem icon={<MessageSquare size={18} />} label="Comentários" />
                </div>

                <div className="mt-8 text-center">
                  <span className="text-xl font-bold text-zinc-700 tracking-tighter">{currentDate}</span>
                </div>
              </div>

              <div className="p-4 grid grid-cols-3 gap-2 border-t border-zinc-800/50">
                <button
                  type="button"
                  title="Configurações"
                  aria-label="Configurações"
                  onClick={handleOpenSettings}
                  className={`flex items-center justify-center p-3 rounded transition-all focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#0001fb] ${
                    can('gerenciamento.configuracoes')
                      ? 'text-zinc-500 hover:bg-[var(--pos-brand-hover-bg)] hover:text-white'
                      : 'text-zinc-700 cursor-not-allowed'
                  }`}
                >
                  <Sliders size={20} />
                </button>
                <button
                  type="button"
                  title={isMaximized ? 'Sair do ecrã inteiro' : 'Ecrã inteiro'}
                  aria-label={isMaximized ? 'Sair do ecrã inteiro' : 'Ecrã inteiro'}
                  onClick={() => void handleToggleMaximize()}
                  className="flex items-center justify-center p-3 rounded text-zinc-500 transition-all hover:bg-[var(--pos-brand-hover-bg)] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#0001fb]"
                >
                  {isMaximized ? <Minimize2 size={20} /> : <Maximize2 size={20} />}
                </button>
                <button
                  type="button"
                  title="Fechar sistema"
                  aria-label="Fechar sistema"
                  onClick={() => setIsQuitConfirmOpen(true)}
                  className="flex items-center justify-center p-3 rounded text-zinc-500 transition-all hover:bg-red-500/15 hover:text-red-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-red-500"
                >
                  <Power size={20} />
                </button>
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

function SidebarItem({
  icon,
  label,
  onClick,
  className,
}: {
  icon: React.ReactNode;
  label: string;
  onClick?: () => void;
  className?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-4 px-4 py-3 text-zinc-400 hover:text-white hover:bg-[var(--pos-brand-hover-bg)] rounded transition-all group ${className || ''}`}
    >
      <div className="text-zinc-500 group-hover:text-white transition-colors">{icon}</div>
      <span className="text-sm font-medium tracking-tight">{label}</span>
    </button>
  );
}
