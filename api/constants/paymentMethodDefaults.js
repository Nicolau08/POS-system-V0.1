/** Meios de pagamento essenciais do POS (Dinheiro + Conta Corrente / dívida). */
export const DEFAULT_PAYMENT_METHOD_SPECS = [
  {
    name: 'Dinheiro',
    code: 'cash',
    shortcut: '',
    position: 1,
    enabled: 1,
    quick_payment: 1,
    required_customer: 0,
    allow_change: 1,
    mark_as_paid: 1,
    print_receipt: 1,
    open_cash_drawer: 1,
    color: '#66c013',
  },
  {
    name: 'CONTA CORRENTE',
    code: 'conta-corrente',
    shortcut: '',
    position: 2,
    enabled: 1,
    quick_payment: 1,
    required_customer: 1,
    allow_change: 0,
    mark_as_paid: 0,
    print_receipt: 1,
    open_cash_drawer: 0,
    color: '#eab308',
  },
];

export function buildDefaultPaymentMethodInsertRows(tenantId, now = new Date().toISOString()) {
  return DEFAULT_PAYMENT_METHOD_SPECS.map((spec) => [
    spec.name,
    spec.code,
    tenantId,
    spec.shortcut,
    spec.position,
    spec.enabled,
    spec.quick_payment,
    spec.required_customer,
    spec.allow_change,
    spec.mark_as_paid,
    spec.print_receipt,
    spec.open_cash_drawer,
    spec.color ?? null,
    now,
    now,
  ]);
}
