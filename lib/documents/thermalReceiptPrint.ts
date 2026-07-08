import type { CompanyProfile } from '@/app/pos/types';
import { buildReceiptHeader, safeReceiptLogoSrc } from '@/lib/receiptCompanyHeader';
import { getPosTaxPercentLabel } from '@/lib/taxConfig';
import type { SalesDocumentItem, SalesDocumentSale } from '@/lib/documents/salesDocumentPrint';

const THERMAL_ROLL_WIDTH_MM = 80;

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatReceiptAmount(value: number) {
  const n = Number(value);
  const safe = Number.isFinite(n) ? n : 0;
  return `${safe.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}MT`;
}

function resolveDocTypeLabel(sale: SalesDocumentSale) {
  const raw = String(sale.doc_type ?? '').trim().toUpperCase();
  if (raw === 'VD' || raw === 'VENDA') return 'VD';
  if (raw === 'FT' || raw === 'FATURA') return 'FT';
  if (raw === 'FP') return 'FP';
  if (raw === 'TK' || raw === 'TALAO') return 'TK';
  return raw || 'VD';
}

function formatSaleDate(value: string | null | undefined) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return new Date().toLocaleString('pt-PT');
  return date.toLocaleString('pt-PT');
}

export function buildThermalReceiptMarkup(
  sale: SalesDocumentSale,
  items: SalesDocumentItem[],
  profile: CompanyProfile | null,
  options?: { secondCopy?: boolean },
) {
  const secondCopy = Boolean(options?.secondCopy);
  const docType = resolveDocTypeLabel(sale);
  const docNumber = String(sale.document_number ?? sale.id ?? '-');
  const customerLabel = sale.client_name?.trim() || 'Consumidor Final';
  const attendant = sale.user_name?.trim() || 'Admin';
  const paymentMethod = String(sale.payment_method ?? '-');
  const subtotal = Number(sale.subtotal ?? (Number(sale.total ?? 0) - Number(sale.tax ?? 0)));
  const tax = Number(sale.tax ?? 0);
  const total = Number(sale.total ?? 0);
  const discount = Number(sale.discount ?? 0);
  const originalSubtotal = subtotal + discount;
  const hasDiscount = discount > 0.0001;

  const receiptHead = buildReceiptHeader(profile);
  const logoSrc = safeReceiptLogoSrc(receiptHead.logoDataUrl);
  const headerTitleHtml = logoSrc
    ? `<div class="print-logo-wrap"><img src="${logoSrc}" alt="" class="print-logo" /></div>`
    : `<div class="logo">${escapeHtml(receiptHead.title)}</div>`;
  const headerLinesHtml = receiptHead.lines.map((line) => `<div>${escapeHtml(line)}</div>`).join('');

  const itemRows = items
    .map((item) => {
      const qty = Number(item.quantity ?? 0);
      const unitPrice = Number(item.price ?? 0);
      const lineDiscount = Number(item.discount_amount ?? 0);
      const lineTotal = unitPrice * qty - lineDiscount;
      return `
        <div class="print-item-row">
          <span class="qty">${qty.toFixed(2)}</span>
          <span class="desc">${escapeHtml(String(item.product_name ?? '-'))}</span>
          <span class="unit">${formatReceiptAmount(unitPrice)}</span>
          <span class="line-total">${formatReceiptAmount(lineTotal)}</span>
        </div>
      `;
    })
    .join('');

  const discountRowHtml = hasDiscount
    ? `
      <div class="print-row discount-row">
        <span>Desconto:</span>
        <span>-${formatReceiptAmount(discount)}</span>
      </div>
    `
    : '';

  const secondCopyHtml = secondCopy
    ? '<div class="second-copy">*** 2ª VIA ***</div>'
    : '';

  return `
    <div class="print-receipt payment-receipt">
      <div class="print-header">
        ${headerTitleHtml}
        ${headerLinesHtml}
        <div class="customer">Cliente: ${escapeHtml(customerLabel)}</div>
      </div>

      ${secondCopyHtml}

      <div class="print-block">
        <div class="print-meta">
          <span>Data: ${escapeHtml(formatSaleDate(sale.created_at))}</span>
          <span>Atendido por: ${escapeHtml(attendant)}</span>
        </div>
        <div class="print-doc">${escapeHtml(docType)} No.: ${escapeHtml(docNumber)}</div>
      </div>

      <div class="print-block">
        <div class="print-columns">
          <span class="qty">Qt</span>
          <span class="desc">Descricao</span>
          <span class="unit">P.Unit</span>
          <span class="line-total">Valor</span>
        </div>
        <div class="print-divider"></div>
        <div class="print-items">${itemRows || '<div class="print-item-row"><span class="desc">Sem itens</span></div>'}</div>
        <div class="print-divider"></div>
      </div>

      <div class="print-totals">
        <div class="print-row">
          <span>Subtotal:</span>
          <span>${formatReceiptAmount(originalSubtotal)}</span>
        </div>
        ${discountRowHtml}
        <div class="print-row">
          <span>IVA (${escapeHtml(getPosTaxPercentLabel())}):</span>
          <span>${formatReceiptAmount(tax)}</span>
        </div>
        <div class="print-divider"></div>
        <div class="print-row total-row">
          <span>Total:</span>
          <span>${formatReceiptAmount(total)}</span>
        </div>
      </div>

      <div class="print-block">
        <div class="print-row print-pay-header">
          <span>Método de Pagamento</span>
          <span>Valor</span>
        </div>
        <div class="print-divider"></div>
        <div class="print-row payment-row">
          <span>${escapeHtml(paymentMethod)}</span>
          <span>${formatReceiptAmount(total)}</span>
        </div>
      </div>

      <div class="print-footer">
        <div>IVA Incluso</div>
        <div>Processada por Computador</div>
        <div>Obrigado pela preferência!</div>
        <div class="foot-note">Sistema desenvolvido por: Nicolau Nino</div>
      </div>
    </div>
  `;
}

