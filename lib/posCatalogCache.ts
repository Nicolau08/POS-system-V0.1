/**
 * @deprecated Prefer `@/lib/posSessionCache` — mantido para imports existentes.
 */
export {
  clearPosCatalogCache,
  clearPosSessionCache as clearPosCatalogAndSessionCache,
  getPosCatalogCache,
  patchPosCatalogCache,
  setPosCatalogCache,
  type PosCatalogSlice as PosCatalogCache,
} from '@/lib/posSessionCache';
