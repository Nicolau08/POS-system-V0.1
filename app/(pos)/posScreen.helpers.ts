/**
 * Tipos, constantes e funções puras usadas por PosScreen.tsx.
 * Extraído de PosScreen.tsx — mesmo código, sem alterações de comportamento
 * (incluindo o código morto pré-existente em handleSupabaseError, ver nota abaixo).
 */
import type { PaymentMethodOption } from '@/app/pos/types';

export type RouteProps = {
  params: Promise<Record<string, string | string[] | undefined>>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export type ActivationStatePayload = {
  success: boolean;
  isActivated: boolean;
  machineId: string;
  activationCode: string;
  reason?: string;
  licensePath?: string;
};

export const DEFAULT_TABLE_IDS = Array.from({ length: 20 }, (_, i) => String(i + 1));
export const POS_UI_BOOTSTRAP_KEY = 'pos-ui-bootstrapped';

export function isPosUiBootstrapped() {
  if (typeof window === 'undefined') return false;
  try {
    return sessionStorage.getItem(POS_UI_BOOTSTRAP_KEY) === '1';
  } catch {
    return false;
  }
}

export function markPosUiBootstrapped() {
  try {
    sessionStorage.setItem(POS_UI_BOOTSTRAP_KEY, '1');
  } catch {
    // ignore
  }
}

export const FALLBACK_PAYMENT_METHODS: PaymentMethodOption[] = [
  {
    id: 'cash',
    name: 'DINHEIRO',
    code: 'cash',
    shortcut: null,
    position: 1,
    enabled: true,
    quickPayment: true,
    requiredCustomer: false,
    allowChange: true,
    markAsPaid: true,
    printReceipt: true,
    openCashDrawer: true,
    color: '#66c013',
  },
  {
    id: 'conta-corrente',
    name: 'CONTA CORRENTE',
    code: 'conta-corrente',
    shortcut: null,
    position: 2,
    enabled: true,
    quickPayment: true,
    requiredCustomer: true,
    allowChange: false,
    markAsPaid: false,
    printReceipt: true,
    openCashDrawer: false,
    color: '#eab308',
  },
];

export const normalizeUnknownError = (error: any) => {
  if (error instanceof Error) {
    return {
      message: error.message || 'Erro desconhecido',
      details: (error as any).details || 'Sem detalhes adicionais',
      hint: (error as any).hint || 'Sem sugestões',
      code: (error as any).code || 'Sem código de erro',
      raw: error,
    };
  }

  if (typeof Event !== 'undefined' && error instanceof Event) {
    return {
      message: `Evento inesperado: ${error.type || 'desconhecido'}`,
      details: 'O navegador retornou um evento em vez de um erro estruturado.',
      hint: 'Verifique a ligação com a internet ou tente novamente.',
      code: 'BROWSER_EVENT',
      raw: error,
    };
  }

  if (typeof error === 'string') {
    return {
      message: error,
      details: 'Sem detalhes adicionais',
      hint: 'Sem sugestões',
      code: 'STRING_ERROR',
      raw: error,
    };
  }

  return {
    message: error?.message || error?.error_description || error?.error || 'Erro desconhecido',
    details: error?.details || 'Sem detalhes adicionais',
    hint: error?.hint || 'Sem sugestões',
    code: error?.code || 'Sem código de erro',
    raw: error,
  };
};

// --- Error Handling ---
export const handleSupabaseError = (error: any, operation: string) => {
  const normalized = normalizeUnknownError(error);
  console.error(`Supabase Error (${operation}): ${normalized.message}`, normalized.raw);
  return {
    message: normalized.message,
    details: normalized.details,
    hint: normalized.hint,
    code: normalized.code,
  };
};
