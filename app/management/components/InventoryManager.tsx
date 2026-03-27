'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { 
  RotateCcw, History, Printer, FileText, FileSpreadsheet, 
  ClipboardCheck, Zap, HelpCircle, Search, ChevronRight, 
  ChevronDown, Folder, Loader2, AlertCircle
} from 'lucide-react';

const API_URL = 'http://localhost:3001';

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

export default function InventoryManager() {
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [isTreeExpanded, setIsTreeExpanded] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(240);
  const [isResizing, setIsResizing] = useState(false);

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
        fetch(`${API_URL}/categorias`),
        fetch(`${API_URL}/produtos`)
      ]);
      const catData = await catRes.json();
      const prodData = await prodRes.json();
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

  return (
    <div className="flex flex-col h-full bg-[#1a1a1a] text-zinc-300 overflow-hidden">
      {/* Toolbar */}
      <div className="h-16 bg-[#1a1a1a] border-b border-zinc-800 flex items-center px-2 gap-1 overflow-x-auto no-scrollbar">
        <ToolbarButton icon={<RotateCcw size={20} />} label="Atualizar" onClick={fetchData} />
        <div className="w-px h-8 bg-zinc-800 mx-2" />
        <ToolbarButton icon={<History size={20} />} label="Histórico" />
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
          <div className="flex-1 overflow-auto custom-scrollbar bg-[#0a0a0a]">
            <table className="min-w-full text-left border-collapse table-fixed">
              <thead className="sticky top-0 bg-[#141414] z-10">
                <tr className="border-b border-zinc-800">
                  <th className="px-4 py-2 text-[10px] font-bold text-zinc-500 capitalize w-20">Código</th>
                  <th className="px-4 py-2 text-[10px] font-bold text-zinc-500 capitalize">Nome</th>
                  <th className="px-4 py-2 text-[10px] font-bold text-zinc-500 capitalize text-right w-24">Quantidade</th>
                  <th className="px-4 py-2 text-[10px] font-bold text-zinc-500 capitalize text-center w-20">Unidade</th>
                  <th className="px-4 py-2 text-[10px] font-bold text-zinc-500 capitalize text-right w-24">Preço</th>
                  <th className="px-4 py-2 text-[10px] font-bold text-zinc-500 capitalize text-right w-24">Custo</th>
                  <th className="px-4 py-2 text-[10px] font-bold text-zinc-500 capitalize text-right w-24">Custo inc...</th>
                  <th className="px-4 py-2 text-[10px] font-bold text-zinc-500 capitalize text-right w-24">Total</th>
                  <th className="px-4 py-2 text-[10px] font-bold text-zinc-500 capitalize text-right w-24">Total incl...</th>
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
                      className={`border-b border-zinc-800/50 transition-colors cursor-pointer ${
                        i % 2 === 0 ? 'bg-[#1a1a1a]' : 'bg-[#141414]'
                      } hover:bg-zinc-800/30`}
                    >
                      <td className="px-4 py-1.5 text-xs text-zinc-200 font-bold border-r border-zinc-800/50 truncate">{p.code || '---'}</td>
                      <td className="px-4 py-1.5 text-xs text-zinc-200 font-medium border-r border-zinc-800/50 truncate">
                        <div className="flex items-center gap-2">
                          <div className={`w-2 h-2 rounded-full ${p.stock_quantity > 0 ? 'bg-emerald-500' : p.stock_quantity < 0 ? 'bg-red-500' : 'bg-zinc-500'}`} />
                          {p.name}
                        </div>
                      </td>
                      <td className="px-4 py-1.5 text-xs text-zinc-200 font-bold border-r border-zinc-800/50 text-right">{p.stock_quantity}</td>
                      <td className="px-4 py-1.5 text-xs text-zinc-400 border-r border-zinc-800/50 text-center">{p.unit || 'un'}</td>
                      <td className="px-4 py-1.5 text-xs text-zinc-400 border-r border-zinc-800/50 text-right whitespace-nowrap">{formatPrice(p.price)}</td>
                      <td className="px-4 py-1.5 text-xs text-zinc-400 border-r border-zinc-800/50 text-right whitespace-nowrap">{formatPrice(p.cost || 0)}</td>
                      <td className="px-4 py-1.5 text-xs text-zinc-400 border-r border-zinc-800/50 text-right whitespace-nowrap">{formatPrice((p.cost || 0) + (p.tax || 0))}</td>
                      <td className="px-4 py-1.5 text-xs text-zinc-200 font-bold border-r border-zinc-800/50 text-right whitespace-nowrap">{formatPrice(p.price * Math.abs(p.stock_quantity))}</td>
                      <td className="px-4 py-1.5 text-xs text-zinc-200 font-bold text-right whitespace-nowrap">{formatPrice((p.final_price || p.price) * Math.abs(p.stock_quantity))}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Footer */}
          <div className="h-20 bg-[#141414] border-t border-zinc-800 flex items-center justify-end px-8 gap-12">
            <div className="text-right">
              <p className="text-[10px] font-bold text-zinc-500 capitalize">Preço de custo</p>
              <div className="flex items-center gap-4 mt-1">
                <span className="text-xs text-zinc-400">Custo total:</span>
                <span className="text-xs font-bold text-white">{formatPrice(stats.totalCost)}</span>
              </div>
              <div className="flex items-center gap-4">
                <span className="text-xs text-zinc-400">Custo total incl. imposto:</span>
                <span className="text-xs font-bold text-white">{formatPrice(stats.totalCostWithTax)}</span>
              </div>
            </div>
            <div className="text-right">
              <p className="text-[10px] font-bold text-zinc-500 capitalize">Preço de venda</p>
              <div className="flex items-center gap-4 mt-1">
                <span className="text-xs text-zinc-400">Total:</span>
                <span className="text-xs font-bold text-white">{formatPrice(stats.totalSales)}</span>
              </div>
              <div className="flex items-center gap-4">
                <span className="text-xs text-zinc-400">Total incl. impostos:</span>
                <span className="text-xs font-bold text-white">{formatPrice(stats.totalSalesWithTax)}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ToolbarButton({ icon, label, onClick, active }: { icon: React.ReactNode, label: string, onClick?: () => void, active?: boolean }) {
  return (
    <button 
      onClick={onClick}
      className={`flex flex-col items-center justify-center min-w-[80px] py-2 px-2 rounded transition-all hover:bg-zinc-800 group ${
        active ? 'bg-zinc-800 text-white' : 'text-zinc-400'
      }`}
    >
      <div className="mb-1 group-hover:scale-110 transition-transform">
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
