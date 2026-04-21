import { getPosApiBase, getPosApiDirectBase } from '@/lib/apiBase';

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
  const response = await fetch(url, options);
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
  return fetchJSON('/clientes');
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
};

export const fetchSetupStatus = async (): Promise<SetupStatusPayload> => {
  const data = await fetchJSON('/setup/status');
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
  };
};

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

export const fetchPaymentMethods = async () => {
  return fetchJSON('/payment-methods');
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
    body: JSON.stringify({ productId, quantity })
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
    logoDataUrl: data.logoDataUrl != null && data.logoDataUrl !== '' ? String(data.logoDataUrl) : null,
    voidReasons: Array.isArray(data.voidReasons) ? data.voidReasons.map((x: unknown) => String(x ?? '')) : [],
    updatedAt: data.updatedAt ?? null,
  };
};

export const saveCompanyProfile = async (profile: Record<string, unknown>) => {
  const direct = getPosApiDirectBase().replace(/\/$/, '');
  return fetchJSON(`${direct}/company-profile`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(profile),
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