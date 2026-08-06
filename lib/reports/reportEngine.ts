export type ReportKey =
  | 'products'
  | 'customers'
  | 'sales_by_day'
  | 'sales_by_month'
  | 'sales_by_payment'
  | 'sales_by_user'
  | 'sales_by_product'
  | 'sales_by_category'
  | 'cash_summary'
  | 'documents_by_customer'
  | 'invoice_list'
  | 'invoices_ft'
  | 'invoices_pending'
  | 'receipts_rc'
  | 'quotations_fp'
  | 'cash_sales_vd'
  | 'tax_map'
  | 'accounts_receivable'
  | 'customer_statement'
  | 'supplier_statement'
  | 'top_customers'
  | 'stock_movement'
  | 'low_stock'
  | 'inventory_valuation'
  | 'product_margin'
  | 'realized_margin';

export type ReportSection = 'Vendas' | 'Documentos Fiscais' | 'Financeiro' | 'Cadastros' | 'Stock';

export type ReportRow = Record<string, string | number | null>;

export interface ReportDefinition {
  key: ReportKey;
  title: string;
  section: ReportSection;
  description: string;
}

export interface BuiltReport {
  key: ReportKey;
  title: string;
  subtitle: string;
  columns: string[];
  rows: ReportRow[];
  /** Coluna usada para separar visualmente grupos na tabela. */
  groupBy?: string;
  summaries: Array<{ label: string; value: string }>;
  meta: Array<{ label: string; value: string }>;
}

export interface ReportBuildContext {
  dateFrom: string;
  dateTo: string;
  selectedCustomer: string;
  /** Todos os identificadores da entidade seleccionada (id local, cloud_id, etc.). */
  selectedCustomerIds?: string[];
  selectedStatus: string;
  selectedPaymentMethod: string;
  selectedCategory: string;
  selectedProduct: string;
  fetchJson: (path: string) => Promise<unknown>;
  buildMeta: (title: string) => { title: string; meta: Array<{ label: string; value: string }> };
}

export const REPORT_DEFINITIONS: ReportDefinition[] = [
  { key: 'sales_by_day', title: 'Vendas diárias', section: 'Vendas', description: 'Entradas de caixa por dia de registo (sessão).' },
  { key: 'sales_by_month', title: 'Vendas mensais', section: 'Vendas', description: 'Entradas de caixa por mês de registo.' },
  { key: 'sales_by_payment', title: 'Vendas por método de pagamento', section: 'Vendas', description: 'Dinheiro, M-Pesa, E-Mola, POS e conta corrente.' },
  { key: 'sales_by_user', title: 'Vendas por utilizador', section: 'Vendas', description: 'Desempenho de vendas por vendedor/atendente.' },
  { key: 'sales_by_product', title: 'Vendas por produto', section: 'Vendas', description: 'Quantidade e valor vendidos por produto.' },
  { key: 'sales_by_category', title: 'Vendas por categoria', section: 'Vendas', description: 'Totais de vendas agrupados por grupo de produto.' },
  { key: 'cash_summary', title: 'Resumo de caixa', section: 'Vendas', description: 'Fecho de caixa: VD, RC e FT pagas no momento.' },
  { key: 'top_customers', title: 'Top clientes', section: 'Vendas', description: 'Clientes com maior volume de compras no período.' },

  { key: 'invoices_ft', title: 'Faturas (FT)', section: 'Documentos Fiscais', description: 'Todas as faturas emitidas no período.' },
  { key: 'invoices_pending', title: 'Faturas por pagar', section: 'Documentos Fiscais', description: 'Faturas em conta corrente ou pendentes de pagamento.' },
  { key: 'receipts_rc', title: 'Recibos (RC)', section: 'Documentos Fiscais', description: 'Recibos emitidos com referência à fatura paga.' },
  { key: 'quotations_fp', title: 'Cotações / Proformas (FP)', section: 'Documentos Fiscais', description: 'Cotações emitidas e respetivo estado.' },
  { key: 'cash_sales_vd', title: 'Vendas a dinheiro (VD)', section: 'Documentos Fiscais', description: 'Documentos VD emitidos no período.' },
  { key: 'invoice_list', title: 'Lista geral de documentos', section: 'Documentos Fiscais', description: 'Todos os documentos fiscais emitidos.' },
  { key: 'documents_by_customer', title: 'Documentos por cliente', section: 'Documentos Fiscais', description: 'Documentos emitidos para cada cliente.' },

  { key: 'tax_map', title: 'Mapa de IVA', section: 'Financeiro', description: 'Base tributável, IVA e totais por documento.' },
  { key: 'accounts_receivable', title: 'Conta corrente / valores a receber', section: 'Financeiro', description: 'Saldos em dívida por cliente (faturas por pagar).' },
  { key: 'customer_statement', title: 'Extrato de cliente', section: 'Financeiro', description: 'Documentos emitidos ao cliente com datas, débitos, créditos e saldo.' },
  { key: 'supplier_statement', title: 'Extrato de fornecedor', section: 'Financeiro', description: 'Documentos emitidos ao fornecedor com datas, débitos, créditos e saldo.' },

  { key: 'products', title: 'Produtos', section: 'Cadastros', description: 'Lista geral de produtos, preços, categoria e stock.' },
  { key: 'customers', title: 'Clientes', section: 'Cadastros', description: 'Relação de clientes com contactos.' },

  { key: 'stock_movement', title: 'Movimento de stock', section: 'Stock', description: 'Stock atual, mínimo e valor do inventário.' },
  { key: 'low_stock', title: 'Stock mínimo / ruptura', section: 'Stock', description: 'Produtos abaixo do stock mínimo ou sem stock.' },
  { key: 'inventory_valuation', title: 'Valorização de inventário', section: 'Stock', description: 'Valor total do stock ao custo e à venda.' },
  { key: 'product_margin', title: 'Margem por produto', section: 'Stock', description: 'Diferença entre preço de venda e custo por produto.' },
  { key: 'realized_margin', title: 'Margem realizada', section: 'Stock', description: 'Receita menos COGS FIFO (cogs_total) nas vendas do período.' },
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

function toArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function formatCurrency(value: number) {
  return `${mtCurrencyFormatter.format(value)} MT`;
}

function formatDate(value: string | null | undefined) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return dateFormatter.format(date);
}

