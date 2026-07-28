'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Banknote, Calendar, CalendarDays, Check, ChevronLeft, ChevronRight, FileMinus2, FileSpreadsheet, Printer, RefreshCcw, X } from 'lucide-react';
import { getPosApiBase } from '@/lib/apiBase';
import { extractApiErrorMessage, unwrapApiSuccessPayload } from '@/lib/apiResponse';
import { formatMoneyMt } from '@/lib/currency';
import { formatDocumentReferenceDisplay } from '@/lib/documents/documentReference';
import { saveSalesDocumentAsPdf } from '@/lib/documents/salesDocumentPrint';
import { printSalesDocumentThermalSecondCopy } from '@/lib/documents/thermalReceiptPrint';
import { fetchCompanyProfile, fetchPaymentMethods } from '@/lib/services/posService';
import { getPosTaxPercentLabel, getPosTaxRate } from '@/lib/taxConfig';
import type {
  CartItem,
  CompanyProfile,
  PaymentEntry,
  PaymentMethod,
  PaymentMethodOption,
} from '@/app/pos/types';
import PosSelect from '@/components/PosSelect';
import { ManagementToolbarButton, ManagementToolbarDivider } from '@/components/ManagementToolbarButton';
import type { DocumentsPartyKind } from '@/app/management/documentsMenu';
import { PaymentModal } from '@/app/pos/components/PaymentModal';
import { SupplierDebitNoteModal } from '@/app/management/components/SupplierDebitNoteModal';

