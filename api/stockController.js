import express from 'express';
import { getDeviceSupabase } from './deviceAuth/deviceSupabaseClient.js';
import { authenticateUser, requireAdmin } from './middlewares/auth.js';
import { parsePagination, withPaginationPayload } from './services/queryOptions.service.js';

const router = express.Router();

function toNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

/**
 * Etapa 1F.3 — migrado do cliente privilegiado (api/supabaseClient.js,
 * SUPABASE_SERVICE_ROLE_KEY) para o cliente Device JWT (mesmo de
 * syncService.js). Nunca lê SUPABASE_SERVICE_ROLE_KEY.
 *
 * `product_stock_ledger` (view) e `recalculate_stock_cache` (RPC) foram
 * deliberadamente bloqueados a `authenticated` desde a Etapa 1E.3
 * (REVOKE ALL ... FROM PUBLIC, anon, authenticated — ver
 * supabase/migrations/20260915000600_stock.sql linha
 * 68/146/159, com justificação explícita "uso administrativo (service_role)")
 * — uma decisão de RLS já revista e aprovada nessa etapa, não revertida aqui
 * sem autorização nova. Por isso este endpoint de auditoria de stock NUNCA
 * vai conseguir devolver dados do ledger sem SUPABASE_SERVICE_ROLE_KEY,
 * mesmo com Device JWT válido — isRlsDeniedError() abaixo transforma esse
 * 42501 esperado num 503 claro, nunca num 500 com detalhe interno do
 * Postgres. Confirmado sem UI a usar este router (routes/products.routes.js
 * e o ecrã de vendas nunca chamam /stock) — é uma ferramenta de
 * diagnóstico/ops, nunca no caminho crítico de uma venda/operação local.
 *
 * Etapa 1F.4 (item 8): mantido tal como está — não se alarga o GRANT do
 * ledger/RPC a `authenticated` só para esta ferramenta continuar a
 * funcionar sem service_role. Se um diagnóstico admin/suporte real for
 * necessário no futuro, deverá ser desenhado como uma RPC dedicada e
 * explicitamente auditada nessa altura, nunca reabrindo silenciosamente
 * este REVOKE.
 */
function isRlsDeniedError(error) {
  const code = String(error?.code ?? '');
  const message = String(error?.message ?? '').toLowerCase();
  return code === '42501' || message.includes('permission denied');
}

function requireSupabase(res) {
  if (getDeviceSupabase()) return true;
  res.status(503).json({ error: 'Supabase nao configurado (Device JWT) para leitura de ledger.' });
  return false;
}

router.get('/', authenticateUser, async (req, res) => {
  if (!requireSupabase(res)) return;
  const supabase = getDeviceSupabase();

  const pagination = parsePagination(req.query ?? {});
  const page = pagination.page;
  const legacyLimit = Math.min(Math.max(1, Number(req.query.limit ?? 50)), 200);
  const limit = pagination.hasPagination ? pagination.limit : legacyLimit;
  const offsetFromPage = pagination.offset;
  const offsetFromLegacy = Math.max(0, Number(req.query.offset ?? 0));
  const offset = req.query.page !== undefined || req.query.limit !== undefined ? offsetFromPage : offsetFromLegacy;

  try {
    const { data: products, error: productError } = await supabase
      .from('products')
      .select('id, stock_quantity')
      .eq('tenant_id', req.tenantId)
      .order('id', { ascending: true })
      .range(offset, offset + limit - 1);
    if (productError) throw productError;

    const productIds = (products ?? []).map((p) => p.id);
    if (productIds.length === 0) {
      if (pagination.hasPagination) {
        return res.json(withPaginationPayload([], { page, limit, total: 0 }));
      }
      return res.json({ limit, offset, count: 0, items: [] });
    }

    const { data: ledgerRows, error: ledgerError } = await supabase
      .from('product_stock_ledger')
      .select('product_id, stock')
      .in('product_id', productIds);
    if (ledgerError) throw ledgerError;

    const ledgerMap = new Map((ledgerRows ?? []).map((row) => [String(row.product_id), toNumber(row.stock, 0)]));
    const items = productIds.map((id, index) => {
      const cachedStock = toNumber(products[index].stock_quantity, 0);
      const ledgerStock = ledgerMap.get(String(id)) ?? 0;
      return {
        product_id: id,
        stock: ledgerStock,
        cached_stock: cachedStock,
        difference: ledgerStock - cachedStock,
      };
    });

    if (pagination.hasPagination) {
      const { count, error: countError } = await supabase
        .from('products')
        .select('*', { count: 'exact', head: true })
        .eq('tenant_id', req.tenantId);
      if (countError) throw countError;
      return res.json(
        withPaginationPayload(items, {
          page,
          limit,
          total: Number(count ?? 0),
        })
      );
    }

    res.json({ limit, offset, count: items.length, items });
  } catch (error) {
    if (isRlsDeniedError(error)) {
      return res.status(503).json({ error: 'Ledger de stock requer acesso privilegiado (service_role) — indisponível via Device JWT.' });
    }
    res.status(500).json({ error: error.message });
  }
});

