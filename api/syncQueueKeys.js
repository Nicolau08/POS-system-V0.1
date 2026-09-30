/**
 * Construção pura de dedupe_key/sync_ref para sync_queue — extraído de syncQueue.js para que possa ser
 * reutilizado por ferramentas só-leitura (ex.: api/scripts/pilot-tenant-repair.mjs) sem arrastar o import de
 * ./dbUtils.js (que abre `db` de ./database.js com efeitos secundários de escrita ao ser importado).
 *
 * Zero imports, zero I/O — só string/JSON. Mesma lógica exacta usada por enqueueSync(), nunca duplicada.
 */

export function buildDedupeKey(type, payload, tenantId) {
  if (type === 'product' && payload?.id) return `${tenantId}:product:${Number(payload.id)}`;
  if (type === 'customer' && payload?.id) return `${tenantId}:customer:${Number(payload.id)}`;
  if (type === 'category' && payload?.id) return `${tenantId}:category:${Number(payload.id)}`;
  return null;
}

export function buildSyncRef(type, payload, tenantId) {
  if (payload?.syncRef) return `${tenantId}:${String(payload.syncRef)}`;
  if (type === 'sale' && payload?.local_sale_id) return `${tenantId}:sale:${payload.local_sale_id}`;
  if (payload?.id != null) return `${tenantId}:${type}:${payload.id}`;
  return null;
}
