import { supabase, isConfigured } from '@/lib/supabase';
import type { CartItem, Customer, PaymentEntry, PaymentMethod, Product, User } from '@/app/pos/types';

const getDocumentYear = (date = new Date()) => date.getFullYear();

const coerceToNumber = (value: unknown, fallback = 1) => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
};

// Product fetch used by the POS screen.
export async function fetchProducts(): Promise<Product[]> {
  if (!isConfigured) return [];

  const { data: productsData, error: productsError } = await supabase
    .from('products')
    .select('*, categories(name)');

  if (productsError) throw productsError;

  if (!productsData || productsData.length === 0) return [];

  return productsData.map((p: any) => ({
    id: p.id,
    name: p.name,
    price: Number(p.price),
    category: p.categories?.name || 'Product',
    color: p.color,
    image: p.image_url,
    stock_quantity: Number(p.stock_quantity || 0),
    min_stock: Number(p.min_stock || 0),
    is_service: p.is_service,
  })) as Product[];
}

// Customer fetch used by the POS screen.
export async function fetchCustomers(): Promise<Customer[]> {
  if (!isConfigured) return [];

  const { data: customersData, error: customersError } = await supabase
    .from('customers')
    .select('*');

  if (customersError) throw customersError;
  if (!customersData || customersData.length === 0) return [];
  return customersData as Customer[];
}

// Users are used by the local POS login screen.
export async function fetchUsers(): Promise<User[]> {
  if (!isConfigured) return [];
  const { data, error } = await supabase.from('users').select('*');
  if (error) throw error;
  return (data || []) as User[];
}

// Updates product stock_quantity by delta atomically (no negative stock, concurrency-safe).
export async function updateStock(productId: string, delta: number): Promise<number> {
  if (!isConfigured) return 0;

  const { data, error } = await supabase.rpc('update_stock_atomic', {
    p_product_id: productId,
    p_delta: delta,
  });
  if (error) throw error;

  // rpc returns a scalar NUMERIC/BIGINT as `data`
  const value = Array.isArray(data) ? data[0] : data;
  return coerceToNumber(value, 0);
}

export async function getNextVDSequence(date = new Date()): Promise<number> {
  if (!isConfigured) return 1;

  const year = getDocumentYear(date);
  const { data, error } = await supabase.rpc('vd_sequence_peek', { p_year: year });
  if (error) throw error;

  const value = Array.isArray(data) ? data[0] : data;
  return Math.max(1, Math.floor(coerceToNumber(value, 1)));
}

export async function syncNextVDNumber(date = new Date()): Promise<number> {
  // DB-backed mode: syncing is just peeking ensured next value.
  return getNextVDSequence(date);
}

export type CreateOrderInput = {
  cart: CartItem[];
  globalDiscount: { type: 'value' | 'percentage'; amount: number } | null;
  selectedCustomerId: string | null;
  selectedTableId: string | null;
  docType: 'VD' | 'TK' | 'FP';
  total: number;
  subtotal: number;
  tax: number;
  totalDiscount: number;
  isMultiplePayment: boolean;
  paymentMethod: PaymentMethod | null;
  receivedAmount: string;
  payments: PaymentEntry[];
  // Used for unique doc number generation retry.
  saleTimestamp: string;
  saleDate: Date;
};

// Creates an order + inserts order_items + decrements stock atomically (DB transaction via RPC).
export async function createOrder(input: CreateOrderInput): Promise<{
  orderId: string;
  usedDocumentNumber: string | null;
  usedSequence: number | null;
}> {
  if (!isConfigured) {
    throw new Error('Supabase not configured');
  }

  const {
    cart,
    selectedCustomerId,
    selectedTableId,
    docType,
    total,
    subtotal,
    tax,
    totalDiscount,
    isMultiplePayment,
    paymentMethod,
    receivedAmount,
    payments,
    saleTimestamp,
    saleDate,
  } = input;

  const amount = isMultiplePayment
    ? payments.reduce((acc, p) => acc + p.amount, 0)
    : paymentMethod === 'cash'
      ? (receivedAmount === '' ? total : parseFloat(receivedAmount))
      : total;

  const change = amount > total ? amount - total : 0;

  const { data, error } = await supabase.rpc('create_order_atomic', {
    p_cart: cart.map((item) => ({
      id: item.id,
      name: item.name,
      quantity: item.quantity,
      price: item.price,
      discount: item.discount ?? null,
    })),
    p_selected_customer_id: selectedCustomerId,
    p_selected_table_id: selectedTableId,
    p_doc_type: docType,
    p_total: total,
    p_subtotal: subtotal,
    p_tax: tax,
    p_discount: totalDiscount,
    p_is_multiple_payment: isMultiplePayment,
    p_payment_method: paymentMethod,
    p_received_amount: amount,
    p_change_amount: change,
    p_sale_timestamp: saleTimestamp,
    p_sale_date: saleDate.toISOString().slice(0, 10),
  });

  if (error) throw error;

  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.order_id) throw new Error('create_order_atomic returned no order_id');

  const usedSequenceRaw = row.used_sequence;
  const usedSequenceNumber = usedSequenceRaw != null ? coerceToNumber(usedSequenceRaw, 0) : null;

  return {
    orderId: row.order_id,
    usedDocumentNumber: row.used_document_number ?? null,
    usedSequence: usedSequenceNumber != null && usedSequenceNumber > 0 ? usedSequenceNumber : null,
  };
}

export type SaveCustomerInput = {
  editingCustomerId: string | null;
  newCustomer: { name: string; phone: string; email?: string; address?: string };
};

export async function saveCustomer(input: SaveCustomerInput): Promise<Customer[]> {
  if (!isConfigured) return [];

  const { editingCustomerId, newCustomer } = input;

  if (!newCustomer.name || !newCustomer.phone) return [];

  if (editingCustomerId) {
    const { error } = await supabase
      .from('customers')
      .update({
        name: newCustomer.name,
        phone: newCustomer.phone,
        email: newCustomer.email,
        address: newCustomer.address,
      })
      .eq('id', editingCustomerId);

    if (error) throw error;
  } else {
    const { error } = await supabase.from('customers').insert({
      name: newCustomer.name,
      phone: newCustomer.phone,
      email: newCustomer.email,
      address: newCustomer.address,
      points: 0,
      created_at: new Date().toISOString(),
    });

    if (error) throw error;
  }

  // Refresh customers list for current UI.
  const customers = await fetchCustomers();
  return customers;
}

export async function deleteCustomer(customerId: string): Promise<Customer[]> {
  if (!isConfigured) return [];

  const { error } = await supabase.from('customers').delete().eq('id', customerId);
  if (error) throw error;

  return fetchCustomers();
}

