/**
 * Pedidos de produção (cozinha/balcão) — usado pelo posto Android/LAN.
 * Envia ESC/POS para impressoras de rede e RAW Windows quando possível.
 */
import net from 'net';
import path from 'path';
import { fileURLToPath } from 'url';
import { all } from '../dbUtils.js';
import { HttpError } from '../utils/response.js';
import { requireTenantId } from '../utils/tenant.js';
import { listAllPrintCenters } from './print-centers.service.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function resolveTenantId(actorUser) {
  return requireTenantId(actorUser?.tenant_id, {
    status: 401,
    message: 'tenant_id ausente',
  });
}

function encodeEscPosText(text) {
  const normalized = String(text ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x00-\xff]/g, '?');
  return Buffer.from(normalized, 'latin1');
}

function buildProductionTicketEscPos({ centerName, items, tableLabel, docLabel, timeLabel }) {
  const lines = [];
  lines.push(String(centerName || 'PRODUCAO').toUpperCase());
  lines.push('--------------------------------');
  if (tableLabel) lines.push(`Mesa: ${tableLabel}`);
  if (docLabel) lines.push(String(docLabel));
  if (timeLabel) lines.push(String(timeLabel));
  lines.push('--------------------------------');
  for (const item of items || []) {
    const qty = Number(item.quantity) || 0;
    if (qty <= 0) continue;
    lines.push(`${qty}x ${item.name || 'Item'}`);
    if (item.notes) lines.push(`  ${item.notes}`);
  }
  lines.push('--------------------------------');
  lines.push('');
  const init = Buffer.from([0x1b, 0x40]);
  const body = encodeEscPosText(`${lines.join('\n')}\n`);
  const cut = Buffer.from([0x1d, 0x56, 0x00]);
  return Buffer.concat([init, body, cut]);
}

function formatMoneyEscPos(n) {
  const value = Number(n) || 0;
  return value.toFixed(2);
}

/** Conta do cliente (com preços e total) — ESC/POS. */
function buildBillTicketEscPos({ items, tableLabel, timeLabel, currencyLabel }) {
  const lines = [];
  lines.push('CONTA');
  lines.push('--------------------------------');
  if (tableLabel) lines.push(`Mesa: ${tableLabel}`);
  if (timeLabel) lines.push(String(timeLabel));
  lines.push('--------------------------------');
  let total = 0;
  for (const item of items || []) {
    const qty = Number(item.quantity) || 0;
    if (qty <= 0) continue;
    const price = Number(item.price) || 0;
    const lineTotal = qty * price;
    total += lineTotal;
    const name = String(item.name || 'Item').slice(0, 24);
    lines.push(`${qty}x ${name}`);
    lines.push(`  ${formatMoneyEscPos(lineTotal)}`);
  }
  lines.push('--------------------------------');
  const cur = currencyLabel ? ` ${currencyLabel}` : '';
  lines.push(`TOTAL${cur}: ${formatMoneyEscPos(total)}`);
  lines.push('--------------------------------');
  lines.push('');
  const init = Buffer.from([0x1b, 0x40]);
  const body = encodeEscPosText(`${lines.join('\n')}\n`);
  const cut = Buffer.from([0x1d, 0x56, 0x00]);
  return Buffer.concat([init, body, cut]);
}

async function sendBytesToCenter(center, bytes) {
  if (String(center.connectionType) === 'network') {
    const host = String(center.host || '').trim();
    if (!host) return { ok: false, error: 'IP em falta' };
    return sendTcp(host, center.port || 9100, bytes);
  }
  const printer = String(center.windowsPrinterName || '').trim();
  if (!printer) return { ok: false, error: 'impressora Windows em falta' };
  return sendWindowsRaw(printer, bytes);
}

function sendTcp(host, port, bytes) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      try {
        socket.destroy();
      } catch {
        /* ignore */
      }
      resolve(result);
    };
    socket.setTimeout(2500);
    socket.once('timeout', () => finish({ ok: false, error: `Timeout ${host}:${port}` }));
    socket.once('error', (err) =>
      finish({ ok: false, error: String(err?.message ?? err ?? 'Erro de rede') }),
    );
    socket.connect(port, host, () => {
      socket.write(bytes, (writeErr) => {
        if (writeErr) {
          finish({ ok: false, error: String(writeErr.message || writeErr) });
          return;
        }
        // Não esperar ACK longo do corte — fecha após write.
        finish({ ok: true });
        try {
          socket.end();
        } catch {
          /* ignore */
        }
      });
    });
  });
}

async function sendWindowsRaw(printerName, bytes) {
  try {
    const rawPath = path.resolve(__dirname, '../../electron/rawPrinter.js');
    const { sendRawToWindowsPrinter } = await import(pathToFileUrl(rawPath));
    const result = await sendRawToWindowsPrinter(printerName, bytes);
    if (!result?.success) {
      return { ok: false, error: result?.error || 'Falha RAW Windows' };
    }
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Impressão Windows indisponível neste processo',
    };
  }
}

function pathToFileUrl(filePath) {
  const normalized = path.resolve(filePath).replace(/\\/g, '/');
  const withSlash = normalized.startsWith('/') ? normalized : `/${normalized}`;
  return `file://${withSlash}`;
}

async function loadCategoryMaps(tenantId) {
  const rows = await all(
    `SELECT id, name, parent_id FROM categories WHERE tenant_id = ?`,
    [tenantId],
  );
  const parentMap = new Map();
  const byName = new Map();
  for (const row of rows || []) {
    const id = String(row.id);
    parentMap.set(id, row.parent_id != null ? String(row.parent_id) : null);
    byName.set(String(row.name ?? '')
      .trim()
      .toLowerCase(), id);
  }
  return { parentMap, byName };
}

