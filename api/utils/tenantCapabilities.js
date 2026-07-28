const VERTICAL_IDS = [
  'restauracao',
  'retalho',
  'farmacia',
  'barbearia',
  'salao_beleza',
  'ginasio',
  'talho',
  'supermercado',
  'graficas',
  'hotelaria',
];

const CAPABILITY_IDS = [
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
];

const CAPABILITY_SET = new Set(CAPABILITY_IDS);
const VERTICAL_SET = new Set(VERTICAL_IDS);

const VERTICAL_PRESETS = {
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

function normalizeKey(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\s-]+/g, '_');
}

export function inferVerticalFromCommerceType(value) {
  const normalized = normalizeKey(value);
  if (
    normalized === 'restauracao' ||
    normalized === 'restaurant' ||
    normalized === 'resto' ||
    normalized === 'food' ||
    normalized === 'horeca'
  ) {
    return 'restauracao';
  }
  if (normalized === 'farmacia' || normalized === 'pharmacy' || normalized === 'pharma') {
    return 'farmacia';
  }
  return 'retalho';
}

export function normalizeVertical(value, fallbackCommerceType = null) {
  const normalized = normalizeKey(value);
  if (VERTICAL_SET.has(normalized)) return normalized;
  return inferVerticalFromCommerceType(fallbackCommerceType);
}

export function getVerticalPreset(vertical) {
  const normalized = normalizeVertical(vertical);
  return [...(VERTICAL_PRESETS[normalized] || VERTICAL_PRESETS.retalho)];
}

export function normalizeCapabilities(raw, vertical, fallbackCommerceType = null) {
  const normalizedVertical = normalizeVertical(vertical, fallbackCommerceType);
  let parsed = raw;

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

  const normalized = [];
  const seen = new Set();
  for (const item of parsed) {
    const id = normalizeKey(item);
    if (!CAPABILITY_SET.has(id) || seen.has(id)) continue;
    seen.add(id);
    normalized.push(id);
  }
  return normalized.length > 0 ? normalized : getVerticalPreset(normalizedVertical);
}

export function serializeCapabilities(capabilities, vertical, fallbackCommerceType = null) {
  return JSON.stringify(normalizeCapabilities(capabilities, vertical, fallbackCommerceType));
}

export function hasCapability(capabilities, id) {
  const capabilityId = normalizeKey(id);
  if (!CAPABILITY_SET.has(capabilityId)) return false;
  return normalizeCapabilities(capabilities, 'retalho').includes(capabilityId);
}
