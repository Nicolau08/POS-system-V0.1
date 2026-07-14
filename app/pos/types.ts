// Shared POS domain types used across page, components, and hooks.
export interface Product {
  id: string;
  code?: string | number;
  barcode?: string;
  name: string;
  price: number;
  category: string;
  color?: string;
  // Used by some UI paths even if not currently rendered.
  image?: string;
  stock_quantity?: number;
  min_stock?: number;
  active?: boolean;
  /** Supabase `products.id` (UUID); obrigatorio para sync de vendas/estoque */
  cloud_id?: string;
  is_service?: boolean;
}

export interface CartItem extends Product {
  quantity: number;
  discount?: {
    type: 'value' | 'percentage';
    amount: number;
  };
}

export interface Customer {
  id: string;
  cloud_id?: string | null;
  name: string;
  phone: string;
  email?: string;
  address?: string;
  /** Saldo em d├¡vida (FT / Conta Corrente pendente), em MT. */
  debt_balance?: number;
}

export interface User {
  id: string;
  name: string;
  surname?: string | null;
  email?: string | null;
  password?: string;
  role: 'admin' | 'user';
  accessLevel?: number;
  active?: boolean;
  avatar?: string;
}

export type Discount = {
  type: 'value' | 'percentage';
  amount: number;
};

export type PaymentMethod = string;

export type PaymentMethodOption = {
  id: string;
  name: string;
  code: string;
  shortcut?: string | null;
  position: number;
  enabled: boolean;
  quickPayment: boolean;
  requiredCustomer: boolean;
  allowChange: boolean;
  markAsPaid: boolean;
  printReceipt: boolean;
  openCashDrawer: boolean;
};

export type PaymentEntry = {
  method: PaymentMethod;
  amount: number;
};

/** Dados cadastrados em Gerenciamento ÔåÆ Minha Empresa (espelha API /company-profile). */
export type CompanyProfile = {
  name: string;
  taxId: string;
  street: string;
  buildingNumber: string;
  additionalStreet: string;
  plotIdentification: string;
  district: string;
  city: string;
  state: string;
  country: string;
  phone: string;
  email: string;
  bankAccountNumber: string;
  bankDetails: string;
  logoDataUrl: string | null;
  voidReasons: string[];
  updatedAt?: string | null;
};