function resolveCenterForCategory(categoryId, categoryName, centers, parentMap, byName) {
  const enabled = (centers || []).filter((c) => c.enabled);
  if (!enabled.length) return null;
  const categoryToCenter = new Map();
  for (const center of enabled) {
    for (const id of center.categoryIds || []) {
      categoryToCenter.set(String(id), center);
    }
  }
  let currentId =
    categoryId != null && String(categoryId).trim()
      ? String(categoryId)
      : categoryName
        ? byName.get(String(categoryName).trim().toLowerCase()) || ''
        : '';
  const visited = new Set();
  while (currentId && !visited.has(currentId)) {
    visited.add(currentId);
    const center = categoryToCenter.get(currentId);
    if (center) return center;
    currentId = parentMap.get(currentId) || '';
  }
  return null;
}

/**
 * @param {{ items: Array<{name,quantity,category_id?,category?,notes?}>, tableLabel?, docLabel?, timeLabel? }} payload
 */
export async function submitProductionOrder(payload = {}, actorUser = null) {
  const tenantId = resolveTenantId(actorUser);
  const items = Array.isArray(payload.items) ? payload.items : [];
  if (!items.length) throw new HttpError(400, 'Pedido sem itens.');

  const [centers, { parentMap, byName }] = await Promise.all([
    listAllPrintCenters(actorUser),
    loadCategoryMaps(tenantId),
  ]);

  const buckets = new Map();
  for (const item of items) {
    const qty = Number(item.quantity) || 0;
    if (qty <= 0) continue;
    const center = resolveCenterForCategory(
      item.category_id ?? item.categoryId ?? null,
      item.category ?? null,
      centers,
      parentMap,
      byName,
    );
    if (!center) continue;
    const existing = buckets.get(center.id);
    const line = {
      name: String(item.name ?? 'Item'),
      quantity: qty,
      notes: item.notes != null ? String(item.notes) : null,
    };
    if (existing) existing.items.push(line);
    else buckets.set(center.id, { center, items: [line] });
  }

  if (!buckets.size) {
    throw new HttpError(
      409,
      'Nenhum centro de impressão activo para as categorias deste pedido. Configure Imp. Cozinha/Balcão.',
    );
  }

  const meta = {
    tableLabel: payload.tableLabel != null ? String(payload.tableLabel) : null,
    docLabel: payload.docLabel != null ? String(payload.docLabel) : 'PEDIDO',
    timeLabel:
      payload.timeLabel != null
        ? String(payload.timeLabel)
        : new Date().toLocaleString('pt-MZ'),
  };

  const results = [];
  let printed = 0;
  const errors = [];

  const jobs = [...buckets.values()].map(async ({ center, items: ticketItems }) => {
    const bytes = buildProductionTicketEscPos({
      centerName: center.name,
      items: ticketItems,
      ...meta,
    });
    try {
      const sent = await sendBytesToCenter(center, bytes);
      if (!sent.ok) {
        return { ok: false, center, error: sent.error };
      }
      return { ok: true, center };
    } catch (err) {
      return {
        ok: false,
        center,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  });

  for (const outcome of await Promise.all(jobs)) {
    if (outcome.ok) {
      printed += 1;
      results.push({ centerId: outcome.center.id, name: outcome.center.name, ok: true });
    } else {
      errors.push(`${outcome.center.name}: ${outcome.error}`);
    }
  }

  if (printed === 0) {
    throw new HttpError(502, errors[0] || 'Falha ao imprimir pedido.');
  }

  return { printed, errors, results };
}

/**
 * Imprime conta (com preços) na impressora de recibos do servidor.
 * @param {{ items: Array<{name,quantity,price?}>, tableLabel?, timeLabel?, currencyLabel? }} payload
 */
export async function submitBillPrint(payload = {}, actorUser = null) {
  resolveTenantId(actorUser);
  const items = Array.isArray(payload.items) ? payload.items : [];
  const normalized = items
    .map((item) => ({
      name: String(item?.name ?? 'Item'),
      quantity: Number(item?.quantity) || 0,
      price: Number(item?.price) || 0,
    }))
    .filter((item) => item.quantity > 0);
  if (!normalized.length) throw new HttpError(400, 'Conta sem itens.');

  const { getServerStationSettings } = await import('./station.service.js');
  const serverSettings = await getServerStationSettings();
  const printerName = String(serverSettings?.receiptPrinterName ?? '').trim();
  if (!printerName) {
    throw new HttpError(
      409,
      'Impressora de recibos não configurada no servidor. Em Configurações → Opções de impressão, escolha a impressora de recibos e guarde.',
    );
  }

  const bytes = buildBillTicketEscPos({
    items: normalized,
    tableLabel: payload.tableLabel != null ? String(payload.tableLabel) : null,
    timeLabel:
      payload.timeLabel != null
        ? String(payload.timeLabel)
        : new Date().toLocaleString('pt-MZ'),
    currencyLabel: payload.currencyLabel != null ? String(payload.currencyLabel) : 'MT',
  });

  const sent = await sendWindowsRaw(printerName, bytes);
  if (!sent.ok) {
    throw new HttpError(502, sent.error || `Falha ao imprimir na impressora «${printerName}».`);
  }

  return {
    printed: 1,
    errors: [],
    results: [{ name: printerName, ok: true }],
  };
}
