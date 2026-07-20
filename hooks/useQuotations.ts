'use client';

import { useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type {
  CartItem,
  Customer,
  PaymentEntry,
  PaymentMethod,
  Product,
} from '@/app/pos/types';
import type { QuotationRow } from '@/app/pos/components/QuotationModal';
import { fetchDocumentItems, fetchDocuments } from '@/lib/services/posService';

type QuotationItemRow = {
  id: string;
  order_id: string;
  product_id?: string | null;
  product_name?: string | null;
  quantity?: number | null;
  price?: number | null;
  discount_amount?: number | null;
};

const normalizeQuotationToken = (value: string | null | undefined) =>
  String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();

const isQuotationDocument = (row: QuotationRow) => {
  const docType = normalizeQuotationToken(row.doc_type);
  if (!docType) return false;
  return docType === 'fp' || docType.includes('proforma') || docType.includes('cotacao');
};

const handleSupabaseError = (error: unknown, operation: string) => {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : 'Erro desconhecido';
  console.error(`Supabase Error (${operation}): ${message}`, error);
};

type UseQuotationsOpts = {
  cart: CartItem[];
  products: Product[];
  customers: Customer[];
  setCart: Dispatch<SetStateAction<CartItem[]>>;
  setProducts: Dispatch<SetStateAction<Product[]>>;
  setSelectedCartItemId: Dispatch<SetStateAction<string | null>>;
  setSelectedCustomer: Dispatch<SetStateAction<Customer | null>>;
  setCustomerName: Dispatch<SetStateAction<string>>;
  setGlobalDiscount: Dispatch<
    SetStateAction<{ type: 'value' | 'percentage'; amount: number } | null>
  >;
  setDocType: Dispatch<SetStateAction<'VD' | 'TK' | 'FP' | 'FT'>>;
  setFinalizedDocType: Dispatch<SetStateAction<'VD' | 'TK' | 'FP' | 'FT'>>;
  setIsSaleFinalized: Dispatch<SetStateAction<boolean>>;
  setCurrentReceiptNumber: Dispatch<SetStateAction<string | null>>;
  setPaymentMethod: Dispatch<SetStateAction<PaymentMethod | null>>;
  setReceivedAmount: Dispatch<SetStateAction<string>>;
  setPayments: Dispatch<SetStateAction<PaymentEntry[]>>;
  setIsMultiplePayment: Dispatch<SetStateAction<boolean>>;
  setMultiplePaymentAmount: Dispatch<SetStateAction<string>>;
  setLoadedQuotationSource: Dispatch<
    SetStateAction<{ sourceId: string; sourceType: 'order' | 'sale' } | null>
  >;
  showToast: (message: string, type?: 'success' | 'error' | 'info') => void;
};

export function useQuotations(opts: UseQuotationsOpts) {
  const {
    cart,
    products,
    customers,
    setCart,
    setProducts,
    setSelectedCartItemId,
    setSelectedCustomer,
    setCustomerName,
    setGlobalDiscount,
    setDocType,
    setFinalizedDocType,
    setIsSaleFinalized,
    setCurrentReceiptNumber,
    setPaymentMethod,
    setReceivedAmount,
    setPayments,
    setIsMultiplePayment,
    setMultiplePaymentAmount,
    setLoadedQuotationSource,
    showToast,
  } = opts;

  const [isQuotationModalOpen, setIsQuotationModalOpen] = useState(false);
  const [quotationRows, setQuotationRows] = useState<QuotationRow[]>([]);
  const [quotationItemsByOrderId, setQuotationItemsByOrderId] = useState<
    Record<string, QuotationItemRow[]>
  >({});
  const [isQuotationLoading, setIsQuotationLoading] = useState(false);

  const loadQuotations = async () => {
    setIsQuotationLoading(true);
    try {
      const [rawDocuments, rawItems] = await Promise.all([fetchDocuments(), fetchDocumentItems()]);
      const documents = (Array.isArray(rawDocuments) ? rawDocuments : []) as QuotationRow[];
      const items = (Array.isArray(rawItems) ? rawItems : []) as QuotationItemRow[];

      const quotations = documents
        .filter((row) => {
          if (!isQuotationDocument(row)) return false;
          const statusToken = normalizeQuotationToken(row.status);
          return statusToken !== 'approved' && statusToken !== 'aprovado';
        })
        .sort((a, b) => {
          const aTime = Date.parse(String(a.created_at ?? '')) || 0;
          const bTime = Date.parse(String(b.created_at ?? '')) || 0;
          return bTime - aTime;
        });

      const grouped: Record<string, QuotationItemRow[]> = {};
      for (const item of items) {
        const key = String(item.order_id ?? '').trim();
        if (!key) continue;
        if (!grouped[key]) grouped[key] = [];
        grouped[key].push(item);
        const saleKey = `venda:${key}`;
        if (!grouped[saleKey]) grouped[saleKey] = [];
        grouped[saleKey].push(item);
      }

      setQuotationRows(quotations);
      setQuotationItemsByOrderId(grouped);
    } catch (error) {
      handleSupabaseError(error, 'loadQuotations');
      showToast('Não foi possível carregar as cotações.', 'error');
      setQuotationRows([]);
      setQuotationItemsByOrderId({});
    } finally {
      setIsQuotationLoading(false);
    }
  };

  const handleLoadQuotation = (quotation: QuotationRow) => {
    const orderId = String(quotation.id);
    const sourceItems = quotationItemsByOrderId[orderId] ?? [];
    if (sourceItems.length === 0) {
      showToast('Esta cotação não possui itens.', 'error');
      return;
    }

    const nextCartMap = new Map<string, CartItem>();
    for (const [index, item] of sourceItems.entries()) {
      const itemProductId = String(item.product_id ?? '').trim();
      const itemName = String(item.product_name ?? '').trim() || `Item ${index + 1}`;
      const matchedProduct =
        products.find((product) => String(product.id) === itemProductId) ??
        products.find(
          (product) => product.name.trim().toLowerCase() === itemName.toLowerCase(),
        ) ??
        null;

      const baseId = (matchedProduct?.id ?? itemProductId) || `cotacao-${orderId}-${index}`;
      const unitPrice = Number(item.price ?? matchedProduct?.price ?? 0);
      const quantity = Number(item.quantity ?? 0);
      if (!Number.isFinite(quantity) || quantity <= 0) continue;

      const cartItem: CartItem = {
        ...(matchedProduct ?? {
          id: baseId,
          name: itemName,
          price: Number.isFinite(unitPrice) ? unitPrice : 0,
          category: 'Cotação',
        }),
        id: baseId,
        name: itemName,
        price: Number.isFinite(unitPrice) ? unitPrice : 0,
        quantity,
      };

      const existing = nextCartMap.get(baseId);
      if (existing) {
        nextCartMap.set(baseId, { ...existing, quantity: existing.quantity + quantity });
      } else {
        nextCartMap.set(baseId, cartItem);
      }
    }

    const nextCart = Array.from(nextCartMap.values());
    if (nextCart.length === 0) {
      showToast('Não há itens válidos nesta cotação.', 'error');
      return;
    }

    const restockMap = new Map<string, number>();
    for (const item of cart) {
      if (item.is_service) continue;
      restockMap.set(item.id, (restockMap.get(item.id) ?? 0) + item.quantity);
    }

    const reserveMap = new Map<string, number>();
    for (const item of nextCart) {
      if (item.is_service) continue;
      reserveMap.set(item.id, (reserveMap.get(item.id) ?? 0) + item.quantity);
    }

    if (restockMap.size > 0 || reserveMap.size > 0) {
      setProducts((prev) =>
        prev.map((product) => {
          const restock = restockMap.get(product.id) ?? 0;
          const reserve = reserveMap.get(product.id) ?? 0;
          if (restock === 0 && reserve === 0) return product;
          return {
            ...product,
            stock_quantity: Number(product.stock_quantity ?? 0) + restock - reserve,
          };
        }),
      );
    }

    const customerId = String(quotation.customer_id ?? '').trim();
    const customerLabel = String(quotation.client_name ?? '').trim();
    const customerFromQuotation =
      customers.find((customer) => customerId && String(customer.id) === customerId) ??
      customers.find(
        (customer) => customerId && String(customer.cloud_id ?? '') === customerId,
      ) ??
      customers.find(
        (customer) =>
          customerLabel && customer.name.trim().toLowerCase() === customerLabel.toLowerCase(),
      ) ??
      null;

    setCart(nextCart);
    setSelectedCartItemId(null);
    setSelectedCustomer(customerFromQuotation);
    setCustomerName(customerFromQuotation?.name ?? customerLabel);
    setGlobalDiscount(null);
    setDocType('VD');
    setFinalizedDocType('VD');
    setIsSaleFinalized(false);
    setCurrentReceiptNumber(null);
    setPaymentMethod(null);
    setReceivedAmount('');
    setPayments([]);
    setIsMultiplePayment(false);
    setMultiplePaymentAmount('');
    setLoadedQuotationSource({
      sourceId: orderId,
      sourceType: orderId.startsWith('venda:') ? 'sale' : 'order',
    });
    setIsQuotationModalOpen(false);
    showToast('Cotação carregada para o carrinho.', 'success');
  };

  const handleOpenQuotationModal = () => {
    setIsQuotationModalOpen(true);
    void loadQuotations();
  };

  return {
    isQuotationModalOpen,
    setIsQuotationModalOpen,
    quotationRows,
    quotationItemsByOrderId,
    isQuotationLoading,
    loadQuotations,
    handleLoadQuotation,
    handleOpenQuotationModal,
  };
}
