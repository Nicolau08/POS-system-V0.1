'use client';

import React, { useState, useEffect } from 'react';
import { User, Power } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { getPosApiBase } from '@/lib/apiBase';
import { setupAdminPassword } from '@/lib/services/posService';
import { ConfirmDialog, quitPoslyApp } from '@/app/pos/components/ConfirmDialog';
import { useIsPackagedDesktop } from '@/hooks/useIsPackagedDesktop';
import type { User as PosUser } from '@/app/pos/types';

export type LoginScreenProps = {
  users: PosUser[];
  selectedUser: PosUser | null;
  onSelectUser: (user: PosUser) => void;
  password: string;
  setPassword: React.Dispatch<React.SetStateAction<string>>;
  onLogin: () => void | Promise<unknown>;
  error: boolean;
  requiresAdminPasswordSetup?: boolean;
  onAdminPasswordConfigured?: () => void | Promise<void>;
};

export function LoginScreen({
  users,
  selectedUser,
  onSelectUser,
  password,
  setPassword,
  onLogin,
  error,
  requiresAdminPasswordSetup = false,
  onAdminPasswordConfigured,
}: LoginScreenProps) {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isResettingAdminPin, setIsResettingAdminPin] = useState(false);
  const [isQuitConfirmOpen, setIsQuitConfirmOpen] = useState(false);
  const [isSetupMode, setIsSetupMode] = useState(false);
  const [confirmPassword, setConfirmPassword] = useState('');
  const [activeField, setActiveField] = useState<'pin' | 'confirm'>('pin');
  const [setupError, setSetupError] = useState<string | null>(null);
  const [isSavingPassword, setIsSavingPassword] = useState(false);
  const isPackagedDesktop = useIsPackagedDesktop();
  const allowAdminPinReset =
    process.env.NODE_ENV !== 'production' && !isPackagedDesktop;

  const closeModal = () => {
    setIsModalOpen(false);
    setPassword('');
    setConfirmPassword('');
    setActiveField('pin');
    setSetupError(null);
    setIsSetupMode(false);
  };

  const handleSaveAdminPassword = async () => {
    const pin = password.trim();
    const confirm = confirmPassword.trim();
    if (pin.length < 4) {
      setSetupError('O PIN deve conter pelo menos 4 caracteres.');
      return;
    }
    if (pin !== confirm) {
      setSetupError('A confirmação do PIN não confere.');
      return;
    }

    setIsSavingPassword(true);
    setSetupError(null);
    try {
      await setupAdminPassword(pin);
      await onAdminPasswordConfigured?.();
      setIsSetupMode(false);
      setConfirmPassword('');
      setActiveField('pin');
      setPassword('');
      setSetupError(null);
    } catch (err) {
      setSetupError(err instanceof Error ? err.message : 'Falha ao configurar a senha.');
    } finally {
      setIsSavingPassword(false);
    }
  };

  const handleKeyClick = (key: string) => {
    if (key === 'enter') {
      if (isSetupMode) {
        void handleSaveAdminPassword();
      } else {
        void onLogin();
      }
      return;
    }
    if (key === 'back') {
      if (isSetupMode && activeField === 'confirm') {
        setConfirmPassword((prev) => prev.slice(0, -1));
      } else {
        setPassword((prev) => prev.slice(0, -1));
      }
      return;
    }
    if (isSetupMode && activeField === 'confirm') {
      setConfirmPassword((prev) => prev + key);
    } else {
      setPassword((prev) => prev + key);
    }
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isModalOpen) return;

      if (e.key === 'Enter') {
        if (isSetupMode) {
          void handleSaveAdminPassword();
        } else {
          void onLogin();
        }
      } else if (e.key === 'Backspace') {
        if (isSetupMode && activeField === 'confirm') {
          setConfirmPassword((prev) => prev.slice(0, -1));
        } else {
          setPassword((prev) => prev.slice(0, -1));
        }
      } else if (e.key.length === 1) {
        if (isSetupMode && activeField === 'confirm') {
          setConfirmPassword((prev) => prev + e.key);
        } else {
          setPassword((prev) => prev + e.key);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onLogin, setPassword, isModalOpen, isSetupMode, activeField, password, confirmPassword]);

  const keypad = [
    ['1', '2', '3'],
    ['4', '5', '6'],
    ['7', '8', '9'],
    ['back', '0', 'enter'],
  ];

  const handleResetAdminPin = async () => {
    if (!selectedUser || String(selectedUser.role ?? '').toLowerCase() !== 'admin') return;
    const confirmed = window.confirm('Redefinir PIN do Admin para 1234?');
    if (!confirmed) return;

    try {
      setIsResettingAdminPin(true);
      const response = await fetch(`${getPosApiBase()}/auth/admin/reset-pin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: selectedUser.id }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(String(payload?.error ?? `Erro HTTP ${response.status}`));
      }
      setPassword('');
      window.alert('PIN do Admin redefinido para 1234.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'falha ao redefinir PIN do Admin';
      window.alert(message);
    } finally {
      setIsResettingAdminPin(false);
    }
  };

  return (
    <div className="flex flex-col h-screen bg-pos-bg text-zinc-100 font-sans overflow-hidden select-none relative p-8">
      <img
        src="/posly-p-mark.svg"
        alt=""
        aria-hidden
        width={121}
        height={131}
        decoding="async"
        draggable={false}
        className="pointer-events-none fixed left-[-90px] top-[-70px] h-[1200px] w-auto max-w-none select-none z-0 opacity-25"
      />
      <div className="relative z-10 flex flex-1 flex-col items-center justify-center min-h-0">
        <div className="flex flex-wrap justify-center gap-6 max-w-7xl">
          {users
            .slice()
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((user) => (
              <button
                key={user.id}
                onClick={() => {
                  onSelectUser(user);
                  const needsSetup =
                    requiresAdminPasswordSetup &&
                    String(user.role ?? '').toLowerCase() === 'admin';
                  setIsSetupMode(needsSetup);
                  setConfirmPassword('');
                  setActiveField('pin');
                  setSetupError(null);
                  setPassword('');
                  setIsModalOpen(true);
                }}
                className={`
                w-48 h-32 flex flex-col items-center justify-center gap-2 transition-transform active:scale-95 rounded
                ${user.role === 'admin' ? 'bg-[#c0c0c0] text-zinc-900' : 'bg-[#0001fb] text-white'}
              `}
              >
                <div className="flex flex-col items-center">
                  <User size={24} className={user.role === 'admin' ? 'text-zinc-700' : 'text-white/80'} />
                  <span className="text-lg font-medium mt-1">{user.name}</span>
                </div>
              </button>
            ))}
        </div>
        {users.length === 0 && (
          <div
            role="status"
            aria-label="A carregar utilizadores"
            className="flex items-center gap-2.5"
          >
            {[0, 1, 2].map((index) => (
              <motion.span
                key={index}
                className="h-3 w-3 rounded-full bg-zinc-300"
                animate={{ opacity: [0.25, 1, 0.25], scale: [0.8, 1, 0.8] }}
                transition={{
                  duration: 1.1,
                  repeat: Infinity,
                  ease: 'easeInOut',
                  delay: index * 0.18,
                }}
              />
            ))}
          </div>
        )}
      </div>

      <AnimatePresence>
        {isModalOpen && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center pos-modal-overlay p-2 pt-[max(8px,env(safe-area-inset-top))] pb-[max(8px,env(safe-area-inset-bottom))]"
            onClick={closeModal}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.92, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.92, y: 8 }}
              transition={{ type: 'spring', damping: 28, stiffness: 260 }}
              className="bg-pos-surface w-[min(380px,calc(100vw-16px))] max-h-full rounded border border-pos-border shadow-2xl flex flex-col overflow-hidden"
              onClick={(e) => e.stopPropagation()}
              data-posly-pin-modal="1"
            >
              {/* Cabeçalho */}
              <div className="px-5 py-4 flex flex-col items-center justify-center border-b border-pos-border gap-0.5 shrink-0">
                <span className="text-base font-semibold text-pos-fg">
                  {isSetupMode ? 'Configurar senha' : 'Senha'}
                </span>
                {isSetupMode ? (
                  <span className="text-[11px] text-pos-muted">Defina o PIN do Administrador</span>
                ) : null}
              </div>

              <div className="p-4 flex flex-col gap-3 min-h-0 overflow-y-auto">
                {isSetupMode ? (
                  <div className="flex flex-col gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => setActiveField('pin')}
                      className={`h-12 bg-pos-field border rounded flex items-center px-3 transition-all ${
                        activeField === 'pin' ? 'border-[#0001fb]' : 'border-pos-border'
                      }`}
                    >
                      <span className="w-full text-center text-2xl tracking-widest text-pos-fg">
                        {password ? (
                          '•'.repeat(password.length)
                        ) : (
                          <span className="text-sm tracking-normal text-pos-muted">Nova senha</span>
                        )}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveField('confirm')}
                      className={`h-12 bg-pos-field border rounded flex items-center px-3 transition-all ${
                        activeField === 'confirm' ? 'border-[#0001fb]' : 'border-pos-border'
                      }`}
                    >
                      <span className="w-full text-center text-2xl tracking-widest text-pos-fg">
                        {confirmPassword ? (
                          '•'.repeat(confirmPassword.length)
                        ) : (
                          <span className="text-sm tracking-normal text-pos-muted">Confirmar senha</span>
                        )}
                      </span>
                    </button>
                  </div>
                ) : (
                  <div className="shrink-0">
                    <div
                      className={`h-14 bg-pos-field border rounded flex items-center px-4 transition-all duration-200 ${error ? 'border-red-500 animate-shake' : 'border-pos-border'}`}
                    >
                      <input
                        type="password"
                        value={password ?? ''}
                        readOnly
                        inputMode="none"
                        tabIndex={-1}
                        onChange={(e) => setPassword(e.target.value)}
                        className="w-full text-3xl tracking-widest focus:outline-none bg-transparent text-pos-fg text-center pointer-events-none"
                        aria-label="PIN"
                      />
                    </div>
                  </div>
                )}

                {setupError ? (
                  <div className="rounded border border-red-400/40 bg-red-500/10 px-3 py-2 text-xs text-red-400 shrink-0">
                    {setupError}
                  </div>
                ) : null}

                <div className="grid grid-cols-3 gap-2">
                  {keypad.flat().map((key) => (
                    <button
                      key={key}
                      onClick={() => handleKeyClick(key)}
                      disabled={isSavingPassword}
                      className={`
                        h-14 text-base font-semibold flex items-center justify-center transition-colors rounded disabled:opacity-50
                        ${key === 'enter'
                          ? 'bg-[#0001fb] text-white hover:bg-[#1a1bff] shadow-sm'
                          : 'bg-pos-field text-pos-fg hover:bg-pos-surface-3 border border-pos-border'}
                      `}
                    >
                      {key === 'enter'
                        ? isSetupMode
                          ? isSavingPassword
                            ? '...'
                            : 'Guardar'
                          : 'Entrar'
                        : key === 'back'
                          ? 'Apagar'
                          : key}
                    </button>
                  ))}
                </div>

                {!isSetupMode &&
                  allowAdminPinReset &&
                  String(selectedUser?.role ?? '').toLowerCase() === 'admin' && (
                    <button
                      type="button"
                      onClick={() => void handleResetAdminPin()}
                      disabled={isResettingAdminPin}
                      className="h-10 shrink-0 rounded border border-amber-500/40 bg-amber-500/10 text-amber-500 text-xs font-medium transition-colors hover:bg-amber-500/20 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {isResettingAdminPin ? 'A redefinir...' : 'Redefinir PIN do Admin (1234)'}
                    </button>
                  )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <style jsx>{`
        @keyframes shake {
          0%,
          100% {
            transform: translateX(0);
          }
          25% {
            transform: translateX(-5px);
          }
          75% {
            transform: translateX(5px);
          }
        }
        .animate-shake {
          animation: shake 0.2s ease-in-out 0s 2;
        }
      `}</style>

      <div className="absolute bottom-8 right-8 z-10">
        <button
          type="button"
          onClick={() => setIsQuitConfirmOpen(true)}
          className="w-16 h-16 flex items-center justify-center bg-zinc-800/50 hover:bg-red-600/20 text-zinc-500 hover:text-red-500 rounded-full transition-all duration-300 group border border-pos-border/50"
          title="Fechar o sistema"
        >
          <Power size={32} className="group-hover:scale-110 transition-transform" />
        </button>
      </div>

      <ConfirmDialog
        isOpen={isQuitConfirmOpen}
        title="Fechar sistema"
        message="Deseja fechar o sistema? O POSly será encerrado neste computador."
        confirmLabel="Fechar"
        cancelLabel="Cancelar"
        tone="danger"
        onCancel={() => setIsQuitConfirmOpen(false)}
        onConfirm={() => {
          setIsQuitConfirmOpen(false);
          void quitPoslyApp();
        }}
      />
    </div>
  );
}
