-- PR-01.1: Post-RLS compatibility for critical writes and RPCs.
-- Ensures tenant_id is always set/validated and normal sales flow remains allowed.

BEGIN;

-- 1) document_sequences must be tenant-scoped.
ALTER TABLE public.document_sequences
DROP CONSTRAINT IF EXISTS document_sequences_pkey;

ALTER TABLE public.document_sequences
ADD CONSTRAINT document_sequences_pkey PRIMARY KEY (tenant_id, doc_type, year);

-- 2) Keep sales flow unblocked for cashier role on sequence writes.
DROP POLICY IF EXISTS document_sequences_insert_tenant_role ON public.document_sequences;
DROP POLICY IF EXISTS document_sequences_update_tenant_role ON public.document_sequences;
DROP POLICY IF EXISTS document_sequences_delete_tenant_role ON public.document_sequences;

CREATE POLICY document_sequences_insert_tenant_role
ON public.document_sequences FOR INSERT
WITH CHECK (
  tenant_id = public.current_tenant_id()
  AND public.current_app_role() IN ('cashier', 'manager', 'admin')
);

CREATE POLICY document_sequences_update_tenant_role
ON public.document_sequences FOR UPDATE
USING (
  tenant_id = public.current_tenant_id()
  AND public.current_app_role() IN ('cashier', 'manager', 'admin')
)
WITH CHECK (
  tenant_id = public.current_tenant_id()
  AND public.current_app_role() IN ('cashier', 'manager', 'admin')
);

CREATE POLICY document_sequences_delete_tenant_role
ON public.document_sequences FOR DELETE
USING (
  tenant_id = public.current_tenant_id()
  AND public.current_app_role() IN ('admin')
);

-- 3) Validate tenant consistency automatically on writes.
CREATE OR REPLACE FUNCTION public.apply_and_validate_tenant_orders()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_tenant_id TEXT := public.current_tenant_id();
BEGIN
  IF v_tenant_id IS NULL OR btrim(v_tenant_id) = '' THEN
    RAISE EXCEPTION 'Missing tenant in JWT claims'
      USING ERRCODE = '22023';
  END IF;

  NEW.tenant_id := COALESCE(NULLIF(NEW.tenant_id, ''), v_tenant_id);
  IF NEW.tenant_id <> v_tenant_id THEN
    RAISE EXCEPTION 'Cross-tenant write denied for orders'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.customer_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.customers c
      WHERE c.id = NEW.customer_id
        AND c.tenant_id = NEW.tenant_id
    ) THEN
      RAISE EXCEPTION 'Customer % does not belong to tenant %', NEW.customer_id, NEW.tenant_id
        USING ERRCODE = '23503';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.apply_and_validate_tenant_order_items()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_tenant_id TEXT := public.current_tenant_id();
  v_order_tenant TEXT;
BEGIN
  IF v_tenant_id IS NULL OR btrim(v_tenant_id) = '' THEN
    RAISE EXCEPTION 'Missing tenant in JWT claims'
      USING ERRCODE = '22023';
  END IF;

  NEW.tenant_id := COALESCE(NULLIF(NEW.tenant_id, ''), v_tenant_id);
  IF NEW.tenant_id <> v_tenant_id THEN
    RAISE EXCEPTION 'Cross-tenant write denied for order_items'
      USING ERRCODE = '42501';
  END IF;

  SELECT o.tenant_id INTO v_order_tenant
  FROM public.orders o
  WHERE o.id = NEW.order_id;

  IF v_order_tenant IS NULL THEN
    RAISE EXCEPTION 'Order % not found for order_items row', NEW.order_id
      USING ERRCODE = '23503';
  END IF;

  IF v_order_tenant <> NEW.tenant_id THEN
    RAISE EXCEPTION 'order_items tenant mismatch with parent order'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.apply_and_validate_tenant_document_sequences()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_tenant_id TEXT := public.current_tenant_id();
BEGIN
  IF v_tenant_id IS NULL OR btrim(v_tenant_id) = '' THEN
    RAISE EXCEPTION 'Missing tenant in JWT claims'
      USING ERRCODE = '22023';
  END IF;

  NEW.tenant_id := COALESCE(NULLIF(NEW.tenant_id, ''), v_tenant_id);
  IF NEW.tenant_id <> v_tenant_id THEN
    RAISE EXCEPTION 'Cross-tenant write denied for document_sequences'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.apply_and_validate_tenant_customers()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_tenant_id TEXT := public.current_tenant_id();
