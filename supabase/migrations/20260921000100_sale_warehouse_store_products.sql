-- Etapa 1G.2B.2 - venda + sync com stock por Store/Warehouse.
--  * ledger (stock_movements) + warehouse_stock passam a ser a unica autoridade de stock cloud;
--    products.stock_quantity deixa de ser mantido (trigger de cache removido; coluna legada, sem escritor).
--  * create_order_with_items: warehouse validado contra a Store do device; produto tem de estar
--    activo em store_products da Store; o warehouse usado e gravado em cada movimento.
--  * sync_upsert_warehouse: espelha warehouses locais (id estavel = id local UUID) na Store do device;
--    exactamente 1 default por Store.
--  * produto criado por um device fica activo na Store desse device (trigger).

-- 1. cache global de stock deixa de existir como autoridade
DROP TRIGGER IF EXISTS stock_movements_refresh_product_stock ON public.stock_movements;

-- 2. produto novo criado por um device -> activo na Store do device (service_role/admin nao activa nada)
CREATE OR REPLACE FUNCTION public.products_activate_in_device_store()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_store UUID;
BEGIN
  v_store := public.current_store_id();
  IF v_store IS NOT NULL AND public.current_tenant_id() = NEW.tenant_id THEN
    INSERT INTO public.store_products (tenant_id, store_id, product_id)
    VALUES (NEW.tenant_id, v_store, NEW.id)
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER products_activate_in_device_store
  AFTER INSERT ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.products_activate_in_device_store();

-- 3. espelho de warehouses locais na Store do device
CREATE OR REPLACE FUNCTION public.sync_upsert_warehouse(
  p_id UUID,
  p_name TEXT,
  p_code TEXT,
  p_is_default BOOLEAN,
  p_is_active BOOLEAN
)
RETURNS TABLE (out_id UUID, out_is_default BOOLEAN)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant TEXT;
  v_store UUID;
  v_device_id UUID;
  v_device public.pos_devices%ROWTYPE;
  v_existing public.warehouses%ROWTYPE;
  v_current_default public.warehouses%ROWTYPE;
  v_make_default BOOLEAN;
  v_active BOOLEAN;
BEGIN
  v_tenant := public.current_tenant_id();
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'unauthenticated_or_missing_tenant' USING ERRCODE = '28000';
  END IF;
  v_device_id := NULLIF(auth.jwt() ->> 'device_id', '')::uuid;
  SELECT * INTO v_device FROM public.pos_devices WHERE id = v_device_id AND tenant_id = v_tenant;
  IF v_device.id IS NULL THEN
    RAISE EXCEPTION 'device_not_found' USING ERRCODE = '28000';
  END IF;
  IF v_device.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'device_revoked' USING ERRCODE = '28000';
  END IF;
  IF v_device.token_version <> NULLIF(auth.jwt() ->> 'token_version', '')::int THEN
    RAISE EXCEPTION 'device_token_version_mismatch' USING ERRCODE = '28000';
  END IF;
  v_store := v_device.store_id;

  IF p_id IS NULL THEN
    RAISE EXCEPTION 'id_required' USING ERRCODE = '22023';
  END IF;
  IF NULLIF(btrim(p_name), '') IS NULL THEN
    RAISE EXCEPTION 'name_required' USING ERRCODE = '22023';
  END IF;

  -- serializa alteracoes de warehouses/default da mesma Store
  PERFORM 1 FROM public.stores WHERE id = v_store FOR UPDATE;

  SELECT * INTO v_existing FROM public.warehouses WHERE id = p_id;
  IF v_existing.id IS NOT NULL AND (v_existing.tenant_id <> v_tenant OR v_existing.store_id <> v_store) THEN
    RAISE EXCEPTION 'warehouse_belongs_to_other_store' USING ERRCODE = '42501';
  END IF;

  v_make_default := COALESCE(p_is_default, false);
  v_active := COALESCE(p_is_active, true);

  IF v_make_default AND NOT v_active THEN
    RAISE EXCEPTION 'inactive_default_not_allowed' USING ERRCODE = '22023';
  END IF;

  -- o default so muda por promocao de OUTRO warehouse; pedido "nao-default" sobre o default actual e ignorado
  IF v_existing.id IS NOT NULL AND v_existing.is_default AND NOT v_make_default THEN
    v_make_default := true;
    v_active := true;
  END IF;

  IF v_make_default THEN
    SELECT * INTO v_current_default FROM public.warehouses
    WHERE store_id = v_store AND is_default AND id <> p_id;
    IF v_current_default.id IS NOT NULL THEN
      IF v_current_default.code = 'main'
         AND NOT EXISTS (
           SELECT 1 FROM public.stock_movements m
           WHERE m.warehouse_id = v_current_default.id
              OR m.from_warehouse_id = v_current_default.id
              OR m.to_warehouse_id = v_current_default.id
         ) THEN
        -- default auto-criado com a Store, nunca usado: substituido pelo warehouse real
        DELETE FROM public.warehouses WHERE id = v_current_default.id;
      ELSE
        UPDATE public.warehouses SET is_default = false WHERE id = v_current_default.id;
      END IF;
    END IF;
  END IF;

  INSERT INTO public.warehouses (id, tenant_id, store_id, name, code, is_default, is_active)
  VALUES (p_id, v_tenant, v_store, btrim(p_name), NULLIF(btrim(COALESCE(p_code, '')), ''), v_make_default, v_active)
  ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    code = EXCLUDED.code,
    is_default = EXCLUDED.is_default,
    is_active = EXCLUDED.is_active
  WHERE public.warehouses.tenant_id = v_tenant AND public.warehouses.store_id = v_store;

  out_id := p_id;
  out_is_default := v_make_default;
  RETURN NEXT;
