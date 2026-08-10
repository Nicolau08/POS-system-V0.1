'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Ban,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  FileSpreadsheet,
  Inbox,
  Mail,
  Printer,
  RefreshCcw,
  Search,
  Stamp,
  Trash2,
  X,
} from 'lucide-react';
import type { CompanyProfile } from '@/app/pos/types';
import { ConfirmDialog } from '@/app/pos/components/ConfirmDialog';
import { ManagementToolbarButton, ManagementToolbarDivider } from '@/components/ManagementToolbarButton';
import { getPosApiBase, getPosUserAuthHeaders } from '@/lib/apiBase';
import { extractApiErrorMessage, unwrapApiSuccessPayload } from '@/lib/apiResponse';
import { formatMoneyMt } from '@/lib/currency';
import {
  saveSalesDocumentAsPdf,
} from '@/lib/documents/salesDocumentPrint';
import { printSalesDocumentThermalSecondCopy } from '@/lib/documents/thermalReceiptPrint';
import { usePermissions } from '@/hooks/usePermissions';
import { fetchCompanyProfile } from '@/lib/services/posService';
import { formatPaymentMethodLabel } from '@/lib/paymentMethodLabel';
import { getPosTaxPercentLabel, getPosTaxRate } from '@/lib/taxConfig';

type SaleRow = {
  id: number | string;
  doc_type?: string | null;
  document_number?: string | null;
  payment_method?: string | null;
  status?: string | null;
  discount?: number | null;
  subtotal?: number | null;
  tax?: number | null;
  total?: number | null;
  created_at?: string | null;
  client_name?: string | null;
  user_name?: string | null;
  approved_document_type?: string | null;
  approved_document_number?: string | null;
};

type SaleItemRow = {
  id: number | string;
  order_id: number | string;
  product_name?: string | null;
  quantity?: number | null;
  unit?: string | null;
  price?: number | null;
  discount_amount?: number | null;
};

const DEFAULT_TAX_RATE_PERCENT = getPosTaxRate() * 100;
const DEFAULT_TAX_RATE_LABEL = getPosTaxPercentLabel();

function toDateInput(date: Date) {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

function todayInput() {
  return toDateInput(new Date());
}

function firstDayOfYearInput() {
  const now = new Date();
  return toDateInput(new Date(now.getFullYear(), 0, 1));
}

function formatInputDateLabel(value: string) {
  if (!value) return 'dd/mm/yyyy';
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return 'dd/mm/yyyy';
  return new Intl.DateTimeFormat('pt-PT').format(date);
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString('pt-PT', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function monthLabel(value: string) {
  return new Date(`${value}T00:00:00`).toLocaleDateString('pt-PT', {
    month: 'long',
    year: 'numeric',
  });
}

function shiftMonth(value: string, delta: number) {
  const date = new Date(`${value}T00:00:00`);
  return toDateInput(new Date(date.getFullYear(), date.getMonth() + delta, 1));
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
      value: toDateInput(date),
      day: date.getDate(),
      inMonth: date.getMonth() === month,
    };
  });
}

function resolveSaleDocTypeLabel(row: SaleRow) {
  const raw = String(row.doc_type ?? '').trim();
  const upper = raw.toUpperCase();
  if (upper === 'VD' || upper === 'VENDA') return 'Venda';
  if (upper === 'FT' || upper === 'FATURA') return 'Fatura';
  if (upper === 'FP') return 'Fatura proforma';
  if (upper === 'TK') return 'Talão';
  if (raw) return raw;
  return 'Venda';
}

function isSalesDocument(row: SaleRow) {
  const id = String(row.id ?? '');
  const docType = String(row.doc_type ?? '').toLowerCase();
  const docNumber = String(row.document_number ?? '').toUpperCase();
  if (id.startsWith('inv:')) return false;
  if (docType.includes('invent')) return false;
  if (docNumber.startsWith('INV/')) return false;
  if (docNumber.startsWith('WH/IN')) return false;
  return true;
}

function isVdSale(row: SaleRow) {
  const docType = String(row.doc_type ?? '').trim().toUpperCase();
  if (docType === 'VD' || docType === 'VENDA') return true;
  return String(row.document_number ?? '').trim().toUpperCase().startsWith('VD/');
}

function isCancelledSale(row: SaleRow) {
  const status = String(row.status ?? '').trim().toLowerCase();
  return status === 'cancelled' || status === 'canceled' || status === 'void' || status === 'anulado';
}

