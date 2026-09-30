-- Etapa 1E.3 — bloco 008: create_order_with_items (SECURITY DEFINER, decisão aprovada).
--
-- Fronteira arquitetural deliberada (aprovada pelo utilizador): um device autenticado
-- (`authenticated`) pode EXECUTAR esta RPC, mas não pode fazer INSERT/UPDATE/DELETE
-- directo em orders/order_items/stock_movements/document_sequences/products. Isto só
-- é possível com SECURITY DEFINER — com INVOKER, dar à RPC os privilégios de tabela de
-- que precisa (INSERT em orders, etc.) obrigaria a conceder esses MESMOS privilégios
-- de tabela a `authenticated` directamente, abrindo acesso direto às tabelas antes de
-- existir RLS real. Ver relatório da etapa para a análise completa.
--
-- NOTA IMPORTANTE (secção 22 do pedido): isto NÃO é o mesmo padrão de
-- `rotate_pos_device_refresh_token` (Etapa 1C/1D) — aquela função é DEFINER porque só
-- `service_role` a chama (nunca authenticated) e nunca teve esta fronteira "operação
-- de negócio controlada, sem escrita directa" em mente. Aqui a razão é distinta e
-- específica: permitir a um device autenticado invocar uma operação de negócio
-- cuidadosamente validada sem lhe dar superfície de escrita directa nenhuma.

CREATE OR REPLACE FUNCTION public.current_tenant_id()
RETURNS TEXT
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT NULLIF(auth.jwt() ->> 'tenant_id', '');
$$;
-- SECURITY INVOKER (omisso) é suficiente e correcto aqui: só lê uma GUC de sessão
-- (request.jwt.claims, populada pelo PostgREST a partir do JWT verificado), não toca
-- em tabela nenhuma — não há privilégio elevado a proteger.
REVOKE ALL ON FUNCTION public.current_tenant_id() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_tenant_id() TO authenticated, service_role;


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
  -- 1/2. Tenant EXCLUSIVAMENTE da identidade autenticada — nunca do payload.
  v_tenant_id := public.current_tenant_id();
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'unauthenticated_or_missing_tenant' USING ERRCODE = '28000';
  END IF;

  -- Se o payload trouxer tenant_id e divergir do JWT, REJEITAR explicitamente (não
  -- ignorar em silêncio) — sinal de cliente comprometido ou bug a investigar.
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

  v_local_sale_id := NULLIF(order_data->>'local_sale_id', '');
  IF v_local_sale_id IS NULL THEN
    RAISE EXCEPTION 'local_sale_id_required' USING ERRCODE = '22023';
  END IF;

  -- Serializa só chamadas com o MESMO (tenant, local_sale_id); vendas diferentes ou de
  -- outros tenants nunca bloqueiam entre si. Liberta automaticamente no fim da
  -- transacção (xact lock) — sem risco de ficar preso se a função abortar.
  v_lock_key := hashtextextended(v_tenant_id || ':' || v_local_sale_id, 0);
  PERFORM pg_advisory_xact_lock(v_lock_key);

  -- Idempotência ANTES de tocar em document_sequences/orders/items/stock — nenhum
  -- retry consome número novo, insere item novo ou movimento novo.
  SELECT o.id, o.document_number INTO v_existing_id, v_existing_doc
  FROM public.orders o WHERE o.tenant_id = v_tenant_id AND o.local_sale_id = v_local_sale_id;
  IF v_existing_id IS NOT NULL THEN
    RETURN QUERY SELECT v_existing_id, v_existing_doc, true;
    RETURN;
  END IF;

  IF items IS NULL OR jsonb_typeof(items) <> 'array' OR jsonb_array_length(items) = 0 THEN
    RAISE EXCEPTION 'items_required' USING ERRCODE = '22023';
  END IF;

  -- Validar TODOS os items antes de qualquer escrita — nenhuma order/item/movimento
  -- parcial se um item for inválido (o RAISE aborta a transacção inteira).
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
      tenant_id, local_sale_id, customer_id, user_id, user_name, device_id, station_code,
      table_number, doc_type, document_number, status, payment_method,
      subtotal, discount, tax, total, received_amount, change_amount, created_at
    ) VALUES (
      v_tenant_id, v_local_sale_id,
      NULLIF(order_data->>'customer_id', '')::uuid,
      NULLIF(order_data->>'user_id', '')::uuid,
      NULLIF(order_data->>'user_name', ''),
      NULLIF(order_data->>'device_id', ''),
      NULLIF(order_data->>'station_code', ''),
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

    INSERT INTO public.order_items (tenant_id, order_id, product_id, product_name, quantity, price, discount_amount)
    SELECT v_tenant_id, v_order_id,
           (i->>'product_id')::uuid,
           COALESCE(i->>'product_name', 'Produto'),
           (i->>'quantity')::numeric,
           COALESCE((i->>'price')::numeric, 0),
           COALESCE((i->>'discount_amount')::numeric, 0)
    FROM jsonb_array_elements(items) AS i;

    -- Um movimento por PRODUTO, consolidado (não por linha) — uma order com o mesmo
    -- produto em 2 linhas gera 1 movimento com a soma das quantidades (ver relatório,
    -- secção 12). is_service não consome stock (comportamento histórico confirmado).
    INSERT INTO public.stock_movements (tenant_id, product_id, type, quantity, reference_id)
    SELECT v_tenant_id, x.product_id, 'sale', (x.total_qty * -1), 'order:' || v_order_id::text
    FROM (
      SELECT (i->>'product_id')::uuid AS product_id, SUM((i->>'quantity')::numeric) AS total_qty
      FROM jsonb_array_elements(items) AS i
      JOIN public.products p ON p.id = (i->>'product_id')::uuid AND p.tenant_id = v_tenant_id
      WHERE COALESCE(p.is_service, false) = false
      GROUP BY (i->>'product_id')::uuid
    ) x
    ON CONFLICT (tenant_id, product_id, type, reference_id) DO NOTHING;

  EXCEPTION WHEN unique_violation THEN
    -- Defesa em profundidade: mesmo com o advisory lock, se algo ainda colidir
    -- (ex.: corrida improvável no hash do lock), tenta resolver como idempotência
    -- antes de desistir — nunca mascara um erro real (document_number duplicado
    -- entre vendas DIFERENTES continua a propagar).
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
-- service_role tem bypass próprio da plataforma Supabase (BYPASSRLS + superuser-like);
-- não precisa de GRANT EXECUTE explícito para continuar a conseguir tudo.
