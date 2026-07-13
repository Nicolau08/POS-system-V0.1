/** Formatação para visor de cliente 2 linhas (ex.: 2x20 VFD). */

export function padDisplayLine(text: string, width: number): string {
  const safeWidth = Math.max(8, Math.min(40, Number(width) || 20));
  const normalized = String(text ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7E]/g, ' ')
    .toUpperCase();
  if (normalized.length >= safeWidth) return normalized.slice(0, safeWidth);
  return normalized.padEnd(safeWidth, ' ');
}

export function formatMoneyAmount(value: number, withCurrency = true): string {
  const amount = Number.isFinite(value) ? value : 0;
  const number = amount.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return withCurrency ? `${number} MT` : number;
}

export function formatMoneyForDisplay(value: number, width = 20): string {
  return padDisplayLine(formatMoneyAmount(value, true), width);
}

/** Linha 1: nome à esquerda + total à direita (ex.: COCA-COLA     100.00). */
export function formatItemNameWithTotal(name: string, lineTotal: number, width = 20): string {
  const safeWidth = Math.max(8, Math.min(40, Number(width) || 20));
  const money = formatMoneyAmount(lineTotal, false);
  const maxName = Math.max(1, safeWidth - money.length - 1);
  const rawName = String(name ?? 'ITEM')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7E]/g, ' ')
    .toUpperCase()
    .trim() || 'ITEM';
  const shortName = rawName.length > maxName ? rawName.slice(0, maxName) : rawName;
  const gap = Math.max(1, safeWidth - shortName.length - money.length);
  return `${shortName}${' '.repeat(gap)}${money}`.slice(0, safeWidth);
}

/** Linha 2: quantidade × preço unitário (ex.: 2 X 50.00 MT). */
export function formatQtyTimesUnitPrice(quantity: number, unitPrice: number, width = 20): string {
  const qty = Number.isFinite(quantity) && quantity > 0 ? quantity : 1;
  const qtyLabel = Number.isInteger(qty) ? String(qty) : qty.toFixed(2);
  const text = `${qtyLabel} X ${formatMoneyAmount(unitPrice, true)}`;
  return padDisplayLine(text, width).trim();
}

/** Aviso de remoção: nome do produto + REMOVIDO. */
export function formatRemovedItem(name: string, width = 20): { line1: string; line2: string } {
  const rawName = String(name ?? 'ITEM')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7E]/g, ' ')
    .toUpperCase()
    .trim() || 'ITEM';
  return {
    line1: padDisplayLine(rawName, width).trim(),
    line2: 'REMOVIDO',
  };
}

export function buildCustomerDisplayLines(
  line1: string,
  line2: string,
  width = 20,
): { line1: string; line2: string } {
  return {
    line1: padDisplayLine(line1, width),
    line2: padDisplayLine(line2, width),
  };
}

/** Payload típico VFD: limpar ecrã + 2 linhas de largura fixa. */
export function buildCustomerDisplayPayload(line1: string, line2: string, width = 20): Uint8Array {
  const lines = buildCustomerDisplayLines(line1, line2, width);
  const clear = 0x0c; // form feed / clear display
  const bytes = new Uint8Array(1 + lines.line1.length + lines.line2.length);
  bytes[0] = clear;
  for (let i = 0; i < lines.line1.length; i += 1) bytes[1 + i] = lines.line1.charCodeAt(i);
  for (let i = 0; i < lines.line2.length; i += 1) {
    bytes[1 + lines.line1.length + i] = lines.line2.charCodeAt(i);
  }
  return bytes;
}

export type CustomerDisplayView = {
  line1: string;
  line2: string;
  width: number;
};
