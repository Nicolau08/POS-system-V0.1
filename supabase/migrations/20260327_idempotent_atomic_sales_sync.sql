-- Idempotent + atomic sales sync support
-- 1) Adds local_sale_id to orders with unique guarantee
-- 2) Adds RPC create_order_with_items(order_data jsonb, items jsonb)

ALTER TABLE public.orders
ADD COLUMN IF NOT EXISTS local_sale_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS orders_local_sale_id_key
  ON public.orders(local_sale_id)
  WHERE local_sale_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.create_order_with_items(order_data JSONB, items JSONB)
RETURNS TABLE (
  order_id UUID,
  already_exists BOOLEAN
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_local_sale_id TEXT;
  v_order_id UUID;
BEGIN
  v_local_sale_id := NULLIF(order_data->>'local_sale_id', '');
  IF v_local_sale_id IS NULL THEN
    RAISE EXCEPTION 'local_sale_id is required'
      USING ERRCODE = '22023';
  END IF;

  SELECT o.id
  INTO v_order_id
  FROM public.orders o
  WHERE o.local_sale_id = v_local_sale_id
  LIMIT 1;

  IF v_order_id IS NOT NULL THEN
    order_id := v_order_id;
    already_exists := TRUE;
    RETURN NEXT;
    RETURN;
  END IF;

  INSERT INTO public.orders (
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
    v_local_sale_id,
    NULLIF(order_data->>'customer_id', '')::uuid,
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
    INSERT INTO public.order_items (
      order_id,
      product_id,
      product_name,
      quantity,
      price,
      discount_amount
    )
    SELECT
      v_order_id,
      NULLIF(i->>'product_id', '')::uuid,
      COALESCE(i->>'product_name', 'Produto'),
      COALESCE((i->>'quantity')::numeric, 0),
      COALESCE((i->>'price')::numeric, 0),
      COALESCE((i->>'discount_amount')::numeric, 0)
    FROM jsonb_array_elements(items) AS i;

    -- Ledger-based stock write: one movement per product per order
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
    WHERE o.local_sale_id = v_local_sale_id
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
