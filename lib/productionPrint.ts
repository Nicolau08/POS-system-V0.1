import {
  buildThermalPrintPageCss,
  resolveThermalWidthMm,
} from '@/lib/thermalPrintPage';
import {
  fetchCategories,
  fetchPrintCenters,
  type PrintCenter,
} from '@/lib/services/posService';

export type ProductionPrintItem = {
  name: string;
  quantity: number;
  category_id?: string | number | null;
  category?: string | null;
  notes?: string | null;
};

export type ProductionTicket = {
  center: PrintCenter;
  items: ProductionPrintItem[];
};

function buildCategoryParentMap(
  categories: Array<{ id: string; parent_id: string | null }>,
): Map<string, string | null> {
  const map = new Map<string, string | null>();
  for (const cat of categories) {
    map.set(String(cat.id), cat.parent_id != null ? String(cat.parent_id) : null);
  }
  return map;
}

function resolveCenterForCategory(
  categoryId: string | null | undefined,
  categoryName: string | null | undefined,
  centers: PrintCenter[],
  parentMap: Map<string, string | null>,
  categoriesByName: Map<string, string>,
): PrintCenter | null {
  const enabled = centers.filter((c) => c.enabled);
  if (!enabled.length) return null;

  const categoryToCenter = new Map<string, PrintCenter>();
  for (const center of enabled) {
    for (const id of center.categoryIds) {
      categoryToCenter.set(String(id), center);
    }
  }

  let currentId =
    categoryId != null && String(categoryId).trim()
      ? String(categoryId)
      : categoryName
        ? categoriesByName.get(String(categoryName).trim().toLowerCase()) || ''
        : '';

  const visited = new Set<string>();
  while (currentId && !visited.has(currentId)) {
    visited.add(currentId);
    const center = categoryToCenter.get(currentId);
    if (center) return center;
    currentId = parentMap.get(currentId) || '';
  }
  return null;
}

/** Agrupa itens do carrinho por centro de impressão (família/grupo). */
export async function groupItemsByPrintCenter(
  items: ProductionPrintItem[],
): Promise<ProductionTicket[]> {
  const [centers, categories] = await Promise.all([fetchPrintCenters(), fetchCategories()]);
  const parentMap = buildCategoryParentMap(categories);
  const categoriesByName = new Map(
    categories.map((c) => [String(c.name).trim().toLowerCase(), String(c.id)]),
  );

  const buckets = new Map<string, ProductionTicket>();

  for (const item of items) {
    if (!item || Number(item.quantity) <= 0) continue;
    const center = resolveCenterForCategory(
      item.category_id != null ? String(item.category_id) : null,
      item.category ?? null,
      centers,
      parentMap,
      categoriesByName,
    );
    if (!center) continue;
    const existing = buckets.get(center.id);
    if (existing) {
      existing.items.push(item);
    } else {
      buckets.set(center.id, { center, items: [item] });
    }
  }

  return [...buckets.values()];
}

