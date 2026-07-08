/**
 * Auditoria manual do fluxo de stock (local + opcional Supabase).
 *
 * Pré-requisitos:
 * - API a correr: node api/server.js (default http://localhost:3001)
 * - Para validar cloud: .env na raiz com SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (ou ANON com RLS que permita read)
 *
 * Uso:
 *   npm run stock:audit
 *   STOCK_AUDIT_API_URL=http://127.0.0.1:3001 npm run stock:audit
 */

import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const API_URL = process.env.STOCK_AUDIT_API_URL || 'http://localhost:3001';

async function fetchJson(url, options = {}) {
  const res = await fetch(url, options);
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`Resposta nao-JSON (${res.status})`);
  }
  if (!res.ok) {
    throw new Error(data?.error || `HTTP ${res.status}`);
  }
  return data;
}

function getSupabase() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
  if (!url || !key) return null;
  return createClient(url, key);
}

async function getLocalProductById(id) {
  const list = await fetchJson(`${API_URL}/produtos`);
  const row = (list || []).find((p) => String(p.id) === String(id));
  if (!row) throw new Error(`Produto local id=${id} nao encontrado em /produtos`);
  return row;
}

async function getCloudStock(supabase, cloudId) {
  const { data, error } = await supabase.from('products').select('stock_quantity').eq('id', cloudId).maybeSingle();
  if (error) throw error;
  return data == null ? null : Number(data.stock_quantity ?? 0);
}

async function waitForCloudStock(supabase, cloudId, expected, { timeoutMs = 45000, intervalMs = 1500 } = {}) {
  const start = Date.now();
  let last = null;
  while (Date.now() - start < timeoutMs) {
    last = await getCloudStock(supabase, cloudId);
    if (last === expected) return last;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(
    `Timeout cloud stock: cloud_id=${cloudId} esperado=${expected} ultimo=${last} (${timeoutMs}ms)`
  );
}

async function run() {
  console.log('[STOCK AUDIT] API_URL=', API_URL);

  const categories = await fetchJson(`${API_URL}/categorias`);
  if (!categories?.length) {
    throw new Error('Sem categorias no SQLite: crie uma categoria antes de correr o audit.');
  }
  const categoryId = categories[0].id;

  const tag = `AUDIT_STOCK_${Date.now()}`;
  const createRes = await fetchJson(`${API_URL}/produtos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: tag,
      price: 1,
      category_id: categoryId,
      stock_quantity: 10,
      active: true,
      is_service: false,
    }),
  });

  const productId = String(createRes?.id ?? '');
  if (!productId) throw new Error('POST /produtos nao devolveu id');
  const cloudId = createRes?.cloud_id ? String(createRes.cloud_id) : null;

  let p = await getLocalProductById(productId);
  console.log('[STOCK AUDIT] produto criado local id=', productId, 'stock=', p.stock_quantity, 'cloud_id=', p.cloud_id ?? cloudId);

  if (Number(p.stock_quantity) !== 10) {
    throw new Error(`Esperado stock local inicial 10, obteve ${p.stock_quantity}`);
  }

  const sale = (qty, label) =>
    fetchJson(`${API_URL}/vendas`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        total: qty,
        saleTimestamp: new Date().toISOString(),
        cart: [
          {
            id: productId,
            name: tag,
            price: 1,
            quantity: qty,
            is_service: false,
            cloud_id: p.cloud_id ?? cloudId,
          },
        ],
        paymentMethod: 'cash',
      }),
    }).then((r) => {
      console.log('[STOCK AUDIT] venda', label, 'ok vd=', r?.usedDocumentNumber);
      return r;
    });

  await sale(2, '1 (qty 2)');
  p = await getLocalProductById(productId);
  console.log('[STOCK AUDIT] apos venda 2 local stock=', p.stock_quantity);
  if (Number(p.stock_quantity) !== 8) {
    throw new Error(`Esperado local 8 apos vender 2, obteve ${p.stock_quantity}`);
  }

  const supabase = getSupabase();
  if (supabase && (p.cloud_id ?? cloudId)) {
    const cid = String(p.cloud_id ?? cloudId);
    await fetchJson(`${API_URL}/sync/run`, { method: 'POST' }).catch(() => null);
    try {
      await waitForCloudStock(supabase, cid, 8);
      console.log('[STOCK AUDIT] cloud stock apos venda 2 = 8 OK cloud_id=', cid);
    } catch (e) {
      console.warn('[STOCK AUDIT] cloud nao atingiu 8 (sync/RPC/RLS?):', e.message);
    }
  } else {
    console.log('[STOCK AUDIT] skip verificacao cloud (sem supabase env ou cloud_id)');
  }

  await sale(3, '2 (qty 3)');
  p = await getLocalProductById(productId);
  console.log('[STOCK AUDIT] apos venda 3 local stock=', p.stock_quantity);
  if (Number(p.stock_quantity) !== 5) {
    throw new Error(`Esperado local 5 apos vender 3, obteve ${p.stock_quantity}`);
  }

  if (supabase && (p.cloud_id ?? cloudId)) {
    const cid = String(p.cloud_id ?? cloudId);
    await fetchJson(`${API_URL}/sync/run`, { method: 'POST' }).catch(() => null);
    try {
      await waitForCloudStock(supabase, cid, 5);
      console.log('[STOCK AUDIT] cloud stock apos venda 3 = 5 OK cloud_id=', cid);
    } catch (e) {
      console.warn('[STOCK AUDIT] cloud nao atingiu 5:', e.message);
    }
  }

  const stockBeforePull = Number(p.stock_quantity);
  await fetchJson(`${API_URL}/sync/run`, { method: 'POST' });
  p = await getLocalProductById(productId);
  const stockAfterPull = Number(p.stock_quantity);
  console.log('[STOCK AUDIT] pull simulado (POST /sync/run): antes=', stockBeforePull, 'depois=', stockAfterPull);
  if (stockAfterPull !== stockBeforePull) {
    console.warn(
      '[STOCK AUDIT] AVISO: stock local alterou apos pull. Isto pode ser esperado se stock_movements/cloud products divergirem.'
    );
  }

  console.log('[STOCK AUDIT] concluido com sucesso (local).');
}

run().catch((err) => {
  console.error('[STOCK AUDIT] FALHA:', err.message);
  process.exit(1);
});
