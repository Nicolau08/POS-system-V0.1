import { getPosApiBase, getPosApiDirectBase } from '@/lib/apiBase';

const fetchJSON = async (path: string, options?: RequestInit) => {
  const base = getPosApiBase().replace(/\/$/, '');
  const url = path.startsWith('http') ? path : `${base}${path.startsWith('/') ? path : `/${path}`}`;
  const res = await fetch(url, options);
  const text = await res.text();
  let data: any = null;

  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    const hint =
      res.status === 404
        ? ' Verifique se o servidor da API está a correr (node api/server.js) e atualizado, ou tecle F5 após reiniciar o Next.'
        : res.status === 413
          ? ' Pedido demasiado grande (geralmente o logo em base64). Reinicie a API após atualizar, ou use imagem mais pequena (ex.: PNG < 500 KB).'
          : '';
    throw new Error(`API HTTP ${res.status}: resposta não é JSON.${hint}`);
  }

  if (!res.ok) {
    const message = data?.error || `Erro HTTP ${res.status}`;
    throw new Error(message);
  }

  return data;
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
    password: user.password ?? user.pin ?? '',
    accessLevel: Number(user.access_level ?? user.accessLevel ?? 0),
    active: user.active === false ? false : Boolean(user.active ?? true),
    surname: user.surname ?? null,
    email: user.email ?? null,
  }));
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

export const createOrder = async (orderPayload: any) => {
  const result = await fetchJSON('/vendas', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
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