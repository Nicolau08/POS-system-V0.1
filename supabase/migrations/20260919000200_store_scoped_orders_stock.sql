-- Etapa 1G.2B - propagacao segura de Store nas operacoes cloud.
-- store_id em orders/order_items/stock_movements derivado SEMPRE no servidor:
-- Device JWT -> device_id -> pos_devices.store_id. Nunca de order_data/items.
-- Leitura (RLS) passa a ser tenant + store do proprio device (cross-store bloqueado).
-- Escrita continua so via RPC. Stock/numeracao continuam tenant-wide (sem redesign).

-- 1. colunas + backfill deterministico (ou falha explicita, nunca NULL silencioso)
ALTER TABLE public.stores ADD CONSTRAINT stores_tenant_id_id_key UNIQUE (tenant_id, id);

ALTER TABLE public.orders ADD COLUMN store_id UUID;
ALTER TABLE public.order_items ADD COLUMN store_id UUID;
ALTER TABLE public.stock_movements ADD COLUMN store_id UUID;

-- (a) orders com device conhecido -> store do device
UPDATE public.orders o
SET store_id = d.store_id
FROM public.pos_devices d
WHERE o.store_id IS NULL AND o.tenant_id = d.tenant_id AND o.device_id = d.id::text;

-- (b) tenant com exactamente UMA store -> essa store
UPDATE public.orders o
SET store_id = s.id
FROM public.stores s
WHERE o.store_id IS NULL AND s.tenant_id = o.tenant_id
  AND (SELECT count(*) FROM public.stores s2 WHERE s2.tenant_id = o.tenant_id) = 1;

-- (c) tenant com orders mas sem nenhuma store: cria "Loja principal" na licenca mais recente
--     (trigger de limite desligado so durante este backfill de dados legados)
ALTER TABLE public.stores DISABLE TRIGGER stores_enforce_limits;
INSERT INTO public.stores (tenant_id, license_id, name, code)
SELECT DISTINCT ON (o.tenant_id) o.tenant_id, l.id, 'Loja principal', 'default'
FROM (SELECT DISTINCT tenant_id FROM public.orders WHERE store_id IS NULL) o
JOIN public.licenses l ON l.tenant_id = o.tenant_id
WHERE NOT EXISTS (SELECT 1 FROM public.stores s WHERE s.tenant_id = o.tenant_id)
ORDER BY o.tenant_id, l.issued_at DESC;
ALTER TABLE public.stores ENABLE TRIGGER stores_enforce_limits;

UPDATE public.orders o
SET store_id = s.id
FROM public.stores s
WHERE o.store_id IS NULL AND s.tenant_id = o.tenant_id
  AND (SELECT count(*) FROM public.stores s2 WHERE s2.tenant_id = o.tenant_id) = 1;

UPDATE public.order_items i
SET store_id = o.store_id
FROM public.orders o
WHERE i.store_id IS NULL AND o.tenant_id = i.tenant_id AND o.id = i.order_id;

-- movimentos de venda herdam a store da order; restantes: tenant com uma unica store
UPDATE public.stock_movements m
SET store_id = o.store_id
FROM public.orders o
WHERE m.store_id IS NULL AND m.type = 'sale'
  AND m.reference_id = 'order:' || o.id::text AND m.tenant_id = o.tenant_id;

UPDATE public.stock_movements m
SET store_id = s.id
FROM public.stores s
WHERE m.store_id IS NULL AND s.tenant_id = m.tenant_id
  AND (SELECT count(*) FROM public.stores s2 WHERE s2.tenant_id = m.tenant_id) = 1;

DO $$
DECLARE
  v_o INTEGER; v_i INTEGER; v_m INTEGER;
BEGIN
  SELECT count(*) INTO v_o FROM public.orders WHERE store_id IS NULL;
  SELECT count(*) INTO v_i FROM public.order_items WHERE store_id IS NULL;
  SELECT count(*) INTO v_m FROM public.stock_movements WHERE store_id IS NULL;
  IF v_o + v_i + v_m > 0 THEN
    RAISE EXCEPTION 'backfill_store_id_unresolved: orders=%, order_items=%, stock_movements=% (atribuir store manualmente antes de aplicar)', v_o, v_i, v_m;
  END IF;
