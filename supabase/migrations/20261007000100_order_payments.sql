-- Pilot Gate POS/Dinheiro — breakdown real por tender na cloud, espelhando local
-- sale_payments (mesma lógica: amount = valor aplicado, SUM(amount) = orders.total;
-- tendered_amount só quando difere de amount). create_order_with_items ganha um 3º
-- parâmetro `payments` COM DEFAULT NULL — assinatura antiga (2 args) continua válida,
-- nenhum caller existente quebra; a Backoffice/License Console nunca tocam nesta RPC.
--
-- Escrita SÓ dentro desta RPC (SECURITY DEFINER, mesma transação do INSERT em
-- orders/order_items) — sem GRANT de INSERT a authenticated, mesmo padrão de
-- supplier_payments/customer_payments (tabelas sensíveis só-RPC já estabelecidas).
-- Idempotência herdada de graça: o early-return por local_sale_id já existente (ou o
-- unique_violation na corrida) nunca chega a este INSERT, logo nunca duplica tenders.

CREATE TABLE public.order_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL REFERENCES public.tenants (id) ON DELETE RESTRICT,
  store_id UUID NOT NULL,
  order_id UUID NOT NULL,
  method TEXT NOT NULL,
  amount NUMERIC(12,2) NOT NULL,
  tendered_amount NUMERIC(12,2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT order_payments_tenant_order_fkey FOREIGN KEY (tenant_id, order_id) REFERENCES public.orders (tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX order_payments_order_id_idx ON public.order_payments (order_id);

ALTER TABLE public.order_payments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.order_payments FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.order_payments TO authenticated;
CREATE POLICY order_payments_select_store ON public.order_payments
  FOR SELECT USING (tenant_id = public.current_tenant_id() AND store_id = public.current_store_id());

-- CREATE OR REPLACE não substitui a versão de 2 argumentos (Postgres identifica funções
-- por (nome, tipos dos parâmetros) — 2 args e 3 args são overloads DIFERENTES). Sem este
-- DROP explícito ficariam as duas em paralelo, e uma chamada com 2 args continuaria a
-- cair na antiga (sem payments) por engano. DROP + CREATE com DEFAULT no 3º parâmetro é
-- o único jeito de manter "chamar com 2 args continua a funcionar" apontando para a MESMA
-- função nova.
DROP FUNCTION IF EXISTS public.create_order_with_items(JSONB, JSONB);

CREATE OR REPLACE FUNCTION public.create_order_with_items(
  order_data JSONB,
  items JSONB,
  payments JSONB DEFAULT NULL
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
    IF v_existing_store IS DISTINCT FROM v_store_id THEN
      RAISE EXCEPTION 'sale_store_mismatch' USING ERRCODE = '42501';
    END IF;
    RETURN QUERY SELECT v_existing_id, v_existing_doc, true;
    RETURN;
  END IF;

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

    -- Pilot Gate POS/Dinheiro: breakdown real por tender (nunca reconstruído de
    -- payment_method). Ausente (payments NULL/[]) = venda sem breakdown enviado (device
    -- antigo, antes desta etapa) — orders/order_items continuam a funcionar na mesma;
    -- só não há linhas aqui, tal como uma venda legacy local.
    IF payments IS NOT NULL AND jsonb_typeof(payments) = 'array' AND jsonb_array_length(payments) > 0 THEN
      INSERT INTO public.order_payments (tenant_id, store_id, order_id, method, amount, tendered_amount)
      SELECT v_tenant_id, v_store_id, v_order_id,
             p->>'method',
             (p->>'amount')::numeric,
             NULLIF(p->>'tendered_amount', '')::numeric
      FROM jsonb_array_elements(payments) AS p
      WHERE NULLIF(p->>'method', '') IS NOT NULL AND NULLIF(p->>'amount', '') IS NOT NULL;
    END IF;

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

REVOKE ALL ON FUNCTION public.create_order_with_items(JSONB, JSONB, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_order_with_items(JSONB, JSONB, JSONB) TO authenticated;
