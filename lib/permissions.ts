/**
 * Níveis de acesso POSly: o utilizador pode executar uma operação se
 * accessLevel >= required_level da regra em permission_rules.
 */

export const PERMISSION_KEYS = [
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

export type PermissionKey = (typeof PERMISSION_KEYS)[number] | string;

export type PermissionRulesMap = Record<string, number>;

export function clampAccessLevel(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(9, Math.trunc(n)));
}

export function getRequiredLevel(
  rules: PermissionRulesMap | null | undefined,
  key: PermissionKey,
  fallback = 0
): number {
  if (!rules) return clampAccessLevel(fallback);
  if (!(key in rules)) return clampAccessLevel(fallback);
  return clampAccessLevel(rules[key]);
}

export function canAccess(
  accessLevel: unknown,
  rules: PermissionRulesMap | null | undefined,
  key: PermissionKey,
  fallbackRequired = 0
): boolean {
  return clampAccessLevel(accessLevel) >= getRequiredLevel(rules, key, fallbackRequired);
}

export function denyAccessMessage(actionLabel?: string): string {
  const action = String(actionLabel ?? '').trim();
  if (action) return `Sem permissão para: ${action}. Peça a um utilizador com nível superior.`;
  return 'Sem permissão para esta operação. Peça a um utilizador com nível superior.';
}
