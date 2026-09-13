import { getPosApiBase, getPosUserAuthHeaders } from '@/lib/apiBase';
import { unwrapApiSuccessPayload } from '@/lib/apiResponse';
import { buildThermalPrintPageCss, resolveThermalWidthMm } from '@/lib/thermalPrintPage';
import { getReceiptPrinterName, loadPosSettings } from '@/lib/posSettings';
import { resolveConfiguredReceiptPrinterName } from '@/lib/printersClient';

export type CashTenderTotal = { label: string; amount: number };
export type CashUserTotal = {
  userId: string;
  userName: string;
  byTender: CashTenderTotal[];
  total: number;
  cashTotal: number;
};

export type CashSessionSnapshot = {
  session: {
    id: string;
    tenantId: string;
    registerCode: string;
    status: string;
    openedAt: string;
    openedById?: string | null;
    openedByName?: string | null;
    closedAt?: string | null;
    closedById?: string | null;
    closedByName?: string | null;
    zNumber?: number | null;
  } | null;
  totals: {
    salesTotal: number;
    cashSalesTotal: number;
    withdrawnTotal: number;
    movementIn?: number;
    movementOut?: number;
    floatTotal?: number;
    cashAvailable: number;
    userCashAvailable: number;
    byTender: CashTenderTotal[];
    byUser: CashUserTotal[];
    saleCount: number;
  } | null;
  dayCarryOver?: {
    pending: boolean;
    openedAt?: string;
    businessDate?: string;
    today?: string;
    cashAvailable: number;
    message?: string;
  };
  dayAdvanced?: boolean;
  withdrawals: Array<{
    id: string;
    amount: number;
    scope: string;
    userId?: string | null;
    userName?: string | null;
    createdAt: string;
  }>;
  movements?: Array<{
    id: string;
    kind: 'in' | 'out' | 'float' | 'advance_in' | 'advance_out';
    amount: number;
    note?: string | null;
    partyKind?: string | null;
    partyName?: string | null;
    userId?: string | null;
    userName?: string | null;
    createdAt: string;
  }>;
  ledger?: Array<{
    id: string;
    source: 'sale' | 'movement' | 'withdraw';
    kind: string;
    amount: number;
    direction: 1 | -1;
    label: string;
    note?: string | null;
    partyName?: string | null;
    userName?: string | null;
    createdAt?: string | null;
  }>;
  created?: boolean;
};

export type CashReportPayload = {
  type: 'X' | 'Z';
  zNumber?: number;
  generatedAt: string;
  session: NonNullable<CashSessionSnapshot['session']>;
  totals: NonNullable<CashSessionSnapshot['totals']>;
  withdrawals: CashSessionSnapshot['withdrawals'];
  items?: Array<{ name: string; quantity: number; total: number }>;
  printItems?: boolean;
  printZ?: boolean;
};

async function cashFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${getPosApiBase()}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...getPosUserAuthHeaders(),
      ...(init?.headers || {}),
    },
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const msg =
      json?.error?.message || json?.message || `Erro cash API (${res.status})`;
    throw new Error(String(msg));
  }
  return (unwrapApiSuccessPayload<T>(json) ?? json) as T;
}

export function ensureCashSession() {
  return cashFetch<CashSessionSnapshot>('/cash/session/ensure', { method: 'POST', body: '{}' });
}

export function fetchCashSession() {
  return cashFetch<CashSessionSnapshot>('/cash/session');
}

export function withdrawCashSession(scope: 'user' | 'all', amount?: number) {
  return cashFetch<CashSessionSnapshot & { withdrawal: unknown; dayAdvanced?: boolean }>('/cash/withdraw', {
    method: 'POST',
    body: JSON.stringify({ scope, amount }),
  });
}

export function createCashMovement(payload: {
  kind: 'in' | 'out' | 'float' | 'advance_in' | 'advance_out';
  amount: number;
  note?: string;
  partyKind?: 'customer' | 'supplier' | null;
  partyName?: string;
}) {
  return cashFetch<CashSessionSnapshot & { movement: NonNullable<CashSessionSnapshot['movements']>[number] }>(
    '/cash/movements',
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
  );
}