function monthKey(value: string | null | undefined) {
  if (!value) return '';
  return String(value).slice(0, 7);
}

function formatMonthLabel(value: string) {
  if (!value) return '-';
  const [year, month] = value.split('-');
  const date = new Date(Number(year), Number(month) - 1, 1);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('pt-PT', { month: 'long', year: 'numeric' });
}

type DocumentRow = {
  id?: string | number;
  doc_type?: string | null;
  document_number?: string | null;
  payment_method?: string | null;
  status?: string | null;
  total?: number | null;
  subtotal?: number | null;
  tax?: number | null;
  discount?: number | null;
  created_at?: string | null;
  client_name?: string | null;
  user_name?: string | null;
  customer_id?: string | null;
  approved_document_type?: string | null;
  approved_document_number?: string | null;
  credit_note_total?: number | null;
  receipt_total?: number | null;
};

type ProductRow = {
  id?: string | number;
  code?: string | null;
  name?: string | null;
  category_id?: string | null;
  categories?: { name?: string | null };
  price?: number | null;
  final_price?: number | null;
  cost?: number | null;
  stock_quantity?: number | null;
  min_stock?: number | null;
  active?: boolean | number | null;
  created_at?: string | null;
  updated_at?: string | null;
};

type ItemRow = {
  order_id?: string | number;
  product_id?: string | number | null;
  product_name?: string | null;
  quantity?: number | null;
  price?: number | null;
  discount_amount?: number | null;
  unit_cost?: number | null;
  cogs_total?: number | null;
  created_at?: string | null;
};

function resolveDocCode(doc: DocumentRow): string {
  const docType = String(doc.doc_type ?? '').trim().toUpperCase();
  const docNumber = String(doc.document_number ?? '').trim().toUpperCase();

  if (docType === 'VD' || docType === 'VENDA') return 'VD';
  if (docType === 'FT' || docType === 'FATURA') return 'FT';
  if (docType === 'FTF' || docType === 'COMPRA' || docType.includes('FORNECEDOR')) return 'FTF';
  if (docType === 'FP' || docType.includes('PROFORMA') || docType.includes('COTAC')) return 'FP';
  if (docType === 'RC' || docType === 'RECIBO') return 'RC';
  if (docType === 'NC') return 'NC';
  if (docType === 'ND' || docType.includes('DÉBITO') || docType.includes('DEBITO')) return 'ND';
  if (docType === 'PAG' || docType.includes('PAGAMENTO')) return 'PAG';
  if (docType === 'PUR' || docType === 'EN/ST') return docType;

  if (docNumber.startsWith('VD/')) return 'VD';
  if (docNumber.startsWith('FTF/')) return 'FTF';
  if (docNumber.startsWith('FT/')) return 'FT';
  if (docNumber.startsWith('FP/')) return 'FP';
  if (docNumber.startsWith('RC/') || docNumber.startsWith('PBNK')) return 'RC';
  if (docNumber.startsWith('NC/')) return 'NC';
  if (docNumber.startsWith('ND/')) return 'ND';
  if (docNumber.startsWith('PAG/')) return 'PAG';
  if (docNumber.startsWith('PUR/')) return 'PUR';
  if (docNumber.startsWith('EN/ST/')) return 'EN/ST';

  return docType || 'VD';
}

const CUSTOMER_STATEMENT_CODES = new Set(['FT', 'RC', 'NC', 'VD', 'FP', 'AD', 'RCA']);
const SUPPLIER_STATEMENT_CODES = new Set(['FTF', 'PAG', 'ND', 'PUR', 'EN/ST', 'PAAD']);

function statementReference(doc: DocumentRow): string {
  const reference = String(doc.approved_document_number ?? '').trim();
  const referenceType = String(doc.approved_document_type ?? '').trim().toUpperCase();
  if (!reference) return '-';
  return referenceType ? `${referenceType} ${reference}` : reference;
}

function buildPartyStatement(
  docs: DocumentRow[],
  mode: 'customer' | 'supplier',
): {
  rows: ReportRow[];
  totalDebit: number;
  totalCredit: number;
  closingBalance: number;
} {
  const allowed = mode === 'customer' ? CUSTOMER_STATEMENT_CODES : SUPPLIER_STATEMENT_CODES;
  const eligible = docs
    .filter((doc) => {
      const code = resolveDocCode(doc);
      if (!allowed.has(code)) return false;
      const status = String(doc.status ?? '').trim().toLowerCase();
      return status !== 'cancelled' && status !== 'cancelado';
    });

  let totalDebit = 0;
  let totalCredit = 0;
  let closingBalance = 0;
  const partyLabel = mode === 'customer' ? 'Cliente' : 'Fornecedor';
  const defaultPartyName = mode === 'customer' ? 'Consumidor final' : 'Fornecedor';
  const groups = new Map<string, { name: string; docs: DocumentRow[] }>();

  for (const doc of eligible) {
    const name = String(doc.client_name ?? '').trim() || defaultPartyName;
    // Alguns documentos antigos usam id local e outros cloud_id para a mesma
    // entidade; o nome normalizado evita separar artificialmente esse extrato.
    const key = name.toLocaleLowerCase('pt');
    const group = groups.get(key) ?? { name, docs: [] };
    group.docs.push(doc);
    groups.set(key, group);
  }

  const rows: ReportRow[] = [];
  const sortedGroups = Array.from(groups.values()).sort((a, b) =>
    a.name.localeCompare(b.name, 'pt'),
  );

  for (const group of sortedGroups) {
    let balance = 0;
    const sortedDocs = group.docs.slice().sort((a, b) => {
      const da = new Date(a.created_at ?? 0).getTime();
      const db = new Date(b.created_at ?? 0).getTime();
      if (da !== db) return da - db;
      return String(a.document_number ?? '').localeCompare(String(b.document_number ?? ''), 'pt');
    });

    for (const doc of sortedDocs) {
      const code = resolveDocCode(doc);
      const amount = Math.abs(Number(doc.total ?? 0) || 0);
      let debit = 0;
      let credit = 0;

      if (mode === 'customer') {
        // Cliente deve-nos: FT/VD em débito; RC/NC em crédito. FP só listagem (não afecta saldo).
        if (code === 'FT' || code === 'VD' || code === 'AD' || code === 'RCA') {
          debit = amount;
        } else if (code === 'RC' || code === 'NC') {
          credit = amount;
        } else if (code === 'FP') {
          debit = amount;
        }
      } else {
        // Devemos ao fornecedor: FTF em débito; PAG/ND em crédito.
        if (code === 'FTF' || code === 'PUR' || code === 'EN/ST' || code === 'PAAD') {
          debit = amount;
        } else if (code === 'PAG' || code === 'ND') {
          credit = amount;
        }
      }

      const affectsBalance = !(mode === 'customer' && code === 'FP');
      if (affectsBalance) {
        balance = Math.round((balance + debit - credit) * 100) / 100;
        totalDebit += debit;
        totalCredit += credit;
      } else {
        totalDebit += debit;
      }

      rows.push({
        Data: formatDate(doc.created_at),
        Documento: doc.document_number || '-',
        Tipo: code,
        [partyLabel]: group.name,
        Referência: statementReference(doc),
        Débito: debit > 0 ? formatCurrency(debit) : '-',
        Crédito: credit > 0 ? formatCurrency(credit) : '-',
        Saldo: formatCurrency(balance),
      });
    }
    closingBalance = Math.round((closingBalance + balance) * 100) / 100;
  }

  return {
    rows,
    totalDebit: Math.round(totalDebit * 100) / 100,
    totalCredit: Math.round(totalCredit * 100) / 100,
    closingBalance,
  };
}

