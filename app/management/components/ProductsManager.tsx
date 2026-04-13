'use client';

import React, { useState, useEffect, useRef } from 'react';
import { 
  RotateCcw, FolderPlus, Edit, Trash2, Plus, Edit3, Trash, 
  Printer, FileText, Hash, Sliders, ArrowDownUp, Download, 
  Upload, HelpCircle, Search, ChevronRight, ChevronDown, Package, Folder,
  Check, X, Loader2, ArrowRight, AlertTriangle
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

import { getPosApiBase, getPosApiDirectBase } from '@/lib/apiBase';

interface Product {
  id: string;
  code?: number;
  name: string;
  category_id?: string;
  barcode?: string;
  cost?: number;
  price: number;
  tax?: number;
  final_price?: number;
  active: boolean;
  unit?: string;
  description?: string;
  age_restriction?: number;
  is_service?: boolean;
  default_quantity?: boolean;
  stock_quantity: number;
  min_stock?: number;
  color?: string;
  image?: string;
  created_at: string;
  updated_at: string;
  categories?: {
    name: string;
  };
}

interface Category {
  id: string;
  name: string;
  parent_id?: string;
}

export default function ProductsManager() {
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [isTreeExpanded, setIsTreeExpanded] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(240);
  const [isResizing, setIsResizing] = useState(false);
  const [columnWidths, setColumnWidths] = useState({
    code: 80,
    name: 250,
    category: 120,
    barcode: 120,
    cost: 80,
    price: 80,
    tax: 80,
    finalPrice: 80,
    active: 60,
    unit: 60,
    createdAt: 100,
    updatedAt: 100,
    actions: 80
  });
  const [resizingColumn, setResizingColumn] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string, type: 'success' | 'error' } | null>(null);

  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const formatPrice = (value: number) => {
    return new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value) + ' MT';
  };

  const startResizing = (e: React.MouseEvent) => {
    setIsResizing(true);
    e.preventDefault();
  };

  const startResizingColumn = (e: React.MouseEvent, column: string) => {
    setResizingColumn(column);
    e.preventDefault();
    e.stopPropagation();
  };

  const stopResizing = () => {
    setIsResizing(false);
    setResizingColumn(null);
  };

  const resize = React.useCallback((e: MouseEvent) => {
    if (isResizing) {
      const newWidth = e.clientX;
      if (newWidth > 150 && newWidth < 600) {
        setSidebarWidth(newWidth);
      }
    } else if (resizingColumn) {
      const columnKey = resizingColumn as keyof typeof columnWidths;
      const currentWidth = columnWidths[columnKey];
      setColumnWidths(prev => ({
        ...prev,
        [columnKey]: prev[columnKey] + e.movementX
      }));
    }
  }, [isResizing, resizingColumn, columnWidths]);

  useEffect(() => {
    window.addEventListener('mousemove', resize);
    window.addEventListener('mouseup', stopResizing);
    return () => {
      window.removeEventListener('mousemove', resize);
      window.removeEventListener('mouseup', stopResizing);
    };
  }, [isResizing, resizingColumn, resize]);

  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
  const [isNewProductModalOpen, setIsNewProductModalOpen] = useState(false);
  const [isEditProductModalOpen, setIsEditProductModalOpen] = useState(false);
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [productToDelete, setProductToDelete] = useState<string | null>(null);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [activeTab, setActiveTab] = useState('detalhes');
  const newImageInputRef = useRef<HTMLInputElement | null>(null);
  const editImageInputRef = useRef<HTMLInputElement | null>(null);
  const [newProduct, setNewProduct] = useState({
    code: '',
    name: '',
    price: 0,
    category_id: '',
    barcode: '',
    cost: 0,
    tax: 0,
    final_price: 0,
    active: true,
    unit: 'un',
    description: '',
    age_restriction: '',
    is_service: false,
    default_quantity: true,
    stock_quantity: 0,
    min_stock: 0,
    image: ''
  });

  const fetchData = async () => {
    setLoading(true);
    try {
      const directApiBase = getPosApiDirectBase();
      const [catRes, prodRes] = await Promise.all([
        fetch(`${directApiBase}/categorias`),
        fetch(`${directApiBase}/produtos`)
      ]);
      if (!catRes.ok) throw new Error(`Falha ao carregar categorias (${catRes.status})`);
      if (!prodRes.ok) throw new Error(`Falha ao carregar produtos (${prodRes.status})`);
      const catData = await catRes.json();
      const prodData = await prodRes.json();
      setCategories(catData || []);
      setProducts(prodData || []);
    } catch (error) {
      console.error('Error fetching products/categories:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleCreateProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    const productName = String(newProduct.name ?? '').trim();
    const productPrice = Number(newProduct.price);
    if (!productName || !Number.isFinite(productPrice)) {
      showToast('Informe nome e preco valido para salvar o produto.', 'error');
      return;
    }

    try {
      let finalCode = Number(newProduct.code);
      
      if (!newProduct.code) {
        // Find max code and increment
        const maxCode = products.reduce((max, p) => Math.max(max, p.code || 0), 0);
        finalCode = maxCode + 1;
      }

      const directApiBase = getPosApiDirectBase();
      const response = await fetch(`${directApiBase}/produtos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: finalCode,
          name: newProduct.name,
          price: Number(newProduct.price),
          category_id: newProduct.category_id || null,
          barcode: newProduct.barcode || null,
          cost: Number(newProduct.cost),
          tax: Number(newProduct.tax),
          final_price: Number(newProduct.final_price) || Number(newProduct.price),
          active: newProduct.active,
          unit: newProduct.unit,
          description: newProduct.description,
          age_restriction: Number(newProduct.age_restriction) || null,
          is_service: newProduct.is_service,
          default_quantity: newProduct.default_quantity,
          stock_quantity: Number(newProduct.stock_quantity) || 0,
          min_stock: Number(newProduct.min_stock) || 0
          ,
          image: newProduct.image || null
        })
      });
      if (!response.ok) throw new Error('Falha ao criar produto');
      const createdResult = await response.json();
      
      setIsNewProductModalOpen(false);
      setNewProduct({
        code: '',
        name: '',
        price: 0,
        category_id: '',
        barcode: '',
        cost: 0,
        tax: 0,
        final_price: 0,
        active: true,
        unit: 'un',
        description: '',
        age_restriction: '',
        is_service: false,
        default_quantity: true,
        stock_quantity: 0,
        min_stock: 0,
        image: ''
      });
      // Evita que filtros antigos escondam o novo produto na grelha.
      setSearchQuery('');
      setSelectedCategory(newProduct.category_id || null);
      showToast('Produto criado com sucesso!');
      await fetchData();
      if (createdResult?.id != null) {
        setSelectedProductId(String(createdResult.id));
      }
    } catch (error: any) {
      console.error('Error creating product:', {
        message: error.message || 'Unknown error',
        details: error.details || 'No details',
        hint: error.hint || 'No hint',
        code: error.code || 'No code',
        fullError: error
      });
      showToast(`Erro ao criar produto: ${error.message || 'Verifique o console'}`, 'error');
    }
  };

  const handleDeleteProduct = async () => {
    if (!productToDelete) return;

    try {
      const response = await fetch(`${getPosApiBase()}/produtos/${productToDelete}`, { method: 'DELETE' });
      if (!response.ok) throw new Error('Falha ao remover produto');
      setIsDeleteConfirmOpen(false);
      setProductToDelete(null);
      fetchData();
    } catch (error) {
      console.error('Error deleting product:', error);
    }
  };

  const handleUpdateProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingProduct) return;
    const productName = String(editingProduct.name ?? '').trim();
    const productPrice = Number(editingProduct.price);
    if (!productName || !Number.isFinite(productPrice)) {
      showToast('Informe nome e preco valido para atualizar o produto.', 'error');
      return;
    }

    try {
      const directApiBase = getPosApiDirectBase();
      const response = await fetch(`${directApiBase}/produtos/${editingProduct.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: Number(editingProduct.code),
          name: editingProduct.name,
          price: Number(editingProduct.price),
          category_id: editingProduct.category_id || null,
          barcode: editingProduct.barcode || null,
          cost: Number(editingProduct.cost),
          tax: Number(editingProduct.tax),
          final_price: Number(editingProduct.final_price) || Number(editingProduct.price),
          active: editingProduct.active,
          unit: editingProduct.unit,
          description: editingProduct.description,
          age_restriction: Number(editingProduct.age_restriction) || null,
          is_service: editingProduct.is_service,
          default_quantity: editingProduct.default_quantity,
          stock_quantity: Number(editingProduct.stock_quantity) || 0,
          min_stock: Number(editingProduct.min_stock) || 0,
          image: editingProduct.image || null
        })
      });
      if (!response.ok) throw new Error('Falha ao atualizar produto');
      const updatedResult = await response.json();
      
      const editedCategoryId = editingProduct.category_id ? String(editingProduct.category_id) : null;
      const editedProductId = String(editingProduct.id);
      setIsEditProductModalOpen(false);
      setEditingProduct(null);
      // Evita "desaparecer" quando havia filtro antigo ativo.
      setSearchQuery('');
      setSelectedCategory(editedCategoryId);
      showToast('Produto atualizado com sucesso!');
      await fetchData();
      setSelectedProductId(String(updatedResult?.id ?? editedProductId));
    } catch (error: any) {
      console.error('Error updating product:', {
        message: error.message || 'Unknown error',
        details: error.details || 'No details',
        hint: error.hint || 'No hint',
        code: error.code || 'No code',
        fullError: error
      });
      showToast(`Erro ao atualizar produto: ${error.message || 'Verifique o console'}`, 'error');
    }
  };

  const filteredProducts = products.filter(p => {
    const matchesSearch = p.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
                         (p.barcode && p.barcode.includes(searchQuery));
    const matchesCategory = !selectedCategory || p.category_id === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  const primaryTabs = [
    { key: 'detalhes', label: 'Detalhes' },
    { key: 'preco', label: 'Preço & impostos' },
    { key: 'estoque', label: 'Controle de estoque' },
  ] as const;
  const secondaryTabs = [
    { key: 'comentarios', label: 'Comentários' },
    { key: 'imagem', label: 'Imagem & cor' },
  ] as const;
  const activeIsSecondary = secondaryTabs.some((tab) => tab.key === activeTab);
  const topTabs = activeIsSecondary ? primaryTabs : secondaryTabs;
  const bottomTabs = activeIsSecondary ? secondaryTabs : primaryTabs;

  const handleNewImageSelected = (file: File | null) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setNewProduct((prev) => ({ ...prev, image: String(reader.result ?? '') }));
    };
    reader.readAsDataURL(file);
  };

  const handleEditImageSelected = (file: File | null) => {
    if (!file || !editingProduct) return;
    const reader = new FileReader();
    reader.onload = () => {
      setEditingProduct((prev) => (prev ? { ...prev, image: String(reader.result ?? '') } : prev));
    };
    reader.readAsDataURL(file);
  };

  return (
    <div className="flex flex-col h-full bg-[#1a1a1a] text-zinc-300 overflow-hidden">
      {/* Toolbar */}
      <div className="h-16 bg-[#1a1a1a] border-b border-zinc-800 flex items-center px-2 gap-1 overflow-x-auto no-scrollbar">
        <ToolbarButton icon={<RotateCcw size={20} />} label="Atualizar" onClick={fetchData} />
        <ToolbarButton icon={<FolderPlus size={20} />} label="Novo grupo" />
        <ToolbarButton icon={<Edit size={20} />} label="Editar grupo" />
        <ToolbarButton icon={<Trash2 size={20} />} label="Deletar grupo" />
        <ToolbarButton 
          icon={<Plus size={20} />} 
          label="Novo produto" 
          active={isNewProductModalOpen}
          onClick={() => {
            setActiveTab('detalhes');
            setIsNewProductModalOpen(true);
          }}
        />
        <ToolbarButton 
          icon={<Edit3 size={20} />} 
          label="Editar produto" 
          active={isEditProductModalOpen}
          onClick={() => {
            if (selectedProductId) {
              const p = products.find(prod => prod.id === selectedProductId);
              if (p) {
                setEditingProduct(p);
                setActiveTab('detalhes');
                setIsEditProductModalOpen(true);
              }
            }
          }}
        />
        <ToolbarButton 
          icon={<Trash size={20} />} 
          label="Deletar produto" 
          active={isDeleteConfirmOpen}
          onClick={() => {
            if (selectedProductId) {
              setProductToDelete(selectedProductId);
              setIsDeleteConfirmOpen(true);
            }
          }}
        />
        <ToolbarButton icon={<Printer size={20} />} label="Imprimir" />
        <ToolbarButton icon={<FileText size={20} />} label="Salvar como PDF" />
        <ToolbarButton icon={<Hash size={20} />} label="Etiquetas de preço" />
        <ToolbarButton icon={<Sliders size={20} />} label="Classificação" />
        <ToolbarButton icon={<ArrowDownUp size={20} />} label="Mov. med. preço" />
        <ToolbarButton icon={<Download size={20} />} label="Importar" />
        <ToolbarButton icon={<Upload size={20} />} label="Exportar" />
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
                    selectedCategory === cat.id ? 'bg-zinc-800/50 text-white' : 'hover:bg-zinc-800/50 text-zinc-400'
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
          {/* Search and Stats */}
          <div className="h-10 bg-[#111] border-b border-zinc-800/50 flex items-center justify-between px-4">
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

          {/* Table */}
          <div className="flex-1 overflow-auto custom-scrollbar bg-[#0a0a0a]">
            <table className="min-w-full text-left text-xs border-collapse table-fixed">
              <thead className="sticky top-0 bg-[#141414] z-10">
                <tr className="text-zinc-400">
                  <ResizableHeader width={columnWidths.code} label="Cód. Prod." onResize={(e) => startResizingColumn(e, 'code')} />
                  <ResizableHeader width={columnWidths.name} label="Nome" onResize={(e) => startResizingColumn(e, 'name')} />
                  <ResizableHeader width={columnWidths.category} label="Grupo" onResize={(e) => startResizingColumn(e, 'category')} />
                  <ResizableHeader width={columnWidths.barcode} label="Cód. Barras" onResize={(e) => startResizingColumn(e, 'barcode')} />
                  <ResizableHeader width={columnWidths.cost} label="Custo" onResize={(e) => startResizingColumn(e, 'cost')} align="right" />
                  <ResizableHeader width={columnWidths.price} label="Preço" onResize={(e) => startResizingColumn(e, 'price')} align="right" />
                  <ResizableHeader width={columnWidths.tax} label="Imposto" onResize={(e) => startResizingColumn(e, 'tax')} align="right" />
                  <ResizableHeader width={columnWidths.finalPrice} label="P. Final" onResize={(e) => startResizingColumn(e, 'finalPrice')} align="right" />
                  <ResizableHeader width={columnWidths.active} label="Ativo" onResize={(e) => startResizingColumn(e, 'active')} align="center" />
                  <ResizableHeader width={columnWidths.unit} label="Un." onResize={(e) => startResizingColumn(e, 'unit')} align="center" />
                  <ResizableHeader width={columnWidths.createdAt} label="Criado" onResize={(e) => startResizingColumn(e, 'createdAt')} />
                  <ResizableHeader width={columnWidths.updatedAt} label="Atualizado" onResize={(e) => startResizingColumn(e, 'updatedAt')} />
                  <th className="border-b border-zinc-700/80 px-4 py-2.5 text-center font-medium whitespace-nowrap" style={{ width: columnWidths.actions }}>Ações</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={13} className="py-20 text-center">
                      <div className="flex flex-col items-center gap-2">
                        <Loader2 size={24} className="text-blue-500 animate-spin" />
                        <span className="text-xs text-zinc-500">Carregando produtos...</span>
                      </div>
                    </td>
                  </tr>
                ) : filteredProducts.length === 0 ? (
                  <tr>
                    <td colSpan={13} className="py-20 text-center text-xs text-zinc-600 italic">
                      Nenhum produto encontrado
                    </td>
                  </tr>
                ) : (
                  filteredProducts.map((p, i) => (
                    <tr 
                      key={p.id} 
                      onClick={() => setSelectedProductId(p.id)}
                      onDoubleClick={() => {
                        setEditingProduct(p);
                        setIsEditProductModalOpen(true);
                      }}
                      className={`border-b border-zinc-800/70 transition-colors cursor-pointer ${
                        selectedProductId === p.id ? 'bg-zinc-800/50' : i % 2 === 0 ? 'bg-[#1a1a1a]' : 'bg-[#141414]'
                      } hover:bg-zinc-800/30`}
                    >
                      <td className="px-4 py-2.5 text-zinc-200 font-bold border-r border-zinc-800/80 whitespace-nowrap truncate">{p.code || '---'}</td>
                      <td className="px-4 py-2.5 text-zinc-200 font-medium border-r border-zinc-800/80 whitespace-nowrap truncate">{p.name}</td>
                      <td className="px-4 py-2.5 text-zinc-400 border-r border-zinc-800/80 whitespace-nowrap truncate">{p.categories?.name || 'Geral'}</td>
                      <td className="px-4 py-2.5 text-zinc-500 border-r border-zinc-800/80 whitespace-nowrap truncate">{p.barcode || '---'}</td>
                      <td className="px-4 py-2.5 text-zinc-400 border-r border-zinc-800/80 text-right whitespace-nowrap truncate">{formatPrice(p.cost || 0)}</td>
                      <td className="px-4 py-2.5 text-zinc-200 font-bold border-r border-zinc-800/80 text-right whitespace-nowrap truncate">{formatPrice(p.price)}</td>
                      <td className="px-4 py-2.5 text-zinc-400 border-r border-zinc-800/80 text-right whitespace-nowrap truncate">{formatPrice(p.tax || 0)}</td>
                      <td className="px-4 py-2.5 text-zinc-200 font-bold border-r border-zinc-800/80 text-right whitespace-nowrap truncate">{formatPrice(p.final_price || p.price)}</td>
                      <td className="px-4 py-2.5 border-r border-zinc-800/80 text-center whitespace-nowrap">
                        <div className="flex justify-center">
                          {p.active ? <Check size={14} className="text-emerald-500" /> : <X size={14} className="text-rose-500" />}
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-zinc-400 border-r border-zinc-800/80 text-center whitespace-nowrap truncate">{p.unit || 'un'}</td>
                      <td className="px-4 py-2.5 text-zinc-500 border-r border-zinc-800/80 whitespace-nowrap truncate">{new Date(p.created_at).toLocaleDateString()}</td>
                      <td className="px-4 py-2.5 text-zinc-500 border-r border-zinc-800/80 whitespace-nowrap truncate">{new Date(p.updated_at).toLocaleDateString()}</td>
                      <td className="px-4 py-2.5 text-center whitespace-nowrap">
                        <div className="flex items-center justify-center gap-2">
                          <button 
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditingProduct(p);
                              setActiveTab('detalhes');
                              setIsEditProductModalOpen(true);
                            }}
                            className="p-1 hover:bg-zinc-800 text-zinc-500 hover:text-white rounded transition-colors"
                            title="Editar"
                          >
                            <Edit3 size={14} />
                          </button>
                          <button 
                            onClick={(e) => {
                              e.stopPropagation();
                              setProductToDelete(p.id);
                              setIsDeleteConfirmOpen(true);
                            }}
                            className="p-1 hover:bg-red-500/20 text-zinc-500 hover:text-red-500 rounded transition-colors"
                            title="Excluir"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* New Product Modal */}
      {isNewProductModalOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={() => setIsNewProductModalOpen(false)}>
          <div className="bg-[#1a1a1a] border border-zinc-800 rounded w-full max-w-lg overflow-hidden flex flex-col max-h-[90vh]" onClick={(e) => e.stopPropagation()}>
            {/* Header */}
            <div className="p-4 flex items-center justify-between bg-[#1a1a1a]">
              <h3 className="text-xl text-zinc-200">Novo produto</h3>
              <ArrowRight size={24} className="text-zinc-200" />
            </div>

            {/* Tabs */}
            <div className="flex flex-col">
              <div className="flex border-b border-zinc-800">
                {topTabs.map((tab) => (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => setActiveTab(tab.key)}
                    className={`relative flex-1 py-2 text-[11px] font-medium text-center transition-colors ${
                      activeTab === tab.key ? 'bg-[#2da8df] text-white' : 'text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    {tab.label}
                    {activeTab === tab.key && (
                      <span className="absolute left-1/2 -bottom-[6px] -translate-x-1/2 w-0 h-0 border-l-[6px] border-r-[6px] border-t-[6px] border-l-transparent border-r-transparent border-t-[#2da8df]" />
                    )}
                  </button>
                ))}
              </div>
              <div className="flex border-b border-[#00a3e0]">
                {bottomTabs.map((tab) => (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => setActiveTab(tab.key)}
                    className={`relative flex-1 py-2 text-[11px] font-medium text-center transition-colors ${
                      activeTab === tab.key ? 'bg-[#2da8df] text-white' : 'text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    {tab.label}
                    {activeTab === tab.key && (
                      <span className="absolute left-1/2 -bottom-[6px] -translate-x-1/2 w-0 h-0 border-l-[6px] border-r-[6px] border-t-[6px] border-l-transparent border-r-transparent border-t-[#2da8df]" />
                    )}
                  </button>
                ))}
              </div>
            </div>
            
            <form id="new-product-form" onSubmit={handleCreateProduct} className="flex-1 overflow-y-auto p-6 space-y-5 custom-scrollbar bg-[#1a1a1a]">
              {activeTab === 'detalhes' && (
                <div className="space-y-5">
                  <div className="space-y-2">
                    <label className="text-xs text-zinc-400 mr-2">Nome</label>
                    <input 
                      type="text" 
                      required
                      value={newProduct.name ?? ''}
                      onChange={(e) => setNewProduct({...newProduct, name: e.target.value})}
                      className="w-full bg-[#1a1a1a] border border-zinc-800 rounded px-3 py-1.5 text-sm text-white focus:border-blue-500 outline-none transition-colors"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs text-zinc-400 mr-2">Código</label>
                    <input 
                      type="text" 
                      value={newProduct.code ?? ''}
                      onChange={(e) => setNewProduct({...newProduct, code: e.target.value})}
                      className="w-24 bg-[#1a1a1a] border border-zinc-800 rounded px-3 py-1.5 text-sm text-white focus:border-blue-500 outline-none transition-colors"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs text-zinc-400 mr-2">Código de barras</label>
                    <input 
                      type="text" 
                      value={newProduct.barcode ?? ''}
                      onChange={(e) => setNewProduct({...newProduct, barcode: e.target.value})}
                      className="w-full bg-[#1a1a1a] border border-zinc-800 rounded px-3 py-1.5 text-sm text-white focus:border-blue-500 outline-none transition-colors"
                    />
                    <button type="button" className="mt-1 text-[11px] text-blue-500 hover:underline">Gerar código de barras</button>
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs text-zinc-400 mr-2">Unidade de medida</label>
                    <input 
                      type="text" 
                      value={newProduct.unit ?? ''}
                      onChange={(e) => setNewProduct({...newProduct, unit: e.target.value})}
                      className="w-24 bg-[#1a1a1a] border border-zinc-800 rounded px-3 py-1.5 text-sm text-white focus:border-blue-500 outline-none transition-colors"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs text-zinc-400 mr-2">Grupo</label>
                    <select 
                      value={newProduct.category_id ?? ''}
                      onChange={(e) => setNewProduct({...newProduct, category_id: e.target.value})}
                      className="w-full bg-[#1a1a1a] border border-zinc-800 rounded px-3 py-1.5 text-sm text-white focus:border-blue-500 outline-none transition-colors appearance-none"
                    >
                      <option value="">Produtos</option>
                      {categories.map(cat => (
                        <option key={cat.id} value={cat.id}>{cat.name}</option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-3 pt-2">
                    <div className="flex items-center gap-3">
                      <button 
                        type="button"
                        onClick={() => setNewProduct({...newProduct, active: !newProduct.active})}
                        className={`w-10 h-5 rounded-sm relative transition-colors ${newProduct.active ? 'bg-emerald-500' : 'bg-zinc-600'}`}
                      >
                        <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-sm transition-all ${newProduct.active ? 'right-0.5' : 'left-0.5'}`} />
                      </button>
                      <span className="text-xs text-zinc-200">Ativo</span>
                    </div>

                    <div className="flex items-center gap-3">
                      <button 
                        type="button"
                        onClick={() => setNewProduct({...newProduct, default_quantity: !newProduct.default_quantity})}
                        className={`w-10 h-5 rounded-sm relative transition-colors ${newProduct.default_quantity ? 'bg-emerald-500' : 'bg-zinc-600'}`}
                      >
                        <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-sm transition-all ${newProduct.default_quantity ? 'right-0.5' : 'left-0.5'}`} />
                      </button>
                      <span className="text-xs text-zinc-200">Quantidade padrão</span>
                    </div>

                    <div className="flex items-center gap-3">
                      <button 
                        type="button"
                        onClick={() => setNewProduct({...newProduct, is_service: !newProduct.is_service})}
                        className={`w-10 h-5 rounded-sm relative transition-colors ${newProduct.is_service ? 'bg-emerald-500' : 'bg-zinc-600'}`}
                      >
                        <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-sm transition-all ${newProduct.is_service ? 'right-0.5' : 'left-0.5'}`} />
                      </button>
                      <span className="text-xs text-zinc-200">Serviço (não usa estoque)</span>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs text-zinc-400 mr-2">Descrição</label>
                    <textarea 
                      value={newProduct.description ?? ''}
                      onChange={(e) => setNewProduct({...newProduct, description: e.target.value})}
                      rows={4}
                      className="w-full bg-[#1a1a1a] border border-zinc-800 rounded px-3 py-1.5 text-sm text-white focus:border-blue-500 outline-none transition-colors resize-none"
                    />
                  </div>
                </div>
              )}

              {activeTab === 'preco' && (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label className="text-xs text-zinc-400">Preço de Venda</label>
                      <input 
                        type="number" 
                        required
                        step="0.01"
                        value={newProduct.price ?? 0}
                        onChange={(e) => {
                          const val = Number(e.target.value);
                          setNewProduct({...newProduct, price: val, final_price: val + (newProduct.tax || 0)});
                        }}
                        className="w-full bg-[#1a1a1a] border border-zinc-800 rounded px-3 py-1.5 text-sm text-white focus:border-blue-500 outline-none transition-colors"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs text-zinc-400">Custo</label>
                      <input 
                        type="number" 
                        step="0.01"
                        value={newProduct.cost ?? 0}
                        onChange={(e) => setNewProduct({...newProduct, cost: Number(e.target.value)})}
                        className="w-full bg-[#1a1a1a] border border-zinc-800 rounded px-3 py-1.5 text-sm text-white focus:border-blue-500 outline-none transition-colors"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label className="text-xs text-zinc-400">Imposto (R$)</label>
                      <input 
                        type="number" 
                        step="0.01"
                        value={newProduct.tax ?? 0}
                        onChange={(e) => {
                          const val = Number(e.target.value);
                          setNewProduct({...newProduct, tax: val, final_price: (newProduct.price || 0) + val});
                        }}
                        className="w-full bg-[#1a1a1a] border border-zinc-800 rounded px-3 py-1.5 text-sm text-white focus:border-blue-500 outline-none transition-colors"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs text-zinc-400">Preço Final</label>
                      <input 
                        type="number" 
                        disabled
                        value={newProduct.final_price ?? 0}
                        className="w-full bg-[#141414] border border-zinc-800 rounded px-3 py-1.5 text-sm text-zinc-500 outline-none"
                      />
                    </div>
                  </div>
                </div>
              )}

              {activeTab === 'estoque' && (
                <div className="space-y-4">
                  <div className="space-y-1">
                    <label className="text-xs text-zinc-400">Quantidade em estoque</label>
                    <input 
                      type="number" 
                      step="0.01"
                      value={newProduct.stock_quantity ?? 0}
                      onChange={(e) => setNewProduct({...newProduct, stock_quantity: Number(e.target.value)})}
                      className="w-full bg-[#1a1a1a] border border-zinc-800 rounded px-3 py-1.5 text-sm text-white focus:border-blue-500 outline-none transition-colors"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-zinc-400">Estoque mínimo</label>
                    <input 
                      type="number" 
                      step="0.01"
                      value={newProduct.min_stock ?? 0}
                      onChange={(e) => setNewProduct({...newProduct, min_stock: Number(e.target.value)})}
                      className="w-full bg-[#1a1a1a] border border-zinc-800 rounded px-3 py-1.5 text-sm text-white focus:border-blue-500 outline-none transition-colors"
                    />
                  </div>
                </div>
              )}

              {activeTab === 'comentarios' && (
                <div className="py-10 text-center text-zinc-500 text-xs">
                  Comentários do produto
                </div>
              )}

              {activeTab === 'imagem' && (
                <div className="space-y-5">
                  <div className="space-y-2">
                    <label className="text-xs text-zinc-300">Imagem</label>
                    <input
                      ref={newImageInputRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => handleNewImageSelected(e.target.files?.[0] ?? null)}
                    />
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() => newImageInputRef.current?.click()}
                        className="w-36 border border-zinc-600 text-zinc-200 hover:bg-zinc-800 px-4 py-2 text-sm transition-colors"
                      >
                        Procurar
                      </button>
                      <button
                        type="button"
                        onClick={() => setNewProduct((prev) => ({ ...prev, image: '' }))}
                        className="w-36 border border-zinc-700 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50 px-4 py-2 text-sm transition-colors"
                      >
                        Limpar
                      </button>
                    </div>
                    {newProduct.image && (
                      <div className="pt-2">
                        <img src={newProduct.image} alt="Preview" className="h-24 w-24 object-cover border border-zinc-700 rounded" />
                      </div>
                    )}
                  </div>
                </div>
              )}
            </form>

            {/* Footer */}
            <div className="p-4 bg-[#1a1a1a] border-t border-zinc-800 flex justify-end gap-3">
              <button 
                type="submit"
                form="new-product-form"
                className="flex items-center gap-2 px-6 py-2 bg-zinc-800/50 border border-zinc-700 hover:bg-zinc-700 text-zinc-400 hover:text-white text-xs font-medium rounded transition-colors"
              >
                <Check size={16} />
                Salvar
              </button>
              <button 
                type="button"
                onClick={() => setIsNewProductModalOpen(false)}
                className="flex items-center gap-2 px-6 py-2 bg-zinc-800/50 border border-zinc-700 hover:bg-zinc-700 text-zinc-400 hover:text-white text-xs font-medium rounded transition-colors"
              >
                <X size={16} />
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Product Modal */}
      {isEditProductModalOpen && editingProduct && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={() => { setIsEditProductModalOpen(false); setEditingProduct(null); }}>
          <div className="bg-[#1a1a1a] border border-zinc-800 rounded w-full max-w-lg overflow-hidden flex flex-col max-h-[90vh]" onClick={(e) => e.stopPropagation()}>
            {/* Header */}
            <div className="p-4 flex items-center justify-between bg-[#1a1a1a]">
              <h3 className="text-xl text-zinc-200">Editar produto</h3>
              <ArrowRight size={24} className="text-zinc-200" />
            </div>

            {/* Tabs */}
            <div className="flex flex-col">
              <div className="flex border-b border-zinc-800">
                {topTabs.map((tab) => (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => setActiveTab(tab.key)}
                    className={`relative flex-1 py-2 text-[11px] font-medium text-center transition-colors ${
                      activeTab === tab.key ? 'bg-[#2da8df] text-white' : 'text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    {tab.label}
                    {activeTab === tab.key && (
                      <span className="absolute left-1/2 -bottom-[6px] -translate-x-1/2 w-0 h-0 border-l-[6px] border-r-[6px] border-t-[6px] border-l-transparent border-r-transparent border-t-[#2da8df]" />
                    )}
                  </button>
                ))}
              </div>
              <div className="flex border-b border-[#00a3e0]">
                {bottomTabs.map((tab) => (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => setActiveTab(tab.key)}
                    className={`relative flex-1 py-2 text-[11px] font-medium text-center transition-colors ${
                      activeTab === tab.key ? 'bg-[#2da8df] text-white' : 'text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    {tab.label}
                    {activeTab === tab.key && (
                      <span className="absolute left-1/2 -bottom-[6px] -translate-x-1/2 w-0 h-0 border-l-[6px] border-r-[6px] border-t-[6px] border-l-transparent border-r-transparent border-t-[#2da8df]" />
                    )}
                  </button>
                ))}
              </div>
            </div>
            
            <form id="edit-product-form" onSubmit={handleUpdateProduct} className="flex-1 overflow-y-auto p-6 space-y-5 custom-scrollbar bg-[#1a1a1a]">
              {activeTab === 'detalhes' && (
                <div className="space-y-5">
                  <div className="space-y-2">
                    <label className="text-xs text-zinc-400 mr-2">Nome</label>
                    <input 
                      type="text" 
                      required
                      value={editingProduct.name ?? ''}
                      onChange={(e) => setEditingProduct({...editingProduct, name: e.target.value})}
                      className="w-full bg-[#1a1a1a] border border-zinc-800 rounded px-3 py-1.5 text-sm text-white focus:border-blue-500 outline-none transition-colors"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs text-zinc-400 mr-2">Código</label>
                    <input 
                      type="text" 
                      value={editingProduct.code ?? ''}
                      onChange={(e) => setEditingProduct({...editingProduct, code: Number(e.target.value)})}
                      className="w-24 bg-[#1a1a1a] border border-zinc-800 rounded px-3 py-1.5 text-sm text-white focus:border-blue-500 outline-none transition-colors"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs text-zinc-400 mr-2">Código de barras</label>
                    <input 
                      type="text" 
                      value={editingProduct.barcode ?? ''}
                      onChange={(e) => setEditingProduct({...editingProduct, barcode: e.target.value})}
                      className="w-full bg-[#1a1a1a] border border-zinc-800 rounded px-3 py-1.5 text-sm text-white focus:border-blue-500 outline-none transition-colors"
                    />
                    <button type="button" className="mt-1 text-[11px] text-blue-500 hover:underline">Gerar código de barras</button>
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs text-zinc-400 mr-2">Unidade de medida</label>
                    <input 
                      type="text" 
                      value={editingProduct.unit ?? ''}
                      onChange={(e) => setEditingProduct({...editingProduct, unit: e.target.value})}
                      className="w-24 bg-[#1a1a1a] border border-zinc-800 rounded px-3 py-1.5 text-sm text-white focus:border-blue-500 outline-none transition-colors"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs text-zinc-400 mr-2">Grupo</label>
                    <select 
                      value={editingProduct.category_id ?? ''}
                      onChange={(e) => setEditingProduct({...editingProduct, category_id: e.target.value})}
                      className="w-full bg-[#1a1a1a] border border-zinc-800 rounded px-3 py-1.5 text-sm text-white focus:border-blue-500 outline-none transition-colors appearance-none"
                    >
                      <option value="">Produtos</option>
                      {categories.map(cat => (
                        <option key={cat.id} value={cat.id}>{cat.name}</option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-3 pt-2">
                    <div className="flex items-center gap-3">
                      <button 
                        type="button"
                        onClick={() => setEditingProduct({...editingProduct, active: !editingProduct.active})}
                        className={`w-10 h-5 rounded-sm relative transition-colors ${editingProduct.active ? 'bg-emerald-500' : 'bg-zinc-600'}`}
                      >
                        <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-sm transition-all ${editingProduct.active ? 'right-0.5' : 'left-0.5'}`} />
                      </button>
                      <span className="text-xs text-zinc-200">Ativo</span>
                    </div>

                    <div className="flex items-center gap-3">
                      <button 
                        type="button"
                        onClick={() => setEditingProduct({...editingProduct, default_quantity: !editingProduct.default_quantity})}
                        className={`w-10 h-5 rounded-sm relative transition-colors ${editingProduct.default_quantity ? 'bg-emerald-500' : 'bg-zinc-600'}`}
                      >
                        <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-sm transition-all ${editingProduct.default_quantity ? 'right-0.5' : 'left-0.5'}`} />
                      </button>
                      <span className="text-xs text-zinc-200">Quantidade padrão</span>
                    </div>

                    <div className="flex items-center gap-3">
                      <button 
                        type="button"
                        onClick={() => setEditingProduct({...editingProduct, is_service: !editingProduct.is_service})}
                        className={`w-10 h-5 rounded-sm relative transition-colors ${editingProduct.is_service ? 'bg-emerald-500' : 'bg-zinc-600'}`}
                      >
                        <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-sm transition-all ${editingProduct.is_service ? 'right-0.5' : 'left-0.5'}`} />
                      </button>
                      <span className="text-xs text-zinc-200">Serviço (não usa estoque)</span>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs text-zinc-400 mr-2">Descrição</label>
                    <textarea 
                      value={editingProduct.description ?? ''}
                      onChange={(e) => setEditingProduct({...editingProduct, description: e.target.value})}
                      rows={4}
                      className="w-full bg-[#1a1a1a] border border-zinc-800 rounded px-3 py-1.5 text-sm text-white focus:border-blue-500 outline-none transition-colors resize-none"
                    />
                  </div>
                </div>
              )}

              {activeTab === 'preco' && (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label className="text-xs text-zinc-400">Preço de Venda</label>
                      <input 
                        type="number" 
                        required
                        step="0.01"
                        value={editingProduct.price ?? 0}
                        onChange={(e) => {
                          const val = Number(e.target.value);
                          setEditingProduct({...editingProduct, price: val, final_price: val + (editingProduct.tax || 0)});
                        }}
                        className="w-full bg-[#1a1a1a] border border-zinc-800 rounded px-3 py-1.5 text-sm text-white focus:border-blue-500 outline-none transition-colors"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs text-zinc-400">Custo</label>
                      <input 
                        type="number" 
                        step="0.01"
                        value={editingProduct.cost ?? 0}
                        onChange={(e) => setEditingProduct({...editingProduct, cost: Number(e.target.value)})}
                        className="w-full bg-[#1a1a1a] border border-zinc-800 rounded px-3 py-1.5 text-sm text-white focus:border-blue-500 outline-none transition-colors"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label className="text-xs text-zinc-400">Imposto (R$)</label>
                      <input 
                        type="number" 
                        step="0.01"
                        value={editingProduct.tax ?? 0}
                        onChange={(e) => {
                          const val = Number(e.target.value);
                          setEditingProduct({...editingProduct, tax: val, final_price: (editingProduct.price || 0) + val});
                        }}
                        className="w-full bg-[#1a1a1a] border border-zinc-800 rounded px-3 py-1.5 text-sm text-white focus:border-blue-500 outline-none transition-colors"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs text-zinc-400">Preço Final</label>
                      <input 
                        type="number" 
                        disabled
                        value={editingProduct.final_price ?? 0}
                        className="w-full bg-[#141414] border border-zinc-800 rounded px-3 py-1.5 text-sm text-zinc-500 outline-none"
                      />
                    </div>
                  </div>
                </div>
              )}

              {activeTab === 'estoque' && (
                <div className="space-y-4">
                  <div className="space-y-1">
                    <label className="text-xs text-zinc-400">Quantidade em estoque</label>
                    <input 
                      type="number" 
                      step="0.01"
                      value={editingProduct.stock_quantity ?? 0}
                      onChange={(e) => setEditingProduct({...editingProduct, stock_quantity: Number(e.target.value)})}
                      className="w-full bg-[#1a1a1a] border border-zinc-800 rounded px-3 py-1.5 text-sm text-white focus:border-blue-500 outline-none transition-colors"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-zinc-400">Estoque mínimo</label>
                    <input 
                      type="number" 
                      step="0.01"
                      value={editingProduct.min_stock ?? 0}
                      onChange={(e) => setEditingProduct({...editingProduct, min_stock: Number(e.target.value)})}
                      className="w-full bg-[#1a1a1a] border border-zinc-800 rounded px-3 py-1.5 text-sm text-white focus:border-blue-500 outline-none transition-colors"
                    />
                  </div>
                </div>
              )}

              {activeTab === 'comentarios' && (
                <div className="py-10 text-center text-zinc-500 text-xs">
                  Comentários do produto
                </div>
              )}

              {activeTab === 'imagem' && (
                <div className="space-y-5">
                  <div className="space-y-2">
                    <label className="text-xs text-zinc-300">Imagem</label>
                    <input
                      ref={editImageInputRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => handleEditImageSelected(e.target.files?.[0] ?? null)}
                    />
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() => editImageInputRef.current?.click()}
                        className="w-36 border border-zinc-600 text-zinc-200 hover:bg-zinc-800 px-4 py-2 text-sm transition-colors"
                      >
                        Procurar
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingProduct({ ...editingProduct, image: '' })}
                        className="w-36 border border-zinc-700 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50 px-4 py-2 text-sm transition-colors"
                      >
                        Limpar
                      </button>
                    </div>
                    {editingProduct.image && (
                      <div className="pt-2">
                        <img src={editingProduct.image} alt="Preview" className="h-24 w-24 object-cover border border-zinc-700 rounded" />
                      </div>
                    )}
                  </div>
                </div>
              )}
            </form>

            {/* Footer */}
            <div className="p-4 bg-[#1a1a1a] border-t border-zinc-800 flex justify-end gap-3">
              <button 
                type="submit"
                form="edit-product-form"
                className="flex items-center gap-2 px-6 py-2 bg-zinc-800/50 border border-zinc-700 hover:bg-zinc-700 text-zinc-400 hover:text-white text-xs font-medium rounded transition-colors"
              >
                <Check size={16} />
                Salvar
              </button>
              <button 
                type="button"
                onClick={() => {
                  setIsEditProductModalOpen(false);
                  setEditingProduct(null);
                }}
                className="flex items-center gap-2 px-6 py-2 bg-zinc-800/50 border border-zinc-700 hover:bg-zinc-700 text-zinc-400 hover:text-white text-xs font-medium rounded transition-colors"
              >
                <X size={16} />
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {isDeleteConfirmOpen && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={() => { setIsDeleteConfirmOpen(false); setProductToDelete(null); }}>
          <div className="bg-[#1a1a1a] border border-zinc-800 rounded-lg w-full max-w-sm overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="p-6 text-center space-y-4">
              <div className="w-12 h-12 bg-red-500/10 rounded-full flex items-center justify-center mx-auto text-red-500">
                <Trash2 size={24} />
              </div>
              <div>
                <h3 className="text-lg font-bold text-white">Confirmar Exclusão</h3>
                <p className="text-xs text-zinc-400 mt-1">Tem certeza que deseja excluir este produto? Esta ação não pode ser desfeita.</p>
              </div>
              <div className="flex gap-3 pt-2">
                <button 
                  onClick={() => {
                    setIsDeleteConfirmOpen(false);
                    setProductToDelete(null);
                  }}
                  className="flex-1 px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-white text-xs font-bold rounded transition-colors"
                >
                  Cancelar
                </button>
                <button 
                  onClick={handleDeleteProduct}
                  className="flex-1 px-4 py-2 bg-red-600 hover:bg-red-500 text-white text-xs font-bold rounded transition-colors"
                >
                  Excluir
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Toast Notification */}
      <AnimatePresence>
        {toast && (
          <motion.div 
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 50 }}
            className={`fixed bottom-6 right-6 z-[200] px-6 py-3 rounded-lg flex items-center gap-3 border ${
              toast.type === 'success' ? 'bg-emerald-500/10 border-emerald-500/50 text-emerald-500' : 'bg-red-500/10 border-red-500/50 text-red-500'
            }`}
          >
            {toast.type === 'success' ? <Check size={18} /> : <AlertTriangle size={18} />}
            <span className="text-sm font-medium">{toast.message}</span>
          </motion.div>
        )}
      </AnimatePresence>
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

function ResizableHeader({ width, label, onResize, align = 'left' }: { width: number, label: string, onResize: (e: React.MouseEvent) => void, align?: 'left' | 'right' | 'center' }) {
  return (
    <th 
      className={`border-b border-r border-zinc-700/80 px-4 py-2.5 font-medium whitespace-nowrap relative group select-none ${
        align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left'
      }`}
      style={{ width }}
    >
      <span className="truncate block">{label}</span>
      <div 
        onMouseDown={onResize}
        className="absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-blue-500/50 active:bg-blue-500 transition-colors z-20 opacity-0 group-hover:opacity-100"
      />
    </th>
  );
}
