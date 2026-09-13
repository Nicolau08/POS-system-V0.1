/**
 * Tipos, constantes e funções puras usadas por DocumentsManager.tsx.
 * Extraído de DocumentsManager.tsx — mesmo código, sem alterações de comportamento.
 */
import { formatMoneyMt } from '@/lib/currency';
import { getPosTaxPercentLabel, getPosTaxRate } from '@/lib/taxConfig';
import type { DocumentCreatePrefix } from '@/app/management/components/PurchaseStockModal';

export const CREATE_DOC_BUTTONS: Record<
  DocumentCreatePrefix,
  { label: string; title: string; successMessage: string }
> = {
  FTF: {
    label: 'Criar Fatura de Fornecedor',
    title: 'Registar compra (mesma função do Stock)',
    successMessage: 'Fatura de Fornecedor registada.',
  },
  FP: {
    label: 'Criar Cotação',
    title: 'Criar cotação de cliente',
    successMessage: 'Cotação registada.',
  },
  FT: {
    label: 'Criar Fatura',
    title: 'Criar fatura de cliente',
    successMessage: 'Fatura registada.',
  },
  VD: {
    label: 'Criar Venda a Dinheiro',
    title: 'Criar venda a dinheiro',
    successMessage: 'Venda a dinheiro registada.',
  },
};

export type OrderRow = {
  id: number | string;
  doc_type?: string | null;
  document_number?: string | null;
  payment_method?: string | null;
  status?: string | null;
  approved_document_type?: string | null;
  approved_document_number?: string | null;
  external_document?: string | null;
  notes?: string | null;
  is_waste?: boolean | number | null;
  credit_note_total?: number | null;
  receipt_total?: number | null;
  discount?: number | null;
  subtotal?: number | null;
  tax?: number | null;
  total?: number | null;
  created_at?: string | null;
  customer_id?: string | null;
  local_sale_id?: string | null;
  client_name?: string | null;
  user_name?: string | null;
};

export type OrderItemRow = {
  id: number | string;
  order_id: number | string;
  product_id?: string | number | null;
  product_name?: string | null;
  quantity?: number | null;
  unit?: string | null;
  price?: number | null;
  tax_rate?: number | null;
  total?: number | null;
};

export const DOCS_VIEW_STATE_STORAGE_KEY = 'management:documents-view-state';

export type DocumentsViewState = {
  selectedOrderId: string | null;
  query: string;
  selectedProduct: string;
  selectedClient: string;
  selectedUser: string;
  selectedDocType: string;
  selectedStatus: string;
  periodFilterActive: boolean;
  dateFrom: string;
  dateTo: string;
};

export function loadDocumentsViewState(): DocumentsViewState {
  const fallback: DocumentsViewState = {
    selectedOrderId: null,
    query: '',
    selectedProduct: 'all',
    selectedClient: 'all',
    selectedUser: 'all',
    selectedDocType: '',
    selectedStatus: 'all',
    periodFilterActive: false,
    dateFrom: '',
    dateTo: '',
  };
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(DOCS_VIEW_STATE_STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<DocumentsViewState>;
    const restoredDocType = String(parsed.selectedDocType ?? '').trim();
    return {
      selectedOrderId: parsed.selectedOrderId == null ? null : String(parsed.selectedOrderId),
      query: String(parsed.query ?? ''),
      selectedProduct: String(parsed.selectedProduct ?? 'all'),
      selectedClient: String(parsed.selectedClient ?? 'all'),
      selectedUser: String(parsed.selectedUser ?? 'all'),
      selectedDocType: !restoredDocType || restoredDocType === 'all' ? '' : restoredDocType,
      selectedStatus: String(parsed.selectedStatus ?? 'all'),
      periodFilterActive: Boolean(parsed.periodFilterActive),
      dateFrom: String(parsed.dateFrom ?? ''),
      dateTo: String(parsed.dateTo ?? ''),
    };
  } catch {
    return fallback;
  }
}

