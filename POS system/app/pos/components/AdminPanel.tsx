'use client';

import React from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  Activity,
  ArrowRight,
  Download,
  FileText,
  History,
  Layers,
  LogOut,
  Maximize,
  MessageSquare,
  Power,
  Sliders,
  UserCircle,
  Wrench,
} from 'lucide-react';

export function AdminPanel({
  isOpen,
  onClose,
  currentUserName,
  currentDate,
  onGoToManagement,
  onOpenSalesHistory,
  onLogout,
}: {
  isOpen: boolean;
  onClose: () => void;
  currentUserName: string | null;
  currentDate: string;
  onGoToManagement: () => void;
  onOpenSalesHistory: () => void;
  onLogout: () => void;
}) {
  return (
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
                <SidebarItem icon={<Wrench size={18} />} label="Gerenciamento" onClick={onGoToManagement} />
                <div className="h-px bg-zinc-800/50 mx-4 my-2" />
                <SidebarItem icon={<History size={18} />} label="Ver histórico de vendas" onClick={onOpenSalesHistory} />
                <SidebarItem icon={<Layers size={18} />} label="Ver vendas abertas" />
                <SidebarItem icon={<Download size={18} />} label="Entrada / Saída de Dinheiro" />
                <SidebarItem icon={<FileText size={18} />} label="Credit payments" />
                <SidebarItem icon={<Activity size={18} />} label="Fim do dia" />
              </div>

              <div className="px-6 mt-6 mb-2">
                <span className="text-xs font-medium capitalize text-zinc-600">Usuário</span>
                <div className="h-px bg-zinc-800/50 flex-1 ml-2 inline-block align-middle w-24" />
              </div>

              <div className="px-2 space-y-1">
                <SidebarItem icon={<UserCircle size={18} />} label="Info do Usuário" />
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
              <button className="flex items-center justify-center p-3 hover:bg-zinc-800 rounded text-zinc-500 hover:text-white transition-all">
                <Sliders size={20} />
              </button>
              <button className="flex items-center justify-center p-3 hover:bg-zinc-800 rounded text-zinc-500 hover:text-white transition-all">
                <Maximize size={20} />
              </button>
              <button className="flex items-center justify-center p-3 hover:bg-zinc-800 rounded text-zinc-500 hover:text-white transition-all">
                <Power size={20} />
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
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
      className={`w-full flex items-center gap-4 px-4 py-3 text-zinc-400 hover:text-white hover:bg-zinc-800/50 rounded transition-all group ${className || ''}`}
    >
      <div className="text-zinc-500 group-hover:text-white transition-colors">{icon}</div>
      <span className="text-sm font-medium tracking-tight">{label}</span>
    </button>
  );
}

