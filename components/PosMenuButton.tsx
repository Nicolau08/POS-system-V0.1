'use client';

import React from 'react';

type PosMenuButtonProps = {
  icon: React.ReactNode;
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  title?: string;
  className?: string;
};

/** Botão da toolbar POS — ícone e texto dentro da mesma borda. */
export function PosMenuButton({
  icon,
  label,
  active,
  disabled,
  onClick,
  title,
  className = '',
}: PosMenuButtonProps) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      title={title ?? label}
      aria-label={title ?? label}
      className={`pos-menu-btn ${active ? 'is-active' : ''} ${disabled ? 'is-disabled' : ''} ${className}`.trim()}
    >
      <span className="pos-menu-icon" aria-hidden="true">
        {icon}
      </span>
      <span className="pos-menu-label">{label}</span>
    </button>
  );
};

type PosSidebarNavItemProps = {
  icon: React.ReactNode;
  label: string;
  active?: boolean;
  collapsed?: boolean;
  onClick?: () => void;
  title?: string;
  trailing?: React.ReactNode;
  className?: string;
};

/** Item de navegação lateral (gestão, menu admin). */
export function PosSidebarNavItem({
  icon,
  label,
  active,
  collapsed,
  onClick,
  title,
  trailing,
  className = '',
}: PosSidebarNavItemProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={collapsed ? (title ?? label) : undefined}
      aria-label={title ?? label}
      aria-current={active ? 'page' : undefined}
      className={`pos-nav-item ${active ? 'is-active' : ''} ${collapsed ? 'is-collapsed' : ''} ${className}`.trim()}
    >
      <span className="pos-nav-icon" aria-hidden="true">
        {icon}
      </span>
      {!collapsed ? (
        <>
          <span className="pos-nav-label">{label}</span>
          {trailing ? <span className="pos-nav-trailing">{trailing}</span> : null}
        </>
      ) : null}
    </button>
  );
}

export function posNavItemClass(active: boolean, collapsed: boolean) {
  return `pos-nav-item ${active ? 'is-active' : ''} ${collapsed ? 'is-collapsed' : ''}`.trim();
}

export function PosNavSectionTitle({ children }: { children: React.ReactNode }) {
  return <p className="pos-nav-section">{children}</p>;
}
