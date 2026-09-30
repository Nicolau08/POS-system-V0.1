-- Etapa 1G.2B.1 - schema cloud de inventario multi-store (SEM mudar comportamento de venda).
--   Tenant -> Store -> Warehouse ; Produto mestre -> store_products ;
--   stock_movements = Store + Warehouse + Produto (ledger = unica autoridade de stock).
-- products.stock_quantity e o trigger de cache existentes NAO sao removidos (fica para 1G.2B.2).
-- create_order_with_items NAO e alterado: um trigger preenche o warehouse por defeito da store.

-- ---------------------------------------------------------------------------
-- 1. warehouses (pertencem a UMA store; store pertence ao tenant)
-- ---------------------------------------------------------------------------
CREATE TABLE public.warehouses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL,
  store_id UUID NOT NULL,
  name TEXT NOT NULL CHECK (btrim(name) <> ''),
  code TEXT,
  is_default BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT warehouses_tenant_store_fkey
    FOREIGN KEY (tenant_id, store_id) REFERENCES public.stores (tenant_id, id),
  CONSTRAINT warehouses_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT warehouses_tenant_store_id_key UNIQUE (tenant_id, store_id, id)
);
CREATE UNIQUE INDEX warehouses_store_name_key ON public.warehouses (store_id, lower(name));
CREATE UNIQUE INDEX warehouses_store_default_key ON public.warehouses (store_id) WHERE is_default;
CREATE INDEX warehouses_store_id_idx ON public.warehouses (store_id);

CREATE TRIGGER warehouses_set_updated_at
  BEFORE UPDATE ON public.warehouses
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.scope_immutable_tenant_store()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.store_id IS DISTINCT FROM OLD.store_id THEN
    RAISE EXCEPTION 'scope_immutable' USING ERRCODE = '28000';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER warehouses_scope_immutable
  BEFORE UPDATE ON public.warehouses
  FOR EACH ROW EXECUTE FUNCTION public.scope_immutable_tenant_store();

ALTER TABLE public.warehouses ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.warehouses FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.warehouses TO authenticated;
CREATE POLICY warehouses_select_store ON public.warehouses FOR SELECT
  USING (tenant_id = public.current_tenant_id() AND store_id = public.current_store_id());

-- Toda a store nova nasce com o seu "Armazem Principal" (default).
CREATE OR REPLACE FUNCTION public.stores_create_default_warehouse()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO public.warehouses (tenant_id, store_id, name, code, is_default)
  VALUES (NEW.tenant_id, NEW.id, 'Armazém Principal', 'main', true);
  RETURN NEW;
END;
$$;
CREATE TRIGGER stores_default_warehouse
  AFTER INSERT ON public.stores
  FOR EACH ROW EXECUTE FUNCTION public.stores_create_default_warehouse();

-- ---------------------------------------------------------------------------
-- 2. store_products (produto mestre do tenant disponibilizado numa store)
-- ---------------------------------------------------------------------------
CREATE TABLE public.store_products (
  tenant_id TEXT NOT NULL,
  store_id UUID NOT NULL,
  product_id UUID NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'discontinued')),
  price_override NUMERIC(12,2) CHECK (price_override IS NULL OR price_override >= 0),
  min_stock NUMERIC CHECK (min_stock IS NULL OR min_stock >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (store_id, product_id),
  CONSTRAINT store_products_tenant_store_fkey
    FOREIGN KEY (tenant_id, store_id) REFERENCES public.stores (tenant_id, id),
  CONSTRAINT store_products_tenant_product_fkey
    FOREIGN KEY (tenant_id, product_id) REFERENCES public.products (tenant_id, id)
);
CREATE INDEX store_products_product_id_idx ON public.store_products (product_id);
CREATE INDEX store_products_tenant_id_idx ON public.store_products (tenant_id);

CREATE TRIGGER store_products_set_updated_at
  BEFORE UPDATE ON public.store_products
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.store_products_scope_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.store_id IS DISTINCT FROM OLD.store_id
     OR NEW.product_id IS DISTINCT FROM OLD.product_id THEN
    RAISE EXCEPTION 'scope_immutable' USING ERRCODE = '28000';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER store_products_scope_immutable
  BEFORE UPDATE ON public.store_products
  FOR EACH ROW EXECUTE FUNCTION public.store_products_scope_immutable();

ALTER TABLE public.store_products ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.store_products FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.store_products TO authenticated;
CREATE POLICY store_products_select_store ON public.store_products FOR SELECT
  USING (tenant_id = public.current_tenant_id() AND store_id = public.current_store_id());