export function isQuotationOrProformaDocType(value: string | null | undefined) {
  const normalized = String(value ?? '').trim().toLowerCase();
  return (
    normalized === 'fp' ||
    normalized.includes('proforma') ||
    normalized.includes('cotação') ||
    normalized.includes('cotacao')
  );
}

export function resolveOrderDocTypeFilterCode(order: OrderRow) {
  const docType = String(order.doc_type ?? '').trim().toUpperCase();
  const docNumber = String(order.document_number ?? '').trim().toUpperCase();
  const orderId = String(order.id ?? '').trim().toLowerCase();

  if (orderId.startsWith('inv:') || docType === 'INV' || docType.includes('INVENT') || docNumber.startsWith('INV/')) {
    return 'INV';
  }
  if (
    docType === 'DP' ||
    docType === 'PERDAS' ||
    docType === 'WH/LOSS' ||
    docType.includes('DESPERD') ||
    docType.includes('QUEBRA') ||
    docNumber.startsWith('DP/') ||
    docNumber.startsWith('WH/LOSS/')
  ) {
    return 'DP';
  }

  if (docType === 'VD' || docType === 'VENDA') return 'VD';
  if (docType === 'FT' || docType === 'FATURA') return 'FT';
  if (docType === 'FP' || docType.includes('PROFORMA') || docType.includes('COTAC')) return 'FP';
  if (docType === 'NC' || docType.includes('CREDITO') || docType.includes('CRÉDITO')) return 'NC';
  if (docType === 'RCA' || docType === 'AD' || (docType.includes('ADIANT') && !docType.includes('PAG'))) return 'RCA';
  if (
    docType === 'PAAD' ||
    docType === 'PA' ||
    docType.includes('PAGAMENTO ADIANT') ||
    docNumber.startsWith('PAAD/') ||
    docNumber.startsWith('PA/')
  ) {
    return 'PAAD';
  }
  if (docType === 'RC' || docType === 'RECIBO') return 'RC';
  if (docType === 'TK' || docType === 'TALAO' || docType === 'TICKET') return 'TK';
  if (docType === 'GR' || docType.includes('REMESSA')) return 'GR';
  if (docType === 'ND' || docType.includes('DEBITO') || docType.includes('DÉBITO')) return 'ND';
  if (docType === 'PAG' || docType.includes('PAGAMENTO')) return 'PAG';
  if (docType === 'CP' || docType.includes('CONSUMO')) return 'CP';
  if (
    docType === 'FTF' ||
    docType === 'EN/ST' ||
    docType === 'PUR' ||
    docType.includes('COMPRA') ||
    docType.includes('FORNECEDOR')
  ) {
    return 'FTF';
  }

  if (docNumber.startsWith('VD/')) return 'VD';
  if (docNumber.startsWith('FT/')) return 'FT';
  if (docNumber.startsWith('FP/')) return 'FP';
  if (docNumber.startsWith('NC/')) return 'NC';
  if (docNumber.startsWith('RCA/') || docNumber.startsWith('AD/')) return 'RCA';
  if (docNumber.startsWith('RC/') || docNumber.startsWith('PBNK')) return 'RC';
  if (docNumber.startsWith('TK/')) return 'TK';
  if (docNumber.startsWith('GR/')) return 'GR';
  if (docNumber.startsWith('ND/')) return 'ND';
  if (docNumber.startsWith('PAG/')) return 'PAG';
  if (docNumber.startsWith('CP/')) return 'CP';
  if (docNumber.startsWith('FTF/') || docNumber.startsWith('EN/ST/') || docNumber.startsWith('PUR/')) return 'FTF';

  return docType || 'VD';
}

export function formatMoney(value: number | null | undefined) {
  return formatMoneyMt(Number(value ?? 0));
}

export function supplierInvoiceOutstanding(row: OrderRow | null | undefined) {
  if (!row) return 0;
  return Math.max(0, Number(row.total ?? 0) - Number(row.credit_note_total ?? 0));
}

export function customerInvoiceOutstanding(row: OrderRow | null | undefined) {
  if (!row) return 0;
  return Math.max(
    0,
    Number(row.total ?? 0) -
      Number(row.receipt_total ?? 0) -
      Number(row.credit_note_total ?? 0),
  );
}

