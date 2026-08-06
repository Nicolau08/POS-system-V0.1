/**
 * Metadados de clientes/fornecedores guardados no browser.
 *
 * A tabela `clientes` não distingue cliente de fornecedor: a marcação vive no
 * toggle «Cliente» do ecrã Clientes & Fornecedores e é persistida aqui.
 */

export type PartyMeta = {
  active?: boolean;
  isCustomer?: boolean;
  taxExempt?: boolean;
  code?: string;
};

export const PARTY_META_STORAGE_KEY = 'customers-manager-meta';

export function readPartyMetaById(): Record<string, PartyMeta> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(PARTY_META_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') return parsed as Record<string, PartyMeta>;
  } catch {
    /* ignore */
  }
  return {};
}

/** Fornecedor exige marcação explícita; sem metadados assume-se cliente. */
export function isSupplierParty(id: string | number, metaById: Record<string, PartyMeta>) {
  return metaById[String(id)]?.isCustomer === false;
}

/**
 * Fornecedor combinando o papel derivado no backend (documentos de compra) com a
 * marcação local do ecrã Clientes & Fornecedores.
 */
export function isSupplierPartyRecord(
  party: { id: string | number; is_supplier?: boolean | null },
  metaById: Record<string, PartyMeta>,
) {
  return Boolean(party?.is_supplier) || isSupplierParty(party.id, metaById);
}
