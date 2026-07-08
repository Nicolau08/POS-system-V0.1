-- Production hardening:
-- 1) VD document sequencing moved to DB (no localStorage, safe across clients)
-- 2) Atomic order creation (orders + order_items + stock decrement in one RPC/transaction)
-- 3) Stock decrement prevented from going negative (concurrency-safe)

-- Document sequences for VD numbering (scoped by year)
CREATE TABLE IF NOT EXISTS document_sequences (
  doc_type TEXT NOT NULL,
  year INTEGER NOT NULL,
  next_value BIGINT NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (doc_type, year)
);

ALTER TABLE document_sequences ENABLE ROW LEVEL SECURITY;
CREATE POLICY IF NOT EXISTS "Allow all for authenticated users" ON document_sequences
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- Ensure the sequence row is at least (max existing document_number sequence + 1).
-- This prevents regressions after downtime and aligns with already-created orders.
CREATE OR REPLACE FUNCTION public.vd_sequence_ensure(p_year INTEGER)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_max_seq BIGINT := 0;
  v_desired_next BIGINT;
BEGIN
  -- document_number format: YYYY/NNNN (NNNN can be 4+ digits)
  SELECT
    COALESCE(MAX((split_part(document_number, '/', 2))::bigint), 0)
  INTO v_max_seq
  FROM orders
  WHERE doc_type = 'VD'
    AND document_number IS NOT NULL
    AND document_number LIKE (p_year::text || '/%');

  v_desired_next := GREATEST(1, v_max_seq + 1);

  INSERT INTO document_sequences (doc_type, year, next_value)
  VALUES ('VD', p_year, v_desired_next)
  ON CONFLICT (doc_type, year) DO UPDATE
  SET next_value = GREATEST(document_sequences.next_value, v_desired_next),
      updated_at = now();
END;
$$;

-- Peek next VD sequence (does not consume / does not increment).
CREATE OR REPLACE FUNCTION public.vd_sequence_peek(p_year INTEGER)
RETURNS BIGINT
LANGUAGE plpgsql
AS $$
DECLARE
  v_next BIGINT;
BEGIN
  PERFORM public.vd_sequence_ensure(p_year);

  SELECT next_value
  INTO v_next
  FROM document_sequences
  WHERE doc_type = 'VD'
    AND year = p_year;

  RETURN COALESCE(v_next, 1);
END;
$$;

-- Consume next VD sequence (atomic increment) and return the used value.
-- The returned value guarantees uniqueness across concurrent clients.
CREATE OR REPLACE FUNCTION public.vd_sequence_consume(p_year INTEGER)
RETURNS BIGINT
LANGUAGE plpgsql
AS $$
DECLARE
  v_used BIGINT;
BEGIN
  PERFORM public.vd_sequence_ensure(p_year);

  UPDATE document_sequences
  SET next_value = next_value + 1,
      updated_at = now()
  WHERE doc_type = 'VD'
    AND year = p_year
  RETURNING (next_value - 1) INTO v_used;

  RETURN v_used;
END;
$$;

-- Atomic stock update helper (prevents going negative for non-service products).
-- This is optional for UI flows, but useful for safety and future extensions.
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
  SET stock_quantity = stock_quantity + p_delta,
      updated_at = now()
  WHERE id = p_product_id
    AND (stock_quantity + p_delta) >= 0
  RETURNING stock_quantity INTO v_new_stock;

  IF v_new_stock IS NULL THEN
    RAISE EXCEPTION 'Insufficient stock for product %', p_product_id
      USING ERRCODE = 'P0001';
  END IF;

  RETURN v_new_stock;
END;
$$;

-- Atomic create order:
-- - consume VD sequence inside DB when doc_type='VD'
-- - insert orders + order_items
-- - decrement stock for all non-service products (never allow negative)
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
  v_price NUMERIC;
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
    SET stock_quantity = stock_quantity - v_qty,
        updated_at = now()
    WHERE id = v_product_id
      AND (stock_quantity - v_qty) >= 0;

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

