'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Archive,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  FileSpreadsheet,
  FileText,
  Printer,
  RefreshCcw,
  Search,
  X,
} from 'lucide-react';
import { getPosApiBase, getPosUserAuthHeaders } from '@/lib/apiBase';
import { unwrapApiSuccessPayload } from '@/lib/apiResponse';
import { formatPaymentMethodLabel } from '@/lib/paymentMethodLabel';
import {
  REPORT_DEFINITIONS,
  buildReport,
  type BuiltReport,
  type ReportDefinition,
  type ReportKey,
} from '@/lib/reports/reportEngine';
import PosSelect from '@/components/PosSelect';

async function fetchLocalJson(path: string) {
  const response = await fetch(`${getPosApiBase()}${path}`, {
    headers: {
      ...getPosUserAuthHeaders(),
    },
  });
  if (!response.ok) {
    throw new Error(`Falha ao carregar dados locais (${response.status})`);
  }
  return unwrapApiSuccessPayload(await response.json());
}

function toArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

type ReportRow = Record<string, string | number | null>;

interface CustomerOption {
  id: string;
  name: string;
}

interface PartyOption {
  id: string;
  name: string;
  ids?: string[];
}

interface CategoryOption {
  id: string;
  name: string;
}

interface ProductOption {
  id: string;
  name: string;
  category_id?: string | null;
}

interface SummaryCard {
  label: string;
  value: string;
}