type OrderRow = {
  id: number | string;
  doc_type?: string | null;
  document_number?: string | null;
  payment_method?: string | null;
  status?: string | null;
  approved_document_type?: string | null;
  approved_document_number?: string | null;
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

type OrderItemRow = {
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

const DOCS_VIEW_STATE_STORAGE_KEY = 'management:documents-view-state';

type DocumentsViewState = {
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

function loadDocumentsViewState(): DocumentsViewState {
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

function isQuotationOrProformaDocType(value: string | null | undefined) {
  const normalized = String(value ?? '').trim().toLowerCase();
  return (
    normalized === 'fp' ||
    normalized.includes('proforma') ||
    normalized.includes('cotação') ||
    normalized.includes('cotacao')
  );
}

function resolveOrderDocTypeFilterCode(order: OrderRow) {
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

function formatMoney(value: number | null | undefined) {
  return formatMoneyMt(Number(value ?? 0));
}

const DEFAULT_TAX_RATE_PERCENT = getPosTaxRate() * 100;
const DEFAULT_TAX_RATE_LABEL = getPosTaxPercentLabel();

function formatDate(value: string | null | undefined) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return new Intl.DateTimeFormat('pt-PT').format(date);
}

function formatInvoiceShortDate(value: string | null | undefined) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  const day = String(date.getDate());
  const month = date.toLocaleDateString('pt-PT', { month: 'short' }).replace('.', '');
  return `${day} de ${month}.`;
}

function dueDateMeta(value: string | null | undefined, docType?: string | null | undefined) {
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

function toDateInput(value: Date) {
  return new Date(value.getTime() - value.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

function firstDayOfCurrentMonth() {
  const now = new Date();
  return toDateInput(new Date(now.getFullYear(), now.getMonth(), 1));
}

function todayInput() {
  return toDateInput(new Date());
}

function monthLabel(value: string) {
  return new Date(`${value}T00:00:00`).toLocaleDateString('pt-PT', {
    month: 'long',
    year: 'numeric',
  });
}

function shiftMonth(value: string, delta: number) {
  const date = new Date(`${value}T00:00:00`);
  return toDateInput(new Date(date.getFullYear(), date.getMonth() + delta, 1));
}

function buildCalendarDays(monthValue: string) {
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

function formatInputDateLabel(value: string) {
  if (!value) return 'dd/mm/yyyy';
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return 'dd/mm/yyyy';
  return new Intl.DateTimeFormat('pt-PT').format(date);
}

export default function DocumentsManager({
  externalDocType,
  externalPartyKind,
}: {
  externalDocType?: string | null;
  externalPartyKind?: DocumentsPartyKind | null;
} = {}) {
  const initialViewState = useMemo(() => loadDocumentsViewState(), []);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [itemsByOrderId, setItemsByOrderId] = useState<Record<string, OrderItemRow[]>>({});
  const [registeredProductNames, setRegisteredProductNames] = useState<string[]>([]);
  const [registeredClientNames, setRegisteredClientNames] = useState<string[]>([]);
  const [registeredUserNames, setRegisteredUserNames] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');

  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(initialViewState.selectedOrderId);
  const [query, setQuery] = useState(initialViewState.query);
  const [selectedProduct, setSelectedProduct] = useState(initialViewState.selectedProduct);
  const [selectedClient, setSelectedClient] = useState(initialViewState.selectedClient);
  const [selectedUser, setSelectedUser] = useState(initialViewState.selectedUser);
  const [selectedDocType, setSelectedDocType] = useState(() =>
    externalDocType && externalDocType !== 'all' ? externalDocType : ''
  );
  const [selectedStatus, setSelectedStatus] = useState(initialViewState.selectedStatus);
  const [periodFilterActive, setPeriodFilterActive] = useState(initialViewState.periodFilterActive);
  const [dateFrom, setDateFrom] = useState(initialViewState.dateFrom);
  const [dateTo, setDateTo] = useState(initialViewState.dateTo);
  const [tempDateFrom, setTempDateFrom] = useState(initialViewState.dateFrom || firstDayOfCurrentMonth());
  const [tempDateTo, setTempDateTo] = useState(initialViewState.dateTo || todayInput());
  const [calendarStartMonth, setCalendarStartMonth] = useState(`${(initialViewState.dateFrom || firstDayOfCurrentMonth()).slice(0, 7)}-01`);
  const [calendarEndMonth, setCalendarEndMonth] = useState(`${(initialViewState.dateTo || todayInput()).slice(0, 7)}-01`);
  const [isPeriodModalOpen, setIsPeriodModalOpen] = useState(false);
  const [companyProfile, setCompanyProfile] = useState<CompanyProfile | null>(null);
  const [actionMessage, setActionMessage] = useState('');
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
  const [isDebitNoteModalOpen, setIsDebitNoteModalOpen] = useState(false);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethodOption[]>([]);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | null>(null);
  const [receivedAmount, setReceivedAmount] = useState('');
  const [isMultiplePayment, setIsMultiplePayment] = useState(false);
  const [payments, setPayments] = useState<PaymentEntry[]>([]);
  const [multiplePaymentMethod, setMultiplePaymentMethod] = useState<PaymentMethod>('cash');
  const [multiplePaymentAmount, setMultiplePaymentAmount] = useState('');
  const [isFinalizingPayment, setIsFinalizingPayment] = useState(false);
  const [paymentFinalizeError, setPaymentFinalizeError] = useState<string | null>(null);

  useEffect(() => {
    // Sem tipo escolhido no menu lateral → não mostrar documentos
    if (externalDocType == null || externalDocType === '' || externalDocType === 'all') {
      setSelectedDocType('');
      setSelectedOrderId(null);
      return;
    }
    setSelectedDocType(externalDocType);
    setSelectedOrderId(null);
  }, [externalDocType, externalPartyKind]);

  const getCustomerName = (order: OrderRow) => String(order.client_name || 'Consumidor final');
  const getUserName = (order: OrderRow) => String(order.user_name || '-');

  const describeError = (error: unknown) => {
    if (!error) return 'Erro desconhecido';
    if (typeof error === 'string') return error;
    if (error instanceof Error) return error.message || 'Erro inesperado';
    try {
      const maybe = error as Record<string, unknown>;
      if (typeof maybe.message === 'string' && maybe.message.trim()) return maybe.message;
      if (typeof maybe.error_description === 'string' && maybe.error_description.trim()) return maybe.error_description;
      return JSON.stringify(error);
    } catch {
      return 'Erro inesperado';
    }
  };

  const fetchData = async () => {
    setLoading(true);
    setErrorMessage('');
    try {
      const [ordersRes, salesRes, itemsRes, usersRes, clientsRes, productsRes] = await Promise.all([
        fetch(`${getPosApiBase()}/documentos`),
        fetch(`${getPosApiBase()}/vendas`),
        fetch(`${getPosApiBase()}/documentos-itens`),
        fetch(`${getPosApiBase()}/users`),
        fetch(`${getPosApiBase()}/clientes`),
        fetch(`${getPosApiBase()}/produtos`),
      ]);
      if (!ordersRes.ok) throw new Error(`Falha ao carregar documentos (${ordersRes.status})`);
      if (!salesRes.ok) throw new Error(`Falha ao carregar vendas (${salesRes.status})`);
      if (!itemsRes.ok) throw new Error(`Falha ao carregar itens (${itemsRes.status})`);
      if (!usersRes.ok) throw new Error(`Falha ao carregar usuários (${usersRes.status})`);
      if (!clientsRes.ok) throw new Error(`Falha ao carregar clientes (${clientsRes.status})`);
      if (!productsRes.ok) throw new Error(`Falha ao carregar produtos (${productsRes.status})`);

      const docsOrders = (unwrapApiSuccessPayload<OrderRow[]>(await ordersRes.json()) ?? []) as OrderRow[];
      const salesOrders = (unwrapApiSuccessPayload<OrderRow[]>(await salesRes.json()) ?? []) as OrderRow[];
      const mergedOrdersMap = new Map<string, OrderRow>();
      for (const order of docsOrders) {
        mergedOrdersMap.set(String(order.id), order);
      }
      for (const sale of salesOrders) {
        // Prefixo evita colisão com ids numéricos em bases antigas.
        mergedOrdersMap.set(`venda:${String(sale.id)}`, { ...sale, id: `venda:${String(sale.id)}` });
      }
      const parseDocumentSequence = (documentNumber: string | null | undefined) => {
        const raw = String(documentNumber ?? '').trim();
        if (!raw) return 0;
        const parts = raw.split('/');
        const lastPart = parts[parts.length - 1] ?? '';
        const sequence = Number(lastPart);
        return Number.isFinite(sequence) ? sequence : 0;
      };

      const safeOrders = Array.from(mergedOrdersMap.values()).sort((a, b) => {
        const aTime = Date.parse(String(a.created_at ?? '')) || 0;
        const bTime = Date.parse(String(b.created_at ?? '')) || 0;
        if (bTime !== aTime) return bTime - aTime;

        const aDocSequence = parseDocumentSequence(a.document_number);
        const bDocSequence = parseDocumentSequence(b.document_number);
        if (bDocSequence !== aDocSequence) return bDocSequence - aDocSequence;

        return String(b.id).localeCompare(String(a.id));
      });
      setOrders(safeOrders);

      const usersData = (unwrapApiSuccessPayload<Array<{ name?: string | null; surname?: string | null; active?: boolean | number | null }>>(await usersRes.json()) ?? []);
      const clientsData = (unwrapApiSuccessPayload<Array<{ name?: string | null }>>(await clientsRes.json()) ?? []);
      const productsData = (unwrapApiSuccessPayload<Array<{ name?: string | null }>>(await productsRes.json()) ?? []);

      const productNames = Array.from(
        new Set(
          productsData
            .map((item) => String(item?.name ?? '').trim())
            .filter(Boolean)
        )
      ).sort((a, b) => a.localeCompare(b));
      setRegisteredProductNames(productNames);

      const clientNames = Array.from(
        new Set(
          clientsData
            .map((item) => String(item?.name ?? '').trim())
            .filter(Boolean)
        )
      ).sort((a, b) => a.localeCompare(b));
      setRegisteredClientNames(clientNames);

      const userNames = Array.from(
        new Set(
          usersData
            .filter((user) => user?.active !== 0 && user?.active !== false)
            .map((user) => {
              const fullName = `${String(user?.name ?? '').trim()} ${String(user?.surname ?? '').trim()}`.trim();
              return fullName || String(user?.name ?? '').trim();
            })
            .filter((name) => Boolean(name) && name !== '-')
        )
      ).sort((a, b) => a.localeCompare(b));
      setRegisteredUserNames(userNames);

      if (safeOrders.length === 0) {
        setItemsByOrderId({});
        return;
      }

      const itemsPayload = unwrapApiSuccessPayload<OrderItemRow[] | null>(await itemsRes.json());
      if (itemsPayload != null && !Array.isArray(itemsPayload)) {
        console.warn('[DocumentsManager] Resposta inesperada em /documentos-itens:', itemsPayload);
      }
      const itemsData = Array.isArray(itemsPayload) ? itemsPayload : [];

      const grouped: Record<string, OrderItemRow[]> = {};
      for (const item of itemsData ?? []) {
        const key = String(item.order_id);
        if (!grouped[key]) grouped[key] = [];
        grouped[key].push(item);
        const saleKey = `venda:${key}`;
        if (!grouped[saleKey]) grouped[saleKey] = [];
        grouped[saleKey].push(item);
      }
      setItemsByOrderId(grouped);
    } catch (error: any) {
      // Evita poluir o overlay do Next em dev com objetos vazios (ex.: {}).
      // A falha é exibida no rodapé do módulo.
      setErrorMessage(`Não foi possível carregar documentos. ${describeError(error)}`);
      setOrders([]);
      setItemsByOrderId({});
      setRegisteredProductNames([]);
      setRegisteredClientNames([]);
      setRegisteredUserNames([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchData();
    void fetchCompanyProfile()
      .then(setCompanyProfile)
      .catch(() => setCompanyProfile(null));
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const viewState: DocumentsViewState = {
      selectedOrderId,
      query,
      selectedProduct,
      selectedClient,
      selectedUser,
      selectedDocType,
      selectedStatus,
      periodFilterActive,
      dateFrom,
      dateTo,
    };
    window.localStorage.setItem(DOCS_VIEW_STATE_STORAGE_KEY, JSON.stringify(viewState));
  }, [selectedOrderId, query, selectedProduct, selectedClient, selectedUser, selectedDocType, selectedStatus, periodFilterActive, dateFrom, dateTo]);

  const clientOptions = useMemo(() => {
    return registeredClientNames;
  }, [registeredClientNames]);

  const filteredOrders = useMemo(() => {
    // Só lista documentos depois de escolher o tipo no menu lateral
    if (!selectedDocType || selectedDocType === 'all') {
      return [];
    }

    const normalizedQuery = query.toLowerCase().trim();
    return orders.filter((order) => {
      const orderId = String(order.id);
      const documentNumber = String(order.document_number || '');
      const customerName = String(getCustomerName(order));
      const userName = String(getUserName(order));
      const docType = String(order.doc_type || '').trim();
      const paymentMethod = String(order.payment_method || '-');
      const createdAt = String(order.created_at || '');
      const status = String(order.status || '-');

      const orderDate = createdAt.slice(0, 10);
      if (periodFilterActive) {
        if (dateFrom && orderDate && orderDate < dateFrom) return false;
        if (dateTo && orderDate && orderDate > dateTo) return false;
      }

      if (selectedClient !== 'all' && customerName !== selectedClient) return false;
      if (selectedUser !== 'all' && userName !== selectedUser) return false;

      const orderDocCode = resolveOrderDocTypeFilterCode(order);
      if (selectedDocType === 'FP') {
        if (!isQuotationOrProformaDocType(docType) && orderDocCode !== 'FP') return false;
      } else if (orderDocCode !== selectedDocType) {
        return false;
      }

      if (selectedStatus !== 'all' && status !== selectedStatus) return false;

      if (selectedProduct !== 'all') {
        const hasProduct = (itemsByOrderId[orderId] ?? []).some((item) => String(item.product_name || '').trim() === selectedProduct);
        if (!hasProduct) return false;
      }

      if (!normalizedQuery) return true;
      return (
        documentNumber.toLowerCase().includes(normalizedQuery) ||
        customerName.toLowerCase().includes(normalizedQuery) ||
        paymentMethod.toLowerCase().includes(normalizedQuery) ||
        docType.toLowerCase().includes(normalizedQuery) ||
        userName.toLowerCase().includes(normalizedQuery) ||
        orderId.toLowerCase().includes(normalizedQuery)
      );
    });
  }, [
    orders,
    query,
    selectedClient,
    selectedUser,
    selectedDocType,
    selectedStatus,
    selectedProduct,
    periodFilterActive,
    dateFrom,
    dateTo,
    itemsByOrderId,
  ]);

  useEffect(() => {
    if (selectedOrderId == null) return;
    if (!filteredOrders.some((row) => String(row.id) === selectedOrderId)) {
      setSelectedOrderId(filteredOrders[0] ? String(filteredOrders[0].id) : null);
    }
  }, [filteredOrders, selectedOrderId]);

  useEffect(() => {
    if (!isPeriodModalOpen) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsPeriodModalOpen(false);
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [isPeriodModalOpen]);

  const selectedItems = useMemo(() => {
    if (!selectedOrderId) return [];
    return itemsByOrderId[selectedOrderId] ?? [];
  }, [itemsByOrderId, selectedOrderId]);

  const selectedOrder = useMemo(() => {
    if (!selectedOrderId) return null;
    return orders.find((order) => String(order.id) === selectedOrderId) ?? null;
  }, [orders, selectedOrderId]);

  const showPayToolbarAction = selectedDocType === 'FTF' || selectedDocType === 'FT';
  const showCreateDebitNoteAction = selectedDocType === 'FTF';
  const selectedOrderIsPayable = useMemo(() => {
    if (!selectedOrder || !showPayToolbarAction) return false;
    const status = String(selectedOrder.status ?? '').toLowerCase();
    if (status === 'completed' || status === 'approved' || status === 'pago') return false;
    if (String(selectedOrder.approved_document_number ?? '').trim()) return false;
    const code = resolveOrderDocTypeFilterCode(selectedOrder);
    return code === selectedDocType;
  }, [selectedOrder, selectedDocType, showPayToolbarAction]);

  const paymentCart = useMemo<CartItem[]>(() => {
    if (!selectedOrder) return [];
    if (selectedItems.length === 0) {
      return [
        {
          id: `doc-${selectedOrder.id}`,
          name: String(selectedOrder.document_number ?? 'Documento'),
          price: Number(selectedOrder.total ?? 0),
          category: 'Documento',
          quantity: 1,
        },
      ];
    }
    return selectedItems.map((item, index) => {
      const qty = Math.max(0, Number(item.quantity ?? 0));
      const unitPrice = Number(item.price ?? 0);
      return {
        id: String(item.id ?? `item-${index}`),
        name: String(item.product_name ?? `Item ${index + 1}`),
        price: unitPrice,
        category: 'Documento',
        quantity: qty > 0 ? qty : 1,
      };
    });
  }, [selectedOrder, selectedItems]);

  const paymentTotals = useMemo(() => {
    const total = Number(selectedOrder?.total ?? 0);
    const subtotal = Number(
      selectedOrder?.subtotal ?? total - Number(selectedOrder?.tax ?? 0),
    );
    const tax = Number(selectedOrder?.tax ?? Math.max(0, total - subtotal));
    return {
      total,
      subtotal: Math.max(0, subtotal),
      tax: Math.max(0, tax),
    };
  }, [selectedOrder]);

  const resetPaymentState = () => {
    setPaymentMethod(null);
    setReceivedAmount('');
    setPayments([]);
    setIsMultiplePayment(false);
    setMultiplePaymentAmount('');
    setPaymentFinalizeError(null);
  };

  const handleRefresh = () => {
    setActionMessage('');
    void fetchData();
  };

  const handleOpenPayment = () => {
    if (!selectedOrderIsPayable || !selectedOrder) {
      setActionMessage(
        selectedOrder
          ? 'Este documento já está pago ou não pode ser pago aqui.'
          : 'Selecione uma fatura para pagar.',
      );
      return;
    }
    setActionMessage('');
    resetPaymentState();
    setIsPaymentModalOpen(true);
    void fetchPaymentMethods()
      .then((methods) => {
        const enabled = methods.filter((m) => m.enabled && m.markAsPaid !== false);
        setPaymentMethods(enabled);
        if (enabled[0]) {
          setPaymentMethod(enabled[0].code);
          setMultiplePaymentMethod(enabled[0].code);
        }
      })
      .catch(() => {
        setPaymentMethods([
          {
            id: 'cash',
            name: 'Dinheiro',
            code: 'cash',
            position: 1,
            enabled: true,
            quickPayment: true,
            requiredCustomer: false,
            allowChange: true,
            markAsPaid: true,
            printReceipt: true,
            openCashDrawer: true,
          },
        ]);
        setPaymentMethod('cash');
        setMultiplePaymentMethod('cash');
      });
  };

  const handleFinalizeDocumentPayment = async () => {
    if (!selectedOrder?.document_number || isFinalizingPayment) return;
    const method = isMultiplePayment
      ? payments.map((p) => p.method).filter(Boolean).join('+') || multiplePaymentMethod
      : paymentMethod;
    if (!method) {
      setPaymentFinalizeError('Seleccione o método de pagamento.');
      return;
    }
    setIsFinalizingPayment(true);
    setPaymentFinalizeError(null);
    try {
      const res = await fetch(`${getPosApiBase()}/documentos/registar-pagamento`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          documentNumber: String(selectedOrder.document_number).trim(),
          paymentMethod: method,
          payableKind: selectedDocType === 'FTF' ? 'FTF' : selectedDocType === 'FT' ? 'FT' : undefined,
        }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(extractApiErrorMessage(payload, `Falha ao registar pagamento (${res.status})`));
      }
      const data = unwrapApiSuccessPayload<{
        generatedDocumentType?: string;
        generatedDocumentNumber?: string;
        sourceDocumentNumber?: string;
      }>(payload);
      setIsPaymentModalOpen(false);
      resetPaymentState();
      setActionMessage(
        `${String(data?.generatedDocumentType ?? 'DOC')} ${String(data?.generatedDocumentNumber ?? '')} gerado para ${String(data?.sourceDocumentNumber ?? selectedOrder.document_number)}.`,
      );
      await fetchData();
    } catch (error) {
      setPaymentFinalizeError(error instanceof Error ? error.message : 'Falha ao registar pagamento');
    } finally {
      setIsFinalizingPayment(false);
    }
  };

  const handlePrint = () => {
    if (!selectedOrder) {
      setActionMessage('Selecione um documento para imprimir.');
      return;
    }
    void printSalesDocumentThermalSecondCopy(selectedOrder, selectedItems, companyProfile).then((opened) => {
      if (!opened) {
        setActionMessage('Não foi possível abrir a impressão térmica. Verifique se o browser permite pop-ups.');
        return;
      }
      setActionMessage('');
    });
  };

  const handleSavePdf = () => {
    if (!selectedOrder) {
      setActionMessage('Selecione um documento para guardar como PDF.');
      return;
    }
    const opened = saveSalesDocumentAsPdf(selectedOrder, selectedItems, companyProfile);
    if (!opened) {
      setActionMessage('Não foi possível abrir a janela de PDF. Verifique se o browser permite pop-ups.');
      return;
    }
    setActionMessage('');
  };

  const handleClearFilters = () => {
    setQuery('');
    setSelectedProduct('all');
    setSelectedClient('all');
    setSelectedUser('all');
    setSelectedDocType('');
    setSelectedStatus('all');
    setPeriodFilterActive(false);
    setDateFrom('');
    setDateTo('');
  };

  const openPeriodModal = () => {
    const start = dateFrom || firstDayOfCurrentMonth();
    const end = dateTo || todayInput();
    setTempDateFrom(start);
    setTempDateTo(end);
    setCalendarStartMonth(`${start.slice(0, 7)}-01`);
    setCalendarEndMonth(`${end.slice(0, 7)}-01`);
    setIsPeriodModalOpen(true);
  };

  const applyPeriod = () => {
    setDateFrom(tempDateFrom);
    setDateTo(tempDateTo);
    setPeriodFilterActive(true);
    setIsPeriodModalOpen(false);
  };

  const clearPeriodFilter = () => {
    setPeriodFilterActive(false);
    setDateFrom('');
    setDateTo('');
    setIsPeriodModalOpen(false);
  };

  const applyPresetPeriod = (preset: 'today' | 'yesterday' | 'thisWeek' | 'lastWeek' | 'thisMonth' | 'lastMonth' | 'thisYear' | 'lastYear') => {
    const now = new Date();
    let start = new Date(now);
    let end = new Date(now);

    if (preset === 'yesterday') {
      start.setDate(start.getDate() - 1);
      end = new Date(start);
    }
    if (preset === 'thisWeek') {
      const day = now.getDay();
      const diff = day === 0 ? 6 : day - 1;
      start = new Date(now);
      start.setDate(now.getDate() - diff);
      end = new Date(now);
    }
    if (preset === 'lastWeek') {
      const day = now.getDay();
      const diff = day === 0 ? 6 : day - 1;
      end = new Date(now);
      end.setDate(now.getDate() - diff - 1);
      start = new Date(end);
      start.setDate(end.getDate() - 6);
    }
    if (preset === 'thisMonth') {
      start = new Date(now.getFullYear(), now.getMonth(), 1);
      end = new Date(now);
    }
    if (preset === 'lastMonth') {
      start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      end = new Date(now.getFullYear(), now.getMonth(), 0);
    }
    if (preset === 'thisYear') {
      start = new Date(now.getFullYear(), 0, 1);
      end = new Date(now);
    }
    if (preset === 'lastYear') {
      start = new Date(now.getFullYear() - 1, 0, 1);
      end = new Date(now.getFullYear() - 1, 11, 31);
    }

    const startInput = toDateInput(start);
    const endInput = toDateInput(end);
    setTempDateFrom(startInput);
    setTempDateTo(endInput);
    setCalendarStartMonth(`${startInput.slice(0, 7)}-01`);
    setCalendarEndMonth(`${endInput.slice(0, 7)}-01`);
  };

  const handleScreenClickToDeselect = (event: React.MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement | null;
    if (!target) return;
    if (target.closest('button, input, select, option, table, tr, td, th, a, label')) return;
    setSelectedOrderId(null);
  };

  return (
    <div
      className="flex h-full flex-col bg-[#1a1a1a] text-zinc-300 overflow-x-hidden overflow-y-visible"
      onClick={handleScreenClickToDeselect}
    >
      <div className="relative z-40 h-16 bg-[#1a1a1a] border-b border-zinc-800 px-2 overflow-visible">
        <div className="h-full flex items-center gap-1 overflow-x-auto overflow-y-visible no-scrollbar">
          <ManagementToolbarButton icon={<RefreshCcw size={20} />} label="Atualizar" onClick={handleRefresh} />
          <ManagementToolbarButton icon={<Printer size={20} />} label="Imprimir" onClick={handlePrint} />
          <ManagementToolbarButton icon={<FileSpreadsheet size={20} />} label="Salvar como PDF" onClick={handleSavePdf} />
          {showPayToolbarAction ? (
            <>
              <ManagementToolbarDivider />
              <ManagementToolbarButton
                icon={<Banknote size={20} />}
                label="Pagar"
                disabled={!selectedOrderIsPayable}
                onClick={handleOpenPayment}
                title={
                  !selectedOrder
                    ? 'Selecione uma fatura para pagar'
                    : selectedOrderIsPayable
                      ? 'Registar pagamento'
                      : 'Documento já pago'
                }
              />
            </>
          ) : null}
          {showCreateDebitNoteAction ? (
            <>
              <ManagementToolbarDivider />
              <ManagementToolbarButton
                icon={<FileMinus2 size={20} />}
                label="Criar"
                onClick={() => {
                  setActionMessage('');
                  setIsDebitNoteModalOpen(true);
                }}
                title="Criar nota de débito contra uma FTF"
              />
            </>
          ) : null}
        </div>
      </div>

      <div className="relative z-30 border-b border-zinc-800 bg-[#181818] px-3 py-2 overflow-visible">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2 max-w-[980px]">
          <FilterSelect label="Cliente" value={selectedClient} onChange={setSelectedClient} options={['all', ...clientOptions]} />
          <FilterSelect
            label="Estado"
            value={selectedStatus}
            onChange={setSelectedStatus}
            options={['all', 'completed', 'pending', 'approved', 'cancelled']}
          />
          <div>
            <label className="block text-[11px] text-zinc-400 mb-1">Período</label>
            <button
              type="button"
              onClick={openPeriodModal}
              className="pos-select-trigger h-8 w-full gap-2 px-3"
            >
              <CalendarDays size={14} className="shrink-0 text-zinc-400" />
              <span className="flex-1 whitespace-nowrap text-center text-xs font-medium text-zinc-200">
                {periodFilterActive
                  ? `${formatInputDateLabel(dateFrom)} - ${formatInputDateLabel(dateTo)}`
                  : 'Todos os períodos'}
              </span>
            </button>
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-0 flex flex-col">
        <div className="min-h-0 flex-1 border-b border-zinc-800">
          <div
            className="h-full overflow-auto bg-[#0f0f0f] custom-scrollbar"
            onClick={() => setSelectedOrderId(null)}
          >
            <table className="w-full min-w-[980px] border-collapse text-left text-xs [&_th]:border [&_td]:border [&_th]:border-zinc-800/55 [&_td]:border-zinc-800/55">
              <thead className="sticky top-0 z-10 bg-[#141414]">
                <tr className="border-b border-[#0001fb]/70">
                  <Th>Número</Th>
                  <Th>Referência</Th>
                  <Th>Cliente</Th>
                  <Th>Data da fatura</Th>
                  <Th>Data de vencimento</Th>
                  <Th className="text-right">Sem impostos</Th>
                  <Th className="text-right">Total</Th>
                  <Th className="text-right">Valor devido</Th>
                  <Th>Status</Th>
                </tr>
              </thead>
              <tbody>
                  {loading ? (
                  <tr>
                    <td colSpan={9} className="px-3 py-8 text-center text-zinc-500">
                      Carregando documentos...
                    </td>
                  </tr>
                ) : filteredOrders.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-3 py-8 text-center text-zinc-500">
                      {!selectedDocType || selectedDocType === 'all'
                        ? 'Selecione um tipo de documento no menu lateral para ver a lista.'
                        : 'Sem documentos deste tipo para os filtros selecionados.'}
                    </td>
                  </tr>
                ) : (
                  filteredOrders.map((row, index) => {
                    const rowId = String(row.id);
                    const selected = rowId === selectedOrderId;
                    const rowStatus = String(row.status || '').toLowerCase();
                    const paid = rowStatus === 'completed';
                    const approved = rowStatus === 'approved' || rowStatus === 'aprovado';
                    const docTypeNormalized = String(row.doc_type || '').trim().toLowerCase();
                    const isQuotationOrProforma =
                      docTypeNormalized === 'fp' ||
                      docTypeNormalized.includes('proforma') ||
                      docTypeNormalized.includes('cotação') ||
                      docTypeNormalized.includes('cotacao');
                    const quotationConverted =
                      isQuotationOrProforma &&
                      String(row.approved_document_type ?? '').trim().toUpperCase() === 'VD' &&
                      Boolean(String(row.approved_document_number ?? '').trim());
                    const isApprovedQuotation = isQuotationOrProforma && (approved || quotationConverted);
                    const docFilterCode = resolveOrderDocTypeFilterCode(row);
                    const referenceLabel = formatDocumentReferenceDisplay(row, docFilterCode);
                    const settled = paid || approved || quotationConverted;
                    const due = dueDateMeta(row.created_at, row.doc_type);
                    const dueClass = settled
                      ? 'text-zinc-200'
                      : due.tone === 'expired'
                        ? 'text-red-400'
                        : due.tone === 'warning'
                          ? 'text-amber-300'
                          : 'text-zinc-300';
                    const statusLabel = isApprovedQuotation || approved
                      ? 'Aprovado'
                      : paid
                        ? 'Pago'
                        : isQuotationOrProforma
                          ? 'Lançado'
                          : 'Não pago';
                    const statusClass = isApprovedQuotation || approved
                      ? 'bg-blue-600 text-white'
                      : paid
                        ? 'bg-green-600 text-white'
                        : isQuotationOrProforma
                          ? 'bg-amber-600 text-white'
                          : 'bg-red-600 text-white';
                    return (
                      <tr
                        key={rowId}
                        onClick={(event) => {
                          event.stopPropagation();
                          setSelectedOrderId(rowId);
                        }}
                        className={`cursor-pointer transition-colors ${
                          selected
                            ? 'bg-[var(--pos-brand-selected-bg)]'
                            : index % 2
                              ? 'bg-[#171717]'
                              : 'bg-[#1d1d1d]'
                        } hover:bg-[var(--pos-brand-hover-bg)]`}
                      >
                        <Td>{row.document_number || `DOC-${rowId}`}</Td>
                        <Td className="text-zinc-400">{referenceLabel || '—'}</Td>
                        <Td>{getCustomerName(row)}</Td>
                        <Td>{formatInvoiceShortDate(row.created_at)}</Td>
                        <Td className={dueClass}>{due.label}</Td>
                        <Td className="text-right">{formatMoney(Number(row.subtotal ?? (Number(row.total ?? 0) - Number(row.tax ?? 0))))}</Td>
                        <Td className="text-right text-zinc-200">{formatMoney(row.total)}</Td>
                        <Td className={`text-right ${settled ? 'text-zinc-400' : 'text-rose-300'}`}>
                          {formatMoney(settled ? 0 : Number(row.total ?? 0))}
                        </Td>
                        <Td>
                          <DocumentStatusBadge label={statusLabel} className={statusClass} hint={referenceLabel || undefined} />
                        </Td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="h-[38%] min-h-[190px]">
          <div className="h-full overflow-auto bg-[#0f0f0f] custom-scrollbar">
            <div className="px-3 py-2 border-b border-zinc-800 bg-[#171717] text-xs text-zinc-400">
              Itens do documento ({selectedItems.length})
            </div>
            <table className="w-full min-w-[900px] border-collapse text-left text-xs [&_th]:border [&_td]:border [&_th]:border-zinc-800/55 [&_td]:border-zinc-800/55">
              <thead className="sticky top-0 z-10 bg-[#141414]">
                <tr className="border-b border-[#0001fb]/70">
                  <Th>Código</Th>
                  <Th>Nome</Th>
                  <Th>Unidade de medida</Th>
                  <Th>Quantidade</Th>
                  <Th>Preço antes dos impostos</Th>
                  <Th>Impostos</Th>
                  <Th>Preço</Th>
                  <Th>Total</Th>
                </tr>
              </thead>
              <tbody>
                {selectedItems.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-3 py-8 text-center text-zinc-500">
                      {selectedOrderId
                        ? 'Este documento não tem itens.'
                        : 'Selecione um documento para ver os itens.'}
                    </td>
                  </tr>
                ) : (
                  selectedItems.map((item, index) => {
                    const qty = Number(item.quantity ?? 0);
                    const unitPriceWithTax = Number(item.price ?? 0);
                    const taxRate = Number(item.tax_rate ?? 0) > 0 ? Number(item.tax_rate ?? 0) : DEFAULT_TAX_RATE_PERCENT;
                    const unitPriceBeforeTax = unitPriceWithTax / (1 + taxRate / 100);
                    const unitTaxAmount = unitPriceWithTax - unitPriceBeforeTax;
                    const rowTotal = Number(item.total ?? unitPriceWithTax * qty);
                    return (
                      <tr
                        key={String(item.id)}
                        className={`${
                          index % 2 ? 'bg-[#171717]' : 'bg-[#1d1d1d]'
                        } hover:bg-[var(--pos-brand-hover-bg)]`}
                      >
                        <Td>{index + 1}</Td>
                        <Td>{item.product_name || '-'}</Td>
                        <Td>{item.unit || 'UN'}</Td>
                        <Td>{qty.toFixed(3)}</Td>
                        <Td>{formatMoney(unitPriceBeforeTax)}</Td>
                        <Td>{`${formatMoney(unitTaxAmount)} (${Number(item.tax_rate ?? 0) > 0 ? `${taxRate}%` : DEFAULT_TAX_RATE_LABEL})`}</Td>
                        <Td>{formatMoney(unitPriceWithTax)}</Td>
                        <Td>{formatMoney(rowTotal)}</Td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {errorMessage && (
        <div className="px-3 py-2 text-xs border-t border-rose-500/30 bg-rose-950/30 text-rose-200">{errorMessage}</div>
      )}
      {actionMessage ? (
        <div className="px-3 py-2 text-xs border-t border-[#0001fb]/30 bg-[#0001fb]/10 text-[#a5b4fc]">{actionMessage}</div>
      ) : null}

      {isPeriodModalOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/70 backdrop-blur-[2px] flex items-center justify-center p-6"
          onClick={() => setIsPeriodModalOpen(false)}
        >
          <div
            className="w-full max-w-[820px] overflow-hidden rounded-[0.55rem] border border-zinc-700 bg-[#1f1f1f] shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="px-6 py-5 text-center">
              <h3 className="text-[18px] text-white">Período</h3>
              <div className="mt-4 inline-flex items-center rounded-[0.4rem] border border-zinc-700 bg-[#1a1a1a] px-4 py-2 font-bold text-white">
                {formatInputDateLabel(tempDateFrom)} - {formatInputDateLabel(tempDateTo)}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-6 p-6 md:grid-cols-[1fr_1fr_280px]">
              <div>
                <p className="mb-3 text-center text-sm text-zinc-100">Início</p>
                <div className="mx-auto max-w-[260px] rounded-[0.4rem] border border-zinc-700 bg-[#1a1a1a] p-4">
                  <div className="flex items-center justify-between px-1 pb-4">
                    <button
                      onClick={() => setCalendarStartMonth(shiftMonth(calendarStartMonth, -1))}
                      className="rounded-[0.4rem] p-1 text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-white"
                    >
                      <ChevronLeft size={16} />
                    </button>
                    <div className="font-bold text-white">{monthLabel(calendarStartMonth)}</div>
                    <button
                      onClick={() => setCalendarStartMonth(shiftMonth(calendarStartMonth, 1))}
                      className="rounded-[0.4rem] p-1 text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-white"
                    >
                      <ChevronRight size={16} />
                    </button>
                  </div>
                  <CalendarGrid monthValue={calendarStartMonth} selectedValue={tempDateFrom} onSelect={setTempDateFrom} />
                </div>
              </div>

              <div>
                <p className="text-sm text-zinc-100 mb-3 text-center">Fim</p>
                <div className="mx-auto max-w-[260px] rounded-[0.4rem] border border-zinc-700 bg-[#1a1a1a] p-4">
                  <div className="flex items-center justify-between px-1 pb-4">
                    <button
                      onClick={() => setCalendarEndMonth(shiftMonth(calendarEndMonth, -1))}
                      className="rounded-[0.4rem] p-1 text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-white"
                    >
                      <ChevronLeft size={16} />
                    </button>
                    <div className="font-bold text-white">{monthLabel(calendarEndMonth)}</div>
                    <button
                      onClick={() => setCalendarEndMonth(shiftMonth(calendarEndMonth, 1))}
                      className="rounded-[0.4rem] p-1 text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-white"
                    >
                      <ChevronRight size={16} />
                    </button>
                  </div>
                  <CalendarGrid monthValue={calendarEndMonth} selectedValue={tempDateTo} onSelect={setTempDateTo} />
                </div>
              </div>

              <div>
                <p className="text-sm text-zinc-100 mb-3 text-center">Período pré-definido</p>
                <div className="grid grid-cols-2 gap-2">
                  <PresetButton label="Hoje" onClick={() => applyPresetPeriod('today')} />
                  <PresetButton label="Ontem" onClick={() => applyPresetPeriod('yesterday')} />
                  <PresetButton label="Esta semana" onClick={() => applyPresetPeriod('thisWeek')} />
                  <PresetButton label="Semana passada" onClick={() => applyPresetPeriod('lastWeek')} />
                  <PresetButton label="Este mês" onClick={() => applyPresetPeriod('thisMonth')} />
                  <PresetButton label="Mês passado" onClick={() => applyPresetPeriod('lastMonth')} />
                  <PresetButton label="Este ano" onClick={() => applyPresetPeriod('thisYear')} />
                  <PresetButton label="Ano passado" onClick={() => applyPresetPeriod('lastYear')} />
                  <PresetButton label="Todos os períodos" onClick={clearPeriodFilter} />
                </div>

                <div className="grid grid-cols-2 gap-2 mt-5">
                  <ModalActionButton
                    icon={<Check size={16} />}
                    label="OK"
                    onClick={applyPeriod}
                    disabled={tempDateFrom > tempDateTo}
                  />
                  <ModalActionButton
                    icon={<X size={16} />}
                    label="Cancelar"
                    onClick={() => setIsPeriodModalOpen(false)}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      <PaymentModal
        isOpen={isPaymentModalOpen}
        onClose={() => {
          if (isFinalizingPayment) return;
          setIsPaymentModalOpen(false);
          resetPaymentState();
        }}
        selectedCustomer={
          selectedOrder?.customer_id
            ? {
                id: String(selectedOrder.customer_id),
                name: getCustomerName(selectedOrder),
                phone: '',
              }
            : null
        }
        customerName={selectedOrder ? getCustomerName(selectedOrder) : ''}
        tableNumber=""
        cart={paymentCart}
        globalDiscount={null}
        originalTotal={paymentTotals.total}
        subtotal={paymentTotals.subtotal}
        tax={paymentTotals.tax}
        totalDiscount={0}
        total={paymentTotals.total}
        paymentMethods={paymentMethods}
        isMultiplePayment={isMultiplePayment}
        onToggleMultiplePayment={() => {
          setIsMultiplePayment((prev) => !prev);
          setPayments([]);
          setPaymentMethod(null);
          setReceivedAmount('');
        }}
        paymentMethod={paymentMethod}
        setPaymentMethod={setPaymentMethod}
        receivedAmount={receivedAmount}
        setReceivedAmount={setReceivedAmount}
        payments={payments}
        setPayments={setPayments}
        multiplePaymentMethod={multiplePaymentMethod}
        setMultiplePaymentMethod={setMultiplePaymentMethod}
        multiplePaymentAmount={multiplePaymentAmount}
        setMultiplePaymentAmount={setMultiplePaymentAmount}
        onFinalize={() => void handleFinalizeDocumentPayment()}
        isFinalizing={isFinalizingPayment}
        finalizeError={paymentFinalizeError}
        isReceiptPrintEnabled={false}
        onToggleReceiptPrint={() => undefined}
        formatPrice={formatMoney}
        docType={selectedDocType === 'FTF' ? 'FTF' : 'FT'}
        title="Finalizar Pagamento"
        contextLabel={selectedOrder?.document_number ? `Doc: ${selectedOrder.document_number}` : 'Documento'}
        hideReceiptPrint
      />

      <SupplierDebitNoteModal
        isOpen={isDebitNoteModalOpen}
        onClose={() => setIsDebitNoteModalOpen(false)}
        sourceOrders={orders}
        itemsByOrderId={itemsByOrderId}
        onSaved={(result) => {
          setActionMessage(
            result.documentNumber
              ? `Nota de débito ${result.documentNumber} criada.`
              : 'Nota de débito criada.',
          );
          void fetchData();
        }}
      />

    </div>
  );
}

function DocumentStatusBadge({
  label,
  className,
  hint,
}: {
  label: string;
  className: string;
  hint?: string;
}) {
  if (!hint) {
    return <span className={`px-2 py-0.5 rounded text-[10px] font-semibold ${className}`}>{label}</span>;
  }

  return (
    <span className="relative inline-flex group/status">
      <span className={`px-2 py-0.5 rounded text-[10px] font-semibold ${className}`}>{label}</span>
      <span className="pointer-events-none absolute left-1/2 top-full z-50 mt-2 -translate-x-1/2 whitespace-nowrap rounded-md border border-[#0001fb]/30 bg-[rgba(0,1,251,0.35)] px-3 py-1.5 text-[11px] font-medium text-zinc-100 opacity-0 shadow-xl transition-all duration-150 group-hover/status:translate-y-0 group-hover/status:opacity-100">
        {hint}
      </span>
    </span>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: string[];
}) {
  return (
    <PosSelect
      label={label}
      value={value}
      onChange={onChange}
      size="sm"
      options={options.map((option) => ({
        value: option,
        label: option === 'all' ? 'Todos' : option,
      }))}
    />
  );
}

function Th({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <th className={`px-3 py-2 text-left text-xs font-bold text-zinc-300 whitespace-nowrap ${className}`}>
      {children}
    </th>
  );
}

function Td({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-3 py-2 text-xs text-zinc-200 whitespace-nowrap ${className}`}>{children}</td>;
}

function ModalActionButton({
  icon,
  label,
  onClick,
  disabled,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="flex min-h-11 items-center justify-center gap-2 rounded-[0.4rem] border border-zinc-700 bg-[#131314] px-3 py-3 text-white transition-colors hover:border-[#0001fb] hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40"
    >
      {icon}
      <span className="text-sm">{label}</span>
    </button>
  );
}

function PresetButton({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="min-h-11 rounded-[0.4rem] border border-zinc-700 bg-[#1a1a1a] px-3 py-3 text-sm text-white transition-colors hover:border-[#0001fb] hover:bg-zinc-800"
    >
      {label}
    </button>
  );
}

function CalendarGrid({
  monthValue,
  selectedValue,
  onSelect,
}: {
  monthValue: string;
  selectedValue: string;
  onSelect: (value: string) => void;
}) {
  const weekDays = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];
  const days = buildCalendarDays(monthValue);
  const todayValue = todayInput();

  return (
    <div>
      <div className="mb-2 grid grid-cols-7 gap-1">
        {weekDays.map((day) => (
          <div
            key={day}
            className="flex h-7 min-w-0 items-center justify-center text-[11px] font-semibold uppercase tracking-wide text-zinc-400"
          >
            {day}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {days.map((day) => {
          const isSelected = day.value === selectedValue;
          const isToday = day.value === todayValue;
          return (
            <button
              key={day.value}
              onClick={() => onSelect(day.value)}
              className={`flex aspect-square w-full min-w-0 items-center justify-center rounded-xl text-sm transition-colors ${
                isSelected
                  ? 'bg-[#0001fb] text-white scale-110'
                  : isToday
                    ? 'border border-[#0001fb]/70 text-white'
                    : day.inMonth
                      ? 'text-white hover:bg-zinc-700'
                      : 'text-zinc-500 hover:bg-zinc-800'
              }`}
            >
              {day.day}
            </button>
          );
        })}
      </div>
    </div>
  );
}
