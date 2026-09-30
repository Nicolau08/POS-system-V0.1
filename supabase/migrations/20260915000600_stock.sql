-- Etapa 1E.3 — baseline nova, bloco 006: stock.
--
-- Campos confirmados no código real (não na migration histórica):
--  - Local (api/schema/operations.js): stock_movements(cloud_id, tenant_id, product_id,
--    movement_type, quantity, reference_id, warehouse_id*, from/to_warehouse_id*, created_at,
--    updated_at). *_warehouse_id são do módulo multi-armazém — REMOVIDO na Etapa 1E (ver
--    Etapa 1E, secção "o que será descartado": warehouses/stock_layers nunca chegaram a ter
--    código de aplicação nenhum a usá-los, zero referências).
--  - Sinal da quantidade (api/services/sales.service.js:672 `delta: -qty` para 'sale'):
--    quantity é SEMPRE COM SINAL — negativo para saída (sale/transfer_out), positivo para
--    entrada (restock/transfer_in). 'adjustment' pode ser qualquer sinal (correção).
--  - reference_id para vendas (RPC create_order_with_items, ver 20260915000700):
--    'order:' || order_id — já globalmente único porque deriva do PK de orders.
--
-- Integridade cross-tenant de product_id: NÃO confio em duas FKs independentes
-- (tenant_id -> tenants, product_id -> products) que permitiriam tenant A + produto
-- de tenant B. Uso FK COMPOSTA (tenant_id, product_id) REFERENCES products(tenant_id, id)
-- — estruturalmente impossível ter as duas colunas a apontar para tenants diferentes,
-- porque a própria FK exige uma linha em products cujo tenant_id bate certo com o
-- tenant_id desta linha. Isto exige um UNIQUE(tenant_id, id) em products (abaixo).

ALTER TABLE public.products ADD CONSTRAINT products_tenant_id_id_key UNIQUE (tenant_id, id);

CREATE TABLE public.stock_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  product_id UUID NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('sale', 'restock', 'adjustment', 'transfer_out', 'transfer_in')),
  quantity NUMERIC NOT NULL CHECK (quantity <> 0),
  reference_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT stock_movements_tenant_product_fkey
    FOREIGN KEY (tenant_id, product_id) REFERENCES public.products (tenant_id, id)
);

-- Idempotência tenant-aware (secção 4): mesmo que reference_id já seja globalmente
-- único hoje (deriva de order_id, um UUID de PK), incluo tenant_id explicitamente na
-- constraint por defesa em profundidade — nunca depender só de um formato de string
-- se mantendo único por acidente.
CREATE UNIQUE INDEX stock_movements_tenant_product_type_ref_key
  ON public.stock_movements (tenant_id, product_id, type, reference_id);
CREATE INDEX stock_movements_tenant_id_idx ON public.stock_movements (tenant_id);
CREATE INDEX stock_movements_product_created_idx ON public.stock_movements (product_id, created_at DESC);

ALTER TABLE public.stock_movements ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.stock_movements FROM PUBLIC, anon, authenticated;


-- Fonte de verdade = SUM(stock_movements.quantity). products.stock_quantity é cache
-- derivada, nunca a segunda fonte de verdade (ver Etapa 1E, secção "stock").

CREATE OR REPLACE FUNCTION public.refresh_product_stock_cache(p_tenant_id TEXT, p_product_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.products
  SET stock_quantity = COALESCE(
        (SELECT SUM(sm.quantity) FROM public.stock_movements sm
         WHERE sm.tenant_id = p_tenant_id AND sm.product_id = p_product_id),
        0
      ),
      updated_at = now()
  WHERE tenant_id = p_tenant_id AND id = p_product_id;
END;
$$;
REVOKE ALL ON FUNCTION public.refresh_product_stock_cache(TEXT, UUID) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.trg_refresh_product_stock_cache()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.refresh_product_stock_cache(OLD.tenant_id, OLD.product_id);
    RETURN OLD;
  END IF;
  PERFORM public.refresh_product_stock_cache(NEW.tenant_id, NEW.product_id);
  IF TG_OP = 'UPDATE' AND (OLD.product_id IS DISTINCT FROM NEW.product_id OR OLD.tenant_id IS DISTINCT FROM NEW.tenant_id) THEN
    PERFORM public.refresh_product_stock_cache(OLD.tenant_id, OLD.product_id);
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.trg_refresh_product_stock_cache() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER stock_movements_refresh_product_stock
  AFTER INSERT OR UPDATE OR DELETE ON public.stock_movements
  FOR EACH ROW EXECUTE FUNCTION public.trg_refresh_product_stock_cache();

-- Reconstrução/prova, para uso administrativo (service_role) — NUNCA altera o ledger,
-- só o cache, exatamente como record_stock_movement/refresh já garantem por si sós.
-- Devolve o que mudou, para se poder provar SUM(ledger) == products.stock_quantity.
CREATE OR REPLACE FUNCTION public.recalculate_stock_cache(p_tenant_id TEXT)
RETURNS TABLE (total_products_checked INTEGER, mismatches_fixed INTEGER)
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_checked INTEGER;
  v_fixed INTEGER;
BEGIN
  SELECT count(*) INTO v_checked FROM public.products WHERE tenant_id = p_tenant_id;

  -- Produtos COM movimentos: cache = SUM(ledger).
  WITH ledger AS (
    SELECT product_id, SUM(quantity) AS stock
    FROM public.stock_movements
    WHERE tenant_id = p_tenant_id
    GROUP BY product_id
  ),
  upd AS (
    UPDATE public.products p
    SET stock_quantity = COALESCE(l.stock, 0),
        updated_at = now()
    FROM ledger l
    WHERE p.tenant_id = p_tenant_id
      AND l.product_id = p.id
      AND p.stock_quantity IS DISTINCT FROM COALESCE(l.stock, 0)
    RETURNING p.id
  )
  SELECT count(*) INTO v_fixed FROM upd;

  -- Produtos SEM nenhum movimento (secção 21: "produto sem movimentos -> stock = 0"),
  -- que o JOIN acima não cobre porque nunca aparecem em `ledger`.
  WITH upd_zero AS (
    UPDATE public.products p
    SET stock_quantity = 0, updated_at = now()
    WHERE p.tenant_id = p_tenant_id
      AND p.stock_quantity IS DISTINCT FROM 0
      AND NOT EXISTS (
        SELECT 1 FROM public.stock_movements sm
        WHERE sm.tenant_id = p_tenant_id AND sm.product_id = p.id
      )
    RETURNING p.id
  )
  SELECT v_fixed + count(*) INTO v_fixed FROM upd_zero;

  total_products_checked := v_checked;
  mismatches_fixed := v_fixed;
  RETURN NEXT;
END;
$$;
REVOKE ALL ON FUNCTION public.recalculate_stock_cache(TEXT) FROM PUBLIC, anon, authenticated;


-- View do ledger, security_invoker (PG17 suporta) — nunca contorna RLS: enquanto não
-- houver policies em stock_movements, anon/authenticated continuam sem acesso a isto
-- também (a mesma REVOKE de stock_movements aplica-se à execução desta view sob
-- invoker rights). Inclui tenant_id explicitamente (a view antiga não tinha).
CREATE VIEW public.product_stock_ledger
WITH (security_invoker = true) AS
SELECT tenant_id, product_id, SUM(quantity) AS stock
FROM public.stock_movements
GROUP BY tenant_id, product_id;

REVOKE ALL ON public.product_stock_ledger FROM PUBLIC, anon, authenticated;