const mtCurrencyFormatter = new Intl.NumberFormat('pt-PT', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Nome do produto no rodapé dos relatórios. */
const REPORT_SYSTEM_NAME = 'POSly';

const TENANT_FOOTER_CACHE_KEY = 'pos:tenant-footer-cache';

function readCachedStoreName(): string {
  try {
    const raw = sessionStorage.getItem(TENANT_FOOTER_CACHE_KEY);
    if (!raw) return '';
    const parsed = JSON.parse(raw) as { name?: string };
    return String(parsed?.name ?? '').trim();
  } catch {
    return '';
  }
}

const dateFormatter = new Intl.DateTimeFormat('pt-PT', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

function formatCurrency(value: number) {
  return `${mtCurrencyFormatter.format(value)} MT`;
}

function formatDate(value: string | null | undefined) {
  if (!value) return '-';
  return dateFormatter.format(new Date(value));
}

function todayInputValue() {
  return new Date().toISOString().slice(0, 10);
}

function firstDayOfMonthInputValue() {
  const date = new Date();
  return new Date(date.getFullYear(), date.getMonth(), 1).toISOString().slice(0, 10);
}

function toInputDate(date: Date) {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
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

function buildCsv(columns: string[], rows: ReportRow[]) {
  const neutralize = (value: string) => {
    const text = String(value ?? '');
    // Evita fórmula Excel/Sheets injectada via nome de cliente (=, +, -, @, tab).
    if (/^[=+\-@\t\r]/.test(text)) return `'${text}`;
    return text;
  };
  const header = columns.join(',');
  const body = rows.map((row) =>
    columns.map((column) => `"${neutralize(String(row[column] ?? '')).replace(/"/g, '""')}"`).join(',')
  );
  return [header, ...body].join('\n');
}

function downloadFile(filename: string, content: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function renderPrintWindow(title: string, html: string) {
  const printWindow = window.open('', '_blank', 'width=1200,height=900');
  if (!printWindow) return false;

  printWindow.document.write(`
    <html>
      <head>
        <title>${title}</title>
        <style>
          * { box-sizing: border-box; }
          body { margin: 0; font-family: "Segoe UI", Arial, sans-serif; background: #e5e7eb; color: #111827; }
          .report-print-root {
            width: 297mm;
            min-height: 210mm;
            margin: 0 auto;
            padding: 10mm 12mm;
            background: white;
            display: flex;
            flex-direction: column;
          }
          .report-sheet-body { flex: 1; }
          .report-meta-grid {
            display: grid;
            grid-template-columns: repeat(4, minmax(0, 1fr));
            gap: 10px 18px;
          }
          .report-meta-item { font-size: 12px; line-height: 1.4; }
          .report-meta-label { font-weight: 700; }
          .report-summary-grid {
            display: grid;
            grid-template-columns: repeat(3, minmax(0, 1fr));
            gap: 10px;
          }
          .report-summary-card {
            border: 1px solid #d4d4d8;
            background: #f6f6f6;
            padding: 9px 12px;
          }
          .report-summary-label {
            font-size: 10px;
            text-transform: uppercase;
            letter-spacing: 0.08em;
            color: #71717a;
          }
          .report-summary-value { font-size: 16px; font-weight: 700; margin-top: 4px; }
          .report-table-wrap { overflow: hidden; }
          table { width: 100%; border-collapse: separate; border-spacing: 0; font-size: 11px; table-layout: fixed; }
          th {
            background: #c8c8c8;
            padding: 7px 8px;
            text-align: center;
            font-weight: 700;
            border-right: 2px solid white;
            white-space: nowrap;
          }
          th:last-child { border-right: 0; }
          td {
            padding: 7px 8px;
            border-bottom: 1px solid #e4e4e7;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
          }
          tbody tr:nth-child(even) td { background: #cfcfcf; }
          .report-cell-right { text-align: right; }
          .report-cell-center { text-align: center; }
          .report-total-row td {
            background: #d6bc86 !important;
            font-weight: 700;
            border-bottom: 0;
          }
          .report-footer {
            margin-top: auto;
            padding-top: 18px;
            display: grid;
            grid-template-columns: 1fr 1fr 80px;
            align-items: end;
            gap: 12px;
            font-size: 11px;
            color: #111827;
          }
          .report-footer-center { text-align: center; }
          .report-footer-right { text-align: right; }
          @media print {
            body { background: white; }
            .report-print-root { width: auto; min-height: auto; margin: 0; padding: 0; }
            @page { size: A4 landscape; margin: 10mm; }
          }
        </style>
      </head>
      <body>${html}</body>
    </html>
  `);
  printWindow.document.close();
  printWindow.focus();
  setTimeout(() => {
    printWindow.print();
  }, 250);
  return true;
}

function isNumericLike(value: string | number | null | undefined) {
  if (typeof value === 'number') return true;
  if (typeof value !== 'string') return false;

  const normalized = value.replace(/\s/g, '').replace(/[.,](?=\d{3}(?:\D|$))/g, '').replace(',', '.');
  return /^-?\d+(?:\.\d+)?(?:MT)?$/i.test(normalized);
}

function getColumnAlignment(column: string, value: string | number | null | undefined) {
  const normalizedColumn = column.toLowerCase();

  if (
    normalizedColumn.includes('data') ||
    normalizedColumn.includes('estado') ||
    normalizedColumn.includes('mesa') ||
    normalizedColumn.includes('loja') ||
    normalizedColumn.includes('grupo') ||
    normalizedColumn.includes('cliente')
  ) {
    return 'left';
  }

  if (
    normalizedColumn.includes('código') ||
    normalizedColumn.includes('codigo') ||
    normalizedColumn.includes('qtd') ||
    normalizedColumn.includes('stock') ||
    normalizedColumn.includes('pedido') ||
    normalizedColumn.includes('pontos')
  ) {
    return 'center';
  }

  if (
    normalizedColumn.includes('preço') ||
    normalizedColumn.includes('preco') ||
    normalizedColumn.includes('custo') ||
    normalizedColumn.includes('valor') ||
    normalizedColumn.includes('imposto') ||
    normalizedColumn.includes('desconto') ||
    normalizedColumn.includes('subtotal') ||
    normalizedColumn.includes('total')
  ) {
    return 'right';
  }

  return isNumericLike(value) ? 'right' : 'left';
}

function getAlignmentClass(alignment: 'left' | 'center' | 'right') {
  if (alignment === 'center') return 'text-center report-cell-center';
  if (alignment === 'right') return 'text-right report-cell-right';
  return 'text-left';
}

export default function ReportsManager() {
  const reportPreviewRef = useRef<HTMLDivElement | null>(null);
  const [loading, setLoading] = useState(true);
  const [runningReport, setRunningReport] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedReport, setSelectedReport] = useState<ReportKey | null>(null);
  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [statementCustomers, setStatementCustomers] = useState<PartyOption[]>([]);
  const [suppliers, setSuppliers] = useState<PartyOption[]>([]);
  const [categories, setCategories] = useState<CategoryOption[]>([]);
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<string[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState('all');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [selectedProduct, setSelectedProduct] = useState('all');
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState('all');
  const [selectedStatus, setSelectedStatus] = useState('all');
  const [dateFrom, setDateFrom] = useState(firstDayOfMonthInputValue());
  const [dateTo, setDateTo] = useState(todayInputValue());
  const [tempDateFrom, setTempDateFrom] = useState(firstDayOfMonthInputValue());
  const [tempDateTo, setTempDateTo] = useState(todayInputValue());
  const [calendarStartMonth, setCalendarStartMonth] = useState(firstDayOfMonthInputValue());
  const [calendarEndMonth, setCalendarEndMonth] = useState(firstDayOfMonthInputValue());
  const [builtReport, setBuiltReport] = useState<BuiltReport | null>(null);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [isPeriodModalOpen, setIsPeriodModalOpen] = useState(false);
  const [activePreset, setActivePreset] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [storeName, setStoreName] = useState(() => readCachedStoreName() || 'Loja');

  useEffect(() => {
    let cancelled = false;
    const loadStoreName = async () => {
      try {
        const data = await fetchLocalJson('/tenant/info');
        const name = String((data as { name?: string })?.name ?? '').trim();
        if (!cancelled && name) setStoreName(name);
      } catch {
        /* mantém cache / fallback */
      }
    };
    void loadStoreName();
    return () => {
      cancelled = true;
    };
  }, []);

  const filteredReports = useMemo(() => {
    const normalized = searchQuery.trim().toLowerCase();
    if (!normalized) return REPORT_DEFINITIONS;

    return REPORT_DEFINITIONS.filter((report) =>
      `${report.title} ${report.section} ${report.description}`.toLowerCase().includes(normalized)
    );
  }, [searchQuery]);

  const groupedReports = useMemo(() => {
    return (['Vendas', 'Documentos Fiscais', 'Financeiro', 'Cadastros', 'Stock'] as ReportDefinition['section'][])
      .map((section) => ({
        section,
        items: filteredReports.filter((report) => report.section === section),
      }))
      .filter((group) => group.items.length > 0);
  }, [filteredReports]);

  const filteredProducts = useMemo(() => {
    if (selectedCategory === 'all') return products;
    return products.filter((product) => product.category_id === selectedCategory);
  }, [products, selectedCategory]);

  const resolvePartyOptions = (reportKey: ReportKey | null): PartyOption[] => {
    if (reportKey === 'supplier_statement') return suppliers;
    if (reportKey === 'customer_statement') return statementCustomers.length ? statementCustomers : customers;
    return customers;
  };

  const partyLabel =
    selectedReport === 'supplier_statement'
      ? 'Fornecedor'
      : selectedReport === 'customer_statement'
        ? 'Cliente'
        : 'Cliente / Fornecedor';

  const partyOptions = useMemo<PartyOption[]>(
    () => resolvePartyOptions(selectedReport),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [customers, selectedReport, statementCustomers, suppliers],
  );

  useEffect(() => {
    if (selectedCustomer === 'all') return;
    if (!partyOptions.some((party) => party.id === selectedCustomer)) {
      setSelectedCustomer('all');
    }
  }, [partyOptions, selectedCustomer]);

  useEffect(() => {
    if (!filteredProducts.some((product) => product.id === selectedProduct)) {
      setSelectedProduct('all');
    }
  }, [filteredProducts, selectedProduct]);

  useEffect(() => {
    if (!isPreviewOpen) return;

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsPreviewOpen(false);
      }
    };

    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [isPreviewOpen]);

  useEffect(() => {
    if (!isPeriodModalOpen) return;

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsPeriodModalOpen(false);
      }
    };

    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [isPeriodModalOpen]);

  const fetchOptions = async () => {
    setLoading(true);
    setErrorMessage('');

    try {
      const [
        reportFiltersRaw,
        localCategories,
        localProducts,
      ] = await Promise.all([
        fetchLocalJson('/reports/filters'),
        fetchLocalJson('/categorias'),
        fetchLocalJson('/produtos'),
      ]);
      const reportFilters = reportFiltersRaw as {
        customers?: CustomerOption[];
        statementCustomers?: PartyOption[];
        suppliers?: PartyOption[];
        paymentMethods?: string[];
      };

      setCustomers(toArray<CustomerOption>(reportFilters?.customers));
      setStatementCustomers(toArray<PartyOption>(reportFilters?.statementCustomers));
      setSuppliers(toArray<PartyOption>(reportFilters?.suppliers));
      setCategories(toArray<CategoryOption>(localCategories));
      setProducts(toArray<ProductOption>(localProducts));
      setPaymentMethods(toArray<string>(reportFilters?.paymentMethods));
    } catch (error: any) {
      console.error('Error fetching report filters:', error);
      setErrorMessage(error.message || 'Não foi possível carregar os filtros dos relatórios.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchOptions();
  }, []);

  const buildMeta = (title: string) => {
    const customerName =
      selectedCustomer === 'all'
        ? 'Todos'
        : partyOptions.find((party) => party.id === selectedCustomer)?.name || partyLabel;
    const categoryName =
      selectedCategory === 'all'
        ? 'Todos'
        : categories.find((category) => category.id === selectedCategory)?.name || 'Grupo';
    const productName =
      selectedProduct === 'all'
        ? 'Todos'
        : products.find((product) => product.id === selectedProduct)?.name || 'Produto';

    return {
      title,
      meta: [
        { label: 'Período', value: `${dateFrom} até ${dateTo}` },
        { label: partyLabel, value: customerName },
        { label: 'Grupo', value: categoryName },
        { label: 'Produto', value: productName },
        { label: 'Pagamento', value: selectedPaymentMethod === 'all' ? 'Todos' : formatPaymentMethodLabel(selectedPaymentMethod, selectedPaymentMethod) },
        { label: 'Estado', value: selectedStatus === 'all' ? 'Concluídas / Aprovadas' : selectedStatus },
      ],
    };
  };

  const openPeriodModal = () => {
    setTempDateFrom(dateFrom);
    setTempDateTo(dateTo);
    setCalendarStartMonth(`${dateFrom.slice(0, 7)}-01`);
    setCalendarEndMonth(`${dateTo.slice(0, 7)}-01`);
    setIsPeriodModalOpen(true);
  };

  const applyPeriod = () => {
    setDateFrom(tempDateFrom);
    setDateTo(tempDateTo);
    setIsPeriodModalOpen(false);
  };

  const applyPresetPeriod = (preset: 'today' | 'yesterday' | 'thisWeek' | 'lastWeek' | 'thisMonth' | 'lastMonth' | 'thisYear' | 'lastYear') => {
    const now = new Date();
    let start = new Date(now);
    let end = new Date(now);

    if (preset === 'today') {
      start = new Date(now);
      end = new Date(now);
    }

    if (preset === 'yesterday') {
      start = new Date(now);
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

    setTempDateFrom(startInput);
    setTempDateTo(endInput);
    setCalendarStartMonth(`${startInput.slice(0, 7)}-01`);
    setCalendarEndMonth(`${endInput.slice(0, 7)}-01`);
    setActivePreset(preset);
  };

  const runReport = async (reportKey = selectedReport, openPreview = false) => {
    setRunningReport(true);
    setErrorMessage('');

    try {
      if (!reportKey) {
        throw new Error('Selecione um relatório antes de continuar.');
      }

      if (dateFrom > dateTo) {
        throw new Error('A data inicial não pode ser maior do que a data final.');
      }

      const availableParties = resolvePartyOptions(reportKey);
      const selectedParty = availableParties.find((party) => party.id === selectedCustomer);
      const effectiveCustomer = selectedCustomer !== 'all' && !selectedParty ? 'all' : selectedCustomer;

      const nextReport = await buildReport(reportKey, {
        dateFrom,
        dateTo,
        selectedCustomer: effectiveCustomer,
        selectedCustomerIds: selectedParty?.ids?.length ? selectedParty.ids : undefined,
        selectedStatus,
        selectedPaymentMethod,
        selectedCategory,
        selectedProduct,
        fetchJson: fetchLocalJson,
        buildMeta,
      });

      setBuiltReport(nextReport);
      setSelectedReport(reportKey);
      if (openPreview) {
        setIsPreviewOpen(true);
      }
    } catch (error: any) {
      console.error('Error building report:', error);
      setErrorMessage(error.message || 'Não foi possível gerar o relatório.');
    } finally {
      setRunningReport(false);
    }
  };

  const handlePrint = () => {
    if (!builtReport || !reportPreviewRef.current) return;
    renderPrintWindow(builtReport.title, reportPreviewRef.current.outerHTML);
  };

  const handlePdf = () => {
    if (!builtReport || !reportPreviewRef.current) return;
    renderPrintWindow(`${builtReport.title} - PDF`, reportPreviewRef.current.outerHTML);
  };

  const handleExcel = () => {
    if (!builtReport) return;
    const csv = buildCsv(builtReport.columns, builtReport.rows);
    downloadFile(`${builtReport.title.toLowerCase().replace(/\s+/g, '-')}.csv`, csv, 'text/csv;charset=utf-8;');
  };

  const previewDate = formatDate(new Date().toISOString());
  const totalSummary =
    builtReport?.summaries.find((item) => item.label.toLowerCase().includes('total')) || builtReport?.summaries.at(-1) || null;

  return (
    <>
      <div className="flex h-full bg-[#1a1a1a] text-zinc-200 overflow-hidden">
        <div className="flex-1 min-w-0 border-r border-zinc-800/50 flex flex-col bg-[#1a1a1a]">
          <div className="h-14 px-4 flex items-center bg-[#1a1a1a] border-b border-zinc-800">
            <div className="flex items-center gap-3 px-3 text-zinc-500 border-r border-zinc-800">
              <Search size={18} />
            </div>
            <div className="flex-1 relative">
              <input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Procurar relatorio"
                className="w-full bg-transparent py-2 px-2 outline-none text-sm text-zinc-200 placeholder:text-zinc-600"
              />
            </div>
          </div>

          <div
            className="flex-1 overflow-y-auto px-4 py-4 custom-scrollbar"
            onClick={() => {
              setSelectedReport(null);
              setBuiltReport(null);
              setIsPreviewOpen(false);
            }}
          >
            {groupedReports.map((group) => (
              <div key={group.section} className="mb-6">
                <div className="flex items-center gap-2 mb-3">
                  <h3 className="text-[15px] font-bold text-white">{group.section}</h3>
                  <div className="flex-1 h-px bg-zinc-800" />
                </div>

                <div className="space-y-1">
                  {group.items.map((report) => (
                    <button
                      key={report.key}
                      onClick={(event) => {
                        event.stopPropagation();
                        setSelectedReport(report.key);
                        void runReport(report.key, false);
                      }}
                      className={`w-full flex items-start gap-3 px-3 py-3 text-left border rounded transition-colors ${
                        selectedReport === report.key
                          ? 'bg-[var(--pos-brand-selected-bg)] border-[#0001fb]/40 text-white'
                          : 'border-transparent bg-transparent text-zinc-300 hover:bg-[var(--pos-brand-hover-bg)]'
                      }`}
                    >
                      <div className="mt-0.5 text-zinc-400">
                        <Archive size={16} />
                      </div>
                      <div>
                        <div className="text-sm font-bold">{report.title}</div>
                        <div className="text-xs text-zinc-500 mt-0.5">{report.description}</div>
                      </div>
                    </button>
                  ))}

                  {group.items.length === 0 && (
                    <div className="px-3 py-3 text-sm text-zinc-600 italic">Nenhum relatório encontrado.</div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        <aside className="w-[340px] shrink-0 bg-[#1a1a1a] flex flex-col">
          <div className="px-4 py-4 border-b border-zinc-800/50">
            <h3 className="text-xl md:text-[22px] leading-none text-white">Filtro</h3>
          </div>

          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4 custom-scrollbar">
            <FilterSelect
              label={partyLabel}
              value={selectedCustomer}
              onChange={setSelectedCustomer}
              options={[
                { value: 'all', label: 'Todos' },
                ...partyOptions.map((item) => ({ value: item.id, label: item.name })),
              ]}
            />

            <FilterSelect
              label="Método de pagamento"
              value={selectedPaymentMethod}
              onChange={setSelectedPaymentMethod}
              options={[{ value: 'all', label: 'Todos' }, ...paymentMethods.map((item) => ({ value: item, label: formatPaymentMethodLabel(item, item) }))]}
            />

            <FilterSelect
              label="Estado"
              value={selectedStatus}
              onChange={setSelectedStatus}
              options={[
                { value: 'all', label: 'Todos' },
                { value: 'completed', label: 'Pago / Concluído' },
                { value: 'approved', label: 'Aprovado' },
                { value: 'pending', label: 'Pendente' },
                { value: 'cancelled', label: 'Cancelado' },
              ]}
            />

            <FilterSelect
              label="Produto"
              value={selectedProduct}
              onChange={setSelectedProduct}
              options={[{ value: 'all', label: 'Todos' }, ...filteredProducts.map((item) => ({ value: item.id, label: item.name }))]}
            />

            <FilterSelect
              label="Grupo de produto"
              value={selectedCategory}
              onChange={setSelectedCategory}
              options={[{ value: 'all', label: 'Todos' }, ...categories.map((item) => ({ value: item.id, label: item.name }))]}
            />

            <div>
              <label className="block text-sm font-medium text-zinc-100 mb-2">Período</label>
              <button
                onClick={openPeriodModal}
                className="pos-select-trigger h-auto w-full gap-3 px-4 py-3 text-left"
              >
                <CalendarDays size={16} className="shrink-0 text-zinc-300" />
                <span className="flex-1 text-center text-sm text-white">
                  {formatDate(dateFrom)} - {formatDate(dateTo)}
                </span>
              </button>
            </div>

            {errorMessage && (
              <div className="border border-rose-500/30 bg-rose-950/30 px-3 py-3 text-sm text-rose-200 rounded-sm">
                {errorMessage}
              </div>
            )}
          </div>

          <div className="p-4 border-t border-zinc-800/50 space-y-2 no-print">
            <div className="grid grid-cols-2 gap-2">
              <ActionButton
                icon={<RefreshCcw size={18} />}
                label={runningReport ? 'Gerando...' : 'Exibir relatório'}
                onClick={() => void runReport(selectedReport, true)}
                disabled={loading || runningReport || !selectedReport}
                primary
              />
              <ActionButton
                icon={<Printer size={18} />}
                label="Imprimir"
                onClick={handlePrint}
                disabled={!builtReport || runningReport}
              />
              <ActionButton
                icon={<FileSpreadsheet size={18} />}
                label="Excel"
                onClick={handleExcel}
                disabled={!builtReport || runningReport}
              />
              <ActionButton
                icon={<FileText size={18} />}
                label="PDF"
                onClick={handlePdf}
                disabled={!builtReport || runningReport}
              />
            </div>
          </div>
        </aside>
      </div>

      {isPreviewOpen && builtReport && (
        <div
          className="fixed inset-0 z-50 bg-black/70 backdrop-blur-[2px] flex items-center justify-center p-6"
          onClick={() => setIsPreviewOpen(false)}
        >
          <div
            className="w-full max-w-[1500px] max-h-[92vh] bg-[#111] border border-zinc-800 rounded shadow-2xl overflow-hidden"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="h-14 border-b border-zinc-800 px-4 flex items-center justify-between bg-[#141414]">
              <div>
                <h3 className="text-base font-bold text-white">{builtReport.title}</h3>
                <p className="text-xs text-zinc-500">Pré-visualização em A4 horizontal</p>
              </div>
              <div className="flex items-center gap-2">
                <ActionButton icon={<Printer size={16} />} label="Imprimir" onClick={handlePrint} />
                <button
                  onClick={() => setIsPreviewOpen(false)}
                  className="h-11 w-11 flex items-center justify-center border border-zinc-700 rounded bg-[#202020] hover:bg-zinc-800 hover:border-[#0001fb] transition-colors text-zinc-200"
                  aria-label="Fechar pré-visualização"
                >
                  <X size={18} />
                </button>
              </div>
            </div>

            <div className="max-h-[calc(92vh-56px)] overflow-auto custom-scrollbar bg-[#1a1a1a] p-6">
              <div
                ref={reportPreviewRef}
                className="report-print-root mx-auto bg-white text-black shadow-2xl"
                style={{ width: '297mm', minHeight: '210mm', padding: '10mm 12mm', display: 'flex', flexDirection: 'column' }}
              >
                <div className="report-sheet-body flex-1">
                  <div className="flex items-start justify-between mb-6">
                    <div className="pt-5">
                      <h1 className="text-[18px] font-semibold">{builtReport.title}</h1>
                      <p className="text-[12px] text-zinc-600 mt-1">{builtReport.subtitle}</p>
                    </div>
                    <div className="text-[12px] text-zinc-800 font-medium">{previewDate}</div>
                  </div>

                  <div className="report-meta-grid grid grid-cols-4 gap-x-5 gap-y-2 mb-5 text-[12px]">
                    {builtReport.meta.map((item) => (
                      <div key={item.label} className="report-meta-item">
                        <span className="report-meta-label font-semibold">{item.label}:</span>{' '}
                        <span>{item.value}</span>
                      </div>
                    ))}
                  </div>

                  <div className="report-summary-grid grid grid-cols-3 gap-3 mb-5">
                    {builtReport.summaries.map((item) => (
                      <div key={item.label} className="report-summary-card border border-zinc-200 bg-zinc-50 px-3 py-2">
                        <div className="report-summary-label text-[11px] uppercase tracking-[0.12em] text-zinc-500">{item.label}</div>
                        <div className="report-summary-value text-[16px] font-semibold mt-1">{item.value}</div>
                      </div>
                    ))}
                  </div>

                  <div className="report-table-wrap overflow-hidden">
                    <table className="w-full text-[11px]" style={{ tableLayout: 'fixed', borderCollapse: 'separate', borderSpacing: 0 }}>
                      <thead>
                        <tr className="bg-[#c8c8c8]">
                          {builtReport.columns.map((column) => (
                            <th key={column} className="px-2 py-2 text-center font-semibold whitespace-nowrap border-r-2 border-white last:border-r-0">
                              {column}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {builtReport.rows.length > 0 ? (
                          <>
                            {builtReport.rows.map((row, index) => {
                              const groupColumn = builtReport.groupBy;
                              const groupValue = groupColumn ? String(row[groupColumn] ?? '') : '';
                              const previousGroupValue =
                                groupColumn && index > 0
                                  ? String(builtReport.rows[index - 1]?.[groupColumn] ?? '')
                                  : '';
                              const startsGroup = Boolean(groupColumn && groupValue !== previousGroupValue);

                              return (
                                <React.Fragment key={`${builtReport.key}-${index}`}>
                                  {startsGroup ? (
                                    <tr className="bg-zinc-700 text-white">
                                      <td
                                        colSpan={builtReport.columns.length}
                                        className="px-3 py-2 font-bold text-left"
                                      >
                                        {groupColumn}: {groupValue}
                                      </td>
                                    </tr>
                                  ) : null}
                                  <tr className={index % 2 === 0 ? 'bg-white' : 'bg-[#cfcfcf]'}>
                                    {builtReport.columns.map((column) => {
                                      const cellValue = row[column];
                                      const alignment = getColumnAlignment(column, cellValue);

                                      return (
                                        <td
                                          key={column}
                                          className={`${getAlignmentClass(alignment)} px-2 py-2 border-b border-zinc-200 align-top whitespace-nowrap overflow-hidden text-ellipsis`}
                                        >
                                          {String(cellValue ?? '-')}
                                        </td>
                                      );
                                    })}
                                  </tr>
                                </React.Fragment>
                              );
                            })}
                            {totalSummary ? (
                              <tr className="report-total-row">
                                <td colSpan={Math.max(1, builtReport.columns.length - 1)} className="px-2 py-2 text-right font-bold">
                                  Total :
                                </td>
                                <td className="px-2 py-2 text-right font-bold">{totalSummary.value}</td>
                              </tr>
                            ) : null}
                          </>
                        ) : (
                          <tr>
                            <td colSpan={builtReport.columns.length} className="px-3 py-8 text-center text-zinc-500">
                              Nenhum dado encontrado para os filtros selecionados.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="report-footer mt-auto pt-24 text-[11px] text-zinc-700 grid grid-cols-[1fr_1fr_80px] items-end gap-3">
                  <span>
                    {REPORT_SYSTEM_NAME} - Software de Gestão
                  </span>
                  <span className="text-center">Licenciado a: {storeName}</span>
                  <span className="text-right">1/1</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {isPeriodModalOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/70 backdrop-blur-[2px] flex items-center justify-center p-6"
          onClick={() => setIsPeriodModalOpen(false)}
        >
          <div
            className="w-full max-w-[820px] bg-[#1f1f1f] border border-zinc-700 rounded shadow-2xl overflow-hidden"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="px-6 py-5 text-center">
              <h3 className="text-[18px] text-white">Período</h3>
              <div className="mt-4 inline-flex items-center rounded border border-zinc-700 bg-[#1a1a1a] px-4 py-2 text-white font-bold">
                {formatDate(tempDateFrom)} - {formatDate(tempDateTo)}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_280px] gap-6 p-6">
              <div>
                <p className="text-sm text-zinc-100 mb-3 text-center">Início</p>
                <div className="mx-auto max-w-[260px] bg-[#1a1a1a] border border-zinc-700 rounded p-4">
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
                  <CalendarGrid
                    monthValue={calendarStartMonth}
                    selectedValue={tempDateFrom}
                    onSelect={(value) => {
                      setActivePreset(null);
                      setTempDateFrom(value);
                    }}
                  />
                </div>
              </div>

              <div>
                <p className="text-sm text-zinc-100 mb-3 text-center">Fim</p>
                <div className="mx-auto max-w-[260px] bg-[#1a1a1a] border border-zinc-700 rounded p-4">
                  <div className="flex items-center justify-between px-1 pb-4">
                    <button
                      type="button"
                      onClick={() => setCalendarEndMonth(shiftMonth(calendarEndMonth, -1))}
                      className="rounded p-1 text-zinc-300 transition-colors hover:text-[#0001fb] focus-visible:outline-none"
                    >
                      <ChevronLeft size={16} />
                    </button>
                    <div className="text-white font-bold">{monthLabel(calendarEndMonth)}</div>
                    <button
                      type="button"
                      onClick={() => setCalendarEndMonth(shiftMonth(calendarEndMonth, 1))}
                      className="rounded p-1 text-zinc-300 transition-colors hover:text-[#0001fb] focus-visible:outline-none"
                    >
                      <ChevronRight size={16} />
                    </button>
                  </div>
                  <CalendarGrid
                    monthValue={calendarEndMonth}
                    selectedValue={tempDateTo}
                    onSelect={(value) => {
                      setActivePreset(null);
                      setTempDateTo(value);
                    }}
                  />
                </div>
              </div>

              <div>
                <p className="text-sm text-zinc-100 mb-3 text-center">Período pré-definido</p>
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

                <div className="grid grid-cols-2 gap-2 mt-5">
                  <ActionButton
                    icon={<Check size={16} />}
                    label="OK"
                    onClick={applyPeriod}
                    primary
                    disabled={tempDateFrom > tempDateTo}
                  />
                  <ActionButton
                    icon={<X size={16} />}
                    label="Cancelar"
                    onClick={() => setIsPeriodModalOpen(false)}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <div>
      <label className="mb-2 block text-sm font-medium text-zinc-100">{label}</label>
      <PosSelect value={value} onChange={onChange} options={options} size="md" />
    </div>
  );
}

function ActionButton({
  icon,
  label,
  onClick,
  disabled,
  primary,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  primary?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex items-center justify-center gap-2 min-h-11 px-3 py-3 border rounded text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
        primary
          ? 'pos-on-accent border-[#0001fb] bg-[#0001fb] text-white hover:bg-[#1a1bff]'
          : 'border-zinc-600 bg-[var(--pos-field-bg)] text-zinc-200 hover:bg-[var(--pos-brand-hover-bg)] hover:text-[#0001fb]'
      }`}
    >
      {icon}
      <span className="text-sm">{label}</span>
    </button>
  );
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