BEGIN
  IF v_tenant_id IS NULL OR btrim(v_tenant_id) = '' THEN
    RAISE EXCEPTION 'Missing tenant in JWT claims'
      USING ERRCODE = '22023';
  END IF;

  NEW.tenant_id := COALESCE(NULLIF(NEW.tenant_id, ''), v_tenant_id);
  IF NEW.tenant_id <> v_tenant_id THEN
    RAISE EXCEPTION 'Cross-tenant write denied for customers'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_orders_tenant_guard_biu ON public.orders;
CREATE TRIGGER trg_orders_tenant_guard_biu
BEFORE INSERT OR UPDATE ON public.orders
FOR EACH ROW
EXECUTE FUNCTION public.apply_and_validate_tenant_orders();

DROP TRIGGER IF EXISTS trg_order_items_tenant_guard_biu ON public.order_items;
CREATE TRIGGER trg_order_items_tenant_guard_biu
BEFORE INSERT OR UPDATE ON public.order_items
FOR EACH ROW
EXECUTE FUNCTION public.apply_and_validate_tenant_order_items();

DROP TRIGGER IF EXISTS trg_document_sequences_tenant_guard_biu ON public.document_sequences;
CREATE TRIGGER trg_document_sequences_tenant_guard_biu
BEFORE INSERT OR UPDATE ON public.document_sequences
FOR EACH ROW
EXECUTE FUNCTION public.apply_and_validate_tenant_document_sequences();

DROP TRIGGER IF EXISTS trg_customers_tenant_guard_biu ON public.customers;
CREATE TRIGGER trg_customers_tenant_guard_biu
BEFORE INSERT OR UPDATE ON public.customers
FOR EACH ROW
EXECUTE FUNCTION public.apply_and_validate_tenant_customers();

-- 4) Tenant-safe sequence functions.
CREATE OR REPLACE FUNCTION public.vd_sequence_ensure(p_year INTEGER)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_tenant_id TEXT := public.current_tenant_id();
  v_max_seq BIGINT := 0;
  v_desired_next BIGINT;
BEGIN
  IF v_tenant_id IS NULL OR btrim(v_tenant_id) = '' THEN
    RAISE EXCEPTION 'Missing tenant in JWT claims'
      USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(MAX((split_part(document_number, '/', 2))::bigint), 0)
  INTO v_max_seq
  FROM public.orders
  WHERE tenant_id = v_tenant_id
    AND doc_type = 'VD'
    AND document_number IS NOT NULL
    AND document_number LIKE (p_year::text || '/%');

  v_desired_next := GREATEST(1, v_max_seq + 1);

  INSERT INTO public.document_sequences (tenant_id, doc_type, year, next_value)
  VALUES (v_tenant_id, 'VD', p_year, v_desired_next)
  ON CONFLICT (tenant_id, doc_type, year) DO UPDATE
  SET next_value = GREATEST(document_sequences.next_value, v_desired_next),
      updated_at = now();
END;
$$;

CREATE OR REPLACE FUNCTION public.vd_sequence_peek(p_year INTEGER)
RETURNS BIGINT
LANGUAGE plpgsql
AS $$
DECLARE
  v_tenant_id TEXT := public.current_tenant_id();
  v_next BIGINT;
BEGIN
  IF v_tenant_id IS NULL OR btrim(v_tenant_id) = '' THEN
    RAISE EXCEPTION 'Missing tenant in JWT claims'
      USING ERRCODE = '22023';
  END IF;

  PERFORM public.vd_sequence_ensure(p_year);

  SELECT next_value
  INTO v_next
  FROM public.document_sequences
  WHERE tenant_id = v_tenant_id
    AND doc_type = 'VD'
    AND year = p_year;

  RETURN COALESCE(v_next, 1);
END;
$$;

CREATE OR REPLACE FUNCTION public.vd_sequence_consume(p_year INTEGER)
RETURNS BIGINT
LANGUAGE plpgsql
AS $$
DECLARE
  v_tenant_id TEXT := public.current_tenant_id();
  v_used BIGINT;
BEGIN
  IF v_tenant_id IS NULL OR btrim(v_tenant_id) = '' THEN
    RAISE EXCEPTION 'Missing tenant in JWT claims'
      USING ERRCODE = '22023';
  END IF;

  PERFORM public.vd_sequence_ensure(p_year);

  UPDATE public.document_sequences
  SET next_value = next_value + 1,
      updated_at = now()
  WHERE tenant_id = v_tenant_id
    AND doc_type = 'VD'
    AND year = p_year
  RETURNING (next_value - 1) INTO v_used;

  RETURN v_used;
END;
$$;

