'use client';

import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  Check,
  Edit3,
  HelpCircle,
  KeyRound,
  Plus,
  RotateCcw,
  Trash2,
  UserCircle2,
  X,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';

import { getPosApiBase, getPosUserAuthHeaders } from '@/lib/apiBase';
import { unwrapApiSuccessPayload } from '@/lib/apiResponse';
import { useIsPackagedDesktop } from '@/hooks/useIsPackagedDesktop';

type ManagedUser = {
  id: string;
  name: string;
  surname: string | null;
  email: string | null;
  role: string;
  accessLevel: number;
  active: boolean;
};

type PermissionRule = {
  key: string;
  requiredLevel: number;
};

type UserPanelMode = 'add' | 'edit' | 'resetPin';

function clampLevel(value: number) {
  const n = Number.isFinite(Number(value)) ? Number(value) : 0;
  return Math.max(0, Math.min(9, Math.trunc(n)));
}

const PERMISSION_RULES_KEYS = [
  'gerenciamento.acesso',
  'gerenciamento.configuracoes',
  'gerenciamento.fechamento_diario',
  'gerenciamento.perfil_usuario',
  'gerenciamento.design_floor_plans',

  'painel.painel_controle',
  'painel.documentos',
  'painel.produtos',
  'painel.estoque',
  'painel.relatorios',
  'painel.clientes_fornecedores',
  'painel.promocoes_acoes',
  'painel.usuarios_seguranca',
  'painel.meios_pagamento',
  'painel.paises',
  'painel.taxas_impostos',
  'painel.minha_empresa',
  'painel.emitir_serie',
  'painel.logs_sistema',

  'estoque.inventario_rapido',
  'estoque.ver_preco_custo',

  'vendas.ver_pedidos_em_aberto',
  'vendas.cancelar_pedido',
  'vendas.cancelar_item',
  'vendas.bloquear_venda',
  'vendas.desbloquear_venda',
  'vendas.dividir_pedido',
  'vendas.aplicar_desconto',
  'vendas.apagar_documento',
  'vendas.devolucao',
  'vendas.override_taxes',

  'vendas.ver_historico_vendas',
  'vendas.reimprimir_recibo',
  'vendas.credit_payments',
  'vendas.abrir_caixa',
  'vendas.abrir_gaveta_dinheiro',
  'vendas.venda_estoque_zero',
] as const;

const OP_LABELS: Record<string, string> = {
  'gerenciamento.acesso': 'Gerenciamento',
  'gerenciamento.configuracoes': 'Configurações',
  'gerenciamento.fechamento_diario': 'Fechamento diário',
  'gerenciamento.perfil_usuario': 'Perfil de usuário',
  'gerenciamento.design_floor_plans': 'Design floor plans',

  'painel.painel_controle': 'Painel de Controle',
  'painel.documentos': 'Documentos',
  'painel.produtos': 'Produtos',
  'painel.estoque': 'Estoque',
  'painel.relatorios': 'Relatórios',
  'painel.clientes_fornecedores': 'Clientes & Fornecedores',
  'painel.promocoes_acoes': 'Promoções & Ações',
  'painel.usuarios_seguranca': 'Usuários & Acesso',
  'painel.meios_pagamento': 'Meios de pagamento',
  'painel.paises': 'Países',
  'painel.taxas_impostos': 'Taxas de impostos',
  'painel.minha_empresa': 'Minha Empresa',
  'painel.emitir_serie': 'Emitir série',
  'painel.logs_sistema': 'Logs do sistema',

  'estoque.inventario_rapido': 'Inventário rápido',
  'estoque.ver_preco_custo': 'Ver preços de custo',

  'vendas.ver_pedidos_em_aberto': 'Ver todos os pedidos em aberto',
  'vendas.cancelar_pedido': 'Cancelar pedido',
  'vendas.cancelar_item': 'Cancelar item',
  'vendas.bloquear_venda': 'Bloquear venda',
  'vendas.desbloquear_venda': 'Desbloquear venda',
  'vendas.dividir_pedido': 'Dividir pedido',
  'vendas.aplicar_desconto': 'Aplicar desconto',
  'vendas.apagar_documento': 'Apagar documento',
  'vendas.devolucao': 'Devolução',
  'vendas.override_taxes': 'Override taxes',

  'vendas.ver_historico_vendas': 'Ver histórico de vendas',
  'vendas.reimprimir_recibo': 'Reimprimir recibo',
  'vendas.credit_payments': 'Credit payments',
  'vendas.abrir_caixa': 'Abertura de caixa',
  'vendas.abrir_gaveta_dinheiro': 'Abrir a gaveta do dinheiro',
  'vendas.venda_estoque_zero': 'Venda de quantidade de estoque zero',
};