router.get('/validate', authenticateUser, async (req, res) => {
  if (!requireSupabase(res)) return;
  const supabase = getDeviceSupabase();

  try {
    // product_stock_ledger é uma view sem tenant_id próprio (agrega stock_movements
    // por product_id) — o isolamento por tenant tem de vir de filtrar products
    // primeiro e só pedir o ledger para esses IDs, nunca ao contrário.
    const { data: products, error: productError } = await supabase
      .from('products')
      .select('id, stock_quantity')
      .eq('tenant_id', req.tenantId);
    if (productError) throw productError;

    const productIds = (products ?? []).map((p) => p.id);
    const { data: ledgerRows, error: ledgerError } = productIds.length
      ? await supabase.from('product_stock_ledger').select('product_id, stock').in('product_id', productIds)
      : { data: [], error: null };
    if (ledgerError) throw ledgerError;

    const ledgerMap = new Map((ledgerRows ?? []).map((row) => [String(row.product_id), toNumber(row.stock, 0)]));
    const mismatches = [];

    for (const product of products ?? []) {
      const productId = String(product.id);
      const cached = toNumber(product.stock_quantity, 0);
      const ledger = ledgerMap.get(productId) ?? 0;
      const diff = ledger - cached;
      if (diff !== 0) {
        mismatches.push({
          product_id: productId,
          ledger_stock: ledger,
          cached_stock: cached,
          difference: diff,
        });
      }
    }

    const pagination = parsePagination(req.query ?? {});
    if (pagination.hasPagination) {
      const start = pagination.offset;
      const end = start + pagination.limit;
      const pagedMismatches = mismatches.slice(start, end);
      return res.json({
        total_products_checked: Number((products ?? []).length),
        mismatches_count: Number(mismatches.length),
        ...withPaginationPayload(pagedMismatches, {
          page: pagination.page,
          limit: pagination.limit,
          total: Number(mismatches.length),
        }),
      });
    }

    res.json({
      total_products_checked: Number((products ?? []).length),
      mismatches_count: Number(mismatches.length),
      mismatches,
    });
  } catch (error) {
    if (isRlsDeniedError(error)) {
      return res.status(503).json({ error: 'Ledger de stock requer acesso privilegiado (service_role) — indisponível via Device JWT.' });
    }
    res.status(500).json({ error: error.message });
  }
});

router.get('/:productId/current', authenticateUser, async (req, res) => {
  if (!requireSupabase(res)) return;
  const supabase = getDeviceSupabase();

  const { productId } = req.params;
  try {
    // Confirma primeiro que o produto pertence ao tenant autenticado antes de
    // tocar no ledger — nunca aceitar o resultado de um productId de outro tenant.
    const { data: product, error: productError } = await supabase
      .from('products')
      .select('id, stock_quantity')
      .eq('id', productId)
      .eq('tenant_id', req.tenantId)
      .maybeSingle();
    if (productError) throw productError;
    if (!product) return res.status(404).json({ error: 'Produto nao encontrado' });

    const { data: ledger, error: ledgerError } = await supabase
      .from('product_stock_ledger')
      .select('product_id, stock')
      .eq('product_id', productId)
      .maybeSingle();
    if (ledgerError) throw ledgerError;

    const ledgerStock = toNumber(ledger?.stock, 0);
    const cachedStock = toNumber(product.stock_quantity, 0);
    res.json({
      product_id: product.id,
      stock: ledgerStock,
      cached_stock: cachedStock,
      difference: ledgerStock - cachedStock,
    });
  } catch (error) {
    if (isRlsDeniedError(error)) {
      return res.status(503).json({ error: 'Ledger de stock requer acesso privilegiado (service_role) — indisponível via Device JWT.' });
    }
    res.status(500).json({ error: error.message });
  }
});

router.post('/recalculate', authenticateUser, requireAdmin, async (_req, res) => {
  if (!requireSupabase(res)) return;
  const supabase = getDeviceSupabase();

  try {
    const { data, error } = await supabase.rpc('recalculate_stock_cache');
    if (error) throw error;

    const result = Array.isArray(data) && data.length > 0 ? data[0] : data || {};
    res.json({
      success: true,
      total_products_checked: Number(result.total_products_checked ?? 0),
      mismatches_fixed: Number(result.mismatches_fixed ?? 0),
      recalculated_at: result.recalculated_at ?? new Date().toISOString(),
    });
  } catch (error) {
    if (isRlsDeniedError(error)) {
      return res.status(503).json({ error: 'recalculate_stock_cache requer acesso privilegiado (service_role) — indisponível via Device JWT.' });
    }
    res.status(500).json({ error: error.message });
  }
});

export default router;
