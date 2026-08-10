'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  PackagePlus,
  Search,
  Trash2,
  Loader2,
  Building2,
  CalendarDays,
  FileText,
  ChevronDown,
  Banknote,
} from 'lucide-react';
import { getPosApiBase, getPosUserAuthHeaders } from '@/lib/apiBase';
import { unwrapApiSuccessPayload } from '@/lib/apiResponse';
import { formatMoneyMt } from '@/lib/currency';
import { computeTaxFromBasePrice } from '@/lib/taxMath';
import { getCachedTaxRates, setCachedTaxRates } from '@/lib/posSessionCache';
import PosSelect from '@/components/PosSelect';
import { fetchPaymentMethods, fetchWarehouses, type PosWarehouse } from '@/lib/services/posService';
import { PurchaseProductMultiSelectModal } from '@/app/management/components/PurchaseProductMultiSelectModal';
import { CustomerSupplierFormModal } from '@/app/management/components/CustomerSupplierFormModal';
import { PaymentModal } from '@/app/pos/components/PaymentModal';
import type {
  CartItem,
  PaymentEntry,
  PaymentMethod,
  PaymentMethodOption,
} from '@/app/pos/types';

export type PurchaseProductOption = {
  id: string;
  name: string;
  code?: number;
  cost?: number;
  /** Preço de venda (documentos de cliente). */
  price?: number;
  unit?: string;
  stock_quantity?: number;
  track_lot?: boolean;
  tax_rate_id?: string | null;
};

export type DocumentCreatePrefix = 'FTF' | 'FP' | 'FT' | 'VD';

type TaxRateOption = {
  id: string;
  name: string;
  code: string;
  rate: number;
  isFixed: boolean;
  priceIncludesTax: boolean;
  isDefault?: boolean;
  enabled?: boolean;
};

type PurchaseLine = {
  key: string;
  productId: string;
  name: string;
  unit: string;
  quantity: number;
  /** Valor unitário introduzido (pago com IVA, ou custo sem IVA conforme a taxa). */
  unitPrice: number;
  /** Custo líquido da última compra / stock (não muda ao editar pago/un). */
  lastPurchaseCost: number;
  taxRateId: string;
  trackLot?: boolean;
  lotCode?: string;
};

type LineTaxBreakdown = {
  unitNet: number;
  unitTax: number;
  unitGross: number;
  lineNet: number;
  lineTax: number;
  lineGross: number;
};

type PartyOption = {
  id: string;
  name: string;
};

type PartyMeta = {
  active?: boolean;
  isCustomer?: boolean;
  taxExempt?: boolean;
  code?: string;
};

const CUSTOMERS_META_KEY = 'customers-manager-meta';
const DEFAULT_SUPPLIER_NAME = 'Fornecedor';
const DEFAULT_SUPPLIER_PHONE = '000000000';
const CREATE_PARTY_OPTION = '__create_party__';

type DocCreateConfig = {
  prefix: DocumentCreatePrefix;
  documentType: string;
  partyKind: 'supplier' | 'customer';
  partyLabel: string;
  partyPlaceholder: string;
  createPartyLabel: string;
  productsLabel: string;
  warehouseLabel: string;
  showWarehouse: boolean;
  showExternalDoc: boolean;
  useCostPrice: boolean;
  paid: boolean;
  requirePayment: boolean;
  saveLabel: string;
  successHint: (number: string) => string;
};

const DOC_CREATE_CONFIG: Record<DocumentCreatePrefix, DocCreateConfig> = {
  FTF: {
    prefix: 'FTF',
    documentType: 'Compra',
    partyKind: 'supplier',
    partyLabel: 'Fornecedor',
    partyPlaceholder: 'Seleccione o fornecedor…',
    createPartyLabel: 'Criar Fornecedor...',
    productsLabel: 'Produtos da compra',
    warehouseLabel: 'Armazém destino',
    showWarehouse: true,
    showExternalDoc: true,
    useCostPrice: true,
    paid: false,
    requirePayment: false,
    saveLabel: 'Guardar compra',
    successHint: (n) => `Compra ${n} registada (não paga). Stock actualizado.`,
  },
  FP: {
    prefix: 'FP',
    documentType: 'Cotação',
    partyKind: 'customer',
    partyLabel: 'Cliente',
    partyPlaceholder: 'Seleccione o cliente…',
    createPartyLabel: 'Criar Cliente...',
    productsLabel: 'Produtos da cotação',
    warehouseLabel: 'Armazém',
    showWarehouse: false,
    showExternalDoc: false,
    useCostPrice: false,
    paid: false,
    requirePayment: false,
    saveLabel: 'Guardar cotação',
    successHint: (n) => `Cotação ${n} registada.`,
  },
  FT: {
    prefix: 'FT',
    documentType: 'Fatura',
    partyKind: 'customer',
    partyLabel: 'Cliente',
    partyPlaceholder: 'Seleccione o cliente…',
    createPartyLabel: 'Criar Cliente...',
    productsLabel: 'Produtos da fatura',
    warehouseLabel: 'Armazém origem',
    showWarehouse: false,
    showExternalDoc: false,
    useCostPrice: false,
    paid: false,
    requirePayment: false,
    saveLabel: 'Guardar fatura',
    successHint: (n) => `Fatura ${n} registada (não paga).`,
  },
  VD: {
    prefix: 'VD',
    documentType: 'Venda a dinheiro',
    partyKind: 'customer',
    partyLabel: 'Cliente',
    partyPlaceholder: 'Seleccione o cliente…',
    createPartyLabel: 'Criar Cliente...',
    productsLabel: 'Produtos da venda',
    warehouseLabel: 'Armazém origem',
    showWarehouse: false,
    showExternalDoc: false,
    useCostPrice: false,
    paid: true,
    requirePayment: true,
    saveLabel: 'Pagamento',
    successHint: (n) => `Venda a dinheiro ${n} registada.`,
  },
};