-- ---------------------------------------------------------------------------
-- 3. stock_movements: warehouse (+ from/to para transferencias futuras)
--    Backfill: warehouse por defeito da PROPRIA store do movimento.
-- ---------------------------------------------------------------------------
INSERT INTO public.warehouses (tenant_id, store_id, name, code, is_default)
SELECT s.tenant_id, s.id, 'Armazém Principal', 'main', true
FROM public.stores s
WHERE NOT EXISTS (SELECT 1 FROM public.warehouses w WHERE w.store_id = s.id AND w.is_default);

ALTER TABLE public.stock_movements
  ADD COLUMN warehouse_id UUID,
  ADD COLUMN from_warehouse_id UUID,
  ADD COLUMN to_warehouse_id UUID;

UPDATE public.stock_movements m
SET warehouse_id = w.id
FROM public.warehouses w
WHERE m.warehouse_id IS NULL AND w.tenant_id = m.tenant_id AND w.store_id = m.store_id AND w.is_default;

DO $$
DECLARE
  v_unresolved INTEGER;
BEGIN
  SELECT count(*) INTO v_unresolved FROM public.stock_movements WHERE warehouse_id IS NULL;
  IF v_unresolved > 0 THEN
    RAISE EXCEPTION 'backfill_warehouse_unresolved: stock_movements=% (atribuir armazem manualmente antes de aplicar)', v_unresolved;
  END IF;
END $$;

ALTER TABLE public.stock_movements ALTER COLUMN warehouse_id SET NOT NULL;
-- warehouse do movimento tem de ser da MESMA store/tenant do movimento
ALTER TABLE public.stock_movements ADD CONSTRAINT stock_movements_warehouse_fkey
  FOREIGN KEY (tenant_id, store_id, warehouse_id) REFERENCES public.warehouses (tenant_id, store_id, id);
-- from/to: tenant-safe (entre stores so serao usados pela etapa de transferencias)
ALTER TABLE public.stock_movements ADD CONSTRAINT stock_movements_from_warehouse_fkey
  FOREIGN KEY (tenant_id, from_warehouse_id) REFERENCES public.warehouses (tenant_id, id);
ALTER TABLE public.stock_movements ADD CONSTRAINT stock_movements_to_warehouse_fkey
  FOREIGN KEY (tenant_id, to_warehouse_id) REFERENCES public.warehouses (tenant_id, id);
CREATE INDEX stock_movements_warehouse_product_idx ON public.stock_movements (warehouse_id, product_id);

-- RPC de venda NAO alterado: se o insert nao trouxer warehouse, usa o default da store do movimento.
CREATE OR REPLACE FUNCTION public.stock_movements_default_warehouse()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.warehouse_id IS NULL THEN
    SELECT w.id INTO NEW.warehouse_id
    FROM public.warehouses w
    WHERE w.tenant_id = NEW.tenant_id AND w.store_id = NEW.store_id AND w.is_default AND w.is_active;
    IF NEW.warehouse_id IS NULL THEN
      RAISE EXCEPTION 'store_default_warehouse_missing' USING ERRCODE = '28000';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER stock_movements_default_warehouse
  BEFORE INSERT ON public.stock_movements
  FOR EACH ROW EXECUTE FUNCTION public.stock_movements_default_warehouse();

-- ---------------------------------------------------------------------------
-- 4. store_products backfill (sem adivinhar)
--    - tenant com UMA store: todo o catalogo activo do tenant nessa store;
--    - tenant com varias stores: so produtos com actividade (movimentos/itens) em cada store.
--    Produtos sem actividade em tenants multi-store ficam so no catalogo mestre.
-- ---------------------------------------------------------------------------
INSERT INTO public.store_products (tenant_id, store_id, product_id)
SELECT p.tenant_id, s.id, p.id
FROM public.products p
JOIN public.stores s ON s.tenant_id = p.tenant_id
WHERE (SELECT count(*) FROM public.stores s2 WHERE s2.tenant_id = p.tenant_id) = 1
ON CONFLICT DO NOTHING;

INSERT INTO public.store_products (tenant_id, store_id, product_id)
SELECT DISTINCT m.tenant_id, m.store_id, m.product_id FROM public.stock_movements m
ON CONFLICT DO NOTHING;

INSERT INTO public.store_products (tenant_id, store_id, product_id)
SELECT DISTINCT i.tenant_id, i.store_id, i.product_id FROM public.order_items i WHERE i.product_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- 5. stock derivado (nunca escrito): saldo por store + warehouse + produto
-- ---------------------------------------------------------------------------
CREATE VIEW public.warehouse_stock WITH (security_invoker = true) AS
SELECT tenant_id, store_id, warehouse_id, product_id, SUM(quantity) AS quantity, MAX(created_at) AS last_movement_at
FROM public.stock_movements
GROUP BY tenant_id, store_id, warehouse_id, product_id;
REVOKE ALL ON public.warehouse_stock FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.warehouse_stock TO authenticated, service_role;
