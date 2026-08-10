import type { CompanyProfile } from '@/app/pos/types';
import { formatDocumentSourceReferenceLabel } from '@/lib/documents/documentReference';
import { buildReceiptHeader, safeReceiptLogoSrc } from '@/lib/receiptCompanyHeader';
import { formatPaymentMethodLabel } from '@/lib/paymentMethodLabel';
import { getPosTaxPercentLabel } from '@/lib/taxConfig';
import {
  formatCompanyBankDetailsForFooter,
  parseCompanyBankAccounts,
} from '@/lib/companyBankDetails';

export type SalesDocumentSale = {
  id?: number | string;
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
  notes?: string | null;
  is_waste?: boolean | number | null;
};

export type SalesDocumentItem = {
  product_name?: string | null;
  quantity?: number | null;
  unit?: string | null;
  price?: number | null;
  discount_amount?: number | null;
};

type DocumentVariant = 'venda' | 'fatura' | 'cotacao' | 'recibo' | 'talao';

const BRAND_GREEN = '#2f8f5b';
const BRAND_GREEN_LIGHT = '#e8f3ec';

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatA4Amount(value: number) {
  const n = Number(value);
  const safe = Number.isFinite(n) ? n : 0;
  return (
    new Intl.NumberFormat('pt-PT', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(safe) + ' MT'
  );
}

function formatA4Date(value: string | null | undefined) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return new Intl.DateTimeFormat('pt-PT').format(date);
}

function formatA4DateTime(value: string | null | undefined) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return new Intl.DateTimeFormat('pt-PT', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(date);
}

function addDays(value: string | null | undefined, days: number) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return new Date();
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function resolveDocumentVariant(sale: SalesDocumentSale): DocumentVariant {
  const docType = String(sale.doc_type ?? '').trim().toUpperCase();
  const docNumber = String(sale.document_number ?? '').trim().toUpperCase();

  if (docType === 'FT' || docType === 'FATURA' || docNumber.startsWith('FT/')) {
    return 'fatura';
  }
  if (docType === 'FP' || docNumber.startsWith('FP/')) {
    return 'cotacao';
  }
  if (docType.includes('RECIBO') || docNumber.startsWith('PBNK') || docNumber.startsWith('RC/')) {
    return 'recibo';
  }
  if (docType === 'TK' || docType === 'TALAO') {
    return 'talao';
  }
  return 'venda';
}

function buildCompanyAddressLines(profile: CompanyProfile | null) {
  const header = buildReceiptHeader(profile);
  return header.lines;
}

