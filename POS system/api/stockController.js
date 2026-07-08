import express from 'express';
import { supabase, isSupabaseConfigured } from './supabaseClient.js';
import { authenticateUser, requireAdmin } from './middlewares/auth.js';
import { parsePagination, withPaginationPayload } from './services/queryOptions.service.js';

const router = express.Router();

function toNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function requireSupabase(res) {
  if (isSupabaseConfigured && supabase) return true;
  res.status(503).json({ error: 'Supabase nao configurado para leitura de ledger.' });
  return false;
}

router.get('/', async (req, res) => {
  if (!requireSupabase(res)) return;

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
        .select('*', { count: 'exact', head: true });
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
    res.status(500).json({ error: error.message });
  }
});

router.get('/validate', async (req, res) => {
  if (!requireSupabase(res)) return;

  try {
    const [{ data: products, error: productError }, { data: ledgerRows, error: ledgerError }] = await Promise.all([
      supabase.from('products').select('id, stock_quantity'),
      supabase.from('product_stock_ledger').select('product_id, stock'),
    ]);

    if (productError) throw productError;
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
    res.status(500).json({ error: error.message });
  }
});

router.get('/:productId/current', async (req, res) => {
  if (!requireSupabase(res)) return;

  const { productId } = req.params;
  try {
    const [{ data: product, error: productError }, { data: ledger, error: ledgerError }] = await Promise.all([
      supabase.from('products').select('id, stock_quantity').eq('id', productId).maybeSingle(),
      supabase.from('product_stock_ledger').select('product_id, stock').eq('product_id', productId).maybeSingle(),
    ]);

    if (productError) throw productError;
    if (ledgerError) throw ledgerError;
    if (!product) return res.status(404).json({ error: 'Produto nao encontrado' });

    const ledgerStock = toNumber(ledger?.stock, 0);
    const cachedStock = toNumber(product.stock_quantity, 0);
    res.json({
      product_id: product.id,
      stock: ledgerStock,
      cached_stock: cachedStock,
      difference: ledgerStock - cachedStock,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/recalculate', authenticateUser, requireAdmin, async (_req, res) => {
  if (!requireSupabase(res)) return;

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
    res.status(500).json({ error: error.message });
  }
});

export default router;
