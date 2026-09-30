/**
 * Etapa 1G.2B.4 - catalogo por Store (lado local). products = mestre do tenant; store_products = estado do
 * produto NESTA Store, espelhado da cloud (pull limitado pelo RLS a Store do Device).
 *
 * Regra de venda NOVA (offline-first, usa o ultimo estado sincronizado):
 *  - catalogo por Store ainda nao inicializado (nenhum pull concluido) -> vendavel (instalacao legada/local);
 *  - produto sem cloud_id (criado localmente, ainda nao sincronizado) -> vendavel;
 *  - store_products active -> vendavel; discontinued -> bloqueado; sem linha -> bloqueado.
 * Vendas ja concluidas offline continuam sincronizaveis (a cloud aceita descontinuado - 1G.2B.3).
 */
import { all, get, run } from '../dbUtils.js';

// Fragmento SQL (tabelas: p = products, sp = LEFT JOIN store_products) usado pela listagem do catalogo.
export const STORE_AVAILABLE_SQL = `(CASE
  WHEN NOT EXISTS (SELECT 1 FROM store_catalog_state scs WHERE scs.tenant_id = p.tenant_id) THEN 1
  WHEN p.cloud_id IS NULL THEN 1
  WHEN sp.status = 'active' THEN 1
  ELSE 0 END)`;

const asNumberOrNull = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

/** Aplica linhas store_products (formato cloud). `initialize` marca o catalogo por Store como activo (so no pull completo). */
export async function applyStoreProductRows(tenantId, rows, { initialize = false } = {}) {
  const now = new Date().toISOString();
  let applied = 0;
  for (const r of rows ?? []) {
    const status = r?.status === 'discontinued' ? 'discontinued' : 'active';
    const productCloudId = String(r?.product_id ?? '').trim();
    if (!productCloudId) continue;
    await run(
      `INSERT INTO store_products (tenant_id, product_cloud_id, status, price_override, min_stock, cloud_updated_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (tenant_id, product_cloud_id) DO UPDATE SET
         status = excluded.status,
         price_override = excluded.price_override,
         min_stock = excluded.min_stock,
         cloud_updated_at = excluded.cloud_updated_at,
         updated_at = excluded.updated_at`,
      [tenantId, productCloudId, status, asNumberOrNull(r?.price_override), asNumberOrNull(r?.min_stock), r?.updated_at ?? null, now]
    );
    applied += 1;
  }
  if (initialize) {
    await run(`INSERT OR IGNORE INTO store_catalog_state (tenant_id, initialized_at) VALUES (?, ?)`, [tenantId, now]);
  }
  return { applied };
}

/** Itens do carrinho que NAO podem ter nova venda nesta Store. */
export async function findUnsellableCartItems(cart, tenantId) {
  const state = await get(`SELECT 1 AS ok FROM store_catalog_state WHERE tenant_id = ?`, [tenantId]);
  if (!state) return [];
  const ids = [...new Set((Array.isArray(cart) ? cart : []).map((i) => Number(i?.id)).filter((n) => Number.isFinite(n)))];
  if (ids.length === 0) return [];
  const rows = await all(
    `SELECT p.id, p.name, p.cloud_id, sp.status AS store_status
     FROM products p
     LEFT JOIN store_products sp ON sp.tenant_id = p.tenant_id AND sp.product_cloud_id = p.cloud_id
     WHERE p.tenant_id = ? AND p.id IN (${ids.map(() => '?').join(',')})`,
    [tenantId, ...ids]
  );
  const out = [];
  for (const r of rows) {
    if (!r.cloud_id) continue;
    if (r.store_status === 'active') continue;
    out.push({
      product_id: r.id,
      name: String(r.name ?? `Produto ${r.id}`),
      reason: r.store_status === 'discontinued' ? 'discontinued' : 'not_in_store',
    });
  }
  return out;
}
