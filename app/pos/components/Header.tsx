'use client';

import React from 'react';
import { Armchair, LogOut, Menu, Utensils } from 'lucide-react';
import { PosMenuButton } from '@/components/PosMenuButton';
import type { PosLocation } from '@/lib/services/posService';

// Top bar actions extracted from the POS page to reduce page-level JSX size.
export function Header({
  showTables = true,
  tablesFloorOpen = false,
  locations = [],
  activeLocationId = null,
  selectedTableId = null,
  onSelectLocation,
  onOpenAdminSidebar,
  userName,
  onLogout,
}: {
  showTables?: boolean;
  tablesFloorOpen?: boolean;
  locations?: PosLocation[];
  activeLocationId?: string | null;
  selectedTableId?: string | null;
  onSelectLocation?: (locationId: string) => void;
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

  const displayName = userName || fallbackUserName || 'Operador';
  const userInitial = displayName.trim().charAt(0).toUpperCase() || 'O';
  const showLocationButtons = showTables !== false && locations.length > 0;

  const handleLogout = () => {
    if (onLogout) {
      onLogout();
      return;
    }
    localStorage.removeItem('user');
    window.location.reload();
  };

  return (
    <header className="pos-toolbar flex items-stretch border-b px-2 py-1.5 gap-1 overflow-hidden">
      <div className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto scrollbar-hide">
        <HeaderActionButton
          icon={<Menu size={18} strokeWidth={2.25} />}
          label="Menu"
          title="Menu e configurações"
          onClick={onOpenAdminSidebar}
        />
        {showLocationButtons
          ? locations.map((location) => {
              const openTable = !tablesFloorOpen
                ? location.tables.find((table) => String(table.name) === String(selectedTableId))
                : null;
              const tableLabel = openTable
                ? `Mesa ${String(openTable.displayName || openTable.name)}`
                : null;
              const isActive =
                (tablesFloorOpen && String(location.id) === String(activeLocationId)) ||
                Boolean(tableLabel);
              return (
                <PosMenuButton
                  key={location.id}
                  icon={
                    tableLabel ? (
                      <Utensils size={18} strokeWidth={2} />
                    ) : (
                      <Armchair size={18} strokeWidth={2} />
                    )
                  }
                  label={tableLabel || location.name?.trim() || 'Local'}
                  title={
                    tableLabel
                      ? `${tableLabel} — voltar às mesas de ${location.name?.trim() || 'local'}`
                      : `Mesas de ${location.name?.trim() || 'local'}`
                  }
                  active={isActive}
                  onClick={() => onSelectLocation?.(String(location.id))}
                />
              );
            })
          : null}
      </div>

      <div className="ml-2 flex shrink-0 items-center border-l border-pos-border pl-3">
        <button
          type="button"
          onClick={handleLogout}
          title={`Terminar sessão — ${displayName}`}
          aria-label={`Terminar sessão — ${displayName}`}
          className="pos-header-action pos-header-action--danger pos-operator-logout"
        >
          <span className="pos-operator-logout__user hidden min-[900px]:flex" title={displayName}>
            <span className="text-[10px] font-semibold uppercase tracking-wider opacity-80">Operador</span>
            <span className="max-w-[7.5rem] truncate text-sm font-medium leading-tight">{displayName}</span>
          </span>
          <span
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-current/30 text-xs font-semibold min-[900px]:hidden"
            aria-hidden="true"
          >
            {userInitial}
          </span>
          <span className="pos-operator-logout__divider" aria-hidden="true" />
          <span className="pos-operator-logout__exit">
            <LogOut size={17} strokeWidth={2.25} />
            <span className="text-[9px] font-bold uppercase leading-none tracking-wide">Sair</span>
          </span>
        </button>
      </div>
    </header>
  );
}

function HeaderActionButton({
  icon,
  label,
  title,
  variant = 'default',
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  title: string;
  variant?: 'default' | 'danger';
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      className={`pos-header-action ${variant === 'danger' ? 'pos-header-action--danger' : ''}`}
    >
      {icon}
      <span className="text-[9px] font-bold uppercase leading-none tracking-wide">{label}</span>
    </button>
  );
}
