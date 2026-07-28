export type DocumentsPartyKind = 'clientes' | 'fornecedores' | 'inventario' | 'interno';

export type DocumentsMenuSection = {
  kind: DocumentsPartyKind;
  label: string;
  items: readonly string[];
};

/** Label do menu → código oficial */
export const CLIENT_DOCUMENT_FILTER: Record<string, string> = {
  Cotação: 'FP',
  Fatura: 'FT',
  'Venda a dinheiro': 'VD',
  Ticket: 'TK',
  Recibo: 'RC',
  'Recibo de adiantamento': 'RCA',
  'Nota de crédito': 'NC',
};

export const SUPPLIER_DOCUMENT_FILTER: Record<string, string> = {
  'Fatura de fornecedor': 'FTF',
  'Nota de débito': 'ND',
  Pagamento: 'PAG',
  'Pagamento adiantado': 'PAAD',
};

export const INVENTORY_DOCUMENT_FILTER: Record<string, string> = {
  'Inventário físico': 'INV',
  Desperdício: 'DP',
};

export const INTERNAL_DOCUMENT_FILTER: Record<string, string> = {
  'Consumo próprio': 'CP',
};

export const DOCUMENT_FILTER_BY_KIND: Record<DocumentsPartyKind, Record<string, string>> = {
  clientes: CLIENT_DOCUMENT_FILTER,
  fornecedores: SUPPLIER_DOCUMENT_FILTER,
  inventario: INVENTORY_DOCUMENT_FILTER,
  interno: INTERNAL_DOCUMENT_FILTER,
};

/** Label do menu lateral Documentos */
export const DOCUMENTS_MENU_SECTIONS: DocumentsMenuSection[] = [
  {
    kind: 'clientes',
    label: 'Clientes',
    items: [
      'Cotação',
      'Fatura',
      'Venda a dinheiro',
      'Ticket',
      'Recibo',
      'Recibo de adiantamento',
      'Nota de crédito',
    ],
  },
  {
    kind: 'fornecedores',
    label: 'Fornecedores',
    items: ['Fatura de fornecedor', 'Nota de débito', 'Pagamento', 'Pagamento adiantado'],
  },
  {
    kind: 'inventario',
    label: 'Inventário',
    items: ['Inventário físico', 'Desperdício'],
  },
  {
    kind: 'interno',
    label: 'Interno',
    items: ['Consumo próprio'],
  },
];
