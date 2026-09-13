import {
  getPosApiBase,
  getPosApiDirectBase,
  getPosUserAuthHeaders,
  getStoredAuthToken,
  setStoredAuthToken,
  clearPosAuthSession,
} from '@/lib/apiBase';

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

const fetchJSON = async (path: string, options?: RequestInit, didRetryAuth = false): Promise<any> => {
  const base = getPosApiBase().replace(/\/$/, '');
  const url = path.startsWith('http') ? path : `${base}${path.startsWith('/') ? path : `/${path}`}`;
  // `cache: 'no-store'` no fetch do Next pode ir pelo servidor sem Authorization.
  const { cache: _cache, ...fetchOptions } = options ?? {};
  const authHeaders = getPosUserAuthHeaders();
  const response = await fetch(url, {
    ...fetchOptions,
    headers: {
      ...authHeaders,
      ...(fetchOptions.headers ?? {}),
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
    const loggedIn =
      typeof window !== 'undefined' && localStorage.getItem('isLoggedIn') === 'true';
    // Bearer obsoleto (restart API / secret novo): limpar token e tentar 1x com x-user-id.
    // Pedidos em paralelo não devem fazer logout no 1.º 401 — senão o seguinte fica Unauthorized.
    if (response.status === 401 && !didRetryAuth && loggedIn) {
      if (getStoredAuthToken()) setStoredAuthToken(null);
      return fetchJSON(path, options, true);
    }
    if (
      loggedIn &&
      didRetryAuth &&
      (response.status === 401 ||
        code === 'AUTH_FAILED' ||
        code === 'UNAUTHORIZED' ||
        code === 'TENANT_CONTEXT_REQUIRED')
    ) {
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

function isTransientApiFailure(error: unknown): boolean {
  const status = error instanceof PosApiError ? error.status : 0;
  const message = String(error instanceof Error ? error.message : error ?? '');
  return (
    status === 500 ||
    status === 502 ||
    status === 503 ||
    status === 504 ||
    /ECONNREFUSED|ECONNRESET|Failed to fetch|Internal Server Error|API HTTP 50/i.test(message)
  );
}

async function withTransientRetry<T>(fn: () => Promise<T>, attempts = 5, delayMs = 350): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (!isTransientApiFailure(error) || attempt === attempts - 1) throw error;
      await new Promise((resolve) => setTimeout(resolve, delayMs * (attempt + 1)));
    }
  }
  throw lastError;
}

import { normalizeCatalogProduct } from '@/lib/catalogLocalSync';

export const fetchProducts = async () => {
  const rows = await fetchJSON('/produtos');
  return (Array.isArray(rows) ? rows : []).map((row: any) => normalizeCatalogProduct(row));
};

export const fetchCategories = async () => {
  const rows = await fetchJSON('/categorias');
  return (Array.isArray(rows) ? rows : []).map((row: any) => ({
    id: String(row?.id ?? ''),
    name: String(row?.name ?? ''),
    parent_id: row?.parent_id != null ? String(row.parent_id) : null,
    color: row?.color != null ? String(row.color) : null,
  }));
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
    is_supplier: Boolean(row?.is_supplier ?? row?.isSupplier ?? false),
  }));
};

