'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Archive,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  FileSpreadsheet,
  FileText,
  Printer,
  RefreshCcw,
  Search,
  X,
} from 'lucide-react';
import { supabase, isConfigured } from '@/lib/supabase';

import { getPosApiBase } from '@/lib/apiBase';

async function fetchLocalJson(path: string) {
  const response = await fetch(`${getPosApiBase()}${path}`);
  if (!response.ok) {
    throw new Error(`Falha ao carregar dados locais (${response.status})`);
  }
  return response.json();
}

type ReportKey =
  | 'products'
  | 'customers'
  | 'sales_by_day'
  | 'documents_by_customer'
  | 'invoice_list'
  | 'stock_movement';

type ReportRow = Record<string, string | number | null>;

interface ReportDefinition {
  key: ReportKey;
  title: string;
  section: 'Vendas' | 'Cadastros' | 'Estoque';
  description: string;
}

interface CustomerOption {
  id: string;
  name: string;
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

interface BuiltReport {
  key: ReportKey;
  title: string;
  subtitle: string;
  columns: string[];
  rows: ReportRow[];
  summaries: SummaryCard[];
  meta: Array<{ label: string; value: string }>;
}

const REPORT_DEFINITIONS: ReportDefinition[] = [
  { key: 'products', title: 'Produtos', section: 'Cadastros', description: 'Lista geral de produtos, preços, categoria e stock.' },
  { key: 'customers', title: 'Clientes', section: 'Cadastros', description: 'Relação de clientes com contactos e pontos acumulados.' },
  { key: 'sales_by_day', title: 'Vendas diárias', section: 'Vendas', description: 'Totais de vendas agrupados por dia no período escolhido.' },
  { key: 'documents_by_customer', title: 'Documentos por cliente', section: 'Vendas', description: 'Documentos emitidos para o cliente no período filtrado.' },
  { key: 'invoice_list', title: 'Lista de faturas', section: 'Vendas', description: 'Faturas/documentos emitidos com totais e pagamento.' },
  { key: 'stock_movement', title: 'Movimento de estoque', section: 'Estoque', description: 'Visão do stock atual, mínimo e valor do inventário.' },
];

const mtCurrencyFormatter = new Intl.NumberFormat('pt-PT', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

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

function buildCsv(columns: string[], rows: ReportRow[]) {
  const header = columns.join(',');
  const body = rows.map((row) =>
    columns.map((column) => `"${String(row[column] ?? '').replace(/"/g, '""')}"`).join(',')
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
  const [errorMessage, setErrorMessage] = useState('');

  const filteredReports = useMemo(() => {
    const normalized = searchQuery.trim().toLowerCase();
    if (!normalized) return REPORT_DEFINITIONS;

    return REPORT_DEFINITIONS.filter((report) =>
      `${report.title} ${report.section} ${report.description}`.toLowerCase().includes(normalized)
    );
  }, [searchQuery]);

  const groupedReports = useMemo(() => {
    return ['Vendas', 'Cadastros', 'Estoque'].map((section) => ({
      section: section as ReportDefinition['section'],
      items: filteredReports.filter((report) => report.section === section),
    }));
  }, [filteredReports]);

  const filteredProducts = useMemo(() => {
    if (selectedCategory === 'all') return products;
    return products.filter((product) => product.category_id === selectedCategory);
  }, [products, selectedCategory]);

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
      if (!isConfigured) {
        setLoading(false);
        return;
      }

      const [
        { data: customerData, error: customerError },
        localCategories,
        localProducts,
        { data: orderData, error: orderError },
      ] = await Promise.all([
        supabase.from('customers').select('id, name').order('name'),
        fetchLocalJson('/categorias'),
        fetchLocalJson('/produtos'),
        supabase.from('orders').select('payment_method'),
      ]);

      if (customerError) throw customerError;
      if (orderError) throw orderError;

      setCustomers(customerData || []);
      setCategories(localCategories || []);
      setProducts(localProducts || []);

      const methods = Array.from(
        new Set((orderData || []).map((item) => item.payment_method).filter(Boolean))
      ) as string[];
      setPaymentMethods(methods.sort((a, b) => a.localeCompare(b)));
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
        : customers.find((customer) => customer.id === selectedCustomer)?.name || 'Cliente';
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
        { label: 'Cliente', value: customerName },
        { label: 'Grupo', value: categoryName },
        { label: 'Produto', value: productName },
        { label: 'Pagamento', value: selectedPaymentMethod === 'all' ? 'Todos' : selectedPaymentMethod },
        { label: 'Estado', value: selectedStatus === 'all' ? 'Todos' : selectedStatus },
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
  };

  const runReport = async (reportKey = selectedReport, openPreview = false) => {
    setRunningReport(true);
    setErrorMessage('');

    try {
      if (!reportKey) {
        throw new Error('Selecione um relatório antes de continuar.');
      }

      if (!isConfigured) {
        throw new Error('Supabase não configurado. Configure a ligação para ativar os relatórios.');
      }

      if (dateFrom > dateTo) {
        throw new Error('A data inicial não pode ser maior do que a data final.');
      }

      let nextReport: BuiltReport | null = null;

      if (reportKey === 'products') {
        const localProducts = await fetchLocalJson('/produtos');
        const data = (localProducts || [])
          .filter((item: any) => (selectedCategory === 'all' ? true : String(item.category_id) === selectedCategory))
          .filter((item: any) => (selectedProduct === 'all' ? true : String(item.id) === selectedProduct))
          .sort((a: any, b: any) => String(a.name || '').localeCompare(String(b.name || '')));

        const rows = (data || []).map((item: any) => ({
          'Código': item.code ?? '-',
          Produto: item.name,
          Grupo: item.categories?.name || 'Sem grupo',
          'Preço': formatCurrency(Number(item.price || 0)),
          'Preço final': formatCurrency(Number(item.final_price || item.price || 0)),
          Stock: Number(item.stock_quantity || 0),
          Estado: item.active ? 'Ativo' : 'Inativo',
          Registo: formatDate(item.created_at),
        }));

        const totalStock = (data || []).reduce((sum: number, item: any) => sum + Number(item.stock_quantity || 0), 0);
        const activeCount = (data || []).filter((item: any) => item.active).length;
        const metaBlock = buildMeta('Produtos');

        nextReport = {
          key: reportKey,
          title: metaBlock.title,
          subtitle: 'Cadastro de produtos',
          columns: ['Código', 'Produto', 'Grupo', 'Preço', 'Preço final', 'Stock', 'Estado', 'Registo'],
          rows,
          summaries: [
            { label: 'Itens listados', value: String(rows.length) },
            { label: 'Produtos ativos', value: String(activeCount) },
            { label: 'Stock acumulado', value: String(totalStock) },
          ],
          meta: metaBlock.meta,
        };
      }

      if (reportKey === 'customers') {
        let query = supabase
          .from('customers')
          .select('name, phone, email, address, points, created_at')
          .order('name');

        if (selectedCustomer !== 'all') query = query.eq('id', selectedCustomer);

        const { data, error } = await query;
        if (error) throw error;

        const rows = (data || []).map((item: any) => ({
          Cliente: item.name,
          Telefone: item.phone || '-',
          Email: item.email || '-',
          'Endereço': item.address || '-',
          Pontos: Number(item.points || 0),
          Registo: formatDate(item.created_at),
        }));

        const totalPoints = (data || []).reduce((sum: number, item: any) => sum + Number(item.points || 0), 0);
        const metaBlock = buildMeta('Clientes');

        nextReport = {
          key: reportKey,
          title: metaBlock.title,
          subtitle: 'Cadastro de clientes',
          columns: ['Cliente', 'Telefone', 'Email', 'Endereço', 'Pontos', 'Registo'],
          rows,
          summaries: [
            { label: 'Clientes listados', value: String(rows.length) },
            { label: 'Pontos totais', value: String(totalPoints) },
          ],
          meta: metaBlock.meta,
        };
      }

      if (reportKey === 'sales_by_day') {
        let query = supabase
          .from('orders')
          .select('id, total, subtotal, tax, discount, payment_method, status, created_at')
          .gte('created_at', `${dateFrom}T00:00:00`)
          .lte('created_at', `${dateTo}T23:59:59`)
          .order('created_at');

        if (selectedStatus !== 'all') query = query.eq('status', selectedStatus);
        if (selectedPaymentMethod !== 'all') query = query.eq('payment_method', selectedPaymentMethod);

        const { data, error } = await query;
        if (error) throw error;

        const grouped = new Map<string, { orders: number; subtotal: number; tax: number; discount: number; total: number }>();

        (data || []).forEach((item: any) => {
          const key = item.created_at?.slice(0, 10) || '';
          const current = grouped.get(key) || { orders: 0, subtotal: 0, tax: 0, discount: 0, total: 0 };
          current.orders += 1;
          current.subtotal += Number(item.subtotal || 0);
          current.tax += Number(item.tax || 0);
          current.discount += Number(item.discount || 0);
          current.total += Number(item.total || 0);
          grouped.set(key, current);
        });

        const rows = Array.from(grouped.entries()).map(([date, item]) => ({
          Data: formatDate(date),
          Pedidos: item.orders,
          Subtotal: formatCurrency(item.subtotal),
          Imposto: formatCurrency(item.tax),
          Desconto: formatCurrency(item.discount),
          Total: formatCurrency(item.total),
        }));

        const orderCount = (data || []).length;
        const grandTotal = (data || []).reduce((sum: number, item: any) => sum + Number(item.total || 0), 0);
        const metaBlock = buildMeta('Vendas diárias');

        nextReport = {
          key: reportKey,
          title: metaBlock.title,
          subtitle: 'Resumo de vendas por dia',
          columns: ['Data', 'Pedidos', 'Subtotal', 'Imposto', 'Desconto', 'Total'],
          rows,
          summaries: [
            { label: 'Dias com vendas', value: String(rows.length) },
            { label: 'Pedidos emitidos', value: String(orderCount) },
            { label: 'Total vendido', value: formatCurrency(grandTotal) },
          ],
          meta: metaBlock.meta,
        };
      }

      if (reportKey === 'documents_by_customer') {
        let query = supabase
          .from('orders')
          .select('id, total, payment_method, status, created_at, table_number, customers(id, name)')
          .gte('created_at', `${dateFrom}T00:00:00`)
          .lte('created_at', `${dateTo}T23:59:59`)
          .order('created_at');

        if (selectedCustomer !== 'all') query = query.eq('customer_id', selectedCustomer);
        if (selectedStatus !== 'all') query = query.eq('status', selectedStatus);
        if (selectedPaymentMethod !== 'all') query = query.eq('payment_method', selectedPaymentMethod);

        const { data, error } = await query;
        if (error) throw error;

        const rows = (data || []).map((item: any, index: number) => ({
          Loja: '1',
          Data: formatDate(item.created_at),
          Documento: 'Venda',
          'Número': `DOC-${String(index + 1).padStart(5, '0')}`,
          Cliente: item.customers?.name || 'Consumidor final',
          Pagamento: item.payment_method || '-',
          Estado: item.status || '-',
          Mesa: item.table_number || '-',
          Total: formatCurrency(Number(item.total || 0)),
        }));

        const totalAmount = (data || []).reduce((sum: number, item: any) => sum + Number(item.total || 0), 0);
        const metaBlock = buildMeta('Documentos por cliente');

        nextReport = {
          key: reportKey,
          title: metaBlock.title,
          subtitle: 'Documentos emitidos por cliente',
          columns: ['Loja', 'Data', 'Documento', 'Número', 'Cliente', 'Pagamento', 'Estado', 'Mesa', 'Total'],
          rows,
          summaries: [
            { label: 'Documentos', value: String(rows.length) },
            { label: 'Total do período', value: formatCurrency(totalAmount) },
          ],
          meta: metaBlock.meta,
        };
      }

      if (reportKey === 'invoice_list') {
        let query = supabase
          .from('orders')
          .select('id, doc_type, document_number, total, subtotal, tax, discount, payment_method, status, created_at, customers(name)')
          .gte('created_at', `${dateFrom}T00:00:00`)
          .lte('created_at', `${dateTo}T23:59:59`)
          .order('created_at');

        if (selectedCustomer !== 'all') query = query.eq('customer_id', selectedCustomer);
        if (selectedStatus !== 'all') query = query.eq('status', selectedStatus);
        if (selectedPaymentMethod !== 'all') query = query.eq('payment_method', selectedPaymentMethod);

        const { data, error } = await query;
        if (error) throw error;

        const rows = (data || []).map((item: any, index: number) => ({
          'Número': item.document_number || `${item.doc_type || 'DOC'}-${String(index + 1).padStart(5, '0')}`,
          Data: formatDate(item.created_at),
          Cliente: item.customers?.name || 'Consumidor final',
          Pagamento: item.payment_method || '-',
          Subtotal: formatCurrency(Number(item.subtotal || 0)),
          Imposto: formatCurrency(Number(item.tax || 0)),
          Desconto: formatCurrency(Number(item.discount || 0)),
          Total: formatCurrency(Number(item.total || 0)),
          Estado: item.status || '-',
        }));

        const grandTotal = (data || []).reduce((sum: number, item: any) => sum + Number(item.total || 0), 0);
        const metaBlock = buildMeta('Lista de faturas');

        nextReport = {
          key: reportKey,
          title: metaBlock.title,
          subtitle: 'Faturas e documentos emitidos',
          columns: ['Número', 'Data', 'Cliente', 'Pagamento', 'Subtotal', 'Imposto', 'Desconto', 'Total', 'Estado'],
          rows,
          summaries: [
            { label: 'Documentos emitidos', value: String(rows.length) },
            { label: 'Faturação total', value: formatCurrency(grandTotal) },
          ],
          meta: metaBlock.meta,
        };
      }

      if (reportKey === 'stock_movement') {
        const localProducts = await fetchLocalJson('/produtos');
        const data = (localProducts || [])
          .filter((item: any) => (selectedCategory === 'all' ? true : String(item.category_id) === selectedCategory))
          .filter((item: any) => (selectedProduct === 'all' ? true : String(item.id) === selectedProduct))
          .sort((a: any, b: any) => String(a.name || '').localeCompare(String(b.name || '')));

        const rows = (data || []).map((item: any) => {
          const qty = Number(item.stock_quantity || 0);
          const cost = Number(item.cost || 0);
          const price = Number(item.final_price || item.price || 0);
          return {
            'Código': item.code ?? '-',
            Produto: item.name,
            Grupo: item.categories?.name || 'Sem grupo',
            'Stock atual': qty,
            'Stock mínimo': Number(item.min_stock || 0),
            'Custo unitário': formatCurrency(cost),
            'Preço venda': formatCurrency(price),
            'Valor em stock': formatCurrency(qty * cost),
            Atualizado: formatDate(item.updated_at),
          };
        });

        const inventoryCost = (data || []).reduce(
          (sum: number, item: any) => sum + Number(item.stock_quantity || 0) * Number(item.cost || 0),
          0
        );
        const lowStockCount = (data || []).filter(
          (item: any) => Number(item.stock_quantity || 0) <= Number(item.min_stock || 0)
        ).length;
        const metaBlock = buildMeta('Movimento de estoque');

        nextReport = {
          key: reportKey,
          title: metaBlock.title,
          subtitle: 'Posição atual do inventário',
          columns: ['Código', 'Produto', 'Grupo', 'Stock atual', 'Stock mínimo', 'Custo unitário', 'Preço venda', 'Valor em stock', 'Atualizado'],
          rows,
          summaries: [
            { label: 'Produtos listados', value: String(rows.length) },
            { label: 'Baixo stock', value: String(lowStockCount) },
            { label: 'Valor do inventário', value: formatCurrency(inventoryCost) },
          ],
          meta: metaBlock.meta,
        };
      }

      if (!nextReport) {
        throw new Error('Relatório não suportado.');
      }

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
                          ? 'bg-zinc-800/70 border-transparent text-white'
                          : 'bg-transparent border-transparent text-zinc-300 hover:bg-zinc-800/50 hover:border-zinc-800'
                      }`}
                    >
                      <div className="mt-0.5 text-zinc-400">
                        <Archive size={16} />
                      </div>
                      <div>
                        <div className="text-sm font-bold">{report.title}</div>
                        <div className="text-xs text-zinc-400 mt-0.5">{report.description}</div>
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
              label="Cliente"
              value={selectedCustomer}
              onChange={setSelectedCustomer}
              options={[{ value: 'all', label: 'Todos' }, ...customers.map((item) => ({ value: item.id, label: item.name }))]}
            />

            <FilterSelect
              label="Método de pagamento"
              value={selectedPaymentMethod}
              onChange={setSelectedPaymentMethod}
              options={[{ value: 'all', label: 'Todos' }, ...paymentMethods.map((item) => ({ value: item, label: item }))]}
            />

            <FilterSelect
              label="Estado"
              value={selectedStatus}
              onChange={setSelectedStatus}
              options={[
                { value: 'all', label: 'Todos' },
                { value: 'completed', label: 'Concluído' },
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
                className="w-full flex items-center gap-3 bg-[#131314] border border-zinc-700 rounded px-4 py-3 text-left text-white hover:bg-zinc-800 hover:border-zinc-600 transition-colors"
              >
                <CalendarDays size={16} className="text-zinc-300 shrink-0" />
                <span className="flex-1 text-center text-sm">{formatDate(dateFrom)} - {formatDate(dateTo)}</span>
              </button>
            </div>

            {errorMessage && (
              <div className="border border-rose-500/30 bg-rose-950/30 px-3 py-3 text-sm text-rose-200 rounded-sm">
                {errorMessage}
              </div>
            )}

            {!isConfigured && (
              <div className="border border-amber-500/30 bg-amber-950/20 px-3 py-3 text-sm text-amber-200 rounded-sm">
                Configure o Supabase para que os relatórios possam buscar dados do banco.
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
                  className="h-11 w-11 flex items-center justify-center border border-zinc-700 rounded bg-[#202020] hover:bg-zinc-800 hover:border-zinc-600 transition-colors text-zinc-200"
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
                            {builtReport.rows.map((row, index) => (
                              <tr key={`${builtReport.key}-${index}`} className={index % 2 === 0 ? 'bg-white' : 'bg-[#cfcfcf]'}>
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
                            ))}
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
                  <span>NINO POS - Software de Gestao</span>
                  <span className="text-center">Licenciado a: Cliente / Loja</span>
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
                      onClick={() => setCalendarStartMonth(shiftMonth(calendarStartMonth, -1))}
                      className="p-1 rounded text-zinc-300 hover:text-white hover:bg-zinc-800 transition-colors"
                    >
                      <ChevronLeft size={16} />
                    </button>
                    <div className="text-white font-bold">{monthLabel(calendarStartMonth)}</div>
                    <button
                      onClick={() => setCalendarStartMonth(shiftMonth(calendarStartMonth, 1))}
                      className="p-1 rounded text-zinc-300 hover:text-white hover:bg-zinc-800 transition-colors"
                    >
                      <ChevronRight size={16} />
                    </button>
                  </div>
                  <CalendarGrid
                    monthValue={calendarStartMonth}
                    selectedValue={tempDateFrom}
                    onSelect={setTempDateFrom}
                  />
                </div>
              </div>

              <div>
                <p className="text-sm text-zinc-100 mb-3 text-center">Fim</p>
                <div className="mx-auto max-w-[260px] bg-[#1a1a1a] border border-zinc-700 rounded p-4">
                  <div className="flex items-center justify-between px-1 pb-4">
                    <button
                      onClick={() => setCalendarEndMonth(shiftMonth(calendarEndMonth, -1))}
                      className="p-1 rounded text-zinc-300 hover:text-white hover:bg-zinc-800 transition-colors"
                    >
                      <ChevronLeft size={16} />
                    </button>
                    <div className="text-white font-bold">{monthLabel(calendarEndMonth)}</div>
                    <button
                      onClick={() => setCalendarEndMonth(shiftMonth(calendarEndMonth, 1))}
                      className="p-1 rounded text-zinc-300 hover:text-white hover:bg-zinc-800 transition-colors"
                    >
                      <ChevronRight size={16} />
                    </button>
                  </div>
                  <CalendarGrid
                    monthValue={calendarEndMonth}
                    selectedValue={tempDateTo}
                    onSelect={setTempDateTo}
                  />
                </div>
              </div>

              <div>
                <p className="text-sm text-zinc-100 mb-3 text-center">Período pré-definido</p>
                <div className="grid grid-cols-2 gap-2">
                  <PresetButton label="Hoje" onClick={() => applyPresetPeriod('today')} />
                  <PresetButton label="Ontem" onClick={() => applyPresetPeriod('yesterday')} />
                  <PresetButton label="Esta semana" onClick={() => applyPresetPeriod('thisWeek')} />
                  <PresetButton label="Semana passada" onClick={() => applyPresetPeriod('lastWeek')} />
                  <PresetButton label="Este mês" onClick={() => applyPresetPeriod('thisMonth')} />
                  <PresetButton label="Mês passado" onClick={() => applyPresetPeriod('lastMonth')} />
                  <PresetButton label="Este ano" onClick={() => applyPresetPeriod('thisYear')} />
                  <PresetButton label="Ano passado" onClick={() => applyPresetPeriod('lastYear')} />
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
      <label className="block text-sm font-medium text-zinc-100 mb-2">{label}</label>
      <div className="relative">
        <select
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="w-full appearance-none bg-[#131314] border border-zinc-700 text-sm text-white px-4 pr-10 py-3 rounded outline-none focus:border-[#2a9cd4] hover:border-zinc-600 transition-colors"
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <ChevronDown size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400" />
      </div>
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
      className={`flex items-center justify-center gap-2 min-h-11 px-3 py-3 border rounded text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
        primary
          ? 'border-zinc-700 bg-[#131314] hover:bg-zinc-800 hover:border-zinc-600'
          : 'border-zinc-700 bg-[#131314] hover:bg-zinc-800 hover:border-zinc-600'
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
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="min-h-11 px-3 py-3 border border-zinc-700 rounded bg-[#1a1a1a] text-white text-sm hover:bg-zinc-800 hover:border-zinc-600 transition-colors"
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


