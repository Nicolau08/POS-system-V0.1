'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Calendar, CalendarDays, Check, ChevronLeft, ChevronRight, ChevronsUpDown, Edit3, Printer, Trash2, Users, Truck, X } from 'lucide-react';
import { getPosApiBase } from '@/lib/apiBase';
import { unwrapApiSuccessPayload } from '@/lib/apiResponse';
import { getPosTaxPercentLabel, getPosTaxRate } from '@/lib/taxConfig';

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
  product_name?: string | null;
  quantity?: number | null;
  unit?: string | null;
  price?: number | null;
  tax_rate?: number | null;
  total?: number | null;
};

const REGISTERED_DOCUMENT_TYPES = ['VD', 'TK', 'FP'] as const;
const EDIT_DRAFT_STORAGE_KEY = 'management:edit-document-draft';
const DOCS_VIEW_STATE_STORAGE_KEY = 'management:documents-view-state';

type DocumentsViewState = {
  selectedOrderId: string | null;
  query: string;
  selectedProduct: string;
  selectedClient: string;
  selectedUser: string;
  selectedDocType: string;
  selectedStatus: string;
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
    selectedDocType: 'all',
    selectedStatus: 'all',
    dateFrom: todayInput(),
    dateTo: todayInput(),
  };
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(DOCS_VIEW_STATE_STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<DocumentsViewState>;
    return {
      selectedOrderId: parsed.selectedOrderId == null ? null : String(parsed.selectedOrderId),
      query: String(parsed.query ?? ''),
      selectedProduct: String(parsed.selectedProduct ?? 'all'),
      selectedClient: String(parsed.selectedClient ?? 'all'),
      selectedUser: String(parsed.selectedUser ?? 'all'),
      selectedDocType: String(parsed.selectedDocType ?? 'all'),
      selectedStatus: String(parsed.selectedStatus ?? 'all'),
      dateFrom: String(parsed.dateFrom ?? fallback.dateFrom),
      dateTo: String(parsed.dateTo ?? fallback.dateTo),
    };
  } catch {
    return fallback;
  }
}