function buildItemsTable(items: SalesDocumentItem[], taxLabel: string) {
  const rows = items.length
    ? items
        .map((item, index) => {
          const qty = Number(item.quantity ?? 0);
          const unitPrice = Number(item.price ?? 0);
          const discount = Number(item.discount_amount ?? 0);
          const lineTotal = unitPrice * qty - discount;
          const unitLabel = String(item.unit ?? 'un').trim() || 'un';
          return `
            <tr class="${index % 2 === 1 ? 'row-alt' : ''}">
              <td>${escapeHtml(String(item.product_name ?? '-'))}</td>
              <td class="cell-center">${escapeHtml(`${qty.toFixed(2)} ${unitLabel}`)}</td>
              <td class="cell-right">${escapeHtml(formatA4Amount(unitPrice))}</td>
              <td class="cell-center">${escapeHtml(taxLabel)}</td>
              <td class="cell-right">${escapeHtml(formatA4Amount(lineTotal))}</td>
            </tr>
          `;
        })
        .join('')
    : `
      <tr>
        <td colspan="5" class="cell-center muted">Sem itens registados</td>
      </tr>
    `;

  return `
    <table class="items-table">
      <thead>
        <tr>
          <th>Descrição</th>
          <th>Quantidade</th>
          <th>Preço unitário</th>
          <th>Impostos</th>
          <th>Valor</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function buildTotalsBlock(subtotal: number, tax: number, total: number, extraRows = '') {
  return `
    <div class="totals-block">
      <div class="totals-row"><span>Valor sem impostos:</span><span>${escapeHtml(formatA4Amount(subtotal))}</span></div>
      <div class="totals-row"><span>${escapeHtml(getPosTaxPercentLabel())}:</span><span>${escapeHtml(formatA4Amount(tax))}</span></div>
      ${extraRows}
      <div class="totals-row total-final"><span>Total:</span><span>${escapeHtml(formatA4Amount(total))}</span></div>
    </div>
  `;
}

function buildDocumentHeader(
  profile: CompanyProfile | null,
  title: string,
  secondCopy: boolean,
) {
  const header = buildReceiptHeader(profile);
  const logoSrc = safeReceiptLogoSrc(header.logoDataUrl);
  const companyName = profile?.name?.trim() || header.title;
  const addressLines = buildCompanyAddressLines(profile);
  const taxId = profile?.taxId?.trim() || '';
  const secondCopyBadge = secondCopy
    ? '<div class="second-copy-badge">2ª Via</div>'
    : '';

  const logoHtml = logoSrc
    ? `<img src="${logoSrc}" alt="" class="company-logo" />`
    : `<div class="company-logo-fallback">${escapeHtml(companyName.slice(0, 2).toUpperCase())}</div>`;

  const addressHtml = addressLines.map((line) => `<div>${escapeHtml(line)}</div>`).join('');

  return `
    ${secondCopyBadge}
    <header class="doc-header">
      <div class="doc-header-left">${logoHtml}</div>
      <div class="doc-header-right">
        <div class="company-name">${escapeHtml(companyName)}</div>
        ${taxId ? `<div class="company-meta">${escapeHtml(taxId)}</div>` : ''}
        <div class="company-meta">${addressHtml}</div>
      </div>
    </header>
    <div class="doc-title-bar">
      <div class="doc-title">${escapeHtml(title)}</div>
    </div>
  `;
}

function buildDocumentFooter(profile: CompanyProfile | null) {
  const accounts = parseCompanyBankAccounts(profile?.bankDetails, profile?.bankAccountNumber);
  const structuredFooter = formatCompanyBankDetailsForFooter(accounts);
  const phone = profile?.phone?.trim();
  const footerLeft = structuredFooter
    ? structuredFooter
    : phone
      ? `Contacto: ${phone}`
      : '—';

  return `
    <footer class="doc-footer">
      <div>${escapeHtml(footerLeft)}</div>
      <div>Página 1/1</div>
    </footer>
  `;
}

function buildVendaBody(sale: SalesDocumentSale, items: SalesDocumentItem[]) {
  const subtotal = Number(sale.subtotal ?? (Number(sale.total ?? 0) - Number(sale.tax ?? 0)));
  const tax = Number(sale.tax ?? 0);
  const total = Number(sale.total ?? 0);
  const docNumber = String(sale.document_number ?? sale.id ?? '-');
  const payment = formatPaymentMethodLabel(sale.payment_method);
  const sourceReference = formatDocumentSourceReferenceLabel(sale);
  const notes = String(sale.notes ?? '').trim();

  return `
    <div class="client-name">${escapeHtml(sale.client_name || 'Consumidor final')}</div>
    <div class="meta-grid cols-3">
      <div class="meta-item"><div class="meta-label">Data da venda</div><div>${escapeHtml(formatA4Date(sale.created_at))}</div></div>
      <div class="meta-item"><div class="meta-label">Vendedor</div><div>${escapeHtml(sale.user_name || '—')}</div></div>
      <div class="meta-item"><div class="meta-label">Pagamento</div><div>${escapeHtml(payment)}</div></div>
    </div>
    ${sourceReference ? `<div class="payment-note">${escapeHtml(sourceReference)}</div>` : ''}
    ${notes ? `<div class="payment-note"><strong>${sale.is_waste ? 'Desperdício — ' : 'Observação — '}</strong>${escapeHtml(notes.replace(/^Desperdício:\s*/i, ''))}</div>` : ''}
    ${buildItemsTable(items, getPosTaxPercentLabel())}
    ${buildTotalsBlock(subtotal, tax, total)}
    <div class="payment-note">Documento: ${escapeHtml(docNumber)}</div>
  `;
}

function buildFaturaBody(sale: SalesDocumentSale, items: SalesDocumentItem[]) {
  const subtotal = Number(sale.subtotal ?? (Number(sale.total ?? 0) - Number(sale.tax ?? 0)));
  const tax = Number(sale.tax ?? 0);
  const total = Number(sale.total ?? 0);
  const docNumber = String(sale.document_number ?? sale.id ?? '-');
  const isPaid = String(sale.status ?? '').toLowerCase() === 'paid' || String(sale.payment_method ?? '').trim() !== '';

  const extraTotals = isPaid
    ? `
      <div class="totals-row"><span>Pago em ${escapeHtml(formatA4Date(sale.created_at))}:</span><span>${escapeHtml(formatA4Amount(total))}</span></div>
      <div class="totals-row"><span>Valor devido:</span><span>${escapeHtml(formatA4Amount(0))}</span></div>
    `
    : `
      <div class="totals-row"><span>Valor devido:</span><span>${escapeHtml(formatA4Amount(total))}</span></div>
    `;

  return `
    <div class="client-name">${escapeHtml(sale.client_name || 'Consumidor final')}</div>
    <div class="meta-grid cols-4">
      <div class="meta-item"><div class="meta-label">Data da fatura</div><div>${escapeHtml(formatA4Date(sale.created_at))}</div></div>
      <div class="meta-item"><div class="meta-label">Data de vencimento</div><div>${escapeHtml(formatA4Date(sale.created_at))}</div></div>
      <div class="meta-item"><div class="meta-label">Origem</div><div>${escapeHtml(docNumber)}</div></div>
      <div class="meta-item"><div class="meta-label">Referência</div><div>${escapeHtml(docNumber)}</div></div>
    </div>
    ${buildItemsTable(items, getPosTaxPercentLabel())}
    <div class="payment-info">
      <div>Comunicação de pagamento: ${escapeHtml(docNumber)}</div>
    </div>
    ${buildTotalsBlock(subtotal, tax, total, extraTotals)}
  `;
}

function buildCotacaoBody(sale: SalesDocumentSale, items: SalesDocumentItem[]) {
  const subtotal = Number(sale.subtotal ?? (Number(sale.total ?? 0) - Number(sale.tax ?? 0)));
  const tax = Number(sale.tax ?? 0);
  const total = Number(sale.total ?? 0);
  const expiry = addDays(sale.created_at, 30);

  return `
    <div class="client-name">${escapeHtml(sale.client_name || 'Consumidor final')}</div>
    <div class="meta-grid cols-3">
      <div class="meta-item"><div class="meta-label">Data da cotação</div><div>${escapeHtml(formatA4Date(sale.created_at))}</div></div>
      <div class="meta-item"><div class="meta-label">Expiração</div><div>${escapeHtml(formatA4Date(expiry.toISOString()))}</div></div>
      <div class="meta-item"><div class="meta-label">Vendedor</div><div>${escapeHtml(sale.user_name || '—')}</div></div>
    </div>
    ${buildItemsTable(items, getPosTaxPercentLabel())}
    ${buildTotalsBlock(subtotal, tax, total)}
  `;
}

function buildReciboBody(sale: SalesDocumentSale) {
  const total = Number(sale.total ?? 0);
  const docNumber = String(sale.document_number ?? sale.id ?? '-');
  const invoiceRef = String(sale.approved_document_number ?? '').trim();
  const invoiceType = String(sale.approved_document_type ?? 'FT').trim().toUpperCase();
  const invoiceLabel = invoiceType === 'FP' ? 'Cotação' : 'Fatura';
  const sourceReference = formatDocumentSourceReferenceLabel(sale);

  return `
    <div class="meta-grid cols-2 recibo-meta">
      <div>
        <div class="meta-item"><div class="meta-label">Data de pagamento</div><div>${escapeHtml(formatA4Date(sale.created_at))}</div></div>
        <div class="meta-item"><div class="meta-label">Cliente</div><div>${escapeHtml(sale.client_name || 'Consumidor final')}</div></div>
        <div class="meta-item"><div class="meta-label">Valor do pagamento</div><div>${escapeHtml(formatA4Amount(total))}</div></div>
      </div>
      <div>
        <div class="meta-item"><div class="meta-label">Formas de pagamento</div><div>${escapeHtml(formatPaymentMethodLabel(sale.payment_method, 'Pagamento manual'))}</div></div>
        <div class="meta-item"><div class="meta-label">Referência</div><div>${escapeHtml(sourceReference || (invoiceRef ? `Referente à ${invoiceLabel.toLowerCase()} ${invoiceRef}` : docNumber))}</div></div>
      </div>
    </div>
    <table class="items-table recibo-table">
      <thead>
        <tr>
          <th>Data da fatura</th>
          <th>Número da fatura</th>
          <th>Referência</th>
          <th>Valor</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>${escapeHtml(formatA4Date(sale.created_at))}</td>
          <td>${escapeHtml(invoiceRef || '—')}</td>
          <td>${escapeHtml(docNumber)}</td>
          <td class="cell-right">${escapeHtml(formatA4Amount(total))}</td>
        </tr>
        <tr class="row-alt">
          <td>${escapeHtml(formatA4Date(sale.created_at))}</td>
          <td>${escapeHtml(docNumber)}</td>
          <td>${escapeHtml(invoiceRef || docNumber)}</td>
          <td class="cell-right">-${escapeHtml(formatA4Amount(total))}</td>
        </tr>
        <tr class="summary-row">
          <td colspan="3"><strong>Valor devido por ${escapeHtml(invoiceRef || docNumber)}</strong></td>
          <td class="cell-right"><strong>${escapeHtml(formatA4Amount(0))}</strong></td>
        </tr>
      </tbody>
    </table>
  `;
}

function resolveDocumentTitle(variant: DocumentVariant, sale: SalesDocumentSale) {
  const docNumber = String(sale.document_number ?? sale.id ?? '-');
  if (variant === 'fatura') return `Fatura ${docNumber}`;
  if (variant === 'cotacao') return `Cotação nº ${docNumber}`;
  if (variant === 'recibo') return `Recibo de pagamento: ${docNumber}`;
  if (variant === 'talao') return `Talão ${docNumber}`;
  return `Venda ${docNumber}`;
}

export function buildSalesDocumentHtml(
  sale: SalesDocumentSale,
  items: SalesDocumentItem[],
  profile: CompanyProfile | null,
  options?: { secondCopy?: boolean },
) {
  const secondCopy = Boolean(options?.secondCopy);
  const variant = resolveDocumentVariant(sale);
  const title = resolveDocumentTitle(variant, sale);

  let body = '';
  if (variant === 'fatura') body = buildFaturaBody(sale, items);
  else if (variant === 'cotacao') body = buildCotacaoBody(sale, items);
  else if (variant === 'recibo') body = buildReciboBody(sale);
  else body = buildVendaBody(sale, items);

  return `
    <div class="a4-document ${secondCopy ? 'is-second-copy' : ''}">
      ${buildDocumentHeader(profile, title, secondCopy)}
      <main class="doc-body">${body}</main>
      ${buildDocumentFooter(profile)}
    </div>
  `;
}

const A4_DOCUMENT_STYLES = `
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: "Segoe UI", Arial, sans-serif;
    background: #e5e7eb;
    color: #1f2937;
  }
  .a4-document {
    position: relative;
    width: 210mm;
    min-height: 297mm;
    margin: 0 auto;
    padding: 14mm 16mm 12mm;
    background: #fff;
    display: flex;
    flex-direction: column;
  }
  .second-copy-badge {
    position: absolute;
    top: 18mm;
    right: 16mm;
    padding: 4px 10px;
    border: 2px solid ${BRAND_GREEN};
    color: ${BRAND_GREEN};
    font-weight: 800;
    font-size: 13px;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    background: rgba(255,255,255,0.92);
    z-index: 2;
  }
  .is-second-copy::after {
    content: "";
    position: absolute;
    inset: 0;
    background: repeating-linear-gradient(
      -35deg,
      transparent,
      transparent 80px,
      rgba(47, 143, 91, 0.03) 80px,
      rgba(47, 143, 91, 0.03) 160px
    );
    pointer-events: none;
  }
  .doc-header {
    display: grid;
    grid-template-columns: 120px 1fr;
    gap: 18px;
    align-items: start;
    margin-bottom: 10px;
  }
  .company-logo {
    max-width: 110px;
    max-height: 72px;
    object-fit: contain;
  }
  .company-logo-fallback {
    width: 72px;
    height: 72px;
    border-radius: 12px;
    background: ${BRAND_GREEN_LIGHT};
    color: ${BRAND_GREEN};
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: 800;
    font-size: 22px;
  }
  .doc-header-right { text-align: right; }
  .company-name {
    color: ${BRAND_GREEN};
    font-size: 22px;
    font-weight: 800;
    line-height: 1.2;
  }
  .company-meta {
    margin-top: 4px;
    font-size: 11px;
    line-height: 1.45;
    color: #374151;
  }
  .doc-title-bar {
    display: flex;
    justify-content: flex-end;
    margin: 8px 0 18px;
  }
  .doc-title {
    background: linear-gradient(90deg, transparent 0%, ${BRAND_GREEN_LIGHT} 18%, ${BRAND_GREEN_LIGHT} 100%);
    color: ${BRAND_GREEN};
    font-size: 24px;
    font-weight: 800;
    padding: 10px 18px 10px 42px;
    min-width: 52%;
    text-align: right;
    clip-path: polygon(8% 0, 100% 0, 100% 100%, 0 100%);
  }
  .doc-body { flex: 1; }
  .client-name {
    font-size: 18px;
    font-weight: 700;
    margin-bottom: 14px;
  }
  .meta-grid {
    display: grid;
    gap: 12px 20px;
    margin-bottom: 18px;
    padding-bottom: 12px;
    border-bottom: 1px solid #e5e7eb;
  }
  .meta-grid.cols-2 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .meta-grid.cols-3 { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .meta-grid.cols-4 { grid-template-columns: repeat(4, minmax(0, 1fr)); }
  .meta-item { font-size: 12px; line-height: 1.45; }
  .meta-label { font-weight: 700; margin-bottom: 2px; }
  .items-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 11px;
    margin-bottom: 16px;
  }
  .items-table th {
    background: #d9d9d9;
    padding: 8px 10px;
    text-align: left;
    font-weight: 700;
  }
  .items-table td {
    padding: 8px 10px;
    border-bottom: 1px solid #ececec;
    vertical-align: top;
  }
  .items-table .row-alt td { background: #f3f4f6; }
  .items-table .summary-row td { background: #eceff1; }
  .cell-right { text-align: right; white-space: nowrap; }
  .cell-center { text-align: center; }
  .muted { color: #6b7280; }
  .totals-block {
    margin-left: auto;
    width: min(320px, 100%);
    font-size: 12px;
  }
  .totals-row {
    display: flex;
    justify-content: space-between;
    gap: 16px;
    padding: 4px 0;
  }
  .totals-row.total-final {
    margin-top: 6px;
    padding-top: 8px;
    border-top: 1px solid #d1d5db;
    color: ${BRAND_GREEN};
    font-size: 15px;
    font-weight: 800;
  }
  .payment-info, .payment-note {
    margin: 14px 0;
    font-size: 11px;
    color: #4b5563;
  }
  .doc-footer {
    margin-top: auto;
    padding-top: 18px;
    border-top: 1px solid #111827;
    display: flex;
    justify-content: space-between;
    gap: 12px;
    font-size: 10px;
    color: #111827;
  }
  @media print {
    body { background: white; }
    .pdf-hint { display: none !important; }
    .a4-document {
      width: auto;
      min-height: auto;
      margin: 0;
      padding: 0;
    }
    @page { size: A4 portrait; margin: 12mm; }
  }
`;

export function openSalesDocumentWindow(
  html: string,
  options: {
    title: string;
    autoPrint?: boolean;
    pdfHint?: boolean;
  },
) {
  const printWindow = window.open('', '_blank', 'width=900,height=1100');
  if (!printWindow) return false;

  const pdfNote = options.pdfHint
    ? '<p class="pdf-hint" style="font-family:Segoe UI,Arial,sans-serif;padding:12px 16px;margin:0;background:#eff6ff;color:#1e3a8a;font-size:13px;">Para guardar como PDF, escolha <strong>Guardar como PDF</strong> ou <strong>Microsoft Print to PDF</strong> como destino de impressão.</p>'
    : '';

  printWindow.document.write(`
    <html>
      <head>
        <title>${escapeHtml(options.title)}</title>
        <style>${A4_DOCUMENT_STYLES}</style>
      </head>
      <body>
        ${pdfNote}
        ${html}
      </body>
    </html>
  `);
  printWindow.document.close();
  printWindow.focus();

  if (options.autoPrint !== false) {
    window.setTimeout(() => {
      printWindow.print();
    }, 300);
  }

  return true;
}

export function printSalesDocumentSecondCopy(
  sale: SalesDocumentSale,
  items: SalesDocumentItem[],
  profile: CompanyProfile | null,
) {
  const docNumber = String(sale.document_number ?? sale.id ?? 'documento');
  const html = buildSalesDocumentHtml(sale, items, profile, { secondCopy: true });
  return openSalesDocumentWindow(html, {
    title: `${docNumber} — 2ª Via`,
    autoPrint: true,
  });
}

export function saveSalesDocumentAsPdf(
  sale: SalesDocumentSale,
  items: SalesDocumentItem[],
  profile: CompanyProfile | null,
) {
  const docNumber = String(sale.document_number ?? sale.id ?? 'documento');
  const html = buildSalesDocumentHtml(sale, items, profile, { secondCopy: false });
  return openSalesDocumentWindow(html, {
    title: docNumber,
    autoPrint: true,
    pdfHint: true,
  });
}
