'use client';

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { 
  RotateCcw, FolderPlus, Edit, Trash2, Plus, Edit3, Trash, 
  Printer, FileText, Hash, Download, 
  Upload, Search, ChevronRight, ChevronDown, Package, Folder,
  Check, X, Loader2, AlertTriangle
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

import { getPosApiBase, getPosApiDirectBase, getPosUserAuthHeaders } from '@/lib/apiBase';
import { unwrapApiSuccessPayload } from '@/lib/apiResponse';
import {
  getCachedCategories,
  getCachedTaxRates,
  getPosCatalogCache,
  patchPosCatalogCache,
  setCachedCategories,
  setCachedTaxRates,
} from '@/lib/posSessionCache';
import { formatMoneyMt, moneyFieldLabel, POS_MONEY_PLACEHOLDER } from '@/lib/currency';
import {
  CATEGORY_COLOR_PALETTE,
  pickCategoryColor,
  randomCategoryColor,
  resolveCategoryColor,
} from '@/lib/categoryColors';
import { calcMargin } from '@/lib/margin';
import PosSelect from '@/components/PosSelect';
import { PosSwitch } from '@/components/PosSwitch';
import { ManagementToolbarButton } from '@/components/ManagementToolbarButton';

/** Mostra margem € e % a partir do preço de venda e custo. */
function ProductMarginReadout({ sellingPrice, unitCost }: { sellingPrice: number; unitCost: number }) {
  const { amount, percent } = calcMargin(sellingPrice, unitCost);
  const negative = percent < 0;
  const tone = negative ? 'text-amber-400' : 'text-zinc-200';
  return (
    <div className="grid grid-cols-2 gap-4">
      <div className="space-y-1">
        <label className="text-xs text-zinc-400">{moneyFieldLabel('Margem')}</label>
        <p className={`rounded border border-zinc-800 bg-[#141414] px-3 py-1.5 text-sm ${tone}`}>
          {formatMoneyMt(amount)}
        </p>
      </div>
      <div className="space-y-1">
        <label className="text-xs text-zinc-400">Margem %</label>
        <p className={`rounded border border-zinc-800 bg-[#141414] px-3 py-1.5 text-sm ${tone}`}>
          {percent.toFixed(1)}%
        </p>
      </div>
    </div>
  );
}

function parseMoneyInput(raw: string): number {
  const n = Number(String(raw).replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

/** Mostra vazio para o placeholder aparecer; 0 fica como placeholder. */
function moneyInputValue(value: number | null | undefined): string | number {
  if (value == null || value === 0) return '';
  return value;
}

/** Gera EAN-13 interno (prefixo 200) com dígito de controlo. */
function generateEan13Barcode(existing: Iterable<string | null | undefined> = []): string {
  const used = new Set(
    Array.from(existing, (v) => String(v ?? '').trim()).filter(Boolean)
  );

  const checkDigit = (twelve: string) => {
    let sum = 0;
    for (let i = 0; i < 12; i += 1) {
      const n = Number(twelve[i]);
      sum += i % 2 === 0 ? n : n * 3;
    }
    return String((10 - (sum % 10)) % 10);
  };

  for (let attempt = 0; attempt < 40; attempt += 1) {
    const rand = Math.floor(Math.random() * 1e9)
      .toString()
      .padStart(9, '0');
    const twelve = `200${rand}`.slice(0, 12);
    const code = `${twelve}${checkDigit(twelve)}`;
    if (!used.has(code)) return code;
  }

  const fallback = `200${Date.now().toString().slice(-9)}`.padStart(12, '0').slice(0, 12);
  return `${fallback}${checkDigit(fallback)}`;
}

interface Product {
  id: string;
  code?: number;
  name: string;
  category_id?: string;
  barcode?: string;
  cost?: number;
  price: number;
  tax_rate_id?: string | null;
  tax_rate_name?: string | null;
  tax_rate_code?: string | null;
  tax_rate_percent?: number;
  tax_rate_is_fixed?: boolean;
  tax_rate_price_includes_tax?: boolean;
  tax?: number;
  final_price?: number;
  active: boolean;
  unit?: string;
  description?: string;
  age_restriction?: number;
  is_service?: boolean;
  product_kind?: 'simple' | 'composed' | 'ingredient' | 'service';
  default_quantity?: boolean;
  track_lot?: boolean;
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

type ProductKind = 'simple' | 'composed' | 'ingredient' | 'service';

type BomLineDraft = {
  component_product_id: string;
  quantity: number;
  component_name?: string;
  component_unit?: string;
};

interface Category {
  id: string;
  name: string;
  parent_id?: string | null;
  color?: string | null;
}

interface TaxRate {
  id: string;
  name: string;
  code: string;
  rate: number;
  isFixed: boolean;
  priceIncludesTax?: boolean;
  isDefault?: boolean;
  enabled: boolean;
}

function buildCategoryPathLabel(
  categories: Category[],
  categoryId: string | null | undefined,
  options?: { includeSelf?: boolean; leafName?: string }
): string {
  const byId = new Map(categories.map((c) => [String(c.id), c]));
  const parts: string[] = ['Produtos'];
  if (!categoryId) {
    if (options?.leafName) parts.push(options.leafName);
    return parts.join(' › ');
  }

  const chain: string[] = [];
  let current: Category | undefined = byId.get(String(categoryId));
  const guard = new Set<string>();
  while (current && !guard.has(String(current.id))) {
    guard.add(String(current.id));
    chain.unshift(current.name);
    const parentKey = current.parent_id ? String(current.parent_id) : '';
    current = parentKey ? byId.get(parentKey) : undefined;
  }

  if (options?.includeSelf === false && chain.length > 0) {
    chain.pop();
  }
  parts.push(...chain);
  if (options?.leafName) parts.push(options.leafName);
  return parts.join(' › ');
}

/** Árvore plana ordenada (pais antes dos filhos) com profundidade para indentação. */
function flattenCategoryTree(categories: Category[]): Array<Category & { depth: number }> {
  const byParent = new Map<string, Category[]>();
  for (const cat of categories) {
    const key = cat.parent_id ? String(cat.parent_id) : '';
    const list = byParent.get(key) ?? [];
    list.push(cat);
    byParent.set(key, list);
  }
  for (const list of byParent.values()) {
    list.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  }

  const result: Array<Category & { depth: number }> = [];
  const visit = (parentKey: string, depth: number) => {
    for (const cat of byParent.get(parentKey) ?? []) {
      result.push({ ...cat, depth });
      visit(String(cat.id), depth + 1);
    }
  };
  visit('', 0);

  // Categorias órfãs (parent inexistente) no fim
  const seen = new Set(result.map((c) => String(c.id)));
  for (const cat of categories) {
    if (seen.has(String(cat.id))) continue;
    result.push({ ...cat, depth: 0 });
  }
  return result;
}

export default function ProductsManager() {
  const [products, setProducts] = useState<Product[]>(
    () => (getPosCatalogCache()?.products as Product[] | undefined) ?? []
  );
  const [categories, setCategories] = useState<Category[]>(
    () => (getCachedCategories() as Category[] | null) ?? []
  );
  const [taxRates, setTaxRates] = useState<TaxRate[]>(
    () => (getCachedTaxRates() as TaxRate[] | null) ?? []
  );
  const [loading, setLoading] = useState(
    () => !getPosCatalogCache()?.products?.length && !getCachedCategories()?.length
  );
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [isTreeExpanded, setIsTreeExpanded] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(240);
  const [isResizing, setIsResizing] = useState(false);
  const resizeStartXRef = useRef(0);
  const resizeStartWidthRef = useRef(240);
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
  });
  const [resizingColumn, setResizingColumn] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string, type: 'success' | 'error' } | null>(null);

  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const canRenameProduct = useMemo(() => {
    if (typeof window === 'undefined') return false;
    try {
      const raw = window.localStorage.getItem('currentUser');
      if (!raw) return false;
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      return Number(parsed.accessLevel ?? parsed.access_level ?? 0) >= 9;
    } catch {
      return false;
    }
  }, []);

  const formatPrice = (value: number) => formatMoneyMt(value);

  const calculateTaxValues = (priceRaw: number, taxRateId: string | null | undefined) => {
    const price = Number(priceRaw) || 0;
    const rate = taxRates.find((item) => item.id === String(taxRateId ?? ''));
    if (!rate) return { tax: 0, final_price: price };
    const priceIncludesTax = Number(rate.rate) === 0 ? false : rate.priceIncludesTax !== false;
    if (rate.isFixed) {
      if (priceIncludesTax) {
        const tax = Math.min(price, Number(rate.rate));
        return { tax: Math.round(tax * 100) / 100, final_price: Math.round(price * 100) / 100 };
      }
      const tax = Math.round(Number(rate.rate) * 100) / 100;
      return { tax, final_price: Math.round((price + tax) * 100) / 100 };
    }
    const rateValue = Number(rate.rate) || 0;
    if (priceIncludesTax) {
      const tax =
        rateValue > 0
          ? Math.round((price - price / (1 + rateValue / 100)) * 100) / 100
          : 0;
      return { tax, final_price: Math.round(price * 100) / 100 };
    }
    const tax = Math.round(((price * rateValue) / 100) * 100) / 100;
    return { tax, final_price: Math.round((price + tax) * 100) / 100 };
  };

  const startResizing = (e: React.MouseEvent) => {
    resizeStartXRef.current = e.clientX;
    resizeStartWidthRef.current = sidebarWidth;
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
      const deltaX = e.clientX - resizeStartXRef.current;
      const newWidth = resizeStartWidthRef.current + deltaX;
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
  const [isCategoryModalOpen, setIsCategoryModalOpen] = useState(false);
  const [categoryModalMode, setCategoryModalMode] = useState<'create' | 'edit'>('create');
  const [categoryForm, setCategoryForm] = useState({ name: '', parent_id: '', color: pickCategoryColor('novo') });
  const [isDeleteCategoryConfirmOpen, setIsDeleteCategoryConfirmOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('detalhes');
  const newImageInputRef = useRef<HTMLInputElement | null>(null);
  const editImageInputRef = useRef<HTMLInputElement | null>(null);
  const [newBomLines, setNewBomLines] = useState<BomLineDraft[]>([]);
  const [editBomLines, setEditBomLines] = useState<BomLineDraft[]>([]);
  const [bomIngredientId, setBomIngredientId] = useState('');
  const [bomQuantity, setBomQuantity] = useState('1');
  const [newProduct, setNewProduct] = useState({
    code: '',
    name: '',
    price: 0,
    category_id: '',
    barcode: '',
    cost: 0,
    tax_rate_id: '',
    tax: 0,
    final_price: 0,
    active: true,
    unit: 'un',
    description: '',
    age_restriction: '',
    is_service: false,
    product_kind: 'simple' as ProductKind,
    default_quantity: true,
    track_lot: false,
    stock_quantity: 0,
    min_stock: 0,
    image: '',
  });

  const ingredientOptions = React.useMemo(
    () =>
      products
        .filter((p) => (p.product_kind ?? 'simple') === 'ingredient')
        .map((p) => ({
          value: String(p.id),
          label: `${p.name}${p.unit ? ` (${p.unit})` : ''}`,
          unit: p.unit || 'un',
          name: p.name,
        })),
    [products]
  );

  const applyProductKind = <T extends { product_kind?: ProductKind; is_service?: boolean; track_lot?: boolean }>(
    prev: T,
    product_kind: ProductKind
  ): T => ({
    ...prev,
    product_kind,
    is_service:
      product_kind === 'composed' || product_kind === 'service'
        ? true
        : product_kind === 'ingredient'
          ? false
          : false,
    track_lot:
      product_kind === 'simple' || product_kind === 'ingredient' ? Boolean(prev.track_lot) : false,
  });

  const openNewProductModal = () => {
    const defaultTaxRate =
      taxRates.find((rate) => rate.isDefault && rate.enabled) ??
      taxRates.find((rate) => rate.code === 'IVA16' && rate.enabled) ??
      taxRates.find((rate) => rate.enabled);
    setNewProduct({
      code: '',
      name: '',
      price: 0,
      category_id: selectedCategory ? String(selectedCategory) : '',
      barcode: '',
      cost: 0,
      tax_rate_id: defaultTaxRate?.id ?? '',
      tax: 0,
      final_price: 0,
      active: true,
      unit: 'un',
      description: '',
      age_restriction: '',
      is_service: false,
      product_kind: 'simple',
      default_quantity: true,
      track_lot: false,
      stock_quantity: 0,
      min_stock: 0,
      image: '',
    });
    setNewBomLines([]);
    setBomIngredientId('');
    setBomQuantity('1');
    setActiveTab('detalhes');
    setIsNewProductModalOpen(true);
  };

  const fetchData = async () => {
    const hasCache =
      Boolean(getPosCatalogCache()?.products?.length) || Boolean(getCachedCategories()?.length);
    if (!hasCache) setLoading(true);
    try {
      const directApiBase = getPosApiDirectBase();
      const authHeaders = getPosUserAuthHeaders();
      const [catRes, prodRes, taxRes] = await Promise.all([
        fetch(`${directApiBase}/categorias`, { headers: { ...authHeaders } }),
        fetch(`${directApiBase}/produtos`, { headers: { ...authHeaders } }),
        fetch(`${directApiBase}/tax-rates`, { headers: { ...authHeaders } }),
      ]);
      if (!catRes.ok) throw new Error(`Falha ao carregar categorias (${catRes.status})`);
      if (!prodRes.ok) throw new Error(`Falha ao carregar produtos (${prodRes.status})`);
      if (!taxRes.ok) throw new Error(`Falha ao carregar impostos (${taxRes.status})`);
      const catData = unwrapApiSuccessPayload<any[]>(await catRes.json());
      const prodData = unwrapApiSuccessPayload<any[]>(await prodRes.json());
      const taxData = unwrapApiSuccessPayload<TaxRate[]>(await taxRes.json());
      const nextCategories = catData || [];
      const nextProducts = prodData || [];
      const nextTaxRates = Array.isArray(taxData)
        ? taxData.map((row) => ({
            ...row,
            priceIncludesTax:
              Number(row.rate) === 0 ? false : row.priceIncludesTax !== false,
            isDefault: Boolean(row.isDefault),
          }))
        : [];
      setCategories(nextCategories);
      setProducts(nextProducts);
      setTaxRates(nextTaxRates);
      setCachedCategories(nextCategories);
      setCachedTaxRates(nextTaxRates);
      patchPosCatalogCache({ products: nextProducts as any });
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
    const isIngredient = newProduct.product_kind === 'ingredient';
    if (!productName || (!isIngredient && !Number.isFinite(productPrice))) {
      showToast(
        isIngredient
          ? 'Informe o nome do ingrediente.'
          : 'Informe nome e preco valido para salvar o produto.',
        'error'
      );
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
        headers: { 'Content-Type': 'application/json', ...getPosUserAuthHeaders() },
        body: JSON.stringify({
          code: finalCode,
          name: newProduct.name,
          price: isIngredient ? Number(newProduct.price) || 0 : Number(newProduct.price),
          category_id: newProduct.category_id || null,
          barcode: newProduct.barcode || null,
          cost: Number(newProduct.cost),
          tax_rate_id: newProduct.tax_rate_id || null,
          active: newProduct.active,
          unit: newProduct.unit,
          description: newProduct.description,
          age_restriction: Number(newProduct.age_restriction) || null,
          is_service:
            newProduct.product_kind === 'composed' || newProduct.product_kind === 'service',
          product_kind: newProduct.product_kind || 'simple',
          default_quantity: newProduct.default_quantity,
          track_lot: Boolean(newProduct.track_lot),
          stock_quantity: Number(newProduct.stock_quantity) || 0,
          min_stock: Number(newProduct.min_stock) || 0,
          image: newProduct.image || null,
          bom_lines:
            newProduct.product_kind === 'composed'
              ? newBomLines.map((line) => ({
                  component_product_id: line.component_product_id,
                  quantity: line.quantity,
                }))
              : [],
        })
      });
      if (!response.ok) {
        const errJson = await response.json().catch(() => ({}));
        throw new Error(
          String((errJson as any)?.error?.message ?? (errJson as any)?.error ?? 'Falha ao criar produto')
        );
      }
      const createdResult = unwrapApiSuccessPayload<any>(await response.json());
      
      setIsNewProductModalOpen(false);
      setNewBomLines([]);
      setNewProduct({
        code: '',
        name: '',
        price: 0,
        category_id: '',
        barcode: '',
        cost: 0,
        tax_rate_id: '',
        tax: 0,
        final_price: 0,
        active: true,
        unit: 'un',
        description: '',
        age_restriction: '',
        is_service: false,
        product_kind: 'simple',
        default_quantity: true,
        track_lot: false,
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
      const response = await fetch(`${getPosApiBase()}/produtos/${productToDelete}`, {
        method: 'DELETE',
        headers: { ...getPosUserAuthHeaders() },
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        const message = String(
          (data?.error && typeof data.error === 'object' ? data.error.message : null) ??
            data?.error ??
            data?.message ??
            'Falha ao remover produto',
        );
        throw new Error(message);
      }
      setIsDeleteConfirmOpen(false);
      setProductToDelete(null);
      showToast('Produto removido com sucesso.');
      fetchData();
    } catch (error) {
      console.error('Error deleting product:', error);
      showToast(error instanceof Error ? error.message : 'Falha ao remover produto', 'error');
    }
  };

  const handleUpdateProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingProduct) return;
    const productName = String(editingProduct.name ?? '').trim();
    const productPrice = Number(editingProduct.price);
    const isIngredient = (editingProduct.product_kind ?? 'simple') === 'ingredient';
    if (!productName || (!isIngredient && !Number.isFinite(productPrice))) {
      showToast(
        isIngredient
          ? 'Informe o nome do ingrediente.'
          : 'Informe nome e preco valido para atualizar o produto.',
        'error'
      );
      return;
    }

    try {
      const directApiBase = getPosApiDirectBase();
      const response = await fetch(`${directApiBase}/produtos/${editingProduct.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...getPosUserAuthHeaders() },
        body: JSON.stringify({
          code: Number(editingProduct.code),
          name: editingProduct.name,
          price: isIngredient ? Number(editingProduct.price) || 0 : Number(editingProduct.price),
          category_id: editingProduct.category_id || null,
          barcode: editingProduct.barcode || null,
          cost: Number(editingProduct.cost),
          tax_rate_id: editingProduct.tax_rate_id || null,
          active: editingProduct.active,
          unit: editingProduct.unit,
          description: editingProduct.description,
          age_restriction: Number(editingProduct.age_restriction) || null,
          is_service:
            (editingProduct.product_kind ?? 'simple') === 'composed' ||
            (editingProduct.product_kind ?? 'simple') === 'service',
          product_kind: editingProduct.product_kind || 'simple',
          default_quantity: editingProduct.default_quantity,
          track_lot: Boolean(editingProduct.track_lot),
          stock_quantity: Number(editingProduct.stock_quantity) || 0,
          min_stock: Number(editingProduct.min_stock) || 0,
          image: editingProduct.image || null,
          bom_lines:
            (editingProduct.product_kind ?? 'simple') === 'composed'
              ? editBomLines.map((line) => ({
                  component_product_id: line.component_product_id,
                  quantity: line.quantity,
                }))
              : [],
        })
      });
      if (!response.ok) {
        const errJson = await response.json().catch(() => ({}));
        throw new Error(
          String((errJson as any)?.error?.message ?? (errJson as any)?.error ?? 'Falha ao atualizar produto')
        );
      }
      const updatedResult = unwrapApiSuccessPayload<any>(await response.json());
      
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
    if (!selectedCategory) {
      return matchesSearch;
    }
    // Inclui produtos do grupo e dos subgrupos
    const allowedIds = new Set<string>([String(selectedCategory)]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const cat of categories) {
        const parentKey = cat.parent_id ? String(cat.parent_id) : '';
        const id = String(cat.id);
        if (parentKey && allowedIds.has(parentKey) && !allowedIds.has(id)) {
          allowedIds.add(id);
          grew = true;
        }
      }
    }
    const matchesCategory = p.category_id != null && allowedIds.has(String(p.category_id));
    return matchesSearch && matchesCategory;
  });

  const currentFormKind: ProductKind = isEditProductModalOpen
    ? ((editingProduct?.product_kind as ProductKind) ?? 'simple')
    : newProduct.product_kind;
  const resolvedPrimaryTabs = [
    { key: 'detalhes', label: 'Detalhes' },
    {
      key: 'preco',
      label: currentFormKind === 'ingredient' ? 'Custo' : 'Preço & impostos',
    },
    ...(currentFormKind === 'composed' ? [{ key: 'ficha', label: 'Ficha técnica' }] : []),
    ...(currentFormKind === 'composed' || currentFormKind === 'service'
      ? []
      : [{ key: 'estoque', label: 'Controle de stock' }]),
  ];
  const secondaryTabs = [
    { key: 'comentarios', label: 'Comentários' },
    { key: 'imagem', label: 'Imagem & cor' },
  ] as const;
  const activeIsSecondary = secondaryTabs.some((tab) => tab.key === activeTab);
  const topTabs = activeIsSecondary ? resolvedPrimaryTabs : secondaryTabs;
  const bottomTabs = activeIsSecondary ? secondaryTabs : resolvedPrimaryTabs;

  const loadBomForProduct = async (productId: string) => {
    try {
      const res = await fetch(`${getPosApiDirectBase()}/produtos/${productId}/bom`, {
        headers: { ...getPosUserAuthHeaders() },
      });
      if (!res.ok) {
        setEditBomLines([]);
        return;
      }
      const data = unwrapApiSuccessPayload<BomLineDraft[]>(await res.json());
      setEditBomLines(
        Array.isArray(data)
          ? data.map((line) => ({
              component_product_id: String(line.component_product_id),
              quantity: Number(line.quantity ?? 0),
              component_name: line.component_name,
              component_unit: line.component_unit,
            }))
          : []
      );
    } catch {
      setEditBomLines([]);
    }
  };

  const addBomLine = (target: 'new' | 'edit') => {
    if (!bomIngredientId) return;
    const qty = Number(String(bomQuantity).replace(',', '.'));
    if (!Number.isFinite(qty) || qty <= 0) {
      showToast('Informe uma quantidade válida na ficha técnica.', 'error');
      return;
    }
    const option = ingredientOptions.find((item) => item.value === bomIngredientId);
    if (!option) {
      showToast('Selecione um ingrediente.', 'error');
      return;
    }
    const setter = target === 'new' ? setNewBomLines : setEditBomLines;
    setter((prev) => {
      if (prev.some((line) => line.component_product_id === bomIngredientId)) {
        showToast('Este ingrediente já está na ficha técnica.', 'error');
        return prev;
      }
      return [
        ...prev,
        {
          component_product_id: bomIngredientId,
          quantity: qty,
          component_name: option.name,
          component_unit: option.unit,
        },
      ];
    });
    setBomIngredientId('');
    setBomQuantity('1');
  };

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

  const selectedCategoryData = selectedCategory
    ? categories.find((cat) => String(cat.id) === String(selectedCategory)) ?? null
    : null;

  const categoryTree = React.useMemo(() => flattenCategoryTree(categories), [categories]);

  const categoryPathPreview = React.useMemo(() => {
    const parentId = categoryForm.parent_id || null;
    const leaf =
      categoryModalMode === 'edit'
        ? categoryForm.name.trim() || selectedCategoryData?.name || 'Grupo'
        : categoryForm.name.trim() || 'Novo grupo';
    if (categoryModalMode === 'edit' && selectedCategoryData) {
      // Path até o pai + nome em edição
      return buildCategoryPathLabel(categories, parentId || null, { leafName: leaf });
    }
    return buildCategoryPathLabel(categories, parentId, { leafName: leaf });
  }, [
    categories,
    categoryForm.parent_id,
    categoryForm.name,
    categoryModalMode,
    selectedCategoryData,
  ]);

  const openCreateCategoryModal = () => {
    setCategoryModalMode('create');
    setCategoryForm({
      name: '',
      // Se um grupo estiver seleccionado, o novo grupo nasce como subgrupo desse.
      parent_id: selectedCategory ? String(selectedCategory) : '',
      color: randomCategoryColor(),
    });
    setIsCategoryModalOpen(true);
  };

  const openEditCategoryModal = () => {
    if (!selectedCategoryData) {
      showToast('Selecione um grupo para editar.', 'error');
      return;
    }
    setCategoryModalMode('edit');
    setCategoryForm({
      name: selectedCategoryData.name ?? '',
      parent_id: selectedCategoryData.parent_id ? String(selectedCategoryData.parent_id) : '',
      color: resolveCategoryColor(selectedCategoryData.color, selectedCategoryData.name ?? 'grupo'),
    });
    setIsCategoryModalOpen(true);
  };

  const handleSaveCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedName = String(categoryForm.name ?? '').trim();
    if (!trimmedName) {
      showToast('Informe o nome do grupo.', 'error');
      return;
    }
    if (categoryModalMode === 'edit' && !selectedCategoryData) {
      showToast('Selecione um grupo valido para editar.', 'error');
      return;
    }

    try {
      const directApiBase = getPosApiDirectBase();
      const isEdit = categoryModalMode === 'edit';
      const endpoint = isEdit
        ? `${directApiBase}/categorias/${selectedCategoryData?.id}`
        : `${directApiBase}/categorias`;
      const method = isEdit ? 'PUT' : 'POST';
      const response = await fetch(endpoint, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: trimmedName,
          parent_id: categoryForm.parent_id || null,
          color: categoryForm.color || pickCategoryColor(trimmedName),
        }),
      });
      const rawBody = await response.text();
      let payload: any = null;
      if (rawBody) {
        try {
          payload = JSON.parse(rawBody);
        } catch {
          payload = { error: rawBody };
        }
      }
      if (!response.ok) {
        const normalizedError = String(payload?.error?.message ?? payload?.error ?? '').replace(/<[^>]*>/g, ' ').trim();
        throw new Error(normalizedError || `Falha ao ${isEdit ? 'atualizar' : 'criar'} grupo`);
      }
      payload = unwrapApiSuccessPayload<any>(payload);

      setIsCategoryModalOpen(false);
      const savedCategoryId = String(payload?.id ?? selectedCategoryData?.id ?? '');
      await fetchData();
      if (savedCategoryId) {
        setSelectedCategory(savedCategoryId);
      }
      showToast(isEdit ? 'Grupo atualizado com sucesso!' : 'Grupo criado com sucesso!');
    } catch (error: any) {
      console.error('Error saving category:', error);
      showToast(error?.message || 'Nao foi possivel salvar o grupo. Reinicie a API e tente novamente.', 'error');
    }
  };

  const handleDeleteCategory = async () => {
    if (!selectedCategoryData) {
      showToast('Selecione um grupo para excluir.', 'error');
      return;
    }

    try {
      const directApiBase = getPosApiDirectBase();
      const response = await fetch(`${directApiBase}/categorias/${selectedCategoryData.id}`, {
        method: 'DELETE',
      });
      const rawBody = await response.text();
      let payload: any = null;
      if (rawBody) {
        try {
          payload = JSON.parse(rawBody);
        } catch {
          payload = { error: rawBody };
        }
      }
      if (!response.ok) {
        const normalizedError = String(payload?.error?.message ?? payload?.error ?? '').replace(/<[^>]*>/g, ' ').trim();
        throw new Error(normalizedError || 'Falha ao remover grupo');
      }
      payload = unwrapApiSuccessPayload<any>(payload);

      setIsDeleteCategoryConfirmOpen(false);
      setSelectedCategory(null);
      await fetchData();
      showToast('Grupo removido com sucesso!');
    } catch (error: any) {
      console.error('Error deleting category:', error);
      showToast(error?.message || 'Nao foi possivel remover o grupo. Reinicie a API e tente novamente.', 'error');
    }
  };

  return (
    <div className="flex flex-col h-full bg-[#1a1a1a] text-zinc-300 overflow-hidden">
      {/* Toolbar */}
      <div className="h-16 bg-[#1a1a1a] border-b border-zinc-800 flex items-center px-2 gap-1 overflow-x-auto no-scrollbar">
        <ManagementToolbarButton icon={<RotateCcw size={20} />} label="Atualizar" onClick={fetchData} />
        <ManagementToolbarButton icon={<FolderPlus size={20} />} label="Novo grupo" onClick={openCreateCategoryModal} />
        <ManagementToolbarButton icon={<Edit size={20} />} label="Editar grupo" onClick={openEditCategoryModal} disabled={!selectedCategoryData} />
        <ManagementToolbarButton icon={<Trash2 size={20} />} label="Deletar grupo" onClick={() => {
          if (!selectedCategoryData) {
            showToast('Selecione um grupo para excluir.', 'error');
            return;
          }
          setIsDeleteCategoryConfirmOpen(true);
        }} disabled={!selectedCategoryData} />
        <ManagementToolbarButton 
          icon={<Plus size={20} />} 
          label="Novo produto" 
          active={isNewProductModalOpen}
          onClick={openNewProductModal}
        />
        <ManagementToolbarButton 
          icon={<Edit3 size={20} />} 
          label="Editar produto" 
          active={isEditProductModalOpen}
          onClick={() => {
            if (selectedProductId) {
              const p = products.find((prod) => String(prod.id) === String(selectedProductId));
              if (p) {
                setEditingProduct({
                  ...p,
                  product_kind: (p.product_kind as ProductKind) || 'simple',
                });
                setBomIngredientId('');
                setBomQuantity('1');
                setActiveTab('detalhes');
                setIsEditProductModalOpen(true);
                if ((p.product_kind || 'simple') === 'composed') {
                  void loadBomForProduct(String(p.id));
                } else {
                  setEditBomLines([]);
                }
              }
            }
          }}
        />
        <ManagementToolbarButton 
          icon={<Trash size={20} />} 
          label="Deletar produto" 
          active={isDeleteConfirmOpen}
          onClick={() => {
            if (selectedProductId) {
              setProductToDelete(String(selectedProductId));
              setIsDeleteConfirmOpen(true);
            }
          }}
        />
        <ManagementToolbarButton icon={<Printer size={20} />} label="Imprimir" />
        <ManagementToolbarButton icon={<FileText size={20} />} label="Salvar como PDF" />
        <ManagementToolbarButton icon={<Hash size={20} />} label="Etiquetas de preço" />
        <ManagementToolbarButton icon={<Download size={20} />} label="Importar" />
        <ManagementToolbarButton icon={<Upload size={20} />} label="Exportar" />
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
              {categoryTree.map((cat) => (
                <div 
                  key={cat.id}
                  onClick={() => setSelectedCategory(String(cat.id))}
                  style={{ paddingLeft: `${12 + cat.depth * 14}px` }}
                  className={`flex items-center gap-2 pr-2 py-1.5 rounded cursor-pointer transition-colors text-xs ${
                    String(selectedCategory) === String(cat.id)
                      ? 'bg-[var(--pos-brand-selected-bg)] text-white'
                      : 'text-zinc-400 hover:text-[#0001fb]'
                  }`}
                >
                  <Folder size={14} className="shrink-0" />
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full border border-white/20"
                    style={{
                      backgroundColor: resolveCategoryColor(cat.color, cat.name),
                    }}
                  />
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
          <div className="flex-1 overflow-auto custom-scrollbar bg-[#0f0f0f]">
            <table className="w-full table-fixed border-collapse text-left text-xs [&_th]:border [&_td]:border [&_th]:border-zinc-800/55 [&_td]:border-zinc-800/55">
              <thead className="sticky top-0 z-10 bg-[#141414]">
                <tr className="border-b border-[#0001fb]/70">
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
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={12} className="py-20 text-center">
                      <div className="flex flex-col items-center gap-2">
                        <Loader2 size={24} className="text-blue-500 animate-spin" />
                        <span className="text-xs text-zinc-500">Carregando produtos...</span>
                      </div>
                    </td>
                  </tr>
                ) : filteredProducts.length === 0 ? (
                  <tr>
                    <td colSpan={12} className="py-20 text-center text-xs text-zinc-600 italic">
                      Nenhum produto encontrado
                    </td>
                  </tr>
                ) : (
                  filteredProducts.map((p, i) => {
                    const productId = String(p.id);
                    const isSelected = selectedProductId === productId;
                    return (
                    <tr 
                      key={productId} 
                      onClick={() => setSelectedProductId(productId)}
                      onDoubleClick={() => {
                        setSelectedProductId(productId);
                        setEditingProduct({
                          ...p,
                          product_kind: (p.product_kind as ProductKind) || 'simple',
                        });
                        setBomIngredientId('');
                        setBomQuantity('1');
                        setActiveTab('detalhes');
                        setIsEditProductModalOpen(true);
                        if ((p.product_kind || 'simple') === 'composed') {
                          void loadBomForProduct(productId);
                        } else {
                          setEditBomLines([]);
                        }
                      }}
                      className={`transition-colors cursor-pointer ${
                        isSelected
                          ? 'bg-[var(--pos-brand-selected-bg)]'
                          : i % 2
                            ? 'bg-[#171717]'
                            : 'bg-[#1d1d1d]'
                      } hover:bg-[var(--pos-brand-hover-bg)]`}
                    >
                      <td className="px-3 py-2 text-xs text-zinc-200 whitespace-nowrap truncate">{p.code || '---'}</td>
                      <td className="px-3 py-2 text-xs text-zinc-200 whitespace-nowrap truncate">{p.name}</td>
                      <td className="px-3 py-2 text-xs text-zinc-400 whitespace-nowrap truncate">{p.categories?.name || 'Geral'}</td>
                      <td className="px-3 py-2 text-xs text-zinc-400 whitespace-nowrap truncate">{p.barcode || '---'}</td>
                      <td className="px-3 py-2 text-xs text-zinc-400 text-right whitespace-nowrap truncate">{formatPrice(p.cost || 0)}</td>
                      <td className="px-3 py-2 text-xs text-zinc-200 text-right whitespace-nowrap truncate">{formatPrice(p.price)}</td>
                      <td className="px-3 py-2 text-xs text-zinc-400 text-right whitespace-nowrap truncate">
                        {p.tax_rate_name ? `${p.tax_rate_name} (${Number(p.tax_rate_percent ?? 0)}%)` : '---'}
                      </td>
                      <td className="px-3 py-2 text-xs text-zinc-200 text-right whitespace-nowrap truncate">{formatPrice(p.final_price || p.price)}</td>
                      <td className="px-3 py-2 text-xs text-center whitespace-nowrap">
                        <div className="flex justify-center">
                          {p.active ? <Check size={14} className="text-emerald-500" /> : <X size={14} className="text-rose-500" />}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-xs text-zinc-400 text-center whitespace-nowrap truncate">{p.unit || 'un'}</td>
                      <td className="px-3 py-2 text-xs text-zinc-400 whitespace-nowrap truncate">{new Date(p.created_at).toLocaleDateString()}</td>
                      <td className="px-3 py-2 text-xs text-zinc-400 whitespace-nowrap truncate">{new Date(p.updated_at).toLocaleDateString()}</td>
                    </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Create/Edit Category Modal */}
      {isCategoryModalOpen && (
        <div
          className="fixed inset-0 z-[105] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
          onClick={() => setIsCategoryModalOpen(false)}
        >
          <div
            className="bg-[#1a1a1a] border border-zinc-800 rounded w-full max-w-lg overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-4 flex items-center bg-[#1a1a1a]">
              <h3 className="text-xl text-zinc-200">
                {categoryModalMode === 'edit' ? 'Editar grupo' : 'Novo grupo'}
              </h3>
            </div>

            <div className="flex border-b border-zinc-800">
              <button
                type="button"
                className="pos-on-accent relative px-6 py-2 text-[11px] font-medium bg-[#0001fb] text-white"
              >
                Detalhes
                <span className="absolute left-1/2 -bottom-[6px] -translate-x-1/2 w-0 h-0 border-l-[6px] border-r-[6px] border-t-[6px] border-l-transparent border-r-transparent border-t-[#0001fb]" />
              </button>
              <div className="flex-1 border-b border-[#0001fb]" />
            </div>

            <form id="category-form" onSubmit={handleSaveCategory} className="p-6 space-y-5 bg-[#1a1a1a]">
              <div className="rounded border border-zinc-600 bg-zinc-800/50 px-3 py-2 text-[11px] text-zinc-400">
                Caminho:{' '}
                <span className="font-medium text-zinc-200">{categoryPathPreview}</span>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-medium text-zinc-300">Nome</label>
                <input
                  type="text"
                  autoFocus
                  required
                  value={categoryForm.name}
                  onChange={(e) => setCategoryForm((prev) => ({ ...prev, name: e.target.value }))}
                  className="pos-field px-3 py-2 text-sm"
                />
              </div>

              <div className="space-y-2">
                <label className="text-xs font-medium text-zinc-300">Grupo pai</label>
                <PosSelect
                  value={categoryForm.parent_id}
                  onChange={(v) => setCategoryForm((prev) => ({ ...prev, parent_id: v }))}
                  size="md"
                  options={[
                    { value: '', label: 'Produtos' },
                    ...categoryTree
                      .filter((cat) => categoryModalMode !== 'edit' || String(cat.id) !== String(selectedCategoryData?.id))
                      .map((cat) => ({
                        value: String(cat.id),
                        label: `${'— '.repeat(cat.depth)}${cat.name}`,
                      })),
                  ]}
                />
                <p className="text-[10px] text-zinc-400">
                  Com um grupo seleccionado na árvore, «Novo grupo» cria automaticamente um subgrupo.
                </p>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <label className="text-xs font-medium text-zinc-300">Cor</label>
                  <button
                    type="button"
                    onClick={() =>
                      setCategoryForm((prev) => ({
                        ...prev,
                        color: randomCategoryColor(prev.color),
                      }))
                    }
                    className="text-[10px] font-medium uppercase tracking-wide text-zinc-300 hover:text-[#0001fb] transition-colors"
                  >
                    Gerar outra
                  </button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {CATEGORY_COLOR_PALETTE.map((swatch) => {
                    const active = categoryForm.color.toLowerCase() === swatch.toLowerCase();
                    return (
                      <button
                        key={swatch}
                        type="button"
                        title={swatch}
                        onClick={() => setCategoryForm((prev) => ({ ...prev, color: swatch }))}
                        className={`h-8 w-8 rounded border-2 transition-transform ${
                          active ? 'border-zinc-900 scale-110' : 'border-transparent hover:scale-105'
                        }`}
                        style={{ backgroundColor: swatch }}
                      />
                    );
                  })}
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className="h-9 w-9 shrink-0 rounded border border-zinc-600"
                    style={{ backgroundColor: categoryForm.color || '#2563eb' }}
                  />
                  <input
                    type="text"
                    value={categoryForm.color}
                    onChange={(e) => setCategoryForm((prev) => ({ ...prev, color: e.target.value }))}
                    placeholder="#2563eb"
                    className="pos-field px-3 py-2 text-sm font-mono"
                  />
                </div>
              </div>
            </form>

            <div className="p-4 bg-[#1a1a1a] border-t border-zinc-800 flex justify-end gap-3">
              <button
                type="submit"
                form="category-form"
                className="pos-on-accent flex items-center gap-2 px-6 py-2 rounded bg-[#0001fb] text-xs font-medium text-white transition-colors hover:bg-[#1a1bff]"
              >
                <Check size={16} />
                Salvar
              </button>
              <button
                type="button"
                onClick={() => setIsCategoryModalOpen(false)}
                className="flex items-center gap-2 px-6 py-2 rounded border border-zinc-600 bg-transparent text-xs font-medium text-zinc-200 transition-colors hover:border-[#0001fb] hover:bg-[var(--pos-brand-hover-bg)] hover:text-[#0001fb]"
              >
                <X size={16} />
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* New Product Modal */}
      {isNewProductModalOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={() => setIsNewProductModalOpen(false)}>
          <div className="bg-[#1a1a1a] border border-zinc-800 rounded w-full max-w-lg overflow-hidden flex flex-col max-h-[90vh]" onClick={(e) => e.stopPropagation()}>
            {/* Header */}
            <div className="p-4 flex items-center bg-[#1a1a1a]">
              <h3 className="text-xl text-zinc-200">Novo produto</h3>
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
                      activeTab === tab.key ? 'bg-[#0001fb] text-white' : 'text-zinc-400 hover:text-[#0001fb]'
                    }`}
                  >
                    {tab.label}
                    {activeTab === tab.key && (
                      <span className="absolute left-1/2 -bottom-[6px] -translate-x-1/2 w-0 h-0 border-l-[6px] border-r-[6px] border-t-[6px] border-l-transparent border-r-transparent border-t-[#0001fb]" />
                    )}
                  </button>
                ))}
              </div>
              <div className="flex border-b border-[#0001fb]">
                {bottomTabs.map((tab) => (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => setActiveTab(tab.key)}
                    className={`relative flex-1 py-2 text-[11px] font-medium text-center transition-colors ${
                      activeTab === tab.key ? 'bg-[#0001fb] text-white' : 'text-zinc-400 hover:text-[#0001fb]'
                    }`}
                  >
                    {tab.label}
                    {activeTab === tab.key && (
                      <span className="absolute left-1/2 -bottom-[6px] -translate-x-1/2 w-0 h-0 border-l-[6px] border-r-[6px] border-t-[6px] border-l-transparent border-r-transparent border-t-[#0001fb]" />
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
                    <BarcodeChipField
                      value={newProduct.barcode ?? ''}
                      onChange={(barcode) => setNewProduct((prev) => ({ ...prev, barcode }))}
                    />
                    <button
                      type="button"
                      onClick={() => {
                        const code = generateEan13Barcode(products.map((p) => p.barcode));
                        setNewProduct((prev) => ({ ...prev, barcode: code }));
                      }}
                      className="mt-1 text-[11px] text-[#0001fb] hover:text-[#1a1bff] hover:underline"
                    >
                      Gerar código de barras
                    </button>
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
                    <PosSelect
                      value={newProduct.category_id ?? ''}
                      onChange={(v) => setNewProduct({ ...newProduct, category_id: v })}
                      size="md"
                      options={[
                        { value: '', label: 'Produtos' },
                        ...categories.map((cat) => ({ value: String(cat.id), label: cat.name })),
                      ]}
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs text-zinc-400 mr-2">Tipo de produto</label>
                    <PosSelect
                      value={newProduct.product_kind}
                      onChange={(v) => {
                        const kind = (v as ProductKind) || 'simple';
                        setNewProduct((prev) => applyProductKind(prev, kind));
                        if (kind !== 'composed') setNewBomLines([]);
                        setActiveTab((tab) => {
                          if ((kind === 'service' || kind === 'composed') && tab === 'estoque') {
                            return kind === 'composed' ? 'ficha' : 'detalhes';
                          }
                          if (kind !== 'composed' && tab === 'ficha') return 'detalhes';
                          return tab;
                        });
                      }}
                      size="md"
                      options={[
                        { value: 'simple', label: 'Simples (venda + stock)' },
                        { value: 'service', label: 'Serviço (venda sem stock)' },
                        { value: 'composed', label: 'Composto (ficha técnica)' },
                        { value: 'ingredient', label: 'Ingrediente (só stock)' },
                      ]}
                    />
                    {newProduct.product_kind === 'ingredient' ? (
                      <p className="text-[10px] text-zinc-500">Não aparece no POS para venda — só compras e ficha técnica.</p>
                    ) : null}
                    {newProduct.product_kind === 'service' ? (
                      <p className="text-[10px] text-zinc-500">Vende no POS sem controlar stock.</p>
                    ) : null}
                    {newProduct.product_kind === 'composed' ? (
                      <p className="text-[10px] text-zinc-500">Não controla stock próprio; a venda baixa os ingredientes da ficha técnica.</p>
                    ) : null}
                  </div>

                  <div className="flex flex-wrap items-center gap-x-8 gap-y-2 pt-2">
                    <PosSwitch
                      label="Ativo"
                      checked={Boolean(newProduct.active)}
                      onChange={(active) => setNewProduct({ ...newProduct, active })}
                    />
                    {newProduct.product_kind === 'simple' || newProduct.product_kind === 'ingredient' ? (
                      <PosSwitch
                        label="Lote"
                        title="Quando activo, compras e entradas pedem o código do lote. O custo FIFO e a margem actualizam sempre."
                        checked={Boolean(newProduct.track_lot)}
                        onChange={(track_lot) => setNewProduct({ ...newProduct, track_lot })}
                      />
                    ) : null}
                    <PosSwitch
                      label="Quantidade padrão"
                      checked={Boolean(newProduct.default_quantity)}
                      onChange={(default_quantity) => setNewProduct({ ...newProduct, default_quantity })}
                    />
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
                  {newProduct.product_kind === 'ingredient' ? (
                    <>
                      <p className="text-xs text-zinc-500">
                        Ingredientes não vendem no POS. O preço de venda é opcional (fica 0 se vazio). Use o custo para compras e valorização.
                      </p>
                      <div className="space-y-1">
                        <label className="text-xs text-zinc-400">{moneyFieldLabel('Custo')}</label>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          inputMode="decimal"
                          placeholder={POS_MONEY_PLACEHOLDER}
                          value={moneyInputValue(newProduct.cost)}
                          onChange={(e) => setNewProduct({ ...newProduct, cost: parseMoneyInput(e.target.value) })}
                          className="w-full bg-[#1a1a1a] border border-zinc-800 rounded px-3 py-1.5 text-sm text-white focus:border-blue-500 outline-none transition-colors placeholder:text-zinc-600"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs text-zinc-400">{moneyFieldLabel('Preço de Venda (opcional)')}</label>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          inputMode="decimal"
                          placeholder={POS_MONEY_PLACEHOLDER}
                          value={moneyInputValue(newProduct.price)}
                          onChange={(e) => {
                            const val = parseMoneyInput(e.target.value);
                            setNewProduct({
                              ...newProduct,
                              price: val,
                              ...calculateTaxValues(val, newProduct.tax_rate_id),
                            });
                          }}
                          className="w-full bg-[#1a1a1a] border border-zinc-800 rounded px-3 py-1.5 text-sm text-white focus:border-blue-500 outline-none transition-colors placeholder:text-zinc-600"
                        />
                      </div>
                      <ProductMarginReadout sellingPrice={Number(newProduct.price) || 0} unitCost={Number(newProduct.cost) || 0} />
                    </>
                  ) : (
                    <>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1">
                          <label className="text-xs text-zinc-400">{moneyFieldLabel('Preço de Venda')}</label>
                          <input 
                            type="number" 
                            required
                            step="0.01"
                            min="0"
                            inputMode="decimal"
                            placeholder={POS_MONEY_PLACEHOLDER}
                            value={moneyInputValue(newProduct.price)}
                            onChange={(e) => {
                              const val = parseMoneyInput(e.target.value);
                              setNewProduct({
                                ...newProduct,
                                price: val,
                                ...calculateTaxValues(val, newProduct.tax_rate_id),
                              });
                            }}
                            className="w-full bg-[#1a1a1a] border border-zinc-800 rounded px-3 py-1.5 text-sm text-white focus:border-blue-500 outline-none transition-colors placeholder:text-zinc-600"
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-xs text-zinc-400">{moneyFieldLabel('Custo')}</label>
                          <input 
                            type="number" 
                            step="0.01"
                            min="0"
                            inputMode="decimal"
                            placeholder={POS_MONEY_PLACEHOLDER}
                            value={moneyInputValue(newProduct.cost)}
                            onChange={(e) => setNewProduct({...newProduct, cost: parseMoneyInput(e.target.value)})}
                            className="w-full bg-[#1a1a1a] border border-zinc-800 rounded px-3 py-1.5 text-sm text-white focus:border-blue-500 outline-none transition-colors placeholder:text-zinc-600"
                          />
                        </div>
                      </div>

                      <ProductMarginReadout sellingPrice={Number(newProduct.price) || 0} unitCost={Number(newProduct.cost) || 0} />

                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1">
                          <label className="text-xs text-zinc-400">Imposto</label>
                          <PosSelect
                            value={newProduct.tax_rate_id}
                            onChange={(tax_rate_id) =>
                              setNewProduct({
                                ...newProduct,
                                tax_rate_id,
                                ...calculateTaxValues(newProduct.price, tax_rate_id),
                              })
                            }
                            options={taxRates
                              .filter((rate) => rate.enabled)
                              .map((rate) => ({
                                value: rate.id,
                                label: (() => {
                                  if (Number(rate.rate) === 0) return `${rate.name} (isento)`;
                                  const mode =
                                    rate.priceIncludesTax === false ? ' + imposto' : ' c/ imposto';
                                  return rate.isFixed
                                    ? `${rate.name} (${rate.rate.toFixed(2)} MT)${mode}`
                                    : `${rate.name} (${rate.rate}%)${mode}`;
                                })(),
                              }))}
                          />
                          <p className="text-[10px] text-zinc-500">Valor calculado: {formatPrice(newProduct.tax || 0)}</p>
                        </div>
                        <div className="space-y-1">
                          <label className="text-xs text-zinc-400">{moneyFieldLabel('Preço Final')}</label>
                          <input 
                            type="number" 
                            disabled
                            placeholder={POS_MONEY_PLACEHOLDER}
                            value={moneyInputValue(newProduct.final_price)}
                            className="w-full bg-[#141414] border border-zinc-800 rounded px-3 py-1.5 text-sm text-zinc-500 outline-none placeholder:text-zinc-700"
                          />
                        </div>
                      </div>
                    </>
                  )}
                </div>
              )}

              {activeTab === 'ficha' && newProduct.product_kind === 'composed' && (
                <div className="space-y-4">
                  <p className="text-xs text-zinc-500">
                    Adicione ingredientes (tipo Ingrediente). Ao vender este produto, o stock baixa nestes itens.
                  </p>
                  <div className="grid grid-cols-[1fr_88px_auto] gap-2 items-end">
                    <div className="space-y-1">
                      <label className="text-xs text-zinc-400">Ingrediente</label>
                      <PosSelect
                        value={bomIngredientId}
                        onChange={setBomIngredientId}
                        size="md"
                        placeholder={ingredientOptions.length ? 'Selecionar…' : 'Crie ingredientes primeiro'}
                        options={[
                          { value: '', label: ingredientOptions.length ? 'Selecionar…' : 'Sem ingredientes' },
                          ...ingredientOptions.map((opt) => ({ value: opt.value, label: opt.label })),
                        ]}
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs text-zinc-400">Qtd</label>
                      <input
                        type="number"
                        min="0.001"
                        step="0.001"
                        value={bomQuantity}
                        onChange={(e) => setBomQuantity(e.target.value)}
                        className="w-full rounded border border-zinc-800 bg-[#1a1a1a] px-2 py-2 text-sm text-white outline-none focus:border-blue-500"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => addBomLine('new')}
                      className="h-10 rounded bg-[#0001fb] px-3 text-xs font-medium text-white hover:bg-[#1a1bff]"
                    >
                      Adicionar
                    </button>
                  </div>
                  {newBomLines.length === 0 ? (
                    <p className="py-6 text-center text-xs text-zinc-600 italic">Nenhum ingrediente na ficha técnica</p>
                  ) : (
                    <div className="overflow-hidden rounded border border-zinc-800">
                      <table className="w-full border-collapse text-left text-xs [&_th]:border [&_td]:border [&_th]:border-zinc-800/55 [&_td]:border-zinc-800/55">
                        <thead className="bg-[#141414]">
                          <tr className="border-b border-[#0001fb]/70">
                            <th className="px-3 py-2 text-xs font-bold text-zinc-300">Ingrediente</th>
                            <th className="px-3 py-2 text-xs font-bold text-zinc-300">Qtd</th>
                            <th className="px-3 py-2 text-xs font-bold text-zinc-300">Un.</th>
                            <th className="px-3 py-2" />
                          </tr>
                        </thead>
                        <tbody>
                          {newBomLines.map((line) => (
                            <tr key={line.component_product_id} className="border-t border-zinc-800/70">
                              <td className="px-3 py-2 text-zinc-200">{line.component_name}</td>
                              <td className="px-3 py-2 text-zinc-300">{line.quantity}</td>
                              <td className="px-3 py-2 text-zinc-500">{line.component_unit || 'un'}</td>
                              <td className="px-3 py-2 text-right">
                                <button
                                  type="button"
                                  className="text-rose-400 hover:text-rose-300"
                                  onClick={() =>
                                    setNewBomLines((prev) =>
                                      prev.filter((item) => item.component_product_id !== line.component_product_id)
                                    )
                                  }
                                >
                                  Remover
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {activeTab === 'estoque' && (
                <div className="space-y-4">
                  <div className="space-y-1">
                    <label className="text-xs text-zinc-400">Quantidade em stock</label>
                    <input 
                      type="number" 
                      step="0.01"
                      value={newProduct.stock_quantity ?? 0}
                      onChange={(e) => setNewProduct({...newProduct, stock_quantity: Number(e.target.value)})}
                      className="w-full bg-[#1a1a1a] border border-zinc-800 rounded px-3 py-1.5 text-sm text-white focus:border-blue-500 outline-none transition-colors"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-zinc-400">Stock mínimo</label>
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
                className="flex items-center gap-2 px-6 py-2 rounded bg-[#0001fb] text-xs font-medium text-white transition-colors hover:bg-[#1a1bff]"
              >
                <Check size={16} />
                Salvar
              </button>
              <button 
                type="button"
                onClick={() => setIsNewProductModalOpen(false)}
                className="flex items-center gap-2 px-6 py-2 rounded border border-zinc-700 bg-transparent text-xs font-medium text-zinc-300 transition-colors hover:border-[#0001fb] hover:bg-[var(--pos-brand-hover-bg)] hover:text-white"
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
            <div className="p-4 flex items-center bg-[#1a1a1a]">
              <h3 className="text-xl text-zinc-200">Editar produto</h3>
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
                      activeTab === tab.key ? 'bg-[#0001fb] text-white' : 'text-zinc-400 hover:text-[#0001fb]'
                    }`}
                  >
                    {tab.label}
                    {activeTab === tab.key && (
                      <span className="absolute left-1/2 -bottom-[6px] -translate-x-1/2 w-0 h-0 border-l-[6px] border-r-[6px] border-t-[6px] border-l-transparent border-r-transparent border-t-[#0001fb]" />
                    )}
                  </button>
                ))}
              </div>
              <div className="flex border-b border-[#0001fb]">
                {bottomTabs.map((tab) => (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => setActiveTab(tab.key)}
                    className={`relative flex-1 py-2 text-[11px] font-medium text-center transition-colors ${
                      activeTab === tab.key ? 'bg-[#0001fb] text-white' : 'text-zinc-400 hover:text-[#0001fb]'
                    }`}
                  >
                    {tab.label}
                    {activeTab === tab.key && (
                      <span className="absolute left-1/2 -bottom-[6px] -translate-x-1/2 w-0 h-0 border-l-[6px] border-r-[6px] border-t-[6px] border-l-transparent border-r-transparent border-t-[#0001fb]" />
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
                      disabled={!canRenameProduct}
                      title={
                        canRenameProduct
                          ? undefined
                          : 'Apenas utilizadores de nível 9 podem alterar o nome do produto'
                      }
                      onChange={(e) => setEditingProduct({...editingProduct, name: e.target.value})}
                      className={`w-full bg-[#1a1a1a] border border-zinc-800 rounded px-3 py-1.5 text-sm text-white focus:border-blue-500 outline-none transition-colors ${
                        canRenameProduct ? '' : 'opacity-60 cursor-not-allowed'
                      }`}
                    />
                    {!canRenameProduct ? (
                      <p className="text-[11px] text-amber-400/90">
                        O nome só pode ser alterado por utilizadores de nível 9.
                      </p>
                    ) : null}
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
                    <BarcodeChipField
                      value={editingProduct.barcode ?? ''}
                      onChange={(barcode) =>
                        setEditingProduct((prev) => (prev ? { ...prev, barcode } : prev))
                      }
                    />
                    <button
                      type="button"
                      onClick={() => {
                        const code = generateEan13Barcode(products.map((p) => p.barcode));
                        setEditingProduct((prev) => (prev ? { ...prev, barcode: code } : prev));
                      }}
                      className="mt-1 text-[11px] text-[#0001fb] hover:text-[#1a1bff] hover:underline"
                    >
                      Gerar código de barras
                    </button>
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
                    <PosSelect
                      value={editingProduct.category_id ?? ''}
                      onChange={(v) => setEditingProduct({ ...editingProduct, category_id: v })}
                      size="md"
                      options={[
                        { value: '', label: 'Produtos' },
                        ...categories.map((cat) => ({ value: String(cat.id), label: cat.name })),
                      ]}
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs text-zinc-400 mr-2">Tipo de produto</label>
                    <PosSelect
                      value={(editingProduct.product_kind as ProductKind) || 'simple'}
                      onChange={(v) => {
                        const kind = (v as ProductKind) || 'simple';
                        setEditingProduct((prev) => (prev ? applyProductKind(prev, kind) : prev));
                        if (kind !== 'composed') setEditBomLines([]);
                        setActiveTab((tab) => {
                          if ((kind === 'service' || kind === 'composed') && tab === 'estoque') {
                            return kind === 'composed' ? 'ficha' : 'detalhes';
                          }
                          if (kind !== 'composed' && tab === 'ficha') return 'detalhes';
                          return tab;
                        });
                      }}
                      size="md"
                      options={[
                        { value: 'simple', label: 'Simples (venda + stock)' },
                        { value: 'service', label: 'Serviço (venda sem stock)' },
                        { value: 'composed', label: 'Composto (ficha técnica)' },
                        { value: 'ingredient', label: 'Ingrediente (só stock)' },
                      ]}
                    />
                    {(editingProduct.product_kind || 'simple') === 'ingredient' ? (
                      <p className="text-[10px] text-zinc-500">Não aparece no POS para venda — só compras e ficha técnica.</p>
                    ) : null}
                    {(editingProduct.product_kind || 'simple') === 'service' ? (
                      <p className="text-[10px] text-zinc-500">Vende no POS sem controlar stock.</p>
                    ) : null}
                    {(editingProduct.product_kind || 'simple') === 'composed' ? (
                      <p className="text-[10px] text-zinc-500">Não controla stock próprio; a venda baixa os ingredientes da ficha técnica.</p>
                    ) : null}
                  </div>

                  <div className="flex flex-wrap items-center gap-x-8 gap-y-2 pt-2">
                    <PosSwitch
                      label="Ativo"
                      checked={Boolean(editingProduct.active)}
                      onChange={(active) => setEditingProduct({ ...editingProduct, active })}
                    />
                    {(editingProduct.product_kind || 'simple') === 'simple' ||
                    (editingProduct.product_kind || 'simple') === 'ingredient' ? (
                      <PosSwitch
                        label="Lote"
                        title="Quando activo, compras e entradas pedem o código do lote. O custo FIFO e a margem actualizam sempre."
                        checked={Boolean(editingProduct.track_lot)}
                        onChange={(track_lot) => setEditingProduct({ ...editingProduct, track_lot })}
                      />
                    ) : null}
                    <PosSwitch
                      label="Quantidade padrão"
                      checked={Boolean(editingProduct.default_quantity)}
                      onChange={(default_quantity) => setEditingProduct({ ...editingProduct, default_quantity })}
                    />
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
                  {(editingProduct.product_kind || 'simple') === 'ingredient' ? (
                    <>
                      <p className="text-xs text-zinc-500">
                        Ingredientes não vendem no POS. O preço de venda é opcional (fica 0 se vazio). Use o custo para compras e valorização.
                      </p>
                      <div className="space-y-1">
                        <label className="text-xs text-zinc-400">{moneyFieldLabel('Custo')}</label>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          inputMode="decimal"
                          placeholder={POS_MONEY_PLACEHOLDER}
                          value={moneyInputValue(editingProduct.cost)}
                          onChange={(e) =>
                            setEditingProduct({ ...editingProduct, cost: parseMoneyInput(e.target.value) })
                          }
                          className="w-full bg-[#1a1a1a] border border-zinc-800 rounded px-3 py-1.5 text-sm text-white focus:border-blue-500 outline-none transition-colors placeholder:text-zinc-600"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs text-zinc-400">{moneyFieldLabel('Preço de Venda (opcional)')}</label>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          inputMode="decimal"
                          placeholder={POS_MONEY_PLACEHOLDER}
                          value={moneyInputValue(editingProduct.price)}
                          onChange={(e) => {
                            const val = parseMoneyInput(e.target.value);
                            setEditingProduct({
                              ...editingProduct,
                              price: val,
                              ...calculateTaxValues(val, editingProduct.tax_rate_id),
                            });
                          }}
                          className="w-full bg-[#1a1a1a] border border-zinc-800 rounded px-3 py-1.5 text-sm text-white focus:border-blue-500 outline-none transition-colors placeholder:text-zinc-600"
                        />
                      </div>
                      <ProductMarginReadout
                        sellingPrice={Number(editingProduct.price) || 0}
                        unitCost={Number(editingProduct.cost) || 0}
                      />
                    </>
                  ) : (
                    <>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1">
                          <label className="text-xs text-zinc-400">{moneyFieldLabel('Preço de Venda')}</label>
                          <input 
                            type="number" 
                            required
                            step="0.01"
                            min="0"
                            inputMode="decimal"
                            placeholder={POS_MONEY_PLACEHOLDER}
                            value={moneyInputValue(editingProduct.price)}
                            onChange={(e) => {
                              const val = parseMoneyInput(e.target.value);
                              setEditingProduct({
                                ...editingProduct,
                                price: val,
                                ...calculateTaxValues(val, editingProduct.tax_rate_id),
                              });
                            }}
                            className="w-full bg-[#1a1a1a] border border-zinc-800 rounded px-3 py-1.5 text-sm text-white focus:border-blue-500 outline-none transition-colors placeholder:text-zinc-600"
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-xs text-zinc-400">{moneyFieldLabel('Custo')}</label>
                          <input 
                            type="number" 
                            step="0.01"
                            min="0"
                            inputMode="decimal"
                            placeholder={POS_MONEY_PLACEHOLDER}
                            value={moneyInputValue(editingProduct.cost)}
                            onChange={(e) => setEditingProduct({...editingProduct, cost: parseMoneyInput(e.target.value)})}
                            className="w-full bg-[#1a1a1a] border border-zinc-800 rounded px-3 py-1.5 text-sm text-white focus:border-blue-500 outline-none transition-colors placeholder:text-zinc-600"
                          />
                        </div>
                      </div>

                      <ProductMarginReadout
                        sellingPrice={Number(editingProduct.price) || 0}
                        unitCost={Number(editingProduct.cost) || 0}
                      />

                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1">
                          <label className="text-xs text-zinc-400">Imposto</label>
                          <PosSelect
                            value={editingProduct.tax_rate_id ?? ''}
                            onChange={(tax_rate_id) =>
                              setEditingProduct({
                                ...editingProduct,
                                tax_rate_id,
                                ...calculateTaxValues(editingProduct.price, tax_rate_id),
                              })
                            }
                            options={taxRates
                              .filter((rate) => rate.enabled || rate.id === editingProduct.tax_rate_id)
                              .map((rate) => ({
                                value: rate.id,
                                label: (() => {
                                  if (Number(rate.rate) === 0) return `${rate.name} (isento)`;
                                  const mode =
                                    rate.priceIncludesTax === false ? ' + imposto' : ' c/ imposto';
                                  return rate.isFixed
                                    ? `${rate.name} (${rate.rate.toFixed(2)} MT)${mode}`
                                    : `${rate.name} (${rate.rate}%)${mode}`;
                                })(),
                              }))}
                          />
                          <p className="text-[10px] text-zinc-500">Valor calculado: {formatPrice(editingProduct.tax || 0)}</p>
                        </div>
                        <div className="space-y-1">
                          <label className="text-xs text-zinc-400">{moneyFieldLabel('Preço Final')}</label>
                          <input 
                            type="number" 
                            disabled
                            placeholder={POS_MONEY_PLACEHOLDER}
                            value={moneyInputValue(editingProduct.final_price)}
                            className="w-full bg-[#141414] border border-zinc-800 rounded px-3 py-1.5 text-sm text-zinc-500 outline-none placeholder:text-zinc-700"
                          />
                        </div>
                      </div>
                    </>
                  )}
                </div>
              )}

              {activeTab === 'ficha' && (editingProduct.product_kind || 'simple') === 'composed' && (
                <div className="space-y-4">
                  <p className="text-xs text-zinc-500">
                    Adicione ingredientes (tipo Ingrediente). Ao vender este produto, o stock baixa nestes itens.
                  </p>
                  <div className="grid grid-cols-[1fr_88px_auto] gap-2 items-end">
                    <div className="space-y-1">
                      <label className="text-xs text-zinc-400">Ingrediente</label>
                      <PosSelect
                        value={bomIngredientId}
                        onChange={setBomIngredientId}
                        size="md"
                        placeholder={ingredientOptions.length ? 'Selecionar…' : 'Crie ingredientes primeiro'}
                        options={[
                          { value: '', label: ingredientOptions.length ? 'Selecionar…' : 'Sem ingredientes' },
                          ...ingredientOptions
                            .filter((opt) => opt.value !== String(editingProduct.id))
                            .map((opt) => ({ value: opt.value, label: opt.label })),
                        ]}
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs text-zinc-400">Qtd</label>
                      <input
                        type="number"
                        min="0.001"
                        step="0.001"
                        value={bomQuantity}
                        onChange={(e) => setBomQuantity(e.target.value)}
                        className="w-full rounded border border-zinc-800 bg-[#1a1a1a] px-2 py-2 text-sm text-white outline-none focus:border-blue-500"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => addBomLine('edit')}
                      className="h-10 rounded bg-[#0001fb] px-3 text-xs font-medium text-white hover:bg-[#1a1bff]"
                    >
                      Adicionar
                    </button>
                  </div>
                  {editBomLines.length === 0 ? (
                    <p className="py-6 text-center text-xs text-zinc-600 italic">Nenhum ingrediente na ficha técnica</p>
                  ) : (
                    <div className="overflow-hidden rounded border border-zinc-800">
                      <table className="w-full border-collapse text-left text-xs [&_th]:border [&_td]:border [&_th]:border-zinc-800/55 [&_td]:border-zinc-800/55">
                        <thead className="bg-[#141414]">
                          <tr className="border-b border-[#0001fb]/70">
                            <th className="px-3 py-2 text-xs font-bold text-zinc-300">Ingrediente</th>
                            <th className="px-3 py-2 text-xs font-bold text-zinc-300">Qtd</th>
                            <th className="px-3 py-2 text-xs font-bold text-zinc-300">Un.</th>
                            <th className="px-3 py-2" />
                          </tr>
                        </thead>
                        <tbody>
                          {editBomLines.map((line) => (
                            <tr key={line.component_product_id} className="border-t border-zinc-800/70">
                              <td className="px-3 py-2 text-zinc-200">{line.component_name}</td>
                              <td className="px-3 py-2 text-zinc-300">{line.quantity}</td>
                              <td className="px-3 py-2 text-zinc-500">{line.component_unit || 'un'}</td>
                              <td className="px-3 py-2 text-right">
                                <button
                                  type="button"
                                  className="text-rose-400 hover:text-rose-300"
                                  onClick={() =>
                                    setEditBomLines((prev) =>
                                      prev.filter((item) => item.component_product_id !== line.component_product_id)
                                    )
                                  }
                                >
                                  Remover
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {activeTab === 'estoque' && (
                <div className="space-y-4">
                  <div className="space-y-1">
                    <label className="text-xs text-zinc-400">Quantidade em stock</label>
                    <input 
                      type="number" 
                      step="0.01"
                      value={editingProduct.stock_quantity ?? 0}
                      onChange={(e) => setEditingProduct({...editingProduct, stock_quantity: Number(e.target.value)})}
                      className="w-full bg-[#1a1a1a] border border-zinc-800 rounded px-3 py-1.5 text-sm text-white focus:border-blue-500 outline-none transition-colors"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-zinc-400">Stock mínimo</label>
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
                className="flex items-center gap-2 px-6 py-2 rounded bg-[#0001fb] text-xs font-medium text-white transition-colors hover:bg-[#1a1bff]"
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
                className="flex items-center gap-2 px-6 py-2 rounded border border-zinc-700 bg-transparent text-xs font-medium text-zinc-300 transition-colors hover:border-[#0001fb] hover:bg-[var(--pos-brand-hover-bg)] hover:text-white"
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

      {/* Delete Category Confirmation Modal */}
      {isDeleteCategoryConfirmOpen && selectedCategoryData && (
        <div
          className="fixed inset-0 z-[111] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
          onClick={() => setIsDeleteCategoryConfirmOpen(false)}
        >
          <div
            className="bg-[#1a1a1a] border border-zinc-800 rounded-lg w-full max-w-sm overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-6 text-center space-y-4">
              <div className="w-12 h-12 bg-red-500/10 rounded-full flex items-center justify-center mx-auto text-red-500">
                <Trash2 size={24} />
              </div>
              <div>
                <h3 className="text-lg font-bold text-white">Confirmar Exclusão</h3>
                <p className="text-xs text-zinc-400 mt-1">
                  Tem certeza que deseja excluir o grupo <span className="text-zinc-200">"{selectedCategoryData.name}"</span>?
                </p>
              </div>
              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => setIsDeleteCategoryConfirmOpen(false)}
                  className="flex-1 px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-white text-xs font-bold rounded transition-colors"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleDeleteCategory}
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
              toast.type === 'success' ? 'bg-emerald-500/10 border-[#0001fb]/50 text-emerald-500' : 'bg-red-500/10 border-red-500/50 text-red-500'
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

function BarcodeChipField({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const [focused, setFocused] = React.useState(false);
  const trimmed = String(value ?? '').trim();
  const showChip = trimmed.length > 0 && !focused;

  if (showChip) {
    return (
      <div className="flex min-h-[34px] w-full items-center rounded border border-zinc-800 bg-[#1a1a1a] px-2 py-1.5">
        <span className="inline-flex max-w-full items-center gap-1.5 rounded bg-[#0001fb] px-2 py-0.5 text-sm font-medium text-white">
          <span className="truncate font-mono tracking-wide text-white">{trimmed}</span>
          <button
            type="button"
            title="Apagar código de barras"
            onClick={() => onChange('')}
            className="shrink-0 rounded p-0.5 leading-none text-white transition-colors hover:bg-white/20"
          >
            <X size={12} strokeWidth={2.5} />
          </button>
        </span>
      </div>
    );
  }

  return (
    <input
      type="text"
      value={value ?? ''}
      placeholder="Digite ou gere um código"
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded border border-zinc-800 bg-[#1a1a1a] px-3 py-1.5 text-sm text-white outline-none transition-colors placeholder:text-zinc-600 focus:border-blue-500"
    />
  );
}

function ResizableHeader({ width, label, onResize, align = 'left' }: { width: number, label: string, onResize: (e: React.MouseEvent) => void, align?: 'left' | 'right' | 'center' }) {
  return (
    <th 
      className={`px-3 py-2 text-xs font-bold text-zinc-300 whitespace-nowrap relative group select-none ${
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