const THERMAL_PRINT_STYLES = `
  html, body {
    width: ${THERMAL_ROLL_WIDTH_MM}mm;
    height: auto !important;
    min-height: 0 !important;
    max-height: none !important;
    margin: 0 !important;
    padding: 0 !important;
    background: white;
  }
  @media print {
    html, body {
      height: auto !important;
      min-height: 0 !important;
      max-height: none !important;
      overflow: visible !important;
    }
    @page {
      margin: 0 !important;
    }
  }
  body {
    font-family: Consolas, 'Lucida Console', 'Courier New', monospace;
    color: black;
    background: white;
    width: ${THERMAL_ROLL_WIDTH_MM}mm;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: flex-start;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  * { box-sizing: border-box; }
  .print-receipt {
    width: 100%;
    max-width: ${THERMAL_ROLL_WIDTH_MM}mm;
    margin: 0 auto;
    padding: 0.5mm 2mm;
  }
  .print-header {
    text-align: center;
    font-size: 11px;
    font-weight: 800;
    line-height: 1.35;
  }
  .logo {
    font-size: 26px;
    font-weight: 900;
    letter-spacing: 0.4px;
    margin-bottom: 4px;
  }
  .print-logo-wrap {
    margin-bottom: 4px;
    display: flex;
    justify-content: center;
  }
  .print-logo {
    max-height: 18mm;
    max-width: 100%;
    object-fit: contain;
    display: block;
    filter: grayscale(1) contrast(1.2);
    -webkit-filter: grayscale(1) contrast(1.2);
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .customer { margin-top: 6px; }
  .second-copy {
    margin-top: 8px;
    text-align: center;
    font-size: 13px;
    font-weight: 900;
    letter-spacing: 0.08em;
  }
  .print-block {
    padding-top: 4px;
    margin-top: 6px;
  }
  .print-meta,
  .print-row,
  .print-columns {
    display: flex;
    justify-content: space-between;
    gap: 6px;
  }
  .print-meta {
    font-size: 10px;
    font-weight: 700;
  }
  .print-meta span:last-child { text-align: right; }
  .print-doc {
    margin-top: 6px;
    font-size: 13px;
    font-weight: 900;
  }
  .print-columns {
    font-size: 10px;
    font-weight: 800;
    margin-bottom: 3px;
  }
  .qty { width: 10mm; flex: 0 0 10mm; }
  .desc { flex: 1 1 auto; min-width: 0; }
  .unit { width: 17mm; flex: 0 0 17mm; text-align: right; }
  .line-total { width: 19mm; flex: 0 0 19mm; text-align: right; }
  .print-divider {
    border-top: 1px dashed #000;
    margin: 4px 0;
  }
  .print-items { padding-top: 1px; }
  .print-item-row {
    display: grid;
    grid-template-columns: 10mm minmax(0, 1fr) 17mm 19mm;
    gap: 5px;
    align-items: start;
    font-size: 10px;
    font-weight: 800;
    padding: 2px 0;
  }
  .print-totals {
    margin-top: 8px;
    font-size: 11px;
    font-weight: 800;
  }
  .print-totals .print-row { margin-top: 3px; }
  .print-totals .discount-row span:last-child { font-weight: 900; }
  .total-row {
    margin-top: 6px;
    padding-top: 6px;
    font-size: 17px;
    font-weight: 900;
  }
  .print-pay-header {
    font-size: 10px;
    font-weight: 800;
    margin-bottom: 3px;
  }
  .payment-row {
    font-size: 10px;
    margin-top: 4px;
    font-weight: 800;
  }
  .print-footer {
    border-top: 1px dashed #000;
    margin-top: 6px;
    padding-top: 6px;
    padding-bottom: 0;
    text-align: center;
    font-size: 11px;
    font-weight: 800;
    line-height: 1.45;
  }
  .foot-note {
    margin-top: 4px;
    margin-bottom: 0;
    font-size: 10px;
    font-style: italic;
    font-weight: 900;
  }
`;

