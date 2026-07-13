import { getPosApiBase, getPosApiDirectBase, getPosUserAuthHeaders, clearPosAuthSession } from '@/lib/apiBase';

export class PosApiError extends Error {
  status: number;
  code: string | null;
  raw: unknown;

  constructor(message: string, status: number, code: string | null = null, raw: unknown = null) {
    super(message);
    this.name = 'PosApiError';
    this.status = status;
    this.code = code;
    this.raw = raw;
  }
}

function unwrapApiPayload(payload: unknown): any {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return payload;
  const candidate = payload as Record<string, unknown>;
  if (typeof candidate.success !== 'boolean') return payload;
  if (candidate.success) return candidate.data;

  const errorObject =
    candidate.error && typeof candidate.error === 'object'
      ? (candidate.error as Record<string, unknown>)
      : null;
  const message = String(errorObject?.message ?? 'Erro API');
  const code = errorObject?.code != null ? String(errorObject.code) : null;
  throw new PosApiError(message, 400, code, payload);
}

const fetchJSON = async (path: string, options?: RequestInit): Promise<any> => {
  const base = getPosApiBase().replace(/\/$/, '');
  const url = path.startsWith('http') ? path : `${base}${path.startsWith('/') ? path : `/${path}`}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      ...getPosUserAuthHeaders(),
      ...(options?.headers ?? {}),
    },
  });
  const text = await response.text();

  if (!response.ok) {
    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      throw new PosApiError(`HTTP ${response.status}: ${text}`, response.status, null, text);
    }

    const errorObject =
      json?.error && typeof json.error === 'object'
        ? json.error
        : null;
    const message = String(
      errorObject?.message ??
      json?.error ??
      json?.message ??
      'Erro API'
    );
    const code = errorObject?.code != null ? String(errorObject.code) : null;
    if (response.status === 401 && typeof window !== 'undefined' && localStorage.getItem('isLoggedIn') === 'true') {
      clearPosAuthSession();
    }
    if (response.status === 403 && isLicenseExpiredMessage(message)) {
      dispatchLicenseExpiredEvent({ message, code });
    }
    throw new PosApiError(message, response.status, code, json);
  }

  try {
    const parsed = text ? JSON.parse(text) : null;
    return unwrapApiPayload(parsed);
  } catch {
    const hint =
      response.status === 404
        ? ' Verifique se o servidor da API está a correr (node api/server.js) e atualizado, ou tecle F5 após reiniciar o Next.'
        : response.status === 413
          ? ' Pedido demasiado grande (geralmente o logo em base64). Reinicie a API após atualizar, ou use imagem mais pequena (ex.: PNG < 500 KB).'
          : '';
    throw new Error(`API HTTP ${response.status}: resposta não é JSON.${hint}`);
  }
};

export const fetchProducts = async () => {
  return fetchJSON('/produtos');
};

export const fetchCustomers = async () => {
  const rows = await fetchJSON('/clientes');
  return (Array.isArray(rows) ? rows : []).map((row: any) => ({
    ...row,
    id: String(row?.id ?? ''),
    cloud_id: row?.cloud_id != null ? String(row.cloud_id) : null,
    name: String(row?.name ?? ''),
    phone: String(row?.phone ?? ''),
    email: row?.email != null ? String(row.email) : undefined,
    address: row?.address != null ? String(row.address) : undefined,
    debt_balance: Number(row?.debt_balance ?? row?.debtBalance ?? 0) || 0,
  }));
};

export const fetchLoginUsers = async () => {
  const users = await fetchJSON('/auth/login-users', { cache: 'no-store' });
  return (users ?? []).map((user: any) => ({
    ...user,
    accessLevel: Number(user.access_level ?? user.accessLevel ?? 0),
    active: user.active === false ? false : Boolean(user.active ?? true),
    surname: user.surname ?? null,
    email: user.email ?? null,
  }));
};

export const fetchUsers = async () => {
  const users = await fetchJSON('/users');
  return (users ?? []).map((user: any) => ({
    ...user,
    accessLevel: Number(user.access_level ?? user.accessLevel ?? 0),
    active: user.active === false ? false : Boolean(user.active ?? true),
    surname: user.surname ?? null,
    email: user.email ?? null,
  }));
};

export type SetupStatusPayload = {
  dbPath: string | null;
  dbExists: boolean;
  hadDatabaseOnBoot: boolean;
  tenantExists: boolean;
  tenantId: string | null;
  tenantName: string | null;
  setupCompleted: boolean;
  setupCompletedAt: string | null;
  printerType: string | null;
  setupConfigPath: string | null;
  licensePath: string | null;
  requiresWizard: boolean;
  adminPasswordSet: boolean;
  licenseActivated: boolean;
  isSetupComplete: boolean;
  licenseExpired: boolean;
  licenseExpiresAt: string | null;
  registrySync?: {
    synced: boolean;
    skipped: boolean;
    error: string | null;
    expiresAt: string | null;
  };
};

const LICENSE_EXPIRED_EVENT = 'pos-license-expired';
export const LICENSE_REFRESHED_EVENT = 'pos-license-refreshed';

function isLicenseExpiredMessage(message: string): boolean {
  return /licen[cç]a\s+expirada/i.test(message);
}

function dispatchLicenseExpiredEvent(detail?: Record<string, unknown>) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(LICENSE_EXPIRED_EVENT, { detail: detail ?? {} }));
}

export const fetchSetupStatus = async (options?: {
  /** Evita POST à consola Supabase — uso em polls e ao voltar de outras rotas. */
  skipRegistrySync?: boolean;
}): Promise<SetupStatusPayload> => {
  const skip = options?.skipRegistrySync ? '&skipRegistrySync=1' : '';
  const data = await fetchJSON(`/setup/status?_=${Date.now()}${skip}`, { cache: 'no-store' });
  return {
    dbPath: data?.dbPath != null ? String(data.dbPath) : null,
    dbExists: Boolean(data?.dbExists),
    hadDatabaseOnBoot: Boolean(data?.hadDatabaseOnBoot),
    tenantExists: Boolean(data?.tenantExists),
    tenantId: data?.tenantId != null ? String(data.tenantId) : null,
    tenantName: data?.tenantName != null ? String(data.tenantName) : null,
    setupCompleted: Boolean(data?.setupCompleted),
    setupCompletedAt: data?.setupCompletedAt != null ? String(data.setupCompletedAt) : null,
    printerType: data?.printerType != null ? String(data.printerType) : null,
    setupConfigPath: data?.setupConfigPath != null ? String(data.setupConfigPath) : null,
    licensePath: data?.licensePath != null ? String(data.licensePath) : null,
    requiresWizard: Boolean(data?.requiresWizard),
    adminPasswordSet: Boolean(data?.adminPasswordSet),
    licenseActivated: Boolean(data?.licenseActivated),
    isSetupComplete: Boolean(data?.isSetupComplete),
    licenseExpired: Boolean(data?.licenseExpired),
    licenseExpiresAt:
      data?.licenseExpiresAt != null
        ? String(data.licenseExpiresAt)
        : data?.license_expires_at != null
          ? String(data.license_expires_at)
          : null,
    registrySync: data?.registrySync
      ? {
          synced: Boolean(data.registrySync.synced),
          skipped: Boolean(data.registrySync.skipped),
          error: data.registrySync.error != null ? String(data.registrySync.error) : null,
          expiresAt:
            data.registrySync.expiresAt != null ? String(data.registrySync.expiresAt) : null,
        }
      : undefined,
  };
};

export { LICENSE_EXPIRED_EVENT };

/** Repõe dados do tenant a partir do Supabase (operacao destrutiva). Requer `ENABLE_FULL_RESET_SYNC=true` e utilizador admin. */
export async function requestFullResetFromCloud(): Promise<Record<string, unknown>> {
  return fetchJSON('/sync/full-reset', {
    method: 'POST',
    cache: 'no-store',
    headers: {
      'Content-Type': 'application/json',
      ...getPosUserAuthHeaders(),
      'x-sync-confirm': 'FULL_RESET',
    },
    body: JSON.stringify({ confirm: 'FULL_RESET' }),
  });
}

export const initializeSetupWizard = async (payload: {
  storeName: string;
  nuit: string;
  adminName: string;
  adminPin: string;
  printerType: string;
  licenseKey: string;
}) => {
  return fetchJSON('/setup/initialize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
};

export type SerialStoreOption = {
  tenant_id: string;
  name: string;
  nuit: string | null;
  plan: string;
  expires_at: string;
  serial: string;
};

export const lookupSerialStores = async (serial: string): Promise<{
  serial: string;
  redeemed?: boolean;
  stores: SerialStoreOption[];
}> => {
  const data = await fetchJSON('/setup/serial/lookup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ serial: String(serial ?? '').trim() }),
  });
  return {
    serial: data?.serial != null ? String(data.serial) : String(serial ?? '').trim(),
    redeemed: Boolean(data?.redeemed),
    stores: Array.isArray(data?.stores)
      ? data.stores.map((s: Record<string, unknown>) => ({
          tenant_id: String(s.tenant_id ?? ''),
          name: String(s.name ?? ''),
          nuit: s.nuit != null && String(s.nuit).trim() ? String(s.nuit).trim() : null,
          plan: String(s.plan ?? 'LITE'),
          expires_at: String(s.expires_at ?? ''),
          serial: String(s.serial ?? serial ?? ''),
        }))
      : [],
  };
};

export const initializeFromSerial = async (payload: {
  serial: string;
  tenantId: string;
  adminName?: string;
  adminPin?: string;
  printerType?: string;
}) => {
  return fetchJSON('/setup/initialize-from-serial', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      serial: String(payload.serial ?? '').trim(),
      tenantId: String(payload.tenantId ?? '').trim(),
      adminName: payload.adminName ? String(payload.adminName).trim() : undefined,
      adminPin: payload.adminPin ? String(payload.adminPin).trim() : undefined,
      printerType: payload.printerType ? String(payload.printerType).trim() : undefined,
    }),
  });
};

export const setupAdminPassword = async (pin: string) => {
  return fetchJSON('/setup/admin-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin: String(pin ?? '').trim() }),
  });
};

export const activateLicenseToken = async (token: string) => {
  return fetchJSON('/setup/license/activate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: String(token ?? '').trim() }),
  });
};

/** Token de 12 dígitos gerado na consola após prolongar a licença. */
export const redeemReactivationTokenOnServer = async (token: string) => {
  return fetchJSON('/setup/license/reactivate-token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: String(token ?? '').trim() }),
  });
};

/** Após o Electron gravar license.json: marca licença como activa na BD local (127.0.0.1). */
export const acknowledgeLicenseFileOnServer = async () => {
  return fetchJSON('/setup/license/ack-file', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
};

/** Força sincronização da data de término com a consola (Supabase). */
export const syncLicenseFromConsole = async () => {
  return fetchJSON('/setup/license/sync-registry', { method: 'POST' });
};

export const fetchPaymentMethods = async (options?: { includeDisabled?: boolean }) => {
  const rows = await fetchJSON(`/payment-methods?_=${Date.now()}`, { cache: 'no-store' });
  const list = Array.isArray(rows) ? rows : [];
  return list
    .map((row: any) => ({
      id: String(row.id ?? row.code ?? ''),
      name: String(row.name ?? ''),
      code: String(row.code ?? '').toLowerCase(),
      shortcut: row.shortcut ?? null,
      position: Number(row.position ?? 1),
      enabled: row.enabled !== false && row.enabled !== 0,
      quickPayment: row.quickPayment !== false && row.quick_payment !== 0 && row.quick_payment !== false,
      requiredCustomer: Boolean(row.requiredCustomer ?? row.required_customer),
      allowChange: Boolean(row.allowChange ?? row.allow_change),
      markAsPaid: row.markAsPaid !== false && row.mark_as_paid !== 0 && row.mark_as_paid !== false,
      printReceipt: row.printReceipt !== false && row.print_receipt !== 0 && row.print_receipt !== false,
      openCashDrawer: Boolean(row.openCashDrawer ?? row.open_cash_drawer),
    }))
    .filter((row) => options?.includeDisabled || row.enabled)
    .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name));
};

export const fetchDocuments = async () => {
  return fetchJSON('/documentos');
};

export const fetchDocumentItems = async () => {
  return fetchJSON('/documentos-itens');
};

export const updateStock = async (productId: string, quantity: number) => {
  return fetchJSON('/stock', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ productId, quantity, mode: 'delta' })
  });
};

/** Inventário rápido: define a quantidade contada (absoluta) e grava movimento. */
export const setStockCountedQuantity = async (productId: string, countedQuantity: number) => {
  return fetchJSON('/stock', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      productId,
      counted_quantity: countedQuantity,
      mode: 'set',
    }),
  });
};

const formatDocumentNumber = (
  sequence: number,
  date = new Date(),
  docType: 'VD' | 'TK' | 'FP' | 'FT' = 'VD'
) => `${docType}/${date.getFullYear()}/${String(sequence).padStart(4, '0')}`;

export const createOrder = async (
  orderPayload: any,
  options?: {
    idempotencyKey?: string | null;
  }
) => {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (options?.idempotencyKey) {
    headers['X-Idempotency-Key'] = String(options.idempotencyKey);
  }

  const result = await fetchJSON('/vendas', {
    method: 'POST',
    headers,
    body: JSON.stringify(orderPayload)
  });

  const usedSequence = Number(result?.usedSequence ?? result?.id ?? 0) || null;
  const normalizedDocType = String(result?.usedDocType ?? orderPayload?.docType ?? 'VD')
    .trim()
    .toUpperCase() as 'VD' | 'TK' | 'FP' | 'FT';
  const usedDocumentNumber =
    result?.usedDocumentNumber ||
    (usedSequence ? formatDocumentNumber(usedSequence, new Date(orderPayload?.saleTimestamp || Date.now()), normalizedDocType) : null);

  return {
    ...result,
    usedSequence,
    usedDocumentNumber
  };
};

export const saveCustomer = async (payload: {
  editingCustomerId: string | null;
  newCustomer: { name: string; phone: string; email?: string; address?: string };
}) => {
  const isEdit = Boolean(payload.editingCustomerId);
  const url = isEdit ? `/clientes/${payload.editingCustomerId}` : `/clientes`;

  await fetchJSON(url, {
    method: isEdit ? 'PUT' : 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload.newCustomer)
  });

  return fetchCustomers();
};

export const deleteCustomer = async (id: string) => {
  await fetchJSON(`/clientes/${id}`, {
    method: 'DELETE'
  });
  return fetchCustomers();
};

export const getNextVDNumber = async () => {
  const data = await fetchJSON('/next-vd');
  return Number(data?.next ?? 1);
};

export const syncNextVDNumber = async (_date?: Date) => {
  return getNextVDNumber();
};

const emptyCompanyProfile = () => ({
  name: '',
  taxId: '',
  street: '',
  buildingNumber: '',
  additionalStreet: '',
  plotIdentification: '',
  district: '',
  city: '',
  state: '',
  country: '',
  phone: '',
  email: '',
  bankAccountNumber: '',
  bankDetails: '',
  logoDataUrl: null as string | null,
  voidReasons: [] as string[],
  updatedAt: null as string | null,
});

export const fetchCompanyProfile = async () => {
  const data = await fetchJSON('/company-profile');
  const base = emptyCompanyProfile();
  if (!data || typeof data !== 'object') return base;

  const rawLogo =
    data.logoDataUrl != null && data.logoDataUrl !== '' ? String(data.logoDataUrl) : null;
  let logoDataUrl = rawLogo;
  if (typeof window !== 'undefined' && rawLogo) {
    try {
      const { ensureCompactReceiptLogo } = await import('@/lib/compressReceiptLogo');
      logoDataUrl = await ensureCompactReceiptLogo(rawLogo);
      // Migrar logos antigos/grandes na BD para não atrasar cada impressão.
      if (logoDataUrl && logoDataUrl.length < rawLogo.length * 0.9) {
        void saveCompanyProfile({
          name: String(data.name ?? ''),
          taxId: String(data.taxId ?? ''),
          street: String(data.street ?? ''),
          buildingNumber: String(data.buildingNumber ?? ''),
          additionalStreet: String(data.additionalStreet ?? ''),
          plotIdentification: String(data.plotIdentification ?? ''),
          district: String(data.district ?? ''),
          city: String(data.city ?? ''),
          state: String(data.state ?? ''),
          country: String(data.country ?? ''),
          phone: String(data.phone ?? ''),
          email: String(data.email ?? ''),
          bankAccountNumber: String(data.bankAccountNumber ?? ''),
          bankDetails: String(data.bankDetails ?? ''),
          logoDataUrl,
          voidReasons: Array.isArray(data.voidReasons)
            ? data.voidReasons.map((x: unknown) => String(x ?? ''))
            : [],
        }).catch(() => {
          /* migração best-effort */
        });
      }
    } catch {
      logoDataUrl = rawLogo;
    }
  }

  return {
    name: String(data.name ?? ''),
    taxId: String(data.taxId ?? ''),
    street: String(data.street ?? ''),
    buildingNumber: String(data.buildingNumber ?? ''),
    additionalStreet: String(data.additionalStreet ?? ''),
    plotIdentification: String(data.plotIdentification ?? ''),
    district: String(data.district ?? ''),
    city: String(data.city ?? ''),
    state: String(data.state ?? ''),
    country: String(data.country ?? ''),
    phone: String(data.phone ?? ''),
    email: String(data.email ?? ''),
    bankAccountNumber: String(data.bankAccountNumber ?? ''),
    bankDetails: String(data.bankDetails ?? ''),
    logoDataUrl,
    voidReasons: Array.isArray(data.voidReasons) ? data.voidReasons.map((x: unknown) => String(x ?? '')) : [],
    updatedAt: data.updatedAt ?? null,
  };
};

export const saveCompanyProfile = async (profile: Record<string, unknown>) => {
  const direct = getPosApiDirectBase().replace(/\/$/, '');
  let payload = { ...profile };
  if (typeof window !== 'undefined' && payload.logoDataUrl != null && payload.logoDataUrl !== '') {
    try {
      const { ensureCompactReceiptLogo } = await import('@/lib/compressReceiptLogo');
      payload = {
        ...payload,
        logoDataUrl: await ensureCompactReceiptLogo(String(payload.logoDataUrl)),
      };
    } catch {
      /* keep original */
    }
  }
  return fetchJSON(`${direct}/company-profile`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
};

export const saveCompanyVoidReasons = async (voidReasons: string[]) => {
  const direct = getPosApiDirectBase().replace(/\/$/, '');
  return fetchJSON(`${direct}/company-profile/void-reasons`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ voidReasons }),
  });
};

export const resetDatabase = async (payload: {
  backupDir: string;
  adminPassword: string;
  resetProducts: boolean;
  resetCustomers: boolean;
  resetDocuments: boolean;
}) => {
  const direct = getPosApiDirectBase().replace(/\/$/, '');
  return fetchJSON(`${direct}/maintenance/reset-database`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
};