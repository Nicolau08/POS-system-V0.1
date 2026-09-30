-- Etapa 1G.2B.3 - movimentos nao-venda + transferencias internas + snapshot de abertura.
--  * stock_movements.type aceita 'opening' (saldo de abertura explicito, nunca historico inventado);
--    cost_layers JSONB guarda o custo/FIFO que viajou com o movimento (informativo; ledger = autoridade de quantidade).
--  * sync_stock_movements: aplica GRUPOS atomicos de movimentos do device na Store derivada do Device JWT;
--    idempotente por (tenant, produto, tipo, reference_id); divergencia de um movimento ja existente = 'conflict'
--    (nunca sobrescreve); transferencias so entre warehouses da MESMA Store.
--  * create_order_with_items: produto 'discontinued' na Store deixa de rejeitar a venda (autorizacao local
--    ja ocorreu offline); a rejeicao por produto ausente da Store mantem-se.

ALTER TABLE public.stock_movements ADD COLUMN cost_layers JSONB;
ALTER TABLE public.stock_movements DROP CONSTRAINT stock_movements_type_check;
ALTER TABLE public.stock_movements ADD CONSTRAINT stock_movements_type_check
  CHECK (type IN ('sale', 'restock', 'adjustment', 'transfer_out', 'transfer_in', 'opening'));