function resolveStatusLabel(status: string | null | undefined, docCode: string) {
  const normalized = String(status ?? '').trim().toLowerCase();
  if (normalized === 'approved' || normalized === 'aprovado') return 'Aprovado';
  if (normalized === 'completed' || normalized === 'pago') return 'Pago';
  if (normalized === 'cancelled' || normalized === 'cancelado') return 'Cancelado';
  if (docCode === 'FP') return 'Lançado';
  return 'Pendente';
}

function isPendingInvoice(doc: DocumentRow) {
  const code = resolveDocCode(doc);
  if (code !== 'FT') return false;
  const remaining = Math.max(0, Number(doc.total ?? 0) - Number(doc.receipt_total ?? 0));
  if (remaining <= 0.009) return false;
  const status = String(doc.status ?? '').trim().toLowerCase();
  if (status === 'completed' || status === 'pago') return false;
  const payment = String(doc.payment_method ?? '').toLowerCase();
  return status === 'pending' || payment.includes('conta corrente') || remaining > 0.009;
}

function buildDocumentsParams(ctx: ReportBuildContext) {
  const params = new URLSearchParams({ dateFrom: ctx.dateFrom, dateTo: ctx.dateTo });
  return params;
}

function isFtPaidViaReceipt(doc: DocumentRow): boolean {
  const code = resolveDocCode(doc);
  if (code !== 'FT') return false;
  const refType = String(doc.approved_document_type ?? '').trim().toUpperCase();
  if (refType === 'RC' || refType === 'RECIBO') return true;
  const refNum = String(doc.approved_document_number ?? '').trim().toUpperCase();
  return refNum.startsWith('RC/') || refNum.startsWith('PBNK');
}

function isPendingContaCorrenteFt(doc: DocumentRow): boolean {
  const code = resolveDocCode(doc);
  if (code !== 'FT') return false;
  const status = String(doc.status ?? '').trim().toLowerCase();
  const payment = String(doc.payment_method ?? '').toLowerCase().replace(/-/g, ' ');
  return status === 'pending' && payment.includes('conta corrente');
}

function isCashInflowDocument(doc: DocumentRow): boolean {
  const code = resolveDocCode(doc);
  if (code === 'FP' || code === 'NC' || code === 'INV') return false;
  const docType = String(doc.doc_type ?? '').toLowerCase();
  if (docType.includes('invent')) return false;
  if (code === 'RC') return true;
  if (code === 'VD' || code === 'TK') return true;
  if (code === 'FT') {
    const payment = String(doc.payment_method ?? '').toLowerCase().replace(/-/g, ' ');
    if (payment.includes('conta corrente')) return false;
    if (isFtPaidViaReceipt(doc)) return false;
    return true;
  }
  return false;
}

function isCompletedCashInflow(doc: DocumentRow): boolean {
  if (!isCashInflowDocument(doc)) return false;
  const status = String(doc.status ?? '').trim().toLowerCase();
  if (status === 'cancelled' || status === 'cancelado') return false;
  return status === 'completed' || status === 'pago' || status === 'approved' || status === 'aprovado';
}

function matchesRevenueStatusFilter(doc: DocumentRow, selectedStatus: string): boolean {
  if (selectedStatus !== 'all') {
    const status = String(doc.status ?? '').trim().toLowerCase();
    return status === selectedStatus;
  }
  return isCompletedCashInflow(doc);
}

async function fetchRevenueDocuments(ctx: ReportBuildContext) {
  const docs = await fetchDocuments(ctx);
  return docs.filter(isCashInflowDocument).filter((doc) => matchesRevenueStatusFilter(doc, ctx.selectedStatus));
}

function collectRevenueOrderIds(docs: DocumentRow[]): Set<string> {
  const ids = new Set<string>();
  docs.forEach((doc) => {
    const id = String(doc.id ?? '').trim();
    if (!id) return;
    ids.add(id);
    if (id.startsWith('venda:')) ids.add(id.slice('venda:'.length));
  });
  return ids;
}

function resolveSelectedCustomerIds(ctx: ReportBuildContext): Set<string> | null {
  if (ctx.selectedCustomer === 'all') return null;
  const ids = (ctx.selectedCustomerIds?.length ? ctx.selectedCustomerIds : [ctx.selectedCustomer])
    .map((id) => String(id ?? '').trim())
    .filter(Boolean);
  return ids.length ? new Set(ids) : null;
}

