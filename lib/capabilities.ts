import type { CommerceType } from '@/lib/commerceProfile';

export type CapabilityId =
  | 'sales'
  | 'inventory'
  | 'customers'
  | 'multi_station'
  | 'android_posto'
  | 'tables'
  | 'print_centers'
  | 'kds'
  | 'android_kds'
  | 'services'
  | 'staff_commission'
  | 'appointments'
  | 'memberships'
  | 'checkin'
  | 'batches_expiry'
  | 'controlled_items'
  | 'weighing'
  | 'departments'
  | 'work_orders'
  | 'quotes';

export type VerticalId =
  | 'restauracao'
  | 'retalho'
  | 'farmacia'
  | 'barbearia'
  | 'salao_beleza'
  | 'ginasio'
  | 'talho'
  | 'supermercado'
  | 'graficas'
  | 'hotelaria';

const CAPABILITY_SET = new Set<CapabilityId>([
  'sales',
  'inventory',
  'customers',
  'multi_station',
  'android_posto',
  'tables',
  'print_centers',
  'kds',
  'android_kds',
  'services',
  'staff_commission',
  'appointments',
  'memberships',
  'checkin',
  'batches_expiry',
  'controlled_items',
  'weighing',
  'departments',
  'work_orders',
  'quotes',
]);

export const VERTICAL_OPTIONS: Array<{ value: VerticalId; label: string }> = [
  { value: 'restauracao', label: 'Restauração' },
  { value: 'retalho', label: 'Retalho' },
  { value: 'farmacia', label: 'Farmácia' },
  { value: 'barbearia', label: 'Barbearia' },
  { value: 'salao_beleza', label: 'Salão de Beleza' },
  { value: 'ginasio', label: 'Ginásio' },
  { value: 'talho', label: 'Talho' },
  { value: 'supermercado', label: 'Supermercado' },
  { value: 'graficas', label: 'Gráficas' },
  { value: 'hotelaria', label: 'Hotelaria' },
];

const VERTICAL_SET = new Set<VerticalId>(VERTICAL_OPTIONS.map((option) => option.value));

const VERTICAL_PRESETS: Record<VerticalId, CapabilityId[]> = {
  restauracao: ['sales', 'inventory', 'customers', 'multi_station', 'tables', 'print_centers', 'kds'],
  retalho: ['sales', 'inventory', 'customers', 'multi_station'],
  farmacia: ['sales', 'inventory', 'customers', 'multi_station', 'batches_expiry', 'controlled_items'],
  barbearia: ['sales', 'customers', 'services', 'staff_commission', 'appointments'],
  salao_beleza: ['sales', 'customers', 'services', 'staff_commission', 'appointments'],
  ginasio: ['sales', 'customers', 'services', 'appointments', 'memberships', 'checkin'],
  talho: ['sales', 'inventory', 'customers', 'multi_station', 'batches_expiry', 'weighing'],
  supermercado: ['sales', 'inventory', 'customers', 'multi_station', 'departments'],
  graficas: ['sales', 'inventory', 'customers', 'services', 'work_orders', 'quotes'],
  hotelaria: ['sales', 'inventory', 'customers', 'multi_station', 'tables'],
};

function normalizeKey(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\s-]+/g, '_');
}

export function inferVerticalFromCommerceType(commerceType: unknown): VerticalId {
  const raw = normalizeKey(commerceType);
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
  return 'retalho';
}

export function normalizeVertical(
  value: unknown,
  fallbackCommerceType: CommerceType | unknown = null,
): VerticalId {
  const raw = normalizeKey(value);
  if (VERTICAL_SET.has(raw as VerticalId)) return raw as VerticalId;
  return inferVerticalFromCommerceType(fallbackCommerceType);
}

export function getVerticalPreset(vertical: VerticalId | unknown): CapabilityId[] {
  const normalizedVertical = normalizeVertical(vertical);
  return [...VERTICAL_PRESETS[normalizedVertical]];
}

export function normalizeCapabilities(
  json: unknown,
  vertical: VerticalId | unknown,
  fallbackCommerceType: CommerceType | unknown = null,
): CapabilityId[] {
  const normalizedVertical = normalizeVertical(vertical, fallbackCommerceType);
  let parsed = json;

  if (typeof parsed === 'string') {
    const trimmed = parsed.trim();
    if (!trimmed) {
      parsed = null;
    } else {
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        parsed = null;
      }
    }
  }

  if (!Array.isArray(parsed)) {
    return getVerticalPreset(normalizedVertical);
  }

  const next: CapabilityId[] = [];
  const seen = new Set<CapabilityId>();
  for (const item of parsed) {
    const normalizedCapability = normalizeKey(item) as CapabilityId;
    if (!CAPABILITY_SET.has(normalizedCapability) || seen.has(normalizedCapability)) continue;
    seen.add(normalizedCapability);
    next.push(normalizedCapability);
  }

  return next.length > 0 ? next : getVerticalPreset(normalizedVertical);
}

export function hasCapability(capabilities: CapabilityId[], id: CapabilityId): boolean {
  return capabilities.includes(id);
}