type SecurityGroup =
  | { title: string; layout: 'single'; keys: readonly string[] }
  | { title: string; layout: 'twoCol'; leftKeys: readonly string[]; rightKeys: readonly string[] };

const SECURITY_GROUPS: SecurityGroup[] = [
  {
    title: 'Geral',
    layout: 'single',
    keys: [
      'gerenciamento.acesso',
      'gerenciamento.configuracoes',
      'gerenciamento.fechamento_diario',
      'gerenciamento.perfil_usuario',
      'gerenciamento.design_floor_plans',
    ],
  },
  {
    title: 'Vendas',
    layout: 'twoCol',
    leftKeys: [
      'vendas.ver_pedidos_em_aberto',
      'vendas.cancelar_pedido',
      'vendas.cancelar_item',
      'vendas.bloquear_venda',
      'vendas.desbloquear_venda',
      'vendas.dividir_pedido',
      'vendas.aplicar_desconto',
      'vendas.apagar_documento',
      'vendas.devolucao',
      'vendas.override_taxes',
    ],
    rightKeys: [
      'vendas.ver_historico_vendas',
      'vendas.reimprimir_recibo',
      'vendas.credit_payments',
      'vendas.abrir_caixa',
      'vendas.abrir_gaveta_dinheiro',
      'vendas.venda_estoque_zero',
    ],
  },
  {
    title: 'Gerenciamento',
    layout: 'twoCol',
    leftKeys: [
      'painel.painel_controle',
      'painel.documentos',
      'painel.produtos',
      'painel.estoque',
      'painel.relatorios',
      'painel.clientes_fornecedores',
      'painel.promocoes_acoes',
      'painel.usuarios_seguranca',
    ],
    rightKeys: [
      'painel.meios_pagamento',
      'painel.paises',
      'painel.taxas_impostos',
      'painel.minha_empresa',
      'painel.logs_sistema',
      'painel.emitir_serie',
    ],
  },
  {
    title: 'Estoque',
    layout: 'single',
    keys: ['estoque.inventario_rapido', 'estoque.ver_preco_custo'],
  },
];

const RULE_HELP_KEYS = new Set(['vendas.devolucao', 'estoque.ver_preco_custo']);