async function fetchDocuments(ctx: ReportBuildContext) {
  const params = buildDocumentsParams(ctx);
  const docs = toArray<DocumentRow>(await ctx.fetchJson(`/documentos?${params.toString()}`));
  const selectedIds = resolveSelectedCustomerIds(ctx);
  return docs.filter((doc) => {
    const code = resolveDocCode(doc);
    if (code === 'INV' || String(doc.doc_type ?? '').toLowerCase().includes('invent')) return false;
    if (selectedIds) {
      const customerId = String(doc.customer_id ?? '').trim();
      if (!customerId || !selectedIds.has(customerId)) return false;
    }
    if (ctx.selectedPaymentMethod !== 'all') {
      const payment = String(doc.payment_method ?? '').trim();
      if (payment && payment !== ctx.selectedPaymentMethod) return false;
    }
    if (ctx.selectedStatus !== 'all') {
      const status = String(doc.status ?? '').trim().toLowerCase();
      if (status && status !== ctx.selectedStatus) return false;
    }
    return true;
  });
}

async function fetchProducts(ctx: ReportBuildContext) {
  const data = toArray<ProductRow>(await ctx.fetchJson('/produtos'));
  return data
    .filter((item) => (ctx.selectedCategory === 'all' ? true : String(item.category_id) === ctx.selectedCategory))
    .filter((item) => (ctx.selectedProduct === 'all' ? true : String(item.id) === ctx.selectedProduct))
    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
}

function mapDocumentRows(docs: DocumentRow[]) {
  return docs.map((doc) => {
    const code = resolveDocCode(doc);
    const reference = String(doc.approved_document_number ?? '').trim();
    const referenceType = String(doc.approved_document_type ?? '').trim().toUpperCase();
    const referenceLabel = reference
      ? referenceType
        ? `${referenceType} ${reference}`
        : reference
      : '-';
    return {
      'Número': doc.document_number || '-',
      Tipo: code,
      Data: formatDate(doc.created_at),
      Cliente: doc.client_name || 'Consumidor final',
      Utilizador: doc.user_name || '-',
      Pagamento: doc.payment_method || '-',
      Subtotal: formatCurrency(Number(doc.subtotal ?? (Number(doc.total ?? 0) - Number(doc.tax ?? 0)))),
      IVA: formatCurrency(Number(doc.tax ?? 0)),
      Total: formatCurrency(Number(doc.total ?? 0)),
      Estado: resolveStatusLabel(doc.status, code),
      Referência: referenceLabel,
    };
  });
}

