export type PosSettingsSection =
  | 'basicas'
  | 'postos'
  | 'locais'
  | 'armazens'
  | 'pedidos'
  | 'produtos'
  | 'farmacia'
  | 'documentos'
  | 'balanca'
  | 'display'
  | 'email'
  | 'impressao'
  | 'banco'
  | 'logs'
  | 'licenca'
  | 'sobre';

export type PrintJobKey =
  | 'receipt'
  | 'creditPayments'
  | 'blockedSale'
  | 'kitchen'
  | 'serviceMessages';

export type PosTheme = 'dark' | 'light' | 'violet';

export const POS_THEME_OPTIONS: Array<{ value: PosTheme; label: string }> = [
  { value: 'violet', label: 'Violeta' },
  { value: 'dark', label: 'Escuro' },
  { value: 'light', label: 'Claro' },
];

export const POS_THEME_PRINCIPAL_KEY = 'pos:theme-principal';

export function parsePosTheme(value: unknown): PosTheme {
  if (value === 'light' || value === 'dark' || value === 'violet') return value;
  return 'violet';
}

export type PrintJobSettings = {
  enabled: boolean;
  printer: string;
};

export type PosSettings = {
  language: string;
  currency: string;
  theme: PosTheme;
  roundCash: boolean;
  askTable: boolean;
  autoPrintReceipt: boolean;
  allowNegativeStock: boolean;
  showOutOfStock: boolean;
  defaultDocType: string;
  scaleEnabled: boolean;
  scalePort: string;
  customerDisplayEnabled: boolean;
  customerDisplayPort: string;
  customerDisplayBaud: string;
  customerDisplayDataBits: string;
  customerDisplayParity: string;
  customerDisplayStopBits: string;
  customerDisplayFlowControl: string;
  customerDisplayChars: number;
  welcomeTop: string;
  welcomeBottom: string;
  emailHost: string;
  emailPort: string;
  emailUser: string;
  emailFrom: string;
  printPaperWidth: string;
  printCopies: number;
  printOpenDrawer: boolean;
  printPrinterType: string;
  printDrawerCommand: string;
  printBeepOnPrint: boolean;
  printCutPaper: boolean;
  printMarginTop: number;
  printMarginRight: number;
  printMarginBottom: number;
  printMarginLeft: number;
  printExtraHeader: string;
  printExtraFooter: string;
  printHeaderAlign: 'left' | 'center';
  printFooterAlign: 'left' | 'center';
  printJobs: Record<PrintJobKey, PrintJobSettings>;
  receiptShowLogo: boolean;
  receiptHeaderLine1: string;
  receiptHeaderLine2: string;
  receiptFooter: string;
  receiptLabelItem: string;
  receiptLabelQty: string;
  receiptLabelPrice: string;
  receiptLabelTotal: string;
  receiptLabelChange: string;
  receiptTemplate: string;
};

export const POS_SETTINGS_STORAGE_KEY = 'pos:settings';

export const DEFAULT_PRINT_JOBS: Record<PrintJobKey, PrintJobSettings> = {
  receipt: { enabled: true, printer: '' },
  creditPayments: { enabled: false, printer: '' },
  blockedSale: { enabled: false, printer: '' },
  kitchen: { enabled: false, printer: '' },
  serviceMessages: { enabled: false, printer: '' },
};

export const DEFAULT_POS_SETTINGS: PosSettings = {
  language: 'pt-MZ',
  currency: 'MT',
  theme: 'violet',
  roundCash: false,
  askTable: false,
  autoPrintReceipt: true,
  allowNegativeStock: false,
  showOutOfStock: true,
  defaultDocType: 'VD',
  scaleEnabled: false,
  scalePort: '',
  customerDisplayEnabled: false,
  customerDisplayPort: '',
  customerDisplayBaud: '9600',
  customerDisplayDataBits: '8',
  customerDisplayParity: 'None',
  customerDisplayStopBits: '1',
  customerDisplayFlowControl: 'None',
  customerDisplayChars: 20,
  welcomeTop: 'BEM VINDO!',
  welcomeBottom: '',
  emailHost: '',
  emailPort: '587',
  emailUser: '',
  emailFrom: '',
  printPaperWidth: '80',
  printCopies: 1,
  printOpenDrawer: false,
  printPrinterType: 'windows',
  printDrawerCommand: '1B700019FA',
  printBeepOnPrint: false,
  printCutPaper: true,
  // Quase centrado; ajuste fino à esquerda no modal General
  printMarginTop: 0,
  printMarginRight: 3,
  printMarginBottom: 0,
  printMarginLeft: 2,
  printExtraHeader: '',
  printExtraFooter: '',
  printHeaderAlign: 'center',
  printFooterAlign: 'center',
  printJobs: {
    receipt: { enabled: true, printer: '' },
    creditPayments: { enabled: false, printer: '' },
    blockedSale: { enabled: false, printer: '' },
    kitchen: { enabled: false, printer: '' },
    serviceMessages: { enabled: false, printer: '' },
  },
  receiptShowLogo: true,
  receiptHeaderLine1: '',
  receiptHeaderLine2: '',
  receiptFooter: 'Obrigado pela preferência!',
  receiptLabelItem: 'Item',
  receiptLabelQty: 'Qtd',
  receiptLabelPrice: 'Preço',
  receiptLabelTotal: 'Total',
  receiptLabelChange: 'Troco',
  receiptTemplate: '80mm-standard',
};

