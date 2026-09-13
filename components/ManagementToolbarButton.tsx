'use client';

import React from 'react';
import { PosMenuButton } from '@/components/PosMenuButton';

type ManagementToolbarButtonProps = {
  icon: React.ReactNode;
  label: string;
  onClick?: (event: React.MouseEvent<HTMLButtonElement>) => void;
  disabled?: boolean;
  active?: boolean;
  title?: string;
};

/** Toolbar padrão dos módulos de gestão. */
export function ManagementToolbarButton({
  icon,
  label,
  onClick,
  disabled,
  active,
  title,
}: ManagementToolbarButtonProps) {
  return (
    <PosMenuButton
      icon={icon}
      label={label}
      active={active}
      disabled={disabled}
      title={title}
      onClick={onClick as (() => void) | undefined}
      className="!min-w-[84px]"
    />
  );
}

/** Divisora vertical padrão dos toolbars (mesmo peso e tamanho em todo o app). */
export function ManagementToolbarDivider() {
  return (
    <div
      aria-hidden="true"
      className="mx-1.5 h-9 w-px shrink-0 self-center bg-pos-border"
    />
  );
}

export const MANAGEMENT_TOOLBAR_CLASS =
  'flex h-[4.25rem] shrink-0 items-center gap-0.5 overflow-x-auto border-b border-pos-border bg-pos-surface px-2';