function resolveManagementDocumentTitle(order: OrderRow) {
  const rawDocType = String(order.doc_type ?? '').trim();
  const rawDocTypeUpper = rawDocType.toUpperCase();
  const number = String(order.document_number ?? '').trim().toUpperCase();

  if (rawDocType) {
    if (rawDocTypeUpper === 'VD' || rawDocTypeUpper === 'VENDA') return 'Venda a dinheiro';
    if (rawDocTypeUpper === 'FP') return 'Fatura proforma';
    if (rawDocTypeUpper === 'FR') return 'Fatura-recibo';
    if (rawDocTypeUpper === 'FT' || rawDocTypeUpper === 'FATURA') return 'Fatura';
    if (rawDocTypeUpper === 'RC' || rawDocTypeUpper === 'RECIBO') return 'Recibo';
    if (rawDocTypeUpper === 'NC') return 'Nota de crédito';
    if (rawDocTypeUpper === 'ND') return 'Nota de debito';
    if (rawDocTypeUpper === 'GT') return 'Guia de transporte';
    if (rawDocTypeUpper === 'GR') return 'Guia de remessa';
    if (rawDocType.toLowerCase().includes('entrada de stock')) return 'Entrada de stock';
    return rawDocType;
  }

  if (number.startsWith('WH/IN/')) return 'Entrada de stock';
  return 'Fatura';
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

function formatMoney(value: number | null | undefined) {
  const amount = Number(value ?? 0);
  return new Intl.NumberFormat('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount);
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
  return new Date(`${value}T00:00:00`).toLocaleDateString('en-US', {
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

export default function DocumentsManager() {
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
  const [selectedDocType, setSelectedDocType] = useState(initialViewState.selectedDocType);
  const [selectedStatus, setSelectedStatus] = useState(initialViewState.selectedStatus);
  const [dateFrom, setDateFrom] = useState(initialViewState.dateFrom);
  const [dateTo, setDateTo] = useState(initialViewState.dateTo);
  const [tempDateFrom, setTempDateFrom] = useState(initialViewState.dateFrom || firstDayOfCurrentMonth());
  const [tempDateTo, setTempDateTo] = useState(initialViewState.dateTo || todayInput());
  const [calendarStartMonth, setCalendarStartMonth] = useState(`${(initialViewState.dateFrom || firstDayOfCurrentMonth()).slice(0, 7)}-01`);
  const [calendarEndMonth, setCalendarEndMonth] = useState(`${(initialViewState.dateTo || todayInput()).slice(0, 7)}-01`);
  const [isPeriodModalOpen, setIsPeriodModalOpen] = useState(false);
  const [partyView, setPartyView] = useState<'clientes' | 'fornecedores' | null>(null);
  const [openPartyMenu, setOpenPartyMenu] = useState<'clientes' | 'fornecedores' | null>(null);
  const [partyMenuPosition, setPartyMenuPosition] = useState<{ left: number; top: number } | null>(null);

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
      dateFrom,
      dateTo,
    };
    window.localStorage.setItem(DOCS_VIEW_STATE_STORAGE_KEY, JSON.stringify(viewState));
  }, [selectedOrderId, query, selectedProduct, selectedClient, selectedUser, selectedDocType, selectedStatus, dateFrom, dateTo]);

  const productOptions = useMemo(() => {
    return registeredProductNames;
  }, [registeredProductNames]);

  const clientOptions = useMemo(() => {
    return registeredClientNames;
  }, [registeredClientNames]);

  const userOptions = useMemo(() => {
    return registeredUserNames;
  }, [registeredUserNames]);

  const docTypeOptions = useMemo(() => {
    const set = new Set<string>();
    REGISTERED_DOCUMENT_TYPES.forEach((doc) => set.add(doc));
    orders.forEach((order) => {
      const doc = String(order.doc_type || '').trim();
      if (doc) set.add(doc);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [orders]);

  const filteredOrders = useMemo(() => {
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
      if (dateFrom && orderDate && orderDate < dateFrom) return false;
      if (dateTo && orderDate && orderDate > dateTo) return false;

      if (selectedClient !== 'all' && customerName !== selectedClient) return false;
      if (selectedUser !== 'all' && userName !== selectedUser) return false;
      if (selectedDocType !== 'all') {
        if (selectedDocType === 'FP') {
          if (!isQuotationOrProformaDocType(docType)) return false;
        } else if (docType !== selectedDocType) {
          return false;
        }
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

  useEffect(() => {
    const handleOutsideClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      if (target.closest('[data-party-trigger]') || target.closest('[data-party-dropdown]')) return;
      setOpenPartyMenu(null);
    };
    window.addEventListener('mousedown', handleOutsideClick);
    return () => window.removeEventListener('mousedown', handleOutsideClick);
  }, []);

  useEffect(() => {
    const closeMenu = () => setOpenPartyMenu(null);
    window.addEventListener('resize', closeMenu);
    window.addEventListener('scroll', closeMenu, true);
    return () => {
      window.removeEventListener('resize', closeMenu);
      window.removeEventListener('scroll', closeMenu, true);
    };
  }, []);

  const selectedItems = useMemo(() => {
    if (!selectedOrderId) return [];
    return itemsByOrderId[selectedOrderId] ?? [];
  }, [itemsByOrderId, selectedOrderId]);

  const handleClearFilters = () => {
    setQuery('');
    setSelectedProduct('all');
    setSelectedClient('all');
    setSelectedUser('all');
    setSelectedDocType('all');
    setSelectedStatus('all');
    setDateFrom(todayInput());
    setDateTo(todayInput());
  };

  const openPeriodModal = () => {
    const start = dateFrom || todayInput();
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
    setPartyView(null);
    setOpenPartyMenu(null);
  };

  const handleEditOrderById = (orderId: string | null) => {
    if (!orderId) return;
    const selectedOrder = filteredOrders.find((order) => String(order.id) === orderId);
    if (!selectedOrder) return;
    const selectedOrderItems = itemsByOrderId[String(selectedOrder.id)] ?? [];
    const createdAt = String(selectedOrder.created_at ?? '').slice(0, 10);
    const normalizedDate = createdAt || todayInput();
    const payload = {
      source: String(selectedOrder.id).startsWith('venda:') ? 'sale' : 'order',
      sourceId: String(selectedOrder.id).replace(/^venda:/, ''),
      returnTabId: 'docs',
      title: resolveManagementDocumentTitle(selectedOrder),
      documentNumber: String(selectedOrder.document_number ?? ''),
      documentDate: normalizedDate,
      dueDate: normalizedDate,
      paid: String(selectedOrder.status ?? '').toLowerCase() === 'completed',
      customerId: selectedOrder.customer_id == null ? '' : String(selectedOrder.customer_id),
      items: selectedOrderItems.map((item, index) => ({
        rowId: `${String(item.id ?? index)}-${index}`,
        productId: String(item.id ?? index),
        code: String(index + 1),
        name: String(item.product_name ?? '-'),
        unit: String(item.unit ?? 'UN').toUpperCase(),
        quantity: Number(item.quantity ?? 0) || 0,
        unitPrice: Number(item.price ?? 0) || 0,
        tax: 0,
        taxCode: 'IVA',
        taxRate: Number(item.tax_rate ?? 0) || 0,
        taxUiEnabled: false,
        discountType: 'percent',
        discountValue: 0,
        expirationDate: '',
      })),
    };

    if (typeof window !== 'undefined') {
      window.localStorage.setItem(EDIT_DRAFT_STORAGE_KEY, JSON.stringify(payload));
      window.dispatchEvent(
        new CustomEvent('management:navigate-tab', {
          detail: { tabId: 'gerenciamento', preserveSidebarSelection: true },
        })
      );
    }
  };

  const handleEditSelectedOrder = () => {
    handleEditOrderById(selectedOrderId);
  };

  return (
    <div
      className="flex h-full flex-col bg-[#1a1a1a] text-zinc-300 overflow-x-hidden overflow-y-visible"
      onClick={handleScreenClickToDeselect}
    >
      <div className="relative z-40 h-16 bg-[#1a1a1a] border-b border-zinc-800 px-2 overflow-visible">
        <div className="h-full flex items-center gap-1 overflow-x-auto overflow-y-visible no-scrollbar">
          <ToolbarButton icon={<Edit3 size={20} />} label="Editar" onClick={handleEditSelectedOrder} />
          <ToolbarButton icon={<Trash2 size={20} />} label="Deletar" />
          <ToolbarButton icon={<Printer size={20} />} label="Imprimir" />
          <div data-party-trigger>
            <ToolbarButton
              icon={<Users size={20} />}
              label="Clientes"
              active={partyView === 'clientes'}
              onClick={(event) => {
                const rect = event.currentTarget.getBoundingClientRect();
                setPartyView('clientes');
                setPartyMenuPosition({ left: rect.left, top: rect.bottom + 2 });
                setOpenPartyMenu((current) => (current === 'clientes' ? null : 'clientes'));
              }}
            />
          </div>
          <div data-party-trigger>
            <ToolbarButton
              icon={<Truck size={20} />}
              label="Fornecedores"
              active={partyView === 'fornecedores'}
              onClick={(event) => {
                const rect = event.currentTarget.getBoundingClientRect();
                setPartyView('fornecedores');
                setPartyMenuPosition({ left: rect.left, top: rect.bottom + 2 });
                setOpenPartyMenu((current) => (current === 'fornecedores' ? null : 'fornecedores'));
              }}
            />
          </div>
        </div>
      </div>

      {openPartyMenu && partyMenuPosition && (
        <PartyDropdownMenu
          left={partyMenuPosition.left}
          top={partyMenuPosition.top}
          items={
            openPartyMenu === 'clientes'
              ? ['Venda a dinheiro', 'Fatura', 'Notas de crédito', 'Recibo', 'Cotações']
              : ['Contas', 'Reembolsos', 'Pagamentos', 'Pagamentos em lote', 'Despesas do funcionário', 'Produtos', 'Fornecedores']
          }
          onSelect={(item) => {
            if (openPartyMenu === 'clientes') {
              const normalizedItem = item.trim().toLowerCase();
              if (normalizedItem.includes('venda a dinheiro')) {
                setSelectedDocType('VD');
                setSelectedOrderId(null);
              } else if (normalizedItem.includes('cota')) {
                setSelectedDocType('FP');
                setSelectedOrderId(null);
              }
            }
            setOpenPartyMenu(null);
          }}
        />
      )}

      <div className="relative z-10 border-b border-zinc-800 bg-[#181818] px-3 py-2">
        <div className="space-y-2">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2 max-w-[980px]">
            <FilterSelect label="Produto" value={selectedProduct} onChange={setSelectedProduct} options={['all', ...productOptions]} />
            <FilterSelect label="Usuário" value={selectedUser} onChange={setSelectedUser} options={['all', ...userOptions]} />
            <FilterSelect label="Cliente" value={selectedClient} onChange={setSelectedClient} options={['all', ...clientOptions]} />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-2 max-w-[980px]">
            <FilterSelect label="Tipo de documento" value={selectedDocType} onChange={setSelectedDocType} options={['all', ...docTypeOptions]} />
            <FilterSelect
              label="Status de pgto"
              value={selectedStatus}
              onChange={setSelectedStatus}
              options={['all', 'completed', 'pending', 'approved', 'cancelled']}
            />
            <div>
              <label className="block text-[11px] text-zinc-400 mb-1">Período</label>
              <button
                onClick={openPeriodModal}
                className="w-full h-8 bg-[#121212] border border-zinc-700 rounded px-3 flex items-center gap-2 hover:bg-zinc-800 hover:border-zinc-600 transition-colors"
              >
                <CalendarDays size={14} className="text-zinc-400 shrink-0" />
                <span className="text-xs text-zinc-200 font-medium flex-1 text-center whitespace-nowrap">
                  {`${formatInputDateLabel(dateFrom)} - ${formatInputDateLabel(dateTo)}`}
                </span>
              </button>
            </div>
          </div>
        </div>

      </div>

      <div className="flex-1 min-h-0 flex flex-col">
        <div className="min-h-0 flex-1 border-b border-zinc-800">
          <div
            className="h-full overflow-auto custom-scrollbar"
            onClick={() => setSelectedOrderId(null)}
          >
            <table className="w-full min-w-[980px] text-xs border-collapse">
              <thead className="sticky top-0 z-10 bg-[#1f1f1f]">
                <tr className="text-zinc-400">
                  <Th>Número</Th>
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
                    <td colSpan={10} className="px-3 py-8 text-center text-zinc-500">
                      Carregando documentos...
                    </td>
                  </tr>
                ) : filteredOrders.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="px-3 py-8 text-center text-zinc-500">
                      {'Sem documentos para os filtros selecionados.'}
                    </td>
                  </tr>
                ) : (
                  filteredOrders.map((row) => {
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
                    const approvedReferenceNumber = String(row.approved_document_number ?? '').trim();
                    const approvedReferenceType = String(row.approved_document_type ?? '').trim().toUpperCase();
                    const approvedReference =
                      approvedReferenceNumber ||
                      (approvedReferenceType ? `${approvedReferenceType}` : '');
                    const settled = paid || approved;
                    const due = dueDateMeta(row.created_at, row.doc_type);
                    const dueClass = settled
                      ? 'text-zinc-200'
                      : due.tone === 'expired'
                        ? 'text-red-400'
                        : due.tone === 'warning'
                          ? 'text-amber-300'
                          : 'text-zinc-300';
                    const statusLabel = approved
                      ? 'Aprovado'
                      : paid
                        ? 'Pago'
                        : isQuotationOrProforma
                          ? 'Lançado'
                          : 'Não pago';
                    const statusDisplay = approved && approvedReference ? `${statusLabel} · ${approvedReference}` : statusLabel;
                    const statusClass = approved
                      ? 'bg-blue-600 text-white'
                      : paid
                        ? 'bg-green-600 text-white'
                        : 'bg-red-600 text-white';
                    return (
                      <tr
                        key={rowId}
                        onClick={(event) => {
                          event.stopPropagation();
                          setSelectedOrderId(rowId);
                        }}
                        onDoubleClick={(event) => {
                          event.stopPropagation();
                          handleEditOrderById(rowId);
                        }}
                        className={`border-b border-zinc-800/70 cursor-pointer transition-colors ${
                          selected ? 'bg-zinc-800/70' : 'hover:bg-zinc-800/40'
                        }`}
                      >
                        <Td>{row.document_number || `DOC-${rowId}`}</Td>
                        <Td>{getCustomerName(row)}</Td>
                        <Td>{formatInvoiceShortDate(row.created_at)}</Td>
                        <Td className={dueClass}>{due.label}</Td>
                        <Td className="text-right">{formatMoney(Number(row.subtotal ?? (Number(row.total ?? 0) - Number(row.tax ?? 0))))}</Td>
                        <Td className="text-right font-semibold text-zinc-100">{formatMoney(row.total)}</Td>
                        <Td className={`text-right ${settled ? 'text-zinc-400' : 'text-rose-300'}`}>
                          {formatMoney(settled ? 0 : Number(row.total ?? 0))}
                        </Td>
                        <Td>
                          <span className={`px-2 py-0.5 rounded text-[10px] font-semibold ${statusClass}`}>
                            {statusDisplay}
                          </span>
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
          <div className="h-full overflow-auto custom-scrollbar">
            <div className="px-3 py-2 border-b border-zinc-800 bg-[#171717] text-xs text-zinc-400">
              Itens do documento ({selectedItems.length})
            </div>
            <table className="w-full min-w-[900px] text-xs border-collapse">
              <thead className="sticky top-0 z-10 bg-[#1f1f1f]">
                <tr className="text-zinc-400">
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
                      Selecione um documento para ver os itens.
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
                      <tr key={String(item.id)} className="border-b border-zinc-800/70 hover:bg-zinc-800/30">
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

      {isPeriodModalOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/70 backdrop-blur-[2px] flex items-center justify-center p-6"
          onClick={() => setIsPeriodModalOpen(false)}
        >
          <div
            className="w-full max-w-[820px] bg-[#1f1f1f] border border-zinc-700 rounded shadow-2xl overflow-hidden"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="px-6 py-5 text-center">
              <h3 className="text-[18px] text-white">Período</h3>
              <div className="mt-4 inline-flex items-center rounded border border-zinc-700 bg-[#1a1a1a] px-4 py-2 text-white font-bold">
                {formatInputDateLabel(tempDateFrom)} - {formatInputDateLabel(tempDateTo)}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_280px] gap-6 p-6">
              <div>
                <p className="text-sm text-zinc-100 mb-3 text-center">Início</p>
                <div className="mx-auto max-w-[260px] bg-[#1a1a1a] border border-zinc-700 rounded p-4">
                  <div className="flex items-center justify-between px-1 pb-4">
                    <button
                      onClick={() => setCalendarStartMonth(shiftMonth(calendarStartMonth, -1))}
                      className="p-1 rounded text-zinc-300 hover:text-white hover:bg-zinc-800 transition-colors"
                    >
                      <ChevronLeft size={16} />
                    </button>
                    <div className="text-white font-bold">{monthLabel(calendarStartMonth)}</div>
                    <button
                      onClick={() => setCalendarStartMonth(shiftMonth(calendarStartMonth, 1))}
                      className="p-1 rounded text-zinc-300 hover:text-white hover:bg-zinc-800 transition-colors"
                    >
                      <ChevronRight size={16} />
                    </button>
                  </div>
                  <CalendarGrid monthValue={calendarStartMonth} selectedValue={tempDateFrom} onSelect={setTempDateFrom} />
                </div>
              </div>

              <div>
                <p className="text-sm text-zinc-100 mb-3 text-center">Fim</p>
                <div className="mx-auto max-w-[260px] bg-[#1a1a1a] border border-zinc-700 rounded p-4">
                  <div className="flex items-center justify-between px-1 pb-4">
                    <button
                      onClick={() => setCalendarEndMonth(shiftMonth(calendarEndMonth, -1))}
                      className="p-1 rounded text-zinc-300 hover:text-white hover:bg-zinc-800 transition-colors"
                    >
                      <ChevronLeft size={16} />
                    </button>
                    <div className="text-white font-bold">{monthLabel(calendarEndMonth)}</div>
                    <button
                      onClick={() => setCalendarEndMonth(shiftMonth(calendarEndMonth, 1))}
                      className="p-1 rounded text-zinc-300 hover:text-white hover:bg-zinc-800 transition-colors"
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
    </div>
  );
}

function ToolbarButton({
  icon,
  label,
  onClick,
  active,
}: {
  icon: React.ReactNode;
  label: string;
  onClick?: (event: React.MouseEvent<HTMLButtonElement>) => void;
  active?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex flex-col items-center justify-center min-w-[80px] py-2 px-2 rounded transition-all hover:bg-zinc-800 group ${
        active ? 'bg-zinc-800 text-white' : 'text-zinc-400'
      }`}
    >
      <div className="mb-1 group-hover:scale-110 transition-transform">{icon}</div>
      <span className="text-[11px] font-bold text-center leading-none capitalize tracking-tighter">{label}</span>
    </button>
  );
}

function PartyDropdownMenu({
  left,
  top,
  items,
  onSelect,
}: {
  left: number;
  top: number;
  items: string[];
  onSelect: (item: string) => void;
}) {
  return (
    <div
      data-party-dropdown
      className="fixed z-[9999] min-w-[190px] rounded border border-zinc-700 bg-[#1a1a1a] p-2 shadow-2xl"
      style={{ left, top }}
    >
      {items.map((item) => (
        <button
          key={item}
          type="button"
          onClick={() => onSelect(item)}
          className="block w-full rounded px-3 py-1.5 text-left text-[13px] text-zinc-300 hover:bg-zinc-800"
        >
          {item}
        </button>
      ))}
    </div>
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
    <div>
      <label className="block text-[11px] text-zinc-400 mb-1">{label}</label>
      <div className="relative">
        <select
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onClick={(event) => {
            const target = event.currentTarget as HTMLSelectElement & { showPicker?: () => void };
            target.showPicker?.();
          }}
          className="w-full h-8 appearance-none cursor-pointer bg-[#121212] border border-zinc-700 rounded px-2 pr-8 text-xs text-zinc-200 outline-none focus:border-blue-500"
        >
          {options.map((option) => (
            <option key={option} value={option}>
              {option === 'all' ? `Todos` : option}
            </option>
          ))}
        </select>
        <ChevronsUpDown
          size={13}
          className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-zinc-500"
        />
      </div>
    </div>
  );
}

function Th({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <th className={`border-b border-r border-zinc-700/80 px-4 py-2.5 text-left font-medium whitespace-nowrap last:border-r-0 ${className}`}>
      {children}
    </th>
  );
}

function Td({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <td className={`border-r border-zinc-800/80 px-4 py-2.5 whitespace-nowrap last:border-r-0 ${className}`}>{children}</td>;
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
      className="flex items-center justify-center gap-2 min-h-11 px-3 py-3 border rounded text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed border-zinc-700 bg-[#131314] hover:bg-zinc-800 hover:border-zinc-600"
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
      className="min-h-11 px-3 py-3 border border-zinc-700 rounded bg-[#1a1a1a] text-white text-sm hover:bg-zinc-800 hover:border-zinc-600 transition-colors"
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
  const weekDays = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
  const days = buildCalendarDays(monthValue);
  const todayValue = todayInput();

  return (
    <div>
      <div className="grid grid-cols-7 gap-2 mb-3">
        {weekDays.map((day) => (
          <div key={day} className="text-center text-sm font-bold text-white py-1">
            {day}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-2">
        {days.map((day) => {
          const isSelected = day.value === selectedValue;
          const isToday = day.value === todayValue;
          return (
            <button
              key={day.value}
              onClick={() => onSelect(day.value)}
              className={`w-full aspect-square rounded-xl text-sm transition-colors flex items-center justify-center ${
                isSelected
                  ? 'bg-emerald-500 text-white scale-110'
                  : isToday
                    ? 'border border-emerald-500/70 text-white'
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
