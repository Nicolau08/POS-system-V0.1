'use client';

import React from 'react';
import { Archive, FileText, LogOut, Percent, User, Utensils } from 'lucide-react';
import { SyncStatus } from '@/components/SyncStatus';

// Top bar actions extracted from the POS page to reduce page-level JSX size.
export function Header({
  selectedCustomerName,
  selectedTableId,
  salesMode,
  onOpenCustomer,
  onOpenDiscount,
  onOpenQuotation,
  onOpenTable,
  onOpenAdminSidebar,
  userName,
  onLogout,
}: {
  selectedCustomerName: string | null;
  selectedTableId: string | null;
  salesMode: 'customer' | 'table';
  onOpenCustomer: () => void;
  onOpenDiscount: () => void;
  onOpenQuotation: () => void;
  onOpenTable: () => void;
  onOpenAdminSidebar: () => void;
  userName?: string | null;
  onLogout?: () => void;
}) {
  const [fallbackUserName, setFallbackUserName] = React.useState<string | null>(null);

  React.useEffect(() => {
    try {
      const rawUser = localStorage.getItem('user');
      const rawCurrentUser = localStorage.getItem('currentUser');
      const parsedUser = rawUser ? JSON.parse(rawUser) : null;
      const parsedCurrentUser = rawCurrentUser ? JSON.parse(rawCurrentUser) : null;
      setFallbackUserName(parsedUser?.name || parsedCurrentUser?.name || null);
    } catch {
      setFallbackUserName(null);
    }
  }, []);

  const displayName = userName || fallbackUserName || 'User';
  const handleLogout = () => {
    if (onLogout) {
      onLogout();
      return;
    }
    localStorage.removeItem('user');
    window.location.reload();
  };

  return (
    <header className="flex items-center bg-[#1a1a1a] border-b border-zinc-800 px-2 py-1 gap-1 overflow-x-auto scrollbar-hide">
      <HeaderButton
        icon={<User size={20} />}
        label={selectedCustomerName || 'Cliente'}
        active={!!selectedCustomerName}
        onClick={onOpenCustomer}
      />
      <HeaderButton icon={<Percent size={20} />} label="Desconto" onClick={onOpenDiscount} />
      <HeaderButton icon={<FileText size={20} />} label="Cotação" onClick={onOpenQuotation} />

      <div className="w-px h-8 bg-zinc-800 mx-1" />

      <HeaderButton icon={<Archive size={20} />} label="Gaveta de dinheiro" />
      <HeaderButton
        icon={<Utensils size={20} />}
        label={selectedTableId ? `Mesa ${selectedTableId}` : 'Mesas'}
        active={salesMode === 'table'}
        onClick={onOpenTable}
      />

      <div className="flex-grow" />
      <div className="flex items-center gap-3">
        <span className="text-sm font-medium text-zinc-300">{displayName}</span>
        <span className="opacity-50 text-zinc-500">|</span>
        <SyncStatus />
        <button
          onClick={handleLogout}
          className="p-1 rounded hover:bg-zinc-700 transition text-zinc-400 hover:text-white"
          title="Terminar sessão"
          aria-label="Terminar sessão"
        >
          <LogOut size={16} />
        </button>
      </div>
      <button
        onClick={onOpenAdminSidebar}
        className="p-2 hover:bg-zinc-800 rounded text-zinc-400 hover:text-white transition-colors"
        title="Configurações"
      >
        <svg
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
        >
          <circle cx="5" cy="6" r="1.75" fill="currentColor" />
          <circle cx="5" cy="12" r="1.75" fill="currentColor" />
          <circle cx="5" cy="18" r="1.75" fill="currentColor" />
          <path d="M9 6H19" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
          <path d="M9 12H19" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
          <path d="M9 18H19" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
        </svg>
      </button>
    </header>
  );
}

function HeaderButton({
  icon,
  label,
  active,
  className,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  active?: boolean;
  className?: string;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`h-10 min-w-[65px] px-2 flex flex-col items-center justify-center rounded text-[8px] uppercase font-bold transition-colors ${
        active ? 'bg-zinc-800 text-white' : 'text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200'
      } ${className || ''}`}
    >
      {icon}
      <span className="mt-0.5 leading-none tracking-wide">{label}</span>
    </button>
  );
}
