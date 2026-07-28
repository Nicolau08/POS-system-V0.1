'use client';

import React from 'react';

type ManagementToolbarButtonProps = {
  icon: React.ReactNode;
  label: string;
  onClick?: (event: React.MouseEvent<HTMLButtonElement>) => void;
  disabled?: boolean;
  active?: boolean;
  title?: string;
};

/** Toolbar padrão dos módulos de gerenciamento (referência: Taxas de impostos). */
export function ManagementToolbarButton({
  icon,
  label,
  onClick,
  disabled,
  active,
  title,
}: ManagementToolbarButtonProps) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      title={title}
      className={`group flex min-w-[82px] flex-col items-center justify-center rounded px-2 py-2 transition-colors hover:bg-[var(--pos-brand-hover-bg)] hover:text-white disabled:cursor-not-allowed disabled:opacity-35 ${
        active ? 'bg-[var(--pos-brand-selected-bg)] text-white' : 'text-zinc-400'
      }`}
    >
      <span className="mb-1 transition-transform group-hover:scale-110">{icon}</span>
      <span className="text-center text-[11px] font-medium leading-none">{label}</span>
    </button>
  );
}

/** Divisora vertical padrão dos toolbars (mesmo peso e tamanho em todo o app). */
export function ManagementToolbarDivider() {
  return (
    <div
      aria-hidden="true"
      className="mx-2 h-8 w-px shrink-0 self-center bg-zinc-700/40"
    />
  );
}

export const MANAGEMENT_TOOLBAR_CLASS =
  'flex h-16 shrink-0 items-center gap-1 overflow-x-auto border-b border-zinc-800 bg-[#1a1a1a] px-2';