function promotePrincipalTheme(settings: PosSettings): PosSettings {
  if (typeof window === 'undefined') return settings;
  try {
    if (localStorage.getItem(POS_THEME_PRINCIPAL_KEY)) return settings;
    localStorage.setItem(POS_THEME_PRINCIPAL_KEY, 'violet');
    if (settings.theme === 'violet') return settings;
    const next = { ...settings, theme: 'violet' as const };
    localStorage.setItem(POS_SETTINGS_STORAGE_KEY, JSON.stringify(next));
    return next;
  } catch {
    return { ...settings, theme: 'violet' };
  }
}

function cloneDefaults(): PosSettings {
  return JSON.parse(JSON.stringify(DEFAULT_POS_SETTINGS)) as PosSettings;
}

function normalizePrintJobs(
  raw: Partial<Record<PrintJobKey, Partial<PrintJobSettings>>> | undefined,
): Record<PrintJobKey, PrintJobSettings> {
  const result = cloneDefaults().printJobs;
  for (const key of Object.keys(DEFAULT_PRINT_JOBS) as PrintJobKey[]) {
    const incoming = raw?.[key];
    result[key] = {
      enabled: Boolean(incoming?.enabled ?? DEFAULT_PRINT_JOBS[key].enabled),
      printer: String(incoming?.printer ?? DEFAULT_PRINT_JOBS[key].printer ?? ''),
    };
  }
  return result;
}

export function loadPosSettings(): PosSettings {
  if (typeof window === 'undefined') return cloneDefaults();
  try {
    const stored = localStorage.getItem(POS_SETTINGS_STORAGE_KEY);
    if (!stored) return promotePrincipalTheme(cloneDefaults());
    const parsed = JSON.parse(stored) as Partial<PosSettings> & {
      printJobs?: Partial<Record<PrintJobKey, Partial<PrintJobSettings>>>;
    };
    const merged: PosSettings = {
      ...cloneDefaults(),
      ...parsed,
      theme: parsePosTheme(parsed.theme),
      printJobs: normalizePrintJobs(parsed.printJobs),
    };
    if (parsed.printJobs?.receipt == null && typeof parsed.autoPrintReceipt === 'boolean') {
      merged.printJobs.receipt.enabled = parsed.autoPrintReceipt;
    }
    return promotePrincipalTheme(merged);
  } catch {
    return cloneDefaults();
  }
}

export function savePosSettings(settings: PosSettings) {
  if (typeof window === 'undefined') return;
  const next = {
    ...settings,
    autoPrintReceipt: Boolean(settings.printJobs?.receipt?.enabled),
  };
  localStorage.setItem(POS_SETTINGS_STORAGE_KEY, JSON.stringify(next));
  try {
    localStorage.setItem(POS_THEME_PRINCIPAL_KEY, 'violet');
  } catch {
    // ignore
  }
  window.dispatchEvent(new CustomEvent('pos-settings-changed', { detail: next }));
  void syncReceiptPrinterToServer(next);
}

export function getReceiptPrinterName(settings?: PosSettings | null): string {
  const cfg = settings ?? (typeof window !== 'undefined' ? loadPosSettings() : DEFAULT_POS_SETTINGS);
  return String(cfg.printJobs?.receipt?.printer ?? '').trim();
}

/** Publica a impressora de recibos no servidor (postos Android usam para Conta). */
export async function syncReceiptPrinterToServer(settings?: PosSettings | null): Promise<void> {
  if (typeof window === 'undefined') return;
  try {
    const { getPosApiDirectBase, getPosUserAuthHeaders } = await import('@/lib/apiBase');
    const name = getReceiptPrinterName(settings);
    await fetch(`${getPosApiDirectBase().replace(/\/$/, '')}/stations/server-settings`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...getPosUserAuthHeaders() },
      body: JSON.stringify({ receiptPrinterName: name }),
    });
  } catch {
    // rede / API offline — o próximo save tenta outra vez
  }
}
