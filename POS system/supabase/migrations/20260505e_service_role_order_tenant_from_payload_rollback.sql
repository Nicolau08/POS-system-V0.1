-- Rollback 20260505e: restore PR-01.2 trigger + create_order_with_items definitions (JWT-only tenant).

BEGIN;

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
  IF NEW.tenant_id IS NULL OR btrim(NEW.tenant_id) = '' THEN
    RAISE EXCEPTION 'orders.tenant_id cannot be null/empty'
      USING ERRCODE = '23502';
  END IF;

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
  IF NEW.tenant_id IS NULL OR btrim(NEW.tenant_id) = '' THEN
    RAISE EXCEPTION 'order_items.tenant_id cannot be null/empty'
      USING ERRCODE = '23502';
  END IF;

  IF NEW.tenant_id <> v_tenant_id THEN
    RAISE EXCEPTION 'Cross-tenant write denied for order_items'
      USING ERRCODE = '42501';
  END IF;

  SELECT o.tenant_id
  INTO v_order_tenant
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

DROP FUNCTION IF EXISTS public.create_order_with_items(jsonb, jsonb);

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
