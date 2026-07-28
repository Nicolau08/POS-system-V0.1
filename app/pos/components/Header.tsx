'use client';

import React from 'react';
import { Archive, FileText, LogOut, Percent, Printer, User, Utensils } from 'lucide-react';
import { ManagementToolbarDivider } from '@/components/ManagementToolbarButton';

// Top bar actions extracted from the POS page to reduce page-level JSX size.
export function Header({
  selectedCustomerName,
  selectedTableId,
  tableDisplayLabel,
  salesMode,
  onOpenCustomer,
  onOpenDiscount,
  onOpenQuotation,
  onOpenCashDrawer,
  onOpenTable,
  showTables = true,
  tablesFloorOpen = false,
  onOpenBillPreview,
  billPreviewEnabled = false,
  onOpenAdminSidebar,
  userName,
  onLogout,
}: {
  selectedCustomerName: string | null;
  selectedTableId: string | null;
  /** Nome opcional dado ao abrir a mesa no POS */
  tableDisplayLabel?: string | null;
  salesMode: 'customer' | 'table';
  onOpenCustomer: () => void;
  onOpenDiscount: () => void;
  onOpenQuotation: () => void;
  onOpenCashDrawer?: () => void;
  onOpenTable: () => void;
  /** False = licença retalho/farmácia — oculta botão Mesas */
  showTables?: boolean;
  /** Grelha de mesas a substituir os produtos */
  tablesFloorOpen?: boolean;
  onOpenBillPreview?: () => void;
  billPreviewEnabled?: boolean;
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

      <ManagementToolbarDivider />

      <HeaderButton icon={<Archive size={20} />} label="Gaveta de dinheiro" onClick={onOpenCashDrawer} />
      {showTables !== false ? (
        <HeaderButton
          icon={<Utensils size={20} />}
          label={
            selectedTableId
              ? tableDisplayLabel
                ? `Mesa ${selectedTableId} · ${tableDisplayLabel}`
                : `Mesa ${selectedTableId}`
              : 'Mesas'
          }
          active={tablesFloorOpen || salesMode === 'table'}
          onClick={onOpenTable}
        />
      ) : null}

      <ManagementToolbarDivider />

      <HeaderButton
        icon={<Printer size={20} />}
        label="Conta"
        onClick={onOpenBillPreview}
        disabled={!billPreviewEnabled}
      />

      <div className="flex-grow" />
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-zinc-300">{displayName}</span>
        <button
          onClick={handleLogout}
          className="rounded border border-transparent p-1 text-zinc-400 transition-colors hover:border-[#0001fb] hover:bg-[var(--pos-brand-hover-bg)] hover:text-white"
          title="Terminar sessão"
          aria-label="Terminar sessão"
        >
          <LogOut size={16} />
        </button>
      </div>
      <button
        onClick={onOpenAdminSidebar}
        className="p-2 rounded text-zinc-400 transition-colors hover:bg-[var(--pos-brand-hover-bg)] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#0001fb] focus-visible:outline-offset-1"
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
  disabled,
  className,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  active?: boolean;
  disabled?: boolean;
  className?: string;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`h-10 min-w-[65px] px-2 flex flex-col items-center justify-center rounded text-[8px] uppercase font-bold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#0001fb] focus-visible:outline-offset-1 ${
        disabled
          ? 'cursor-not-allowed text-zinc-700 opacity-50'
          : active
            ? 'bg-[var(--pos-brand-selected-bg)] text-white'
            : 'text-zinc-500 hover:bg-[var(--pos-brand-hover-bg)] hover:text-zinc-200'
      } ${className || ''}`}
    >
      {icon}
      <span className="mt-0.5 leading-none tracking-wide">{label}</span>
    </button>
  );
}
