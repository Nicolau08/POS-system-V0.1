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
    <div className="flex flex-col h-screen bg-[#121212] text-zinc-100 font-sans overflow-hidden select-none relative p-8">
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
          <div className="rounded border border-zinc-800 bg-zinc-900/70 px-6 py-4 text-center text-zinc-400 max-w-lg">
            <p className="font-medium text-zinc-300">Sem utilizadores para iniciar sessão</p>
            <p className="mt-2 text-sm leading-relaxed">
              Os utilizadores vêm da base de dados local (SQLite). Se ainda não concluiu a configuração
              inicial, volte ao assistente. Se já configurou, confirme que a API está a responder e que
              existem utilizadores com PIN na base desta instalação.
            </p>
          </div>
        )}
      </div>

      <AnimatePresence>
        {isModalOpen && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-2 pt-[max(8px,env(safe-area-inset-top))] pb-[max(8px,env(safe-area-inset-bottom))]"
            onClick={closeModal}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="bg-zinc-900 w-[min(360px,calc(100vw-16px))] max-h-full rounded border border-zinc-800 flex flex-col overflow-hidden"
              onClick={(e) => e.stopPropagation()}
              data-posly-pin-modal="1"
            >
              <div className="bg-zinc-800 px-3 py-1.5 flex flex-col items-center justify-center border-b border-zinc-700 gap-0.5 shrink-0">
                <span className="text-base sm:text-xl text-zinc-100 font-medium">
                  {isSetupMode ? 'Configurar senha' : 'Senha'}
                </span>
                {isSetupMode ? (
                  <span className="text-[11px] text-zinc-400">Defina o PIN do Administrador</span>
                ) : null}
              </div>

              <div className="p-2 sm:p-4 flex flex-col gap-2 sm:gap-4 min-h-0 overflow-y-auto">
                {isSetupMode ? (
                  <div className="flex flex-col gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => setActiveField('pin')}
                      className={`h-[clamp(2.25rem,9vh,3.5rem)] bg-zinc-800 border rounded flex items-center px-3 transition-all ${
                        activeField === 'pin' ? 'border-[#0001fb]' : 'border-zinc-700'
                      }`}
                    >
                      <span className="w-full text-center text-xl sm:text-2xl tracking-widest text-white">
                        {password ? (
                          '•'.repeat(password.length)
                        ) : (
                          <span className="text-sm tracking-normal text-zinc-500">Nova senha</span>
                        )}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveField('confirm')}
                      className={`h-[clamp(2.25rem,9vh,3.5rem)] bg-zinc-800 border rounded flex items-center px-3 transition-all ${
                        activeField === 'confirm' ? 'border-[#0001fb]' : 'border-zinc-700'
                      }`}
                    >
                      <span className="w-full text-center text-xl sm:text-2xl tracking-widest text-white">
                        {confirmPassword ? (
                          '•'.repeat(confirmPassword.length)
                        ) : (
                          <span className="text-sm tracking-normal text-zinc-500">Confirmar senha</span>
                        )}
                      </span>
                    </button>
                  </div>
                ) : (
                  <div className="flex gap-2 shrink-0">
                    <div
                      className={`flex-grow h-[clamp(2.25rem,9vh,4rem)] bg-zinc-800 border rounded flex items-center px-3 transition-all duration-200 ${error ? 'border-red-500 animate-shake' : 'border-zinc-700'}`}
                    >
                      <input
                        type="password"
                        value={password ?? ''}
                        readOnly
                        inputMode="none"
                        tabIndex={-1}
                        onChange={(e) => setPassword(e.target.value)}
                        className="w-full text-xl sm:text-3xl tracking-widest focus:outline-none bg-transparent text-white text-center pointer-events-none"
                        aria-label="PIN"
                      />
                    </div>
                  </div>
                )}

                {setupError ? (
                  <div className="rounded border border-red-700/50 bg-red-950/40 px-3 py-1.5 text-xs sm:text-sm text-red-300 shrink-0">
                    {setupError}
                  </div>
                ) : null}

                <div className="grid grid-cols-3 gap-1 sm:gap-2">
                  {keypad.flat().map((key) => (
                    <button
                      key={key}
                      onClick={() => handleKeyClick(key)}
                      disabled={isSavingPassword}
                      className={`
                        h-[clamp(2rem,8.5vh,4rem)] text-sm sm:text-xl font-medium flex items-center justify-center transition-colors rounded disabled:opacity-50
                        ${key === 'enter' ? 'bg-[#0001fb] text-white hover:bg-[#1a1bff]' : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700 border border-zinc-700'}
                        ${key === 'back' || key === 'enter' ? 'text-xs sm:text-lg' : ''}
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
                      className="h-[clamp(2rem,7vh,2.75rem)] shrink-0 rounded border border-amber-700/60 bg-amber-900/20 text-amber-300 text-xs sm:text-sm font-medium transition-colors hover:bg-amber-900/35 disabled:opacity-50 disabled:cursor-not-allowed"
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
          className="w-16 h-16 flex items-center justify-center bg-zinc-800/50 hover:bg-red-600/20 text-zinc-500 hover:text-red-500 rounded-full transition-all duration-300 group border border-zinc-700/50"
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
