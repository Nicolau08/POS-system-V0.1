-- Etapa 1G.4 Fase 3C.2 — Backoffice Stock: ajuste manual (delta) + contagem (saldo-alvo).
--
-- Reutiliza a RPC/ledger da 3C.1 (20260930000100): estende
-- backoffice_create_stock_movement com p_type ('restock' ou 'adjustment' — NUNCA
-- sale/opening/transfer_* nem aqui nem na contagem, sempre hardcoded/validado no
-- servidor, nunca um valor livre do payload) e acrescenta backoffice_set_stock_count,
-- que calcula o delta a partir do saldo actual DENTRO da própria função (nunca no
-- browser, que podia ler um saldo já desactualizado entre o ecrã abrir e o operador
-- submeter).
--
-- Concorrência: backoffice_set_stock_count usa pg_advisory_xact_lock em
-- (tenant,warehouse,product) ANTES de ler o saldo actual e ANTES de verificar a
-- idempotência — isto serializa duas contagens/ajustes concorrentes do MESMO
-- produto+armazém (nunca um "lost update": ler saldo, calcular delta, escrever). O
-- lock é xact-scoped (liberta-se sozinho no fim da chamada RPC, que é uma única
-- transacção implícita). backoffice_create_stock_movement (ajuste por delta directo)
-- não precisa deste lock — nunca lê-antes-de-escrever, só soma um delta já dado; a
-- UNIQUE(tenant,product,type,reference_id) já existente continua a ser a única
-- protecção necessária para essa via, exactamente como na 3C.1.
--
-- delta=0 (contagem que já bate certo com o saldo actual) devolve 'no_change' sem
-- gravar nada — idempotente por construção (recalcular duas vezes um delta zero nunca
-- tem efeito, com ou sem retry).

DROP FUNCTION IF EXISTS public.backoffice_create_stock_movement(UUID, UUID, UUID, NUMERIC, TEXT);

CREATE OR REPLACE FUNCTION public.backoffice_create_stock_movement(
  p_store_id UUID,
  p_warehouse_id UUID,
  p_product_id UUID,
  p_quantity NUMERIC,
  p_idempotency_key TEXT,
  p_type TEXT DEFAULT 'restock'
)
RETURNS TABLE (out_id UUID, out_status TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant_id TEXT;
  v_reference_id TEXT;
  v_id UUID;
  v_existing public.stock_movements%ROWTYPE;
BEGIN
  v_tenant_id := public.backoffice_current_tenant_id();
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'unauthenticated_or_no_access' USING ERRCODE = '28000';
  END IF;
  IF p_type NOT IN ('restock', 'adjustment') THEN
    RAISE EXCEPTION 'movement_type_not_allowed' USING ERRCODE = '22023';
  END IF;
  IF p_store_id IS NULL OR NOT public.backoffice_can_access_store(p_store_id) THEN
    RAISE EXCEPTION 'store_not_authorized' USING ERRCODE = '42501';
  END IF;
  IF p_warehouse_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.warehouses w WHERE w.id = p_warehouse_id AND w.store_id = p_store_id AND w.tenant_id = v_tenant_id
  ) THEN
    RAISE EXCEPTION 'warehouse_not_in_store' USING ERRCODE = '42501';
  END IF;
  IF p_product_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.products p WHERE p.id = p_product_id AND p.tenant_id = v_tenant_id
  ) THEN
    RAISE EXCEPTION 'item_product_not_in_tenant' USING ERRCODE = '42501';
  END IF;
  IF p_type = 'restock' AND (p_quantity IS NULL OR p_quantity <= 0) THEN
    RAISE EXCEPTION 'quantity_must_be_positive' USING ERRCODE = '22023';
  END IF;
  IF p_type = 'adjustment' AND (p_quantity IS NULL OR p_quantity = 0) THEN
    RAISE EXCEPTION 'quantity_must_not_be_zero' USING ERRCODE = '22023';
  END IF;
  IF p_idempotency_key IS NULL OR btrim(p_idempotency_key) = '' THEN
    RAISE EXCEPTION 'idempotency_key_required' USING ERRCODE = '22023';
  END IF;

  v_reference_id := 'backoffice:' || btrim(p_idempotency_key);

  INSERT INTO public.store_products (tenant_id, store_id, product_id)
  VALUES (v_tenant_id, p_store_id, p_product_id)
  ON CONFLICT (store_id, product_id) DO NOTHING;

  INSERT INTO public.stock_movements (tenant_id, store_id, warehouse_id, product_id, type, quantity, reference_id, device_id)
  VALUES (v_tenant_id, p_store_id, p_warehouse_id, p_product_id, p_type, p_quantity, v_reference_id, NULL)
  ON CONFLICT (tenant_id, product_id, type, reference_id) DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NOT NULL THEN
    RETURN QUERY SELECT v_id, 'inserted'::text;
    RETURN;
  END IF;

  SELECT * INTO v_existing FROM public.stock_movements m
  WHERE m.tenant_id = v_tenant_id AND m.product_id = p_product_id AND m.type = p_type AND m.reference_id = v_reference_id;
  IF v_existing.store_id = p_store_id AND v_existing.warehouse_id = p_warehouse_id AND v_existing.quantity = p_quantity THEN
    RETURN QUERY SELECT v_existing.id, 'duplicate'::text;
    RETURN;
  END IF;
  RAISE EXCEPTION 'movement_conflict' USING ERRCODE = '23505';