-- 5) Tenant-safe create_order_atomic.
CREATE OR REPLACE FUNCTION public.create_order_atomic(
  p_cart JSONB,
  p_selected_customer_id UUID,
  p_selected_table_id TEXT,
  p_doc_type TEXT,
  p_total NUMERIC,
  p_subtotal NUMERIC,
  p_tax NUMERIC,
  p_discount NUMERIC,
  p_is_multiple_payment BOOLEAN,
  p_payment_method TEXT,
  p_received_amount NUMERIC,
  p_change_amount NUMERIC,
  p_sale_timestamp TIMESTAMPTZ,
  p_sale_date DATE
)
RETURNS TABLE (
  order_id UUID,
  used_document_number TEXT,
  used_sequence BIGINT
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_tenant_id TEXT := public.current_tenant_id();
  v_order_id UUID;
  v_used_sequence BIGINT := NULL;
  v_used_document_number TEXT := NULL;
  v_year INTEGER := date_part('year', p_sale_date)::int;
  v_item JSONB;
  v_product_id UUID;
  v_qty NUMERIC;
  v_is_service BOOLEAN;
BEGIN
  IF v_tenant_id IS NULL OR btrim(v_tenant_id) = '' THEN
    RAISE EXCEPTION 'Missing tenant in JWT claims'
      USING ERRCODE = '22023';
  END IF;

  IF p_selected_customer_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.customers c
      WHERE c.id = p_selected_customer_id
        AND c.tenant_id = v_tenant_id
    ) THEN
      RAISE EXCEPTION 'Customer % does not belong to tenant %', p_selected_customer_id, v_tenant_id
        USING ERRCODE = '23503';
    END IF;
  END IF;

  IF p_doc_type = 'VD' THEN
    v_used_sequence := public.vd_sequence_consume(v_year);
    v_used_document_number := v_year::text || '/' || lpad(v_used_sequence::text, 4, '0');
  END IF;

  INSERT INTO public.orders (
    tenant_id,
    customer_id,
    table_number,
    total,
    subtotal,
    tax,
    discount,
    payment_method,
    received_amount,
    change_amount,
    status,
    doc_type,
    document_number,
    created_at
  ) VALUES (
    v_tenant_id,
    p_selected_customer_id,
    NULLIF(p_selected_table_id, ''),
    p_total,
    p_subtotal,
    p_tax,
    p_discount,
    CASE WHEN p_is_multiple_payment THEN 'multiple' ELSE p_payment_method END,
    p_received_amount,
    p_change_amount,
    'completed',
    p_doc_type,
    v_used_document_number,
    p_sale_timestamp
  )
  RETURNING id INTO v_order_id;

  INSERT INTO public.order_items (
    tenant_id,
    order_id,
    product_id,
    product_name,
    quantity,
    price,
    discount_amount
  )
  SELECT
    v_tenant_id,
    v_order_id,
    (i->>'id')::uuid AS product_id,
    i->>'name' AS product_name,
    ((i->>'quantity')::numeric)::int AS quantity,
    (i->>'price')::numeric AS price,
    CASE
      WHEN i ? 'discount' AND (i->'discount') IS NOT NULL THEN
        CASE
          WHEN i->'discount'->>'type' = 'percentage' THEN
            ((i->>'price')::numeric * (i->'discount'->>'amount')::numeric / 100) * ((i->>'quantity')::numeric)
          ELSE
            (i->'discount'->>'amount')::numeric
        END
      ELSE 0
    END AS discount_amount
  FROM jsonb_array_elements(p_cart) AS i;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_cart) AS t(value)
  LOOP
    v_product_id := (v_item->>'id')::uuid;
    v_qty := (v_item->>'quantity')::numeric;

    SELECT is_service
    INTO v_is_service
    FROM public.products
    WHERE id = v_product_id
      AND tenant_id = v_tenant_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Product % not found in tenant %', v_product_id, v_tenant_id;
    END IF;

    IF COALESCE(v_is_service, false) THEN
      CONTINUE;
    END IF;

    UPDATE public.products
    SET stock_quantity = COALESCE(stock_quantity, 0) - v_qty,
        updated_at = now()
    WHERE id = v_product_id
      AND tenant_id = v_tenant_id
      AND (COALESCE(stock_quantity, 0) - v_qty) >= 0;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Insufficient stock for product %', v_product_id
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;

  order_id := v_order_id;
  used_document_number := v_used_document_number;
  used_sequence := v_used_sequence;
  RETURN NEXT;
END;
$$;

