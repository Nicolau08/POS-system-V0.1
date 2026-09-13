'use client';

import React from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Archive, Banknote, FileText, MessageSquare, Minus, Percent, Plus, Printer, RotateCcw, Trash2, User } from 'lucide-react';
import type { CartItem, Customer, Discount } from '@/app/pos/types';

function lineGross(item: CartItem) {
  return item.price * item.quantity;
}

function lineItemDiscount(item: CartItem) {
  if (!item.discount) return 0;
  const gross = lineGross(item);
  return item.discount.type === 'percentage'
    ? (gross * item.discount.amount) / 100
    : item.discount.amount;
}

// Right sidebar cart section extracted from the POS page.
export function Cart({
  selectedCartItemId,
  docType,
  onCycleDocType,
  selectedCustomer,
  customerName,
  onCustomerNameChange,
  customers,
  onSelectCustomer,
  onCreateCustomerFromName,
  cart,
  globalDiscount,
  formatPrice,
  onToggleItemSelection,
  onEditItemQuantity,
  onChangeQuantity,
  onOpenLineDiscount,
  onEditItemNotes,
  onRemoveItem,
  onClearSelection,
  originalSubtotal,
  totalDiscount,
  tax,
  total,
  onCancelOrder,
  canCancelOrder = true,
  onOpenPayment,
  onOpenCustomer,
  onOpenDiscount,
  onOpenQuotation,
  onOpenBill,
  onOpenCashDrawer,
  allowItemNotes = false,
}: {
  selectedCartItemId?: string | null;
  docType: 'VD' | 'TK' | 'FP' | 'FT';
  onCycleDocType: () => void;
  selectedCustomer: Customer | null;
  customerName: string;
  onCustomerNameChange: (value: string) => void;
  customers: Customer[];
  onSelectCustomer: (customer: Customer | null) => void;
  onCreateCustomerFromName: () => void;
  cart: CartItem[];
  globalDiscount: Discount | null;
  formatPrice: (value: number) => string;
  onToggleItemSelection: (id: string) => void;
  onEditItemQuantity: (item: CartItem) => void;
  onChangeQuantity: (item: CartItem, quantity: number) => void;
  onOpenLineDiscount?: (item: CartItem) => void;
  onEditItemNotes?: (item: CartItem) => void;
  onRemoveItem: (id: string) => void;
  onClearSelection: () => void;
  originalSubtotal: number;
  totalDiscount: number;
  tax: number;
  total: number;
  onCancelOrder: () => void;
  canCancelOrder?: boolean;
  onOpenPayment: () => void;
  onOpenCustomer?: () => void;
  onOpenDiscount?: () => void;
  onOpenQuotation?: () => void;
  onOpenBill?: () => void;
  onOpenCashDrawer?: () => void;
  allowItemNotes?: boolean;
}) {
  const listRef = React.useRef<HTMLDivElement>(null);
  const dragRef = React.useRef({ active: false, startY: 0, startScroll: 0, moved: false });

  const onListPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest('button, input, textarea, a')) return;
    const el = listRef.current;
    if (!el) return;
    event.preventDefault();
    dragRef.current = { active: true, startY: event.clientY, startScroll: el.scrollTop, moved: false };
    el.setPointerCapture(event.pointerId);
  };
  const onListPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current.active || !listRef.current) return;
    event.preventDefault();
    const dy = event.clientY - dragRef.current.startY;
    if (Math.abs(dy) > 3) dragRef.current.moved = true;
    listRef.current.scrollTop = dragRef.current.startScroll - dy;
  };
  const onListPointerUp = (event?: React.PointerEvent<HTMLDivElement>) => {
    if (event && listRef.current?.hasPointerCapture(event.pointerId)) {
      listRef.current.releasePointerCapture(event.pointerId);
    }
    dragRef.current.active = false;
  };
  const onListClickCapture = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!dragRef.current.moved) return;
    event.preventDefault();
    event.stopPropagation();
    dragRef.current.moved = false;
  };

  const docTypeButtonClass =
    docType === 'FP'
      ? 'bg-amber-600 hover:bg-amber-500'
      : docType === 'TK'
        ? 'bg-sky-600 hover:bg-sky-500'
        : 'bg-[#0001fb] hover:bg-[#1a1bff]';

  return (
    <div className="flex h-full min-h-0 w-[350px] flex-col overflow-hidden border-l border-pos-border bg-pos-surface">
      <div className="h-14 shrink-0 p-2 border-b border-pos-border flex items-center gap-2 bg-pos-surface">
        {canCancelOrder ? (
          <button
            type="button"
            onClick={onCancelOrder}
            className="w-12 h-10 flex flex-col items-center justify-center rounded bg-red-600 hover:bg-red-500 text-white transition-colors"
            title="Cancelar pedido"
          >
            <Trash2 size={14} />
            <span className="text-[7px] capitalize font-bold mt-0.5 leading-none">Cancelar</span>
          </button>
        ) : null}

        <div className="flex-[2] flex items-center rounded h-10 relative overflow-hidden border border-pos-border bg-pos-field">
          <button
            onClick={onCycleDocType}
            className={`h-full px-3 text-white font-bold text-xs flex items-center justify-center min-w-[45px] transition-colors border-r border-pos-border/50 ${docTypeButtonClass}`}
            title="Tipo de Documento"
          >
            {docType}
          </button>

          <div className="flex-1 flex items-center px-3 h-full">
            {selectedCustomer ? (
              <div className="flex items-center gap-2 w-full overflow-hidden">
                <div className="w-5 h-5 rounded-full bg-[#0001fb] flex items-center justify-center text-white flex-shrink-0">
                  <User size={12} />
                </div>
                <span className="text-xs text-[#a5b4fc] font-bold truncate">{selectedCustomer.name}</span>
                <button onClick={() => onSelectCustomer(null)} className="ml-auto text-pos-muted hover:text-rose-500 transition-colors">
                  <RotateCcw size={12} />
                </button>
              </div>
            ) : (
              <>
                <input
                  type="text"
                  value={customerName ?? ''}
                  onChange={(e) => onCustomerNameChange(e.target.value)}
                  className="bg-transparent w-full outline-none text-xs text-pos-fg placeholder:text-pos-muted"
                  placeholder="Nome do cliente..."
                />
                {customerName.length > 0 && (
                  <div className="pos-dropdown absolute top-full left-0 z-50 mt-1 w-full">
                    {customers
                      .filter((c) => c.name.toLowerCase().includes(customerName.toLowerCase()))
                      .slice(0, 3)
                      .map((c) => (
                        <button
                          key={c.id}
                          onClick={() => onSelectCustomer(c)}
                          className="pos-dropdown-item flex items-center gap-2"
                        >
                          <div className="w-4 h-4 rounded-full bg-[#0001fb] flex items-center justify-center text-white">
                            <User size={10} />
                          </div>
                          <div className="flex flex-col">
                            <span className="text-[11px] text-pos-fg font-bold leading-none">{c.name}</span>
                            <span className="text-[9px] text-pos-muted">{c.phone}</span>
                          </div>
                        </button>
                      ))}

                    {!customers.some((c) => c.name.toLowerCase() === customerName.toLowerCase()) && (
                      <button
                        onClick={onCreateCustomerFromName}
                        className="pos-dropdown-item mt-0.5 flex items-center gap-2 text-[#a5b4fc] hover:!bg-[var(--pos-brand-hover-bg)]"
                      >
                        <Plus size={12} />
                        <span className="text-[10px] font-bold capitalize tracking-tight">Cadastrar &quot;{customerName}&quot;</span>
                      </button>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </div>

      </div>

      <div
        ref={listRef}
        className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain p-2 space-y-1 select-none scrollbar-hide [touch-action:none]"
        onPointerDown={onListPointerDown}
        onPointerMove={onListPointerMove}
        onPointerUp={onListPointerUp}
        onPointerCancel={onListPointerUp}
        onLostPointerCapture={() => {
          dragRef.current.active = false;
        }}
        onDragStart={(event) => event.preventDefault()}
        onClickCapture={onListClickCapture}
        onClick={onClearSelection}
      >
        {cart.length === 0 ? (
          <div className="h-full flex items-center justify-center text-pos-muted text-sm italic">Sem itens</div>
        ) : (
          <AnimatePresence initial={false}>
            {cart.map((item) => {
              const gross = lineGross(item);
              const itemDiscount = lineItemDiscount(item);
              const net = Math.max(0, gross - itemDiscount);
              const discountLabel = item.discount
                ? item.discount.type === 'percentage'
                  ? `-${item.discount.amount}%`
                  : `-${formatPrice(item.discount.amount)}`
                : null;

              return (
              <motion.div
                key={item.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, x: -20 }}
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleItemSelection(item.id);
                }}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  onEditItemQuantity(item);
                }}
                className={`flex flex-col gap-2 p-2.5 border rounded transition-colors cursor-pointer select-none ${
                  selectedCartItemId === item.id
                    ? 'bg-[var(--pos-brand-selected-bg)] border-[rgba(0, 1, 251,0.5)]'
                    : 'bg-pos-field border-pos-border hover:bg-pos-surface-2'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-pos-fg">{item.name}</span>
                  <div className="flex shrink-0 flex-col items-end leading-tight">
                    {itemDiscount > 0 ? (
                      <span className="text-[10px] text-pos-muted line-through">{formatPrice(gross)}</span>
                    ) : null}
                    <span className="text-sm font-bold text-pos-fg">{formatPrice(net)}</span>
                  </div>
                </div>

                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-pos-muted">{item.quantity} × {formatPrice(item.price)}</span>
                  {discountLabel ? (
                    <span className="rounded-md bg-[#0001fb]/20 px-1.5 py-0.5 text-[10px] font-bold text-[#a5b4fc]">
                      Desc. {discountLabel}
                      {itemDiscount > 0 ? ` · ${formatPrice(itemDiscount)}` : ''}
                    </span>
                  ) : (
                    <span className="text-[10px] font-medium text-pos-muted">Sem desconto</span>
                  )}
                </div>

                {item.notes ? (
                  <span className="truncate text-[11px] italic text-amber-300/90" title={item.notes}>
                    {item.notes}
                  </span>
                ) : null}

                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onChangeQuantity(item, item.quantity - 1);
                    }}
                    className="flex h-8 w-8 items-center justify-center rounded border border-pos-border bg-pos-action text-pos-fg transition-colors hover:border-[#0001fb]"
                    title="Diminuir quantidade"
                    aria-label={`Diminuir quantidade de ${item.name}`}
                  >
                    <Minus size={14} />
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onEditItemQuantity(item);
                    }}
                    className="min-w-[2.25rem] px-1 text-center text-xs font-bold tabular-nums text-pos-fg"
                    title="Editar quantidade"
                  >
                    {item.quantity}
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onChangeQuantity(item, item.quantity + 1);
                    }}
                    className="flex h-8 w-8 items-center justify-center rounded border border-pos-border bg-pos-action text-pos-fg transition-colors hover:border-[#0001fb]"
                    title="Aumentar quantidade"
                    aria-label={`Aumentar quantidade de ${item.name}`}
                  >
                    <Plus size={14} />
                  </button>

                  <div className="ml-auto flex items-center gap-1">
                    {onOpenLineDiscount ? (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onOpenLineDiscount(item);
                        }}
                        className={`flex h-8 w-8 items-center justify-center rounded border transition-colors ${
                          item.discount
                            ? 'border-[#0001fb]/50 bg-[#0001fb]/15 text-[#a5b4fc] hover:bg-[#0001fb]/25'
                            : 'border-pos-border bg-pos-action text-pos-muted hover:border-[#0001fb] hover:text-[#a5b4fc]'
                        }`}
                        title={item.discount ? 'Alterar desconto da linha' : 'Aplicar desconto na linha'}
                        aria-label={`Desconto em ${item.name}`}
                      >
                        <Percent size={14} />
                      </button>
                    ) : null}
                    {allowItemNotes && onEditItemNotes ? (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onEditItemNotes(item);
                        }}
                        className={`flex h-8 w-8 items-center justify-center rounded border border-pos-border transition-colors ${
                          item.notes
                            ? 'bg-amber-500/15 text-amber-400 hover:text-amber-300'
                            : 'bg-pos-action text-pos-muted hover:text-amber-600'
                        }`}
                        title="Nota para cozinha"
                      >
                        <MessageSquare size={14} />
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onRemoveItem(item.id);
                      }}
                      className="flex h-8 w-8 items-center justify-center rounded border border-pos-border bg-pos-action text-pos-muted transition-colors hover:border-red-500/60 hover:text-red-600"
                      title="Remover artigo"
                      aria-label={`Remover ${item.name}`}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              </motion.div>
              );
            })}
          </AnimatePresence>
        )}
      </div>

      <div className="shrink-0 p-3 bg-pos-surface border-t border-pos-border space-y-0.5">
        <div className="flex justify-between text-xs text-pos-muted">
          <span>Subtotal</span>
          <span>{formatPrice(originalSubtotal)}</span>
        </div>
        <div className={`flex justify-between text-xs ${totalDiscount > 0 ? 'text-[#0001fb]' : 'text-pos-muted'}`}>
          <span>{globalDiscount ? 'Desconto (pedido)' : 'Desconto'}</span>
          <span>{totalDiscount > 0 ? `-${formatPrice(totalDiscount)}` : formatPrice(0)}</span>
        </div>
        <div className="flex justify-between text-xs text-pos-muted">
          <span>Imposto</span>
          <span>{formatPrice(tax)}</span>
        </div>
        <div className="pt-1.5 mt-1.5 border-t border-dashed border-pos-border flex justify-between items-end">
          <span className="text-xs font-bold uppercase tracking-wider text-pos-fg">TOTAL</span>
          <span className="text-2xl font-bold text-pos-fg">{formatPrice(total)}</span>
        </div>
      </div>

      <div className="shrink-0 p-1 bg-pos-surface border-t border-pos-border">
        <button
          type="button"
          onClick={onOpenPayment}
          disabled={cart.length === 0}
          className={`flex w-full flex-col items-center justify-center py-3.5 rounded transition-colors ${
            cart.length > 0
              ? 'pos-on-accent bg-[#00993e] hover:bg-[#00ad46] text-white'
              : 'bg-pos-surface-3 text-pos-fg cursor-not-allowed opacity-70'
          }`}
        >
          <Banknote size={22} strokeWidth={2.25} />
          <span className="mt-1 text-sm font-bold tracking-wide">Pagamento</span>
        </button>
      </div>

      <div className="shrink-0 border-t border-pos-border bg-pos-surface px-1.5 py-1.5 space-y-1">
        <div className="grid grid-cols-3 gap-1">
          <CartActionButton
            icon={<User size={15} />}
            label="Cliente"
            title={selectedCustomer?.name ? `Cliente: ${selectedCustomer.name}` : 'Seleccionar cliente'}
            active={Boolean(selectedCustomer)}
            onClick={onOpenCustomer}
          />
          <CartActionButton
            icon={<Percent size={15} />}
            label="Desconto"
            onClick={onOpenDiscount}
          />
          <CartActionButton
            icon={<FileText size={15} />}
            label="Cotação"
            onClick={onOpenQuotation}
          />
        </div>
        <div className="grid grid-cols-2 gap-1">
          <CartActionButton
            icon={<Printer size={15} />}
            label="Conta"
            title="Pré-visualizar conta"
            disabled={cart.length === 0}
            onClick={onOpenBill}
          />
          <CartActionButton
            icon={<Archive size={15} />}
            label="Gaveta"
            title="Abrir gaveta de dinheiro"
            onClick={onOpenCashDrawer}
          />
        </div>
      </div>
    </div>
  );
}

function CartActionButton({
  icon,
  label,
  title,
  active,
  disabled,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  title?: string;
  active?: boolean;
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      title={title ?? label}
      aria-label={title ?? label}
      disabled={disabled || !onClick}
      onClick={onClick}
      className={`flex h-14 w-full min-w-0 flex-col items-center justify-center gap-0.5 rounded border px-1.5 transition-colors ${
        active
          ? 'border-[#0001fb] bg-[#0001fb]/10 text-[#0001fb]'
          : disabled
            ? 'border-pos-border bg-pos-surface-2 text-pos-muted opacity-50 cursor-not-allowed'
            : 'border-pos-border bg-pos-field text-pos-fg hover:border-[#0001fb] hover:text-[#0001fb]'
      }`}
    >
      {icon}
      <span className="text-[9px] font-bold leading-none tracking-wide">{label}</span>
    </button>
  );
}
