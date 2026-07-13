'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  X,
  PackagePlus,
  Search,
  Trash2,
  Loader2,
  Building2,
  CalendarDays,
  FileText,
  Check,
} from 'lucide-react';
import { getPosApiBase } from '@/lib/apiBase';
import { unwrapApiSuccessPayload } from '@/lib/apiResponse';
import { formatMoneyMt } from '@/lib/currency';
import PosSelect from '@/components/PosSelect';

export type PurchaseProductOption = {
  id: string;
  name: string;
  code?: number;
  cost?: number;
  unit?: string;
  stock_quantity?: number;
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

type PurchaseLine = {
  key: string;
  productId: string;
  name: string;
  unit: string;
  quantity: number;
  unitPrice: number;
};

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
  const [paid, setPaid] = useState(true);
  const [docNumber, setDocNumber] = useState('EN/ST/…');
  const [lines, setLines] = useState<PurchaseLine[]>([]);
  const [productQuery, setProductQuery] = useState('');
  const [loadingMeta, setLoadingMeta] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [successHint, setSuccessHint] = useState('');

  const selectedParty = useMemo(
    () => parties.find((p) => String(p.id) === String(partyId)) ?? null,
    [parties, partyId],
  );

  const total = useMemo(
    () => lines.reduce((acc, line) => acc + line.quantity * line.unitPrice, 0),
    [lines],
  );

  const filteredProducts = useMemo(() => {
    const q = productQuery.trim().toLowerCase();
    if (!q) return products.slice(0, 40);
    return products
      .filter((p) => {
        const name = String(p.name ?? '').toLowerCase();
        const code = String(p.code ?? '');
        return name.includes(q) || code.includes(q);
      })
      .slice(0, 40);
  }, [productQuery, products]);

  const loadMeta = useCallback(async () => {
    setLoadingMeta(true);
    setError('');
    try {
      const year = new Date(documentDate).getFullYear() || new Date().getFullYear();
      const [partyRes, nextRes] = await Promise.all([
        fetch(`${getPosApiBase()}/clientes`),
        fetch(`${getPosApiBase()}/documentos/next-number?prefix=${encodeURIComponent('EN/ST')}&year=${year}`),
      ]);
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
            ? `EN/ST/${year}/${String(payload.sequence).padStart(5, '0')}`
            : null);
        if (number) setDocNumber(String(number));
        else setDocNumber(`EN/ST/${year}/00001`);
      } else {
        setDocNumber(`EN/ST/${year}/00001`);
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
    setPaid(true);
    setProductQuery('');
    setError('');
    setSuccessHint('');
    setPartyId('');

    const initial = initialProductId
      ? products.find((p) => String(p.id) === String(initialProductId))
      : null;
    if (initial) {
      setLines([
        {
          key: newLineKey(),
          productId: String(initial.id),
          name: initial.name,
          unit: initial.unit || 'un',
          quantity: 1,
          unitPrice: Number(initial.cost ?? 0) || 0,
        },
      ]);
    } else {
      setLines([]);
    }

    void loadMeta();
  }, [isOpen, initialProductId, products, loadMeta]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !saving) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose, saving]);

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
      return [
        ...prev,
        {
          key: newLineKey(),
          productId: String(product.id),
          name: product.name,
          unit: product.unit || 'un',
          quantity: 1,
          unitPrice: Number(product.cost ?? 0) || 0,
        },
      ];
    });
    setProductQuery('');
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

    setSaving(true);
    try {
      const payload = {
        documentType: 'Compra',
        prefix: 'EN/ST',
        documentDate: `${documentDate}T00:00:00.000Z`,
        dueDate: `${documentDate}T00:00:00.000Z`,
        paid,
        externalDocument: externalDoc.trim() || null,
        customerId: selectedParty.id,
        customerName: selectedParty.name,
        total,
        discount: 0,
        paymentMethod: paid ? 'Compra' : null,
        items: lines.map((line) => ({
          productId: line.productId,
          name: line.name,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          discountAmount: 0,
        })),
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
      setSuccessHint(`Compra ${savedNumber} registada. Stock actualizado.`);
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
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-black/65 p-4 backdrop-blur-sm"
      onClick={() => {
        if (!saving) onClose();
      }}
    >
      <div
        className="flex max-h-[92vh] w-full max-w-[980px] flex-col overflow-hidden rounded-lg border border-zinc-700 bg-[#1a1a1a] shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between border-b border-zinc-800 bg-[#141414] px-5 py-4">
          <div className="flex min-w-0 items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#00a3e0]/15 text-[#00a3e0]">
              <PackagePlus size={20} />
            </div>
            <div className="min-w-0">
              <h2 className="text-base font-bold tracking-wide text-zinc-100">Compra</h2>
              <p className="mt-1 text-xs leading-relaxed text-zinc-400">
                Registe uma compra a fornecedor. O stock dos produtos é aumentado e é criado o
                documento de compra no sistema.
              </p>
              <p className="mt-2 text-[11px] font-semibold text-zinc-300">
                Documento: <span className="text-[#00a3e0]">{docNumber}</span>
              </p>
            </div>
          </div>
          <button
            type="button"
            disabled={saving}
            onClick={onClose}
            className="rounded p-2 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-white disabled:opacity-40"
            aria-label="Fechar"
          >
            <X size={18} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto custom-scrollbar px-5 py-4">
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

          <button
            type="button"
            onClick={() => setPaid((prev) => !prev)}
            disabled={saving}
            className="pos-field mt-3 flex h-auto items-center gap-2 border border-[#3f3f46] px-3 py-2 text-xs text-zinc-300"
          >
            <span
              className={`flex h-4 w-4 items-center justify-center rounded border ${
                paid ? 'border-[#00a3e0] bg-[#00a3e0] text-white' : 'border-zinc-600'
              }`}
            >
              {paid ? <Check size={11} strokeWidth={3} /> : null}
            </span>
            Compra paga
          </button>

          <div className="mt-5 border-t border-zinc-800 pt-4">
            <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">
              Produtos da compra
            </span>
            <div className="relative mt-2">
              <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
              <input
                type="text"
                value={productQuery}
                onChange={(event) => setProductQuery(event.target.value)}
                placeholder="Pesquisar produto por nome ou código…"
                disabled={saving}
                className="pos-field h-10 border border-[#3f3f46] pl-9 pr-3 text-sm placeholder:text-zinc-600"
              />
            </div>

            {productQuery.trim() ? (
              <div className="pos-dropdown mt-2 max-h-40 overflow-y-auto custom-scrollbar">
                {filteredProducts.length === 0 ? (
                  <p className="px-3 py-2 text-xs text-zinc-500">Nenhum produto encontrado.</p>
                ) : (
                  filteredProducts.map((product) => (
                    <button
                      key={product.id}
                      type="button"
                      onClick={() => addProduct(product)}
                      className="pos-dropdown-item !flex !items-center !justify-between gap-3"
                    >
                      <span className="min-w-0 truncate text-left text-zinc-200">
                        {product.code != null ? (
                          <span className="mr-2 text-zinc-500">{product.code}</span>
                        ) : null}
                        {product.name}
                      </span>
                      <span className="shrink-0 whitespace-nowrap text-zinc-500">
                        Stock Atual:{' '}
                        {Number(product.stock_quantity ?? 0).toLocaleString(undefined, {
                          maximumFractionDigits: 3,
                        })}
                      </span>
                    </button>
                  ))
                )}
              </div>
            ) : null}

            <div className="mt-3 overflow-hidden rounded-[0.4rem] border border-[#3f3f46]">
              <div className="grid grid-cols-[minmax(0,1fr)_88px_110px_110px_40px] items-center gap-2 border-b border-zinc-800 bg-[#141414] px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                <span>Produto</span>
                <span className="block w-full text-right">Qtd</span>
                <span className="block w-full text-right">Custo</span>
                <span className="block w-full text-right">Total</span>
                <span />
              </div>
              {lines.length === 0 ? (
                <p className="px-3 py-8 text-center text-xs text-zinc-500">
                  Ainda sem linhas. Pesquise e adicione produtos acima.
                </p>
              ) : (
                <div className="divide-y divide-zinc-800/80">
                  {lines.map((line) => (
                    <div
                      key={line.key}
                      className="grid grid-cols-[minmax(0,1fr)_88px_110px_110px_40px] items-center gap-2 px-3 py-2"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-zinc-100">{line.name}</p>
                        <p className="text-[10px] text-zinc-500">{line.unit}</p>
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
                        className="pos-field h-9 w-full border border-[#3f3f46] px-2 text-right text-sm"
                      />
                      <span className="block w-full text-right text-sm font-semibold text-zinc-200">
                        {formatMoneyMt(line.quantity * line.unitPrice)}
                      </span>
                      <button
                        type="button"
                        onClick={() => removeLine(line.key)}
                        disabled={saving}
                        className="flex h-9 w-9 items-center justify-center rounded text-zinc-500 transition-colors hover:bg-rose-950/40 hover:text-rose-300"
                        aria-label="Remover linha"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {error ? <p className="mt-3 text-xs text-rose-400">{error}</p> : null}
          {successHint ? <p className="mt-3 text-xs text-emerald-400">{successHint}</p> : null}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-zinc-800 bg-[#141414] px-5 py-3">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">Total da compra</p>
            <p className="text-lg font-bold text-white">{formatMoneyMt(total)}</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={saving}
              onClick={onClose}
              className="rounded border border-zinc-600 px-4 py-2 text-sm text-zinc-300 transition-colors hover:border-zinc-400 hover:text-white disabled:opacity-40"
            >
              Cancelar
            </button>
            <button
              type="button"
              disabled={saving || loadingMeta}
              onClick={() => void handleSave()}
              className="inline-flex items-center gap-2 rounded bg-[#00a3e0] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#0090c7] disabled:opacity-50"
            >
              {saving ? <Loader2 size={16} className="animate-spin" /> : <PackagePlus size={16} />}
              Guardar compra
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