-- 6) Tenant-safe idempotent sync RPC.
CREATE OR REPLACE FUNCTION public.create_order_with_items(order_data JSONB, items JSONB)
RETURNS TABLE (
  order_id UUID,
  already_exists BOOLEAN
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_tenant_id TEXT := public.current_tenant_id();
  v_local_sale_id TEXT;
  v_order_id UUID;
  v_customer_id UUID;
BEGIN
  IF v_tenant_id IS NULL OR btrim(v_tenant_id) = '' THEN
    RAISE EXCEPTION 'Missing tenant in JWT claims'
      USING ERRCODE = '22023';
  END IF;

  v_local_sale_id := NULLIF(order_data->>'local_sale_id', '');
  IF v_local_sale_id IS NULL THEN
    RAISE EXCEPTION 'local_sale_id is required'
      USING ERRCODE = '22023';
  END IF;

  v_customer_id := NULLIF(order_data->>'customer_id', '')::uuid;
  IF v_customer_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.customers c
      WHERE c.id = v_customer_id
        AND c.tenant_id = v_tenant_id
    ) THEN
      RAISE EXCEPTION 'Customer % does not belong to tenant %', v_customer_id, v_tenant_id
        USING ERRCODE = '23503';
    END IF;
  END IF;

  SELECT o.id
  INTO v_order_id
  FROM public.orders o
  WHERE o.tenant_id = v_tenant_id
    AND o.local_sale_id = v_local_sale_id
  LIMIT 1;

  IF v_order_id IS NOT NULL THEN
    order_id := v_order_id;
    already_exists := TRUE;
    RETURN NEXT;
    RETURN;
  END IF;

  INSERT INTO public.orders (
    tenant_id,
    local_sale_id,
    customer_id,
    table_number,
    total,
    subtotal,
    tax,
    discount,
    payment_method,
    received_amount,
    change_amount,
    status,
    doc_type,
    document_number,
    created_at
  ) VALUES (
    v_tenant_id,
    v_local_sale_id,
    v_customer_id,
    NULLIF(order_data->>'table_number', ''),
    COALESCE((order_data->>'total')::numeric, 0),
    COALESCE((order_data->>'subtotal')::numeric, 0),
    COALESCE((order_data->>'tax')::numeric, 0),
    COALESCE((order_data->>'discount')::numeric, 0),
    NULLIF(order_data->>'payment_method', ''),
    NULLIF(order_data->>'received_amount', '')::numeric,
    COALESCE((order_data->>'change_amount')::numeric, 0),
    COALESCE(NULLIF(order_data->>'status', ''), 'completed'),
    NULLIF(order_data->>'doc_type', ''),
    NULLIF(order_data->>'document_number', ''),
    COALESCE((order_data->>'created_at')::timestamptz, now())
  )
  RETURNING id INTO v_order_id;

  IF jsonb_typeof(items) = 'array' AND jsonb_array_length(items) > 0 THEN
    IF EXISTS (
      SELECT 1
      FROM jsonb_array_elements(items) AS i
      LEFT JOIN public.products p
        ON p.id = NULLIF(i->>'product_id', '')::uuid
       AND p.tenant_id = v_tenant_id
      WHERE NULLIF(i->>'product_id', '') IS NOT NULL
        AND p.id IS NULL
    ) THEN
      RAISE EXCEPTION 'One or more products are outside current tenant'
        USING ERRCODE = '42501';
    END IF;

    INSERT INTO public.order_items (
      tenant_id,
      order_id,
      product_id,
      product_name,
      quantity,
      price,
      discount_amount
    )
    SELECT
      v_tenant_id,
      v_order_id,
      NULLIF(i->>'product_id', '')::uuid,
      COALESCE(i->>'product_name', 'Produto'),
      COALESCE((i->>'quantity')::numeric, 0),
      COALESCE((i->>'price')::numeric, 0),
      COALESCE((i->>'discount_amount')::numeric, 0)
    FROM jsonb_array_elements(items) AS i;

    INSERT INTO public.stock_movements (product_id, type, quantity, reference_id)
    SELECT
      NULLIF(i->>'product_id', '')::uuid AS product_id,
      'sale'::text,
      (COALESCE((i->>'quantity')::numeric, 0) * -1) AS quantity,
      'order:' || v_order_id::text AS reference_id
    FROM jsonb_array_elements(items) AS i
    WHERE NULLIF(i->>'product_id', '') IS NOT NULL
    GROUP BY NULLIF(i->>'product_id', '')::uuid
    ON CONFLICT (product_id, type, reference_id) DO NOTHING;
  END IF;

  order_id := v_order_id;
  already_exists := FALSE;
  RETURN NEXT;
  RETURN;
EXCEPTION
  WHEN unique_violation THEN
    SELECT o.id
    INTO v_order_id
    FROM public.orders o
    WHERE o.tenant_id = v_tenant_id
      AND o.local_sale_id = v_local_sale_id
    LIMIT 1;

    IF v_order_id IS NOT NULL THEN
      order_id := v_order_id;
      already_exists := TRUE;
      RETURN NEXT;
      RETURN;
    END IF;
    RAISE;
END;
$$;

COMMIT;