export const fetchLoginUsers = async () => {
  const users = await withTransientRetry(() => fetchJSON('/auth/login-users', { cache: 'no-store' }));
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

/** Apaga license.json e reabre o wizard de série (após desvincular na consola). */
export const resetLocalLicenseOnServer = async () => {
  return fetchJSON('/setup/license/reset-local', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
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
      color: String(row.color ?? '').trim() || undefined,
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
export const setStockCountedQuantity = async (
  productId: string,
  countedQuantity: number,
  warehouseId?: string | null,
) => {
  return fetchJSON('/stock', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      productId,
      counted_quantity: countedQuantity,
      mode: 'set',
      ...(warehouseId ? { warehouseId } : {}),
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

export type DatabaseBackupRow = {
  fileName: string;
  filePath: string;
  sizeBytes: number;
  createdAt: string;
  kind?: 'backup' | 'pre-restore';
};

export const listDatabaseBackups = async (): Promise<{
  backups: DatabaseBackupRow[];
  backupsDir?: string;
  databasePath?: string;
  intervalHours?: number;
  retentionCount?: number;
}> => {
  const data = await fetchJSON('/backup/list');
  return {
    backups: Array.isArray(data?.backups) ? data.backups : Array.isArray(data) ? data : [],
    backupsDir: data?.backupsDir ? String(data.backupsDir) : undefined,
    databasePath: data?.databasePath ? String(data.databasePath) : undefined,
    intervalHours: Number.isFinite(Number(data?.intervalHours)) ? Number(data.intervalHours) : undefined,
    retentionCount: Number.isFinite(Number(data?.retentionCount)) ? Number(data.retentionCount) : undefined,
  };
};

export const createDatabaseBackup = async () => {
  const data = await fetchJSON('/backup/create', { method: 'POST' });
  return data?.backup ?? data;
};

export const restoreDatabaseBackup = async (backupFile: string) => {
  const data = await fetchJSON('/backup/restore', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ backupFile }),
  });
  return data?.restored ?? data;
};

export type DbEncryptionStatus = {
  encryptionConfigured: boolean;
  databaseMarkedEncrypted: boolean;
  databasePath?: string;
};

export const fetchDbEncryptionStatus = async (): Promise<DbEncryptionStatus> => {
  const data = await fetchJSON('/maintenance/db-encryption-status');
  return {
    encryptionConfigured: Boolean(data?.encryptionConfigured),
    databaseMarkedEncrypted: Boolean(data?.databaseMarkedEncrypted),
    databasePath: data?.databasePath ? String(data.databasePath) : undefined,
  };
};

export const exportDbRecoveryKey = async (payload: {
  enteredPin: string;
  wrapPassword: string;
  wrapPasswordConfirm: string;
}) => {
  const data = await fetchJSON('/maintenance/db-recovery-key/export', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return {
    recoveryPackage: data?.recoveryPackage ?? data,
    fileName: String(data?.fileName ?? 'posly-db-recovery.json'),
    warning: data?.warning != null ? String(data.warning) : null,
  };
};

export const unwrapDbRecoveryKey = async (payload: {
  enteredPin: string;
  wrapPassword: string;
  recoveryPackage: unknown;
}) => {
  const data = await fetchJSON('/maintenance/db-recovery-key/unwrap', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return {
    keyHex: String(data?.keyHex ?? ''),
    tenantId: data?.tenantId != null ? String(data.tenantId) : '',
    exportedAt: data?.exportedAt != null ? String(data.exportedAt) : '',
    warning: data?.warning != null ? String(data.warning) : null,
  };
};

export type PosLocationTable = {
  id: string;
  locationId: string;
  name: string;
  displayName?: string;
  seats: number | null;
  sortOrder: number;
  active: boolean;
};

export type PosLocation = {
  id: string;
  name: string;
  code: string | null;
  type: string;
  active: boolean;
  sortOrder: number;
  allowCustomNames: boolean;
  /** null = usar armazém principal (default) do tenant */
  warehouseId: string | null;
  /** Numeração no POS a partir deste número; o nome interno da mesa não muda */
  displayStart?: number | null;
  tables: PosLocationTable[];
  tablesSummary?: string;
};

export type PosWarehouse = {
  id: string;
  name: string;
  code: string | null;
  isDefault: boolean;
  isActive: boolean;
  createdAt?: string | null;
  updatedAt?: string | null;
};

export const fetchLocations = async (): Promise<PosLocation[]> => {
  const rows = await fetchJSON(`/locations?_=${Date.now()}`, { cache: 'no-store' });
  return (Array.isArray(rows) ? rows : []).map((row: any) => ({
    ...row,
    allowCustomNames: Boolean(row?.allowCustomNames ?? row?.allow_custom_names),
    warehouseId:
      row?.warehouseId != null
        ? String(row.warehouseId)
        : row?.warehouse_id != null
          ? String(row.warehouse_id)
          : null,
    tables: Array.isArray(row?.tables) ? row.tables : [],
    tablesSummary: row?.tablesSummary != null ? String(row.tablesSummary) : undefined,
    displayStart:
      row?.displayStart != null && Number.isFinite(Number(row.displayStart))
        ? Number(row.displayStart)
        : row?.display_start != null && Number.isFinite(Number(row.display_start))
          ? Number(row.display_start)
          : null,
  }));
};

export const createLocationApi = async (payload: {
  name: string;
  code?: string;
  type?: string;
  active?: boolean;
  sortOrder?: number;
  tablesSpec?: string;
  allowCustomNames?: boolean;
  warehouseId?: string | null;
  displayStart?: number | null;
}) => fetchJSON('/locations', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload),
});

export const updateLocationApi = async (
  id: string,
  payload: Partial<{
    name: string;
    code: string;
    type: string;
    active: boolean;
    sortOrder: number;
    allowCustomNames: boolean;
    warehouseId: string | null;
    tablesSpec: string;
    displayStart: number | null;
  }>,
) =>
  fetchJSON(`/locations/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

export const fetchWarehouses = async (): Promise<PosWarehouse[]> => {
  const rows = await fetchJSON(`/warehouses?_=${Date.now()}`, { cache: 'no-store' });
  return (Array.isArray(rows) ? rows : []).map((row: any) => ({
    id: String(row.id),
    name: String(row.name ?? ''),
    code: row.code != null ? String(row.code) : null,
    isDefault: Boolean(row.isDefault ?? row.is_default),
    isActive: Boolean(row.isActive ?? row.is_active ?? true),
    createdAt: row.createdAt ?? row.created_at ?? null,
    updatedAt: row.updatedAt ?? row.updated_at ?? null,
  }));
};

export const fetchWarehouseStock = async (
  warehouseId: string,
): Promise<Array<{ productId: string; quantity: number }>> => {
  const rows = await fetchJSON(`/warehouses/${encodeURIComponent(warehouseId)}/stock?_=${Date.now()}`, {
    cache: 'no-store',
  });
  return (Array.isArray(rows) ? rows : []).map((row: any) => ({
    productId: String(row.productId ?? row.product_id ?? ''),
    quantity: Number(row.quantity ?? 0) || 0,
  }));
};

export const createWarehouseApi = async (payload: {
  name: string;
  code?: string;
  isActive?: boolean;
  isDefault?: boolean;
}) =>
  fetchJSON('/warehouses', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

export const updateWarehouseApi = async (
  id: string,
  payload: Partial<{
    name: string;
    code: string;
    isActive: boolean;
  }>,
) =>
  fetchJSON(`/warehouses/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

export const setDefaultWarehouseApi = async (id: string) =>
  fetchJSON(`/warehouses/${id}/set-default`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });

export const transferWarehouseStockApi = async (payload: {
  fromWarehouseId: string;
  toWarehouseId: string;
  items: Array<{ productId: string | number; quantity: number; name?: string }>;
  documentDate?: string;
}) =>
  fetchJSON('/warehouses/transfer', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

export type PrintCenter = {
  id: string;
  name: string;
  connectionType: 'windows' | 'network' | string;
  windowsPrinterName: string | null;
  host: string | null;
  port: number;
  paperWidth: number;
  enabled: boolean;
  sortOrder: number;
  categoryIds: string[];
  categories: Array<{ id: string; name: string; parentId: string | null }>;
};

export const deleteLocationApi = async (id: string) =>
  fetchJSON(`/locations/${id}`, { method: 'DELETE' });

export const createLocationTableApi = async (
  locationId: string,
  payload: {
    name?: string;
    seats?: number | null;
    sortOrder?: number;
    active?: boolean;
    tablesSpec?: string;
    spec?: string;
  },
) =>
  fetchJSON(`/locations/${locationId}/tables`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

export const updateLocationTableApi = async (
  id: string,
  payload: Partial<{ name: string; seats: number | null; sortOrder: number; active: boolean }>,
) =>
  fetchJSON(`/location-tables/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

export const deleteLocationTableApi = async (id: string) =>
  fetchJSON(`/location-tables/${id}`, { method: 'DELETE' });

export const fetchPrintCenters = async (): Promise<PrintCenter[]> => {
  const rows = await fetchJSON(`/print-centers?_=${Date.now()}`, { cache: 'no-store' });
  return Array.isArray(rows) ? rows : [];
};

export const createPrintCenterApi = async (payload: {
  name: string;
  connectionType: string;
  windowsPrinterName?: string | null;
  host?: string | null;
  port?: number;
  paperWidth?: number;
  enabled?: boolean;
  categoryIds?: string[];
  sortOrder?: number;
}) =>
  fetchJSON('/print-centers', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

export const updatePrintCenterApi = async (
  id: string,
  payload: Partial<{
    name: string;
    connectionType: string;
    windowsPrinterName: string | null;
    host: string | null;
    port: number;
    paperWidth: number;
    enabled: boolean;
    categoryIds: string[];
    sortOrder: number;
  }>,
) =>
  fetchJSON(`/print-centers/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

export const deletePrintCenterApi = async (id: string) =>
  fetchJSON(`/print-centers/${id}`, { method: 'DELETE' });