export function fetchReportX() {
  return cashFetch<CashReportPayload>('/cash/report-x', { method: 'POST', body: '{}' });
}

export function closeCashSession(opts: { printItems: boolean; printZ: boolean }) {
  return cashFetch<{
    zReportId: string;
    zNumber: number;
    report: CashReportPayload;
    backup?: { fileName: string; filePath: string; createdAt: string } | null;
  }>('/cash/close', {
    method: 'POST',
    body: JSON.stringify(opts),
  });
}

export function fetchZReportHistory(from?: string, to?: string) {
  const params = new URLSearchParams();
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  params.set('limit', '200');
  return cashFetch<{ items: Array<{ id: string; zNumber: number; generatedAt: string }> }>(
    `/cash/z-reports?${params}`,
  );
}

export function fetchZReportDetail(id: string) {
  return cashFetch<{ id: string; zNumber: number; generatedAt: string; report: CashReportPayload }>(
    `/cash/z-reports/${encodeURIComponent(id)}`,
  );
}

function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function money(n: number) {
  return Number(n || 0).toLocaleString('pt-MZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatWhen(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('pt-PT');
}

export function buildCashReportHtml(
  report: CashReportPayload,
  companyName = 'POSly',
): { printHtml: string; widthMm: number; heightMm: number } {
  const settings = loadPosSettings();
  const widthMm = resolveThermalWidthMm(settings.printPaperWidth);
  const css = buildThermalPrintPageCss(widthMm, {
    top: settings.printMarginTop,
    right: settings.printMarginRight,
    bottom: settings.printMarginBottom,
    left: settings.printMarginLeft,
  });
  const includeSummary = report.type === 'X' || report.printZ !== false;
  const includeItems = report.printItems !== false && (report.items?.length ?? 0) > 0;
  const title =
    report.type === 'Z' ? `RELATÓRIO Z Nº ${report.zNumber ?? '—'}` : 'RELATÓRIO X';
  const subtitle =
    report.type === 'Z' ? 'FECHO DE CAIXA' : 'LEITURA DE CAIXA (sessão aberta)';
  const tenders = report.totals?.byTender ?? [];
  const users = report.totals?.byUser ?? [];
  const items = report.items ?? [];

  const tenderRows = tenders
    .map(
      (t) =>
        `<tr><td>${escapeHtml(t.label)}</td><td class="r">${escapeHtml(money(t.amount))}</td></tr>`,
    )
    .join('');

  const userBlocks = users
    .map((u) => {
      const lines = (u.byTender || [])
        .map((t) => `<div class="row"><span>${escapeHtml(t.label)}</span><span>${escapeHtml(money(t.amount))}</span></div>`)
        .join('');
      return `<div class="user"><div class="uh">${escapeHtml(u.userName)}</div>${lines}<div class="row total"><span>TOTAL</span><span>${escapeHtml(money(u.total))}</span></div></div>`;
    })
    .join('');

  const itemRows = includeItems
    ? `<h3>PRODUTOS VENDIDOS</h3><table>${items
        .slice(0, 120)
        .map(
          (i) =>
            `<tr><td>${escapeHtml(i.name)}</td><td class="r">${escapeHtml(String(i.quantity))}</td><td class="r">${escapeHtml(money(i.total))}</td></tr>`,
        )
        .join('')}</table>`
    : '';

  const summaryBlock = includeSummary
    ? `<hr/>
    <h3>TOTAIS</h3>
    <table>${tenderRows}<tr class="total"><td>TOTAL</td><td class="r">${escapeHtml(money(report.totals?.salesTotal || 0))}</td></tr></table>
    <hr/>
    <h3>POR OPERADOR</h3>
    ${userBlocks || '<div class="muted">Sem vendas</div>'}
    <hr/>
    <div class="muted">Saques: ${escapeHtml(money(report.totals?.withdrawnTotal || 0))}</div>
    <div class="muted">Entradas: ${escapeHtml(money(Number(report.totals?.movementIn || 0)))}</div>
    <div class="muted">Saídas: ${escapeHtml(money(Number(report.totals?.movementOut || 0)))}</div>
    <div class="muted">Fundo de maneio: ${escapeHtml(money(Number(report.totals?.floatTotal || 0)))}</div>
    <div class="muted">Dinheiro disponível: ${escapeHtml(money(report.totals?.cashAvailable || 0))}</div>`
    : '';

  const closedLine =
    report.type === 'Z' && report.session?.closedAt
      ? `<div class="muted">Fecho: ${escapeHtml(formatWhen(report.session.closedAt))}</div>`
      : '';

  const body = `
  <div class="wrap">
    <div class="center brand">${escapeHtml(companyName)}</div>
    <div class="center title">${escapeHtml(title)}</div>
    <div class="center muted">${escapeHtml(subtitle)}</div>
    <div class="muted center">${escapeHtml(formatWhen(report.generatedAt))}</div>
    <div class="muted">Abertura: ${escapeHtml(report.session?.openedAt ? formatWhen(report.session.openedAt) : '—')}</div>
    ${closedLine}
    <div class="muted">Caixa: ${escapeHtml(report.session?.registerCode || 'caixa-1')}</div>
    ${summaryBlock}
    ${itemRows ? `<hr/>${itemRows}` : ''}
    <div class="center end">*** FIM ***</div>
  </div>`;

  const printHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"/><style>
  ${css}
  body{font-family:ui-monospace,monospace;color:#000;background:#fff;margin:0;padding:4px}
  .wrap{font-size:12px}
  .center{text-align:center}
  .brand{font-weight:800;font-size:14px}
  .title{font-weight:800;margin-top:4px}
  .muted{color:#333;font-size:11px;margin-top:2px}
  h3{font-size:11px;margin:8px 0 4px;letter-spacing:.04em}
  table{width:100%;border-collapse:collapse}
  td{padding:2px 0;vertical-align:top}
  td.r{text-align:right}
  tr.total td{font-weight:800;border-top:1px solid #000;padding-top:4px}
  .user{margin-bottom:8px}
  .uh{font-weight:800;margin-bottom:2px}
  .row{display:flex;justify-content:space-between;gap:8px}
  .row.total{font-weight:800;border-top:1px dashed #999;margin-top:2px;padding-top:2px}
  hr{border:none;border-top:1px dashed #999;margin:8px 0}
  .end{margin-top:10px;font-weight:700}
  </style></head><body>${body}</body></html>`;

  const heightMm = Math.min(
    800,
    90 +
      (includeSummary ? tenders.length * 6 + users.length * 18 : 0) +
      (includeItems ? items.length * 5 : 0),
  );
  return { printHtml, widthMm, heightMm };
}

export async function resolveConfiguredPrinterName(): Promise<string | undefined> {
  return resolveConfiguredReceiptPrinterName(getReceiptPrinterName());
}

export async function printCashReport(report: CashReportPayload, companyName?: string) {
  const bundle = buildCashReportHtml(report, companyName);
  const settings = loadPosSettings();
  const printer = await resolveConfiguredPrinterName();
  if (window.electronAPI?.printReceipt) {
    return window.electronAPI.printReceipt(bundle.printHtml, {
      printer,
      copies: Math.max(1, Number(settings.printCopies) || 1),
      widthMm: bundle.widthMm,
      heightMm: bundle.heightMm,
    });
  }
  // Fallback browser — o Windows mostra o diálogo com as impressoras do SO.
  const w = window.open('', '_blank', 'width=400,height=600');
  if (w) {
    w.document.write(bundle.printHtml);
    w.document.close();
    w.focus();
    w.print();
  }
  return { success: true, printer: printer || 'dialog' };
}
