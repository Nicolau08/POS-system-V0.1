'use client';

import React, { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronsUpDown } from 'lucide-react';

export type PosSelectOption = {
  value: string;
  label: string;
};

type PosSelectProps = {
  value: string;
  onChange: (value: string) => void;
  options: PosSelectOption[];
  label?: string;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  triggerClassName?: string;
  /** Alinhamento do valor no trigger */
  align?: 'left' | 'center';
  /** sm = filtros compactos; md = formulários */
  size?: 'sm' | 'md';
  /** Acção no fundo do menu (estilo «Ver mais…») */
  footerActionLabel?: string;
  onFooterAction?: () => void;
};

type MenuCoords = {
  left: number;
  width: number;
  maxHeight: number;
  /** Distância ao topo do ecrã (abre para baixo). */
  top?: number;
  /** Distância ao fundo do ecrã (abre para cima) — alinha à base do trigger. */
  bottom?: number;
};

/**
 * Select custom com painel arredondado e hover nos itens.
 * O menu abre em portal (fixed) para não ficar por baixo de tabelas sticky.
 */
export default function PosSelect({
  value,
  onChange,
  options,
  label,
  placeholder = 'Selecionar…',
  disabled = false,
  className = '',
  triggerClassName = '',
  align = 'left',
  size = 'sm',
  footerActionLabel,
  onFooterAction,
}: PosSelectProps) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<MenuCoords | null>(null);
  const [mounted, setMounted] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  const selected = options.find((opt) => opt.value === value);
  const display = selected?.label ?? placeholder;

  useEffect(() => {
    setMounted(true);
  }, []);

  const updateCoords = () => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const gap = 4;
    const viewportPad = 8;
    const spaceBelow = window.innerHeight - rect.bottom - gap - viewportPad;
    const spaceAbove = rect.top - gap - viewportPad;
    // Preferir baixo; só abrir para cima quando não há espaço útil abaixo.
    const preferBelow = spaceBelow >= 96 || spaceBelow >= spaceAbove;
    const maxHeight = Math.max(96, Math.min(280, preferBelow ? spaceBelow : spaceAbove));
    const width = Math.max(Math.round(rect.width), 112);
    let left = rect.left;
    if (left < viewportPad) left = viewportPad;
    if (left + width > window.innerWidth - viewportPad) {
      left = Math.max(viewportPad, window.innerWidth - width - viewportPad);
    }

    if (preferBelow) {
      setCoords({
        top: rect.bottom + gap,
        left,
        width,
        maxHeight,
      });
      return;
    }

    // `bottom` ancora o menu ao trigger; a altura real do conteúdo cresce para cima.
    setCoords({
      bottom: window.innerHeight - rect.top + gap,
      left,
      width,
      maxHeight,
    });
  };

  useLayoutEffect(() => {
    if (!open) {
      setCoords(null);
      return;
    }
    updateCoords();
    const onReposition = () => updateCoords();
    window.addEventListener('resize', onReposition);
    window.addEventListener('scroll', onReposition, true);
    return () => {
      window.removeEventListener('resize', onReposition);
      window.removeEventListener('scroll', onReposition, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (rootRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const triggerSize = size === 'md' ? 'h-10 px-3 pr-9 text-sm' : 'h-8 px-2 pr-8 text-xs';

  const menu =
    open && mounted && coords
      ? createPortal(
          <div
            ref={menuRef}
            id={listId}
            role="listbox"
            className="pos-dropdown fixed z-[10000] overflow-y-auto overflow-x-hidden custom-scrollbar"
            style={{
              top: coords.top,
              bottom: coords.bottom,
              left: coords.left,
              width: coords.width,
              minWidth: coords.width,
              maxWidth: coords.width,
              maxHeight: coords.maxHeight,
              boxSizing: 'border-box',
            }}
          >
            {options.map((option) => {
              const active = option.value === value;
              const isActionOption =
                option.value === '__create_supplier__' ||
                option.value.startsWith('__action__');
              return (
                <button
                  key={option.value}
                  type="button"
                  role="option"
                  aria-selected={active}
                  className={`pos-dropdown-item whitespace-nowrap text-center ${active ? 'is-active' : ''} ${
                    isActionOption ? '!text-[#a5b4fc] hover:!bg-[var(--pos-brand-hover-bg)]' : ''
                  }`}
                  onClick={() => {
                    onChange(option.value);
                    setOpen(false);
                  }}
                >
                  {option.label}
                </button>
              );
            })}
            {footerActionLabel && onFooterAction ? (
              <button
                type="button"
                className="pos-dropdown-item mt-0.5 !text-[#a5b4fc] hover:!bg-[var(--pos-brand-hover-bg)]"
                onClick={() => {
                  setOpen(false);
                  onFooterAction();
                }}
              >
                {footerActionLabel}
              </button>
            ) : null}
          </div>,
          document.body,
        )
      : null;

  return (
    <div className={className} ref={rootRef}>
      {label ? (
        <label className="mb-1 block text-[11px] text-zinc-400">{label}</label>
      ) : null}
      <div className="relative">
        <button
          ref={triggerRef}
          type="button"
          disabled={disabled}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={listId}
          onClick={() => {
            if (!disabled) setOpen((current) => !current);
          }}
          className={`pos-select-trigger ${triggerSize} ${open ? 'is-open' : ''} ${triggerClassName}`}
        >
          <span className={`w-full truncate text-zinc-200 ${align === 'center' ? 'text-center' : 'text-left'}`}>{display}</span>
          <ChevronsUpDown
            size={size === 'md' ? 15 : 13}
            className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-zinc-500"
          />
        </button>
      </div>
      {menu}
    </div>
  );
}
