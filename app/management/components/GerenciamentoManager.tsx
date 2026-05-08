'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Check, ChevronDown, ChevronRight, ChevronsUpDown, Edit3, FileText, PackagePlus, PackageSearch, Printer, Search, Trash2, X } from 'lucide-react';
import { getPosApiBase } from '@/lib/apiBase';
import { unwrapApiSuccessPayload } from '@/lib/apiResponse';

const DOCUMENT_CARDS = [
  'Entrada de stock',
  'Fatura proforma',
  'Adiantamento',
  'Fatura-recibo',
  'Fatura',
  'Recibo',
  'Venda a dinheiro',
  'Nota de crédito',
  'Nota de debito',
  'Despesa operacional',
  'Regularização de stock',
  'Perdas',
  'Guia de remessa',
  'Guia de transporte',
];

type DocumentModalData = {
  title: string;
};

type ProductRow = {
  id: number | string;
  code?: number | string | null;
  name?: string | null;
  stock_quantity?: number | null;
  unit?: string | null;
  cost?: number | null;
  price?: number | null;
  barcode?: string | null;
  category_name?: string | null;
  category?: string | null;
  category_id?: string | number | null;
  group_name?: string | null;
  group?: string | null;
};

type DocumentItemRow = {
  rowId: string;
  productId: string;
  code: string;
  name: string;
  unit: string;
  quantity: number;
  unitPrice: number;
  tax: number;
  taxCode: string;
  taxRate: number;
  taxUiEnabled: boolean;
  discountType: 'percent' | 'fixed';
  discountValue: number;
  expirationDate: string;
};

type PartyRow = {
  id: number | string;
  name?: string | null;
};

type SessionUser = {
  id: number | string;
  name?: string | null;
  surname?: string | null;
};

type EditDocumentDraft = {
  source?: 'order' | 'sale';
  sourceId?: string;
  returnTabId?: string;
  title?: string;
  documentNumber?: string;
  documentDate?: string;
  dueDate?: string;
  paid?: boolean;
  customerId?: string;
  items?: Array<Partial<DocumentItemRow>>;
};

const DOCUMENT_PREFIX_BY_TITLE: Record<string, string> = {
  'Entrada de stock': 'WH/IN',
  'Fatura proforma': 'FP',
  Adiantamento: 'AD',
  'Fatura-recibo': 'FR',
  Fatura: 'FT',
  Recibo: 'RC',
  'Venda a dinheiro': 'VD',
  'Nota de crédito': 'NC',
  'Nota de debito': 'ND',
  'Despesa operacional': 'DO',
  'Regularização de stock': 'WH/ADJ',
  Perdas: 'WH/LOSS',
  'Guia de remessa': 'GR',
  'Guia de transporte': 'GT',
};
const EDIT_DRAFT_STORAGE_KEY = 'management:edit-document-draft';
const getDocumentNumberPadSize = (prefix: string) => (String(prefix).trim().toUpperCase() === 'FP' ? 4 : 5);

