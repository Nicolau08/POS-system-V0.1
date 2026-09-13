'use client';

import React from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Plus, Pencil, Search, Trash2, User, X } from 'lucide-react';
import type { Customer } from '@/app/pos/types';
import { formatMoneyMt } from '@/lib/currency';

type NewCustomerState = { name: string; phone: string; email: string; address: string };

const fieldClass =
  'w-full h-12 bg-pos-field border border-pos-border rounded px-4 text-pos-fg outline-none focus:border-[#0001fb] transition-colors placeholder:text-pos-muted';

export function CustomerModal({
  isOpen,
  onClose,
  isAddingCustomer,
  setIsAddingCustomer,
  editingCustomer,
  newCustomer,
  setNewCustomer,
  customerSearch,
  setCustomerSearch,
  filteredCustomers,
  selectedCustomer,
  setSelectedCustomer,
  onStartAddNew,
  onSaveCustomer,
  onStartEditingCustomer,
  onRequestDeleteCustomer,
  customerToDelete,
  onCancelDelete,
  onConfirmDelete,
}: {
  isOpen: boolean;
  onClose: () => void;
  isAddingCustomer: boolean;
  setIsAddingCustomer: (v: boolean) => void;
  editingCustomer: Customer | null;
  newCustomer: NewCustomerState;
  setNewCustomer: React.Dispatch<React.SetStateAction<NewCustomerState>>;
  customerSearch: string;
  setCustomerSearch: (v: string) => void;
  filteredCustomers: Customer[];
  selectedCustomer: Customer | null;
  setSelectedCustomer: (c: Customer | null) => void;
  onStartAddNew: () => void;
  onSaveCustomer: () => void;
  onStartEditingCustomer: (customer: Customer, e: React.MouseEvent) => void;
  onRequestDeleteCustomer: (id: string, e: React.MouseEvent) => void;
  customerToDelete: string | null;
  onCancelDelete: () => void;
  onConfirmDelete: () => void;
}) {
  const canSave = Boolean(newCustomer.name && newCustomer.phone);

  return (
    <>
      <AnimatePresence>
        {isOpen && (
          <div className="fixed inset-0 z-[70] flex items-center justify-center p-4" onClick={onClose}>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 pos-modal-overlay" />
            <motion.div
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 20 }}
              className="relative w-full max-w-2xl bg-pos-surface border border-pos-border rounded overflow-hidden flex flex-col max-h-[90vh]"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="p-6 border-b border-pos-border flex justify-between items-center bg-pos-surface sticky top-0 z-10">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded bg-[#0001fb]/15 flex items-center justify-center text-[#0001fb]">
                    <User size={24} />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold text-pos-fg tracking-tight">
                      {isAddingCustomer ? (editingCustomer ? 'Editar cliente' : 'Novo cliente') : 'Gestão de clientes'}
                    </h2>
                    <p className="text-xs text-pos-muted font-medium">
                      {isAddingCustomer ? 'Preencha os dados abaixo' : 'Seleccionar ou cadastrar cliente'}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={onClose}
                  className="w-10 h-10 rounded border border-pos-border bg-pos-field flex items-center justify-center text-pos-muted hover:text-pos-fg hover:border-[#0001fb] transition-colors"
                >
                  <X size={20} />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-pos-bg">
                {isAddingCustomer ? (
                  <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-1.5">
                        <label className="text-xs font-medium text-pos-muted ml-1">Nome completo *</label>
                        <input
                          type="text"
                          value={newCustomer.name ?? ''}
                          onChange={(e) => setNewCustomer({ ...newCustomer, name: e.target.value })}
                          className={fieldClass}
                          placeholder="Ex: João Silva"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-xs font-medium text-pos-muted ml-1">Telefone *</label>
                        <input
                          type="text"
                          value={newCustomer.phone ?? ''}
                          onChange={(e) => setNewCustomer({ ...newCustomer, phone: e.target.value })}
                          className={fieldClass}
                          placeholder="Ex: 841234567"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-xs font-medium text-pos-muted ml-1">E-mail</label>
                        <input
                          type="email"
                          value={newCustomer.email ?? ''}
                          onChange={(e) => setNewCustomer({ ...newCustomer, email: e.target.value })}
                          className={fieldClass}
                          placeholder="joao@email.com"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-xs font-medium text-pos-muted ml-1">Endereço</label>
                        <input
                          type="text"
                          value={newCustomer.address ?? ''}
                          onChange={(e) => setNewCustomer({ ...newCustomer, address: e.target.value })}
                          className={fieldClass}
                          placeholder="Rua, Bairro, Cidade"
                        />
                      </div>
                    </div>
                    <div className="flex gap-3 pt-4">
                      <button
                        type="button"
                        onClick={() => setIsAddingCustomer(false)}
                        className="flex-1 h-12 rounded border border-pos-border bg-pos-field hover:bg-pos-surface-2 text-pos-fg font-bold transition-all"
                      >
                        Voltar para lista
                      </button>
                      <button
                        type="button"
                        onClick={onSaveCustomer}
                        disabled={!canSave}
                        className={`flex-1 h-12 rounded font-bold transition-all ${
                          canSave
                            ? 'pos-on-accent bg-[#0001fb] hover:bg-[#1a1bff] text-white'
                            : 'border border-pos-border bg-pos-surface-3 text-pos-muted cursor-not-allowed'
                        }`}
                      >
                        {editingCustomer ? 'Actualizar cliente' : 'Guardar cliente'}
                      </button>
                    </div>
                  </motion.div>
                ) : (
                  <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} className="space-y-4">
                    <div className="flex gap-3">
                      <div className="flex-1 relative">
                        <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-pos-muted" size={18} />
                        <input
                          type="text"
                          value={customerSearch ?? ''}
                          onChange={(e) => setCustomerSearch(e.target.value)}
                          className={`${fieldClass} pl-12 pr-4`}
                          placeholder="Pesquisar por nome ou telefone..."
                        />
                      </div>
                      <button
                        type="button"
                        onClick={onStartAddNew}
                        className="pos-on-accent h-12 px-6 bg-[#0001fb] hover:bg-[#1a1bff] text-white rounded font-bold transition-all flex items-center gap-2"
                      >
                        <Plus size={20} />
                        Novo
                      </button>
                    </div>

                    <div className="space-y-2">
                      {filteredCustomers.length > 0 ? (
                        filteredCustomers.map((customer) => (
                          <div
                            key={customer.id}
                            onClick={() => {
                              setSelectedCustomer(customer);
                              onClose();
                            }}
                            className={`w-full p-4 rounded border transition-all flex items-center justify-between group cursor-pointer ${
                              selectedCustomer?.id === customer.id
                                ? 'bg-[#0001fb]/10 border-[#0001fb] text-pos-fg'
                                : 'bg-pos-field border-pos-border hover:border-[#0001fb] text-pos-fg'
                            }`}
                          >
                            <div className="flex items-center gap-4">
                              <div
                                className={`w-12 h-12 rounded-full flex items-center justify-center ${
                                  selectedCustomer?.id === customer.id
                                    ? 'pos-on-accent bg-[#0001fb] text-white'
                                    : 'bg-pos-surface-2 text-pos-muted group-hover:text-[#0001fb]'
                                }`}
                              >
                                <User size={24} />
                              </div>
                              <div className="text-left">
                                <h3 className="font-bold text-pos-fg leading-tight">{customer.name}</h3>
                                <p className="text-xs text-pos-muted">{customer.phone}</p>
                              </div>
                            </div>
                            <div className="flex items-center gap-4">
                              <div className="text-right min-w-[96px]">
                                <div className="text-xs font-medium text-pos-muted">Dívida</div>
                                <div
                                  className={`text-sm font-mono font-bold ${
                                    Number(customer.debt_balance ?? 0) > 0 ? 'text-amber-600' : 'text-pos-muted'
                                  }`}
                                >
                                  {formatMoneyMt(Number(customer.debt_balance ?? 0))}
                                </div>
                              </div>
                              <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                <button
                                  type="button"
                                  onClick={(e) => onStartEditingCustomer(customer, e)}
                                  className="p-2 rounded border border-pos-border bg-pos-surface text-pos-muted hover:text-[#0001fb] hover:border-[#0001fb] transition-colors"
                                >
                                  <Pencil size={14} />
                                </button>
                                <button
                                  type="button"
                                  onClick={(e) => onRequestDeleteCustomer(customer.id, e)}
                                  className="p-2 bg-rose-500/10 hover:bg-rose-500/20 text-rose-600 rounded transition-colors"
                                >
                                  <Trash2 size={14} />
                                </button>
                              </div>
                            </div>
                          </div>
                        ))
                      ) : (
                        <div className="py-12 text-center">
                          <User className="mx-auto text-pos-muted/50 mb-3" size={48} />
                          <p className="text-pos-muted font-bold">Nenhum cliente encontrado</p>
                          <p className="text-xs text-pos-muted">Tente outro termo ou cadastre um novo cliente</p>
                        </div>
                      )}
                    </div>
                  </motion.div>
                )}
              </div>

              {selectedCustomer && !isAddingCustomer && (
                <div className="p-4 bg-pos-field border-t border-pos-border flex justify-between items-center">
                  <div className="flex items-center gap-3">
                    <div className="text-xs font-medium text-pos-muted">Seleccionado:</div>
                    <div className="text-sm font-bold text-pos-fg">{selectedCustomer.name}</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSelectedCustomer(null)}
                    className="text-xs font-bold text-rose-600 hover:text-rose-500 transition-colors"
                  >
                    Remover selecção
                  </button>
                </div>
              )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {customerToDelete && (
          <div className="fixed inset-0 z-[80] flex items-center justify-center p-4 pos-modal-overlay backdrop-blur-xl">
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-pos-surface border border-pos-border rounded p-8 w-full max-w-[400px] text-center space-y-6"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="w-20 h-20 bg-rose-500/10 rounded flex items-center justify-center mx-auto text-rose-600">
                <Trash2 size={40} />
              </div>

              <div className="space-y-2">
                <h3 className="text-xl font-bold text-pos-fg tracking-tight">Eliminar cliente?</h3>
                <p className="text-sm text-pos-muted">
                  Esta acção não pode ser desfeita. Clientes com documentos ou dívida associados não podem ser
                  apagados.
                </p>
              </div>

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={onCancelDelete}
                  className="flex-1 h-14 rounded border border-pos-border bg-pos-field hover:bg-pos-surface-2 text-pos-fg font-bold transition-all"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={onConfirmDelete}
                  className="pos-on-accent flex-1 h-14 bg-rose-600 hover:bg-rose-500 text-white rounded font-bold transition-all"
                >
                  Eliminar
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </>
  );
}
