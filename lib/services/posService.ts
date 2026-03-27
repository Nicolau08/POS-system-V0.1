const API_URL = 'http://localhost:3001';

const fetchJSON = async (url: string, options?: RequestInit) => {
  const res = await fetch(url, options);
  const text = await res.text();
  let data: any = null;

  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`API respondeu com JSON invalido (${res.status})`);
  }

  if (!res.ok) {
    const message = data?.error || `Erro HTTP ${res.status}`;
    throw new Error(message);
  }

  return data;
};

export const fetchProducts = async () => {
  return fetchJSON(`${API_URL}/produtos`);
};

export const fetchCustomers = async () => {
  return fetchJSON(`${API_URL}/clientes`);
};

export const fetchUsers = async () => {
  const users = await fetchJSON(`${API_URL}/users`);
  return (users ?? []).map((user: any) => ({
    ...user,
    password: user.password ?? user.pin ?? ''
  }));
};

export const updateStock = async (productId: string, quantity: number) => {
  return fetchJSON(`${API_URL}/stock`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ productId, quantity })
  });
};

const formatDocumentNumber = (sequence: number, date = new Date()) =>
  `${date.getFullYear()}/${String(sequence).padStart(4, '0')}`;

export const createOrder = async (orderPayload: any) => {
  const result = await fetchJSON(`${API_URL}/vendas`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(orderPayload)
  });

  const usedSequence = Number(result?.usedSequence ?? result?.id ?? 0) || null;
  const usedDocumentNumber =
    result?.usedDocumentNumber ||
    (usedSequence ? formatDocumentNumber(usedSequence, new Date(orderPayload?.saleTimestamp || Date.now())) : null);

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
  const url = isEdit
    ? `${API_URL}/clientes/${payload.editingCustomerId}`
    : `${API_URL}/clientes`;

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
  await fetchJSON(`${API_URL}/clientes/${id}`, {
    method: 'DELETE'
  });
  return fetchCustomers();
};

export const getNextVDNumber = async () => {
  const data = await fetchJSON(`${API_URL}/next-vd`);
  return Number(data?.next ?? 1);
};

export const syncNextVDNumber = async (_date?: Date) => {
  return getNextVDNumber();
};