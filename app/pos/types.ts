// Shared POS domain types used across page, components, and hooks.
export interface Product {
  id: string;
  name: string;
  price: number;
  category: string;
  color?: string;
  // Used by some UI paths even if not currently rendered.
  image?: string;
  stock_quantity?: number;
  min_stock?: number;
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
  name: string;
  phone: string;
  email?: string;
  address?: string;
  points?: number;
}

export interface User {
  id: string;
  name: string;
  password?: string;
  role: 'admin' | 'user';
  avatar?: string;
}

export type Discount = {
  type: 'value' | 'percentage';
  amount: number;
};

export type PaymentMethod = 'cash' | 'card' | 'pix';

export type PaymentEntry = {
  method: PaymentMethod;
  amount: number;
};
