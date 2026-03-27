-- Stock cache validation and recalculation tooling.
-- This never modifies ledger data; only products.stock_quantity cache.

CREATE TABLE IF NOT EXISTS public.stock_recalculation_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  total_products_checked INTEGER NOT NULL DEFAULT 0,
  mismatches_fixed INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.recalculate_stock_cache()
RETURNS TABLE (
  total_products_checked INTEGER,
  mismatches_fixed INTEGER,
  recalculated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_total INTEGER := 0;
  v_fixed INTEGER := 0;
  v_now TIMESTAMPTZ := now();
BEGIN
  WITH ledger AS (
    SELECT p.id AS product_id, COALESCE(psl.stock, 0) AS ledger_stock
    FROM public.products p
    LEFT JOIN public.product_stock_ledger psl ON psl.product_id = p.id
  ),
  updated AS (
    UPDATE public.products p
    SET stock_quantity = l.ledger_stock,
        updated_at = now()
    FROM ledger l
    WHERE p.id = l.product_id
      AND COALESCE(p.stock_quantity, 0) <> COALESCE(l.ledger_stock, 0)
    RETURNING p.id
  )
  SELECT
    (SELECT COUNT(*) FROM public.products),
    (SELECT COUNT(*) FROM updated)
  INTO v_total, v_fixed;

  INSERT INTO public.stock_recalculation_logs (total_products_checked, mismatches_fixed, created_at)
  VALUES (v_total, v_fixed, v_now);

  total_products_checked := v_total;
  mismatches_fixed := v_fixed;
  recalculated_at := v_now;
  RETURN NEXT;
END;
$$;