export default function GerenciamentoManager() {
  const [search, setSearch] = useState('');
  const [openModal, setOpenModal] = useState<DocumentModalData | null>(null);
  const [isProductPickerOpen, setIsProductPickerOpen] = useState(false);
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [productsLoading, setProductsLoading] = useState(false);
  const [productSearch, setProductSearch] = useState('');
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
  const [documentItems, setDocumentItems] = useState<DocumentItemRow[]>([]);
  const [selectedItemRowId, setSelectedItemRowId] = useState<string | null>(null);
  const [pendingItem, setPendingItem] = useState<DocumentItemRow | null>(null);
  const [isItemEditorOpen, setIsItemEditorOpen] = useState(false);
  const [isDeleteItemConfirmOpen, setIsDeleteItemConfirmOpen] = useState(false);
  const [draggedProduct, setDraggedProduct] = useState<ProductRow | null>(null);
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const [expandedGroupsBeforeSearch, setExpandedGroupsBeforeSearch] = useState<Record<string, boolean> | null>(null);
  const [parties, setParties] = useState<PartyRow[]>([]);
  const [selectedPartyId, setSelectedPartyId] = useState('');
  const [currentUser, setCurrentUser] = useState<SessionUser | null>(null);
  const [documentNumber, setDocumentNumber] = useState('');
  const [documentDate, setDocumentDate] = useState(new Date().toISOString().slice(0, 10));
  const [dueDate, setDueDate] = useState(new Date().toISOString().slice(0, 10));
  const [isPaid, setIsPaid] = useState(false);
  const [documentExternal, setDocumentExternal] = useState('');
  const [isSavingDocument, setIsSavingDocument] = useState(false);
  const [editingSourceId, setEditingSourceId] = useState<string | null>(null);
  const [editingSourceType, setEditingSourceType] = useState<'order' | 'sale' | null>(null);
  const [returnTabIdAfterClose, setReturnTabIdAfterClose] = useState<string | null>(null);

  const navigateBackToReturnTab = React.useCallback((tabId: string | null) => {
    if (!tabId || typeof window === 'undefined') return;
    window.dispatchEvent(
      new CustomEvent('management:navigate-tab', {
        detail: { tabId },
      })
    );
  }, []);

  const closeDocumentScreen = React.useCallback(() => {
    setOpenModal(null);
    setProductSearch('');
    setSelectedProductId(null);
    setSelectedItemRowId(null);
    setPendingItem(null);
    setIsItemEditorOpen(false);
    setIsDeleteItemConfirmOpen(false);
    setDraggedProduct(null);
    setDocumentItems([]);
    setExpandedGroups({});
    setExpandedGroupsBeforeSearch(null);
    setEditingSourceId(null);
    setEditingSourceType(null);
    setReturnTabIdAfterClose(null);
  }, []);

  const closeDocumentScreenAndReturn = React.useCallback(() => {
    const targetTabId = returnTabIdAfterClose;
    closeDocumentScreen();
    navigateBackToReturnTab(targetTabId);
  }, [closeDocumentScreen, navigateBackToReturnTab, returnTabIdAfterClose]);

  useEffect(() => {
    if (!openModal) return undefined;
    const onEsc = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeDocumentScreenAndReturn();
    };
    window.addEventListener('keydown', onEsc);
    return () => window.removeEventListener('keydown', onEsc);
  }, [closeDocumentScreenAndReturn, openModal]);

  useEffect(() => {
    if (!openModal) return;
    void fetchProducts();
    void fetchParties();
  }, [openModal]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const raw = localStorage.getItem('currentUser') || localStorage.getItem('user');
    if (!raw) {
      setCurrentUser(null);
      return;
    }
    try {
      const parsed = JSON.parse(raw) as SessionUser;
      setCurrentUser(parsed);
    } catch {
      setCurrentUser(null);
    }
  }, []);

  useEffect(() => {
    if (!openModal) return;
    if (editingSourceId) return;
    void syncNextDocumentNumber(openModal.title, documentDate);
  }, [documentDate, openModal, editingSourceId]);

  const beginNewDocument = React.useCallback((title: string) => {
    setEditingSourceId(null);
    setEditingSourceType(null);
    setReturnTabIdAfterClose(null);
    setDocumentItems([]);
    setSelectedItemRowId(null);
    setPendingItem(null);
    setIsItemEditorOpen(false);
    setIsDeleteItemConfirmOpen(false);
    setDocumentExternal('');
    const now = new Date().toISOString().slice(0, 10);
    setDocumentDate(now);
    setDueDate(now);
    setIsPaid(false);
    setOpenModal({ title });
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onOpenNew = (event: Event) => {
      const custom = event as CustomEvent<{ title?: string }>;
      const title = String(custom.detail?.title ?? '').trim();
      if (!title || !DOCUMENT_CARDS.includes(title)) return;
      beginNewDocument(title);
    };
    window.addEventListener('management:open-new-document', onOpenNew as EventListener);
    return () => window.removeEventListener('management:open-new-document', onOpenNew as EventListener);
  }, [beginNewDocument]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const raw = window.localStorage.getItem(EDIT_DRAFT_STORAGE_KEY);
    if (!raw) return;
    try {
      const draft = JSON.parse(raw) as EditDocumentDraft;
      const title = String(draft?.title ?? '').trim();
      if (!title) return;
      const nowDate = new Date().toISOString().slice(0, 10);
      const preparedItems = Array.isArray(draft.items)
        ? draft.items.map((item, index) => {
            const discountType: DocumentItemRow['discountType'] =
              item.discountType === 'fixed' ? 'fixed' : 'percent';
            return {
              rowId: String(item.rowId ?? `edit-${Date.now()}-${index}`),
              productId: String(item.productId ?? ''),
              code: String(item.code ?? index + 1),
              name: String(item.name ?? '-'),
              unit: String(item.unit ?? 'UN'),
              quantity: Number(item.quantity ?? 0) || 0,
              unitPrice: Number(item.unitPrice ?? 0) || 0,
              tax: Number(item.tax ?? 0) || 0,
              taxCode: String(item.taxCode ?? 'IVA'),
              taxRate: Number(item.taxRate ?? 0) || 0,
              taxUiEnabled: Boolean(item.taxUiEnabled ?? false),
              discountType,
              discountValue: Number(item.discountValue ?? 0) || 0,
              expirationDate: String(item.expirationDate ?? ''),
            };
          })
        : [];

      setOpenModal({ title });
      setDocumentNumber(String(draft.documentNumber ?? ''));
      setDocumentDate(String(draft.documentDate ?? nowDate));
      setDueDate(String(draft.dueDate ?? draft.documentDate ?? nowDate));
      setIsPaid(Boolean(draft.paid));
      setSelectedPartyId(String(draft.customerId ?? ''));
      setDocumentExternal('');
      setDocumentItems(preparedItems);
      setSelectedItemRowId(preparedItems[0]?.rowId ?? null);
      setEditingSourceId(String(draft.sourceId ?? ''));
      setEditingSourceType(draft.source === 'sale' ? 'sale' : 'order');
      const returnTabId = String(draft.returnTabId ?? '').trim();
      setReturnTabIdAfterClose(returnTabId || null);
    } catch {
      // Ignora rascunhos inválidos.
    } finally {
      window.localStorage.removeItem(EDIT_DRAFT_STORAGE_KEY);
    }
  }, []);

  const filteredCards = DOCUMENT_CARDS.filter((card) =>
    card.toLowerCase().includes(search.toLowerCase())
  );
  const filteredProducts = products.filter((product) => {
    const q = productSearch.toLowerCase();
    const code = String(product.code ?? '').toLowerCase();
    const name = String(product.name ?? '').toLowerCase();
    const barcode = String(product.barcode ?? '').toLowerCase();
    return !q || code.includes(q) || name.includes(q) || barcode.includes(q);
  });

  const fetchProducts = async () => {
    setProductsLoading(true);
    try {
      const res = await fetch(`${getPosApiBase()}/produtos`);
      if (!res.ok) throw new Error(`Falha ao carregar produtos (${res.status})`);
      const data = (unwrapApiSuccessPayload<ProductRow[]>(await res.json()) ?? []) as ProductRow[];
      setProducts(data);
    } catch {
      setProducts([]);
    } finally {
      setProductsLoading(false);
    }
  };

  const fetchParties = async () => {
    try {
      const clientsRes = await fetch(`${getPosApiBase()}/clientes`);
      if (!clientsRes.ok) throw new Error('Falha ao carregar clientes/fornecedores');
      const clients = (unwrapApiSuccessPayload<PartyRow[]>(await clientsRes.json()) ?? []) as PartyRow[];
      setParties(clients);
      if (!selectedPartyId && clients[0]?.id != null) setSelectedPartyId(String(clients[0].id));
    } catch {
      setParties([]);
    }
  };

  const syncNextDocumentNumber = async (title: string, dateValue: string) => {
    const prefix = DOCUMENT_PREFIX_BY_TITLE[title] ?? 'DOC/GEN';
    const year = new Date(`${dateValue}T00:00:00`).getFullYear();
    const padSize = getDocumentNumberPadSize(prefix);
    const fallbackNumber = `${prefix}/${year}/${String(1).padStart(padSize, '0')}`;
    // Mostra um número imediatamente para não deixar o campo vazio.
    setDocumentNumber(fallbackNumber);

    try {
      const res = await fetch(
        `${getPosApiBase()}/documentos/next-number?prefix=${encodeURIComponent(prefix)}&year=${year}`
      );
      if (!res.ok) throw new Error('Falha ao obter próximo número');
      const data = unwrapApiSuccessPayload<any>(await res.json());
      setDocumentNumber(String(data?.documentNumber ?? ''));
    } catch {
      try {
        // Fallback local: calcula próxima sequência a partir da listagem atual de documentos.
        const docsRes = await fetch(`${getPosApiBase()}/documentos`);
        if (!docsRes.ok) return;
        const docs = (unwrapApiSuccessPayload<Array<{ document_number?: string | null }>>(await docsRes.json()) ?? []);
        const prefixWithYear = `${prefix}/${year}/`;
        let maxSeq = 0;
        for (const doc of docs) {
          const number = String(doc?.document_number ?? '').trim();
          if (!number.startsWith(prefixWithYear)) continue;
          const sequenceRaw = number.slice(prefixWithYear.length);
          const sequence = Number(sequenceRaw);
          if (Number.isFinite(sequence) && sequence > maxSeq) maxSeq = sequence;
        }
        const next = maxSeq + 1;
        setDocumentNumber(`${prefix}/${year}/${String(next).padStart(padSize, '0')}`);
      } catch {
        // Mantém fallback inicial.
      }
    }
  };

  const productGroups = useMemo(() => {
    const grouped = new Map<string, ProductRow[]>();
    for (const product of products) {
      const rawGroup =
        product.category_name ??
        product.category ??
        product.group_name ??
        product.group ??
        null;

      const groupName = String(rawGroup || 'SEM GRUPO').trim().toUpperCase();
      if (!grouped.has(groupName)) grouped.set(groupName, []);
      grouped.get(groupName)?.push(product);
    }

    return Array.from(grouped.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([group, items]) => ({
        group,
        items: items.sort((a, b) => String(a.name ?? '').localeCompare(String(b.name ?? ''))),
      }));
  }, [products]);

  const filteredProductGroups = useMemo(() => {
    const query = productSearch.trim().toLowerCase();
    if (!query) return productGroups;

    return productGroups
      .map((group) => {
        const groupMatches = group.group.toLowerCase().includes(query);
        const items = groupMatches
          ? group.items
          : group.items.filter((item) => String(item.name ?? '').toLowerCase().includes(query));
        return { ...group, items };
      })
      .filter((group) => group.items.length > 0);
  }, [productGroups, productSearch]);

  useEffect(() => {
    const query = productSearch.trim();
    if (!query || expandedGroupsBeforeSearch) return;
    setExpandedGroupsBeforeSearch(expandedGroups);
  }, [expandedGroups, expandedGroupsBeforeSearch, productSearch]);

  useEffect(() => {
    const query = productSearch.trim();
    if (!query) return;
    setExpandedGroups((prev) => {
      const next = { ...prev };
      for (const group of filteredProductGroups) {
        next[group.group] = true;
      }
      return next;
    });
  }, [filteredProductGroups, productSearch]);

  useEffect(() => {
    const query = productSearch.trim();
    if (query || !expandedGroupsBeforeSearch) return;
    setExpandedGroups((prev) => ({ ...prev, ...expandedGroupsBeforeSearch }));
    setExpandedGroupsBeforeSearch(null);
  }, [expandedGroupsBeforeSearch, productSearch]);

  useEffect(() => {
    if (productGroups.length === 0) return;
    setExpandedGroups((prev) => {
      const next = { ...prev };
      for (const group of productGroups) {
        if (!(group.group in next)) next[group.group] = false;
      }
      return next;
    });
  }, [productGroups]);

  const createDocumentItemFromProduct = (product: ProductRow): DocumentItemRow => {
    const isWarehouseEntry = openModal?.title === 'Entrada de stock';
    const parsedPrice = Number(
      isWarehouseEntry
        ? product.cost ?? product.price ?? (product as any).selling_price ?? 0
        : product.price ?? (product as any).selling_price ?? product.cost ?? 0
    );
    const parsedQty = Number((product as any).quantity ?? 0);
    const safePrice = Number.isFinite(parsedPrice) ? parsedPrice : 0;
    const safeQty = Number.isFinite(parsedQty) ? parsedQty : 0;
    const code = String(product.code ?? product.barcode ?? '?');
    return {
      rowId: `${String(product.id)}-${Date.now()}-${Math.random().toString(16).slice(2, 7)}`,
      productId: String(product.id),
      code,
      name: String(product.name ?? '-'),
      unit: String(product.unit ?? 'UN').toUpperCase(),
      quantity: safeQty,
      unitPrice: safePrice,
      tax: 0,
      taxCode: 'IVA',
      taxRate: 16,
      taxUiEnabled: false,
      discountType: 'percent',
      discountValue: 0,
      expirationDate: '',
    };
  };

  const addOrMergeDocumentItem = (item: DocumentItemRow) => {
    let selectedRowId = item.rowId;
    setDocumentItems((prev) => {
      const existing = prev.find((row) => row.productId === item.productId);
      if (existing) {
        selectedRowId = existing.rowId;
        return prev.map((row) =>
          row.rowId === existing.rowId ? { ...row, quantity: row.quantity + item.quantity } : row
        );
      }
      return [...prev, item];
    });
    setSelectedItemRowId(selectedRowId);
  };

  const addProductToDocument = (product: ProductRow, openEditor = false) => {
    const newItem = createDocumentItemFromProduct(product);
    addOrMergeDocumentItem(newItem);
    setPendingItem(null);
    setIsItemEditorOpen(openEditor);
  };

  const openPendingEditorForProduct = (product: ProductRow) => {
    setPendingItem(createDocumentItemFromProduct(product));
    setIsItemEditorOpen(true);
  };

  const openEditorForExistingItem = (rowId: string) => {
    const target = documentItems.find((item) => item.rowId === rowId);
    if (!target) return;
    setSelectedItemRowId(rowId);
    // Edita em cópia temporária; só aplica no OK.
    setPendingItem({ ...target });
    setIsItemEditorOpen(true);
  };

  const totalBeforeTax = useMemo(
    () => documentItems.reduce((acc, item) => acc + item.quantity * item.unitPrice, 0),
    [documentItems]
  );
  const selectedItem = useMemo(
    () => documentItems.find((item) => item.rowId === selectedItemRowId) ?? null,
    [documentItems, selectedItemRowId]
  );
  const editorItem = pendingItem ?? selectedItem;
  const editorProductStock = useMemo(() => {
    if (!editorItem) return null;
    const product = products.find((p) => String(p.id) === String(editorItem.productId));
    if (!product) return null;
    const qty = Number(product.stock_quantity ?? 0);
    return Number.isFinite(qty) ? qty : 0;
  }, [editorItem, products]);

  const updateSelectedItem = (patch: Partial<DocumentItemRow>) => {
    setPendingItem((prev) => (prev ? { ...prev, ...patch } : prev));
  };

  const selectedItemSubtotal = editorItem ? editorItem.quantity * editorItem.unitPrice : 0;
  const selectedItemTotalWithTax = editorItem ? selectedItemSubtotal + editorItem.tax : 0;
  const selectedItemDiscountAmount = editorItem
    ? editorItem.discountType === 'percent'
      ? (selectedItemTotalWithTax * editorItem.discountValue) / 100
      : editorItem.discountValue
    : 0;
  const selectedItemFinalTotal = Math.max(0, selectedItemTotalWithTax - selectedItemDiscountAmount);

  const deleteSelectedItem = () => {
    if (!selectedItemRowId) return;
    setDocumentItems((prev) => prev.filter((item) => item.rowId !== selectedItemRowId));
    setSelectedItemRowId(null);
    setPendingItem(null);
    setIsItemEditorOpen(false);
    setIsDeleteItemConfirmOpen(false);
  };

  const handleEditorOk = () => {
    if (pendingItem) {
      const alreadyExists = documentItems.some((item) => item.rowId === pendingItem.rowId);
      if (alreadyExists) {
        setDocumentItems((prev) =>
          prev.map((item) => (item.rowId === pendingItem.rowId ? { ...pendingItem } : item))
        );
        setSelectedItemRowId(pendingItem.rowId);
      } else {
        addOrMergeDocumentItem(pendingItem);
      }
      setPendingItem(null);
    }
    setIsItemEditorOpen(false);
  };

  const handleEditorCancel = () => {
    setPendingItem(null);
    setIsItemEditorOpen(false);
  };

  const selectedParty = parties.find((p) => String(p.id) === selectedPartyId) ?? null;
  const currentUserDisplayName =
    `${String(currentUser?.name ?? '').trim()} ${String(currentUser?.surname ?? '').trim()}`.trim() ||
    String(currentUser?.name ?? '-');

  const saveDocument = async (closeAfterSave = false) => {
    if (!openModal || isSavingDocument) return;
    setIsSavingDocument(true);
    try {
      if (editingSourceId && editingSourceType) {
        const endpoint =
          editingSourceType === 'sale'
            ? `${getPosApiBase()}/vendas/${encodeURIComponent(editingSourceId)}/payment-status`
            : `${getPosApiBase()}/documentos/${encodeURIComponent(editingSourceId)}/payment-status`;
        const statusRes = await fetch(endpoint, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ paid: isPaid }),
        });
        if (!statusRes.ok) throw new Error(`Falha ao atualizar pagamento (${statusRes.status})`);
        if (closeAfterSave) {
          closeDocumentScreenAndReturn();
        }
        return;
      }

      const payload = {
        documentType: openModal.title,
        prefix: DOCUMENT_PREFIX_BY_TITLE[openModal.title] ?? 'DOC/GEN',
        documentDate: `${documentDate}T00:00:00.000Z`,
        dueDate: `${dueDate}T00:00:00.000Z`,
        paid: isPaid,
        externalDocument: documentExternal.trim() || null,
        customerId: selectedPartyId || null,
        customerName: selectedParty?.name ?? null,
        userId: currentUser?.id != null ? String(currentUser.id) : null,
        userName: currentUserDisplayName,
        total: totalBeforeTax,
        discount: 0,
        paymentMethod: null,
        items: documentItems.map((item) => ({
          productId: item.productId,
          name: item.name,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          discountAmount: item.discountType === 'fixed' ? item.discountValue : 0,
        })),
      };

      const res = await fetch(`${getPosApiBase()}/documentos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`Falha ao salvar documento (${res.status})`);

      await fetchProducts();
      await syncNextDocumentNumber(openModal.title, documentDate);
      if (closeAfterSave) {
        closeDocumentScreenAndReturn();
      } else {
        setDocumentItems([]);
      }
    } finally {
      setIsSavingDocument(false);
    }
  };

  return (
    <div className="flex h-full flex-col bg-[#1a1a1a] text-zinc-200">
      {!openModal ? (
        <>
          <div className="h-14 px-4 flex items-center bg-[#1a1a1a] border-b border-zinc-800">
            <div className="flex items-center gap-3 px-3 text-zinc-500 border-r border-zinc-800">
              <Search size={18} />
            </div>
            <div className="flex-1 relative">
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Procurar documento"
                className="w-full bg-transparent py-2 px-2 outline-none text-sm text-zinc-200 placeholder:text-zinc-600"
              />
            </div>
          </div>

          <div className="custom-scrollbar flex-1 overflow-y-auto p-4">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3 xl:grid-cols-7">
              {filteredCards.map((card) => (
                <button
                  key={card}
                  type="button"
                  onClick={() => beginNewDocument(card)}
                  className="min-h-[68px] rounded-md border border-zinc-700/80 bg-[#17191c] px-4 py-3 text-center text-sm font-medium leading-tight text-zinc-200 transition-colors hover:border-zinc-500"
                >
                  {card}
                </button>
              ))}
            </div>
          </div>
        </>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="border-b border-zinc-800/70 bg-[#111214] px-2 pt-1">
            <div className="inline-flex items-center gap-2 rounded-t border border-b-0 border-zinc-700 bg-[#1b1d20] px-3 py-1 text-xs text-zinc-200">
              <span>{openModal.title}</span>
              <button type="button" onClick={closeDocumentScreenAndReturn} className="text-zinc-200 hover:text-white">
                <X size={12} />
              </button>
            </div>
          </div>

          <div className="relative flex min-h-0 flex-1 overflow-hidden bg-[#1a1a1a]">
            <div className="custom-scrollbar flex flex-1 flex-col overflow-y-auto p-3">
              <div className="mb-2 rounded border border-zinc-800 bg-[#181818] px-3 py-2">
                <div className="grid grid-cols-1 gap-5 md:grid-cols-4">
                  <div className="space-y-2 text-xs">
                    <div className="grid grid-cols-[130px_1fr] items-center gap-2">
                      <label className="text-zinc-400">Numero</label>
                      <input
                        value={documentNumber}
                        readOnly
                        className="h-8 w-full rounded border border-zinc-700 bg-[#121212] px-2 text-zinc-100 focus:outline-none"
                      />
                    </div>
                    <div className="grid grid-cols-[130px_1fr] items-center gap-2">
                      <label className="text-zinc-400">Documento externo</label>
                      <input
                        value={documentExternal}
                        onChange={(e) => setDocumentExternal(e.target.value)}
                        className="h-8 w-full rounded border border-zinc-700 bg-[#121212] px-2 text-zinc-100 focus:outline-none"
                      />
                    </div>
                    <div className="grid grid-cols-[130px_1fr] items-center gap-2">
                      <label className="text-zinc-400">Cliente/Fornecedor</label>
                      <select
                        value={selectedPartyId}
                        onChange={(e) => setSelectedPartyId(e.target.value)}
                        className="h-8 w-full rounded border border-zinc-700 bg-[#121212] px-2 text-zinc-100 focus:outline-none"
                      >
                        {parties.map((party) => (
                          <option key={String(party.id)} value={String(party.id)}>
                            {String(party.name ?? '-')}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="space-y-2 text-xs">
                    <div className="grid grid-cols-[130px_1fr_auto] items-center gap-2">
                      <label className="text-zinc-400">Data</label>
                      <input
                        type="date"
                        value={documentDate}
                        onChange={(e) => setDocumentDate(e.target.value)}
                        className="h-8 w-full rounded border border-zinc-700 bg-[#121212] px-2 text-zinc-100 focus:outline-none"
                      />
                      <label className="inline-flex cursor-pointer items-center gap-2 text-zinc-200">
                        <span>Pago</span>
                        <input
                          type="checkbox"
                          checked={isPaid}
                          onChange={(e) => setIsPaid(e.target.checked)}
                          className="peer sr-only"
                        />
                        <span className="relative h-5 w-9 rounded-full bg-zinc-700 transition-colors duration-200 peer-checked:bg-blue-600 after:absolute after:left-[2px] after:top-[2px] after:h-4 after:w-4 after:rounded-full after:bg-white after:transition-transform after:duration-200 after:ease-in-out peer-checked:after:translate-x-[16px]" />
                      </label>
                    </div>
                    <div className="grid grid-cols-[130px_1fr] items-center gap-2">
                      <label className="text-zinc-400">Data de vencimento</label>
                      <input
                        type="date"
                        value={dueDate}
                        onChange={(e) => setDueDate(e.target.value)}
                        className="h-8 w-full rounded border border-zinc-700 bg-[#121212] px-2 text-zinc-100 focus:outline-none"
                      />
                    </div>
                    <div className="grid grid-cols-[130px_1fr] items-center gap-2">
                      <label className="text-zinc-400">Data de armazenamento</label>
                      <div className="flex h-8 w-full items-center justify-between rounded border border-zinc-700 bg-[#121212] px-2 text-zinc-300">
                        <span>09/04/2026 16:07</span>
                        <ChevronsUpDown size={12} className="text-zinc-500" />
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="mb-2 flex items-center gap-2 border-b border-zinc-800">
                <button className="rounded-t border border-b-0 border-zinc-600 bg-[#22262b] px-3 py-1 text-xs text-zinc-100">
                  Itens do documento
                </button>
                <button className="rounded-t border border-b-0 border-zinc-700 bg-[#171a1e] px-3 py-1 text-xs text-zinc-400">
                  Pagamentos
                </button>
              </div>

              <div className="grid min-h-0 flex-1 grid-cols-[190px_1fr] gap-2 overflow-hidden">
                <aside className="rounded border border-zinc-700 bg-[#141414] p-2 text-xs">
                  <div className="mb-2 flex h-8 items-center gap-2 rounded border border-zinc-700 bg-[#121212] px-2">
                    <Search size={13} className="text-zinc-500" />
                    <input
                      value={productSearch}
                      onChange={(e) => setProductSearch(e.target.value)}
                      placeholder="Nome do produto"
                      className="w-full bg-transparent text-xs text-zinc-200 placeholder:text-zinc-500 focus:outline-none"
                    />
                  </div>
                  <div className="space-y-1">
                    {productsLoading ? (
                      <div className="px-1 py-2 text-zinc-500">A carregar produtos...</div>
                    ) : (
                      filteredProductGroups.map((node) => (
                      <div key={node.group} className="border-l border-zinc-700 pl-1">
                        <button
                          type="button"
                          onClick={() =>
                            setExpandedGroups((prev) => ({
                              ...prev,
                              [node.group]: !prev[node.group],
                            }))
                          }
                          className="mb-1 flex w-full items-center gap-1 text-left text-zinc-300 hover:text-white"
                        >
                          {expandedGroups[node.group] ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                          <span className="font-medium">{node.group}</span>
                        </button>
                        <div className={`${expandedGroups[node.group] ? 'block' : 'hidden'} space-y-1 pl-4`}>
                          {node.items.map((item) => (
                            <button
                              key={String(item.id)}
                              className="block w-full px-1 py-0.5 text-left text-zinc-200 hover:text-white"
                              type="button"
                              onDoubleClick={() => openPendingEditorForProduct(item)}
                              draggable
                              onDragStart={(e) => {
                                setDraggedProduct(item);
                                e.dataTransfer.effectAllowed = 'copy';
                                e.dataTransfer.setData('text/plain', String(item.id));
                              }}
                              onDragEnd={() => setDraggedProduct(null)}
                            >
                              {String(item.name ?? '-')}
                            </button>
                          ))}
                        </div>
                      </div>
                      ))
                    )}
                  </div>
                </aside>

                <div
                  className="flex min-h-0 flex-col rounded border border-zinc-700 bg-[#141414]"
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (draggedProduct) openPendingEditorForProduct(draggedProduct);
                    setDraggedProduct(null);
                  }}
                >
                  <div className="min-h-0 flex-1 overflow-auto">
                    <div className="min-w-[980px]">
                      <div className="flex items-center gap-2 border-b border-zinc-700 px-2 py-1.5">
                        <button
                          type="button"
                          onClick={() => {
                            if (selectedItemRowId) {
                              openEditorForExistingItem(selectedItemRowId);
                              return;
                            }
                            if (documentItems.length > 0) {
                              openEditorForExistingItem(documentItems[0].rowId);
                            }
                          }}
                          disabled={!selectedItemRowId && documentItems.length === 0}
                          className="inline-flex h-8 items-center gap-1 rounded border border-zinc-700 bg-[#1f1f1f] px-3 text-xs text-zinc-200 hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          <Edit3 size={13} />
                          Editar
                        </button>
                        <button
                          type="button"
                          onClick={() => setIsDeleteItemConfirmOpen(true)}
                          disabled={!selectedItemRowId}
                          className="inline-flex h-8 items-center gap-1 rounded border border-zinc-700 bg-[#1f1f1f] px-3 text-xs text-zinc-200 hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          <Trash2 size={13} />
                          Deletar
                        </button>
                      </div>
                      <div className="grid grid-cols-11 border-b border-zinc-700 text-[11px] text-zinc-400">
                        <span className="col-span-1 border-r border-zinc-700 px-2 py-1">ID</span>
                        <span className="col-span-2 border-r border-zinc-700 px-2 py-1">Nome</span>
                        <span className="col-span-2 border-r border-zinc-700 px-2 py-1">Unidade de medida</span>
                        <span className="col-span-1 border-r border-zinc-700 px-2 py-1">Quantidade</span>
                        <span className="col-span-2 border-r border-zinc-700 px-2 py-1">Preço antes dos impostos</span>
                        <span className="col-span-1 border-r border-zinc-700 px-2 py-1">Impostos</span>
                        <span className="col-span-1 border-r border-zinc-700 px-2 py-1">Preço</span>
                        <span className="col-span-1 px-2 py-1 text-right">Total</span>
                      </div>
                      {documentItems.length === 0 ? (
                        <div className="px-2 py-3 text-xs text-zinc-500">Clique num produto para adicionar na tabela.</div>
                      ) : (
                        documentItems.map((item, idx) => (
                          <button
                            key={item.rowId}
                            type="button"
                            onClick={() => {
                              setSelectedItemRowId(item.rowId);
                              setIsItemEditorOpen(false);
                            }}
                            onDoubleClick={() => {
                              openEditorForExistingItem(item.rowId);
                            }}
                            className={`grid w-full grid-cols-11 border-b border-zinc-800 text-xs text-left ${
                              selectedItemRowId === item.rowId ? 'bg-zinc-800/70' : 'hover:bg-zinc-800/40'
                            }`}
                          >
                            {(() => {
                              const itemSubtotal = item.quantity * item.unitPrice;
                              const itemTotalWithTax = itemSubtotal + item.tax;
                              const itemDiscountAmount =
                                item.discountType === 'percent'
                                  ? (itemTotalWithTax * item.discountValue) / 100
                                  : item.discountValue;
                              const itemFinalTotal = Math.max(0, itemTotalWithTax - itemDiscountAmount);
                              return (
                                <>
                            <span className="col-span-1 border-r border-zinc-800 px-2 py-2 text-zinc-300">{idx + 1}</span>
                            <span className="col-span-2 border-r border-zinc-800 px-2 py-2 text-zinc-200">{item.name}</span>
                            <span className="col-span-2 border-r border-zinc-800 px-2 py-2 text-zinc-200">
                              {item.unit}
                            </span>
                            <span className="col-span-1 border-r border-zinc-800 px-2 py-2 text-zinc-200">{item.quantity.toFixed(4)}</span>
                            <span className="col-span-2 border-r border-zinc-800 px-2 py-2 text-zinc-200">{item.unitPrice.toFixed(2)}</span>
                            <span className="col-span-1 border-r border-zinc-800 px-2 py-2 text-zinc-200">{item.tax.toFixed(2)}</span>
                            <span className="col-span-1 border-r border-zinc-800 px-2 py-2 text-zinc-200">{item.unitPrice.toFixed(2)}</span>
                            <span className="col-span-1 px-2 py-2 text-right text-zinc-100">
                              {itemFinalTotal.toLocaleString(undefined, {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                              })}
                            </span>
                                </>
                              );
                            })()}
                          </button>
                        ))
                      )}
                    </div>
                  </div>
                  <div className="sticky bottom-0 z-10 shrink-0 border-t border-zinc-800 bg-[#141414] px-3 py-2 text-xs">
                    <div className="mb-1 flex items-center justify-end gap-3 text-zinc-300">
                      <span>Aplicar desconto depois dos impostos</span>
                      <span className="rounded border border-zinc-700 bg-[#1b1b1b] px-2 py-0.5">Porcentagem de desconto</span>
                      <span>0 %</span>
                    </div>
                    <div className="space-y-0.5 text-right">
                      <p className="text-zinc-400">Total antes de impostos: {totalBeforeTax.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                      <p className="text-zinc-400">Impostos: 0.00</p>
                      <p className="text-lg font-semibold text-zinc-100">Total: {totalBeforeTax.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                    </div>
                  </div>
                </div>

              </div>

              <div className="mt-1 grid grid-cols-2 gap-2">
                <label>
                  <span className="mb-1 block text-xs text-zinc-400">Nota interna</span>
                  <input className="h-9 w-full border border-zinc-700 bg-[#141414] px-2 text-zinc-100 focus:outline-none" />
                </label>
                <label>
                  <span className="mb-1 block text-xs text-zinc-400">Nota</span>
                  <input className="h-9 w-full border border-zinc-700 bg-[#141414] px-2 text-zinc-100 focus:outline-none" />
                </label>
              </div>

              <div className="mt-1 flex items-center justify-end gap-2 border-t border-zinc-800 pt-2">
                <button
                  className="flex items-center gap-2 rounded border border-zinc-700 bg-zinc-800/50 px-4 py-2 text-xs font-medium text-zinc-400 transition-colors hover:bg-zinc-700 hover:text-white"
                  type="button"
                >
                  <FileText size={14} />
                  Visualização de impressão
                </button>
                <button
                  className="flex items-center gap-2 rounded border border-zinc-700 bg-zinc-800/50 px-4 py-2 text-xs font-medium text-zinc-400 transition-colors hover:bg-zinc-700 hover:text-white"
                  type="button"
                >
                  <Printer size={14} />
                  Imprimir
                </button>
                <button
                  onClick={() => void saveDocument(false)}
                  disabled={isSavingDocument}
                  className="flex items-center gap-2 rounded border border-zinc-700 bg-zinc-800/50 px-4 py-2 text-xs font-medium text-zinc-400 transition-colors hover:bg-zinc-700 hover:text-white"
                  type="button"
                >
                  <Check size={14} />
                  {isSavingDocument ? 'Salvando...' : 'Salvar'}
                </button>
                <button
                  className="flex items-center gap-2 rounded border border-zinc-700 bg-zinc-800/50 px-4 py-2 text-xs font-medium text-zinc-400 transition-colors hover:bg-zinc-700 hover:text-white"
                  type="button"
                >
                  <PackagePlus size={14} />
                  Salvar e novo
                </button>
                <button
                  onClick={() => void saveDocument(true)}
                  disabled={isSavingDocument}
                  className="flex items-center gap-2 rounded border border-zinc-700 bg-zinc-800/50 px-4 py-2 text-xs font-medium text-zinc-400 transition-colors hover:bg-zinc-700 hover:text-white"
                  type="button"
                >
                  <Check size={14} />
                  {isSavingDocument ? 'Salvando...' : 'Salvar e fechar'}
                </button>
              </div>
            </div>

            {editorItem && isItemEditorOpen && (
              <aside className="absolute inset-y-0 right-0 z-30 flex w-[300px] min-h-0 flex-col border-l border-zinc-700 bg-[#141414] px-4 py-3 text-xs shadow-2xl">
                <div className="mb-3 flex items-center justify-between border-b border-zinc-800 pb-2">
                  <p className="text-base font-medium text-zinc-100">{editorItem.name}</p>
                  <button
                    type="button"
                    onClick={handleEditorCancel}
                    className="rounded border border-zinc-700 bg-[#1f1f1f] px-2 py-1 text-zinc-200 hover:bg-zinc-700"
                  >
                    <X size={14} />
                  </button>
                </div>
                <div className="pl-1">
                <label className="mb-2 block">
                  <span className="mb-1 block text-zinc-400">Quantidade</span>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      step="0.0001"
                      value={editorItem.quantity === 0 ? '' : String(editorItem.quantity)}
                      placeholder="0"
                      onChange={(e) => updateSelectedItem({ quantity: Number(e.target.value) || 0 })}
                      className="h-8 w-[126px] border border-zinc-700 bg-[#141414] px-2 text-right text-xs text-zinc-100 focus:outline-none"
                    />
                    <span className="flex flex-col leading-tight">
                      <span className="text-[11px] text-zinc-400">Stock disponível:</span>
                      <span
                        className={`text-xs font-bold ${
                          Number(editorProductStock ?? 0) > 0 ? 'text-emerald-500/80' : 'text-red-500/80'
                        }`}
                      >
                        {editorProductStock != null ? editorProductStock.toFixed(3) : '-'}
                      </span>
                    </span>
                  </div>
                </label>
                <label className="mb-2 block">
                  <span className="mb-1 block text-zinc-400">Preço antes dos impostos</span>
                  <input
                    type="number"
                    step="0.01"
                    value={editorItem.unitPrice === 0 ? '' : String(editorItem.unitPrice)}
                    placeholder="0"
                    onChange={(e) => updateSelectedItem({ unitPrice: Number(e.target.value) || 0 })}
                    className="h-8 w-[126px] border border-zinc-700 bg-[#141414] px-2 text-right text-xs text-zinc-100 focus:outline-none"
                  />
                </label>
                <label className="mb-2 block">
                  <span className="mb-1 block text-zinc-400">Impostos</span>
                  {editorItem.taxUiEnabled && (
                    <div className="flex items-center gap-2">
                      <select
                        value={`${editorItem.taxCode}:${editorItem.taxRate}`}
                        onChange={(e) => {
                          const [taxCode, taxRateStr] = e.target.value.split(':');
                          updateSelectedItem({
                            taxCode,
                            taxRate: Number(taxRateStr) || 0,
                          });
                        }}
                        className="h-8 w-[150px] border border-zinc-700 bg-[#141414] px-2 text-xs text-zinc-100 focus:outline-none"
                      >
                        <option value="IVA:16">IVA (16%)</option>
                        <option value="IVA:5">IVA (5%)</option>
                        <option value="ISENTO:0">Isento (0%)</option>
                      </select>
                      <button
                        type="button"
                        onClick={() =>
                          updateSelectedItem({
                            tax:
                              ((editorItem.quantity * editorItem.unitPrice) *
                                (editorItem.taxRate || 0)) /
                              100,
                          })
                        }
                        className="text-base font-bold text-green-500 hover:text-green-400"
                        aria-label="Aplicar imposto"
                      >
                        +
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          updateSelectedItem({
                            tax: 0,
                            taxRate: 0,
                            taxCode: 'ISENTO',
                            taxUiEnabled: false,
                          })
                        }
                        className="text-base font-bold text-red-500 hover:text-red-400"
                        aria-label="Remover imposto"
                      >
                        -
                      </button>
                    </div>
                  )}
                </label>
                {!editorItem.taxUiEnabled && (
                  <button
                    type="button"
                    onClick={() => updateSelectedItem({ taxUiEnabled: true })}
                    className="mb-2 inline-flex h-8 items-center border border-zinc-700 bg-zinc-800 px-3 text-xs text-zinc-100 hover:bg-zinc-700"
                  >
                    Adicionar impostos
                  </button>
                )}
                <label className="mb-2 block">
                  <span className="mb-1 block text-zinc-400">Preço</span>
                  <input
                    value={editorItem.unitPrice.toFixed(2)}
                    readOnly
                    className="h-8 w-[126px] border border-zinc-700 bg-[#141414] px-2 text-right text-xs text-zinc-100 focus:outline-none"
                  />
                </label>
                <div className="mb-2">
                  <span className="mb-1 block text-zinc-400">Desconto (depois dos impostos)</span>
                  <div className="grid w-[226px] grid-cols-[1fr_64px_auto] gap-1">
                    <select
                      value={editorItem.discountType}
                      onChange={(e) =>
                        updateSelectedItem({ discountType: e.target.value === 'fixed' ? 'fixed' : 'percent' })
                      }
                      className="h-8 border border-zinc-700 bg-[#141414] px-2 text-xs text-zinc-100 focus:outline-none"
                    >
                      <option value="percent">Porcentagem de desconto</option>
                      <option value="fixed">Valor de desconto</option>
                    </select>
                    <input
                      type="number"
                      step="0.01"
                      value={editorItem.discountValue === 0 ? '' : String(editorItem.discountValue)}
                      placeholder="0"
                      onChange={(e) => updateSelectedItem({ discountValue: Number(e.target.value) || 0 })}
                      className="h-8 border border-zinc-700 bg-[#141414] px-2 text-right text-xs text-zinc-100 focus:outline-none"
                    />
                    <span className="flex items-center text-zinc-300">
                      {editorItem.discountType === 'percent' ? '%' : 'MT'}
                    </span>
                  </div>
                </div>
                <div className="mt-2 border-t border-zinc-800 pt-2 text-zinc-300">
                  <p className="mb-1">Total antes de impostos</p>
                  <input
                    readOnly
                    value={selectedItemSubtotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    className="h-8 w-[150px] border border-zinc-700 bg-[#141414] px-2 text-right text-sm font-semibold text-zinc-100 focus:outline-none"
                  />
                </div>
                <div className="mt-2 text-zinc-300">
                  <p className="mb-1">Total</p>
                  <input
                    readOnly
                    value={selectedItemFinalTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    className="h-8 w-[150px] border border-zinc-700 bg-[#141414] px-2 text-right text-sm font-semibold text-zinc-100 focus:outline-none"
                  />
                </div>
                <label className="mt-4 block">
                  <span className="mb-1 block text-zinc-400">Expiration date</span>
                  <input
                    type="date"
                    value={editorItem.expirationDate}
                    onChange={(e) => updateSelectedItem({ expirationDate: e.target.value })}
                    className="h-8 w-[150px] border border-zinc-700 bg-[#141414] px-2 text-xs text-zinc-100 focus:outline-none"
                  />
                </label>
                </div>
                <div className="mt-auto grid grid-cols-2 gap-2 border-t border-zinc-800 pt-3">
                  <button
                    type="button"
                    onClick={handleEditorOk}
                    className="flex h-9 items-center justify-center gap-2 rounded border border-zinc-700 bg-zinc-800/50 px-4 py-2 text-xs font-medium text-zinc-400 transition-colors hover:bg-zinc-700 hover:text-white"
                  >
                    <Check size={14} />
                    OK
                  </button>
                  <button
                    type="button"
                    onClick={handleEditorCancel}
                    className="flex h-9 items-center justify-center gap-2 rounded border border-zinc-700 bg-zinc-800/50 px-4 py-2 text-xs font-medium text-zinc-400 transition-colors hover:bg-zinc-700 hover:text-white"
                  >
                    <X size={14} />
                    Cancelar
                  </button>
                </div>
              </aside>
            )}
          </div>
        </div>
      )}

      {isDeleteItemConfirmOpen && (
        <div
          className="fixed inset-0 z-[90] flex items-center justify-center bg-black/60 p-4"
          onClick={() => setIsDeleteItemConfirmOpen(false)}
        >
          <div
            className="w-full max-w-sm overflow-hidden rounded-lg border border-zinc-800 bg-[#1a1a1a]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="space-y-4 p-6 text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-red-500/10 text-red-500">
                <Trash2 size={22} />
              </div>
              <div>
                <h3 className="text-lg font-bold text-white">Confirmar exclusao</h3>
                <p className="mt-1 text-xs text-zinc-400">
                  Tem certeza que deseja excluir o item selecionado?
                </p>
              </div>
              <div className="flex justify-center gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setIsDeleteItemConfirmOpen(false)}
                  className="flex items-center gap-2 rounded border border-zinc-700 bg-zinc-800/50 px-4 py-2 text-xs font-medium text-zinc-400 transition-colors hover:bg-zinc-700 hover:text-white"
                >
                  <X size={14} />
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={deleteSelectedItem}
                  className="flex items-center gap-2 rounded border border-red-600 bg-red-600 px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-red-500"
                >
                  <Trash2 size={14} />
                  Excluir
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {isProductPickerOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4">
          <div className="flex h-[82vh] w-[92vw] max-w-[1200px] flex-col overflow-hidden rounded border border-zinc-400 bg-[#f1f1f1] text-zinc-900">
            <header className="border-b border-zinc-300 bg-white px-4 py-2">
              <h3 className="text-3xl font-medium text-zinc-700">Artigos</h3>
            </header>

            <div className="px-4 py-3">
              <p className="mb-1 text-2xl font-semibold text-zinc-700">Código de barras</p>
              <input
                value={productSearch}
                onChange={(e) => setProductSearch(e.target.value)}
                className="w-full max-w-[420px] border border-zinc-300 bg-white px-3 py-2 text-xl focus:outline-none"
              />
            </div>

            <div className="flex-1 px-4">
              <div className="h-full rounded border border-sky-300 bg-white">
                <div className="grid grid-cols-10 border-b border-sky-300 px-2 py-2 text-[30px] text-zinc-600">
                  <span className="col-span-7">Descrição</span>
                  <span className="col-span-2">Stock</span>
                  <span className="col-span-1">Sel.</span>
                </div>
                <div className="max-h-[46vh] overflow-y-auto">
                  {productsLoading ? (
                    <div className="p-4 text-sm text-zinc-500">A carregar produtos...</div>
                  ) : (
                    filteredProducts.map((product) => {
                      const rowId = String(product.id);
                      const selected = selectedProductId === rowId;
                      return (
                        <button
                          key={rowId}
                          type="button"
                          onClick={() => setSelectedProductId(rowId)}
                          className="grid w-full grid-cols-10 border-b border-zinc-100 text-left hover:bg-zinc-50"
                        >
                          <span className="col-span-7 px-2 py-2 text-[31px]">{String(product.name ?? '-')}</span>
                          <span className="col-span-2 px-2 py-2 text-[31px]">{String(product.stock_quantity ?? 0)}</span>
                          <span className="col-span-1 flex items-center justify-center px-2 py-2">
                            <span className={`h-6 w-6 border ${selected ? 'border-blue-500 bg-blue-500' : 'border-zinc-400 bg-white'}`} />
                          </span>
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
            </div>

            <footer className="mt-auto flex items-center justify-between border-t border-zinc-300 bg-white p-4">
              <div className="flex items-center gap-3">
                <button type="button" className="h-14 min-w-[120px] border border-zinc-300 bg-zinc-200 px-4 text-sm text-zinc-600">
                  <FileText className="mx-auto" size={18} />
                </button>
                <button type="button" className="h-14 min-w-[120px] border border-zinc-300 bg-zinc-200 px-4 text-sm text-zinc-600">
                  <PackageSearch className="mx-auto" size={18} />
                </button>
              </div>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setIsProductPickerOpen(false)}
                  className="h-14 min-w-[140px] border border-zinc-300 bg-zinc-200 px-4 text-lg font-medium text-zinc-600"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const selected = products.find((p) => String(p.id) === selectedProductId);
                    if (selected) addProductToDocument(selected);
                    setIsProductPickerOpen(false);
                  }}
                  className="h-14 min-w-[140px] border border-red-600 bg-red-600 px-4 text-lg font-semibold text-white"
                >
                  OK
                </button>
              </div>
            </footer>
          </div>
        </div>
      )}
    </div>
  );
}