export async function buildReport(reportKey: ReportKey, ctx: ReportBuildContext): Promise<BuiltReport> {
  if (reportKey === 'products') {
    const data = await fetchProducts(ctx);
    const rows = data.map((item) => ({
      Código: item.code ?? '-',
      Produto: item.name ?? '-',
      Grupo: item.categories?.name || 'Sem grupo',
      Preço: formatCurrency(Number(item.price || 0)),
      'Preço final': formatCurrency(Number(item.final_price || item.price || 0)),
      Stock: Number(item.stock_quantity || 0),
      Estado: item.active ? 'Ativo' : 'Inativo',
      Registo: formatDate(item.created_at),
    }));
    const metaBlock = ctx.buildMeta('Produtos');
    return {
      key: reportKey,
      title: metaBlock.title,
      subtitle: 'Cadastro de produtos',
      columns: ['Código', 'Produto', 'Grupo', 'Preço', 'Preço final', 'Stock', 'Estado', 'Registo'],
      rows,
      summaries: [
        { label: 'Itens listados', value: String(rows.length) },
        { label: 'Produtos ativos', value: String(data.filter((item) => item.active).length) },
        { label: 'Stock acumulado', value: String(data.reduce((sum, item) => sum + Number(item.stock_quantity || 0), 0)) },
      ],
      meta: metaBlock.meta,
    };
  }

  if (reportKey === 'customers') {
    const params = new URLSearchParams();
    if (ctx.selectedCustomer !== 'all') params.set('customerId', ctx.selectedCustomer);
    const queryString = params.toString();
    const data = toArray<any>(await ctx.fetchJson(`/reports/customers${queryString ? `?${queryString}` : ''}`));
    const rows = data.map((item: any) => ({
      Cliente: item.name,
      Telefone: item.phone || '-',
      Email: item.email || '-',
      Endereço: item.address || '-',
      Registo: formatDate(item.created_at),
    }));
    const metaBlock = ctx.buildMeta('Clientes');
    return {
      key: reportKey,
      title: metaBlock.title,
      subtitle: 'Cadastro de clientes',
      columns: ['Cliente', 'Telefone', 'Email', 'Endereço', 'Registo'],
      rows,
      summaries: [{ label: 'Clientes listados', value: String(rows.length) }],
      meta: metaBlock.meta,
    };
  }

  if (reportKey === 'sales_by_day') {
    const data = await fetchRevenueDocuments(ctx);
    const grouped = new Map<string, { orders: number; subtotal: number; tax: number; discount: number; total: number }>();
    data.forEach((item) => {
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
      Documentos: item.orders,
      Subtotal: formatCurrency(item.subtotal),
      IVA: formatCurrency(item.tax),
      Desconto: formatCurrency(item.discount),
      Total: formatCurrency(item.total),
    }));
    const grandTotal = data.reduce((sum, item) => sum + Number(item.total || 0), 0);
    const metaBlock = ctx.buildMeta('Vendas diárias');
    return {
      key: reportKey,
      title: metaBlock.title,
      subtitle: 'Entradas de caixa por dia de registo',
      columns: ['Data', 'Documentos', 'Subtotal', 'IVA', 'Desconto', 'Total'],
      rows,
      summaries: [
        { label: 'Dias com vendas', value: String(rows.length) },
        { label: 'Documentos', value: String(data.length) },
        { label: 'Total vendido', value: formatCurrency(grandTotal) },
      ],
      meta: metaBlock.meta,
    };
  }

  if (reportKey === 'sales_by_month') {
    const docs = await fetchRevenueDocuments(ctx);
    const grouped = new Map<string, { count: number; total: number }>();
    docs.forEach((doc) => {
      const key = monthKey(doc.created_at);
      const current = grouped.get(key) || { count: 0, total: 0 };
      current.count += 1;
      current.total += Number(doc.total || 0);
      grouped.set(key, current);
    });
    const rows = Array.from(grouped.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, item]) => ({
        Mês: formatMonthLabel(month),
        Documentos: item.count,
        Total: formatCurrency(item.total),
      }));
    const grandTotal = docs.reduce((sum, doc) => sum + Number(doc.total || 0), 0);
    const metaBlock = ctx.buildMeta('Vendas mensais');
    return {
      key: reportKey,
      title: metaBlock.title,
      subtitle: 'Entradas de caixa por mês de registo',
      columns: ['Mês', 'Documentos', 'Total'],
      rows,
      summaries: [
        { label: 'Meses', value: String(rows.length) },
        { label: 'Documentos', value: String(docs.length) },
        { label: 'Total', value: formatCurrency(grandTotal) },
      ],
      meta: metaBlock.meta,
    };
  }

  if (reportKey === 'sales_by_payment') {
    const docs = await fetchRevenueDocuments(ctx);
    const grouped = new Map<string, { count: number; total: number }>();
    docs.forEach((doc) => {
      const key = String(doc.payment_method || 'Não definido').trim() || 'Não definido';
      const current = grouped.get(key) || { count: 0, total: 0 };
      current.count += 1;
      current.total += Number(doc.total || 0);
      grouped.set(key, current);
    });
    const rows = Array.from(grouped.entries())
      .sort(([, a], [, b]) => b.total - a.total)
      .map(([method, item]) => ({
        'Método de pagamento': method,
        Documentos: item.count,
        Total: formatCurrency(item.total),
      }));
    const grandTotal = docs.reduce((sum, doc) => sum + Number(doc.total || 0), 0);
    const metaBlock = ctx.buildMeta('Vendas por método de pagamento');
    return {
      key: reportKey,
      title: metaBlock.title,
      subtitle: 'Totais por Dinheiro, M-Pesa, E-Mola, POS e CC',
      columns: ['Método de pagamento', 'Documentos', 'Total'],
      rows,
      summaries: [
        { label: 'Formas de pagamento', value: String(rows.length) },
        { label: 'Total geral', value: formatCurrency(grandTotal) },
      ],
      meta: metaBlock.meta,
    };
  }

  if (reportKey === 'sales_by_user') {
    const docs = await fetchRevenueDocuments(ctx);
    const grouped = new Map<string, { count: number; total: number }>();
    docs.forEach((doc) => {
      const key = String(doc.user_name || 'Sem utilizador').trim() || 'Sem utilizador';
      const current = grouped.get(key) || { count: 0, total: 0 };
      current.count += 1;
      current.total += Number(doc.total || 0);
      grouped.set(key, current);
    });
    const rows = Array.from(grouped.entries())
      .sort(([, a], [, b]) => b.total - a.total)
      .map(([user, item]) => ({
        Utilizador: user,
        Documentos: item.count,
        Total: formatCurrency(item.total),
      }));
    const metaBlock = ctx.buildMeta('Vendas por utilizador');
    return {
      key: reportKey,
      title: metaBlock.title,
      subtitle: 'Desempenho por vendedor',
      columns: ['Utilizador', 'Documentos', 'Total'],
      rows,
      summaries: [{ label: 'Utilizadores', value: String(rows.length) }],
      meta: metaBlock.meta,
    };
  }

  if (reportKey === 'sales_by_product' || reportKey === 'sales_by_category' || reportKey === 'realized_margin') {
    const revenueDocs = await fetchRevenueDocuments(ctx);
    const revenueOrderIds = collectRevenueOrderIds(revenueDocs);
    const items = toArray<ItemRow>(await ctx.fetchJson('/documentos-itens'));
    const products = await fetchProducts(ctx);
    const productMap = new Map(products.map((product) => [String(product.id), product]));
    const categoryTotals = new Map<string, { qty: number; total: number; count: number }>();
    const productTotals = new Map<string, { qty: number; total: number; name: string }>();
    const marginTotals = new Map<
      string,
      { name: string; qty: number; revenue: number; cogs: number }
    >();

    items.forEach((item) => {
      const orderId = String(item.order_id ?? '').trim();
      if (!orderId || !revenueOrderIds.has(orderId)) return;
      const created = String(item.created_at ?? '').slice(0, 10);
      if (created && (created < ctx.dateFrom || created > ctx.dateTo)) return;
      const qty = Number(item.quantity ?? 0);
      const price = Number(item.price ?? 0);
      const discount = Number(item.discount_amount ?? 0);
      const lineTotal = price * qty - discount;
      const product = productMap.get(String(item.product_id ?? ''));
      const productName = String(item.product_name ?? product?.name ?? 'Item');
      const categoryName = product?.categories?.name || 'Sem grupo';
      const cogs =
        item.cogs_total != null && Number.isFinite(Number(item.cogs_total))
          ? Number(item.cogs_total)
          : item.unit_cost != null && Number.isFinite(Number(item.unit_cost))
            ? Number(item.unit_cost) * qty
            : Number(product?.cost ?? 0) * qty;

      const productCurrent = productTotals.get(productName) || { qty: 0, total: 0, name: productName };
      productCurrent.qty += qty;
      productCurrent.total += lineTotal;
      productTotals.set(productName, productCurrent);

      const categoryCurrent = categoryTotals.get(categoryName) || { qty: 0, total: 0, count: 0 };
      categoryCurrent.qty += qty;
      categoryCurrent.total += lineTotal;
      categoryCurrent.count += 1;
      categoryTotals.set(categoryName, categoryCurrent);

      const marginCurrent = marginTotals.get(productName) || {
        name: productName,
        qty: 0,
        revenue: 0,
        cogs: 0,
      };
      marginCurrent.qty += qty;
      marginCurrent.revenue += lineTotal;
      marginCurrent.cogs += cogs;
      marginTotals.set(productName, marginCurrent);
    });

    if (reportKey === 'realized_margin') {
      const rows = Array.from(marginTotals.values())
        .sort((a, b) => b.revenue - b.cogs - (a.revenue - a.cogs))
        .map((item) => {
          const margin = item.revenue - item.cogs;
          const pct = item.revenue > 0 ? (margin / item.revenue) * 100 : 0;
          return {
            Produto: item.name,
            Quantidade: Number(item.qty.toFixed(2)),
            Receita: formatCurrency(item.revenue),
            COGS: formatCurrency(item.cogs),
            Margem: formatCurrency(margin),
            '% Margem': `${pct.toFixed(1)}%`,
          };
        });
      const revenueSum = Array.from(marginTotals.values()).reduce((s, i) => s + i.revenue, 0);
      const cogsSum = Array.from(marginTotals.values()).reduce((s, i) => s + i.cogs, 0);
      const marginSum = revenueSum - cogsSum;
      const metaBlock = ctx.buildMeta('Margem realizada');
      return {
        key: reportKey,
        title: metaBlock.title,
        subtitle: 'Receita − COGS FIFO nas vendas do período',
        columns: ['Produto', 'Quantidade', 'Receita', 'COGS', 'Margem', '% Margem'],
        rows,
        summaries: [
          { label: 'Receita', value: formatCurrency(revenueSum) },
          { label: 'COGS', value: formatCurrency(cogsSum) },
          { label: 'Margem', value: formatCurrency(marginSum) },
        ],
        meta: metaBlock.meta,
      };
    }

    if (reportKey === 'sales_by_product') {
      const rows = Array.from(productTotals.values())
        .sort((a, b) => b.total - a.total)
        .map((item) => ({
          Produto: item.name,
          Quantidade: Number(item.qty.toFixed(2)),
          Total: formatCurrency(item.total),
        }));
      const productGrandTotal = Array.from(productTotals.values()).reduce((sum, item) => sum + item.total, 0);
      const metaBlock = ctx.buildMeta('Vendas por produto');
      return {
        key: reportKey,
        title: metaBlock.title,
        subtitle: 'Itens vendidos no período',
        columns: ['Produto', 'Quantidade', 'Total'],
        rows,
        summaries: [
          { label: 'Produtos', value: String(rows.length) },
          { label: 'Total vendido', value: formatCurrency(productGrandTotal) },
        ],
        meta: metaBlock.meta,
      };
    }

    const rows = Array.from(categoryTotals.entries())
      .sort(([, a], [, b]) => b.total - a.total)
      .map(([category, item]) => ({
        Categoria: category,
        Linhas: item.count,
        Quantidade: Number(item.qty.toFixed(2)),
        Total: formatCurrency(item.total),
      }));
    const metaBlock = ctx.buildMeta('Vendas por categoria');
    return {
      key: reportKey,
      title: metaBlock.title,
      subtitle: 'Totais por grupo de produto',
      columns: ['Categoria', 'Linhas', 'Quantidade', 'Total'],
      rows,
      summaries: [{ label: 'Categorias', value: String(rows.length) }],
      meta: metaBlock.meta,
    };
  }

  if (reportKey === 'cash_summary') {
    const docs = await fetchRevenueDocuments(ctx);
    const grouped = new Map<string, number>();
    docs.forEach((doc) => {
      const key = String(doc.payment_method || 'Outro').trim() || 'Outro';
      grouped.set(key, (grouped.get(key) || 0) + Number(doc.total || 0));
    });
    const rows = Array.from(grouped.entries()).map(([method, total]) => ({
      'Forma de pagamento': method,
      'Valor recebido': formatCurrency(total),
    }));
    const grandTotal = docs.reduce((sum, doc) => sum + Number(doc.total || 0), 0);
    const metaBlock = ctx.buildMeta('Resumo de caixa');
    return {
      key: reportKey,
      title: metaBlock.title,
      subtitle: 'Fecho de caixa do período',
      columns: ['Forma de pagamento', 'Valor recebido'],
      rows,
      summaries: [
        { label: 'Documentos liquidados', value: String(docs.length) },
        { label: 'Total em caixa', value: formatCurrency(grandTotal) },
      ],
      meta: metaBlock.meta,
    };
  }

  if (reportKey === 'top_customers') {
    const docs = await fetchRevenueDocuments(ctx);
    const grouped = new Map<string, { count: number; total: number }>();
    docs.forEach((doc) => {
      const key = String(doc.client_name || 'Consumidor final');
      const current = grouped.get(key) || { count: 0, total: 0 };
      current.count += 1;
      current.total += Number(doc.total || 0);
      grouped.set(key, current);
    });
    const rows = Array.from(grouped.entries())
      .sort(([, a], [, b]) => b.total - a.total)
      .slice(0, 50)
      .map(([name, item]) => ({
        Cliente: name,
        Documentos: item.count,
        Total: formatCurrency(item.total),
      }));
    const metaBlock = ctx.buildMeta('Top clientes');
    return {
      key: reportKey,
      title: metaBlock.title,
      subtitle: 'Maiores clientes por volume',
      columns: ['Cliente', 'Documentos', 'Total'],
      rows,
      summaries: [{ label: 'Clientes', value: String(rows.length) }],
      meta: metaBlock.meta,
    };
  }

  const documentReport = async (
    title: string,
    subtitle: string,
    filter: (doc: DocumentRow) => boolean,
  ): Promise<BuiltReport> => {
    const docs = (await fetchDocuments(ctx)).filter(filter);
    const rows = mapDocumentRows(docs);
    const grandTotal = docs.reduce((sum, doc) => sum + Number(doc.total || 0), 0);
    const metaBlock = ctx.buildMeta(title);
    return {
      key: reportKey,
      title: metaBlock.title,
      subtitle,
      columns: ['Número', 'Tipo', 'Data', 'Cliente', 'Utilizador', 'Pagamento', 'Subtotal', 'IVA', 'Total', 'Estado', 'Referência'],
      rows,
      summaries: [
        { label: 'Documentos', value: String(rows.length) },
        { label: 'Total', value: formatCurrency(grandTotal) },
      ],
      meta: metaBlock.meta,
    };
  };

  if (reportKey === 'invoices_ft') {
    return documentReport('Faturas (FT)', 'Faturas emitidas no período', (doc) => resolveDocCode(doc) === 'FT');
  }
  if (reportKey === 'invoices_pending') {
    return documentReport('Faturas por pagar', 'Conta corrente e faturas pendentes', isPendingInvoice);
  }
  if (reportKey === 'receipts_rc') {
    return documentReport('Recibos (RC)', 'Recibos de pagamento emitidos', (doc) => resolveDocCode(doc) === 'RC');
  }
  if (reportKey === 'quotations_fp') {
    return documentReport('Cotações (FP)', 'Proformas e cotações', (doc) => resolveDocCode(doc) === 'FP');
  }
  if (reportKey === 'cash_sales_vd') {
    return documentReport('Vendas a dinheiro (VD)', 'Documentos VD emitidos', (doc) => resolveDocCode(doc) === 'VD');
  }
  if (reportKey === 'invoice_list') {
    return documentReport('Lista geral de documentos', 'Todos os documentos fiscais', () => true);
  }

  if (reportKey === 'documents_by_customer') {
    const docs = await fetchDocuments(ctx);
    const rows = docs
      .sort((a, b) => String(a.client_name || '').localeCompare(String(b.client_name || '')))
      .map((doc) => ({
        Cliente: doc.client_name || 'Consumidor final',
        Data: formatDate(doc.created_at),
        Tipo: resolveDocCode(doc),
        Número: doc.document_number || '-',
        Pagamento: doc.payment_method || '-',
        Estado: resolveStatusLabel(doc.status, resolveDocCode(doc)),
        Total: formatCurrency(Number(doc.total || 0)),
      }));
    const metaBlock = ctx.buildMeta('Documentos por cliente');
    return {
      key: reportKey,
      title: metaBlock.title,
      subtitle: 'Documentos agrupados por cliente',
      columns: ['Cliente', 'Data', 'Tipo', 'Número', 'Pagamento', 'Estado', 'Total'],
      rows,
      summaries: [
        { label: 'Documentos', value: String(rows.length) },
        { label: 'Total', value: formatCurrency(docs.reduce((sum, doc) => sum + Number(doc.total || 0), 0)) },
      ],
      meta: metaBlock.meta,
    };
  }

  if (reportKey === 'tax_map') {
    const docs = await fetchDocuments(ctx);
    const rows = docs.map((doc) => {
      const subtotal = Number(doc.subtotal ?? (Number(doc.total ?? 0) - Number(doc.tax ?? 0)));
      const tax = Number(doc.tax ?? 0);
      const total = Number(doc.total ?? 0);
      return {
        Documento: doc.document_number || '-',
        Data: formatDate(doc.created_at),
        Cliente: doc.client_name || 'Consumidor final',
        'Base tributável': formatCurrency(subtotal),
        IVA: formatCurrency(tax),
        Total: formatCurrency(total),
      };
    });
    const base = docs.reduce((sum, doc) => sum + Number(doc.subtotal ?? (Number(doc.total ?? 0) - Number(doc.tax ?? 0))), 0);
    const tax = docs.reduce((sum, doc) => sum + Number(doc.tax ?? 0), 0);
    const total = docs.reduce((sum, doc) => sum + Number(doc.total ?? 0), 0);
    const metaBlock = ctx.buildMeta('Mapa de IVA');
    return {
      key: reportKey,
      title: metaBlock.title,
      subtitle: 'Resumo tributário do período',
      columns: ['Documento', 'Data', 'Cliente', 'Base tributável', 'IVA', 'Total'],
      rows,
      summaries: [
        { label: 'Base tributável', value: formatCurrency(base) },
        { label: 'IVA total', value: formatCurrency(tax) },
        { label: 'Total faturado', value: formatCurrency(total) },
      ],
      meta: metaBlock.meta,
    };
  }

  if (reportKey === 'accounts_receivable') {
    const docs = (await fetchDocuments(ctx)).filter(isPendingInvoice);
    const grouped = new Map<string, { count: number; total: number }>();
    docs.forEach((doc) => {
      const key = String(doc.client_name || 'Consumidor final');
      const current = grouped.get(key) || { count: 0, total: 0 };
      current.count += 1;
      current.total += Math.max(0, Number(doc.total || 0) - Number(doc.receipt_total || 0));
      grouped.set(key, current);
    });
    const rows = Array.from(grouped.entries())
      .sort(([, a], [, b]) => b.total - a.total)
      .map(([client, item]) => ({
        Cliente: client,
        'Faturas em dívida': item.count,
        'Valor a receber': formatCurrency(item.total),
      }));
    const totalDue = docs.reduce(
      (sum, doc) => sum + Math.max(0, Number(doc.total || 0) - Number(doc.receipt_total || 0)),
      0,
    );
    const metaBlock = ctx.buildMeta('Conta corrente');
    return {
      key: reportKey,
      title: metaBlock.title,
      subtitle: 'Valores por receber de clientes',
      columns: ['Cliente', 'Faturas em dívida', 'Valor a receber'],
      rows,
      summaries: [
        { label: 'Clientes devedores', value: String(rows.length) },
        { label: 'Total a receber', value: formatCurrency(totalDue) },
      ],
      meta: metaBlock.meta,
    };
  }

  if (reportKey === 'customer_statement' || reportKey === 'supplier_statement') {
    const mode = reportKey === 'customer_statement' ? 'customer' : 'supplier';
    const docs = await fetchDocuments(ctx);
    const statement = buildPartyStatement(docs, mode);
    const partyLabel = mode === 'customer' ? 'Cliente' : 'Fornecedor';
    const metaBlock = ctx.buildMeta(mode === 'customer' ? 'Extrato de cliente' : 'Extrato de fornecedor');
    return {
      key: reportKey,
      title: metaBlock.title,
      subtitle:
        mode === 'customer'
          ? 'Movimentos emitidos ao cliente no período (com datas e saldo)'
          : 'Movimentos emitidos ao fornecedor no período (com datas e saldo)',
      columns: ['Data', 'Documento', 'Tipo', partyLabel, 'Referência', 'Débito', 'Crédito', 'Saldo'],
      rows: statement.rows,
      groupBy: ctx.selectedCustomer === 'all' ? partyLabel : undefined,
      summaries: [
        { label: 'Documentos', value: String(statement.rows.length) },
        { label: 'Total débito', value: formatCurrency(statement.totalDebit) },
        { label: 'Total crédito', value: formatCurrency(statement.totalCredit) },
        {
          label: mode === 'customer' ? 'Saldo a receber' : 'Saldo a pagar',
          value: formatCurrency(statement.closingBalance),
        },
      ],
      meta: metaBlock.meta,
    };
  }

  if (reportKey === 'stock_movement' || reportKey === 'low_stock' || reportKey === 'inventory_valuation' || reportKey === 'product_margin') {
    const data = await fetchProducts(ctx);

    if (reportKey === 'low_stock') {
      const lowStock = data.filter((item) => Number(item.stock_quantity || 0) <= Number(item.min_stock || 0));
      const rows = lowStock.map((item) => ({
        Código: item.code ?? '-',
        Produto: item.name ?? '-',
        Grupo: item.categories?.name || 'Sem grupo',
        'Stock atual': Number(item.stock_quantity || 0),
        'Stock mínimo': Number(item.min_stock || 0),
        Diferença: Number(item.stock_quantity || 0) - Number(item.min_stock || 0),
        Estado: Number(item.stock_quantity || 0) <= 0 ? 'Ruptura' : 'Baixo stock',
      }));
      const metaBlock = ctx.buildMeta('Stock mínimo');
      return {
        key: reportKey,
        title: metaBlock.title,
        subtitle: 'Produtos em ruptura ou abaixo do mínimo',
        columns: ['Código', 'Produto', 'Grupo', 'Stock atual', 'Stock mínimo', 'Diferença', 'Estado'],
        rows,
        summaries: [{ label: 'Produtos em alerta', value: String(rows.length) }],
        meta: metaBlock.meta,
      };
    }

    if (reportKey === 'inventory_valuation') {
      const rows = data.map((item) => {
        const qty = Number(item.stock_quantity || 0);
        const cost = Number(item.cost || 0);
        const price = Number(item.final_price || item.price || 0);
        return {
          Produto: item.name ?? '-',
          Grupo: item.categories?.name || 'Sem grupo',
          Stock: qty,
          'Valor ao custo': formatCurrency(qty * cost),
          'Valor à venda': formatCurrency(qty * price),
        };
      });
      const costTotal = data.reduce((sum, item) => sum + Number(item.stock_quantity || 0) * Number(item.cost || 0), 0);
      const saleTotal = data.reduce(
        (sum, item) => sum + Number(item.stock_quantity || 0) * Number(item.final_price || item.price || 0),
        0,
      );
      const metaBlock = ctx.buildMeta('Valorização de inventário');
      return {
        key: reportKey,
        title: metaBlock.title,
        subtitle: 'Valor do stock ao custo e à venda',
        columns: ['Produto', 'Grupo', 'Stock', 'Valor ao custo', 'Valor à venda'],
        rows,
        summaries: [
          { label: 'Valor ao custo', value: formatCurrency(costTotal) },
          { label: 'Valor à venda', value: formatCurrency(saleTotal) },
        ],
        meta: metaBlock.meta,
      };
    }

    if (reportKey === 'product_margin') {
      const rows = data.map((item) => {
        const cost = Number(item.cost || 0);
        const price = Number(item.final_price || item.price || 0);
        const margin = price - cost;
        const marginPct = price > 0 ? (margin / price) * 100 : 0;
        return {
          Produto: item.name ?? '-',
          Grupo: item.categories?.name || 'Sem grupo',
          Custo: formatCurrency(cost),
          'Preço venda': formatCurrency(price),
          Margem: formatCurrency(margin),
          '% Margem': `${marginPct.toFixed(1)}%`,
        };
      });
      const metaBlock = ctx.buildMeta('Margem por produto');
      return {
        key: reportKey,
        title: metaBlock.title,
        subtitle: 'Lucro bruto potencial por produto',
        columns: ['Produto', 'Grupo', 'Custo', 'Preço venda', 'Margem', '% Margem'],
        rows,
        summaries: [{ label: 'Produtos', value: String(rows.length) }],
        meta: metaBlock.meta,
      };
    }

    const rows = data.map((item) => {
      const qty = Number(item.stock_quantity || 0);
      const cost = Number(item.cost || 0);
      const price = Number(item.final_price || item.price || 0);
      return {
        Código: item.code ?? '-',
        Produto: item.name ?? '-',
        Grupo: item.categories?.name || 'Sem grupo',
        'Stock atual': qty,
        'Stock mínimo': Number(item.min_stock || 0),
        'Custo unitário': formatCurrency(cost),
        'Preço venda': formatCurrency(price),
        'Valor em stock': formatCurrency(qty * cost),
        Atualizado: formatDate(item.updated_at),
      };
    });
    const inventoryCost = data.reduce((sum, item) => sum + Number(item.stock_quantity || 0) * Number(item.cost || 0), 0);
    const lowStockCount = data.filter((item) => Number(item.stock_quantity || 0) <= Number(item.min_stock || 0)).length;
    const metaBlock = ctx.buildMeta('Movimento de stock');
    return {
      key: reportKey,
      title: metaBlock.title,
      subtitle: 'Posição de stock atual',
      columns: ['Código', 'Produto', 'Grupo', 'Stock atual', 'Stock mínimo', 'Custo unitário', 'Preço venda', 'Valor em stock', 'Atualizado'],
      rows,
      summaries: [
        { label: 'Produtos', value: String(rows.length) },
        { label: 'Baixo stock', value: String(lowStockCount) },
        { label: 'Valor inventário', value: formatCurrency(inventoryCost) },
      ],
      meta: metaBlock.meta,
    };
  }

  throw new Error('Relatório não suportado.');
}
