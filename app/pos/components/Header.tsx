'use client';

import React from 'react';
import { Archive, CreditCard, Percent, User, Utensils } from 'lucide-react';

// Top bar actions extracted from the POS page to reduce page-level JSX size.
export function Header({
  selectedCustomerName,
  selectedTableId,
  salesMode,
  isCashierModalOpen,
  onOpenCustomer,
  onOpenDiscount,
  onOpenTable,
  onOpenCashier,
  onOpenAdminSidebar,
}: {
  selectedCustomerName: string | null;
  selectedTableId: string | null;
  salesMode: 'customer' | 'table';
  isCashierModalOpen: boolean;
  onOpenCustomer: () => void;
  onOpenDiscount: () => void;
  onOpenTable: () => void;
  onOpenCashier: () => void;
  onOpenAdminSidebar: () => void;
}) {
  return (
    <header className="flex items-center bg-[#1a1a1a] border-b border-zinc-800 px-2 py-1 gap-1 overflow-x-auto scrollbar-hide">
      <HeaderButton
        icon={<User size={20} />}
        label={selectedCustomerName || 'Cliente'}
        active={!!selectedCustomerName}
        onClick={onOpenCustomer}
      />
      <HeaderButton icon={<Percent size={20} />} label="Desconto" onClick={onOpenDiscount} />

      <div className="w-px h-8 bg-zinc-800 mx-1" />

      <HeaderButton icon={<Archive size={20} />} label="Gaveta de dinheiro" />
      <HeaderButton
        icon={<Utensils size={20} />}
        label={selectedTableId ? `Mesa ${selectedTableId}` : 'Mesas'}
        active={salesMode === 'table'}
        onClick={onOpenTable}
      />
      <HeaderButton
        icon={<CreditCard size={20} />}
        label="Caixa"
        active={isCashierModalOpen}
        onClick={onOpenCashier}
        className={isCashierModalOpen ? 'bg-red-600/20 text-red-500 border border-red-500/30' : ''}
      />

      <div className="flex-grow" />
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
