-- Null-safety for stock updates:
-- Treat NULL stock_quantity as 0 so atomic operations behave consistently.

CREATE OR REPLACE FUNCTION public.update_stock_atomic(p_product_id UUID, p_delta NUMERIC)
RETURNS NUMERIC
LANGUAGE plpgsql
AS $$
DECLARE
  v_is_service BOOLEAN;
  v_new_stock NUMERIC;
BEGIN
  SELECT is_service
  INTO v_is_service
  FROM products
  WHERE id = p_product_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Product % not found', p_product_id;
  END IF;

  -- Services do not consume stock.
  IF COALESCE(v_is_service, false) THEN
    SELECT stock_quantity INTO v_new_stock FROM products WHERE id = p_product_id;
    RETURN v_new_stock;
  END IF;

  UPDATE products
  SET stock_quantity = COALESCE(stock_quantity, 0) + p_delta,
      updated_at = now()
  WHERE id = p_product_id
    AND (COALESCE(stock_quantity, 0) + p_delta) >= 0
  RETURNING stock_quantity INTO v_new_stock;

  IF v_new_stock IS NULL THEN
    RAISE EXCEPTION 'Insufficient stock for product %', p_product_id
      USING ERRCODE = 'P0001';
  END IF;

  RETURN v_new_stock;
END;
$$;

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
  v_order_id UUID;
  v_used_sequence BIGINT := NULL;
  v_used_document_number TEXT := NULL;
  v_year INTEGER := date_part('year', p_sale_date)::int;

  v_item JSONB;
  v_product_id UUID;
  v_qty NUMERIC;
  v_is_service BOOLEAN;
BEGIN
  IF p_doc_type = 'VD' THEN
    v_used_sequence := public.vd_sequence_consume(v_year);
    v_used_document_number := v_year::text || '/' || lpad(v_used_sequence::text, 4, '0');
  END IF;

  -- Create order header
  INSERT INTO orders (
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

  -- Create order items
  INSERT INTO order_items (
    order_id,
    product_id,
    product_name,
    quantity,
    price,
    discount_amount
  )
  SELECT
    v_order_id,
    (i->>'id')::uuid AS product_id,
    i->>'name' AS product_name,
    ((i->>'quantity')::numeric)::int AS quantity,
    (i->>'price')::numeric AS price,
    CASE
      WHEN i ? 'discount' AND (i->'discount') IS NOT NULL THEN
        CASE
          WHEN i->'discount'->>'type' = 'percentage' THEN
            ((i->>'price')::numeric * (i->'discount'->>'amount')::numeric / 100)
              * ((i->>'quantity')::numeric)
          ELSE
            (i->'discount'->>'amount')::numeric
        END
      ELSE 0
    END AS discount_amount
  FROM jsonb_array_elements(p_cart) AS i;

  -- Decrement stock (all updates must succeed or the function raises and the transaction aborts)
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_cart) AS t(value)
  LOOP
    v_product_id := (v_item->>'id')::uuid;
    v_qty := (v_item->>'quantity')::numeric;

    SELECT is_service
    INTO v_is_service
    FROM products
    WHERE id = v_product_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Product % not found', v_product_id;
    END IF;

    -- Services do not consume stock.
    IF COALESCE(v_is_service, false) THEN
      CONTINUE;
    END IF;

    UPDATE products
    SET stock_quantity = COALESCE(stock_quantity, 0) - v_qty,
        updated_at = now()
    WHERE id = v_product_id
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

