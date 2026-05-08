'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { 
  RotateCcw, History, Printer, FileText, FileSpreadsheet, 
  ClipboardCheck, Zap, HelpCircle, Search, ChevronRight, 
  ChevronDown, Folder, Loader2, AlertCircle
} from 'lucide-react';

import { getPosApiBase } from '@/lib/apiBase';
import { unwrapApiSuccessPayload } from '@/lib/apiResponse';

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
    return d.toISOString().slice(0, 10);
  });
  const [historyTo, setHistoryTo] = useState(() => new Date().toISOString().slice(0, 10));

  // Filters
  const [filterNegative, setFilterNegative] = useState(false);
  const [filterNonZero, setFilterNonZero] = useState(false);
  const [filterZero, setFilterZero] = useState(false);

  const formatPrice = (value: number) => {
    return new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value) + ' MT';
  };

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
      const res = await fetch(`${getPosApiBase()}/produtos/${productId}/historico`);
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

  const movementLabel = (type: string) => {
    switch (String(type).toLowerCase()) {
      case 'entrada':
        return 'Entrada de stock';
      case 'devolucao':
        return 'Devolução';
      case 'quebra':
        return 'Quebra';
      case 'ajuste':
        return 'Regularização';
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
        <ToolbarButton icon={<ClipboardCheck size={20} />} label="Contagem" />
        <ToolbarButton icon={<Zap size={20} />} label="Rápido" />
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
                          <div className={`w-2 h-2 rounded-full ${p.stock_quantity > 0 ? 'bg-emerald-500' : p.stock_quantity < 0 ? 'bg-red-500' : 'bg-zinc-500'}`} />
                          {p.name}
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-zinc-200 font-bold border-r border-zinc-800/80 text-right whitespace-nowrap">{p.stock_quantity}</td>
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

      {isHistoryOpen && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4">
          <div className="flex h-[82vh] w-[95vw] max-w-[1200px] flex-col overflow-hidden rounded border border-zinc-700 bg-[#1a1a1a]">
            <div className="flex items-center justify-between border-b border-zinc-700 px-4 py-2">
              <div className="text-sm text-zinc-200">
                {selectedProduct?.name ?? 'Produto'} - Histórico do estoque
              </div>
              <button
                type="button"
                onClick={() => setIsHistoryOpen(false)}
                className="rounded border border-zinc-600 px-3 py-1 text-xs text-zinc-300 hover:bg-zinc-700"
              >
                Fechar
              </button>
            </div>

            <div className="flex items-center gap-3 border-b border-zinc-800 px-4 py-2 text-xs">
              <label className="flex items-center gap-2">
                <span className="text-zinc-400">Início</span>
                <input
                  type="date"
                  value={historyFrom}
                  onChange={(e) => setHistoryFrom(e.target.value)}
                  className="h-8 rounded border border-zinc-700 bg-[#121212] px-2 text-zinc-100 focus:outline-none"
                />
              </label>
              <label className="flex items-center gap-2">
                <span className="text-zinc-400">Fim</span>
                <input
                  type="date"
                  value={historyTo}
                  onChange={(e) => setHistoryTo(e.target.value)}
                  className="h-8 rounded border border-zinc-700 bg-[#121212] px-2 text-zinc-100 focus:outline-none"
                />
              </label>
              <button
                type="button"
                onClick={() => selectedProductId && void fetchProductHistory(selectedProductId)}
                className="h-8 rounded border border-zinc-700 bg-zinc-800/70 px-3 text-zinc-200 hover:bg-zinc-700"
              >
                Atualizar
              </button>
            </div>

            <div className="flex-1 overflow-auto">
              <table className="min-w-full table-fixed border-collapse text-left">
                <thead className="sticky top-0 z-10 bg-[#121212]">
                  <tr className="border-b border-zinc-700 text-[11px] text-zinc-400">
                    <th className="border-r border-zinc-800 px-3 py-2 text-left">Tipo de documento</th>
                    <th className="border-r border-zinc-800 px-3 py-2 text-left">Documento</th>
                    <th className="border-r border-zinc-800 px-3 py-2 text-left">Cliente</th>
                    <th className="border-r border-zinc-800 px-3 py-2 text-left">Data</th>
                    <th className="border-r border-zinc-800 px-3 py-2 text-left">Quantidade</th>
                    <th className="border-r border-zinc-800 px-3 py-2 text-left">Stock antes</th>
                    <th className="border-r border-zinc-800 px-3 py-2 text-left">Stock depois</th>
                    <th className="border-r border-zinc-800 px-3 py-2 text-left">Unit of measure</th>
                    <th className="px-3 py-2 text-left">Preço de custo</th>
                  </tr>
                </thead>
                <tbody>
                  {historyLoading ? (
                    <tr>
                      <td colSpan={9} className="px-3 py-8 text-center text-xs text-zinc-500">
                        Carregando histórico...
                      </td>
                    </tr>
                  ) : historyError ? (
                    <tr>
                      <td colSpan={9} className="px-3 py-8 text-center text-xs text-red-400">
                        {historyError}
                      </td>
                    </tr>
                  ) : historyRowsWithStock.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="px-3 py-8 text-center text-xs text-zinc-500">
                        Nenhum movimento encontrado para este período.
                      </td>
                    </tr>
                  ) : (
                    historyRowsWithStock.map((row) => (
                      <tr key={row.id} className="border-b border-zinc-800 text-xs text-zinc-200">
                        <td className="border-r border-zinc-900 px-3 py-2 text-left">{movementLabel(row.movement_type)}</td>
                        <td className="border-r border-zinc-900 px-3 py-2 text-left">{row.document_number ?? row.document_type ?? '-'}</td>
                        <td className="border-r border-zinc-900 px-3 py-2 text-left">{row.customer_name || 'Unknown'}</td>
                        <td className="border-r border-zinc-900 px-3 py-2 text-left">
                          {row.date ? new Date(row.date).toLocaleString() : '-'}
                        </td>
                        <td
                          className={`border-r border-zinc-900 px-3 py-2 text-left font-bold ${
                            row.quantity >= 0 ? 'text-emerald-400' : 'text-red-400'
                          }`}
                        >
                          {row.quantity.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 3 })}
                        </td>
                        <td className="border-r border-zinc-900 px-3 py-2 text-left">
                          {row.stock_before_movement != null
                            ? row.stock_before_movement.toLocaleString(undefined, {
                                minimumFractionDigits: 0,
                                maximumFractionDigits: 3,
                              })
                            : '-'}
                        </td>
                        <td className="border-r border-zinc-900 px-3 py-2 text-left">
                          {row.stock_after_movement != null
                            ? row.stock_after_movement.toLocaleString(undefined, {
                                minimumFractionDigits: 0,
                                maximumFractionDigits: 3,
                              })
                            : '-'}
                        </td>
                        <td className="border-r border-zinc-900 px-3 py-2 text-left">{selectedProduct?.unit || 'un'}</td>
                        <td className="px-3 py-2 text-left">
                          {formatPrice(row.unit_price || selectedProduct?.cost || 0)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
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
      title={disabled ? 'Selecione um produto para ver o histórico' : undefined}
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
