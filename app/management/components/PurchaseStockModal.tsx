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
} from 'lucide-react';
import { getPosApiBase } from '@/lib/apiBase';
import { unwrapApiSuccessPayload } from '@/lib/apiResponse';
import { formatMoneyMt } from '@/lib/currency';
import { computeTaxFromBasePrice } from '@/lib/taxMath';
import { getCachedTaxRates, setCachedTaxRates } from '@/lib/posSessionCache';
import PosSelect from '@/components/PosSelect';
import { fetchWarehouses, type PosWarehouse } from '@/lib/services/posService';
import { PurchaseProductMultiSelectModal } from '@/app/management/components/PurchaseProductMultiSelectModal';

export type PurchaseProductOption = {
  id: string;
  name: string;
  code?: number;
  cost?: number;
  unit?: string;
  stock_quantity?: number;
  track_lot?: boolean;
  tax_rate_id?: string | null;
};

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
};

const CUSTOMERS_META_KEY = 'customers-manager-meta';
const DEFAULT_SUPPLIER_NAME = 'Fornecedor';
const DEFAULT_SUPPLIER_PHONE = '000000000';

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

type PurchaseStockModalProps = {
  isOpen: boolean;
  onClose: () => void;
  products: PurchaseProductOption[];
  initialProductId?: string | null;
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
  onSaved,
}: PurchaseStockModalProps) {
  const [parties, setParties] = useState<PartyOption[]>([]);
  const [partyId, setPartyId] = useState('');
  const [documentDate, setDocumentDate] = useState(() => toInputDate(new Date()));
  const [externalDoc, setExternalDoc] = useState('');
  const [docNumber, setDocNumber] = useState('FTF/…');
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
  const [warehouses, setWarehouses] = useState<PosWarehouse[]>([]);
  const [warehouseId, setWarehouseId] = useState('');
  const [taxRates, setTaxRates] = useState<TaxRateOption[]>(
    () => (getCachedTaxRates() as TaxRateOption[] | null) ?? [],
  );

  const selectedParty = useMemo(
    () => parties.find((p) => String(p.id) === String(partyId)) ?? null,
    [parties, partyId],
  );

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

  const loadMeta = useCallback(async () => {
    setLoadingMeta(true);
    setError('');
    try {
      const year = new Date(documentDate).getFullYear() || new Date().getFullYear();
      const [partyRes, nextRes, whRows, taxRes] = await Promise.all([
        fetch(`${getPosApiBase()}/clientes`),
        fetch(`${getPosApiBase()}/documentos/next-number?prefix=${encodeURIComponent('FTF')}&year=${year}`),
        fetchWarehouses(),
        fetch(`${getPosApiBase()}/tax-rates`),
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
      const allParties: PartyOption[] = (Array.isArray(partyData) ? partyData : [])
        .map((row) => ({
          id: String(row.id),
          name: String(row.name ?? 'Sem nome'),
        }))
        .sort((a, b) => a.name.localeCompare(b.name, 'pt'));

      let metaById = readPartyMetaById();
      let suppliers = allParties.filter((party) => isSupplierParty(party.id, metaById));

      // Sem fornecedor configurado → usar/criar "Fornecedor" por defeito.
      if (suppliers.length === 0) {
        const existingDefault = allParties.find((party) => isDefaultSupplierName(party.name));
        if (existingDefault) {
          writePartyMeta(existingDefault.id, {
            active: true,
            isCustomer: false,
            taxExempt: false,
          });
          metaById = readPartyMetaById();
          suppliers = [existingDefault];
        } else {
          const createRes = await fetch(`${getPosApiBase()}/clientes`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
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
              suppliers = [{ id: createdId, name: DEFAULT_SUPPLIER_NAME }];
            }
          }
        }
      }

      setParties(suppliers);
      setPartyId(suppliers[0]?.id ?? '');


      if (nextRes.ok) {
        const nextJson = await nextRes.json();
        const payload = unwrapApiSuccessPayload<any>(nextJson) ?? nextJson;
        const number =
          payload?.documentNumber ||
          payload?.number ||
          payload?.nextNumber ||
          (payload?.sequence != null
            ? `FTF/${year}/${String(payload.sequence).padStart(5, '0')}`
            : null);
        if (number) setDocNumber(String(number));
        else setDocNumber(`FTF/${year}/00001`);
      } else {
        setDocNumber(`FTF/${year}/00001`);
      }
    } catch {
      setError('Não foi possível carregar fornecedores / número do documento.');
    } finally {
      setLoadingMeta(false);
    }
  }, [documentDate]);

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

    const initial = initialProductId
      ? products.find((p) => String(p.id) === String(initialProductId))
      : null;
    if (initial) {
      const taxRateId = resolveTaxRateId(initial.tax_rate_id, taxRates);
      const lastPurchaseCost = roundMoney(Math.max(0, Number(initial.cost ?? 0) || 0));
      setLines([
        {
          key: newLineKey(),
          productId: String(initial.id),
          name: initial.name,
          unit: initial.unit || 'un',
          quantity: 1,
          unitPrice: seedPaidUnitPrice(lastPurchaseCost, taxRateId, taxRates),
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
  }, [isOpen, initialProductId]);

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
  }, [isOpen, onClose, saving, productPickerOpen, productMultiOpen]);

  const buildPurchaseLine = (product: PurchaseProductOption): PurchaseLine => {
    const taxRateId = resolveTaxRateId(product.tax_rate_id, taxRates) || defaultTaxRateId;
    const lastPurchaseCost = roundMoney(Math.max(0, Number(product.cost ?? 0) || 0));
    return {
      key: newLineKey(),
      productId: String(product.id),
      name: product.name,
      unit: product.unit || 'un',
      quantity: 1,
      unitPrice: seedPaidUnitPrice(lastPurchaseCost, taxRateId, taxRates),
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

  const handleSave = async () => {
    if (saving) return;
    setError('');
    setSuccessHint('');

    if (!partyId || !selectedParty) {
      setError('Selecione o fornecedor da compra.');
      return;
    }
    if (lines.length === 0) {
      setError('Adicione pelo menos um produto à compra.');
      return;
    }
    if (lines.some((line) => !(line.quantity > 0))) {
      setError('Todas as quantidades devem ser maiores que zero.');
      return;
    }
    if (lines.some((line) => line.trackLot && !String(line.lotCode ?? '').trim())) {
      setError('Indique o código do lote para os produtos que controlam lote.');
      return;
    }
    if (!warehouseId) {
      setError('Seleccione o armazém destino.');
      return;
    }

    setSaving(true);
    try {
      const items = lines.map((line) => {
        const br = breakdownLine(line, taxRates);
        const rate = taxRates.find((r) => r.id === line.taxRateId);
        return {
          productId: line.productId,
          name: line.name,
          quantity: line.quantity,
          // Custo líquido (sem IVA) → camada FIFO / products.cost
          unitPrice: br.unitNet,
          unitGross: br.unitGross,
          taxAmount: br.unitTax,
          taxRateId: line.taxRateId || null,
          taxRate: rate ? Number(rate.rate) || 0 : 0,
          discountAmount: 0,
          lotCode: line.trackLot ? String(line.lotCode ?? '').trim() || null : null,
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

      const payload = {
        documentType: 'Compra',
        prefix: 'FTF',
        documentDate: `${documentDate}T00:00:00.000Z`,
        dueDate: `${documentDate}T00:00:00.000Z`,
        paid: false,
        externalDocument: externalDoc.trim() || null,
        customerId: selectedParty.id,
        customerName: selectedParty.name,
        warehouseId,
        total: saveTotals.gross,
        subtotal: saveTotals.net,
        tax: saveTotals.tax,
        discount: 0,
        paymentMethod: null,
        items: items.map(({ lineNet: _n, lineTax: _t, lineGross: _g, ...item }) => item),
      };

      const res = await fetch(`${getPosApiBase()}/documentos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error || body?.message || `Falha ao guardar compra (${res.status})`);
      }

      const body = await res.json().catch(() => null);
      const savedNumber =
        body?.documentNumber || body?.data?.documentNumber || docNumber;
      setSuccessHint(`Compra ${savedNumber} registada (não paga). Stock actualizado.`);
      await onSaved();
      window.setTimeout(() => {
        onClose();
      }, 650);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao guardar a compra.');
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <>
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-[#0f0f0f] text-zinc-300">
        <div className="min-h-0 flex-1 overflow-y-auto custom-scrollbar px-6 py-5">
          <div className="mx-auto w-full max-w-6xl">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
            <label className="md:col-span-2 block space-y-1.5">
              <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                <Building2 size={12} /> Fornecedor
              </span>
              <PosSelect
                value={partyId}
                onChange={setPartyId}
                disabled={loadingMeta || saving}
                size="md"
                placeholder={parties.length === 0 ? 'A criar fornecedor padrão…' : 'Seleccione o fornecedor…'}
                options={[
                  {
                    value: '',
                    label: parties.length === 0 ? 'A criar fornecedor padrão…' : 'Seleccione o fornecedor…',
                  },
                  ...parties.map((party) => ({ value: party.id, label: party.name })),
                ]}
              />
            </label>

            <label className="block space-y-1.5">
              <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                <CalendarDays size={12} /> Data
              </span>
              <input
                type="date"
                value={documentDate}
                onChange={(event) => setDocumentDate(event.target.value)}
                disabled={saving}
                className="pos-field h-10 border border-[#3f3f46] px-3 text-sm"
              />
            </label>

            <label className="md:col-span-2 block space-y-1.5">
              <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                Armazém destino
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

            <label className="block space-y-1.5">
              <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                <FileText size={12} /> Doc. externo
              </span>
              <input
                type="text"
                value={externalDoc}
                onChange={(event) => setExternalDoc(event.target.value)}
                placeholder="Factura do fornecedor"
                disabled={saving}
                className="pos-field h-10 border border-[#3f3f46] px-3 text-sm placeholder:text-zinc-600"
              />
            </label>
          </div>

          <div className="mt-5 border-t border-zinc-800 pt-4">
            <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">
              Produtos da compra
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
              <div className="grid grid-cols-[minmax(0,1.2fr)_72px_90px_88px_120px_92px_40px] items-center gap-2 border-b border-zinc-800 bg-[#141414] px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                <span>Produto</span>
                <span className="block w-full text-right">Qtd</span>
                <span className="block w-full text-left">Lote</span>
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
                        className="grid grid-cols-[minmax(0,1.2fr)_72px_90px_88px_120px_92px_40px] items-start gap-2 px-3 py-2"
                      >
                        <div className="min-w-0 pt-1.5">
                          <p className="truncate text-sm font-medium text-zinc-100">{line.name}</p>
                          <p className="text-[10px] text-zinc-500">
                            Último custo de compra {formatMoneyMt(line.lastPurchaseCost ?? 0)}
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
                        {line.trackLot ? (
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
                        )}
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
            onClick={() => void handleSave()}
            className="inline-flex items-center gap-2 rounded bg-[#0001fb] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#1a1bff] disabled:opacity-50"
          >
            {saving ? <Loader2 size={16} className="animate-spin" /> : <PackagePlus size={16} />}
            Guardar compra
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
    </>
  );
}
