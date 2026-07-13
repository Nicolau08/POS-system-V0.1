/** Largura do rolo (papel). */
export function resolveThermalWidthMm(paperWidth?: string | number | null): number {
  const n = Number(paperWidth);
  if (n === 58) return 58;
  return 80;
}

/** Largura enviada ao Chromium. */
export function resolveThermalPrintPageWidthMm(paperWidth?: string | number | null): number {
  const n = Number(paperWidth);
  if (n === 58) return 58;
  return 72;
}

export type ThermalPrintMargins = {
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;
};

function clampMargin(value: unknown, fallback = 0): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(-20, Math.min(20, n));
}

/** CSS base para recibo térmico — margens manuais (mm) do modal General. */
export function buildThermalPrintPageCss(
  widthMm = 80,
  margins?: ThermalPrintMargins | null,
): string {
  const roll = widthMm === 58 ? 58 : 80;
  const top = clampMargin(margins?.top, 0);
  const right = clampMargin(margins?.right, 3);
  const bottom = clampMargin(margins?.bottom, 0);
  const left = clampMargin(margins?.left, 2);
  const contentW = Math.max(40, roll - Math.max(0, left) - Math.max(0, right) - 2);

  return `
    @page {
      size: ${roll}mm auto;
      margin: 0 !important;
    }
    html, body {
      width: ${roll}mm !important;
      max-width: ${roll}mm !important;
      margin: 0 !important;
      padding: 0 !important;
      background: #fff !important;
      color: #000 !important;
      overflow: visible !important;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }
    body {
      font-family: "Courier New", Consolas, monospace !important;
      font-size: 11px !important;
      line-height: 1.25 !important;
      width: ${roll}mm !important;
      box-sizing: border-box !important;
      padding: ${top}mm ${right}mm ${bottom}mm ${left}mm !important;
    }
    * {
      box-sizing: border-box !important;
      color: #000 !important;
      background: transparent !important;
      box-shadow: none !important;
      text-shadow: none !important;
    }
    .print-receipt {
      width: 100% !important;
      max-width: ${contentW}mm !important;
      margin: 0 !important;
      padding: 0 !important;
    }
    .print-header {
      text-align: center;
      font-size: 11px;
      font-weight: 800;
      line-height: 1.35;
    }
    .print-extra-header,
    .print-extra-footer {
      white-space: pre-wrap;
      word-break: break-word;
      font-size: 10px;
      font-weight: 700;
      margin: 4px 0;
    }
    .print-extra-header.align-left,
    .print-extra-footer.align-left { text-align: left; }
    .print-extra-header.align-center,
    .print-extra-footer.align-center { text-align: center; }
    .logo {
      font-size: 16px;
      font-weight: 900;
      margin-bottom: 4px;
    }
    .print-logo-wrap {
      margin-bottom: 4px;
      text-align: center;
    }
    .print-logo {
      max-height: 14mm;
      max-width: 100%;
      object-fit: contain;
      display: inline-block;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .customer { margin-top: 6px; }
    .print-block { padding-top: 4px; margin-top: 6px; }
    .print-row,
    .print-columns {
      display: flex;
      justify-content: space-between;
      gap: 4px;
    }
    .print-meta {
      display: flex !important;
      justify-content: space-between;
      align-items: flex-start;
      gap: 4mm;
      font-size: 10px;
      font-weight: 700;
    }
    .print-meta-col {
      display: flex;
      flex-direction: column;
      gap: 1px;
      min-width: 0;
    }
    .print-meta-col.print-meta-right {
      text-align: right;
      align-items: flex-end;
    }
    .print-meta span,
    .print-meta .print-meta-sub,
    .print-meta .print-attendant {
      display: block !important;
      text-align: inherit !important;
      word-break: break-word;
    }
    .print-meta .print-attendant {
      font-weight: 900;
    }
    .print-doc { margin-top: 6px; font-size: 12px; font-weight: 900; }
    .print-columns {
      display: grid !important;
      grid-template-columns: 7mm minmax(0, 1fr) 20mm 22mm;
      gap: 1.5mm;
      font-size: 11px;
      font-weight: 800;
      margin-bottom: 3px;
    }
    .qty { width: 7mm; flex: 0 0 7mm; }
    .desc {
      flex: 1 1 auto;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      padding-right: 1mm;
    }
    .unit {
      width: 20mm;
      flex: 0 0 20mm;
      text-align: right;
      white-space: nowrap;
      padding-left: 1.5mm;
    }
    .line-total {
      width: 22mm;
      flex: 0 0 22mm;
      text-align: right;
      white-space: nowrap;
      padding-left: 2.5mm;
    }
    .print-divider { border-top: 1px dashed #000; margin: 4px 0; }
    .payment-divider { margin-top: 6px; }
    .print-items { padding-top: 1px; }
    .print-item-row {
      display: grid;
      grid-template-columns: 7mm minmax(0, 1fr) 20mm 22mm;
      column-gap: 1.5mm;
      align-items: start;
      font-size: 11px;
      font-weight: 800;
      padding: 2px 0;
    }
    .print-item-row .unit,
    .print-item-row .line-total {
      font-size: 11px;
      letter-spacing: -0.02em;
    }
    .print-totals { margin-top: 8px; font-size: 11px; font-weight: 800; }
    .print-totals .print-row { margin-top: 3px; }
    .print-totals .print-row span:last-child {
      white-space: nowrap;
      text-align: right;
    }
    .total-row {
      margin-top: 6px;
      padding-top: 6px;
      font-size: 14px;
      font-weight: 900;
    }
    .print-pay-header { font-size: 10px; font-weight: 800; margin-bottom: 3px; }
    .payment-row { font-size: 10px; margin-top: 4px; font-weight: 800; }
    .print-change { margin-top: 4px; padding-top: 4px; font-size: 10px; font-weight: 800; }
    .print-footer {
      border-top: 1px dashed #000;
      margin-top: 6px;
      padding-top: 6px;
      text-align: center;
      font-size: 10px;
      font-weight: 800;
      line-height: 1.45;
      word-break: break-word;
    }
    .foot-note {
      margin-top: 4px;
      font-size: 9px;
      font-style: italic;
      font-weight: 900;
      word-break: break-word;
    }
  `.trim();
}

/** Opções Electron para rolo térmico (microns: 1 mm = 1000). */
export function buildElectronThermalPrintOptions(options: {
  printer?: string;
  copies?: number;
  widthMm?: number;
  heightMm?: number;
}) {
  const roll = options.widthMm === 58 ? 58 : 80;
  const pageW = resolveThermalPrintPageWidthMm(roll);
  const heightMm = Math.max(80, Math.min(2000, Number(options.heightMm) || 200));
  return {
    silent: true,
    printBackground: false,
    deviceName: options.printer,
    copies: Math.max(1, Math.min(5, Number(options.copies) || 1)),
    margins: { marginType: 'none' as const },
    pageSize: {
      width: pageW * 1000,
      height: heightMm * 1000,
    },
    scaleFactor: 100,
  };
}