END $$;

ALTER TABLE public.orders ALTER COLUMN store_id SET NOT NULL;
ALTER TABLE public.order_items ALTER COLUMN store_id SET NOT NULL;
ALTER TABLE public.stock_movements ALTER COLUMN store_id SET NOT NULL;

ALTER TABLE public.orders ADD CONSTRAINT orders_tenant_store_fkey
  FOREIGN KEY (tenant_id, store_id) REFERENCES public.stores (tenant_id, id);
ALTER TABLE public.order_items ADD CONSTRAINT order_items_tenant_store_fkey
  FOREIGN KEY (tenant_id, store_id) REFERENCES public.stores (tenant_id, id);
ALTER TABLE public.stock_movements ADD CONSTRAINT stock_movements_tenant_store_fkey
  FOREIGN KEY (tenant_id, store_id) REFERENCES public.stores (tenant_id, id);
CREATE INDEX orders_store_id_idx ON public.orders (store_id);
CREATE INDEX order_items_store_id_idx ON public.order_items (store_id);
CREATE INDEX stock_movements_store_id_idx ON public.stock_movements (store_id);

-- 2. store do device autenticado (server-side): JWT -> device_id -> pos_devices.store_id
CREATE OR REPLACE FUNCTION public.current_store_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT d.store_id
  FROM public.pos_devices d
  WHERE d.id = NULLIF(auth.jwt() ->> 'device_id', '')::uuid
    AND d.tenant_id = public.current_tenant_id();
$$;
REVOKE ALL ON FUNCTION public.current_store_id() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_store_id() TO authenticated, service_role;

-- 3. RLS de leitura: tenant E store do proprio device (sem store resolvida -> nada)
DROP POLICY orders_select_tenant ON public.orders;
CREATE POLICY orders_select_store ON public.orders FOR SELECT
  USING (tenant_id = public.current_tenant_id() AND store_id = public.current_store_id());
DROP POLICY order_items_select_tenant ON public.order_items;
CREATE POLICY order_items_select_store ON public.order_items FOR SELECT
  USING (tenant_id = public.current_tenant_id() AND store_id = public.current_store_id());
DROP POLICY stock_movements_select_tenant ON public.stock_movements;
CREATE POLICY stock_movements_select_store ON public.stock_movements FOR SELECT
  USING (tenant_id = public.current_tenant_id() AND store_id = public.current_store_id());