export default function UsersSecurityManager() {
  const isPackagedDesktop = useIsPackagedDesktop();
  const [subTab, setSubTab] = useState<'users' | 'security'>('users');

  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [usersLoading, setUsersLoading] = useState(true);
  const [showInactive, setShowInactive] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);

  const [userPanelOpen, setUserPanelOpen] = useState(false);
  const [userPanelMode, setUserPanelMode] = useState<UserPanelMode>('add');
  const [draftUser, setDraftUser] = useState({
    id: '',
    name: '',
    surname: '',
    email: '',
    pin: '',
    accessLevel: 0,
    active: true,
  });

  const [permissionRules, setPermissionRules] = useState<Record<string, PermissionRule>>({});
  const [rulesLoading, setRulesLoading] = useState(true);
  const [rulesSaving, setRulesSaving] = useState(false);

  const selectedUser = useMemo(
    () => users.find((u) => u.id === selectedUserId) ?? null,
    [selectedUserId, users]
  );

  const usersFiltered = useMemo(() => {
    if (showInactive) return users;
    return users.filter((u) => u.active);
  }, [showInactive, users]);

  useEffect(() => {
    if (!selectedUserId) return;
    const visible = usersFiltered.some((u) => u.id === selectedUserId);
    if (!visible) setSelectedUserId(usersFiltered[0]?.id ?? null);
  }, [usersFiltered, selectedUserId]);

  const fetchUsers = async () => {
    setUsersLoading(true);
    try {
      const res = await fetch(`${getPosApiBase()}/users`);
      if (!res.ok) throw new Error('Falha ao carregar usuários');
      const data = (unwrapApiSuccessPayload<unknown[]>(await res.json()) ?? []);
      const normalized: ManagedUser[] = data.map((u: any) => ({
        id: String(u.id),
        name: String(u.name ?? ''),
        surname: u.surname == null ? null : String(u.surname),
        email: u.email == null ? null : String(u.email),
        role: String(u.role ?? 'cashier'),
        accessLevel: clampLevel(Number(u.access_level ?? u.accessLevel ?? 0)),
        active: u.active === false ? false : Boolean(u.active ?? true),
      }));
      setUsers(normalized);

      setSelectedUserId((prev) => {
        if (prev && normalized.some((u) => u.id === prev)) return prev;
        return normalized[0]?.id ?? null;
      });
    } finally {
      setUsersLoading(false);
    }
  };

  const fetchRules = async () => {
    setRulesLoading(true);
    try {
      const res = await fetch(`${getPosApiBase()}/permission-rules`, {
        headers: { ...getPosUserAuthHeaders() },
      });
      if (!res.ok) throw new Error('Falha ao carregar regras de permissão');
      const data = (unwrapApiSuccessPayload<unknown[]>(await res.json()) ?? []);
      const normalized: Record<string, PermissionRule> = {};
      for (const row of data as any[]) {
        const key = String(row.key);
        normalized[key] = {
          key,
          requiredLevel: clampLevel(Number(row.required_level ?? row.requiredLevel ?? 0)),
        };
      }

      for (const k of PERMISSION_RULES_KEYS) {
        if (!normalized[k]) {
          normalized[k] = { key: k, requiredLevel: 0 };
        }
      }

      setPermissionRules(normalized);
    } finally {
      setRulesLoading(false);
    }
  };

  useEffect(() => {
    void fetchUsers();
    void fetchRules();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const closeUserPanel = () => {
    setUserPanelOpen(false);
  };

  const openAddUser = () => {
    setUserPanelMode('add');
    setDraftUser({
      id: '',
      name: '',
      surname: '',
      email: '',
      pin: '',
      accessLevel: 0,
      active: true,
    });
    setUserPanelOpen(true);
  };

  const openEditUser = (user?: ManagedUser | null) => {
    const u = user ?? selectedUser;
    if (!u) return;
    setUserPanelMode('edit');
    setDraftUser({
      id: u.id,
      name: u.name ?? '',
      surname: u.surname ?? '',
      email: u.email ?? '',
      pin: '',
      accessLevel: clampLevel(u.accessLevel ?? 0),
      active: u.active,
    });
    setUserPanelOpen(true);
  };

  const openResetPin = () => {
    if (!selectedUser) return;
    setUserPanelMode('resetPin');
    setDraftUser({
      id: selectedUser.id,
      name: selectedUser.name ?? '',
      surname: selectedUser.surname ?? '',
      email: selectedUser.email ?? '',
      pin: '',
      accessLevel: clampLevel(selectedUser.accessLevel ?? 0),
      active: selectedUser.active,
    });
    setUserPanelOpen(true);
  };

  const saveUser = async () => {
    if (userPanelMode === 'resetPin') {
      if (!draftUser.pin.trim()) throw new Error('Informe o novo PIN');
      const res = await fetch(`${getPosApiBase()}/users/${draftUser.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: draftUser.pin.trim() }),
      });
      if (!res.ok) throw new Error('Falha ao redefinir PIN');
      setUserPanelOpen(false);
      await fetchUsers();
      return;
    }

    if (!draftUser.name.trim()) return;
    if (userPanelMode === 'add' && !draftUser.pin.trim()) return;

    if (userPanelMode === 'add') {
      const role = draftUser.accessLevel >= 9 ? 'admin' : 'user';
      const body = {
        name: draftUser.name.trim(),
        surname: draftUser.surname.trim() || null,
        email: draftUser.email.trim() || null,
        role,
        pin: draftUser.pin.trim(),
        access_level: clampLevel(draftUser.accessLevel),
        active: draftUser.active,
      };

      const res = await fetch(`${getPosApiBase()}/users`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error('Falha ao adicionar usuário');
    } else {
      const body: Record<string, unknown> = {
        name: draftUser.name.trim(),
        surname: draftUser.surname.trim() || null,
        email: draftUser.email.trim() || null,
        access_level: clampLevel(draftUser.accessLevel),
        active: draftUser.active,
      };
      if (draftUser.pin.trim()) body.pin = draftUser.pin.trim();

      const res = await fetch(`${getPosApiBase()}/users/${draftUser.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error('Falha ao atualizar usuário');
    }

    setUserPanelOpen(false);
    await fetchUsers();
  };

  const deactivateSelectedUser = async () => {
    if (!selectedUser) return;
    const res = await fetch(`${getPosApiBase()}/users/${selectedUser.id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Falha ao desativar usuário');
    await fetchUsers();
  };

  const changeRuleLevel = (key: string, delta: number) => {
    setPermissionRules((prev) => {
      const current = prev[key]?.requiredLevel ?? 0;
      const next = clampLevel(current + delta);
      return {
        ...prev,
        [key]: { key, requiredLevel: next },
      };
    });
  };

  const savePermissionRules = async () => {
    if (rulesSaving) return;
    setRulesSaving(true);
    try {
      const rulesArray = PERMISSION_RULES_KEYS.map((k) => ({
        key: k,
        required_level: permissionRules[k]?.requiredLevel ?? 0,
      }));
      const res = await fetch(`${getPosApiBase()}/permission-rules`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...getPosUserAuthHeaders() },
        body: JSON.stringify({ rules: rulesArray }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => null);
        throw new Error(String(payload?.error ?? 'Falha ao salvar permissão'));
      }
      await fetchRules();
      pushToast('Níveis de acesso guardados.', 'success');
    } catch (error) {
      pushToast(error instanceof Error ? error.message : 'Falha ao salvar permissão', 'error');
    } finally {
      setRulesSaving(false);
    }
  };

  const [toast, setToast] = useState<{ type: 'success' | 'error' | 'info'; message: string } | null>(null);
  const pushToast = (message: string, type: 'success' | 'error' | 'info' = 'info') => {
    setToast({ type, message });
    window.setTimeout(() => setToast(null), 4000);
  };

  const onSaveUserClick = async () => {
    try {
      await saveUser();
      pushToast(
        userPanelMode === 'resetPin' ? 'PIN atualizado com sucesso' : 'Usuário salvo com sucesso',
        'success'
      );
    } catch (e: unknown) {
      pushToast(e instanceof Error ? e.message : 'Erro ao salvar usuário', 'error');
    }
  };

  const onDeactivateUserClick = async () => {
    try {
      await deactivateSelectedUser();
      pushToast('Usuário desativado', 'success');
    } catch (e: unknown) {
      pushToast(e instanceof Error ? e.message : 'Erro ao desativar usuário', 'error');
    }
  };

  const onSaveRulesClick = async () => {
    try {
      await savePermissionRules();
      pushToast('Permissões salvas com sucesso', 'success');
    } catch (e: unknown) {
      pushToast(e instanceof Error ? e.message : 'Erro ao salvar permissões', 'error');
    }
  };

  const tabBtn = (active: boolean) =>
    `px-5 py-2.5 text-[11px] font-bold border-b-2 transition-colors ${
      active
        ? 'border-[#00a3e0] text-white'
        : 'border-transparent text-zinc-500 hover:text-zinc-300'
    }`;

  return (
    <div className="flex flex-col h-full bg-[#1a1a1a] text-zinc-300 overflow-hidden">
      {/* Sub-tabs (referência: por baixo do cabeçalho do módulo) */}
      <div className="flex shrink-0 border-b border-zinc-800 bg-[#1a1a1a] px-1">
        <button type="button" className={tabBtn(subTab === 'users')} onClick={() => setSubTab('users')}>
          Usuários
        </button>
        <button
          type="button"
          className={tabBtn(subTab === 'security')}
          onClick={() => setSubTab('security')}
        >
          Acesso
        </button>
      </div>

      {/* Toolbar — mesmo padrão que ProductsManager */}
      <div className="h-16 bg-[#1a1a1a] border-b border-zinc-800 flex items-center px-2 gap-1 overflow-x-auto no-scrollbar shrink-0">
        {subTab === 'users' ? (
          <>
            <ToolbarButton icon={<RotateCcw size={20} />} label="Atualizar" onClick={() => void fetchUsers()} />
            <ToolbarButton icon={<Plus size={20} />} label="Adicionar usuário" onClick={openAddUser} />
            <ToolbarButton
              icon={<Edit3 size={20} />}
              label="Editar"
              disabled={!selectedUser}
              onClick={() => openEditUser()}
            />
            <ToolbarButton
              icon={<Trash2 size={20} />}
              label="Deletar"
              disabled={!selectedUser}
              onClick={() => void onDeactivateUserClick()}
            />
            <ToolbarButton
              icon={<KeyRound size={20} />}
              label="Redefinir senha"
              disabled={!selectedUser}
              onClick={openResetPin}
            />
            <div className="flex items-center gap-2 px-3 ml-1 border-l border-zinc-800">
              <button
                type="button"
                role="switch"
                aria-checked={showInactive}
                onClick={() => setShowInactive((v) => !v)}
                className={`relative w-11 h-6 rounded-full transition-colors shrink-0 ${
                  showInactive ? 'bg-emerald-600' : 'bg-zinc-700'
                }`}
                title="Mostrar usuários inativos"
              >
                <span
                  className={`absolute top-1 w-4 h-4 bg-white rounded-sm shadow transition-all ${
                    showInactive ? 'left-6' : 'left-1'
                  }`}
                />
              </button>
              <span className="text-[11px] font-bold text-zinc-500 whitespace-nowrap">
                Mostrar inativos
              </span>
            </div>
            <ToolbarButton
              icon={<HelpCircle size={20} />}
              label="Ajuda"
              onClick={() => pushToast('Selecione uma linha para editar, apagar ou redefinir PIN.', 'info')}
            />
          </>
        ) : (
          <>
            <ToolbarButton icon={<RotateCcw size={20} />} label="Atualizar" onClick={() => void fetchRules()} />
            <ToolbarButton
              icon={<Check size={20} />}
              label="Salvar"
              disabled={rulesLoading || rulesSaving}
              onClick={() => void onSaveRulesClick()}
            />
            <ToolbarButton
              icon={<HelpCircle size={20} />}
              label="Ajuda"
              onClick={() =>
                pushToast(
                  'Cada operação tem um nível exigido (0–9). Quem tem nível maior ou igual pode executá-la.',
                  'info'
                )
              }
            />
          </>
        )}
      </div>

      {/* Conteúdo */}
      {subTab === 'users' && (
        <div className="flex-1 min-h-0 overflow-auto custom-scrollbar">
          <table className="w-full text-left border-collapse text-[11px]">
            <thead className="sticky top-0 z-10 bg-[#141414] border-b border-zinc-800">
              <tr>
                <th className="px-4 py-2.5 font-bold text-zinc-500">Nome</th>
                <th className="px-4 py-2.5 font-bold text-zinc-500">Sobrenome</th>
                <th className="px-4 py-2.5 font-bold text-zinc-500">Email</th>
                <th className="px-4 py-2.5 font-bold text-zinc-500 text-center w-24">Nível de acesso</th>
                <th className="px-4 py-2.5 font-bold text-zinc-500 text-center w-20">Ativo</th>
              </tr>
            </thead>
            <tbody>
              {usersLoading ? (
                <tr>
                  <td colSpan={5} className="p-10 text-center text-zinc-500">
                    Carregando...
                  </td>
                </tr>
              ) : usersFiltered.length === 0 ? (
                <tr>
                  <td colSpan={5} className="p-10 text-center text-zinc-500">
                    Nenhum usuário encontrado
                  </td>
                </tr>
              ) : (
                usersFiltered.map((u, i) => {
                  const isSelected = u.id === selectedUserId;
                  return (
                    <tr
                      key={u.id}
                      onClick={() => setSelectedUserId(u.id)}
                      onDoubleClick={() => openEditUser(u)}
                      className={`cursor-pointer border-b border-zinc-800/40 ${
                        i % 2 === 1 ? 'bg-zinc-900/20' : ''
                      } ${isSelected ? 'bg-[#00a3e0]/15 ring-1 ring-inset ring-[#00a3e0]/40' : 'hover:bg-zinc-800/25'}`}
                    >
                      <td className="px-4 py-2.5 text-zinc-100 font-semibold">{u.name}</td>
                      <td className="px-4 py-2.5 text-zinc-300">{u.surname ?? '—'}</td>
                      <td className="px-4 py-2.5 text-zinc-400 truncate max-w-[220px]">{u.email ?? '—'}</td>
                      <td className="px-4 py-2.5 text-center text-zinc-100 font-bold">{u.accessLevel}</td>
                      <td className="px-4 py-2.5 text-center">
                        {u.active ? (
                          <span className="inline-flex items-center justify-center w-6 h-6 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                            <Check size={14} />
                          </span>
                        ) : (
                          <span className="inline-flex items-center justify-center w-6 h-6 rounded bg-rose-500/10 text-rose-400 border border-rose-500/30">
                            <X size={14} />
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      )}

      {subTab === 'security' && (
        <div className="flex-1 min-h-0 overflow-auto custom-scrollbar p-4">
          <p className="text-[12px] text-zinc-400 mb-4 max-w-4xl leading-relaxed">
            Defina o nível de acesso para operações predefinidas. O nível de um usuário determina se ele pode
            executar cada operação. Se o nível do usuário for igual ou superior ao nível configurado para a
            operação, pode executá-la.
          </p>

          <div className="space-y-4 pb-6">
            {SECURITY_GROUPS.map((group) => {
              const filterKey = (k: string) =>
                !(isPackagedDesktop && k === 'painel.emitir_serie');
              if (group.layout === 'twoCol') {
                const leftKeys = group.leftKeys.filter(filterKey);
                const rightKeys = group.rightKeys.filter(filterKey);
                return (
                  <div key={group.title} className="border border-zinc-800 rounded overflow-hidden bg-[#141414]">
                    <div className="bg-[#00a3e0] text-white text-[11px] font-bold px-4 py-2">{group.title}</div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-0">
                      <div className="md:border-r border-zinc-800">
                        {leftKeys.map((k) => (
                          <RuleRow
                            key={k}
                            label={OP_LABELS[k] ?? k}
                            value={permissionRules[k]?.requiredLevel ?? 0}
                            showHelp={RULE_HELP_KEYS.has(k)}
                            onDec={() => changeRuleLevel(k, -1)}
                            onInc={() => changeRuleLevel(k, 1)}
                          />
                        ))}
                      </div>
                      <div>
                        {rightKeys.map((k) => (
                          <RuleRow
                            key={k}
                            label={OP_LABELS[k] ?? k}
                            value={permissionRules[k]?.requiredLevel ?? 0}
                            showHelp={RULE_HELP_KEYS.has(k)}
                            onDec={() => changeRuleLevel(k, -1)}
                            onInc={() => changeRuleLevel(k, 1)}
                          />
                        ))}
                      </div>
                    </div>
                  </div>
                );
              }

              const keys = group.keys.filter(filterKey);
              return (
                <div key={group.title} className="border border-zinc-800 rounded overflow-hidden bg-[#141414]">
                  <div className="bg-[#00a3e0] text-white text-[11px] font-bold px-4 py-2">{group.title}</div>
                  <div>
                    {keys.map((k) => (
                      <RuleRow
                        key={k}
                        label={OP_LABELS[k] ?? k}
                        value={permissionRules[k]?.requiredLevel ?? 0}
                        showHelp={RULE_HELP_KEYS.has(k)}
                        onDec={() => changeRuleLevel(k, -1)}
                        onInc={() => changeRuleLevel(k, 1)}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <UserSlidePanel
        isOpen={userPanelOpen}
        mode={userPanelMode}
        draftUser={draftUser}
        setDraftUser={setDraftUser}
        onClose={closeUserPanel}
        onSaveClick={() => void onSaveUserClick()}
      />

      {toast && (
        <div
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[200] px-6 py-3 rounded-lg border bg-[#141414] border-zinc-800 flex items-center gap-3"
          role="status"
        >
          <div
            className={`w-3.5 h-3.5 rounded-full ${
              toast.type === 'success'
                ? 'bg-emerald-400'
                : toast.type === 'error'
                  ? 'bg-rose-400'
                  : 'bg-blue-400'
            }`}
          />
          <span className="text-sm font-medium text-zinc-100">{toast.message}</span>
        </div>
      )}
    </div>
  );
}

function ToolbarButton({
  icon,
  label,
  onClick,
  active,
  disabled,
}: {
  icon: React.ReactNode;
  label: string;
  onClick?: () => void;
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`flex flex-col items-center justify-center min-w-[76px] py-2 px-1.5 rounded transition-all hover:bg-zinc-800 group disabled:opacity-40 disabled:pointer-events-none ${
        active ? 'bg-zinc-800 text-white' : 'text-zinc-400'
      }`}
    >
      <div className="mb-1 group-hover:scale-110 transition-transform">{icon}</div>
      <span className="text-[10px] font-bold text-center leading-tight tracking-tighter">{label}</span>
    </button>
  );
}

function RuleRow({
  label,
  value,
  onDec,
  onInc,
  showHelp,
}: {
  label: string;
  value: number;
  onDec: () => void;
  onInc: () => void;
  showHelp?: boolean;
}) {
  return (
    <div className="flex items-center justify-between px-4 py-2 border-b border-zinc-800/40 gap-2">
      <div className="flex items-center gap-2 min-w-0 flex-1">
        <span className="text-[11px] text-zinc-300 truncate">{label}</span>
        {showHelp && (
          <button
            type="button"
            className="shrink-0 w-5 h-5 rounded-full bg-[#00a3e0]/25 text-[#00a3e0] text-[10px] font-bold flex items-center justify-center"
            title="Ajuda"
            aria-label="Ajuda"
          >
            ?
          </button>
        )}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <button
          type="button"
          onClick={onDec}
          className="w-7 h-7 rounded border border-zinc-800 bg-[#141414] text-zinc-200 hover:bg-zinc-800/60 transition-colors"
          aria-label="Diminuir nível"
        >
          −
        </button>
        <div className="w-10 text-center text-[11px] text-white font-bold bg-zinc-900 border border-zinc-800 rounded px-2 py-1">
          {value}
        </div>
        <button
          type="button"
          onClick={onInc}
          className="w-7 h-7 rounded border border-zinc-800 bg-[#141414] text-zinc-200 hover:bg-zinc-800/60 transition-colors"
          aria-label="Aumentar nível"
        >
          +
        </button>
      </div>
    </div>
  );
}

function UserSlidePanel({
  isOpen,
  mode,
  draftUser,
  setDraftUser,
  onClose,
  onSaveClick,
}: {
  isOpen: boolean;
  mode: UserPanelMode;
  draftUser: {
    id: string;
    name: string;
    surname: string;
    email: string;
    pin: string;
    accessLevel: number;
    active: boolean;
  };
  setDraftUser: React.Dispatch<
    React.SetStateAction<{
      id: string;
      name: string;
      surname: string;
      email: string;
      pin: string;
      accessLevel: number;
      active: boolean;
    }>
  >;
  onClose: () => void;
  onSaveClick: () => void;
}) {
  const title =
    mode === 'add'
      ? 'Adicionar função'
      : mode === 'resetPin'
        ? 'Redefinir PIN'
        : `${draftUser.name || 'Usuário'}`.trim() || 'Editar função';

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            className="fixed inset-0 z-[90] bg-black/65"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.aside
            className="fixed top-0 right-0 bottom-0 z-[100] w-full max-w-[440px] bg-[#1a1a1a] border-l border-zinc-800 shadow-2xl flex flex-col"
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'tween', duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="h-14 px-4 border-b border-zinc-800 flex items-center justify-between bg-[#141414] shrink-0">
              <div className="flex items-center gap-2 min-w-0">
                <UserCircle2 size={20} className="text-[#00a3e0] shrink-0" />
                <span className="text-sm font-bold text-white truncate">{title}</span>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="p-2 rounded-lg hover:bg-zinc-800/80 text-zinc-400 hover:text-white transition-colors shrink-0"
                aria-label="Fechar"
              >
                <ArrowRight size={20} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto custom-scrollbar p-4">
              {mode === 'resetPin' ? (
                <div className="space-y-4">
                  <p className="text-[11px] text-zinc-500">
                    Utilizador: <span className="text-zinc-300 font-semibold">{draftUser.name}</span>
                    {draftUser.surname ? ` ${draftUser.surname}` : ''}
                  </p>
                  <Field label="Novo PIN">
                    <input
                      type="password"
                      value={draftUser.pin}
                      onChange={(e) => setDraftUser((p) => ({ ...p, pin: e.target.value }))}
                      placeholder="Novo PIN"
                      autoFocus
                      className="w-full bg-[#0f0f0f] border border-zinc-800 rounded px-3 py-2.5 text-sm text-white outline-none focus:border-[#00a3e0]"
                    />
                  </Field>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-4">
                  <Field label="Nome">
                    <input
                      value={draftUser.name}
                      onChange={(e) => setDraftUser((p) => ({ ...p, name: e.target.value }))}
                      className="w-full bg-[#0f0f0f] border border-zinc-800 rounded px-3 py-2.5 text-sm text-white outline-none focus:border-[#00a3e0]"
                    />
                  </Field>
                  <Field label="Sobrenome">
                    <input
                      value={draftUser.surname}
                      onChange={(e) => setDraftUser((p) => ({ ...p, surname: e.target.value }))}
                      className="w-full bg-[#0f0f0f] border border-zinc-800 rounded px-3 py-2.5 text-sm text-white outline-none focus:border-[#00a3e0]"
                    />
                  </Field>
                  <Field label="Email">
                    <input
                      type="email"
                      value={draftUser.email}
                      onChange={(e) => setDraftUser((p) => ({ ...p, email: e.target.value }))}
                      className="w-full bg-[#0f0f0f] border border-zinc-800 rounded px-3 py-2.5 text-sm text-white outline-none focus:border-[#00a3e0]"
                    />
                  </Field>
                  <Field label="Nível de acesso">
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() =>
                          setDraftUser((p) => ({
                            ...p,
                            accessLevel: clampLevel((p.accessLevel ?? 0) - 1),
                          }))
                        }
                        className="w-10 h-10 rounded border border-zinc-800 bg-[#0f0f0f] text-zinc-200 hover:bg-zinc-800/50 transition-colors"
                      >
                        −
                      </button>
                      <input
                        readOnly
                        value={draftUser.accessLevel}
                        className="flex-1 h-10 bg-[#0f0f0f] border border-zinc-800 rounded px-3 text-white text-center font-bold outline-none"
                      />
                      <button
                        type="button"
                        onClick={() =>
                          setDraftUser((p) => ({
                            ...p,
                            accessLevel: clampLevel((p.accessLevel ?? 0) + 1),
                          }))
                        }
                        className="w-10 h-10 rounded border border-zinc-800 bg-[#0f0f0f] text-zinc-200 hover:bg-zinc-800/50 transition-colors"
                      >
                        +
                      </button>
                    </div>
                  </Field>
                  <Field label="Ativo">
                    <label className="flex items-center gap-2 text-sm text-zinc-200 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={draftUser.active}
                        onChange={(e) => setDraftUser((p) => ({ ...p, active: e.target.checked }))}
                        className="h-4 w-4 rounded border-zinc-600"
                      />
                      {draftUser.active ? 'Ativo' : 'Inativo'}
                    </label>
                  </Field>
                  <Field label={mode === 'add' ? 'PIN / Senha' : 'Nova PIN (opcional)'}>
                    <input
                      type="password"
                      value={draftUser.pin}
                      onChange={(e) => setDraftUser((p) => ({ ...p, pin: e.target.value }))}
                      placeholder={mode === 'add' ? 'Digite o PIN' : 'Deixe em branco para manter'}
                      className="w-full bg-[#0f0f0f] border border-zinc-800 rounded px-3 py-2.5 text-sm text-white outline-none focus:border-[#00a3e0]"
                    />
                  </Field>
                </div>
              )}
            </div>

            <div className="p-4 border-t border-zinc-800 bg-[#141414] flex justify-end gap-2 shrink-0">
              <button
                type="button"
                onClick={onClose}
                className="px-5 py-2.5 rounded-lg border border-zinc-700 text-zinc-200 hover:bg-zinc-800 text-[12px] font-bold inline-flex items-center gap-2"
              >
                <X size={16} />
                Cancelar
              </button>
              <button
                type="button"
                onClick={onSaveClick}
                className="px-5 py-2.5 rounded-lg border border-emerald-600/50 bg-emerald-600/20 text-emerald-300 hover:bg-emerald-600/30 text-[12px] font-bold inline-flex items-center gap-2"
              >
                <Check size={16} />
                Salvar
              </button>
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[11px] font-bold text-zinc-500">{label}</span>
      {children}
    </div>
  );
}