CREATE OR REPLACE FUNCTION public.sync_stock_movements(p_groups JSONB)
RETURNS TABLE (
  out_reference_id TEXT,
  out_type TEXT,
  out_status TEXT,
  out_error TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant_id TEXT := public.current_tenant_id();
  v_device_id UUID;
  v_jwt_tv INT;
  v_device public.pos_devices%ROWTYPE;
  v_store_id UUID;
  v_group JSONB;
  v_item JSONB;
  v_out JSONB := '[]'::jsonb;
  v_group_out JSONB;
  v_type TEXT;
  v_ref TEXT;
  v_product UUID;
  v_wh UUID;
  v_from UUID;
  v_to UUID;
  v_qty NUMERIC;
  v_created TIMESTAMPTZ;
  v_rows INT;
  v_existing public.stock_movements%ROWTYPE;
  v_conflict BOOLEAN;
  v_status TEXT;
  v_err TEXT;
BEGIN
  IF v_tenant_id IS NULL OR v_tenant_id = '' THEN
    RAISE EXCEPTION 'unauthenticated_or_missing_tenant' USING ERRCODE = '28000';
  END IF;
  v_device_id := NULLIF(auth.jwt() ->> 'device_id', '')::uuid;
  IF v_device_id IS NULL THEN
    RAISE EXCEPTION 'device_identity_required' USING ERRCODE = '28000';
  END IF;
  SELECT * INTO v_device FROM public.pos_devices WHERE id = v_device_id AND tenant_id = v_tenant_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'device_not_found' USING ERRCODE = '28000'; END IF;
  IF v_device.revoked_at IS NOT NULL THEN RAISE EXCEPTION 'device_revoked' USING ERRCODE = '28000'; END IF;
  v_jwt_tv := NULLIF(auth.jwt() ->> 'token_version', '')::int;
  IF v_jwt_tv IS DISTINCT FROM v_device.token_version THEN
    RAISE EXCEPTION 'device_token_version_mismatch' USING ERRCODE = '28000';
  END IF;
  v_store_id := v_device.store_id;
  IF v_store_id IS NULL THEN RAISE EXCEPTION 'device_store_missing' USING ERRCODE = '28000'; END IF;

  IF p_groups IS NULL OR jsonb_typeof(p_groups) <> 'array' THEN
    RAISE EXCEPTION 'groups_required' USING ERRCODE = '22023';
  END IF;

  FOR v_group IN SELECT * FROM jsonb_array_elements(p_groups) LOOP
    v_group_out := '[]'::jsonb;
    BEGIN
      v_conflict := false;
      FOR v_item IN SELECT * FROM jsonb_array_elements(v_group) LOOP
        v_type := v_item->>'type';
        v_ref := NULLIF(btrim(COALESCE(v_item->>'reference_id', '')), '');
        IF v_ref IS NULL THEN RAISE EXCEPTION 'reference_id_required' USING ERRCODE = '22023'; END IF;
        IF v_type IS NULL OR v_type NOT IN ('restock', 'adjustment', 'transfer_out', 'transfer_in', 'opening') THEN
          RAISE EXCEPTION 'movement_type_not_syncable' USING ERRCODE = '22023';
        END IF;
        v_product := NULLIF(v_item->>'product_id', '')::uuid;
        v_wh := NULLIF(v_item->>'warehouse_id', '')::uuid;
        v_from := NULLIF(v_item->>'from_warehouse_id', '')::uuid;
        v_to := NULLIF(v_item->>'to_warehouse_id', '')::uuid;
        v_qty := NULLIF(v_item->>'quantity', '')::numeric;
        IF v_product IS NULL OR v_wh IS NULL OR v_qty IS NULL OR v_qty = 0 THEN
          RAISE EXCEPTION 'movement_fields_invalid' USING ERRCODE = '22023';
        END IF;
        IF v_type IN ('restock') AND v_qty < 0 THEN RAISE EXCEPTION 'movement_sign_invalid' USING ERRCODE = '22023'; END IF;
        IF NOT EXISTS (SELECT 1 FROM public.products p WHERE p.id = v_product AND p.tenant_id = v_tenant_id) THEN
          RAISE EXCEPTION 'item_product_not_in_tenant' USING ERRCODE = '42501';
        END IF;
        -- warehouse (e from/to) tem de pertencer a Store do DEVICE; nunca a outra Store
        IF NOT EXISTS (SELECT 1 FROM public.warehouses w WHERE w.id = v_wh AND w.store_id = v_store_id AND w.tenant_id = v_tenant_id) THEN
          RAISE EXCEPTION 'warehouse_not_in_store' USING ERRCODE = '42501';
        END IF;
        IF v_type IN ('transfer_out', 'transfer_in') THEN
          IF v_from IS NULL OR v_to IS NULL OR v_from = v_to THEN
            RAISE EXCEPTION 'transfer_warehouses_invalid' USING ERRCODE = '22023';
          END IF;
          IF (SELECT count(*) FROM public.warehouses w WHERE w.id IN (v_from, v_to) AND w.store_id = v_store_id AND w.tenant_id = v_tenant_id) <> 2 THEN
            RAISE EXCEPTION 'warehouse_not_in_store' USING ERRCODE = '42501';
          END IF;
          IF (v_type = 'transfer_out' AND (v_qty >= 0 OR v_wh <> v_from))
             OR (v_type = 'transfer_in' AND (v_qty <= 0 OR v_wh <> v_to)) THEN
            RAISE EXCEPTION 'transfer_direction_invalid' USING ERRCODE = '22023';
          END IF;
        ELSE
          v_from := NULL;
          v_to := NULL;
        END IF;
        v_created := LEAST(COALESCE(NULLIF(v_item->>'created_at', '')::timestamptz, now()), now());

        -- o produto passa a existir na Store (nunca reactiva um descontinuado)
        INSERT INTO public.store_products (tenant_id, store_id, product_id)
        VALUES (v_tenant_id, v_store_id, v_product)
        ON CONFLICT (store_id, product_id) DO NOTHING;

        INSERT INTO public.stock_movements
          (tenant_id, store_id, warehouse_id, from_warehouse_id, to_warehouse_id, product_id, type, quantity, reference_id, created_at, cost_layers)
        VALUES
          (v_tenant_id, v_store_id, v_wh, v_from, v_to, v_product, v_type, v_qty, v_ref, v_created,
           CASE WHEN jsonb_typeof(v_item->'cost_layers') = 'array' THEN v_item->'cost_layers' ELSE NULL END)
        ON CONFLICT (tenant_id, product_id, type, reference_id) DO NOTHING;
        GET DIAGNOSTICS v_rows = ROW_COUNT;

        IF v_rows = 1 THEN
          v_status := 'inserted';
        ELSE
          SELECT * INTO v_existing FROM public.stock_movements m
          WHERE m.tenant_id = v_tenant_id AND m.product_id = v_product AND m.type = v_type AND m.reference_id = v_ref;
          IF v_existing.store_id = v_store_id AND v_existing.warehouse_id = v_wh AND v_existing.quantity = v_qty THEN
            v_status := 'duplicate';
          ELSE
            v_status := 'conflict';
            v_conflict := true;
          END IF;
        END IF;
        v_group_out := v_group_out || jsonb_build_object('ref', v_ref, 'type', v_type, 'status', v_status, 'error', NULL);
      END LOOP;

      IF v_conflict THEN
        RAISE EXCEPTION 'movement_conflict' USING ERRCODE = '23505';
      END IF;
      v_out := v_out || v_group_out;
    EXCEPTION WHEN OTHERS THEN
      -- o grupo inteiro (par out/in incluido) e revertido; nada fica a meio
      v_err := SQLERRM;
      v_status := CASE WHEN v_err = 'item_product_not_in_tenant' THEN 'retry'
                       WHEN v_err = 'movement_conflict' THEN 'conflict'
                       ELSE 'rejected' END;
      FOR v_item IN SELECT * FROM jsonb_array_elements(v_group) LOOP
        v_out := v_out || jsonb_build_object('ref', v_item->>'reference_id', 'type', v_item->>'type', 'status', v_status, 'error', v_err);
      END LOOP;
    END;
  END LOOP;

  RETURN QUERY
  SELECT e->>'ref', e->>'type', e->>'status', e->>'error' FROM jsonb_array_elements(v_out) e;
END;
$$;
REVOKE ALL ON FUNCTION public.sync_stock_movements(JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sync_stock_movements(JSONB) TO authenticated;

-- create_order_with_items: assinatura inalterada
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
    -- 'discontinued' NAO rejeita: a venda foi autorizada localmente (offline-first); o catalogo so restringe vendas NOVAS no POS.
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
