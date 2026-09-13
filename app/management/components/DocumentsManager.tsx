'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Ban, Banknote, Calendar, CalendarDays, Check, ChevronLeft, ChevronRight, FileMinus2, FileSpreadsheet, PackagePlus, Printer, RefreshCcw, X } from 'lucide-react';
import { getPosApiBase, getPosUserAuthHeaders } from '@/lib/apiBase';
import { extractApiErrorMessage, unwrapApiSuccessPayload } from '@/lib/apiResponse';
import { formatDocumentReferenceDisplay } from '@/lib/documents/documentReference';
import { formatPaymentMethodLabel } from '@/lib/paymentMethodLabel';
import { saveSalesDocumentAsPdf } from '@/lib/documents/salesDocumentPrint';
import { printSalesDocumentThermalSecondCopy } from '@/lib/documents/thermalReceiptPrint';
import { fetchCompanyProfile, fetchPaymentMethods } from '@/lib/services/posService';
import { usePermissions } from '@/hooks/usePermissions';
import { ConfirmDialog } from '@/app/pos/components/ConfirmDialog';
import type {
  CartItem,
  CompanyProfile,
  PaymentEntry,
  PaymentMethod,
  PaymentMethodOption,
} from '@/app/pos/types';
import { ManagementToolbarButton, ManagementToolbarDivider } from '@/components/ManagementToolbarButton';
import type { DocumentsPartyKind } from '@/app/management/documentsMenu';
import { PaymentModal } from '@/app/pos/components/PaymentModal';
import { SupplierDebitNoteModal } from '@/app/management/components/SupplierDebitNoteModal';
import PurchaseStockModal, {
  type DocumentCreatePrefix,
  type PurchaseProductOption,
} from '@/app/management/components/PurchaseStockModal';
import {
  CREATE_DOC_BUTTONS,
  DEFAULT_TAX_RATE_LABEL,
  DEFAULT_TAX_RATE_PERCENT,
  DOCS_VIEW_STATE_STORAGE_KEY,
  customerInvoiceIsFullyPaid,
  customerInvoiceOutstanding,
  dueDateMeta,
  firstDayOfCurrentMonth,
  formatInputDateLabel,
  formatInvoiceShortDate,
  formatMoney,
  isQuotationOrProformaDocType,
  loadDocumentsViewState,
  monthLabel,
  resolveOrderDocTypeFilterCode,
  shiftMonth,
  supplierInvoiceOutstanding,
  toDateInput,
  todayInput,
  type DocumentsViewState,
  type OrderItemRow,
  type OrderRow,
} from './documentsManager.helpers';
import {
  CalendarGrid,
  DocumentStatusBadge,
  FilterSelect,
  ModalActionButton,
  PresetButton,
  Td,
  Th,
} from './documentsManager.parts';