export function customerInvoiceIsFullyPaid(row: OrderRow | null | undefined) {
  if (!row) return false;
  const status = String(row.status ?? '').toLowerCase();
  if (status === 'completed' || status === 'pago') return true;
  return customerInvoiceOutstanding(row) <= 0.009;
}

export const DEFAULT_TAX_RATE_PERCENT = getPosTaxRate() * 100;
export const DEFAULT_TAX_RATE_LABEL = getPosTaxPercentLabel();

export function formatDate(value: string | null | undefined) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return new Intl.DateTimeFormat('pt-PT').format(date);
}

export function formatInvoiceShortDate(value: string | null | undefined) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  const day = String(date.getDate());
  const month = date.toLocaleDateString('pt-PT', { month: 'short' }).replace('.', '');
  return `${day} de ${month}.`;
}

export function dueDateMeta(value: string | null | undefined, docType?: string | null | undefined) {
  const normalizedDocType = String(docType ?? '').trim().toLowerCase();
  if (normalizedDocType === 'vd' || normalizedDocType === 'venda') {
    return { label: 'Pronto pagamento', tone: 'normal' as const };
  }

  if (!value) return { label: '-', tone: 'normal' as const };
  const baseDate = new Date(value);
  if (Number.isNaN(baseDate.getTime())) return { label: '-', tone: 'normal' as const };
  const dueDate = new Date(baseDate);
  const dueDays = isQuotationOrProformaDocType(normalizedDocType) ? 7 : 30;
  dueDate.setDate(dueDate.getDate() + dueDays);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  dueDate.setHours(0, 0, 0, 0);
  const diffDays = Math.round((dueDate.getTime() - today.getTime()) / 86400000);
  const warningThreshold = dueDays === 7 ? 2 : 3;

  if (diffDays < 0) {
    if (dueDays === 7) return { label: 'Documento expirado', tone: 'expired' as const };
    return { label: `${Math.abs(diffDays)} dias atrás`, tone: 'expired' as const };
  }
  if (diffDays === 0) return { label: 'Hoje', tone: 'warning' as const };
  if (dueDays === 30 && (diffDays === 30 || diffDays === 31)) return { label: 'Próximo mês', tone: 'normal' as const };
  if (dueDays === 7) {
    return {
      label: `Válido por ${diffDays} dia${diffDays === 1 ? '' : 's'}`,
      tone: diffDays <= warningThreshold ? ('warning' as const) : ('normal' as const),
    };
  }
  return {
    label: `Em ${diffDays} dias`,
    tone: diffDays <= warningThreshold ? ('warning' as const) : ('normal' as const),
  };
}

export function toDateInput(value: Date) {
  return new Date(value.getTime() - value.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

export function firstDayOfCurrentMonth() {
  const now = new Date();
  return toDateInput(new Date(now.getFullYear(), now.getMonth(), 1));
}

export function todayInput() {
  return toDateInput(new Date());
}

export function monthLabel(value: string) {
  return new Date(`${value}T00:00:00`).toLocaleDateString('pt-PT', {
    month: 'long',
    year: 'numeric',
  });
}

export function shiftMonth(value: string, delta: number) {
  const date = new Date(`${value}T00:00:00`);
  return toDateInput(new Date(date.getFullYear(), date.getMonth() + delta, 1));
}

export function buildCalendarDays(monthValue: string) {
  const monthDate = new Date(`${monthValue}T00:00:00`);
  const year = monthDate.getFullYear();
  const month = monthDate.getMonth();
  const firstDay = new Date(year, month, 1);
  const startWeekday = (firstDay.getDay() + 6) % 7;
  const startDate = new Date(year, month, 1 - startWeekday);

  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(startDate);
    date.setDate(startDate.getDate() + index);
    return {
      value: toDateInput(date),
      day: date.getDate(),
      inMonth: date.getMonth() === month,
    };
  });
}

export function formatInputDateLabel(value: string) {
  if (!value) return 'dd/mm/yyyy';
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return 'dd/mm/yyyy';
  return new Intl.DateTimeFormat('pt-PT').format(date);
}