END;
$$;
REVOKE ALL ON FUNCTION public.backoffice_create_stock_movement(UUID, UUID, UUID, NUMERIC, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.backoffice_create_stock_movement(UUID, UUID, UUID, NUMERIC, TEXT, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.backoffice_set_stock_count(
  p_store_id UUID,
  p_warehouse_id UUID,
  p_product_id UUID,
  p_target_quantity NUMERIC,
  p_idempotency_key TEXT
)
RETURNS TABLE (out_id UUID, out_status TEXT, out_delta NUMERIC)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant_id TEXT;
  v_reference_id TEXT;
  v_id UUID;
  v_existing public.stock_movements%ROWTYPE;
  v_current NUMERIC;
  v_delta NUMERIC;
BEGIN
  v_tenant_id := public.backoffice_current_tenant_id();
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'unauthenticated_or_no_access' USING ERRCODE = '28000';
  END IF;
  IF p_store_id IS NULL OR NOT public.backoffice_can_access_store(p_store_id) THEN
    RAISE EXCEPTION 'store_not_authorized' USING ERRCODE = '42501';
  END IF;
  IF p_warehouse_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.warehouses w WHERE w.id = p_warehouse_id AND w.store_id = p_store_id AND w.tenant_id = v_tenant_id
  ) THEN
    RAISE EXCEPTION 'warehouse_not_in_store' USING ERRCODE = '42501';
  END IF;
  IF p_product_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.products p WHERE p.id = p_product_id AND p.tenant_id = v_tenant_id
  ) THEN
    RAISE EXCEPTION 'item_product_not_in_tenant' USING ERRCODE = '42501';
  END IF;
  IF p_target_quantity IS NULL OR p_target_quantity < 0 THEN
    RAISE EXCEPTION 'target_quantity_must_be_non_negative' USING ERRCODE = '22023';
  END IF;
  IF p_idempotency_key IS NULL OR btrim(p_idempotency_key) = '' THEN
    RAISE EXCEPTION 'idempotency_key_required' USING ERRCODE = '22023';
  END IF;

  v_reference_id := 'backoffice:' || btrim(p_idempotency_key);

  -- Lock ANTES da verificação de idempotência e ANTES de ler o saldo: serializa tanto
  -- retries com a MESMA chave (a segunda chamada só vê o resultado da primeira depois de
  -- ela commitar) como contagens/ajustes CONCORRENTES do mesmo produto+armazém (a
  -- segunda lê sempre o saldo já actualizado pela primeira — nunca um lost update).
  PERFORM pg_advisory_xact_lock(hashtextextended(v_tenant_id || ':' || p_warehouse_id::text || ':' || p_product_id::text, 0));

  SELECT * INTO v_existing FROM public.stock_movements m
  WHERE m.tenant_id = v_tenant_id AND m.product_id = p_product_id AND m.type = 'adjustment' AND m.reference_id = v_reference_id;
  IF FOUND THEN
    RETURN QUERY SELECT v_existing.id, 'duplicate'::text, v_existing.quantity;
    RETURN;
  END IF;

  SELECT COALESCE(SUM(quantity), 0) INTO v_current
  FROM public.stock_movements
  WHERE tenant_id = v_tenant_id AND warehouse_id = p_warehouse_id AND product_id = p_product_id;
  v_delta := p_target_quantity - v_current;

  IF v_delta = 0 THEN
    RETURN QUERY SELECT NULL::uuid, 'no_change'::text, 0::numeric;
    RETURN;
  END IF;

  INSERT INTO public.store_products (tenant_id, store_id, product_id)
  VALUES (v_tenant_id, p_store_id, p_product_id)
  ON CONFLICT (store_id, product_id) DO NOTHING;

  INSERT INTO public.stock_movements (tenant_id, store_id, warehouse_id, product_id, type, quantity, reference_id, device_id)
  VALUES (v_tenant_id, p_store_id, p_warehouse_id, p_product_id, 'adjustment', v_delta, v_reference_id, NULL)
  RETURNING id INTO v_id;

  RETURN QUERY SELECT v_id, 'inserted'::text, v_delta;
END;
$$;
REVOKE ALL ON FUNCTION public.backoffice_set_stock_count(UUID, UUID, UUID, NUMERIC, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.backoffice_set_stock_count(UUID, UUID, UUID, NUMERIC, TEXT) TO authenticated;