export default function DocumentsManager({
  externalDocType,
  externalPartyKind,
}: {
  externalDocType?: string | null;
  externalPartyKind?: DocumentsPartyKind | null;
} = {}) {
  const { can } = usePermissions();
  const canAnularVd = can('vendas.anular_vd', 5);
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
  const [isCreditNoteModalOpen, setIsCreditNoteModalOpen] = useState(false);
  const [isPurchaseOpen, setIsPurchaseOpen] = useState(false);
  const [isAnullingVd, setIsAnullingVd] = useState(false);
  const [isAnularConfirmOpen, setIsAnularConfirmOpen] = useState(false);
  const [purchaseProducts, setPurchaseProducts] = useState<PurchaseProductOption[]>([]);
  const [saleProducts, setSaleProducts] = useState<PurchaseProductOption[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethodOption[]>([]);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | null>(null);
  const [receivedAmount, setReceivedAmount] = useState('');
  const [partialPaymentAmount, setPartialPaymentAmount] = useState('');
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
      setIsPurchaseOpen(false);
      return;
    }
    setSelectedDocType(externalDocType);
    setSelectedOrderId(null);
    setIsPurchaseOpen(false);
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
      const authHeaders = getPosUserAuthHeaders();
      const [ordersRes, salesRes, itemsRes, usersRes, clientsRes, productsRes] = await Promise.all([
        fetch(`${getPosApiBase()}/documentos`, { headers: { ...authHeaders } }),
        fetch(`${getPosApiBase()}/vendas`, { headers: { ...authHeaders } }),
        fetch(`${getPosApiBase()}/documentos-itens`, { headers: { ...authHeaders } }),
        fetch(`${getPosApiBase()}/users`, { headers: { ...authHeaders } }),
        fetch(`${getPosApiBase()}/clientes`, { headers: { ...authHeaders } }),
        fetch(`${getPosApiBase()}/produtos`, { headers: { ...authHeaders } }),
      ]);
      if (!ordersRes.ok) throw new Error(`Falha ao carregar documentos (${ordersRes.status})`);
      if (!salesRes.ok) throw new Error(`Falha ao carregar vendas (${salesRes.status})`);
      if (!itemsRes.ok) throw new Error(`Falha ao carregar itens (${itemsRes.status})`);
      if (!clientsRes.ok) throw new Error(`Falha ao carregar clientes (${clientsRes.status})`);
      if (!productsRes.ok) throw new Error(`Falha ao carregar produtos (${productsRes.status})`);
      // /users exige admin — sem isso o filtro de utilizador fica vazio, mas os documentos carregam.

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

      const usersData = usersRes.ok
        ? (unwrapApiSuccessPayload<
            Array<{ name?: string | null; surname?: string | null; active?: boolean | number | null }>
          >(await usersRes.json()) ?? [])
        : [];
      if (!usersRes.ok) {
        // Descarta o body de erro para não bloquear o resto do fluxo.
        void usersRes.json().catch(() => null);
      }
      const clientsData = (unwrapApiSuccessPayload<Array<{ name?: string | null }>>(await clientsRes.json()) ?? []);
      const productsData = (unwrapApiSuccessPayload<
        Array<{
          id?: string | number | null;
          name?: string | null;
          code?: number | null;
          cost?: number | null;
          price?: number | null;
          unit?: string | null;
          stock_quantity?: number | null;
          track_lot?: boolean | number | null;
          tax_rate_id?: string | null;
          is_service?: boolean | number | null;
          product_kind?: string | null;
          active?: boolean | number | null;
        }>
      >(await productsRes.json()) ?? []);

      const productNames = Array.from(
        new Set(
          productsData
            .map((item) => String(item?.name ?? '').trim())
            .filter(Boolean)
        )
      ).sort((a, b) => a.localeCompare(b));
      setRegisteredProductNames(productNames);

      setPurchaseProducts(
        productsData
          .filter((p) => {
            if (p?.active === 0 || p?.active === false) return false;
            if (p?.is_service === true || Number(p?.is_service) === 1) return false;
            const kind = String(p?.product_kind ?? 'simple');
            return kind !== 'composed' && kind !== 'service';
          })
          .map((p) => ({
            id: String(p.id ?? ''),
            name: String(p.name ?? '').trim() || 'Produto',
            code: p.code != null ? Number(p.code) : undefined,
            cost: Number(p.cost ?? 0) || 0,
            price: Number(p.price ?? 0) || 0,
            unit: p.unit != null ? String(p.unit) : undefined,
            stock_quantity: Number(p.stock_quantity ?? 0) || 0,
            track_lot: Boolean(p.track_lot),
            tax_rate_id: p.tax_rate_id != null ? String(p.tax_rate_id) : null,
          }))
          .filter((p) => Boolean(p.id)),
      );

      setSaleProducts(
        productsData
          .filter((p) => p?.active !== 0 && p?.active !== false)
          .map((p) => ({
            id: String(p.id ?? ''),
            name: String(p.name ?? '').trim() || 'Produto',
            code: p.code != null ? Number(p.code) : undefined,
            cost: Number(p.cost ?? 0) || 0,
            price: Number(p.price ?? 0) || 0,
            unit: p.unit != null ? String(p.unit) : undefined,
            stock_quantity: Number(p.stock_quantity ?? 0) || 0,
            track_lot: Boolean(p.track_lot),
            tax_rate_id: p.tax_rate_id != null ? String(p.tax_rate_id) : null,
          }))
          .filter((p) => Boolean(p.id)),
      );

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
      const paymentMethod = formatPaymentMethodLabel(order.payment_method);
      const paymentMethodRaw = String(order.payment_method || '-');
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
        paymentMethodRaw.toLowerCase().includes(normalizedQuery) ||
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
  const showCreateCreditNoteAction = selectedDocType === 'FT';
  const showAnularVdAction = selectedDocType === 'VD' && canAnularVd;
  const createDocPrefix =
    selectedDocType === 'FTF' ||
    selectedDocType === 'FP' ||
    selectedDocType === 'FT' ||
    selectedDocType === 'VD'
      ? (selectedDocType as DocumentCreatePrefix)
      : null;
  const showCreateDocumentAction = Boolean(createDocPrefix);
  const createDocButton = createDocPrefix ? CREATE_DOC_BUTTONS[createDocPrefix] : null;

  const outstandingTotal = useMemo(() => {
    if (selectedDocType !== 'FTF' && selectedDocType !== 'FT') return 0;
    return filteredOrders.reduce((sum, row) => {
      if (selectedDocType === 'FT') {
        return sum + customerInvoiceOutstanding(row);
      }
      const rowStatus = String(row.status || '').toLowerCase();
      const paid = rowStatus === 'completed' || rowStatus === 'pago';
      const approved = rowStatus === 'approved' || rowStatus === 'aprovado';
      const settled =
        paid || approved || Boolean(String(row.approved_document_number ?? '').trim());
      if (settled) return sum;
      return sum + supplierInvoiceOutstanding(row);
    }, 0);
  }, [filteredOrders, selectedDocType]);

  const selectedOrderIsPayable = useMemo(() => {
    if (!selectedOrder || !showPayToolbarAction) return false;
    const code = resolveOrderDocTypeFilterCode(selectedOrder);
    if (code !== selectedDocType) return false;
    if (selectedDocType === 'FT') {
      return customerInvoiceOutstanding(selectedOrder) > 0.009;
    }
    const status = String(selectedOrder.status ?? '').toLowerCase();
    if (status === 'completed' || status === 'approved' || status === 'pago') return false;
    if (String(selectedOrder.approved_document_number ?? '').trim()) return false;
    if (selectedDocType === 'FTF' && supplierInvoiceOutstanding(selectedOrder) <= 0.009) return false;
    return true;
  }, [selectedOrder, selectedDocType, showPayToolbarAction]);

  const paymentCart = useMemo<CartItem[]>(() => {
    if (!selectedOrder) return [];
    if (selectedDocType === 'FTF' && Number(selectedOrder.credit_note_total ?? 0) > 0) {
      return [
        {
          id: `doc-${selectedOrder.id}`,
          name: `Saldo de ${String(selectedOrder.document_number ?? 'FTF')}`,
          price: supplierInvoiceOutstanding(selectedOrder),
          category: 'Documento',
          quantity: 1,
        },
      ];
    }
    if (selectedDocType === 'FT') {
      const outstanding = customerInvoiceOutstanding(selectedOrder);
      const alreadyPaid = Number(selectedOrder.receipt_total ?? 0);
      if (alreadyPaid > 0.009 || outstanding < Number(selectedOrder.total ?? 0) - 0.009) {
        return [
          {
            id: `doc-${selectedOrder.id}`,
            name: `Saldo de ${String(selectedOrder.document_number ?? 'FT')}`,
            price: outstanding,
            category: 'Documento',
            quantity: 1,
          },
        ];
      }
    }
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
  }, [selectedDocType, selectedOrder, selectedItems]);

  const paymentTotals = useMemo(() => {
    const originalTotal = Number(selectedOrder?.total ?? 0);
    const total =
      selectedDocType === 'FTF'
        ? supplierInvoiceOutstanding(selectedOrder)
        : selectedDocType === 'FT'
          ? customerInvoiceOutstanding(selectedOrder)
          : originalTotal;
    const originalSubtotal = Number(
      selectedOrder?.subtotal ?? originalTotal - Number(selectedOrder?.tax ?? 0),
    );
    const ratio = originalTotal > 0 ? total / originalTotal : 0;
    const subtotal = originalSubtotal * ratio;
    const tax = Number(selectedOrder?.tax ?? Math.max(0, originalTotal - originalSubtotal)) * ratio;
    return {
      total,
      subtotal: Math.max(0, subtotal),
      tax: Math.max(0, tax),
    };
  }, [selectedDocType, selectedOrder]);

  const resetPaymentState = () => {
    setPaymentMethod(null);
    setReceivedAmount('');
    setPartialPaymentAmount('');
    setPayments([]);
    setIsMultiplePayment(false);
    setMultiplePaymentAmount('');
    setPaymentFinalizeError(null);
  };

  const handleRefresh = () => {
    setActionMessage('');
    void fetchData();
  };

  const selectedOrderIsAnullableVd = useMemo(() => {
    if (!showAnularVdAction || !selectedOrder) return false;
    const status = String(selectedOrder.status ?? '').toLowerCase();
    if (status === 'cancelled' || status === 'canceled' || status === 'void' || status === 'anulado') {
      return false;
    }
    return resolveOrderDocTypeFilterCode(selectedOrder) === 'VD';
  }, [selectedOrder, showAnularVdAction]);

  const handleAnularVd = async () => {
    if (!selectedOrder || !selectedOrderIsAnullableVd || isAnullingVd) return;
    const docNumber = String(selectedOrder.document_number ?? selectedOrder.id).trim();

    setIsAnularConfirmOpen(false);
    setIsAnullingVd(true);
    setActionMessage('');
    try {
      const res = await fetch(
        `${getPosApiBase()}/documentos/${encodeURIComponent(String(selectedOrder.id))}/anular`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...getPosUserAuthHeaders(),
          },
          body: JSON.stringify({}),
        },
      );
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(extractApiErrorMessage(payload, `Falha ao anular VD (${res.status})`));
      }
      setActionMessage(`VD ${docNumber} anulada.`);
      setSelectedOrderId(null);
      await fetchData();
    } catch (error) {
      setActionMessage(error instanceof Error ? error.message : 'Falha ao anular VD.');
    } finally {
      setIsAnullingVd(false);
    }
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

    const remaining = paymentTotals.total;
    let amountToPay = remaining;
    if (selectedDocType === 'FT') {
      if (isMultiplePayment) {
        amountToPay = payments.reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
      } else {
        const parsed = Number(String(partialPaymentAmount || '').trim());
        amountToPay = Number.isFinite(parsed) && parsed > 0 ? parsed : remaining;
      }
      amountToPay = Math.round(amountToPay * 100) / 100;
      if (!(amountToPay > 0)) {
        setPaymentFinalizeError('Indique o valor a pagar.');
        return;
      }
      if (amountToPay > remaining + 0.009) {
        setPaymentFinalizeError(
          `O valor a pagar não pode exceder o saldo em dívida (${formatMoney(remaining)}).`,
        );
        return;
      }
    }

    setIsFinalizingPayment(true);
    setPaymentFinalizeError(null);
    try {
      const res = await fetch(`${getPosApiBase()}/documentos/registar-pagamento`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getPosUserAuthHeaders() },
        body: JSON.stringify({
          documentNumber: String(selectedOrder.document_number).trim(),
          paymentMethod: method,
          payableKind: selectedDocType === 'FTF' ? 'FTF' : selectedDocType === 'FT' ? 'FT' : undefined,
          ...(selectedDocType === 'FT' ? { amount: amountToPay } : {}),
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
        paymentAmount?: number;
        remainingTotal?: number;
        fullySettled?: boolean;
      }>(payload);
      setIsPaymentModalOpen(false);
      resetPaymentState();
      const paidLabel =
        data?.paymentAmount != null ? ` (${formatMoney(Number(data.paymentAmount))})` : '';
      const remainingLabel =
        data?.fullySettled === false && data?.remainingTotal != null
          ? ` Saldo restante: ${formatMoney(Number(data.remainingTotal))}.`
          : data?.fullySettled
            ? ' Fatura liquidada.'
            : '';
      setActionMessage(
        `${String(data?.generatedDocumentType ?? 'DOC')} ${String(data?.generatedDocumentNumber ?? '')} gerado para ${String(data?.sourceDocumentNumber ?? selectedOrder.document_number)}${paidLabel}.${remainingLabel}`,
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
      className="flex h-full flex-col bg-pos-surface text-zinc-300 overflow-x-hidden overflow-y-visible"
      onClick={handleScreenClickToDeselect}
    >
      {!isPurchaseOpen ? (
        <div className="relative z-40 h-16 bg-pos-surface border-b border-pos-border px-2 overflow-visible">
          <div className="flex h-full items-center gap-3 overflow-visible">
            <div className="flex h-full min-w-0 flex-1 items-center gap-1 overflow-x-auto overflow-y-visible no-scrollbar">
          <ManagementToolbarButton icon={<RefreshCcw size={20} />} label="Atualizar" onClick={handleRefresh} />
          <ManagementToolbarButton icon={<Printer size={20} />} label="Imprimir" onClick={handlePrint} />
          <ManagementToolbarButton icon={<FileSpreadsheet size={20} />} label="Salvar como PDF" onClick={handleSavePdf} />
          {showCreateDocumentAction && createDocButton && createDocPrefix ? (
            <>
              <ManagementToolbarDivider />
              <ManagementToolbarButton
                icon={<PackagePlus size={20} />}
                label={createDocButton.label}
                onClick={() => {
                  setActionMessage('');
                  setIsPurchaseOpen(true);
                }}
                title={createDocButton.title}
              />
            </>
          ) : null}
          {showPayToolbarAction ? (
            <>
              {!showCreateDocumentAction ? <ManagementToolbarDivider /> : null}
              <ManagementToolbarButton
                icon={<Banknote size={20} />}
                label={
                  selectedDocType === 'FTF' ? 'Pagar Fatura de Fornecedor' : 'Pagar Fatura'
                }
                disabled={!selectedOrderIsPayable}
                onClick={handleOpenPayment}
                title={
                  !selectedOrder
                    ? selectedDocType === 'FTF'
                      ? 'Selecione uma Fatura de Fornecedor para pagar'
                      : 'Selecione uma fatura para pagar'
                    : selectedOrderIsPayable
                      ? selectedDocType === 'FTF'
                        ? 'Registar pagamento da Fatura de Fornecedor'
                        : 'Registar pagamento da fatura'
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
                label="Emitir Nota de débito"
                onClick={() => {
                  setActionMessage('');
                  setIsDebitNoteModalOpen(true);
                }}
                title="Emitir nota de débito contra uma fatura de fornecedor"
              />
            </>
          ) : null}
          {showCreateCreditNoteAction ? (
            <>
              <ManagementToolbarDivider />
              <ManagementToolbarButton
                icon={<FileMinus2 size={20} />}
                label="Emitir Nota de Crédito"
                onClick={() => {
                  setActionMessage('');
                  setIsCreditNoteModalOpen(true);
                }}
                title="Emitir nota de crédito contra uma fatura de cliente"
              />
            </>
          ) : null}
          {showAnularVdAction ? (
            <>
              <ManagementToolbarDivider />
              <ManagementToolbarButton
                icon={<Ban size={20} />}
                label="Anular"
                disabled={!selectedOrderIsAnullableVd || isAnullingVd}
                onClick={() => {
                  setActionMessage('');
                  setIsAnularConfirmOpen(true);
                }}
                title={
                  !selectedOrder
                    ? 'Selecione uma venda a dinheiro para anular'
                    : selectedOrderIsAnullableVd
                      ? 'Anular venda a dinheiro e devolver stock'
                      : 'Esta VD já está anulada'
                }
              />
            </>
          ) : null}
            </div>
            {selectedDocType === 'FTF' || selectedDocType === 'FT' ? (
              <div className="shrink-0 pr-3 text-right leading-tight">
                <div className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">
                  {selectedDocType === 'FTF' ? 'Valor a pagar' : 'Valor a receber'}
                </div>
                <div
                  className={`text-2xl font-semibold tabular-nums ${
                    outstandingTotal > 0 ? 'text-rose-300' : 'text-zinc-200'
                  }`}
                >
                  {formatMoney(outstandingTotal)}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {isPurchaseOpen && createDocPrefix && createDocButton ? (
        <PurchaseStockModal
          isOpen={isPurchaseOpen}
          onClose={() => setIsPurchaseOpen(false)}
          documentPrefix={createDocPrefix}
          products={createDocPrefix === 'FTF' ? purchaseProducts : saleProducts}
          onSaved={async () => {
            setActionMessage(createDocButton.successMessage);
            setIsPurchaseOpen(false);
            await fetchData();
          }}
        />
      ) : (
      <>
      <div className="relative z-30 border-b border-pos-border bg-pos-surface px-3 py-2 overflow-visible">
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
        <div className="min-h-0 flex-1 border-b border-pos-border">
          <div
            className="h-full overflow-auto bg-pos-bg custom-scrollbar"
            onClick={() => setSelectedOrderId(null)}
          >
            <table className="w-full min-w-[980px] border-collapse text-left text-xs [&_th]:border [&_td]:border [&_th]:border-pos-border/55 [&_td]:border-pos-border/55">
              <thead className="sticky top-0 z-10 bg-pos-card">
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
                    const creditNoteTotal =
                      docFilterCode === 'FTF' || docFilterCode === 'FT'
                        ? Number(row.credit_note_total ?? 0)
                        : 0;
                    const receiptTotal =
                      docFilterCode === 'FT' ? Number(row.receipt_total ?? 0) : 0;
                    const rowOutstanding =
                      docFilterCode === 'FTF'
                        ? supplierInvoiceOutstanding(row)
                        : docFilterCode === 'FT'
                          ? customerInvoiceOutstanding(row)
                          : Math.max(0, Number(row.total ?? 0));
                    const fullyCredited =
                      (docFilterCode === 'FTF' || docFilterCode === 'FT') &&
                      creditNoteTotal > 0 &&
                      rowOutstanding <= 0.009 &&
                      (docFilterCode === 'FTF' || receiptTotal <= 0.009);
                    const partiallyCredited =
                      (docFilterCode === 'FTF' || docFilterCode === 'FT') &&
                      creditNoteTotal > 0 &&
                      !fullyCredited;
                    const fullyPaidFt =
                      docFilterCode === 'FT' && customerInvoiceIsFullyPaid(row);
                    const partiallyPaidFt =
                      docFilterCode === 'FT' && receiptTotal > 0.009 && !fullyPaidFt;
                    const settled =
                      (docFilterCode === 'FT'
                        ? fullyPaidFt
                        : paid || approved || quotationConverted || fullyCredited);
                    const due = dueDateMeta(row.created_at, row.doc_type);
                    const dueClass = settled
                      ? 'text-zinc-200'
                      : due.tone === 'expired'
                        ? 'text-red-400'
                        : due.tone === 'warning'
                          ? 'text-amber-300'
                          : 'text-zinc-300';
                    const cancelled =
                      rowStatus === 'cancelled' ||
                      rowStatus === 'canceled' ||
                      rowStatus === 'void' ||
                      rowStatus === 'anulado';
                    const statusLabel = cancelled
                      ? 'Anulado'
                      : fullyCredited
                      ? 'Creditada'
                      : partiallyCredited
                        ? 'Crédito parcial'
                      : fullyPaidFt
                        ? 'Pago'
                      : partiallyPaidFt
                        ? 'Pago parcial'
                      : isApprovedQuotation || approved
                      ? 'Aprovado'
                      : paid
                        ? 'Pago'
                        : isQuotationOrProforma
                          ? 'Lançado'
                          : 'Não pago';
                    const statusClass = cancelled
                      ? 'bg-zinc-600 text-white'
                      : fullyCredited
                      ? 'bg-green-600 text-white'
                      : partiallyCredited
                        ? 'bg-amber-600 text-white'
                      : fullyPaidFt
                        ? 'bg-green-600 text-white'
                      : partiallyPaidFt
                        ? 'bg-amber-600 text-white'
                      : isApprovedQuotation || approved
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
                              ? 'bg-pos-surface'
                              : 'bg-pos-row'
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
                          {formatMoney(settled ? 0 : rowOutstanding)}
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
          <div className="h-full overflow-auto bg-pos-bg custom-scrollbar">
            <div className="px-3 py-2 border-b border-pos-border bg-pos-surface text-xs text-zinc-400">
              Itens do documento ({selectedItems.length})
            </div>
            <table className="w-full min-w-[900px] border-collapse text-left text-xs [&_th]:border [&_td]:border [&_th]:border-pos-border/55 [&_td]:border-pos-border/55">
              <thead className="sticky top-0 z-10 bg-pos-card">
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
                          index % 2 ? 'bg-pos-surface' : 'bg-pos-row'
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
          className="fixed inset-0 z-50 pos-modal-overlay flex items-center justify-center p-6"
          onClick={() => setIsPeriodModalOpen(false)}
        >
          <div
            className="w-full max-w-[820px] overflow-hidden rounded-[0.55rem] border border-pos-border bg-pos-surface shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="px-6 py-5 text-center">
              <h3 className="text-[18px] text-white">Período</h3>
              <div className="mt-4 inline-flex items-center rounded-[0.4rem] border border-pos-border bg-pos-surface px-4 py-2 font-bold text-white">
                {formatInputDateLabel(tempDateFrom)} - {formatInputDateLabel(tempDateTo)}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-6 p-6 md:grid-cols-[1fr_1fr_280px]">
              <div>
                <p className="mb-3 text-center text-sm text-zinc-100">Início</p>
                <div className="mx-auto max-w-[260px] rounded-[0.4rem] border border-pos-border bg-pos-surface p-4">
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
                <div className="mx-auto max-w-[260px] rounded-[0.4rem] border border-pos-border bg-pos-surface p-4">
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

      </>
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
        allowPartialPayment={selectedDocType === 'FT'}
        paymentAmount={partialPaymentAmount}
        setPaymentAmount={setPartialPaymentAmount}
      />

      <ConfirmDialog
        isOpen={isAnularConfirmOpen}
        title="Anular VD"
        message={
          <>
            <p>
              Anular a venda a dinheiro{' '}
              <span className="font-semibold text-white">
                {String(selectedOrder?.document_number ?? selectedOrder?.id ?? '').trim()}
              </span>
              ?
            </p>
            <p className="text-zinc-400">O stock dos produtos será devolvido ao armazém.</p>
          </>
        }
        confirmLabel="Anular"
        cancelLabel="Cancelar"
        tone="danger"
        icon={<Ban size={22} />}
        onCancel={() => setIsAnularConfirmOpen(false)}
        onConfirm={() => void handleAnularVd()}
      />

      <SupplierDebitNoteModal
        isOpen={isDebitNoteModalOpen}
        onClose={() => setIsDebitNoteModalOpen(false)}
        mode="debit"
        sourceOrders={orders}
        itemsByOrderId={itemsByOrderId}
        initialSourceOrder={selectedOrder}
        initialSourceOrderId={selectedOrder ? String(selectedOrder.id) : null}
        initialSourceItems={selectedOrder ? itemsByOrderId[String(selectedOrder.id)] ?? [] : []}
        onSaved={(result) => {
          setActionMessage(
            result.documentNumber
              ? `Nota de débito ${result.documentNumber} criada.`
              : 'Nota de débito criada.',
          );
          void fetchData();
        }}
      />

      <SupplierDebitNoteModal
        isOpen={isCreditNoteModalOpen}
        onClose={() => setIsCreditNoteModalOpen(false)}
        mode="credit"
        sourceOrders={orders}
        itemsByOrderId={itemsByOrderId}
        initialSourceOrder={selectedOrder}
        initialSourceOrderId={
          selectedOrder && resolveOrderDocTypeFilterCode(selectedOrder) === 'FT'
            ? String(selectedOrder.id)
            : null
        }
        initialSourceItems={
          selectedOrder && resolveOrderDocTypeFilterCode(selectedOrder) === 'FT'
            ? itemsByOrderId[String(selectedOrder.id)] ?? []
            : []
        }
        onSaved={(result) => {
          setActionMessage(
            result.documentNumber
              ? `Nota de crédito ${result.documentNumber} criada.`
              : 'Nota de crédito criada.',
          );
          void fetchData();
        }}
      />

    </div>
  );
}
