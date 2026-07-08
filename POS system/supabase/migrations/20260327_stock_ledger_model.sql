-- Stock ledger model (gradual migration)
-- Source of truth becomes stock_movements.
-- products.stock_quantity is kept as cached value by trigger for compatibility.

CREATE TABLE IF NOT EXISTS public.stock_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('sale', 'restock', 'adjustment')),
  quantity NUMERIC NOT NULL,
  reference_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS stock_movements_unique_ref
  ON public.stock_movements(product_id, type, reference_id);

CREATE INDEX IF NOT EXISTS stock_movements_product_created_idx
  ON public.stock_movements(product_id, created_at DESC);

CREATE OR REPLACE VIEW public.product_stock_ledger AS
SELECT
  sm.product_id,
  COALESCE(SUM(sm.quantity), 0) AS stock
FROM public.stock_movements sm
GROUP BY sm.product_id;

CREATE OR REPLACE FUNCTION public.refresh_product_stock_cache(p_product_id UUID)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE public.products
  SET stock_quantity = COALESCE((
    SELECT SUM(quantity)
    FROM public.stock_movements
    WHERE product_id = p_product_id
  ), 0),
  updated_at = now()
  WHERE id = p_product_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_refresh_product_stock_cache()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM public.refresh_product_stock_cache(COALESCE(NEW.product_id, OLD.product_id));
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS stock_movements_refresh_product_stock ON public.stock_movements;
CREATE TRIGGER stock_movements_refresh_product_stock
AFTER INSERT OR UPDATE OR DELETE ON public.stock_movements
FOR EACH ROW EXECUTE FUNCTION public.trg_refresh_product_stock_cache();

-- Bootstrap ledger from current cached product stock (idempotent)
INSERT INTO public.stock_movements (product_id, type, quantity, reference_id)
SELECT
  p.id,
  'adjustment',
  COALESCE(p.stock_quantity, 0),
  'bootstrap:' || p.id::text
FROM public.products p
WHERE NOT EXISTS (
  SELECT 1
  FROM public.stock_movements sm
  WHERE sm.product_id = p.id
    AND sm.type = 'adjustment'
    AND sm.reference_id = 'bootstrap:' || p.id::text
);

-- Atomic + idempotent stock movement writer.
CREATE OR REPLACE FUNCTION public.record_stock_movement(
  p_product_id UUID,
  p_type TEXT,
  p_quantity NUMERIC,
  p_reference_id TEXT
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_type NOT IN ('sale', 'restock', 'adjustment') THEN
    RAISE EXCEPTION 'Invalid stock movement type: %', p_type
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.stock_movements (product_id, type, quantity, reference_id)
  VALUES (p_product_id, p_type, p_quantity, p_reference_id)
  ON CONFLICT (product_id, type, reference_id) DO NOTHING;
END;
$$;
