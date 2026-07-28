import { getPosApiBase, getPosUserAuthHeaders } from '@/lib/apiBase';
import { unwrapApiSuccessPayload } from '@/lib/apiResponse';
import type { ProductionPrintItem, ProductionPrintMeta } from '@/lib/productionPrint';
import { printProductionTickets } from '@/lib/productionPrint';
import { loadStationClientSettings } from '@/lib/stationClientSettings';

export type KitchenTicketSubmitResult = {
  tickets: unknown[];
  printed: number;
  errors: string[];
};

/**
 * Envia pedido à cozinha (KDS) + impressão opcional via API do servidor.
 * Em falha do endpoint KDS (ex. retalho), faz fallback só à impressão local/desktop.
 */
export async function submitKitchenOrder(
  items: ProductionPrintItem[],
  meta: ProductionPrintMeta & {
    tableKey?: string | null;
    printAlso?: boolean;
    source?: string;
  } = {},
): Promise<KitchenTicketSubmitResult> {
  const normalized = (items || [])
    .map((item) => ({
      name: String(item.name ?? 'Item'),
      quantity: Number(item.quantity) || 0,
      category_id: item.category_id ?? item.categoryId ?? null,
      category: item.category ?? null,
      notes: item.notes != null ? String(item.notes).trim().slice(0, 500) || null : null,
      productId: (item as { id?: string }).id ?? null,
    }))
    .filter((item) => item.quantity > 0);

  if (!normalized.length) {
    return { tickets: [], printed: 0, errors: [] };
  }

  const station = loadStationClientSettings();
  const printAlso = meta.printAlso !== false;

  try {
    const res = await fetch(`${getPosApiBase()}/kitchen/tickets`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...getPosUserAuthHeaders(),
      },
      body: JSON.stringify({
        items: normalized,
        tableKey: meta.tableKey ?? null,
        tableLabel: meta.tableLabel ?? null,
        docLabel: meta.docLabel ?? 'PEDIDO',
        timeLabel: meta.timeLabel ?? null,
        printAlso,
        source: meta.source ?? station.stationRole ?? 'pos_desktop',
        stationCode: station.stationCode,
      }),
    });
    const json = await res.json().catch(() => null);
    if (!res.ok) {
      const code = json?.error?.code ?? json?.code;
      // Perfil sem KDS → só impressão clássica.
      if (res.status === 403 && String(code) === 'KDS_NOT_AVAILABLE') {
        const print = printAlso
          ? await printProductionTickets(items, meta)
          : { printed: 0, errors: [] as string[] };
        return { tickets: [], printed: print.printed, errors: print.errors };
      }
      const message = String(json?.error?.message ?? json?.message ?? `HTTP ${res.status}`);
      throw new Error(message);
    }
    const data = unwrapApiSuccessPayload<any>(json) ?? json?.data ?? json;
    const print = data?.print ?? null;
    return {
      tickets: Array.isArray(data?.tickets) ? data.tickets : [],
      printed: Number(print?.printed ?? 0),
      errors: Array.isArray(print?.errors) ? print.errors.map(String) : [],
    };
  } catch (error) {
    // Rede / API em baixo: tentar impressão local se pedida.
    if (printAlso) {
      const print = await printProductionTickets(items, meta);
      const msg = error instanceof Error ? error.message : String(error);
      return {
        tickets: [],
        printed: print.printed,
        errors: [...print.errors, msg].filter(Boolean),
      };
    }
    throw error;
  }
}