END;
$$;
REVOKE ALL ON FUNCTION public.sync_upsert_warehouse(UUID, TEXT, TEXT, BOOLEAN, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sync_upsert_warehouse(UUID, TEXT, TEXT, BOOLEAN, BOOLEAN) TO authenticated;

-- 4. create_order_with_items: assinatura inalterada
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
  v_warehouse_id UUID;
  v_req_wh UUID;
  v_sp_status TEXT;
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

  -- 1G.2B.2: warehouse pedido tem de pertencer a Store DERIVADA do device; sem pedido -> default da Store.
  v_req_wh := NULLIF(order_data->>'warehouse_id', '')::uuid;
  IF v_req_wh IS NOT NULL THEN
    SELECT w.id INTO v_warehouse_id FROM public.warehouses w
    WHERE w.id = v_req_wh AND w.tenant_id = v_tenant_id AND w.store_id = v_store_id AND w.is_active;
    IF v_warehouse_id IS NULL THEN
      RAISE EXCEPTION 'warehouse_not_in_store' USING ERRCODE = '42501';
    END IF;
  ELSE
    SELECT w.id INTO v_warehouse_id FROM public.warehouses w
    WHERE w.tenant_id = v_tenant_id AND w.store_id = v_store_id AND w.is_default AND w.is_active;
    IF v_warehouse_id IS NULL THEN
      RAISE EXCEPTION 'store_default_warehouse_missing' USING ERRCODE = '28000';
    END IF;
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
    SELECT sp.status INTO v_sp_status FROM public.store_products sp
    WHERE sp.store_id = v_store_id AND sp.tenant_id = v_tenant_id AND sp.product_id = (v_item->>'product_id')::uuid;
    IF v_sp_status IS NULL THEN
      RAISE EXCEPTION 'item_product_not_in_store' USING ERRCODE = '42501';
    END IF;
    IF v_sp_status <> 'active' THEN
      RAISE EXCEPTION 'item_product_inactive_in_store' USING ERRCODE = '42501';
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

    INSERT INTO public.stock_movements (tenant_id, store_id, warehouse_id, product_id, type, quantity, reference_id)
    SELECT v_tenant_id, v_store_id, v_warehouse_id, x.product_id, 'sale', (x.total_qty * -1), 'order:' || v_order_id::text
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
