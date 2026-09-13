'use client';

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { 
  RotateCcw, History, Printer, FileText, FileSpreadsheet, 
  PackagePlus, Zap, HelpCircle, Search, ChevronRight, ChevronLeft,
  ChevronDown, Folder, Loader2, AlertCircle, Delete, CornerDownLeft, X,
  CalendarDays, Check, ArrowLeftRight
} from 'lucide-react';

import { getPosApiBase, getPosUserAuthHeaders } from '@/lib/apiBase';
import { unwrapApiSuccessPayload } from '@/lib/apiResponse';
import {
  getCachedCategories,
  getCachedWarehouses,
  getPosCatalogCache,
  setCachedWarehouses,
} from '@/lib/posSessionCache';
import { publishLocalCatalog } from '@/lib/catalogLocalSync';
import { formatMoneyMt } from '@/lib/currency';
import { calcMargin } from '@/lib/margin';
import { usePermissions } from '@/hooks/usePermissions';
import { setStockCountedQuantity, fetchWarehouses, type PosWarehouse } from '@/lib/services/posService';
import PurchaseStockModal from '@/app/management/components/PurchaseStockModal';
import TransferStockModal from '@/app/management/components/TransferStockModal';
import { ManagementToolbarButton, ManagementToolbarDivider } from '@/components/ManagementToolbarButton';
import PosSelect from '@/components/PosSelect';

interface Product {
  id: string;
  code?: number;
  name: string;
  category_id?: string;
  price: number;
  cost?: number;
  tax?: number;
  final_price?: number;
  unit?: string;
  stock_quantity: number;
  warehouse_quantity?: number | null;
  is_service?: boolean;
  product_kind?: 'simple' | 'composed' | 'ingredient' | 'service';
  track_lot?: boolean;
  tax_rate_id?: string | null;
  categories?: {
    name: string;
  };
}

interface Category {
  id: string;
  name: string;
}

interface ProductHistoryRow {
  id: string;
  product_id: string | null;
  product_name: string;
  movement_type: string;
  document_type: string | null;
  document_number: string | null;
  document_id: string | null;
  customer_name: string;
  warehouse_name?: string | null;
  quantity: number;
  quantity_abs: number;
  unit_price: number;
  discount_amount: number;
  date: string;
}