function readPartyMetaById(): Record<string, PartyMeta> {
  try {
    const raw = localStorage.getItem(CUSTOMERS_META_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') return parsed as Record<string, PartyMeta>;
  } catch {
    /* ignore */
  }
  return {};
}

function writePartyMeta(id: string, meta: PartyMeta) {
  try {
    const all = readPartyMetaById();
    all[id] = {
      active: meta.active ?? true,
      isCustomer: meta.isCustomer ?? false,
      taxExempt: meta.taxExempt ?? false,
      ...(meta.code != null && String(meta.code).trim()
        ? { code: String(meta.code).trim() }
        : all[id]?.code
          ? { code: all[id].code }
          : {}),
    };
    localStorage.setItem(CUSTOMERS_META_KEY, JSON.stringify(all));
  } catch {
    /* ignore */
  }
}

/** Fornecedor = toggle "Cliente" desligado no modal Clientes & Fornecedores. */
function isSupplierParty(id: string, metaById: Record<string, PartyMeta>) {
  const meta = metaById[id];
  return meta?.isCustomer === false;
}

function isDefaultSupplierName(name: string) {
  const n = name.trim().toLowerCase();
  return n === 'fornecedor' || n === 'fornecedor padrão' || n === 'fornecedor padrao';
}

function toPartyOptions(rows: any[]): PartyOption[] {
  return (Array.isArray(rows) ? rows : [])
    .map((row) => ({
      id: String(row.id),
      name: String(row.name ?? 'Sem nome'),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'pt'));
}

type PurchaseStockModalProps = {
  isOpen: boolean;
  onClose: () => void;
  products: PurchaseProductOption[];
  initialProductId?: string | null;
  /** Prefixo do documento a criar. Por defeito FTF (compra). */
  documentPrefix?: DocumentCreatePrefix;
  onSaved: () => void | Promise<void>;
};

function toInputDate(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function newLineKey() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

const PRODUCT_PREVIEW_LIMIT = 4;

function roundMoney(n: number) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function breakdownLine(line: PurchaseLine, taxRates: TaxRateOption[]): LineTaxBreakdown {
  const rate = taxRates.find((r) => r.id === line.taxRateId);
  const qty = Math.max(0, Number(line.quantity) || 0);
  const entered = Math.max(0, Number(line.unitPrice) || 0);
  if (!rate) {
    return {
      unitNet: entered,
      unitTax: 0,
      unitGross: entered,
      lineNet: roundMoney(entered * qty),
      lineTax: 0,
      lineGross: roundMoney(entered * qty),
    };
  }
  const computed = computeTaxFromBasePrice({
    basePrice: entered,
    rate: Number(rate.rate) || 0,
    isFixed: Boolean(rate.isFixed),
    priceIncludesTax: rate.priceIncludesTax !== false,
  });
  const unitGross = computed.finalPrice;
  const unitTax = computed.tax;
  const unitNet = roundMoney(Math.max(0, unitGross - unitTax));
  return {
    unitNet,
    unitTax,
    unitGross,
    lineNet: roundMoney(unitNet * qty),
    lineTax: roundMoney(unitTax * qty),
    lineGross: roundMoney(unitGross * qty),
  };
}

function resolveTaxRateId(productTaxRateId: string | null | undefined, rates: TaxRateOption[]) {
  const fromProduct = String(productTaxRateId ?? '').trim();
  if (fromProduct && rates.some((r) => r.id === fromProduct)) return fromProduct;
  const enabled = rates.filter((r) => r.enabled !== false);
  return enabled.find((r) => r.isDefault)?.id || enabled[0]?.id || rates[0]?.id || '';
}

/** Custo de stock é líquido; se a taxa for «c/ imposto», sugere o valor pago na factura. */
function seedPaidUnitPrice(netCost: number, taxRateId: string, rates: TaxRateOption[]) {
  const cost = Math.max(0, Number(netCost) || 0);
  const rate = rates.find((r) => r.id === taxRateId);
  if (!rate || rate.isFixed || Number(rate.rate) <= 0) return cost;
  if (rate.priceIncludesTax === false) return cost;
  return roundMoney(cost * (1 + Number(rate.rate) / 100));
}

export default function PurchaseStockModal({
  isOpen,
  onClose,
  products,
  initialProductId,
  documentPrefix = 'FTF',
  onSaved,
}: PurchaseStockModalProps) {
  const cfg = DOC_CREATE_CONFIG[documentPrefix] ?? DOC_CREATE_CONFIG.FTF;
  const isSupplierMode = cfg.partyKind === 'supplier';
  const [parties, setParties] = useState<PartyOption[]>([]);
  const [partyId, setPartyId] = useState('');
  const [documentDate, setDocumentDate] = useState(() => toInputDate(new Date()));
  const [externalDoc, setExternalDoc] = useState('');
  const [docNumber, setDocNumber] = useState(`${cfg.prefix}/…`);
  const [lines, setLines] = useState<PurchaseLine[]>([]);
  const [productQuery, setProductQuery] = useState('');
  const [productPickerOpen, setProductPickerOpen] = useState(false);
  const [productMultiOpen, setProductMultiOpen] = useState(false);
  const productPickerRef = useRef<HTMLDivElement | null>(null);
  const productMultiOpenRef = useRef(false);
  productMultiOpenRef.current = productMultiOpen;
  const [loadingMeta, setLoadingMeta] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [successHint, setSuccessHint] = useState('');
  const [isCreatePartyOpen, setIsCreatePartyOpen] = useState(false);
  const [warehouses, setWarehouses] = useState<PosWarehouse[]>([]);
  const partyCreateDefaults = useMemo(
    () => ({
      isCustomer: !isSupplierMode,
      active: true,
      taxExempt: false,
      country: 'Moçambique',
    }),
    [isSupplierMode],
  );
  const [warehouseId, setWarehouseId] = useState('');
  const [taxRates, setTaxRates] = useState<TaxRateOption[]>(
    () => (getCachedTaxRates() as TaxRateOption[] | null) ?? [],
  );
  const [isPaymentOpen, setIsPaymentOpen] = useState(false);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethodOption[]>([]);
  const [isMultiplePayment, setIsMultiplePayment] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | null>(null);
  const [receivedAmount, setReceivedAmount] = useState('');
  const [payments, setPayments] = useState<PaymentEntry[]>([]);
  const [multiplePaymentMethod, setMultiplePaymentMethod] = useState<PaymentMethod>('Dinheiro');
  const [multiplePaymentAmount, setMultiplePaymentAmount] = useState('');
  const [paymentFinalizeError, setPaymentFinalizeError] = useState<string | null>(null);

  const selectedParty = useMemo(
    () => parties.find((p) => String(p.id) === String(partyId)) ?? null,
    [parties, partyId],
  );

  const paymentCart = useMemo<CartItem[]>(
    () =>
      lines.map((line, index) => {
        const br = breakdownLine(line, taxRates);
        return {
          id: line.productId || `line-${index}`,
          name: line.name,
          price: br.unitGross,
          category: 'Documento',
          quantity: line.quantity,
        };
      }),
    [lines, taxRates],
  );

  const resetPaymentState = useCallback(() => {
    setIsPaymentOpen(false);
    setIsMultiplePayment(false);
    setPaymentMethod(null);
    setReceivedAmount('');
    setPayments([]);
    setMultiplePaymentAmount('');
    setPaymentFinalizeError(null);
  }, []);

  const defaultTaxRateId = useMemo(() => {
    const enabled = taxRates.filter((r) => r.enabled !== false);
    const preferred = enabled.find((r) => r.isDefault) || enabled[0] || taxRates[0];
    return preferred?.id ?? '';
  }, [taxRates]);

  const lineBreakdowns = useMemo(
    () => lines.map((line) => ({ key: line.key, ...breakdownLine(line, taxRates) })),
    [lines, taxRates],
  );

  const totals = useMemo(() => {
    return lineBreakdowns.reduce(
      (acc, row) => ({
        net: roundMoney(acc.net + row.lineNet),
        tax: roundMoney(acc.tax + row.lineTax),
        gross: roundMoney(acc.gross + row.lineGross),
      }),
      { net: 0, tax: 0, gross: 0 },
    );
  }, [lineBreakdowns]);

  const taxSummaryLabel = useMemo(() => {
    const ids = [...new Set(lines.map((l) => l.taxRateId).filter(Boolean))];
    if (ids.length === 1) {
      const rate = taxRates.find((r) => r.id === ids[0]);
      if (!rate) return 'Imposto:';
      if (Number(rate.rate) === 0) return 'Imposto (isento):';
      if (rate.isFixed) return `Imposto (${formatMoneyMt(rate.rate)}):`;
      return `Imposto ${Number(rate.rate)}%:`;
    }
    if (ids.length > 1) return 'Impostos:';
    return 'Imposto:';
  }, [lines, taxRates]);

  const matchedProducts = useMemo(() => {
    const q = productQuery.trim().toLowerCase();
    if (!q) return products;
    return products.filter((p) => {
      const name = String(p.name ?? '').toLowerCase();
      const code = String(p.code ?? '');
      return name.includes(q) || code.includes(q);
    });
  }, [productQuery, products]);

  const visiblePickerProducts = useMemo(
    () => matchedProducts.slice(0, PRODUCT_PREVIEW_LIMIT),
    [matchedProducts],
  );

  const partyOptions = useMemo(
    () => [
      {
        value: '',
        label:
          parties.length === 0
            ? isSupplierMode
              ? 'A criar fornecedor padrão…'
              : 'Sem clientes — crie um abaixo'
            : cfg.partyPlaceholder,
      },
      ...parties.map((party) => ({ value: party.id, label: party.name })),
      { value: CREATE_PARTY_OPTION, label: cfg.createPartyLabel },
    ],
    [parties, isSupplierMode, cfg.partyPlaceholder, cfg.createPartyLabel],
  );

  const refreshParties = useCallback(
    async (preferredId?: string | null) => {
      const partyRes = await fetch(`${getPosApiBase()}/clientes`, {
        headers: { ...getPosUserAuthHeaders() },
      });
      const partyData = unwrapApiSuccessPayload<any[]>(await partyRes.json());
      const allParties = toPartyOptions(Array.isArray(partyData) ? partyData : []);
      const metaById = readPartyMetaById();
      const filtered = isSupplierMode
        ? allParties.filter((party) => isSupplierParty(party.id, metaById))
        : allParties.filter((party) => !isSupplierParty(party.id, metaById));
      setParties(filtered);
      setPartyId((prev) => {
        if (preferredId && filtered.some((party) => party.id === preferredId)) return preferredId;
        if (prev && filtered.some((party) => party.id === prev)) return prev;
        return filtered[0]?.id ?? '';
      });
      return filtered;
    },
    [isSupplierMode],
  );

  const loadMeta = useCallback(async () => {
    setLoadingMeta(true);
    setError('');
    try {
      const year = new Date(documentDate).getFullYear() || new Date().getFullYear();
      const authHeaders = getPosUserAuthHeaders();
      const [partyRes, nextRes, whRows, taxRes] = await Promise.all([
        fetch(`${getPosApiBase()}/clientes`, { headers: { ...authHeaders } }),
        fetch(
          `${getPosApiBase()}/documentos/next-number?prefix=${encodeURIComponent(cfg.prefix)}&year=${year}`,
          { headers: { ...authHeaders } },
        ),
        fetchWarehouses(),
        fetch(`${getPosApiBase()}/tax-rates`, { headers: { ...authHeaders } }),
      ]);
      setWarehouses(whRows.filter((w) => w.isActive));
      const defaultWh = whRows.find((w) => w.isDefault && w.isActive) || whRows.find((w) => w.isActive);
      setWarehouseId((prev) => prev || (defaultWh ? defaultWh.id : ''));

      const taxData = unwrapApiSuccessPayload<TaxRateOption[]>(await taxRes.json());
      if (Array.isArray(taxData)) {
        setTaxRates(taxData);
        setCachedTaxRates(taxData);
      }
      const partyData = unwrapApiSuccessPayload<any[]>(await partyRes.json());
      const allParties = toPartyOptions(Array.isArray(partyData) ? partyData : []);

      let metaById = readPartyMetaById();
      let filtered = isSupplierMode
        ? allParties.filter((party) => isSupplierParty(party.id, metaById))
        : allParties.filter((party) => !isSupplierParty(party.id, metaById));

      // Sem fornecedor configurado → usar/criar "Fornecedor" por defeito.
      if (isSupplierMode && filtered.length === 0) {
        const existingDefault = allParties.find((party) => isDefaultSupplierName(party.name));
        if (existingDefault) {
          writePartyMeta(existingDefault.id, {
            active: true,
            isCustomer: false,
            taxExempt: false,
          });
          metaById = readPartyMetaById();
          filtered = [existingDefault];
        } else {
          const createRes = await fetch(`${getPosApiBase()}/clientes`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...getPosUserAuthHeaders() },
            body: JSON.stringify({
              name: DEFAULT_SUPPLIER_NAME,
              phone: DEFAULT_SUPPLIER_PHONE,
              email: null,
              address: null,
            }),
          });
          if (createRes.ok) {
            const createdRaw = await createRes.json().catch(() => ({}));
            const created = unwrapApiSuccessPayload<any>(createdRaw) ?? createdRaw;
            const createdId = String(created?.id ?? created?.data?.id ?? '');
            if (createdId) {
              writePartyMeta(createdId, {
                active: true,
                isCustomer: false,
                taxExempt: false,
              });
              filtered = [{ id: createdId, name: DEFAULT_SUPPLIER_NAME }];
            }
          }
        }
      }

      setParties(filtered);
      setPartyId(filtered[0]?.id ?? '');

      if (nextRes.ok) {
        const nextJson = await nextRes.json();
        const payload = unwrapApiSuccessPayload<any>(nextJson) ?? nextJson;
        const number =
          payload?.documentNumber ||
          payload?.number ||
          payload?.nextNumber ||
          (payload?.sequence != null
            ? `${cfg.prefix}/${year}/${String(payload.sequence).padStart(cfg.prefix === 'FP' || cfg.prefix === 'VD' ? 4 : 5, '0')}`
            : null);
        if (number) setDocNumber(String(number));
        else setDocNumber(`${cfg.prefix}/${year}/00001`);
      } else {
        setDocNumber(`${cfg.prefix}/${year}/00001`);
      }
    } catch {
      setError(
        isSupplierMode
          ? 'Não foi possível carregar fornecedores / número do documento.'
          : 'Não foi possível carregar clientes / número do documento.',
      );
    } finally {
      setLoadingMeta(false);
    }
  }, [documentDate, cfg.prefix, isSupplierMode]);

  useEffect(() => {
    if (!isOpen) return;
    setDocumentDate(toInputDate(new Date()));
    setExternalDoc('');
    setProductQuery('');
    setProductPickerOpen(false);
    setProductMultiOpen(false);
    setError('');
    setSuccessHint('');
    setPartyId('');
    resetPaymentState();

    const initial = initialProductId
      ? products.find((p) => String(p.id) === String(initialProductId))
      : null;
    if (initial) {
      const taxRateId = resolveTaxRateId(initial.tax_rate_id, taxRates);
      const lastPurchaseCost = roundMoney(Math.max(0, Number(initial.cost ?? 0) || 0));
      const sellPrice = roundMoney(Math.max(0, Number(initial.price ?? initial.cost ?? 0) || 0));
      setLines([
        {
          key: newLineKey(),
          productId: String(initial.id),
          name: initial.name,
          unit: initial.unit || 'un',
          quantity: 1,
          unitPrice: cfg.useCostPrice
            ? seedPaidUnitPrice(lastPurchaseCost, taxRateId, taxRates)
            : sellPrice,
          lastPurchaseCost,
          taxRateId,
          trackLot: Boolean(initial.track_lot),
          lotCode: '',
        },
      ]);
    } else {
      setLines([]);
    }

    void loadMeta();
    // Só reinicia ao abrir / mudar produto inicial — não quando `products` muda de referência.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- loadMeta/products/taxRates intencionais
  }, [isOpen, initialProductId, documentPrefix]);

  const handlePartySelect = useCallback((value: string) => {
    if (value === CREATE_PARTY_OPTION) {
      setPartyId('');
      setIsCreatePartyOpen(true);
      return;
    }
    setPartyId(value);
  }, []);

  const handlePartyCreated = useCallback(
    async (saved: {
      id: string;
      code: string;
      active: boolean;
      taxExempt: boolean;
    }) => {
      writePartyMeta(saved.id, {
        active: saved.active,
        isCustomer: !isSupplierMode,
        taxExempt: saved.taxExempt,
        code: saved.code,
      });
      await refreshParties(saved.id);
    },
    [refreshParties, isSupplierMode],
  );

  useEffect(() => {
    if (!isOpen || !defaultTaxRateId) return;
    setLines((prev) =>
      prev.map((line) =>
        line.taxRateId
          ? line
          : { ...line, taxRateId: defaultTaxRateId },
      ),
    );
  }, [isOpen, defaultTaxRateId]);

  useEffect(() => {
    if (!productPickerOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (productMultiOpenRef.current) return;
      const target = event.target as Node | null;
      if (!target) return;
      if (productPickerRef.current?.contains(target)) return;
      setProductPickerOpen(false);
    };
    window.addEventListener('pointerdown', onPointerDown, true);
    return () => window.removeEventListener('pointerdown', onPointerDown, true);
  }, [productPickerOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || saving) return;
      if (isPaymentOpen) {
        resetPaymentState();
        return;
      }
      if (productMultiOpen) {
        setProductMultiOpen(false);
        return;
      }
      if (productPickerOpen) {
        setProductPickerOpen(false);
        return;
      }
      onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose, saving, productPickerOpen, productMultiOpen, isPaymentOpen, resetPaymentState]);

  const buildPurchaseLine = (product: PurchaseProductOption): PurchaseLine => {
    const taxRateId = resolveTaxRateId(product.tax_rate_id, taxRates) || defaultTaxRateId;
    const lastPurchaseCost = roundMoney(Math.max(0, Number(product.cost ?? 0) || 0));
    const sellPrice = roundMoney(Math.max(0, Number(product.price ?? product.cost ?? 0) || 0));
    return {
      key: newLineKey(),
      productId: String(product.id),
      name: product.name,
      unit: product.unit || 'un',
      quantity: 1,
      unitPrice: cfg.useCostPrice
        ? seedPaidUnitPrice(lastPurchaseCost, taxRateId, taxRates)
        : sellPrice,
      lastPurchaseCost,
      taxRateId,
      trackLot: Boolean(product.track_lot),
      lotCode: '',
    };
  };

  const addProduct = (product: PurchaseProductOption) => {
    setError('');
    setLines((prev) => {
      const existing = prev.find((line) => String(line.productId) === String(product.id));
      if (existing) {
        return prev.map((line) =>
          line.key === existing.key
            ? { ...line, quantity: Number((line.quantity + 1).toFixed(3)) }
            : line,
        );
      }
      return [...prev, buildPurchaseLine(product)];
    });
    setProductQuery('');
    setProductPickerOpen(false);
  };

  const addProductsBatch = (selected: PurchaseProductOption[]) => {
    if (!selected.length) return;
    setError('');
    setLines((prev) => {
      let next = [...prev];
      for (const product of selected) {
        const existing = next.find((line) => String(line.productId) === String(product.id));
        if (existing) {
          next = next.map((line) =>
            line.key === existing.key
              ? { ...line, quantity: Number((line.quantity + 1).toFixed(3)) }
              : line,
          );
        } else {
          next = [...next, buildPurchaseLine(product)];
        }
      }
      return next;
    });
    setProductQuery('');
    setProductPickerOpen(false);
    setProductMultiOpen(false);
  };

  const updateLine = (key: string, patch: Partial<PurchaseLine>) => {
    setLines((prev) =>
      prev.map((line) => (line.key === key ? { ...line, ...patch } : line)),
    );
  };

  const removeLine = (key: string) => {
    setLines((prev) => prev.filter((line) => line.key !== key));
  };

  const validateDocumentForm = () => {
    setError('');
    setSuccessHint('');
    if (!partyId || !selectedParty) {
      setError(
        isSupplierMode
          ? 'Selecione o fornecedor da compra.'
          : 'Selecione o cliente do documento.',
      );
      return false;
    }
    if (lines.length === 0) {
      setError('Adicione pelo menos um produto.');
      return false;
    }
    if (lines.some((line) => !(line.quantity > 0))) {
      setError('Todas as quantidades devem ser maiores que zero.');
      return false;
    }
    if (
      cfg.useCostPrice &&
      lines.some((line) => line.trackLot && !String(line.lotCode ?? '').trim())
    ) {
      setError('Indique o código do lote para os produtos que controlam lote.');
      return false;
    }
    if (cfg.showWarehouse && !warehouseId) {
      setError('Seleccione o armazém.');
      return false;
    }
    return true;
  };

  const openPaymentFlow = async () => {
    if (!validateDocumentForm()) return;
    setPaymentFinalizeError(null);
    try {
      const methods = await fetchPaymentMethods();
      setPaymentMethods(methods);
      if (methods[0]?.name) {
        setMultiplePaymentMethod(methods[0].name);
      }
    } catch {
      setPaymentMethods([]);
    }
    setIsMultiplePayment(false);
    setPaymentMethod(null);
    setReceivedAmount('');
    setPayments([]);
    setMultiplePaymentAmount('');
    setIsPaymentOpen(true);
  };

  const handleSave = async (paymentOverride?: {
    paid: boolean;
    paymentMethod: string | null;
  }) => {
    if (saving) return;
    if (!validateDocumentForm()) return;

    setSaving(true);
    setPaymentFinalizeError(null);
    try {
      const items = lines.map((line) => {
        const br = breakdownLine(line, taxRates);
        const rate = taxRates.find((r) => r.id === line.taxRateId);
        return {
          productId: line.productId,
          name: line.name,
          quantity: line.quantity,
          unitPrice: br.unitNet,
          unitGross: br.unitGross,
          taxAmount: br.unitTax,
          taxRateId: line.taxRateId || null,
          taxRate: rate ? Number(rate.rate) || 0 : 0,
          discountAmount: 0,
          lotCode:
            cfg.useCostPrice && line.trackLot
              ? String(line.lotCode ?? '').trim() || null
              : null,
          lineNet: br.lineNet,
          lineTax: br.lineTax,
          lineGross: br.lineGross,
        };
      });
      const saveTotals = items.reduce(
        (acc, item) => ({
          net: roundMoney(acc.net + Number(item.lineNet || 0)),
          tax: roundMoney(acc.tax + Number(item.lineTax || 0)),
          gross: roundMoney(acc.gross + Number(item.lineGross || 0)),
        }),
        { net: 0, tax: 0, gross: 0 },
      );

      const paid = paymentOverride?.paid ?? cfg.paid;
      const resolvedPaymentMethod =
        paymentOverride?.paymentMethod ?? (paid ? 'Dinheiro' : null);

      const payload = {
        documentType: cfg.documentType,
        prefix: cfg.prefix,
        documentDate: `${documentDate}T00:00:00.000Z`,
        dueDate: `${documentDate}T00:00:00.000Z`,
        paid,
        externalDocument: cfg.showExternalDoc ? externalDoc.trim() || null : null,
        customerId: selectedParty!.id,
        customerName: selectedParty!.name,
        warehouseId: warehouseId || null,
        total: saveTotals.gross,
        subtotal: saveTotals.net,
        tax: saveTotals.tax,
        discount: 0,
        paymentMethod: resolvedPaymentMethod,
        items: items.map(({ lineNet: _n, lineTax: _t, lineGross: _g, ...item }) => item),
      };

      const res = await fetch(`${getPosApiBase()}/documentos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getPosUserAuthHeaders() },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error || body?.message || `Falha ao guardar documento (${res.status})`);
      }

      const body = await res.json().catch(() => null);
      const savedNumber =
        body?.documentNumber || body?.data?.documentNumber || docNumber;
      setSuccessHint(cfg.successHint(String(savedNumber)));
      resetPaymentState();
      await onSaved();
      window.setTimeout(() => {
        onClose();
      }, 650);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Falha ao guardar o documento.';
      setError(message);
      setPaymentFinalizeError(message);
    } finally {
      setSaving(false);
    }
  };

  const handleFinalizePayment = () => {
    if (isMultiplePayment) {
      const paidSum = payments.reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
      if (payments.length === 0 || paidSum + 0.009 < totals.gross) {
        setPaymentFinalizeError('Complete o pagamento (valor recebido insuficiente).');
        return;
      }
      void handleSave({
        paid: true,
        paymentMethod: payments.map((entry) => entry.method).join(' + '),
      });
      return;
    }
    if (!paymentMethod) {
      setPaymentFinalizeError('Seleccione o método de pagamento.');
      return;
    }
    const received = Number(String(receivedAmount).replace(',', '.'));
    if (!(received > 0) || received + 0.009 < totals.gross) {
      setPaymentFinalizeError('Indique o valor recebido (igual ou superior ao total).');
      return;
    }
    void handleSave({
      paid: true,
      paymentMethod: String(paymentMethod),
    });
  };

  if (!isOpen) return null;

  return (
    <>
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-[#0f0f0f] text-zinc-300">
        <div className="min-h-0 flex-1 overflow-y-auto custom-scrollbar px-6 py-5">
          <div className="mx-auto w-full max-w-6xl">
          <div
            className={`grid grid-cols-1 gap-3 sm:grid-cols-2 ${
              cfg.showWarehouse && cfg.showExternalDoc
                ? 'lg:grid-cols-4'
                : cfg.showWarehouse || cfg.showExternalDoc
                  ? 'lg:grid-cols-3'
                  : 'lg:grid-cols-2'
            }`}
          >
            <label className="block min-w-0 space-y-1.5">
              <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                <Building2 size={12} /> {cfg.partyLabel}
              </span>
              <PosSelect
                value={partyId}
                onChange={handlePartySelect}
                disabled={loadingMeta || saving}
                size="md"
                placeholder={cfg.partyPlaceholder}
                options={partyOptions}
              />
            </label>

            {cfg.showWarehouse ? (
              <label className="block min-w-0 space-y-1.5">
                <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                  {cfg.warehouseLabel}
                </span>
                <PosSelect
                  value={warehouseId}
                  onChange={setWarehouseId}
                  disabled={loadingMeta || saving || warehouses.length === 0}
                  size="md"
                  placeholder="Seleccione o armazém…"
                  options={warehouses.map((w) => ({
                    value: w.id,
                    label: w.isDefault ? `${w.name} (principal)` : w.name,
                  }))}
                />
              </label>
            ) : null}

            {cfg.showExternalDoc ? (
              <label className="block min-w-0 space-y-1.5">
                <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                  <FileText size={12} /> Doc. externo
                </span>
                <input
                  type="text"
                  value={externalDoc}
                  onChange={(event) => setExternalDoc(event.target.value)}
                  placeholder="Nº da fatura do fornecedor"
                  disabled={saving}
                  className="pos-field h-10 w-full border border-[#3f3f46] px-3 text-sm placeholder:text-zinc-600"
                />
              </label>
            ) : null}

            <label className="block min-w-0 space-y-1.5">
              <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                <CalendarDays size={12} /> Data
              </span>
              <input
                type="date"
                value={documentDate}
                readOnly
                tabIndex={-1}
                disabled={saving}
                className="pos-field h-10 w-full border border-[#3f3f46] px-3 text-sm text-zinc-400"
              />
            </label>
          </div>

          <div className="mt-5 border-t border-zinc-800 pt-4">
            <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">
              {cfg.productsLabel}
            </span>
            <div className="relative mt-2" ref={productPickerRef}>
              <Search
                size={14}
                className="pointer-events-none absolute left-3 top-1/2 z-[1] -translate-y-1/2 text-zinc-500"
              />
              <input
                type="text"
                value={productQuery}
                onChange={(event) => {
                  setProductQuery(event.target.value);
                  setProductPickerOpen(true);
                }}
                onFocus={() => setProductPickerOpen(true)}
                onClick={() => setProductPickerOpen(true)}
                placeholder="Pesquisar produto por nome ou código…"
                disabled={saving}
                className="pos-field h-10 border border-[#3f3f46] pl-9 pr-9 text-sm placeholder:text-zinc-600"
                autoComplete="off"
              />
              <ChevronDown
                size={14}
                className={`pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[#0001fb] transition-transform ${
                  productPickerOpen ? 'rotate-180' : ''
                }`}
              />

              {productPickerOpen ? (
                <div className="pos-dropdown absolute left-0 right-0 top-full z-50 mt-1 max-h-72 overflow-y-auto custom-scrollbar">
                  {visiblePickerProducts.length === 0 ? (
                    <p className="px-3 py-2 text-xs text-zinc-500">Nenhum produto encontrado.</p>
                  ) : (
                    <>
                      {visiblePickerProducts.map((product) => (
                        <button
                          key={product.id}
                          type="button"
                          onClick={() => addProduct(product)}
                          className="pos-dropdown-item !flex !items-center !justify-between gap-3"
                        >
                          <span className="min-w-0 truncate text-left text-zinc-100">
                            {product.name}
                          </span>
                          <span className="shrink-0 text-xs text-zinc-500">
                            {product.code != null && String(product.code).trim()
                              ? String(product.code)
                              : '—'}
                          </span>
                        </button>
                      ))}
                      {products.length > PRODUCT_PREVIEW_LIMIT ? (
                        <button
                          type="button"
                          onClick={() => {
                            setProductPickerOpen(false);
                            setProductMultiOpen(true);
                          }}
                          className="pos-dropdown-item mt-0.5 !text-[#a5b4fc] hover:!bg-[var(--pos-brand-hover-bg)]"
                        >
                          Ver mais…
                        </button>
                      ) : null}
                    </>
                  )}
                </div>
              ) : null}
            </div>

            <div className="mt-3 overflow-hidden rounded-[0.4rem] border border-[#3f3f46]">
              <div
                className={`grid items-center gap-2 border-b border-zinc-800 bg-[#141414] px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-zinc-500 ${
                  cfg.useCostPrice
                    ? 'grid-cols-[minmax(0,1.2fr)_72px_90px_88px_120px_92px_40px]'
                    : 'grid-cols-[minmax(0,1.2fr)_72px_88px_120px_92px_40px]'
                }`}
              >
                <span>Produto</span>
                <span className="block w-full text-right">Qtd</span>
                {cfg.useCostPrice ? <span className="block w-full text-left">Lote</span> : null}
                <span className="block w-full text-right">Pago/un</span>
                <span className="block w-full text-left">Imposto</span>
                <span className="block w-full text-right">Total</span>
                <span />
              </div>
              {lines.length === 0 ? (
                <p className="px-3 py-8 text-center text-xs text-zinc-500">
                  Ainda sem linhas. Pesquise e adicione produtos acima.
                </p>
              ) : (
                <div className="divide-y divide-zinc-800/80">
                  {lines.map((line) => {
                    const br = breakdownLine(line, taxRates);
                    return (
                      <div
                        key={line.key}
                        className={`grid items-start gap-2 px-3 py-2 ${
                          cfg.useCostPrice
                            ? 'grid-cols-[minmax(0,1.2fr)_72px_90px_88px_120px_92px_40px]'
                            : 'grid-cols-[minmax(0,1.2fr)_72px_88px_120px_92px_40px]'
                        }`}
                      >
                        <div className="min-w-0 pt-1.5">
                          <p className="truncate text-sm font-medium text-zinc-100">{line.name}</p>
                          <p className="text-[10px] text-zinc-500">
                            {cfg.useCostPrice
                              ? `Último custo de compra ${formatMoneyMt(line.lastPurchaseCost ?? 0)}`
                              : `Preço de venda ${formatMoneyMt(line.unitPrice)}`}
                          </p>
                        </div>
                        <input
                          type="number"
                          min={0}
                          step="any"
                          value={line.quantity}
                          onChange={(event) =>
                            updateLine(line.key, {
                              quantity: Math.max(0, Number(event.target.value) || 0),
                            })
                          }
                          disabled={saving}
                          className="pos-field h-9 w-full border border-[#3f3f46] px-2 text-right text-sm"
                        />
                        {cfg.useCostPrice ? (
                          line.trackLot ? (
                            <input
                              type="text"
                              value={line.lotCode ?? ''}
                              onChange={(event) =>
                                updateLine(line.key, { lotCode: event.target.value })
                              }
                              disabled={saving}
                              placeholder="Lote"
                              className="pos-field h-9 w-full border border-[#3f3f46] px-2 text-sm"
                            />
                          ) : (
                            <span className="flex h-9 items-center justify-center text-xs text-zinc-600">—</span>
                          )
                        ) : null}
                        <input
                          type="number"
                          min={0}
                          step="any"
                          value={line.unitPrice}
                          onChange={(event) =>
                            updateLine(line.key, {
                              unitPrice: Math.max(0, Number(event.target.value) || 0),
                            })
                          }
                          disabled={saving}
                          title="Valor pago por unidade (com imposto, se a taxa incluir IVA)"
                          className="pos-field h-9 w-full border border-[#3f3f46] px-2 text-right text-sm"
                        />
                        <PosSelect
                          value={line.taxRateId}
                          onChange={(taxRateId) => updateLine(line.key, { taxRateId })}
                          disabled={saving || taxRates.length === 0}
                          options={taxRates
                            .filter((rate) => rate.enabled !== false || rate.id === line.taxRateId)
                            .map((rate) => ({
                              value: rate.id,
                              label: `${rate.code || rate.name} ${
                                rate.isFixed
                                  ? `(${formatMoneyMt(rate.rate)})`
                                  : `(${Number(rate.rate)}%)`
                              }`,
                            }))}
                          className="!h-9 text-xs"
                        />
                        <span className="flex h-9 items-center justify-end text-sm font-semibold text-zinc-200">
                          {formatMoneyMt(br.lineGross)}
                        </span>
                        <button
                          type="button"
                          onClick={() => removeLine(line.key)}
                          disabled={saving}
                          className="mt-0.5 flex h-9 w-9 items-center justify-center rounded text-zinc-500 transition-colors hover:bg-rose-950/40 hover:text-rose-300"
                          aria-label="Remover linha"
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="mt-3 flex justify-end border-t border-zinc-800 pt-3">
              <div className="inline-grid grid-cols-[auto_auto] items-baseline gap-x-8 gap-y-1 text-right text-white tabular-nums">
                <span className="text-sm text-zinc-400">Valor sem imposto:</span>
                <span className="text-sm font-semibold text-zinc-100">{formatMoneyMt(totals.net)}</span>
                <span className="text-sm text-zinc-400">{taxSummaryLabel}</span>
                <span className="text-sm font-semibold text-zinc-100">{formatMoneyMt(totals.tax)}</span>
                <span className="text-base font-bold text-white">Total:</span>
                <span className="text-lg font-bold text-white">{formatMoneyMt(totals.gross)}</span>
              </div>
            </div>
          </div>

          {error ? <p className="mt-3 text-xs text-rose-400">{error}</p> : null}
          {successHint ? <p className="mt-3 text-xs text-[#a5b4fc]">{successHint}</p> : null}
          </div>
        </div>

        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-zinc-800 bg-[#141414] px-6 py-4">
          <button
            type="button"
            disabled={saving}
            onClick={onClose}
            className="rounded border border-zinc-600 px-4 py-2 text-sm text-zinc-300 transition-colors hover:border-[#0001fb] hover:text-white disabled:opacity-40"
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={saving || loadingMeta}
            onClick={() => {
              if (cfg.requirePayment) {
                void openPaymentFlow();
                return;
              }
              void handleSave();
            }}
            className="inline-flex items-center gap-2 rounded bg-[#0001fb] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#1a1bff] disabled:opacity-50"
          >
            {saving ? (
              <Loader2 size={16} className="animate-spin" />
            ) : cfg.requirePayment ? (
              <Banknote size={16} />
            ) : (
              <PackagePlus size={16} />
            )}
            {cfg.saveLabel}
          </button>
        </div>
      </div>

      <PurchaseProductMultiSelectModal
        isOpen={productMultiOpen}
        products={products}
        initialQuery={productQuery}
        onClose={() => setProductMultiOpen(false)}
        onConfirm={addProductsBatch}
      />

      <CustomerSupplierFormModal
        isOpen={isCreatePartyOpen}
        initialValues={partyCreateDefaults}
        onClose={() => setIsCreatePartyOpen(false)}
        onSaved={handlePartyCreated}
      />

      <PaymentModal
        isOpen={isPaymentOpen}
        onClose={() => {
          if (saving) return;
          resetPaymentState();
        }}
        selectedCustomer={
          selectedParty
            ? { id: selectedParty.id, name: selectedParty.name, phone: '' }
            : null
        }
        customerName={selectedParty?.name || ''}
        tableNumber=""
        cart={paymentCart}
        globalDiscount={null}
        originalTotal={totals.gross}
        subtotal={totals.net}
        tax={totals.tax}
        totalDiscount={0}
        total={totals.gross}
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
        onFinalize={handleFinalizePayment}
        isFinalizing={saving}
        finalizeError={paymentFinalizeError}
        isReceiptPrintEnabled={false}
        onToggleReceiptPrint={() => undefined}
        formatPrice={formatMoneyMt}
        docType="VD"
        title="Finalizar Pagamento"
        contextLabel={docNumber ? `Doc: ${docNumber}` : 'Venda a dinheiro'}
        hideReceiptPrint
      />
    </>
  );
}
