'use client';

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { 
  RotateCcw, History, Printer, FileText, FileSpreadsheet, 
  PackagePlus, Zap, HelpCircle, Search, ChevronRight, ChevronLeft,
  ChevronDown, Folder, Loader2, AlertCircle, Delete, CornerDownLeft, X,
  CalendarDays, Check
} from 'lucide-react';

import { getPosApiBase, getPosUserAuthHeaders } from '@/lib/apiBase';
import { unwrapApiSuccessPayload } from '@/lib/apiResponse';
import { formatMoneyMt } from '@/lib/currency';
import { setStockCountedQuantity } from '@/lib/services/posService';
import PurchaseStockModal from '@/app/management/components/PurchaseStockModal';

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
  is_service?: boolean;
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
  quantity: number;
  quantity_abs: number;
  unit_price: number;
  discount_amount: number;
  date: string;
}

export default function InventoryManager() {
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
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
  const [isQuickOpen, setIsQuickOpen] = useState(false);
  const [isPurchaseOpen, setIsPurchaseOpen] = useState(false);
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

  const fetchData = async () => {
    setLoading(true);
    try {
      const [catRes, prodRes] = await Promise.all([
        fetch(`${getPosApiBase()}/categorias`),
        fetch(`${getPosApiBase()}/produtos`)
      ]);
      const catData = unwrapApiSuccessPayload<any[]>(await catRes.json());
      const prodData = unwrapApiSuccessPayload<any[]>(await prodRes.json());
      setCategories(catData || []);
      setProducts(prodData || []);
    } catch (error) {
      console.error('Error fetching inventory data:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

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

  const stats = useMemo(() => {
    const negative = products.filter(p => p.stock_quantity < 0).length;
    const nonZero = products.filter(p => p.stock_quantity !== 0).length;
    const zero = products.filter(p => p.stock_quantity === 0).length;
    
    const totalCost = filteredProducts.reduce((acc, p) => acc + ((p.cost || 0) * Math.abs(p.stock_quantity)), 0);
    const totalCostWithTax = filteredProducts.reduce((acc, p) => acc + (((p.cost || 0) + (p.tax || 0)) * Math.abs(p.stock_quantity)), 0);
    const totalSales = filteredProducts.reduce((acc, p) => acc + (p.price * Math.abs(p.stock_quantity)), 0);
    const totalSalesWithTax = filteredProducts.reduce((acc, p) => acc + ((p.final_price || p.price) * Math.abs(p.stock_quantity)), 0);

    return { negative, nonZero, zero, totalCost, totalCostWithTax, totalSales, totalSalesWithTax };
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
    if (selectedProduct.is_service) {
      window.alert('Este produto está marcado como serviço (sem controlo de estoque).');
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
      const result = await setStockCountedQuantity(selectedProductId, counted) as {
        stock_after?: number;
        unchanged?: boolean;
        error?: string;
      };
      if (result?.error) throw new Error(result.error);
      const stockAfter = Number(result?.stock_after);
      setProducts((prev) =>
        prev.map((p) =>
          String(p.id) === String(selectedProductId)
            ? { ...p, stock_quantity: Number.isFinite(stockAfter) ? stockAfter : counted }
            : p,
        ),
      );
      setIsQuickOpen(false);
    } catch (error) {
      setQuickError(error instanceof Error ? error.message : 'Falha ao actualizar stock');
    } finally {
      setQuickSaving(false);
    }
  }, [quickSaving, quickValue, selectedProductId]);

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
      case 'fatura':
        return 'Fatura (dívida)';
      default:
        return 'Venda';
    }
  };

  return (
    <div className="flex flex-col h-full bg-[#1a1a1a] text-zinc-300 overflow-hidden">
      {/* Toolbar */}
      <div className="h-16 bg-[#1a1a1a] border-b border-zinc-800 flex items-center px-2 gap-1 overflow-x-auto no-scrollbar">
        <ToolbarButton icon={<RotateCcw size={20} />} label="Atualizar" onClick={fetchData} />
        <div className="w-px h-8 bg-zinc-800 mx-2" />
        <ToolbarButton
          icon={<History size={20} />}
          label="Histórico"
          onClick={() => void openHistoryModal()}
          disabled={!selectedProductId}
        />
        <ToolbarButton
          icon={<PackagePlus size={20} />}
          label="Compra"
          onClick={() => setIsPurchaseOpen(true)}
        />
        <ToolbarButton
          icon={<Zap size={20} />}
          label="Rápido"
          onClick={openQuickModal}
          disabled={!selectedProductId || Boolean(selectedProduct?.is_service)}
        />
        <div className="w-px h-8 bg-zinc-800 mx-2" />
        <ToolbarButton icon={<Printer size={20} />} label="Imprimir" />
        <ToolbarButton icon={<FileText size={20} />} label="PDF" />
        <ToolbarButton icon={<FileSpreadsheet size={20} />} label="Excel" />
        <div className="w-px h-8 bg-zinc-800 mx-2" />
        <ToolbarButton icon={<HelpCircle size={20} />} label="Ajuda" />
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar Tree */}
        <div 
          className="bg-[#141414] border-r border-zinc-800/50 flex flex-col relative"
          style={{ width: sidebarWidth }}
        >
          <div className="p-2 border-b border-zinc-800/50 flex items-center gap-2">
            <button 
              onClick={() => setIsTreeExpanded(!isTreeExpanded)}
              className="p-1 hover:bg-zinc-800 rounded"
            >
              {isTreeExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </button>
            <Folder size={16} className="text-blue-500" />
            <span 
              className={`text-xs font-bold cursor-pointer ${!selectedCategory ? 'text-white' : 'text-zinc-400'}`}
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
                  onClick={() => setSelectedCategory(cat.id)}
                  className={`flex items-center gap-2 px-6 py-1.5 rounded cursor-pointer transition-colors text-xs ${
                    selectedCategory === cat.id ? 'bg-[#00a3e0] text-white' : 'hover:bg-zinc-800/50 text-zinc-400'
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
          <div className="bg-[#111] border-b border-zinc-800/50 p-2 space-y-2">
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
                <StatBadge color="bg-blue-600" value={stats.nonZero} />
                <StatBadge color="bg-emerald-600" value={stats.zero} />
              </div>
            </div>

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 flex-1 max-w-md">
                <div className="flex items-center gap-2 px-2 py-1 bg-[#1a1a1a] border border-zinc-800 rounded flex-1">
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
            className="flex-1 overflow-auto custom-scrollbar bg-[#0a0a0a]"
            onClick={() => setSelectedProductId(null)}
          >
            <table className="min-w-full text-left text-xs border-collapse table-fixed">
              <thead className="sticky top-0 bg-[#141414] z-10">
                <tr className="text-zinc-400">
                  <th className="border-b border-r border-zinc-700/80 px-4 py-2.5 text-left font-medium whitespace-nowrap w-20">Código</th>
                  <th className="border-b border-r border-zinc-700/80 px-4 py-2.5 text-left font-medium whitespace-nowrap">Nome</th>
                  <th className="border-b border-r border-zinc-700/80 px-4 py-2.5 text-right font-medium whitespace-nowrap w-24">Quantidade</th>
                  <th className="border-b border-r border-zinc-700/80 px-4 py-2.5 text-center font-medium whitespace-nowrap w-20">Unidade</th>
                  <th className="border-b border-r border-zinc-700/80 px-4 py-2.5 text-right font-medium whitespace-nowrap w-24">Preço</th>
                  <th className="border-b border-r border-zinc-700/80 px-4 py-2.5 text-right font-medium whitespace-nowrap w-24">Custo</th>
                  <th className="border-b border-r border-zinc-700/80 px-4 py-2.5 text-right font-medium whitespace-nowrap w-24">Custo inc...</th>
                  <th className="border-b border-r border-zinc-700/80 px-4 py-2.5 text-right font-medium whitespace-nowrap w-24">Total</th>
                  <th className="border-b border-zinc-700/80 px-4 py-2.5 text-right font-medium whitespace-nowrap w-24">Total incl...</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={9} className="py-20 text-center">
                      <div className="flex flex-col items-center gap-2">
                        <Loader2 size={24} className="text-blue-500 animate-spin" />
                        <span className="text-xs text-zinc-500">Carregando estoque...</span>
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
                      className={`border-b border-zinc-800/70 transition-colors cursor-pointer ${
                        selectedProductId === String(p.id)
                          ? 'bg-[#00364b]'
                          : i % 2 === 0
                            ? 'bg-[#1a1a1a]'
                            : 'bg-[#141414]'
                      } hover:bg-zinc-800/30`}
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedProductId(String(p.id));
                      }}
                    >
                      <td className="px-4 py-2.5 text-zinc-200 font-bold border-r border-zinc-800/80 whitespace-nowrap truncate">{p.code || '---'}</td>
                      <td className="px-4 py-2.5 text-zinc-200 font-medium border-r border-zinc-800/80 whitespace-nowrap truncate">
                        <div className="flex items-center gap-2">
                          <div
                            className={`w-2 h-2 rounded-full ${
                              p.is_service
                                ? 'bg-zinc-600'
                                : p.stock_quantity > 0
                                  ? 'bg-emerald-500'
                                  : p.stock_quantity < 0
                                    ? 'bg-red-500'
                                    : 'bg-zinc-500'
                            }`}
                          />
                          {p.name}
                          {p.is_service ? (
                            <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-zinc-400">
                              Sem stock
                            </span>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-zinc-200 font-bold border-r border-zinc-800/80 text-right whitespace-nowrap">
                        {p.is_service ? '—' : p.stock_quantity}
                      </td>
                      <td className="px-4 py-2.5 text-zinc-400 border-r border-zinc-800/80 text-center whitespace-nowrap">{p.unit || 'un'}</td>
                      <td className="px-4 py-2.5 text-zinc-400 border-r border-zinc-800/80 text-right whitespace-nowrap">{formatPrice(p.price)}</td>
                      <td className="px-4 py-2.5 text-zinc-400 border-r border-zinc-800/80 text-right whitespace-nowrap">{formatPrice(p.cost || 0)}</td>
                      <td className="px-4 py-2.5 text-zinc-400 border-r border-zinc-800/80 text-right whitespace-nowrap">{formatPrice((p.cost || 0) + (p.tax || 0))}</td>
                      <td className="px-4 py-2.5 text-zinc-200 font-bold border-r border-zinc-800/80 text-right whitespace-nowrap">{formatPrice(p.price * Math.abs(p.stock_quantity))}</td>
                      <td className="px-4 py-2.5 text-zinc-200 font-bold text-right whitespace-nowrap">{formatPrice((p.final_price || p.price) * Math.abs(p.stock_quantity))}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Footer */}
          <div className="h-20 bg-[#141414] border-t border-zinc-800 flex items-center justify-end px-8 gap-12">
            <div className="text-right">
              <p className="text-[12px] font-bold text-zinc-500 capitalize">Preço de custo</p>
              <div className="grid grid-cols-[auto_100px] items-center gap-x-4 mt-1">
                <span className="text-xs text-zinc-400">Custo total:</span>
                <span className="text-xs font-bold text-white text-right">{formatPrice(stats.totalCost)}</span>
              </div>
              <div className="grid grid-cols-[auto_100px] items-center gap-x-4">
                <span className="text-xs text-zinc-400">Custo total incl. imposto:</span>
                <span className="text-xs font-bold text-white text-right">{formatPrice(stats.totalCostWithTax)}</span>
              </div>
            </div>
            <div className="text-right">
              <p className="text-[12px] font-bold text-zinc-500 capitalize">Preço de venda</p>
              <div className="grid grid-cols-[auto_100px] items-center gap-x-4 mt-1">
                <span className="text-xs text-zinc-400">Total:</span>
                <span className="text-xs font-bold text-white text-right">{formatPrice(stats.totalSales)}</span>
              </div>
              <div className="grid grid-cols-[auto_100px] items-center gap-x-4">
                <span className="text-xs text-zinc-400">Total incl. impostos:</span>
                <span className="text-xs font-bold text-white text-right">{formatPrice(stats.totalSalesWithTax)}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <PurchaseStockModal
        isOpen={isPurchaseOpen}
        onClose={() => setIsPurchaseOpen(false)}
        products={products}
        initialProductId={selectedProductId}
        onSaved={async () => {
          await fetchData();
        }}
      />

      {isQuickOpen && selectedProduct && (
        <div className="fixed inset-0 z-[85] flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-[420px] overflow-hidden rounded border border-zinc-700 bg-[#1a1a1a] shadow-2xl">
            <div className="border-b border-zinc-700 px-5 py-4">
              <h2 className="text-base font-bold text-zinc-100">Atualizar quantidade de estoque</h2>
              <p className="mt-2 text-xs leading-snug text-zinc-400">
                Defina as quantidades em estoque para o produto selecionado. O documento de contagem de
                estoque será criado automaticamente.
              </p>
              <p className="mt-3 text-xs font-medium text-zinc-200">
                {selectedProduct.name}
                <span className="ml-2 font-normal text-zinc-500">
                  (actual: {Number(selectedProduct.stock_quantity ?? 0).toLocaleString(undefined, {
                    maximumFractionDigits: 3,
                  })}{' '}
                  {selectedProduct.unit || 'un'})
                </span>
              </p>
            </div>

            <div className="px-5 pt-4">
              <input
                ref={quickInputRef}
                type="text"
                inputMode="decimal"
                readOnly
                value={quickValue}
                className="h-12 w-full rounded border border-zinc-700 bg-[#121212] px-3 text-right text-2xl font-bold text-white outline-none"
                style={quickOverwrite ? { caretColor: 'transparent' } : undefined}
              />
              {quickError ? <p className="mt-2 text-xs text-red-400">{quickError}</p> : null}
            </div>

            <div className="mt-4 border-t border-zinc-800">
              <div className="grid grid-cols-4">
                {(['1', '2', '3', 'back'] as const).map((key) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => (key === 'back' ? backspaceQuick() : appendQuickDigit(key))}
                    className="flex h-16 items-center justify-center border-b border-r border-zinc-800 bg-[#141414] text-xl font-semibold text-zinc-200 hover:bg-zinc-800"
                  >
                    {key === 'back' ? <Delete size={22} className="text-zinc-400" /> : key}
                  </button>
                ))}
                {(['4', '5', '6', 'esc'] as const).map((key) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => (key === 'esc' ? closeQuickModal() : appendQuickDigit(key))}
                    className={`flex h-16 items-center justify-center border-b border-r border-zinc-800 text-xl font-semibold hover:bg-zinc-800 ${
                      key === 'esc'
                        ? 'bg-zinc-800/60 text-zinc-400'
                        : 'bg-[#141414] text-zinc-200'
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
                      className="flex h-16 items-center justify-center border-b border-r border-zinc-800 bg-[#141414] text-xl font-semibold text-zinc-200 hover:bg-zinc-800"
                    >
                      {key}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  disabled={quickSaving}
                  onClick={() => void submitQuickCount()}
                  className="flex h-32 items-center justify-center border-b border-zinc-800 bg-[#00a3e0] text-white hover:bg-[#0090c7] disabled:opacity-50"
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
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
          onClick={() => setIsHistoryOpen(false)}
        >
          <div
            className="flex h-[82vh] w-[95vw] max-w-[1200px] flex-col overflow-hidden rounded-lg border border-zinc-800 bg-[#1a1a1a] shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-zinc-800 bg-[#141414] px-5 py-3">
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#00a3e0]/15 text-[#00a3e0]">
                  <History size={18} />
                </div>
                <div className="min-w-0">
                  <h2 className="truncate text-sm font-bold tracking-wide text-zinc-100">
                    Histórico do estoque
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
                className="rounded-lg p-2 text-zinc-400 transition-colors hover:bg-zinc-800/80 hover:text-white"
                aria-label="Fechar"
              >
                <X size={18} />
              </button>
            </div>

            <div className="flex flex-wrap items-end gap-3 border-b border-zinc-800 bg-[#171717] px-5 py-3">
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
                className="inline-flex h-8 items-center gap-2 rounded border border-[#00a3e0]/40 bg-[#00a3e0]/20 px-3 text-xs font-bold text-[#7dd3f0] transition-colors hover:bg-[#00a3e0]/30"
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

            <div className="min-h-0 flex-1 overflow-auto custom-scrollbar">
              <table className="w-full min-w-[980px] border-collapse text-xs">
                <thead className="sticky top-0 z-10 bg-[#1f1f1f]">
                  <tr className="text-zinc-400">
                    <HistoryTh>Tipo de documento</HistoryTh>
                    <HistoryTh>Documento</HistoryTh>
                    <HistoryTh>Entidade</HistoryTh>
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
                      <td colSpan={9} className="px-4 py-10 text-center text-zinc-500">
                        <span className="inline-flex items-center gap-2">
                          <Loader2 size={14} className="animate-spin text-[#00a3e0]" />
                          Carregando histórico...
                        </span>
                      </td>
                    </tr>
                  ) : historyError ? (
                    <tr>
                      <td colSpan={9} className="px-4 py-10 text-center text-red-400">
                        {historyError}
                      </td>
                    </tr>
                  ) : historyRowsWithStock.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="px-4 py-10 text-center text-zinc-500">
                        Nenhum movimento encontrado para este período.
                      </td>
                    </tr>
                  ) : (
                    historyRowsWithStock.map((row) => (
                      <tr
                        key={row.id}
                        className="border-b border-zinc-800/70 text-zinc-200 transition-colors hover:bg-zinc-800/30"
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
          className="fixed inset-0 z-[90] bg-black/70 backdrop-blur-[2px] flex items-center justify-center p-6"
          onClick={() => setIsPeriodModalOpen(false)}
        >
          <div
            className="w-full max-w-[820px] overflow-hidden rounded-[0.55rem] border border-zinc-700 bg-[#1f1f1f] shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="px-6 py-5 text-center">
              <h3 className="text-[18px] text-white">Período</h3>
              <div className="mt-4 inline-flex items-center rounded-[0.4rem] border border-zinc-700 bg-[#1a1a1a] px-4 py-2 font-bold text-white">
                {formatPeriodDate(tempHistoryFrom)} - {formatPeriodDate(tempHistoryTo)}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-6 p-6 md:grid-cols-[1fr_1fr_280px]">
              <div>
                <p className="mb-3 text-center text-sm text-zinc-100">Início</p>
                <div className="mx-auto max-w-[260px] rounded-[0.4rem] border border-zinc-700 bg-[#1a1a1a] p-4">
                  <div className="flex items-center justify-between px-1 pb-4">
                    <button
                      type="button"
                      onClick={() => setCalendarStartMonth(shiftMonth(calendarStartMonth, -1))}
                      className="p-1 rounded text-zinc-300 hover:text-white hover:bg-zinc-800 transition-colors"
                    >
                      <ChevronLeft size={16} />
                    </button>
                    <div className="text-white font-bold">{monthLabel(calendarStartMonth)}</div>
                    <button
                      type="button"
                      onClick={() => setCalendarStartMonth(shiftMonth(calendarStartMonth, 1))}
                      className="p-1 rounded text-zinc-300 hover:text-white hover:bg-zinc-800 transition-colors"
                    >
                      <ChevronRight size={16} />
                    </button>
                  </div>
                  <HistoryCalendarGrid
                    monthValue={calendarStartMonth}
                    selectedValue={tempHistoryFrom}
                    onSelect={setTempHistoryFrom}
                  />
                </div>
              </div>

              <div>
                <p className="text-sm text-zinc-100 mb-3 text-center">Fim</p>
                <div className="mx-auto max-w-[260px] rounded-[0.4rem] border border-zinc-700 bg-[#1a1a1a] p-4">
                  <div className="flex items-center justify-between px-1 pb-4">
                    <button
                      type="button"
                      onClick={() => setCalendarEndMonth(shiftMonth(calendarEndMonth, -1))}
                      className="rounded-[0.4rem] p-1 text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-white"
                    >
                      <ChevronLeft size={16} />
                    </button>
                    <div className="font-bold text-white">{monthLabel(calendarEndMonth)}</div>
                    <button
                      type="button"
                      onClick={() => setCalendarEndMonth(shiftMonth(calendarEndMonth, 1))}
                      className="rounded-[0.4rem] p-1 text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-white"
                    >
                      <ChevronRight size={16} />
                    </button>
                  </div>
                  <HistoryCalendarGrid
                    monthValue={calendarEndMonth}
                    selectedValue={tempHistoryTo}
                    onSelect={setTempHistoryTo}
                  />
                </div>
              </div>

              <div>
                <p className="text-sm text-zinc-100 mb-3 text-center">Período pré-definido</p>
                <div className="grid grid-cols-2 gap-2">
                  <HistoryPresetButton label="Hoje" onClick={() => applyPresetPeriod('today')} />
                  <HistoryPresetButton label="Ontem" onClick={() => applyPresetPeriod('yesterday')} />
                  <HistoryPresetButton label="Esta semana" onClick={() => applyPresetPeriod('thisWeek')} />
                  <HistoryPresetButton label="Semana passada" onClick={() => applyPresetPeriod('lastWeek')} />
                  <HistoryPresetButton label="Este mês" onClick={() => applyPresetPeriod('thisMonth')} />
                  <HistoryPresetButton label="Mês passado" onClick={() => applyPresetPeriod('lastMonth')} />
                  <HistoryPresetButton label="Este ano" onClick={() => applyPresetPeriod('thisYear')} />
                  <HistoryPresetButton label="Ano passado" onClick={() => applyPresetPeriod('lastYear')} />
                </div>

                <div className="grid grid-cols-2 gap-2 mt-5">
                  <button
                    type="button"
                    onClick={applyPeriod}
                    disabled={tempHistoryFrom > tempHistoryTo}
                    className="flex min-h-11 items-center justify-center gap-2 rounded border border-zinc-700 bg-[#131314] px-3 py-3 text-white transition-colors hover:border-zinc-600 hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <Check size={16} />
                    <span className="text-sm">OK</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsPeriodModalOpen(false)}
                    className="flex min-h-11 items-center justify-center gap-2 rounded border border-zinc-700 bg-[#131314] px-3 py-3 text-white transition-colors hover:border-zinc-600 hover:bg-zinc-800"
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

function ToolbarButton({
  icon,
  label,
  onClick,
  active,
  disabled = false,
}: {
  icon: React.ReactNode,
  label: string,
  onClick?: () => void,
  active?: boolean,
  disabled?: boolean
}) {
  return (
    <button 
      onClick={onClick}
      disabled={disabled}
      className={`flex flex-col items-center justify-center min-w-[80px] py-2 px-2 rounded transition-all hover:bg-zinc-800 group ${
        active ? 'bg-zinc-800 text-white' : 'text-zinc-400'
      } ${disabled ? 'cursor-not-allowed opacity-40 hover:bg-transparent' : ''}`}
      title={disabled ? 'Selecione um produto primeiro' : undefined}
    >
      <div className={`mb-1 transition-transform ${disabled ? '' : 'group-hover:scale-110'}`}>
        {icon}
      </div>
      <span className="text-[11px] font-bold text-center leading-none capitalize tracking-tighter">
        {label}
      </span>
    </button>
  );
}

function FilterCheckbox({ label, checked, onChange }: { label: string, checked: boolean, onChange: () => void }) {
  return (
    <label className="flex items-center gap-2 cursor-pointer group">
      <div 
        onClick={onChange}
        className={`w-4 h-4 border border-zinc-700 rounded-sm flex items-center justify-center transition-colors ${checked ? 'bg-blue-600 border-blue-600' : 'bg-zinc-800 group-hover:border-zinc-500'}`}
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
      className={`border-b border-r border-zinc-700/80 px-4 py-2.5 text-left font-medium whitespace-nowrap last:border-r-0 ${className}`}
    >
      {children}
    </th>
  );
}

function HistoryTd({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <td className={`border-r border-zinc-800/80 px-4 py-2.5 whitespace-nowrap last:border-r-0 ${className}`}>
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
  return new Date(`${value}T00:00:00`).toLocaleDateString('en-US', {
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

function HistoryPresetButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="min-h-11 rounded-[0.4rem] border border-zinc-700 bg-[#1a1a1a] px-3 py-3 text-sm text-white transition-colors hover:border-zinc-600 hover:bg-zinc-800"
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
  const weekDays = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
  const days = buildCalendarDays(monthValue);
  const todayValue = todayInputValue();

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
              type="button"
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
