-- FIFO cost layers (cloud mirror). Local POS is source of truth; sync in a later phase.

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS track_lot BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.order_items
  ADD COLUMN IF NOT EXISTS unit_cost NUMERIC,
  ADD COLUMN IF NOT EXISTS cogs_total NUMERIC;

CREATE TABLE IF NOT EXISTS public.stock_layers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL,
  warehouse_id UUID NOT NULL REFERENCES public.warehouses(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  qty_remaining NUMERIC NOT NULL,
  unit_cost NUMERIC NOT NULL DEFAULT 0,
  received_at TIMESTAMPTZ NOT NULL,
  lot_code TEXT,
  expiry_date DATE,
  source_ref TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_stock_layers_wh_prod_fifo
  ON public.stock_layers (tenant_id, warehouse_id, product_id, received_at, id);

CREATE INDEX IF NOT EXISTS idx_stock_layers_lot
  ON public.stock_layers (tenant_id, product_id, lot_code);

CREATE TABLE IF NOT EXISTS public.stock_layer_consumptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL,
  stock_movement_id UUID,
  layer_id UUID NOT NULL REFERENCES public.stock_layers(id),
  qty NUMERIC NOT NULL,
  unit_cost NUMERIC NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_slc_movement
  ON public.stock_layer_consumptions (tenant_id, stock_movement_id);

CREATE INDEX IF NOT EXISTS idx_slc_layer
  ON public.stock_layer_consumptions (tenant_id, layer_id);