export function SalesHistoryModal({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  const { can } = usePermissions();
  const canAnularVd = can('vendas.anular_vd', 5);
  const [sales, setSales] = useState<SaleRow[]>([]);
  const [itemsByOrderId, setItemsByOrderId] = useState<Record<string, SaleItemRow[]>>({});
  const [companyProfile, setCompanyProfile] = useState<CompanyProfile | null>(null);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [actionMessage, setActionMessage] = useState('');
  const [isAnullingVd, setIsAnullingVd] = useState(false);
  const [isAnularConfirmOpen, setIsAnularConfirmOpen] = useState(false);

  const [selectedSaleId, setSelectedSaleId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  const [dateFrom, setDateFrom] = useState(firstDayOfYearInput());
  const [dateTo, setDateTo] = useState(todayInput());
  const [tempDateFrom, setTempDateFrom] = useState(dateFrom);
  const [tempDateTo, setTempDateTo] = useState(dateTo);
  const [calendarStartMonth, setCalendarStartMonth] = useState(`${dateFrom.slice(0, 7)}-01`);
  const [calendarEndMonth, setCalendarEndMonth] = useState(`${dateTo.slice(0, 7)}-01`);
  const [isPeriodModalOpen, setIsPeriodModalOpen] = useState(false);
  const [activePreset, setActivePreset] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setErrorMessage('');
    try {
      const authHeaders = getPosUserAuthHeaders();
      const [docsRes, salesRes, itemsRes] = await Promise.all([
        fetch(`${getPosApiBase()}/documentos`, { headers: { ...authHeaders }, cache: 'no-store' }),
        fetch(`${getPosApiBase()}/vendas`, { headers: { ...authHeaders }, cache: 'no-store' }),
        fetch(`${getPosApiBase()}/documentos-itens`, { headers: { ...authHeaders }, cache: 'no-store' }),
      ]);
      if (!docsRes.ok) throw new Error(`Falha ao carregar documentos (${docsRes.status})`);
      if (!salesRes.ok) throw new Error(`Falha ao carregar vendas (${salesRes.status})`);
      if (!itemsRes.ok) throw new Error(`Falha ao carregar itens (${itemsRes.status})`);

      const docsOrders = (unwrapApiSuccessPayload<SaleRow[]>(await docsRes.json()) ?? []) as SaleRow[];
      const salesOrders = (unwrapApiSuccessPayload<SaleRow[]>(await salesRes.json()) ?? []) as SaleRow[];
      const merged = new Map<string, SaleRow>();
      for (const order of docsOrders) {
        if (isSalesDocument(order)) merged.set(String(order.id), order);
      }
      for (const sale of salesOrders) {
        const id = `venda:${String(sale.id)}`;
        merged.set(id, { ...sale, id });
      }

      const sorted = Array.from(merged.values()).sort((a, b) => {
        const aTime = Date.parse(String(a.created_at ?? '')) || 0;
        const bTime = Date.parse(String(b.created_at ?? '')) || 0;
        return bTime - aTime;
      });
      setSales(sorted);

      const itemsPayload = unwrapApiSuccessPayload<SaleItemRow[] | null>(await itemsRes.json());
      const itemsData = Array.isArray(itemsPayload) ? itemsPayload : [];
      const grouped: Record<string, SaleItemRow[]> = {};
      for (const item of itemsData) {
        const key = String(item.order_id);
        if (!grouped[key]) grouped[key] = [];
        grouped[key].push(item);
        const saleKey = `venda:${key}`;
        if (!grouped[saleKey]) grouped[saleKey] = [];
        grouped[saleKey].push(item);
      }
      setItemsByOrderId(grouped);
    } catch (error) {
      setSales([]);
      setItemsByOrderId({});
      setErrorMessage(error instanceof Error ? error.message : 'Falha ao carregar histórico de vendas');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    void fetchData();
    void fetchCompanyProfile()
      .then(setCompanyProfile)
      .catch(() => setCompanyProfile(null));
  }, [isOpen, fetchData]);

  useEffect(() => {
    if (!isPeriodModalOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsPeriodModalOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isPeriodModalOpen]);

  const filteredSales = useMemo(() => {
    const textQ = searchQuery.trim().toLowerCase();
    return sales.filter((row) => {
      const docNumber = String(row.document_number ?? '').toLowerCase();
      const customer = String(row.client_name ?? 'Consumidor final').toLowerCase();
      const user = String(row.user_name ?? '-').toLowerCase();
      const payment = formatPaymentMethodLabel(row.payment_method).toLowerCase();
      const paymentRaw = String(row.payment_method ?? '').toLowerCase();
      const docType = resolveSaleDocTypeLabel(row).toLowerCase();
      const orderDate = String(row.created_at ?? '').slice(0, 10);

      if (dateFrom && orderDate && orderDate < dateFrom) return false;
      if (dateTo && orderDate && orderDate > dateTo) return false;
      if (
        textQ &&
        !customer.includes(textQ) &&
        !user.includes(textQ) &&
        !docNumber.includes(textQ) &&
        !payment.includes(textQ) &&
        !paymentRaw.includes(textQ) &&
        !docType.includes(textQ)
      ) {
        return false;
      }
      return true;
    });
  }, [sales, searchQuery, dateFrom, dateTo]);

  const selectedSale = useMemo(() => {
    if (!selectedSaleId) return null;
    return filteredSales.find((row) => String(row.id) === selectedSaleId) ?? null;
  }, [filteredSales, selectedSaleId]);

  const selectedItems = useMemo(() => {
    if (!selectedSaleId) return [];
    return itemsByOrderId[selectedSaleId] ?? [];
  }, [itemsByOrderId, selectedSaleId]);

  const canActOnSelection = Boolean(selectedSale);
  const selectedSaleIsAnullableVd = Boolean(
    selectedSale && canAnularVd && isVdSale(selectedSale) && !isCancelledSale(selectedSale),
  );

  const handlePrintSecondCopy = () => {
    if (!selectedSale) {
      setActionMessage('Selecione um documento para imprimir.');
      return;
    }
    void printSalesDocumentThermalSecondCopy(selectedSale, selectedItems, companyProfile).then((opened) => {
      if (!opened) {
        setActionMessage('Não foi possível abrir a impressão térmica.');
        return;
      }
      setActionMessage('');
    });
  };

  const handleSavePdf = () => {
    if (!selectedSale) {
      setActionMessage('Selecione um documento para gerar o PDF.');
      return;
    }
    const opened = saveSalesDocumentAsPdf(selectedSale, selectedItems, companyProfile);
    if (!opened) {
      setActionMessage('Não foi possível abrir a janela de PDF. Verifique se o browser permite pop-ups.');
      return;
    }
    setActionMessage('');
  };

  const handleAnularVd = async () => {
    if (!selectedSale || !selectedSaleIsAnullableVd || isAnullingVd) return;
    const docNumber = String(selectedSale.document_number ?? selectedSale.id).trim();
    setIsAnularConfirmOpen(false);
    setIsAnullingVd(true);
    setActionMessage('');
    try {
      const res = await fetch(
        `${getPosApiBase()}/documentos/${encodeURIComponent(String(selectedSale.id))}/anular`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...getPosUserAuthHeaders(),
          },
          body: JSON.stringify({}),
        },
      );
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(extractApiErrorMessage(payload, `Falha ao anular VD (${res.status})`));
      }
      setActionMessage(`VD ${docNumber} anulada.`);
      setSelectedSaleId(null);
      await fetchData();
    } catch (error) {
      setActionMessage(error instanceof Error ? error.message : 'Falha ao anular VD.');
    } finally {
      setIsAnullingVd(false);
    }
  };

  const totalValue = useMemo(
    () => filteredSales.reduce((sum, row) => sum + Number(row.total ?? 0), 0),
    [filteredSales],
  );

  const openPeriodModal = () => {
    setTempDateFrom(dateFrom);
    setTempDateTo(dateTo);
    setCalendarStartMonth(`${dateFrom.slice(0, 7)}-01`);
    setCalendarEndMonth(`${dateTo.slice(0, 7)}-01`);
    setIsPeriodModalOpen(true);
  };

  const applyPeriod = () => {
    if (tempDateFrom > tempDateTo) return;
    setDateFrom(tempDateFrom);
    setDateTo(tempDateTo);
    setIsPeriodModalOpen(false);
  };

  const applyPresetPeriod = (
    preset: 'today' | 'yesterday' | 'thisWeek' | 'lastWeek' | 'thisMonth' | 'lastMonth' | 'thisYear' | 'lastYear',
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

    const startInput = toDateInput(start);
    const endInput = toDateInput(end);
    setTempDateFrom(startInput);
    setTempDateTo(endInput);
    setCalendarStartMonth(`${startInput.slice(0, 7)}-01`);
    setCalendarEndMonth(`${endInput.slice(0, 7)}-01`);
    setActivePreset(preset);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex flex-col bg-[#141414]">
      <div className="flex items-center justify-between border-b border-zinc-800 bg-[#1a1a1a] px-4 py-2">
        <h2 className="text-sm font-bold tracking-wide text-zinc-100">Histórico de vendas</h2>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg p-2 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-white"
          aria-label="Fechar"
        >
          <X size={18} />
        </button>
      </div>

      <div className="relative z-40 h-16 border-b border-zinc-800 bg-[#1a1a1a] px-2 overflow-visible">
        <div className="flex h-full items-center gap-3 overflow-visible">
          <div className="flex h-full min-w-0 flex-1 items-center gap-1 overflow-x-auto overflow-y-visible no-scrollbar">
            <ManagementToolbarButton
              icon={<RefreshCcw size={20} />}
              label="Atualizar"
              onClick={() => void fetchData()}
            />
            <ManagementToolbarButton
              icon={<Printer size={20} />}
              label="Imprimir"
              disabled={!canActOnSelection}
              onClick={handlePrintSecondCopy}
            />
            <ManagementToolbarButton
              icon={<FileSpreadsheet size={20} />}
              label="Salvar como PDF"
              disabled={!canActOnSelection}
              onClick={handleSavePdf}
            />
            <ManagementToolbarDivider />
            <ManagementToolbarButton icon={<Stamp size={20} />} label="Recibo" disabled />
            <ManagementToolbarButton icon={<Mail size={20} />} label="Enviar por e-mail" disabled />
            <ManagementToolbarButton icon={<Inbox size={20} />} label="Devolução" disabled />
            {canAnularVd ? (
              <ManagementToolbarButton
                icon={<Ban size={20} />}
                label="Anular"
                disabled={!selectedSaleIsAnullableVd || isAnullingVd}
                onClick={() => {
                  setActionMessage('');
                  setIsAnularConfirmOpen(true);
                }}
                title={
                  !selectedSale
                    ? 'Selecione uma venda a dinheiro para anular'
                    : selectedSaleIsAnullableVd
                      ? 'Anular venda a dinheiro e devolver stock'
                      : 'Esta VD já está anulada ou não é anulável'
                }
              />
            ) : null}
            <ManagementToolbarButton icon={<Trash2 size={20} />} label="Deletar" disabled />
          </div>
          <div className="shrink-0 pr-1">
            <button
              type="button"
              onClick={openPeriodModal}
              className="flex h-10 min-w-[220px] items-center gap-2 rounded border border-zinc-700 bg-[#121212] px-3 text-left hover:border-[#0001fb] hover:bg-zinc-800"
              title="Filtrar período"
            >
              <CalendarDays size={16} className="shrink-0 text-zinc-400" />
              <span className="flex-1 text-center text-xs text-zinc-200 whitespace-nowrap">
                {formatInputDateLabel(dateFrom)} — {formatInputDateLabel(dateTo)}
              </span>
            </button>
          </div>
        </div>
      </div>

      <div className="flex h-12 items-center gap-2 border-b border-zinc-800 bg-[#181818] px-2">
        <div className="flex items-center gap-3 border-r border-zinc-800 px-3 text-zinc-500">
          <Search size={18} />
        </div>
        <div className="relative flex-1">
          <input
            type="text"
            placeholder="Pesquisar por cliente, usuário ou documento"
            className="w-full bg-transparent px-2 py-2 text-sm text-zinc-200 outline-none placeholder:text-zinc-600"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      {errorMessage ? (
        <div className="border-b border-red-500/30 bg-red-500/10 px-4 py-2 text-xs text-red-300">{errorMessage}</div>
      ) : null}
      {actionMessage ? (
        <div className="border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-xs text-amber-200">{actionMessage}</div>
      ) : null}

      <div className="flex min-h-0 flex-1 flex-col">
        <div className="min-h-0 flex-[3] border-b border-zinc-800">
          <div className="h-full overflow-auto custom-scrollbar">
            <table className="w-full min-w-[1200px] border-collapse text-xs">
              <thead className="sticky top-0 z-10 bg-[#1f1f1f]">
                <tr className="text-zinc-400">
                  <Th>#</Th>
                  <Th>Tipo de documento</Th>
                  <Th>Usuário</Th>
                  <Th>Número</Th>
                  <Th>Documento</Th>
                  <Th>Cliente</Th>
                  <Th>Data</Th>
                  <Th>Criado</Th>
                  <Th>PDV</Th>
                  <Th>Tipo de pagamento</Th>
                  <Th className="text-right">Desconto</Th>
                  <Th className="text-right">Sem impostos</Th>
                  <Th className="text-right">Imposto</Th>
                  <Th className="text-right">Total</Th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={14} className="px-4 py-10 text-center text-zinc-500">
                      A carregar histórico...
                    </td>
                  </tr>
                ) : filteredSales.length === 0 ? (
                  <tr>
                    <td colSpan={14} className="px-4 py-10 text-center text-zinc-500">
                      Nenhuma venda encontrada para os filtros selecionados.
                    </td>
                  </tr>
                ) : (
                  filteredSales.map((row, index) => {
                    const rowId = String(row.id);
                    const selected = rowId === selectedSaleId;
                    const subtotal = Number(row.subtotal ?? (Number(row.total ?? 0) - Number(row.tax ?? 0)));
                    const tax = Number(row.tax ?? 0);
                    return (
                      <tr
                        key={rowId}
                        onClick={() => setSelectedSaleId(rowId)}
                        className={`cursor-pointer border-b border-zinc-800/70 transition-colors ${
                          selected ? 'bg-[var(--pos-brand-selected-bg)]' : 'text-zinc-200 hover:bg-[var(--pos-brand-hover-bg)]'
                        }`}
                      >
                        <Td>{index + 1}</Td>
                        <Td>{resolveSaleDocTypeLabel(row)}</Td>
                        <Td>{row.user_name || '-'}</Td>
                        <Td>{row.document_number || rowId}</Td>
                        <Td className="font-medium">{row.document_number || '-'}</Td>
                        <Td>{row.client_name || 'Consumidor final'}</Td>
                        <Td>{formatDateTime(row.created_at)}</Td>
                        <Td>{formatDateTime(row.created_at)}</Td>
                        <Td>POS 1</Td>
                        <Td>{formatPaymentMethodLabel(row.payment_method)}</Td>
                        <Td className="text-right tabular-nums">{formatMoneyMt(Number(row.discount ?? 0))}</Td>
                        <Td className="text-right tabular-nums">{formatMoneyMt(subtotal)}</Td>
                        <Td className="text-right tabular-nums">{formatMoneyMt(tax)}</Td>
                        <Td className="text-right tabular-nums font-semibold">{formatMoneyMt(Number(row.total ?? 0))}</Td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="min-h-0 flex-[2]">
          <div className="border-b border-zinc-800 bg-[#171717] px-3 py-1.5 text-[11px] text-zinc-400">
            Itens do documento ({selectedItems.length})
          </div>
          <div className="h-[calc(100%-28px)] overflow-auto custom-scrollbar">
            <table className="w-full min-w-[1100px] border-collapse text-xs">
              <thead className="sticky top-0 z-10 bg-[#1f1f1f]">
                <tr className="text-zinc-400">
                  <Th>#</Th>
                  <Th>Código</Th>
                  <Th>Nome</Th>
                  <Th>Unidade</Th>
                  <Th className="text-right">Quantidade</Th>
                  <Th className="text-right">Preço antes dos impostos</Th>
                  <Th className="text-right">Impostos</Th>
                  <Th className="text-right">Preço</Th>
                  <Th className="text-right">Total antes do desconto</Th>
                  <Th className="text-right">Desconto</Th>
                  <Th className="text-right">Total</Th>
                </tr>
              </thead>
              <tbody>
                {selectedItems.length === 0 ? (
                  <tr>
                    <td colSpan={11} className="px-4 py-8 text-center text-zinc-500">
                      {selectedSaleId ? 'Este documento não tem itens.' : 'Selecione uma venda para ver os itens.'}
                    </td>
                  </tr>
                ) : (
                  selectedItems.map((item, index) => {
                    const qty = Number(item.quantity ?? 0);
                    const unitPriceWithTax = Number(item.price ?? 0);
                    const discount = Number(item.discount_amount ?? 0);
                    const unitPriceBeforeTax = unitPriceWithTax / (1 + DEFAULT_TAX_RATE_PERCENT / 100);
                    const unitTaxAmount = unitPriceWithTax - unitPriceBeforeTax;
                    const rowTotal = unitPriceWithTax * qty - discount;
                    return (
                      <tr key={String(item.id)} className="border-b border-zinc-800/70 text-zinc-200 hover:bg-[var(--pos-brand-hover-bg)]">
                        <Td>{index + 1}</Td>
                        <Td>{index + 1}</Td>
                        <Td>{item.product_name || '-'}</Td>
                        <Td>{item.unit || 'un'}</Td>
                        <Td className="text-right tabular-nums">{qty.toFixed(4)}</Td>
                        <Td className="text-right tabular-nums">{formatMoneyMt(unitPriceBeforeTax)}</Td>
                        <Td className="text-right tabular-nums">
                          {`${formatMoneyMt(unitTaxAmount)} (${DEFAULT_TAX_RATE_LABEL})`}
                        </Td>
                        <Td className="text-right tabular-nums">{formatMoneyMt(unitPriceWithTax)}</Td>
                        <Td className="text-right tabular-nums">{formatMoneyMt(unitPriceWithTax * qty)}</Td>
                        <Td className="text-right tabular-nums">{formatMoneyMt(discount)}</Td>
                        <Td className="text-right tabular-nums font-semibold">{formatMoneyMt(rowTotal)}</Td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between border-t border-zinc-800 bg-[#1a1a1a] px-4 py-3">
        <div className="text-xs text-zinc-400 space-y-0.5">
          <div>
            Contagem de documentos: <span className="font-semibold text-zinc-200">{filteredSales.length}</span>
          </div>
          <div>
            Valor total: <span className="font-semibold text-zinc-100">{formatMoneyMt(totalValue)}</span>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="min-w-[120px] rounded bg-red-600 px-6 py-2.5 text-sm font-bold text-white transition-colors hover:bg-red-500"
        >
          Fechar
        </button>
      </div>

      {isPeriodModalOpen && (
        <div
          className="fixed inset-0 z-[110] flex items-center justify-center bg-black/70 p-6 backdrop-blur-[2px]"
          onClick={() => setIsPeriodModalOpen(false)}
        >
          <div
            className="w-full max-w-[820px] overflow-hidden rounded border border-zinc-700 bg-[#1f1f1f] shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-6 py-5 text-center">
              <h3 className="text-[18px] text-white">Período</h3>
              <div className="mt-4 inline-flex items-center rounded border border-zinc-700 bg-[#1a1a1a] px-4 py-2 font-bold text-white">
                {formatInputDateLabel(tempDateFrom)} — {formatInputDateLabel(tempDateTo)}
              </div>
            </div>
            <div className="grid grid-cols-1 gap-6 p-6 md:grid-cols-[1fr_1fr_280px]">
              <PeriodCalendar
                title="Início"
                monthValue={calendarStartMonth}
                selectedValue={tempDateFrom}
                onSelect={(value) => {
                  setActivePreset(null);
                  setTempDateFrom(value);
                }}
                onPrev={() => setCalendarStartMonth(shiftMonth(calendarStartMonth, -1))}
                onNext={() => setCalendarStartMonth(shiftMonth(calendarStartMonth, 1))}
              />
              <PeriodCalendar
                title="Fim"
                monthValue={calendarEndMonth}
                selectedValue={tempDateTo}
                onSelect={(value) => {
                  setActivePreset(null);
                  setTempDateTo(value);
                }}
                onPrev={() => setCalendarEndMonth(shiftMonth(calendarEndMonth, -1))}
                onNext={() => setCalendarEndMonth(shiftMonth(calendarEndMonth, 1))}
              />
              <div>
                <p className="mb-3 text-center text-sm text-zinc-100">Período pré-definido</p>
                <div className="grid grid-cols-2 gap-2">
                  <PresetButton label="Hoje" active={activePreset === 'today'} onClick={() => applyPresetPeriod('today')} />
                  <PresetButton label="Ontem" active={activePreset === 'yesterday'} onClick={() => applyPresetPeriod('yesterday')} />
                  <PresetButton label="Esta semana" active={activePreset === 'thisWeek'} onClick={() => applyPresetPeriod('thisWeek')} />
                  <PresetButton label="Semana passada" active={activePreset === 'lastWeek'} onClick={() => applyPresetPeriod('lastWeek')} />
                  <PresetButton label="Este mês" active={activePreset === 'thisMonth'} onClick={() => applyPresetPeriod('thisMonth')} />
                  <PresetButton label="Mês passado" active={activePreset === 'lastMonth'} onClick={() => applyPresetPeriod('lastMonth')} />
                  <PresetButton label="Este ano" active={activePreset === 'thisYear'} onClick={() => applyPresetPeriod('thisYear')} />
                  <PresetButton label="Ano passado" active={activePreset === 'lastYear'} onClick={() => applyPresetPeriod('lastYear')} />
                </div>
                <div className="mt-5 grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={applyPeriod}
                    disabled={tempDateFrom > tempDateTo}
                    className="flex min-h-11 items-center justify-center gap-2 rounded border border-[#0001fb] bg-[#0001fb] px-3 py-3 text-sm text-white transition-colors hover:bg-[#1a1bff] disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <Check size={16} />
                    <span className="text-sm">OK</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsPeriodModalOpen(false)}
                    className="flex min-h-11 items-center justify-center gap-2 rounded border border-zinc-700 bg-[#131314] px-3 py-3 text-sm text-white transition-colors hover:bg-[var(--pos-brand-hover-bg)] hover:text-[#0001fb]"
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

      <ConfirmDialog
        isOpen={isAnularConfirmOpen}
        title="Anular VD"
        message={
          <>
            <p>
              Anular a venda a dinheiro{' '}
              <span className="font-semibold text-white">
                {String(selectedSale?.document_number ?? selectedSale?.id ?? '').trim()}
              </span>
              ?
            </p>
            <p className="text-zinc-400">O stock dos produtos será devolvido ao armazém.</p>
          </>
        }
        confirmLabel="Anular"
        cancelLabel="Cancelar"
        tone="danger"
        icon={<Ban size={22} />}
        onCancel={() => setIsAnularConfirmOpen(false)}
        onConfirm={() => void handleAnularVd()}
      />
    </div>
  );
}

function Th({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <th
      className={`border-b border-r border-zinc-700/80 px-3 py-2 text-left font-medium whitespace-nowrap last:border-r-0 ${className}`}
    >
      {children}
    </th>
  );
}

function Td({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <td className={`border-r border-zinc-800/80 px-3 py-2 whitespace-nowrap last:border-r-0 ${className}`}>{children}</td>;
}

function PresetButton({
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
      className={`min-h-11 rounded border px-3 py-3 text-sm transition-colors ${
        active
          ? 'border-[#0001fb]/40 bg-[var(--pos-brand-selected-bg)] text-white'
          : 'border-zinc-700 bg-[#1a1a1a] text-white hover:bg-[var(--pos-brand-hover-bg)] hover:text-[#0001fb]'
      }`}
    >
      {label}
    </button>
  );
}

function PeriodCalendar({
  title,
  monthValue,
  selectedValue,
  onSelect,
  onPrev,
  onNext,
}: {
  title: string;
  monthValue: string;
  selectedValue: string;
  onSelect: (value: string) => void;
  onPrev: () => void;
  onNext: () => void;
}) {
  return (
    <div>
      <p className="mb-3 text-center text-sm text-zinc-100">{title}</p>
      <div className="mx-auto max-w-[260px] rounded border border-zinc-700 bg-[#1a1a1a] p-4">
        <div className="flex items-center justify-between px-1 pb-4">
          <button type="button" onClick={onPrev} className="rounded p-1 text-zinc-300 transition-colors hover:text-[#0001fb] focus-visible:outline-none">
            <ChevronLeft size={16} />
          </button>
          <div className="font-bold text-white">{monthLabel(monthValue)}</div>
          <button type="button" onClick={onNext} className="rounded p-1 text-zinc-300 transition-colors hover:text-[#0001fb] focus-visible:outline-none">
            <ChevronRight size={16} />
          </button>
        </div>
        <CalendarGrid monthValue={monthValue} selectedValue={selectedValue} onSelect={onSelect} />
      </div>
    </div>
  );
}

function CalendarGrid({
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
  const todayValue = todayInput();

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
              className={`flex aspect-square w-full min-w-0 items-center justify-center rounded-xl text-sm transition-colors ${
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
