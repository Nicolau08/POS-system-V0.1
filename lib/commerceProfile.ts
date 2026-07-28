import type { CapabilityId } from '@/lib/capabilities';
import { hasCapability as capabilityEnabled } from '@/lib/capabilities';

/**
 * Tipo de comércio da licença — define o perfil de funcionalidades do POS.
 * Criado na consola de licenças e sincronizado para a instalação local.
 *
 * - Restauração: mesas + locais + centros de produção
 * - Retalho / Farmácia: venda directa (sem mesas); locais para multiposto
 */
export type CommerceType = 'restauracao' | 'retalho' | 'farmacia';

export type CommerceFeatures = {
  /** Mesas / salão (só restauração) */
  tables: boolean;
  /** Locais — restauração (salão) e retalho/farmácia (multiposto) */
  locations: boolean;
  printCenters: boolean;
  /** Preferência inicial: pedir mesa no fluxo */
  askTableDefault: boolean;
  /** Secção / módulos específicos de farmácia */
  pharmacy: boolean;
  /** Modo por defeito no POS */
  defaultSalesMode: 'customer' | 'table';
};

export const COMMERCE_TYPE_OPTIONS: Array<{ value: CommerceType; label: string }> = [
  { value: 'restauracao', label: 'Restauração' },
  { value: 'retalho', label: 'Retalho' },
  { value: 'farmacia', label: 'Farmácia' },
];

const FEATURES: Record<CommerceType, CommerceFeatures> = {
  restauracao: {
    tables: true,
    locations: true,
    printCenters: true,
    askTableDefault: true,
    pharmacy: false,
    defaultSalesMode: 'table',
  },
  retalho: {
    tables: false,
    locations: true,
    printCenters: false,
    askTableDefault: false,
    pharmacy: false,
    defaultSalesMode: 'customer',
  },
  farmacia: {
    tables: false,
    locations: true,
    printCenters: false,
    askTableDefault: false,
    pharmacy: true,
    defaultSalesMode: 'customer',
  },
};

export function normalizeCommerceType(value: unknown): CommerceType {
  const raw = String(value ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  if (
    raw === 'restauracao' ||
    raw === 'restaurant' ||
    raw === 'resto' ||
    raw === 'food' ||
    raw === 'horeca'
  ) {
    return 'restauracao';
  }
  if (raw === 'farmacia' || raw === 'pharmacy' || raw === 'pharma') {
    return 'farmacia';
  }
  if (raw === 'retalho' || raw === 'retail' || raw === 'loja' || raw === 'shop') {
    return 'retalho';
  }
  // Default seguro: retalho (venda directa) se não estiver definido
  return 'retalho';
}

export function getCommerceFeatures(commerceType: unknown): CommerceFeatures {
  return FEATURES[normalizeCommerceType(commerceType)];
}

export function getCommerceFeaturesFromCapabilities(capabilities: CapabilityId[]): CommerceFeatures {
  const tables = capabilityEnabled(capabilities, 'tables');
  const inventory = capabilityEnabled(capabilities, 'inventory');
  const controlledItems = capabilityEnabled(capabilities, 'controlled_items');

  return {
    tables,
    locations: tables || capabilityEnabled(capabilities, 'multi_station') || inventory,
    printCenters: capabilityEnabled(capabilities, 'print_centers'),
    askTableDefault: tables,
    pharmacy: controlledItems,
    defaultSalesMode: tables ? 'table' : 'customer',
  };
}

export function commerceTypeLabel(commerceType: unknown): string {
  const type = normalizeCommerceType(commerceType);
  return COMMERCE_TYPE_OPTIONS.find((o) => o.value === type)?.label ?? type;
}
