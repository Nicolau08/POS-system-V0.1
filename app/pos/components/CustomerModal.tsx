'use client';

import React from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Plus, Pencil, RotateCcw, Search, Trash2, User } from 'lucide-react';
import type { Customer } from '@/app/pos/types';

type NewCustomerState = { name: string; phone: string; email: string; address: string };

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
  return (
    <>
      <AnimatePresence>
        {isOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 bg-black/80 backdrop-blur-sm" />
            <motion.div
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 20 }}
              className="relative w-full max-w-2xl bg-zinc-900 border border-zinc-800 rounded overflow-hidden flex flex-col max-h-[90vh]"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="p-6 border-b border-zinc-800 flex justify-between items-center bg-zinc-900/50 backdrop-blur-md sticky top-0 z-10">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded bg-emerald-500/20 flex items-center justify-center text-emerald-500">
                    <User size={24} />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold text-white tracking-tight">
                      {isAddingCustomer ? (editingCustomer ? 'Editar Cliente' : 'Novo Cliente') : 'GestÃ£o de Clientes'}
                    </h2>
                    <p className="text-xs text-zinc-500 font-medium capitalize">
                      {isAddingCustomer ? 'Preencha os dados abaixo' : 'Selecionar ou cadastrar cliente'}
                    </p>
                  </div>
                </div>
                <button onClick={onClose} className="w-10 h-10 rounded bg-zinc-800 flex items-center justify-center text-zinc-400 hover:text-white transition-colors">
                  <RotateCcw size={20} />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-6 space-y-6">
                {isAddingCustomer ? (
                  <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-1.5">
                        <label className="text-xs font-medium text-zinc-500 capitalize ml-1">Nome Completo *</label>
                        <input
                          type="text"
                          value={newCustomer.name ?? ''}
                          onChange={(e) => setNewCustomer({ ...newCustomer, name: e.target.value })}
                          className="w-full h-12 bg-zinc-800 border border-zinc-700 rounded px-4 text-white focus:outline-none focus:border-emerald-500 transition-colors"
                          placeholder="Ex: JoÃ£o Silva"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-xs font-medium text-zinc-500 capitalize ml-1">Telefone *</label>
                        <input
                          type="text"
                          value={newCustomer.phone ?? ''}
                          onChange={(e) => setNewCustomer({ ...newCustomer, phone: e.target.value })}
                          className="w-full h-12 bg-zinc-800 border border-zinc-700 rounded px-4 text-white focus:outline-none focus:border-emerald-500 transition-colors"
                          placeholder="Ex: 841234567"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-xs font-medium text-zinc-500 capitalize ml-1">E-mail</label>
                        <input
                          type="email"
                          value={newCustomer.email ?? ''}
                          onChange={(e) => setNewCustomer({ ...newCustomer, email: e.target.value })}
                          className="w-full h-12 bg-zinc-800 border border-zinc-700 rounded px-4 text-white focus:outline-none focus:border-emerald-500 transition-colors"
                          placeholder="joao@email.com"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-xs font-medium text-zinc-500 capitalize ml-1">Endereço</label>
                        <input
                          type="text"
                          value={newCustomer.address ?? ''}
                          onChange={(e) => setNewCustomer({ ...newCustomer, address: e.target.value })}
                          className="w-full h-12 bg-zinc-800 border border-zinc-700 rounded px-4 text-white focus:outline-none focus:border-emerald-500 transition-colors"
                          placeholder="Rua, Bairro, Cidade"
                        />
                      </div>
                    </div>
                    <div className="flex gap-3 pt-4">
                      <button onClick={() => setIsAddingCustomer(false)} className="flex-1 h-12 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded font-bold transition-all">
                        Voltar para Lista
                      </button>
                      <button
                        onClick={onSaveCustomer}
                        disabled={!newCustomer.name || !newCustomer.phone}
                        className={`flex-1 h-12 rounded font-bold transition-all ${
                          newCustomer.name && newCustomer.phone ? 'bg-emerald-600 hover:bg-emerald-500 text-white' : 'bg-zinc-800 text-zinc-600 cursor-not-allowed'
                        }`}
                      >
                        {editingCustomer ? 'Atualizar Cliente' : 'Salvar Cliente'}
                      </button>
                    </div>
                  </motion.div>
                ) : (
                  <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} className="space-y-4">
                    <div className="flex gap-3">
                      <div className="flex-1 relative">
                        <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500" size={18} />
                        <input
                          type="text"
                          value={customerSearch ?? ''}
                          onChange={(e) => setCustomerSearch(e.target.value)}
                          className="w-full h-12 bg-zinc-800 border border-zinc-700 rounded pl-12 pr-4 text-white focus:outline-none focus:border-emerald-500 transition-colors"
                          placeholder="Pesquisar por nome ou telefone..."
                        />
                      </div>
                      <button
                        onClick={onStartAddNew}
                        className="h-12 px-6 bg-emerald-600 hover:bg-emerald-500 text-white rounded font-bold transition-all flex items-center gap-2"
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
                                ? 'bg-emerald-500/10 border-emerald-500/50 text-white'
                                : 'bg-zinc-800/50 border-zinc-800 hover:border-zinc-700 text-zinc-400'
                            }`}
                          >
                            <div className="flex items-center gap-4">
                              <div
                                className={`w-12 h-12 rounded-full flex items-center justify-center ${
                                  selectedCustomer?.id === customer.id ? 'bg-emerald-500 text-white' : 'bg-zinc-800 text-zinc-500 group-hover:bg-zinc-700'
                                }`}
                              >
                                <User size={24} />
                              </div>
                              <div className="text-left">
                                <h3 className="font-bold text-white leading-tight">{customer.name}</h3>
                                <p className="text-xs text-zinc-500">{customer.phone}</p>
                              </div>
                            </div>
                            <div className="flex items-center gap-4">
                              <div className="text-right">
                                <div className="text-xs font-medium text-zinc-500 capitalize">Pontos</div>
                                <div className="text-sm font-mono font-bold text-emerald-500">{customer.points} pts</div>
                              </div>
                              <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                <button
                                  onClick={(e) => onStartEditingCustomer(customer, e)}
                                  className="p-2 bg-zinc-700 hover:bg-zinc-600 text-zinc-300 rounded transition-colors"
                                >
                                  <Pencil size={14} />
                                </button>
                                <button
                                  onClick={(e) => onRequestDeleteCustomer(customer.id, e)}
                                  className="p-2 bg-rose-500/10 hover:bg-rose-500/20 text-rose-500 rounded transition-colors"
                                >
                                  <Trash2 size={14} />
                                </button>
                              </div>
                            </div>
                          </div>
                        ))
                      ) : (
                        <div className="py-12 text-center">
                          <User className="mx-auto text-zinc-700 mb-3" size={48} />
                          <p className="text-zinc-500 font-bold">Nenhum cliente encontrado</p>
                          <p className="text-xs text-zinc-600">Tente outro termo ou cadastre um novo cliente</p>
                        </div>
                      )}
                    </div>
                  </motion.div>
                )}
              </div>

              {selectedCustomer && !isAddingCustomer && (
                <div className="p-4 bg-zinc-800/30 border-t border-zinc-800 flex justify-between items-center">
                  <div className="flex items-center gap-3">
                    <div className="text-xs font-medium text-zinc-500 capitalize">Selecionado:</div>
                    <div className="text-sm font-bold text-white">{selectedCustomer.name}</div>
                  </div>
                  <button onClick={() => setSelectedCustomer(null)} className="text-xs font-bold text-rose-500 hover:text-rose-400 transition-colors">
                    Remover SeleÃ§Ã£o
                  </button>
                </div>
              )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* --- Delete confirmation modal --- */}
      <AnimatePresence>
        {customerToDelete && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/90 backdrop-blur-xl">
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-zinc-900 border border-zinc-800 rounded p-8 w-full max-w-[400px] text-center space-y-6"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="w-20 h-20 bg-rose-500/10 rounded flex items-center justify-center mx-auto text-rose-500">
                <Trash2 size={40} />
              </div>

              <div className="space-y-2">
                <h3 className="text-xl font-bold text-white capitalize tracking-tight">Excluir Cliente?</h3>
                <p className="text-sm text-zinc-500">Esta ação não pode ser desfeita. Todos os dados e pontos deste cliente serão removidos permanentemente.</p>
              </div>

              <div className="flex gap-3">
                <button onClick={onCancelDelete} className="flex-1 h-14 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded font-bold transition-all">
                  Cancelar
                </button>
                <button onClick={onConfirmDelete} className="flex-1 h-14 bg-rose-600 hover:bg-rose-500 text-white rounded font-bold transition-all">
                  Excluir
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </>
  );
}