-- 4. create_order_with_items: assinatura inalterada; store derivada do device
CREATE OR REPLACE FUNCTION public.create_order_with_items(
  order_data JSONB,
  items JSONB
)
RETURNS TABLE (
  order_id UUID,
  document_number TEXT,
  already_exists BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant_id TEXT;
  v_tenant_status TEXT;
  v_payload_tenant TEXT;
  v_device_id UUID;
  v_jwt_token_version INT;
  v_device public.pos_devices%ROWTYPE;
  v_store_id UUID;
  v_existing_store UUID;
  v_local_sale_id TEXT;
  v_existing_id UUID;
  v_existing_doc TEXT;
  v_doc_type TEXT;
  v_year INT;
  v_seq BIGINT;
  v_document_number TEXT;
  v_order_id UUID;
  v_item JSONB;
  v_qty NUMERIC;
  v_price NUMERIC;
  v_lock_key BIGINT;
BEGIN
  v_tenant_id := public.current_tenant_id();
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'unauthenticated_or_missing_tenant' USING ERRCODE = '28000';
  END IF;

  v_payload_tenant := NULLIF(order_data->>'tenant_id', '');
  IF v_payload_tenant IS NOT NULL AND v_payload_tenant <> v_tenant_id THEN
    RAISE EXCEPTION 'payload_tenant_mismatch' USING ERRCODE = '28000';
  END IF;

  SELECT status INTO v_tenant_status FROM public.tenants WHERE id = v_tenant_id;
  IF v_tenant_status IS NULL THEN
    RAISE EXCEPTION 'tenant_not_found' USING ERRCODE = '28000';
  END IF;
  IF v_tenant_status <> 'active' THEN
    RAISE EXCEPTION 'tenant_suspended' USING ERRCODE = '28000';
  END IF;

  -- NOVO (bloco 011): identidade de DEVICE, não só de tenant. Um device revogado ou
  -- com token_version desactualizado (já rodou refresh entretanto) nunca vende,
  -- mesmo com um access token ainda dentro da validade.
  v_device_id := NULLIF(auth.jwt() ->> 'device_id', '')::uuid;
  v_jwt_token_version := NULLIF(auth.jwt() ->> 'token_version', '')::int;
  IF v_device_id IS NULL OR v_jwt_token_version IS NULL THEN
    RAISE EXCEPTION 'device_identity_required' USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_device FROM public.pos_devices WHERE id = v_device_id AND tenant_id = v_tenant_id;
  IF v_device.id IS NULL THEN
    RAISE EXCEPTION 'device_not_found' USING ERRCODE = '28000';
  END IF;
  IF v_device.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'device_revoked' USING ERRCODE = '28000';
  END IF;
  IF v_device.token_version <> v_jwt_token_version THEN
    RAISE EXCEPTION 'device_token_version_mismatch' USING ERRCODE = '28000';
  END IF;

  -- 1G.2B: a Store vem SEMPRE de pos_devices (device do JWT verificado). Qualquer
  -- store_id presente em order_data/items e ignorado - nunca autoridade.
  v_store_id := v_device.store_id;
  IF v_store_id IS NULL THEN
    RAISE EXCEPTION 'device_store_missing' USING ERRCODE = '28000';
  END IF;

  v_local_sale_id := NULLIF(order_data->>'local_sale_id', '');
  IF v_local_sale_id IS NULL THEN
    RAISE EXCEPTION 'local_sale_id_required' USING ERRCODE = '22023';
  END IF;

  v_lock_key := hashtextextended(v_tenant_id || ':' || v_local_sale_id, 0);
  PERFORM pg_advisory_xact_lock(v_lock_key);

  SELECT o.id, o.document_number, o.store_id INTO v_existing_id, v_existing_doc, v_existing_store
  FROM public.orders o WHERE o.tenant_id = v_tenant_id AND o.local_sale_id = v_local_sale_id;
  IF v_existing_id IS NOT NULL THEN
    -- retry idempotente so para a MESMA store; nunca expor venda de outra store
    IF v_existing_store IS DISTINCT FROM v_store_id THEN
      RAISE EXCEPTION 'sale_store_mismatch' USING ERRCODE = '42501';
    END IF;
    RETURN QUERY SELECT v_existing_id, v_existing_doc, true;
    RETURN;
  END IF;

  IF items IS NULL OR jsonb_typeof(items) <> 'array' OR jsonb_array_length(items) = 0 THEN
    RAISE EXCEPTION 'items_required' USING ERRCODE = '22023';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(items) LOOP
    IF NULLIF(v_item->>'product_id', '') IS NULL THEN
      RAISE EXCEPTION 'item_product_id_required' USING ERRCODE = '22023';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.products p
      WHERE p.id = (v_item->>'product_id')::uuid AND p.tenant_id = v_tenant_id
    ) THEN
      RAISE EXCEPTION 'item_product_not_in_tenant' USING ERRCODE = '42501';
    END IF;
    v_qty := NULLIF(v_item->>'quantity', '')::numeric;
    IF v_qty IS NULL OR v_qty <= 0 THEN
      RAISE EXCEPTION 'item_quantity_invalid' USING ERRCODE = '22023';
    END IF;
    v_price := NULLIF(v_item->>'price', '')::numeric;
    IF v_price IS NOT NULL AND v_price < 0 THEN
      RAISE EXCEPTION 'item_price_invalid' USING ERRCODE = '22023';
    END IF;
  END LOOP;

  v_doc_type := NULLIF(order_data->>'doc_type', '');

  BEGIN
    IF v_doc_type IS NOT NULL THEN
      v_year := EXTRACT(YEAR FROM COALESCE((order_data->>'created_at')::timestamptz, now()))::int;
      INSERT INTO public.document_sequences (tenant_id, doc_type, year, next_value)
      VALUES (v_tenant_id, v_doc_type, v_year, 2)
      ON CONFLICT (tenant_id, doc_type, year)
      DO UPDATE SET next_value = document_sequences.next_value + 1, updated_at = now()
      RETURNING (next_value - 1) INTO v_seq;
      v_document_number := v_year::text || '/' || lpad(v_seq::text, 4, '0');
    ELSE
      v_document_number := NULL;
    END IF;

    INSERT INTO public.orders (
      tenant_id, store_id, local_sale_id, customer_id, user_id, user_name, device_id, station_code,
      table_number, doc_type, document_number, status, payment_method,
      subtotal, discount, tax, total, received_amount, change_amount, created_at
    ) VALUES (
      v_tenant_id, v_store_id, v_local_sale_id,
      NULLIF(order_data->>'customer_id', '')::uuid,
      NULLIF(order_data->>'user_id', '')::uuid,
      NULLIF(order_data->>'user_name', ''),
      v_device_id::text,
      COALESCE(NULLIF(order_data->>'station_code', ''), v_device.station_code),
      NULLIF(order_data->>'table_number', ''),
      v_doc_type,
      v_document_number,
      COALESCE(NULLIF(order_data->>'status', ''), 'completed'),
      NULLIF(order_data->>'payment_method', ''),
      COALESCE((order_data->>'subtotal')::numeric, 0),
      COALESCE((order_data->>'discount')::numeric, 0),
      COALESCE((order_data->>'tax')::numeric, 0),
      COALESCE((order_data->>'total')::numeric, 0),
      NULLIF(order_data->>'received_amount', '')::numeric,
      COALESCE((order_data->>'change_amount')::numeric, 0),
      COALESCE((order_data->>'created_at')::timestamptz, now())
    )
    RETURNING id INTO v_order_id;

    INSERT INTO public.order_items (tenant_id, store_id, order_id, product_id, product_name, quantity, price, discount_amount)
    SELECT v_tenant_id, v_store_id, v_order_id,
           (i->>'product_id')::uuid,
           COALESCE(i->>'product_name', 'Produto'),
           (i->>'quantity')::numeric,
           COALESCE((i->>'price')::numeric, 0),
           COALESCE((i->>'discount_amount')::numeric, 0)
    FROM jsonb_array_elements(items) AS i;

    INSERT INTO public.stock_movements (tenant_id, store_id, product_id, type, quantity, reference_id)
    SELECT v_tenant_id, v_store_id, x.product_id, 'sale', (x.total_qty * -1), 'order:' || v_order_id::text
    FROM (
      SELECT (i->>'product_id')::uuid AS product_id, SUM((i->>'quantity')::numeric) AS total_qty
      FROM jsonb_array_elements(items) AS i
      JOIN public.products p ON p.id = (i->>'product_id')::uuid AND p.tenant_id = v_tenant_id
      WHERE COALESCE(p.is_service, false) = false
      GROUP BY (i->>'product_id')::uuid
    ) x
    ON CONFLICT (tenant_id, product_id, type, reference_id) DO NOTHING;

  EXCEPTION WHEN unique_violation THEN
    SELECT o.id, o.document_number INTO v_existing_id, v_existing_doc
    FROM public.orders o WHERE o.tenant_id = v_tenant_id AND o.local_sale_id = v_local_sale_id;
    IF v_existing_id IS NOT NULL THEN
      RETURN QUERY SELECT v_existing_id, v_existing_doc, true;
      RETURN;
    END IF;
    RAISE;
  END;

  RETURN QUERY SELECT v_order_id, v_document_number, false;
END;
$$;

REVOKE ALL ON FUNCTION public.create_order_with_items(JSONB, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_order_with_items(JSONB, JSONB) TO authenticated;
