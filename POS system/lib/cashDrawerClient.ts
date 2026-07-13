import type { PaymentEntry, PaymentMethod, PaymentMethodOption } from '@/app/pos/types';
import { loadPosSettings } from '@/lib/posSettings';

function methodNeedsDrawer(
  methodCode: PaymentMethod | string | null | undefined,
  paymentMethods: PaymentMethodOption[],
): boolean {
  if (!methodCode) return false;
  const code = String(methodCode).toLowerCase();
  const method = paymentMethods.find((item) => String(item.code).toLowerCase() === code);
  if (method) return Boolean(method.openCashDrawer);
  // Fallback: dinheiro clássico
  return code === 'cash' || code === 'dinheiro';
}

export function paymentsShouldOpenCashDrawer(
  payments: Array<Pick<PaymentEntry, 'method'>>,
  paymentMethods: PaymentMethodOption[],
): boolean {
  if (!payments.length) return false;
  return payments.some((entry) => methodNeedsDrawer(entry.method, paymentMethods));
}

/** Abre a gaveta via ESC/POS RAW na impressora de recibos (Electron). */
export async function openCashDrawerIfNeeded(options: {
  payments: Array<Pick<PaymentEntry, 'method'>>;
  paymentMethods: PaymentMethodOption[];
  enabled?: boolean;
}): Promise<{ attempted: boolean; success: boolean; error?: string }> {
  if (options.enabled === false) {
    return { attempted: false, success: false };
  }
  if (!paymentsShouldOpenCashDrawer(options.payments, options.paymentMethods)) {
    return { attempted: false, success: false };
  }

  if (typeof window === 'undefined' || !window.electronAPI?.openCashDrawer) {
    return {
      attempted: true,
      success: false,
      error: 'Abertura de gaveta disponível na app desktop (Electron).',
    };
  }

  const settings = loadPosSettings();
  const printer = String(settings.printJobs?.receipt?.printer || '').trim();
  if (!printer) {
    return {
      attempted: true,
      success: false,
      error: 'Configure a impressora de recibos em Opções de impressão.',
    };
  }

  try {
    const result = await window.electronAPI.openCashDrawer({
      printer,
      command: settings.printDrawerCommand || '1B700019FA',
      tryBothPins: true,
    });
    return {
      attempted: true,
      success: Boolean(result?.success),
      error: result?.success ? undefined : result?.error,
    };
  } catch (error) {
    return {
      attempted: true,
      success: false,
      error: error instanceof Error ? error.message : 'Falha ao abrir gaveta.',
    };
  }
}
