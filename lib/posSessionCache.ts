import type {
  CompanyProfile,
  Customer,
  PaymentMethodOption,
  Product,
  User as PosUser,
} from '@/app/pos/types';
import type { CommerceType } from '@/lib/commerceProfile';
import type { CapabilityId, VerticalId } from '@/lib/capabilities';
import type { PermissionRulesMap } from '@/lib/permissions';
import type { SetupStatusPayload, PosWarehouse } from '@/lib/services/posService';

export type CachedTenantLicenseInfo = {
  name: string;
  nuit: string;
  licenseType: string;
  commerceType: CommerceType;
  vertical: VerticalId;
  capabilities: CapabilityId[];
  licenseExpiresAt: string | null;
};

export type PosCommerceSlice = {
  commerceType: CommerceType;
  license: CachedTenantLicenseInfo;
};

export type PosCatalogSlice = {
  products: Product[];
  customers: Customer[];
  familyColors: Record<string, string>;
  paymentMethods: PaymentMethodOption[];
  companyProfile: CompanyProfile | null;
};

export type PosLocationsTablesSlice = {
  tableIds: string[];
  tablesSummary: string;
  allowCustomNames: boolean;
};

export type DashboardPeriodPreset = 'today' | 'yesterday' | 'week' | 'month' | 'year' | 'custom';

export type DashboardPeriodFilter = {
  preset: DashboardPeriodPreset;
  from: string;
  to: string;
};

export type PosDashboardSlice = {
  year: number;
  monthlySalesData: { name: string; sales: number; vendas?: number }[];
  totalSales: number;
  bestMonth: string;
  bestMonthValue: number;
  period?: {
    preset?: DashboardPeriodPreset;
    from?: string;
    to?: string;
    monthLabel: string;
    totalVendas: number;
    totalCaixa: number;
    creditSales: number;
    returns: number;
  };
  topProducts: { name: string; sales: number; price: number }[];
  topGroups: { name: string; sales: number }[];
  topCustomers: { name: string; total: number }[];
  topEmployees?: { name: string; total: number }[];
  paymentTypes?: { name: string; value: number; percent: number }[];
  periodFilter?: DashboardPeriodFilter;
};

export type PosActivationSlice = {
  success: boolean;
  isActivated: boolean;
  machineId: string;
  activationCode: string;
  reason?: string;
  licensePath?: string;
};

/** Preferências do ecrã POS (sobrevivem a ir/voltar do Gerenciamento). */
export type PosWorkspaceSlice = {
  docType: 'VD' | 'TK' | 'FP' | 'FT';
  salesMode: 'customer' | 'table';
};

/**
 * Cache de sessão em memória — sobrevive a remount POS ↔ Gerenciamento.
 * Limpa no logout / fechar app (módulo reinicia).
 * Dados voláteis (stock live, docs, logs, mesas partilhadas) NÃO ficam aqui como fonte de verdade.
 */
type PosSessionCacheState = {
  catalog: PosCatalogSlice | null;
  categories: unknown[] | null;
  taxRates: unknown[] | null;
  warehouses: PosWarehouse[] | null;
  loginUsers: PosUser[] | null;
  permissionRules: PermissionRulesMap | null;
  locationsTables: PosLocationsTablesSlice | null;
  commerce: PosCommerceSlice | null;
  setupStatus: SetupStatusPayload | null;
  activationState: PosActivationSlice | null;
  dashboard: PosDashboardSlice | null;
  workspace: PosWorkspaceSlice | null;
};

const emptyState = (): PosSessionCacheState => ({
  catalog: null,
  categories: null,
  taxRates: null,
  warehouses: null,
  loginUsers: null,
  permissionRules: null,
  locationsTables: null,
  commerce: null,
  setupStatus: null,
  activationState: null,
  dashboard: null,
  workspace: null,
});

let state: PosSessionCacheState = emptyState();

export function clearPosSessionCache(): void {
  state = emptyState();
}

// --- Catalog (compat + shared) ---

export function getPosCatalogCache(): PosCatalogSlice | null {
  return state.catalog;
}

export function setPosCatalogCache(next: PosCatalogSlice): void {
  state.catalog = next;
}

export function patchPosCatalogCache(partial: Partial<PosCatalogSlice>): void {
  if (!state.catalog) {
    state.catalog = {
      products: partial.products ?? [],
      customers: partial.customers ?? [],
      familyColors: partial.familyColors ?? {},
      paymentMethods: partial.paymentMethods ?? [],
      companyProfile: partial.companyProfile ?? null,
    };
    return;
  }
  state.catalog = { ...state.catalog, ...partial };
}

export function clearPosCatalogCache(): void {
  state.catalog = null;
}

// --- Categories / tax / warehouses (management + POS) ---

export function getCachedCategories(): unknown[] | null {
  return state.categories;
}

export function setCachedCategories(rows: unknown[]): void {
  state.categories = rows;
}

export function getCachedTaxRates(): unknown[] | null {
  return state.taxRates;
}

export function setCachedTaxRates(rows: unknown[]): void {
  state.taxRates = rows;
}

export function getCachedWarehouses(): PosWarehouse[] | null {
  return state.warehouses;
}

export function setCachedWarehouses(rows: PosWarehouse[]): void {
  state.warehouses = rows;
}

// --- Login users ---

export function getCachedLoginUsers(): PosUser[] | null {
  return state.loginUsers;
}

export function setCachedLoginUsers(users: PosUser[]): void {
  state.loginUsers = users;
}

// --- Permissions ---

export function getCachedPermissionRules(): PermissionRulesMap | null {
  return state.permissionRules;
}

export function setCachedPermissionRules(rules: PermissionRulesMap): void {
  state.permissionRules = rules;
}

// --- Locations / tables ---

export function getCachedLocationsTables(): PosLocationsTablesSlice | null {
  return state.locationsTables;
}

export function setCachedLocationsTables(slice: PosLocationsTablesSlice): void {
  state.locationsTables = slice;
}

// --- Commerce / tenant ---

export function getCachedCommerce(): PosCommerceSlice | null {
  return state.commerce;
}

export function setCachedCommerce(slice: PosCommerceSlice): void {
  state.commerce = slice;
}

// --- Setup / activation ---

export function getCachedSetupStatus(): SetupStatusPayload | null {
  return state.setupStatus;
}

export function setCachedSetupStatus(status: SetupStatusPayload | null): void {
  state.setupStatus = status;
}

export function getCachedActivationState(): PosActivationSlice | null {
  return state.activationState;
}

export function setCachedActivationState(next: PosActivationSlice | null): void {
  state.activationState = next;
}

// --- Dashboard ---

export function getCachedDashboard(): PosDashboardSlice | null {
  return state.dashboard;
}

export function setCachedDashboard(next: PosDashboardSlice): void {
  state.dashboard = next;
}

// --- Workspace (doc type, sales mode) ---

export function getCachedPosWorkspace(): PosWorkspaceSlice | null {
  return state.workspace;
}

export function setCachedPosWorkspace(next: PosWorkspaceSlice): void {
  state.workspace = next;
}

export function patchCachedPosWorkspace(partial: Partial<PosWorkspaceSlice>): void {
  state.workspace = {
    docType: partial.docType ?? state.workspace?.docType ?? 'VD',
    salesMode: partial.salesMode ?? state.workspace?.salesMode ?? 'customer',
  };
}