export default function InventoryManager() {
  const { can } = usePermissions();
  const canSeeCost = can('estoque.ver_preco_custo');
  const [products, setProducts] = useState<Product[]>(
    () => (getPosCatalogCache()?.products as Product[] | undefined) ?? []
  );
  const [categories, setCategories] = useState<Category[]>(
    () => (getCachedCategories() as Category[] | null) ?? []
  );
  const [loading, setLoading] = useState(
    () => !getPosCatalogCache()?.products?.length && !getCachedCategories()?.length
  );
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [isTreeExpanded, setIsTreeExpanded] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(240);
  const [isResizing, setIsResizing] = useState(false);
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyRows, setHistoryRows] = useState<ProductHistoryRow[]>([]);
  const [historyError, setHistoryError] = useState('');
  const [historyFrom, setHistoryFrom] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return toInputDate(d);
  });
  const [historyTo, setHistoryTo] = useState(() => toInputDate(new Date()));
  const [tempHistoryFrom, setTempHistoryFrom] = useState(historyFrom);
  const [tempHistoryTo, setTempHistoryTo] = useState(historyTo);
  const [calendarStartMonth, setCalendarStartMonth] = useState(`${historyFrom.slice(0, 7)}-01`);
  const [calendarEndMonth, setCalendarEndMonth] = useState(`${historyTo.slice(0, 7)}-01`);
  const [isPeriodModalOpen, setIsPeriodModalOpen] = useState(false);
  const [activePreset, setActivePreset] = useState<string | null>(null);
  const [isQuickOpen, setIsQuickOpen] = useState(false);
  const [isPurchaseOpen, setIsPurchaseOpen] = useState(false);
  const [isTransferOpen, setIsTransferOpen] = useState(false);
  const [warehouses, setWarehouses] = useState<PosWarehouse[]>(
    () => getCachedWarehouses() ?? []
  );
  const [filterWarehouseId, setFilterWarehouseId] = useState('');
  const [quickWarehouseId, setQuickWarehouseId] = useState('');
  const [quickValue, setQuickValue] = useState('0');
  const [quickOverwrite, setQuickOverwrite] = useState(true);
  const [quickSaving, setQuickSaving] = useState(false);
  const [quickError, setQuickError] = useState('');
  const quickInputRef = useRef<HTMLInputElement>(null);

  // Filters
  const [filterNegative, setFilterNegative] = useState(false);
  const [filterNonZero, setFilterNonZero] = useState(false);
  const [filterZero, setFilterZero] = useState(false);

  const formatPrice = (value: number) => formatMoneyMt(Number(value ?? 0));

  const fetchData = async (warehouseId?: string) => {
    const whParam = warehouseId ?? filterWarehouseId;
    const hasCache =
      !whParam &&
      (Boolean(getPosCatalogCache()?.products?.length) || Boolean(getCachedCategories()?.length));
    if (!hasCache) setLoading(true);
    try {
      const authHeaders = getPosUserAuthHeaders();
      const productsUrl = whParam
        ? `${getPosApiBase()}/produtos?warehouseId=${encodeURIComponent(whParam)}`
        : `${getPosApiBase()}/produtos`;
      const [catRes, prodRes, whRows] = await Promise.all([
        fetch(`${getPosApiBase()}/categorias`, { headers: { ...authHeaders } }),
        fetch(productsUrl, { headers: { ...authHeaders } }),
        fetchWarehouses().catch(() => [] as PosWarehouse[]),
      ]);
      const catData = unwrapApiSuccessPayload<any[]>(await catRes.json());
      const prodData = unwrapApiSuccessPayload<any[]>(await prodRes.json());
      setCategories(catData || []);
      setProducts(prodData || []);
      const activeWh = (whRows || []).filter((w) => w.isActive);
      setWarehouses(activeWh);
      setCachedWarehouses(activeWh);
      if (!whParam) {
        publishLocalCatalog({
          products: prodData || [],
          categories: catData || [],
        });
      } else {
        // Stock filtrado por armazém não substitui o catálogo POS global.
      }
      if (!filterWarehouseId) {
        const def = activeWh.find((w) => w.isDefault) || activeWh[0];
        if (def) {
          setFilterWarehouseId(def.id);
          setQuickWarehouseId(def.id);
        }
      } else if (!quickWarehouseId) {
        setQuickWarehouseId(filterWarehouseId);
      }
    } catch (error) {
      console.error('Error fetching inventory data:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!filterWarehouseId) return;
    void fetchData(filterWarehouseId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterWarehouseId]);

  useEffect(() => {
    if (!isPeriodModalOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsPeriodModalOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isPeriodModalOpen]);

  const openPeriodModal = () => {
    setTempHistoryFrom(historyFrom);
    setTempHistoryTo(historyTo);
    setCalendarStartMonth(`${historyFrom.slice(0, 7)}-01`);
    setCalendarEndMonth(`${historyTo.slice(0, 7)}-01`);
    setIsPeriodModalOpen(true);
  };

  const applyPeriod = () => {
    if (tempHistoryFrom > tempHistoryTo) return;
    setHistoryFrom(tempHistoryFrom);
    setHistoryTo(tempHistoryTo);
    setIsPeriodModalOpen(false);
  };

  const applyPresetPeriod = (
    preset: 'today' | 'yesterday' | 'thisWeek' | 'lastWeek' | 'thisMonth' | 'lastMonth' | 'thisYear' | 'lastYear'
  ) => {
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

    const startInput = toInputDate(start);
    const endInput = toInputDate(end);
    setTempHistoryFrom(startInput);
    setTempHistoryTo(endInput);
    setCalendarStartMonth(`${startInput.slice(0, 7)}-01`);
    setCalendarEndMonth(`${endInput.slice(0, 7)}-01`);
    setActivePreset(preset);
  };

  const startResizing = (e: React.MouseEvent) => {
    setIsResizing(true);
    e.preventDefault();
  };

  const stopResizing = () => {
    setIsResizing(false);
  };

  const resize = React.useCallback((e: MouseEvent) => {
    if (isResizing) {
      const newWidth = e.clientX;
      if (newWidth > 150 && newWidth < 600) {
        setSidebarWidth(newWidth);
      }
    }
  }, [isResizing]);

  useEffect(() => {
    window.addEventListener('mousemove', resize);
    window.addEventListener('mouseup', stopResizing);
    return () => {
      window.removeEventListener('mousemove', resize);
      window.removeEventListener('mouseup', stopResizing);
    };
  }, [isResizing, resize]);

  const filteredProducts = useMemo(() => {
    return products.filter(p => {
      const matchesSearch = p.name.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesCategory = !selectedCategory || p.category_id === selectedCategory;
      
      let matchesFilter = true;
      if (filterNegative || filterNonZero || filterZero) {
        matchesFilter = false;
        if (filterNegative && p.stock_quantity < 0) matchesFilter = true;
        if (filterNonZero && p.stock_quantity !== 0) matchesFilter = true;
        if (filterZero && p.stock_quantity === 0) matchesFilter = true;
      }

      return matchesSearch && matchesCategory && matchesFilter;
    });
  }, [products, searchQuery, selectedCategory, filterNegative, filterNonZero, filterZero]);

  const stockSelectableProducts = useMemo(
    () =>
      products.filter(
        (p) =>
          !p.is_service &&
          (p.product_kind ?? 'simple') !== 'composed'
      ),
    [products],
  );

  const stats = useMemo(() => {
    const stockProducts = products.filter((p) => !p.is_service);
    const negative = stockProducts.filter((p) => p.stock_quantity < 0).length;
    const zero = stockProducts.filter((p) => p.stock_quantity === 0).length;
    const positive = stockProducts.filter((p) => p.stock_quantity > 0).length;

    const totalCost = filteredProducts.reduce((acc, p) => acc + ((p.cost || 0) * Math.abs(p.stock_quantity)), 0);
    const totalCostWithTax = filteredProducts.reduce((acc, p) => acc + (((p.cost || 0) + (p.tax || 0)) * Math.abs(p.stock_quantity)), 0);
    const totalSales = filteredProducts.reduce((acc, p) => acc + (p.price * Math.abs(p.stock_quantity)), 0);
    const totalSalesWithTax = filteredProducts.reduce((acc, p) => acc + ((p.final_price || p.price) * Math.abs(p.stock_quantity)), 0);

    return { negative, zero, positive, totalCost, totalCostWithTax, totalSales, totalSalesWithTax };
  }, [products, filteredProducts]);

  const selectedProduct = useMemo(
    () => products.find((p) => String(p.id) === String(selectedProductId)) ?? null,
    [products, selectedProductId]
  );
  const filteredHistoryRows = useMemo(() => {
    const fromMs = historyFrom ? Date.parse(`${historyFrom}T00:00:00`) : Number.NEGATIVE_INFINITY;
    const toMs = historyTo ? Date.parse(`${historyTo}T23:59:59.999`) : Number.POSITIVE_INFINITY;
    return historyRows.filter((row) => {
      const rowMs = Date.parse(String(row.date ?? ''));
      if (!Number.isFinite(rowMs)) return false;
      return rowMs >= fromMs && rowMs <= toMs;
    });
  }, [historyFrom, historyRows, historyTo]);

  const sortedHistoryRows = useMemo(() => {
    const parseDocumentSequence = (documentNumber: string | null) => {
      const raw = String(documentNumber ?? '').trim();
      if (!raw) return 0;
      const parts = raw.split('/');
      const lastPart = parts[parts.length - 1] ?? '';
      const sequence = Number(lastPart);
      return Number.isFinite(sequence) ? sequence : 0;
    };

    return [...filteredHistoryRows].sort((a, b) => {
      const aTime = Date.parse(String(a.date ?? '')) || 0;
      const bTime = Date.parse(String(b.date ?? '')) || 0;
      if (bTime !== aTime) return bTime - aTime;

      const aDocSeq = parseDocumentSequence(a.document_number ?? null);
      const bDocSeq = parseDocumentSequence(b.document_number ?? null);
      if (bDocSeq !== aDocSeq) return bDocSeq - aDocSeq;

      const aQtyAbs = Math.abs(Number(a.quantity ?? 0));
      const bQtyAbs = Math.abs(Number(b.quantity ?? 0));
      if (bQtyAbs !== aQtyAbs) return bQtyAbs - aQtyAbs;

      return String(b.id ?? '').localeCompare(String(a.id ?? ''));
    });
  }, [filteredHistoryRows]);

  const historyRowsWithStock = useMemo(() => {
    const currentStock = Number(selectedProduct?.stock_quantity ?? 0);
    if (!Number.isFinite(currentStock)) {
      return sortedHistoryRows.map((row) => ({
        ...row,
        stock_before_movement: null as number | null,
        stock_after_movement: null as number | null,
      }));
    }

    // Stock exato por linha:
    // 1) reconstrói stock inicial usando TODO histórico (sem filtro de período);
    // 2) aplica movimentos em ordem cronológica para achar o saldo daquele momento.
    const allRowsAsc = [...historyRows].sort((a, b) => {
      const aTime = Date.parse(String(a.date ?? '')) || 0;
      const bTime = Date.parse(String(b.date ?? '')) || 0;
      if (aTime !== bTime) return aTime - bTime;
      return String(a.id ?? '').localeCompare(String(b.id ?? ''));
    });

    const totalDelta = allRowsAsc.reduce((acc, row) => {
      const qty = Number(row.quantity ?? 0);
      return Number.isFinite(qty) ? acc + qty : acc;
    }, 0);

    let runningStock = currentStock - totalDelta;
    const stockByMovementId = new Map<string, { before: number; after: number }>();
    for (const row of allRowsAsc) {
      const stockBeforeMovement = runningStock;
      const qty = Number(row.quantity ?? 0);
      if (Number.isFinite(qty)) {
        runningStock += qty;
      }
      stockByMovementId.set(String(row.id ?? ''), {
        before: stockBeforeMovement,
        after: runningStock,
      });
    }

    return sortedHistoryRows.map((row) => {
      const snapshot = stockByMovementId.get(String(row.id ?? ''));
      return {
        ...row,
        stock_before_movement: snapshot?.before ?? null,
        stock_after_movement: snapshot?.after ?? null,
      };
    });
  }, [historyRows, selectedProduct?.stock_quantity, sortedHistoryRows]);

  const fetchProductHistory = async (productId: string) => {
    setHistoryLoading(true);
    setHistoryError('');
    try {
      const res = await fetch(`${getPosApiBase()}/produtos/${productId}/historico`, {
        headers: { ...getPosUserAuthHeaders() },
      });
      if (!res.ok) throw new Error(`Falha ao carregar historico (${res.status})`);
      const data = unwrapApiSuccessPayload<ProductHistoryRow[]>(await res.json());
      setHistoryRows(Array.isArray(data) ? data : []);
    } catch (error) {
      setHistoryRows([]);
      setHistoryError(error instanceof Error ? error.message : 'Falha ao carregar historico do produto');
    } finally {
      setHistoryLoading(false);
    }
  };

  const openHistoryModal = async () => {
    if (!selectedProductId) return;
    setIsHistoryOpen(true);
    await fetchProductHistory(selectedProductId);
  };

  const openQuickModal = () => {
    if (!selectedProduct) return;
    if (
      selectedProduct.is_service ||
      (selectedProduct.product_kind ?? 'simple') === 'composed' ||
      (selectedProduct.product_kind ?? 'simple') === 'service'
    ) {
      window.alert('Este produto está marcado como serviço (sem controlo de stock).');
      return;
    }
    setQuickValue(String(selectedProduct.stock_quantity ?? 0));
    setQuickOverwrite(true);
    setQuickError('');
    setIsQuickOpen(true);
    window.setTimeout(() => quickInputRef.current?.focus(), 50);
  };

  const closeQuickModal = useCallback(() => {
    if (quickSaving) return;
    setIsQuickOpen(false);
    setQuickError('');
  }, [quickSaving]);

  const appendQuickDigit = useCallback(
    (digit: string) => {
      setQuickError('');
      setQuickValue((prev) => {
        if (quickOverwrite) {
          setQuickOverwrite(false);
          if (digit === '.') return '0.';
          if (digit === '-') return '-';
          return digit;
        }
        if (digit === '-') {
          return prev.startsWith('-') ? prev.slice(1) || '0' : `-${prev === '0' ? '' : prev}` || '-';
        }
        if (digit === '.') {
          if (prev.includes('.')) return prev;
          return `${prev || '0'}.`;
        }
        if (prev === '0') return digit;
        if (prev === '-0') return `-${digit}`;
        return `${prev}${digit}`;
      });
    },
    [quickOverwrite],
  );

  const backspaceQuick = useCallback(() => {
    setQuickError('');
    setQuickOverwrite(false);
    setQuickValue((prev) => {
      if (prev.length <= 1 || (prev.startsWith('-') && prev.length === 2)) return '0';
      return prev.slice(0, -1);
    });
  }, []);

  const submitQuickCount = useCallback(async () => {
    if (!selectedProductId || quickSaving) return;
    const counted = Number(quickValue);
    if (!Number.isFinite(counted)) {
      setQuickError('Quantidade inválida.');
      return;
    }
    setQuickSaving(true);
    setQuickError('');
    try {
      const result = await setStockCountedQuantity(
        selectedProductId,
        counted,
        quickWarehouseId || filterWarehouseId || null,
      ) as {
        stock_after?: number;
        warehouse_qty_after?: number;
        unchanged?: boolean;
        error?: string;
      };
      if (result?.error) throw new Error(result.error);
      const stockAfter = Number(result?.stock_after);
      const whAfter = Number(result?.warehouse_qty_after);
      setProducts((prev) =>
        prev.map((p) =>
          String(p.id) === String(selectedProductId)
            ? {
                ...p,
                stock_quantity: Number.isFinite(stockAfter) ? stockAfter : counted,
                warehouse_quantity: Number.isFinite(whAfter) ? whAfter : counted,
              }
            : p,
        ),
      );
      setIsQuickOpen(false);
    } catch (error) {
      setQuickError(error instanceof Error ? error.message : 'Falha ao actualizar stock');
    } finally {
      setQuickSaving(false);
    }
  }, [quickSaving, quickValue, selectedProductId, quickWarehouseId, filterWarehouseId]);

  useEffect(() => {
    if (!isQuickOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeQuickModal();
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        void submitQuickCount();
        return;
      }
      if (e.key === 'Backspace') {
        e.preventDefault();
        backspaceQuick();
        return;
      }
      if (/^[0-9.-]$/.test(e.key)) {
        e.preventDefault();
        appendQuickDigit(e.key);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [appendQuickDigit, backspaceQuick, closeQuickModal, isQuickOpen, submitQuickCount]);

  const movementLabel = (type: string) => {
    switch (String(type).toLowerCase()) {
      case 'compra':
        return 'Compra';
      case 'entrada':
        return 'Entrada de stock';
      case 'devolucao':
        return 'Devolução';
      case 'quebra':
        return 'Quebra';
      case 'ajuste':
        return 'Regularização';
      case 'inventario':
        return 'Inventário rápido';
      case 'transferencia':
        return 'Transferência';
      case 'fatura':
        return 'Fatura (dívida)';
      default:
        return 'Venda';
    }
  };

  return (
    <div className="flex flex-col h-full bg-pos-bg text-zinc-300 overflow-hidden">
      {/* Toolbar */}
      <div className="h-16 bg-pos-surface border-b border-pos-border flex items-center px-2 gap-1 overflow-x-auto no-scrollbar">
        {isPurchaseOpen ? (
          <>
            <ManagementToolbarButton
              icon={<ChevronLeft size={20} />}
              label="Voltar"
              onClick={() => setIsPurchaseOpen(false)}
            />
            <ManagementToolbarDivider />
            <ManagementToolbarButton
              icon={<PackagePlus size={20} />}
              label="Compra"
              active
            />
            <div className="ml-auto" />
            <ManagementToolbarButton icon={<HelpCircle size={20} />} label="Ajuda" />
          </>
        ) : (
          <>
        <ManagementToolbarButton icon={<RotateCcw size={20} />} label="Atualizar" onClick={() => void fetchData()} />
        <ManagementToolbarDivider />
        <ManagementToolbarButton
          icon={<History size={20} />}
          label="Histórico"
          onClick={() => void openHistoryModal()}
          disabled={!selectedProductId}
          title={!selectedProductId ? 'Selecione um produto primeiro' : undefined}
        />
        <ManagementToolbarButton
          icon={<PackagePlus size={20} />}
          label="Compra"
          onClick={() => setIsPurchaseOpen(true)}
          active={isPurchaseOpen}
        />
        <ManagementToolbarButton
          icon={<ArrowLeftRight size={20} />}
          label="Transferir"
          onClick={() => setIsTransferOpen(true)}
        />
        <ManagementToolbarButton
          icon={<Zap size={20} />}
          label="Rápido"
          onClick={openQuickModal}
          disabled={
            !selectedProductId ||
            Boolean(selectedProduct?.is_service) ||
            (selectedProduct?.product_kind ?? 'simple') === 'composed' ||
            (selectedProduct?.product_kind ?? 'simple') === 'service'
          }
          title={!selectedProductId ? 'Selecione um produto primeiro' : undefined}
        />
        <div className="ml-auto flex min-w-[200px] items-center gap-2 px-2">
          <span className="whitespace-nowrap text-[10px] font-bold uppercase text-zinc-400">Armazém</span>
          <PosSelect
            value={filterWarehouseId}
            onChange={(value) => {
              setFilterWarehouseId(value);
              setQuickWarehouseId(value);
            }}
            options={warehouses.map((w) => ({
              value: w.id,
              label: w.isDefault ? `${w.name} (principal)` : w.name,
            }))}
            size="sm"
            triggerClassName="!h-8"
          />
        </div>
        <ManagementToolbarDivider />
        <ManagementToolbarButton icon={<Printer size={20} />} label="Imprimir" />
        <ManagementToolbarButton icon={<FileText size={20} />} label="PDF" />
        <ManagementToolbarButton icon={<FileSpreadsheet size={20} />} label="Excel" />
        <ManagementToolbarDivider />
        <ManagementToolbarButton icon={<HelpCircle size={20} />} label="Ajuda" />
          </>
        )}
      </div>

      {isPurchaseOpen ? (
        <PurchaseStockModal
          isOpen={isPurchaseOpen}
          onClose={() => setIsPurchaseOpen(false)}
          products={stockSelectableProducts}
          initialProductId={selectedProductId}
          onSaved={async () => {
            await fetchData();
          }}
        />
      ) : (
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar Tree */}
        <div 
          className="bg-pos-surface border-r border-pos-border flex flex-col relative"
          style={{ width: sidebarWidth }}
        >
          <div className="p-2 border-b border-pos-border flex items-center gap-2">
            <button 
              onClick={() => setIsTreeExpanded(!isTreeExpanded)}
              className="rounded p-1 transition-colors hover:text-[#0001fb] focus-visible:outline-none"
            >
              {isTreeExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </button>
            <Folder size={16} className="text-[#0001fb]" />
            <span 
              className={`text-xs font-bold cursor-pointer transition-colors ${
                !selectedCategory ? 'text-white hover:text-[#0001fb]' : 'text-zinc-400 hover:text-[#0001fb]'
              }`}
              onClick={() => setSelectedCategory(null)}
            >
              Produtos
            </span>
          </div>
          {isTreeExpanded && (
            <div className="flex-1 overflow-y-auto p-2 space-y-1 custom-scrollbar">
              {categories.map(cat => (
                <div 
                  key={cat.id}
                  onClick={() => setSelectedCategory(String(cat.id))}
                  className={`flex items-center gap-2 px-6 py-1.5 rounded cursor-pointer transition-colors text-xs ${
                    String(selectedCategory) === String(cat.id)
                      ? 'bg-[var(--pos-brand-selected-bg)] text-white'
                      : 'text-zinc-400 hover:text-[#0001fb]'
                  }`}
                >
                  <Folder size={14} />
                  <span className="truncate">{cat.name}</span>
                </div>
              ))}
            </div>
          )}

          {/* Resize Handle */}
          <div 
            onMouseDown={startResizing}
            className={`absolute top-0 right-0 w-1 h-full cursor-col-resize transition-colors z-20 ${
              isResizing ? 'bg-zinc-600' : 'hover:bg-zinc-600/50'
            }`}
          />
        </div>

        {/* Main Content Area */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Filters and Stats */}
          <div className="bg-pos-bg border-b border-pos-border p-2 space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <FilterCheckbox 
                  label="Quantidade negativa" 
                  checked={filterNegative} 
                  onChange={() => setFilterNegative(!filterNegative)} 
                />
                <FilterCheckbox 
                  label="Quantidade diferente de zero" 
                  checked={filterNonZero} 
                  onChange={() => setFilterNonZero(!filterNonZero)} 
                />
                <FilterCheckbox 
                  label="Quantidade zero" 
                  checked={filterZero} 
                  onChange={() => setFilterZero(!filterZero)} 
                />
              </div>
              <div className="flex items-center gap-1">
                <StatBadge color="bg-red-600" value={stats.negative} />
                <StatBadge color="bg-blue-600" value={stats.zero} />
                <StatBadge color="bg-emerald-600" value={stats.positive} />
              </div>
            </div>

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 flex-1 max-w-md">
                <div className="flex items-center gap-2 px-2 py-1 bg-pos-field border border-pos-border rounded flex-1">
                  <Search size={14} className="text-zinc-500" />
                  <input 
                    type="text" 
                    placeholder="Nome do produto"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="bg-transparent border-none outline-none text-xs text-zinc-200 w-full"
                  />
                </div>
              </div>
              <div className="text-[10px] text-zinc-500 font-bold capitalize tracking-wider">
                Contagem de produtos: <span className="text-white">{filteredProducts.length}</span>
              </div>
            </div>
          </div>

          {/* Table */}
          <div
            className="flex-1 overflow-auto custom-scrollbar bg-pos-bg"
            onClick={() => setSelectedProductId(null)}
          >
            <table className="w-full table-fixed border-collapse text-left text-xs [&_th]:border [&_td]:border [&_th]:border-pos-border [&_td]:border-pos-border">
              <thead className="sticky top-0 z-10 bg-pos-surface">
                <tr className="border-b border-pos-border">
                  <th className="px-3 py-2 text-left text-xs font-bold text-zinc-300 whitespace-nowrap w-20">Código</th>
                  <th className="px-3 py-2 text-left text-xs font-bold text-zinc-300 whitespace-nowrap">Nome</th>
                  <th className="px-3 py-2 text-right text-xs font-bold text-zinc-300 whitespace-nowrap w-24">No armazém</th>
                  <th className="px-3 py-2 text-right text-xs font-bold text-zinc-300 whitespace-nowrap w-24">Total</th>
                  <th className="px-3 py-2 text-center text-xs font-bold text-zinc-300 whitespace-nowrap w-20">Unidade</th>
                  <th className="px-3 py-2 text-right text-xs font-bold text-zinc-300 whitespace-nowrap w-24">Preço</th>
                  {canSeeCost ? (
                    <>
                      <th className="px-3 py-2 text-right text-xs font-bold text-zinc-300 whitespace-nowrap w-24">Custo méd.</th>
                      <th className="px-3 py-2 text-right text-xs font-bold text-zinc-300 whitespace-nowrap w-20">Margem %</th>
                      <th className="px-3 py-2 text-right text-xs font-bold text-zinc-300 whitespace-nowrap w-24">Custo inc...</th>
                    </>
                  ) : null}
                  <th className="px-3 py-2 text-right text-xs font-bold text-zinc-300 whitespace-nowrap w-24">Total</th>
                  <th className="px-3 py-2 text-right text-xs font-bold text-zinc-300 whitespace-nowrap w-24">Total incl...</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={10} className="py-20 text-center">
                      <div className="flex flex-col items-center gap-2">
                        <Loader2 size={24} className="text-blue-500 animate-spin" />
                        <span className="text-xs text-zinc-500">Carregando stock...</span>
                      </div>
                    </td>
                  </tr>
                ) : filteredProducts.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="py-20 text-center text-xs text-zinc-600 italic">
                      Nenhum produto encontrado
                    </td>
                  </tr>
                ) : (
                  filteredProducts.map((p, i) => (
                    <tr 
                      key={p.id} 
                      className={`transition-colors cursor-pointer ${
                        selectedProductId === String(p.id)
                          ? 'bg-[var(--pos-brand-selected-bg)]'
                          : i % 2
                            ? 'bg-pos-row'
                            : 'bg-pos-row-alt'
                      } hover:bg-[var(--pos-brand-hover-bg)]`}
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedProductId(String(p.id));
                      }}
                    >
                      <td className="px-3 py-2 text-xs text-zinc-200 whitespace-nowrap truncate">{p.code || '---'}</td>
                      <td className="px-3 py-2 text-xs text-zinc-200 whitespace-nowrap truncate">
                        <div className="flex items-center gap-2">
                          <div
                            className={`h-2 w-2 shrink-0 rounded-full ${
                              p.is_service
                                ? 'bg-zinc-600'
                                : p.stock_quantity < 0
                                  ? 'bg-red-600'
                                  : p.stock_quantity === 0
                                    ? 'bg-blue-600'
                                    : 'bg-emerald-600'
                            }`}
                          />
                          {p.name}
                          {p.is_service ? (
                            <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-zinc-400">
                              Sem stock
                            </span>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-xs text-zinc-200 text-right whitespace-nowrap">
                        {p.is_service
                          ? '—'
                          : p.warehouse_quantity != null
                            ? p.warehouse_quantity
                            : p.stock_quantity}
                      </td>
                      <td className="px-3 py-2 text-xs text-zinc-400 text-right whitespace-nowrap">
                        {p.is_service ? '—' : p.stock_quantity}
                      </td>
                      <td className="px-3 py-2 text-xs text-zinc-400 text-center whitespace-nowrap">{p.unit || 'un'}</td>
                      <td className="px-3 py-2 text-xs text-zinc-400 text-right whitespace-nowrap">{formatPrice(p.price)}</td>
                      {canSeeCost ? (
                        <>
                          <td className="px-3 py-2 text-xs text-zinc-400 text-right whitespace-nowrap">{formatPrice(p.cost || 0)}</td>
                          <td
                            className={`px-3 py-2 text-xs text-right whitespace-nowrap ${
                              calcMargin(p.price, p.cost || 0).percent < 0 ? 'text-amber-400' : 'text-zinc-400'
                            }`}
                          >
                            {calcMargin(p.final_price || p.price, p.cost || 0).percent.toFixed(1)}%
                          </td>
                          <td className="px-3 py-2 text-xs text-zinc-400 text-right whitespace-nowrap">{formatPrice((p.cost || 0) + (p.tax || 0))}</td>
                        </>
                      ) : null}
                      <td className="px-3 py-2 text-xs text-zinc-200 text-right whitespace-nowrap">{formatPrice(p.price * Math.abs(p.stock_quantity))}</td>
                      <td className="px-3 py-2 text-xs text-zinc-200 text-right whitespace-nowrap">{formatPrice((p.final_price || p.price) * Math.abs(p.stock_quantity))}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Footer */}
          <div className="h-auto min-h-20 bg-pos-surface border-t border-pos-border flex items-center justify-end px-8 py-3 gap-14">
            {canSeeCost ? (
              <div className="min-w-[200px] text-right text-white tabular-nums">
                <p className="mb-1 text-[11px] font-bold uppercase tracking-wider text-zinc-400">
                  Preço de custo
                </p>
                <div className="inline-grid grid-cols-[auto_auto] items-baseline gap-x-3 gap-y-0.5 text-right">
                  <span className="text-sm text-zinc-300">Valor sem imposto:</span>
                  <span className="text-sm font-semibold">{formatPrice(stats.totalCost)}</span>
                  <span className="text-sm text-zinc-300">Imposto:</span>
                  <span className="text-sm font-semibold">
                    {formatPrice(Math.max(0, stats.totalCostWithTax - stats.totalCost))}
                  </span>
                  <span className="col-span-2 my-1 border-t border-pos-border" />
                  <span className="text-base font-bold">Total:</span>
                  <span className="text-base font-bold">{formatPrice(stats.totalCostWithTax)}</span>
                </div>
              </div>
            ) : null}
            <div className="min-w-[200px] text-right text-white tabular-nums">
              <p className="mb-1 text-[11px] font-bold uppercase tracking-wider text-zinc-400">
                Preço de venda
              </p>
              <div className="inline-grid grid-cols-[auto_auto] items-baseline gap-x-3 gap-y-0.5 text-right">
                <span className="text-sm text-zinc-300">Valor sem imposto:</span>
                <span className="text-sm font-semibold">{formatPrice(stats.totalSales)}</span>
                <span className="text-sm text-zinc-300">Imposto:</span>
                <span className="text-sm font-semibold">
                  {formatPrice(Math.max(0, stats.totalSalesWithTax - stats.totalSales))}
                </span>
                <span className="col-span-2 my-1 border-t border-pos-border" />
                <span className="text-base font-bold">Total:</span>
                <span className="text-base font-bold">{formatPrice(stats.totalSalesWithTax)}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
      )}

      <TransferStockModal
        isOpen={isTransferOpen}
        onClose={() => setIsTransferOpen(false)}
        products={stockSelectableProducts}
        onSaved={async () => {
          await fetchData();
        }}
      />

      {isQuickOpen && selectedProduct && (
        <div className="fixed inset-0 z-[85] flex items-center justify-center pos-modal-overlay p-4">
          <div className="w-full max-w-[420px] overflow-hidden rounded border border-pos-border bg-pos-surface shadow-2xl">
            <div className="border-b border-pos-border px-5 py-4">
              <h2 className="text-base font-bold text-zinc-100">Atualizar quantidade de stock</h2>
              <p className="mt-2 text-xs leading-snug text-zinc-400">
                Defina as quantidades em stock para o produto selecionado. O documento de contagem de
                stock será criado automaticamente.
              </p>
              <p className="mt-3 text-xs font-medium text-zinc-200">
                {selectedProduct.name}
                <span className="ml-2 font-normal text-zinc-500">
                  (armazém:{' '}
                  {Number(
                    selectedProduct.warehouse_quantity ?? selectedProduct.stock_quantity ?? 0,
                  ).toLocaleString(undefined, { maximumFractionDigits: 3 })}{' '}
                  {selectedProduct.unit || 'un'} · total:{' '}
                  {Number(selectedProduct.stock_quantity ?? 0).toLocaleString(undefined, {
                    maximumFractionDigits: 3,
                  })}
                  )
                </span>
              </p>
            </div>

            <div className="px-5 pt-3">
              <label className="mb-1 block text-[10px] font-bold uppercase text-zinc-500">
                Armazém
              </label>
              <PosSelect
                value={quickWarehouseId || filterWarehouseId}
                onChange={setQuickWarehouseId}
                options={warehouses.map((w) => ({
                  value: w.id,
                  label: w.isDefault ? `${w.name} (principal)` : w.name,
                }))}
                size="md"
              />
            </div>

            <div className="px-5 pt-4">
              <input
                ref={quickInputRef}
                type="text"
                inputMode="decimal"
                readOnly
                value={quickValue}
                className="h-12 w-full rounded border border-pos-border bg-pos-bg px-3 text-right text-2xl font-bold text-white outline-none"
                style={quickOverwrite ? { caretColor: 'transparent' } : undefined}
              />
              {quickError ? <p className="mt-2 text-xs text-red-400">{quickError}</p> : null}
            </div>

            <div className="mt-4 border-t border-pos-border">
              <div className="grid grid-cols-4">
                {(['1', '2', '3', 'back'] as const).map((key) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => (key === 'back' ? backspaceQuick() : appendQuickDigit(key))}
                    className="flex h-16 items-center justify-center border-b border-r border-pos-border bg-pos-card text-xl font-semibold text-zinc-200 hover:bg-zinc-800"
                  >
                    {key === 'back' ? <Delete size={22} className="text-zinc-400" /> : key}
                  </button>
                ))}
                {(['4', '5', '6', 'esc'] as const).map((key) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => (key === 'esc' ? closeQuickModal() : appendQuickDigit(key))}
                    className={`flex h-16 items-center justify-center border-b border-r border-pos-border text-xl font-semibold hover:bg-zinc-800 ${
                      key === 'esc'
                        ? 'bg-zinc-800/60 text-zinc-400'
                        : 'bg-pos-card text-zinc-200'
                    }`}
                  >
                    {key === 'esc' ? (
                      <span className="text-sm font-bold uppercase tracking-wide">esc</span>
                    ) : (
                      key
                    )}
                  </button>
                ))}
              </div>
              <div className="grid grid-cols-4">
                <div className="col-span-3 grid grid-cols-3">
                  {(['7', '8', '9', '-', '0', '.'] as const).map((key) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => appendQuickDigit(key)}
                      className="flex h-16 items-center justify-center border-b border-r border-pos-border bg-pos-card text-xl font-semibold text-zinc-200 hover:bg-zinc-800"
                    >
                      {key}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  disabled={quickSaving}
                  onClick={() => void submitQuickCount()}
                  className="flex h-32 items-center justify-center border-b border-pos-border bg-[#0001fb] text-white hover:bg-[#1a1bff] disabled:opacity-50"
                >
                  {quickSaving ? (
                    <Loader2 size={28} className="animate-spin" />
                  ) : (
                    <CornerDownLeft size={28} />
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {isHistoryOpen && (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center pos-modal-overlay p-4"
          onClick={() => setIsHistoryOpen(false)}
        >
          <div
            className="flex h-[82vh] w-[95vw] max-w-[1200px] flex-col overflow-hidden rounded border border-pos-border bg-pos-surface shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-pos-border bg-pos-card px-5 py-3">
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded bg-[#0001fb]/15 text-[#0001fb]">
                  <History size={18} />
                </div>
                <div className="min-w-0">
                  <h2 className="truncate text-sm font-bold tracking-wide text-zinc-100">
                    Histórico do stock
                  </h2>
                  <p className="truncate text-[11px] text-zinc-500">
                    {selectedProduct?.name ?? 'Produto'}
                    {selectedProduct?.unit ? ` · ${selectedProduct.unit}` : ''}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsHistoryOpen(false)}
                className="rounded p-2 text-zinc-400 transition-colors hover:bg-zinc-800/80 hover:text-white"
                aria-label="Fechar"
              >
                <X size={18} />
              </button>
            </div>

            <div className="flex flex-wrap items-end gap-3 border-b border-pos-border bg-pos-surface px-5 py-3">
              <div className="min-w-[240px] max-w-[320px] flex-1">
                <label className="mb-1 block text-[11px] text-zinc-400">Período</label>
                <button
                  type="button"
                  onClick={openPeriodModal}
                  className="pos-select-trigger h-8 w-full gap-2 px-3 text-left"
                >
                  <CalendarDays size={14} className="shrink-0 text-zinc-400" />
                  <span className="flex-1 whitespace-nowrap text-center text-xs font-medium text-zinc-200">
                    {formatPeriodDate(historyFrom)} - {formatPeriodDate(historyTo)}
                  </span>
                </button>
              </div>
              <button
                type="button"
                onClick={() => selectedProductId && void fetchProductHistory(selectedProductId)}
                className="inline-flex h-8 items-center gap-2 rounded border border-[#0001fb]/40 bg-[#0001fb]/20 px-3 text-xs font-bold text-[#a5b4fc] transition-colors hover:bg-[#0001fb]/30"
              >
                <RotateCcw size={13} />
                Atualizar
              </button>
              <div className="ml-auto text-[11px] text-zinc-500">
                {historyLoading
                  ? 'A carregar...'
                  : `${historyRowsWithStock.length} movimento${historyRowsWithStock.length === 1 ? '' : 's'}`}
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-auto bg-pos-bg custom-scrollbar">
              <table className="w-full min-w-[980px] border-collapse text-left text-xs [&_th]:border [&_td]:border [&_th]:border-pos-border/55 [&_td]:border-pos-border/55">
                <thead className="sticky top-0 z-10 bg-pos-card">
                  <tr className="border-b border-[#0001fb]/70">
                    <HistoryTh>Tipo de documento</HistoryTh>
                    <HistoryTh>Documento</HistoryTh>
                    <HistoryTh>Entidade</HistoryTh>
                    <HistoryTh>Armazém</HistoryTh>
                    <HistoryTh>Data</HistoryTh>
                    <HistoryTh className="text-right">Quantidade</HistoryTh>
                    <HistoryTh className="text-right">Stock antes</HistoryTh>
                    <HistoryTh className="text-right">Stock depois</HistoryTh>
                    <HistoryTh>Unidade</HistoryTh>
                    <HistoryTh className="text-right">Preço de custo</HistoryTh>
                  </tr>
                </thead>
                <tbody>
                  {historyLoading ? (
                    <tr>
                      <td colSpan={10} className="px-3 py-10 text-center text-zinc-500">
                        <span className="inline-flex items-center gap-2">
                          <Loader2 size={14} className="animate-spin text-[#0001fb]" />
                          Carregando histórico...
                        </span>
                      </td>
                    </tr>
                  ) : historyError ? (
                    <tr>
                      <td colSpan={9} className="px-3 py-10 text-center text-red-400">
                        {historyError}
                      </td>
                    </tr>
                  ) : historyRowsWithStock.length === 0 ? (
                    <tr>
                      <td colSpan={10} className="px-3 py-10 text-center text-zinc-500">
                        Nenhum movimento encontrado para este período.
                      </td>
                    </tr>
                  ) : (
                    historyRowsWithStock.map((row, index) => (
                      <tr
                        key={row.id}
                        className={`${
                          index % 2 ? 'bg-pos-surface' : 'bg-pos-row'
                        } hover:bg-[var(--pos-brand-hover-bg)]`}
                      >
                        <HistoryTd>{movementLabel(row.movement_type)}</HistoryTd>
                        <HistoryTd className="font-medium text-zinc-100">
                          {row.document_number
                            ? row.document_number
                            : row.document_type
                              ? String(row.document_type)
                              : '-'}
                        </HistoryTd>
                        <HistoryTd>{row.customer_name || 'Consumidor final'}</HistoryTd>
                        <HistoryTd>{row.warehouse_name || '—'}</HistoryTd>
                        <HistoryTd>
                          {row.date
                            ? new Date(row.date).toLocaleString('pt-PT', {
                                day: '2-digit',
                                month: '2-digit',
                                year: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit',
                                second: '2-digit',
                              })
                            : '-'}
                        </HistoryTd>
                        <HistoryTd
                          className={`text-right font-bold tabular-nums ${
                            row.quantity >= 0 ? 'text-emerald-400' : 'text-red-400'
                          }`}
                        >
                          {row.quantity.toLocaleString(undefined, {
                            minimumFractionDigits: 0,
                            maximumFractionDigits: 3,
                          })}
                        </HistoryTd>
                        <HistoryTd className="text-right tabular-nums text-zinc-400">
                          {row.stock_before_movement != null
                            ? row.stock_before_movement.toLocaleString(undefined, {
                                minimumFractionDigits: 0,
                                maximumFractionDigits: 3,
                              })
                            : '-'}
                        </HistoryTd>
                        <HistoryTd className="text-right tabular-nums text-zinc-200">
                          {row.stock_after_movement != null
                            ? row.stock_after_movement.toLocaleString(undefined, {
                                minimumFractionDigits: 0,
                                maximumFractionDigits: 3,
                              })
                            : '-'}
                        </HistoryTd>
                        <HistoryTd>{selectedProduct?.unit || 'un'}</HistoryTd>
                        <HistoryTd className="text-right tabular-nums text-zinc-300">
                          {formatPrice(row.unit_price || selectedProduct?.cost || 0)}
                        </HistoryTd>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {isPeriodModalOpen && (
        <div
          className="fixed inset-0 z-[90] pos-modal-overlay flex items-center justify-center p-6"
          onClick={() => setIsPeriodModalOpen(false)}
        >
          <div
            className="w-full max-w-[820px] overflow-hidden rounded-[0.55rem] border border-pos-border bg-pos-surface shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="px-6 py-5 text-center">
              <h3 className="text-[18px] text-white">Período</h3>
              <div className="mt-4 inline-flex items-center rounded-[0.4rem] border border-pos-border bg-pos-surface px-4 py-2 font-bold text-white">
                {formatPeriodDate(tempHistoryFrom)} - {formatPeriodDate(tempHistoryTo)}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-6 p-6 md:grid-cols-[1fr_1fr_280px]">
              <div>
                <p className="mb-3 text-center text-sm text-zinc-100">Início</p>
                <div className="mx-auto max-w-[260px] rounded-[0.4rem] border border-pos-border bg-pos-surface p-4">
                  <div className="flex items-center justify-between px-1 pb-4">
                    <button
                      type="button"
                      onClick={() => setCalendarStartMonth(shiftMonth(calendarStartMonth, -1))}
                      className="rounded p-1 text-zinc-300 transition-colors hover:text-[#0001fb] focus-visible:outline-none"
                    >
                      <ChevronLeft size={16} />
                    </button>
                    <div className="text-white font-bold">{monthLabel(calendarStartMonth)}</div>
                    <button
                      type="button"
                      onClick={() => setCalendarStartMonth(shiftMonth(calendarStartMonth, 1))}
                      className="rounded p-1 text-zinc-300 transition-colors hover:text-[#0001fb] focus-visible:outline-none"
                    >
                      <ChevronRight size={16} />
                    </button>
                  </div>
                  <HistoryCalendarGrid
                    monthValue={calendarStartMonth}
                    selectedValue={tempHistoryFrom}
                    onSelect={(value) => {
                      setActivePreset(null);
                      setTempHistoryFrom(value);
                    }}
                  />
                </div>
              </div>

              <div>
                <p className="text-sm text-zinc-100 mb-3 text-center">Fim</p>
                <div className="mx-auto max-w-[260px] rounded-[0.4rem] border border-pos-border bg-pos-surface p-4">
                  <div className="flex items-center justify-between px-1 pb-4">
                    <button
                      type="button"
                      onClick={() => setCalendarEndMonth(shiftMonth(calendarEndMonth, -1))}
                      className="rounded-[0.4rem] p-1 text-zinc-300 transition-colors hover:text-[#0001fb] focus-visible:outline-none"
                    >
                      <ChevronLeft size={16} />
                    </button>
                    <div className="font-bold text-white">{monthLabel(calendarEndMonth)}</div>
                    <button
                      type="button"
                      onClick={() => setCalendarEndMonth(shiftMonth(calendarEndMonth, 1))}
                      className="rounded-[0.4rem] p-1 text-zinc-300 transition-colors hover:text-[#0001fb] focus-visible:outline-none"
                    >
                      <ChevronRight size={16} />
                    </button>
                  </div>
                  <HistoryCalendarGrid
                    monthValue={calendarEndMonth}
                    selectedValue={tempHistoryTo}
                    onSelect={(value) => {
                      setActivePreset(null);
                      setTempHistoryTo(value);
                    }}
                  />
                </div>
              </div>

              <div>
                <p className="text-sm text-zinc-100 mb-3 text-center">Período pré-definido</p>
                <div className="grid grid-cols-2 gap-2">
                  <HistoryPresetButton label="Hoje" active={activePreset === 'today'} onClick={() => applyPresetPeriod('today')} />
                  <HistoryPresetButton label="Ontem" active={activePreset === 'yesterday'} onClick={() => applyPresetPeriod('yesterday')} />
                  <HistoryPresetButton label="Esta semana" active={activePreset === 'thisWeek'} onClick={() => applyPresetPeriod('thisWeek')} />
                  <HistoryPresetButton label="Semana passada" active={activePreset === 'lastWeek'} onClick={() => applyPresetPeriod('lastWeek')} />
                  <HistoryPresetButton label="Este mês" active={activePreset === 'thisMonth'} onClick={() => applyPresetPeriod('thisMonth')} />
                  <HistoryPresetButton label="Mês passado" active={activePreset === 'lastMonth'} onClick={() => applyPresetPeriod('lastMonth')} />
                  <HistoryPresetButton label="Este ano" active={activePreset === 'thisYear'} onClick={() => applyPresetPeriod('thisYear')} />
                  <HistoryPresetButton label="Ano passado" active={activePreset === 'lastYear'} onClick={() => applyPresetPeriod('lastYear')} />
                </div>

                <div className="grid grid-cols-2 gap-2 mt-5">
                  <button
                    type="button"
                    onClick={applyPeriod}
                    disabled={tempHistoryFrom > tempHistoryTo}
                    className="flex min-h-11 items-center justify-center gap-2 rounded border border-[#0001fb] bg-[#0001fb] px-3 py-3 text-sm text-white transition-colors hover:bg-[#1a1bff] disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <Check size={16} />
                    <span className="text-sm">OK</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsPeriodModalOpen(false)}
                    className="flex min-h-11 items-center justify-center gap-2 rounded border border-pos-border bg-pos-card px-3 py-3 text-sm text-white transition-colors hover:bg-[var(--pos-brand-hover-bg)] hover:text-[#0001fb]"
                  >
                    <X size={16} />
                    <span className="text-sm">Cancelar</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function FilterCheckbox({ label, checked, onChange }: { label: string, checked: boolean, onChange: () => void }) {
  return (
    <label className="flex items-center gap-2 cursor-pointer group">
      <div 
        onClick={onChange}
        className={`w-4 h-4 border border-pos-border rounded-sm flex items-center justify-center transition-colors ${checked ? 'bg-blue-600 border-blue-600' : 'bg-zinc-800 group-hover:border-[#0001fb]'}`}
      >
        {checked && <div className="w-2 h-2 bg-white rounded-sm" />}
      </div>
      <span className="text-[11px] text-zinc-400 group-hover:text-zinc-200">{label}</span>
    </label>
  );
}

function StatBadge({ color, value }: { color: string, value: number }) {
  return (
    <div className={`${color} text-white text-[10px] font-bold px-3 py-0.5 rounded-sm min-w-[30px] text-center`}>
      {value}
    </div>
  );
}

function HistoryTh({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <th
      className={`px-3 py-2 text-left text-xs font-bold text-zinc-300 whitespace-nowrap ${className}`}
    >
      {children}
    </th>
  );
}

function HistoryTd({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <td className={`px-3 py-2 text-xs text-zinc-200 whitespace-nowrap ${className}`}>
      {children}
    </td>
  );
}

function toInputDate(date: Date) {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

function todayInputValue() {
  return toInputDate(new Date());
}

function formatPeriodDate(value: string | null | undefined) {
  if (!value) return '-';
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleDateString('pt-PT');
}

function monthLabel(value: string) {
  return new Date(`${value}T00:00:00`).toLocaleDateString('pt-PT', {
    month: 'long',
    year: 'numeric',
  });
}

function shiftMonth(value: string, delta: number) {
  const date = new Date(`${value}T00:00:00`);
  return toInputDate(new Date(date.getFullYear(), date.getMonth() + delta, 1));
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
      value: toInputDate(date),
      day: date.getDate(),
      inMonth: date.getMonth() === month,
    };
  });
}

function HistoryPresetButton({
  label,
  onClick,
  active = false,
}: {
  label: string;
  onClick: () => void;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`min-h-11 rounded-[0.4rem] border px-3 py-3 text-sm transition-colors ${
        active
          ? 'border-[#0001fb]/40 bg-[var(--pos-brand-selected-bg)] text-white'
          : 'border-pos-border bg-pos-surface text-white hover:bg-[var(--pos-brand-hover-bg)] hover:text-[#0001fb]'
      }`}
    >
      {label}
    </button>
  );
}

function HistoryCalendarGrid({
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
  const todayValue = todayInputValue();

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
              type="button"
              onClick={() => onSelect(day.value)}
              className={`flex aspect-square w-full min-w-0 items-center justify-center rounded text-sm transition-colors ${
                isSelected
                  ? 'scale-105 bg-[var(--pos-brand-selected-bg)] text-white ring-1 ring-[#0001fb]/50'
                  : isToday
                    ? 'border border-[#0001fb]/70 text-white'
                    : day.inMonth
                      ? 'text-white hover:bg-[var(--pos-brand-hover-bg)] hover:text-[#0001fb]'
                      : 'text-zinc-500 hover:bg-[var(--pos-brand-hover-bg)] hover:text-[#0001fb]'
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