function buildThermalPrintHtml(markup: string, estimatedHeightMm: number) {
  return `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <title></title>
    <style id="page-size-style">
      @page {
        size: ${THERMAL_ROLL_WIDTH_MM}mm ${estimatedHeightMm}mm;
        margin: 0;
      }
    </style>
    <style>${THERMAL_PRINT_STYLES}</style>
  </head>
  <body>${markup}</body>
</html>`;
}

function printThermalHtml(printHtml: string): Promise<boolean> {
  return new Promise((resolve) => {
    const iframe = document.createElement('iframe');
    iframe.setAttribute(
      'style',
      'position:fixed;right:0;bottom:0;width:0;height:0;border:0;margin:0;padding:0;opacity:0;pointer-events:none;',
    );
    iframe.setAttribute('aria-hidden', 'true');
    document.body.appendChild(iframe);

    const removeIframe = () => {
      try {
        iframe.remove();
      } catch {
        /* ignore */
      }
    };

    const onLoad = () => {
      const doc = iframe.contentDocument;
      const win = iframe.contentWindow;
      if (!doc || !win) {
        removeIframe();
        resolve(false);
        return;
      }

      const runPrint = () => {
        const receipt = doc.querySelector<HTMLElement>('.print-receipt');
        const styleTag = doc.getElementById('page-size-style');
        if (receipt && styleTag) {
          const px = Math.max(receipt.scrollHeight, receipt.offsetHeight);
          const mm = Math.max(28, Math.ceil((px * 25.4) / 96));
          styleTag.textContent = `@page { size: ${THERMAL_ROLL_WIDTH_MM}mm ${mm}mm; margin: 0 !important; }`;
        }
        void doc.body?.offsetHeight;

        const fallbackRemove = window.setTimeout(removeIframe, 120000);
        const done = () => {
          window.clearTimeout(fallbackRemove);
          window.setTimeout(removeIframe, 150);
          resolve(true);
        };
        win.addEventListener('afterprint', done, { once: true });

        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            win.print();
          });
        });
      };

      if (doc.fonts?.ready) {
        doc.fonts.ready.then(runPrint).catch(runPrint);
      } else {
        runPrint();
      }
    };

    iframe.addEventListener('load', onLoad, { once: true });
    iframe.srcdoc = printHtml;
  });
}

export async function printSalesDocumentThermalSecondCopy(
  sale: SalesDocumentSale,
  items: SalesDocumentItem[],
  profile: CompanyProfile | null,
) {
  const markup = buildThermalReceiptMarkup(sale, items, profile, { secondCopy: true });
  const estimatedHeightMm = Math.max(34, 66 + items.length * 9 + 34);
  const printHtml = buildThermalPrintHtml(markup, estimatedHeightMm);

  if (window.electronAPI?.printReceipt) {
    try {
      const result = await window.electronAPI.printReceipt(printHtml);
      if (result?.success) return true;
    } catch {
      /* fallback to browser print */
    }
  }

  return printThermalHtml(printHtml);
}
