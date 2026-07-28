-- Multi-warehouse stock (Phase 3 cloud mirror)
-- Local POS remains source of truth for stock; cloud schema aligned for sync.

CREATE TABLE IF NOT EXISTS public.warehouses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL,
  name TEXT NOT NULL,
  code TEXT,
  is_default BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_warehouses_tenant_default
  ON public.warehouses (tenant_id)
  WHERE is_default = true;

CREATE INDEX IF NOT EXISTS idx_warehouses_tenant
  ON public.warehouses (tenant_id, name);

CREATE TABLE IF NOT EXISTS public.warehouse_stock (
  warehouse_id UUID NOT NULL REFERENCES public.warehouses(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  tenant_id TEXT NOT NULL,
  quantity NUMERIC NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (warehouse_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_warehouse_stock_tenant_product
  ON public.warehouse_stock (tenant_id, product_id);

ALTER TABLE public.stock_movements
  ADD COLUMN IF NOT EXISTS warehouse_id UUID REFERENCES public.warehouses(id),
  ADD COLUMN IF NOT EXISTS from_warehouse_id UUID REFERENCES public.warehouses(id),
  ADD COLUMN IF NOT EXISTS to_warehouse_id UUID REFERENCES public.warehouses(id),
  ADD COLUMN IF NOT EXISTS tenant_id TEXT;

-- Expand movement type check: recreate constraint if needed
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_schema = 'public'
      AND table_name = 'stock_movements'
      AND constraint_type = 'CHECK'
      AND constraint_name LIKE '%type%'
  ) THEN
    ALTER TABLE public.stock_movements DROP CONSTRAINT IF EXISTS stock_movements_type_check;
  END IF;
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

ALTER TABLE public.stock_movements DROP CONSTRAINT IF EXISTS stock_movements_type_check;
ALTER TABLE public.stock_movements
  ADD CONSTRAINT stock_movements_type_check
  CHECK (type IN ('sale', 'restock', 'adjustment', 'transfer_out', 'transfer_in'));

-- Dining locations (if mirrored to cloud later); safe no-op when table missing
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'locations'
  ) THEN
    ALTER TABLE public.locations ADD COLUMN IF NOT EXISTS warehouse_id UUID REFERENCES public.warehouses(id);
  END IF;
END $$;

-- Seed default warehouse «Loja» per distinct tenant from products
INSERT INTO public.warehouses (id, tenant_id, name, code, is_default, is_active, created_at, updated_at)
SELECT
  gen_random_uuid(),
  t.tenant_id,
  'Loja',
  'LOJA',
  true,
  true,
  now(),
  now()
FROM (
  SELECT DISTINCT tenant_id::text AS tenant_id
  FROM public.products
  WHERE tenant_id IS NOT NULL
) t
WHERE NOT EXISTS (
  SELECT 1 FROM public.warehouses w
  WHERE w.tenant_id = t.tenant_id AND w.is_default = true
);

-- Backfill warehouse_stock from products.stock_quantity into default warehouse
INSERT INTO public.warehouse_stock (warehouse_id, product_id, tenant_id, quantity, updated_at)
SELECT
  w.id,
  p.id,
  w.tenant_id,
  COALESCE(p.stock_quantity, 0),
  now()
FROM public.products p
INNER JOIN public.warehouses w
  ON w.tenant_id = p.tenant_id::text AND w.is_default = true
WHERE NOT EXISTS (
  SELECT 1 FROM public.warehouse_stock ws
  WHERE ws.product_id = p.id AND ws.tenant_id = w.tenant_id
)
ON CONFLICT (warehouse_id, product_id) DO NOTHING;

-- sm cannot be referenced inside JOIN ON of FROM items; put tenant match in WHERE.
UPDATE public.stock_movements sm
SET warehouse_id = w.id
FROM public.products p
INNER JOIN public.warehouses w
  ON w.tenant_id = p.tenant_id::text AND w.is_default = true
WHERE sm.product_id = p.id
  AND sm.warehouse_id IS NULL
  AND w.tenant_id = COALESCE(sm.tenant_id, p.tenant_id::text);