function escapeHtml(value: string): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function buildProductionTicketHtml(options: {
  centerName: string;
  items: ProductionPrintItem[];
  paperWidth?: number;
  tableLabel?: string | null;
  docLabel?: string | null;
  timeLabel?: string | null;
}): { printHtml: string; widthMm: number } {
  const widthMm = resolveThermalWidthMm(options.paperWidth ?? 80);
  const css = buildThermalPrintPageCss(widthMm, { top: 0, right: 2, bottom: 0, left: 2 });
  const rows = options.items
    .map((item) => {
      const qty = Number(item.quantity) || 0;
      const notes = item.notes ? `<div class="note">${escapeHtml(String(item.notes))}</div>` : '';
      return `<tr><td class="qty">${qty}x</td><td>${escapeHtml(item.name)}${notes}</td></tr>`;
    })
    .join('');

  const meta = [
    options.tableLabel ? `Mesa: ${escapeHtml(options.tableLabel)}` : '',
    options.docLabel ? escapeHtml(options.docLabel) : '',
    options.timeLabel ? escapeHtml(options.timeLabel) : '',
  ]
    .filter(Boolean)
    .join(' · ');

  const printHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"/><style>${css}
    .ticket-title { text-align:center; font-weight:900; font-size:14px; margin-bottom:6px; }
    .ticket-meta { text-align:center; font-size:10px; margin-bottom:8px; }
    table { width:100%; border-collapse:collapse; }
    td { vertical-align:top; padding:2px 0; font-size:12px; font-weight:700; }
    td.qty { width:28px; }
    .note { font-size:10px; font-weight:600; }
    .rule { border-top:1px dashed #000; margin:6px 0; }
  </style></head><body><div class="print-receipt">
    <div class="ticket-title">${escapeHtml(options.centerName)}</div>
    ${meta ? `<div class="ticket-meta">${meta}</div>` : ''}
    <div class="rule"></div>
    <table>${rows}</table>
    <div class="rule"></div>
  </div></body></html>`;

  return { printHtml, widthMm };
}

function encodeEscPosText(text: string): Uint8Array {
  // Latin-1 fallback for thermal printers (CP437 approx for ASCII + common accents stripped lightly).
  const normalized = text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x00-\xff]/g, '?');
  const bytes = new Uint8Array(normalized.length);
  for (let i = 0; i < normalized.length; i += 1) {
    bytes[i] = normalized.charCodeAt(i) & 0xff;
  }
  return bytes;
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((acc, part) => acc + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

export function buildProductionTicketEscPos(options: {
  centerName: string;
  items: ProductionPrintItem[];
  tableLabel?: string | null;
  docLabel?: string | null;
  timeLabel?: string | null;
}): Uint8Array {
  const lines: string[] = [];
  lines.push(options.centerName.toUpperCase());
  lines.push('--------------------------------');
  if (options.tableLabel) lines.push(`Mesa: ${options.tableLabel}`);
  if (options.docLabel) lines.push(options.docLabel);
  if (options.timeLabel) lines.push(options.timeLabel);
  lines.push('--------------------------------');
  for (const item of options.items) {
    lines.push(`${Number(item.quantity) || 0}x ${item.name}`);
    if (item.notes) lines.push(`  ${item.notes}`);
  }
  lines.push('--------------------------------');
  lines.push('');

  const init = new Uint8Array([0x1b, 0x40]); // ESC @
  const body = encodeEscPosText(`${lines.join('\n')}\n`);
  const cut = new Uint8Array([0x1d, 0x56, 0x00]); // GS V 0
  return concatBytes([init, body, cut]);
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

export type ProductionPrintMeta = {
  tableLabel?: string | null;
  docLabel?: string | null;
  timeLabel?: string | null;
};

/** Envia tickets de produção para Windows (HTML) ou rede (ESC/POS TCP). */
export async function printProductionTickets(
  items: ProductionPrintItem[],
  meta: ProductionPrintMeta = {},
): Promise<{ printed: number; errors: string[] }> {
  const tickets = await groupItemsByPrintCenter(items);
  if (!tickets.length) return { printed: 0, errors: [] };

  const errors: string[] = [];
  let printed = 0;

  for (const ticket of tickets) {
    const { center, items: ticketItems } = ticket;
    try {
      if (center.connectionType === 'network') {
        const host = String(center.host || '').trim();
        if (!host) {
          errors.push(`${center.name}: IP em falta`);
          continue;
        }
        if (!window.electronAPI?.printNetwork) {
          errors.push(`${center.name}: impressão de rede só na app desktop`);
          continue;
        }
        const bytes = buildProductionTicketEscPos({
          centerName: center.name,
          items: ticketItems,
          ...meta,
        });
        const result = await window.electronAPI.printNetwork({
          host,
          port: center.port || 9100,
          bytesBase64: toBase64(bytes),
        });
        if (!result?.success) {
          errors.push(`${center.name}: ${result?.error || 'falha de rede'}`);
          continue;
        }
        printed += 1;
        continue;
      }

      const printer = String(center.windowsPrinterName || '').trim();
      if (!printer) {
        errors.push(`${center.name}: impressora Windows em falta`);
        continue;
      }
      if (!window.electronAPI?.printReceipt) {
        errors.push(`${center.name}: impressão só na app desktop`);
        continue;
      }
      const { printHtml, widthMm } = buildProductionTicketHtml({
        centerName: center.name,
        items: ticketItems,
        paperWidth: center.paperWidth,
        ...meta,
      });
      const result = await window.electronAPI.printReceipt(printHtml, {
        printer,
        copies: 1,
        widthMm,
        heightMm: Math.max(120, 40 + ticketItems.length * 18),
      });
      if (!result?.success) {
        errors.push(`${center.name}: ${result?.error || 'falha de impressão'}`);
        continue;
      }
      printed += 1;
    } catch (error) {
      errors.push(`${center.name}: ${error instanceof Error ? error.message : 'erro'}`);
    }
  }

  return { printed, errors };
}
