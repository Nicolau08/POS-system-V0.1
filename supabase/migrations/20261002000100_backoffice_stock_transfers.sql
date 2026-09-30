-- Etapa 1G.4 Fase 3C.3 — Backoffice: Transferências (Warehouse->Warehouse + Store->Store).
--
-- AUDITORIA (pedida antes de tocar em Store->Store): transfer_dispatch/transfer_receive/
-- transfer_cancel (20260924000100) têm UMA ÚNICA dependência de Device JWT, isolada na
-- primeira linha de cada função: `SELECT * INTO v_ctx FROM public._device_ctx();`. Todo o
-- resto do corpo (máquina de estados dispatched/received/cancelled, CAS por
-- pg_advisory_xact_lock+FOR UPDATE, débito na origem, crédito no destino, divergência,
-- movimento compensatório no cancel) usa só v_ctx.out_tenant_id/out_store_id/
-- out_device_id — nunca mais nenhuma referência a auth.jwt()/pos_devices. Não há
-- state machine nem regra de negócio nenhuma para duplicar: a ÚNICA coisa que muda é
-- COMO se resolve "qual o tenant/store/device desta chamada".
--
-- ADAPTAÇÃO (mínima, sem duplicar lógica): _device_ctx() ganha um p_store_id opcional.
-- Com device_id no JWT (Device), comportamento 100% inalterado (p_store_id ignorado — um
-- Device nunca escolhe a sua Store, é sempre a sua própria). SEM device_id (Backoffice),
-- resolve tenant via backoffice_current_tenant_id() e exige p_store_id explícito,
-- validado por backoffice_can_access_store() — nunca aceite às cegas. device_id sai
-- sempre NULL nesse ramo (created/received/cancelled_by_device fica NULL, como já
-- previsto/aprovado). dispatch/receive/cancel só mudam UMA linha cada (a chamada a
-- _device_ctx(), agora com p_store_id) — o resto do corpo é copiado tal e qual do
-- original, zero alteração de regra.
--
-- TRUST MODEL: preservado. Device continua sem poder escolher Store (deriva sempre de
-- pos_devices). Backoffice só pode agir na Store que backoffice_can_access_store()
-- já validaria em qualquer outra tabela desta Fase — mesma autoridade, sem excepção.
--
-- Warehouse->Warehouse (mesma Store): NÃO passa por transfer_dispatch (essa exige
-- explicitamente to_store <> from_store — código existente, "transfer_same_store").
-- O precedente aqui é sync_stock_movements (Fase 1): um par transfer_out/transfer_in
-- atómico, sem validação de saldo (a política actual do projecto é permitir stock
-- negativo no ledger — Fase 1G.4/1 já documentou isto; preservada aqui tal e qual, por
-- pedido explícito "preservar política actual sobre stock negativo"). Sem
-- advisory lock: tal como o ajuste por delta da 3C.2, nunca lê saldo antes de escrever
-- (só concorrência que LÊ-antes-de-ESCREVER precisa de lock — ver backoffice_set_stock_count).

DROP FUNCTION IF EXISTS public._device_ctx();

CREATE OR REPLACE FUNCTION public._device_ctx(p_store_id UUID DEFAULT NULL)
RETURNS TABLE (out_tenant_id TEXT, out_store_id UUID, out_device_id UUID)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_tenant TEXT := public.current_tenant_id();
  v_dev UUID;
  v_row public.pos_devices%ROWTYPE;
  v_bo_tenant TEXT;
BEGIN
  IF v_tenant IS NOT NULL AND v_tenant <> '' THEN
    v_dev := NULLIF(auth.jwt() ->> 'device_id', '')::uuid;
    IF v_dev IS NULL THEN RAISE EXCEPTION 'device_identity_required' USING ERRCODE = '28000'; END IF;
    SELECT * INTO v_row FROM public.pos_devices WHERE id = v_dev AND tenant_id = v_tenant;
    IF NOT FOUND THEN RAISE EXCEPTION 'device_not_found' USING ERRCODE = '28000'; END IF;
    IF v_row.revoked_at IS NOT NULL THEN RAISE EXCEPTION 'device_revoked' USING ERRCODE = '28000'; END IF;
    IF NULLIF(auth.jwt() ->> 'token_version', '')::int IS DISTINCT FROM v_row.token_version THEN
      RAISE EXCEPTION 'device_token_version_mismatch' USING ERRCODE = '28000';
    END IF;
    IF v_row.store_id IS NULL THEN RAISE EXCEPTION 'device_store_missing' USING ERRCODE = '28000'; END IF;
    RETURN QUERY SELECT v_tenant, v_row.store_id, v_dev;
    RETURN;
  END IF;

  -- Sem tenant_id no JWT (nunca um Device) — tenta sessão humana do Backoffice.
  v_bo_tenant := public.backoffice_current_tenant_id();
  IF v_bo_tenant IS NULL THEN RAISE EXCEPTION 'device_identity_required' USING ERRCODE = '28000'; END IF;
  IF p_store_id IS NULL OR NOT public.backoffice_can_access_store(p_store_id) THEN
    RAISE EXCEPTION 'store_not_authorized' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY SELECT v_bo_tenant, p_store_id, NULL::uuid;
END;
$$;
REVOKE ALL ON FUNCTION public._device_ctx(UUID) FROM PUBLIC, anon, authenticated;

DROP FUNCTION IF EXISTS public.transfer_dispatch(JSONB);

CREATE OR REPLACE FUNCTION public.transfer_dispatch(p_transfer JSONB, p_store_id UUID DEFAULT NULL)
RETURNS TABLE (out_id UUID, out_status TEXT, out_already_exists BOOLEAN)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_ctx RECORD;
  v_id UUID;
  v_t public.stock_transfers%ROWTYPE;
  v_from_wh UUID;
  v_to_store UUID;
  v_item JSONB;
  v_pid UUID;
  v_qty NUMERIC;
  v_created TIMESTAMPTZ;
BEGIN
  SELECT * INTO v_ctx FROM public._device_ctx(p_store_id);
  v_id := NULLIF(p_transfer->>'id', '')::uuid;
  IF v_id IS NULL THEN RAISE EXCEPTION 'transfer_id_required' USING ERRCODE = '22023'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('transfer:' || v_id::text));

  SELECT * INTO v_t FROM public.stock_transfers WHERE id = v_id FOR UPDATE;
  IF FOUND THEN
    IF v_t.tenant_id <> v_ctx.out_tenant_id OR v_t.from_store_id <> v_ctx.out_store_id THEN
      RAISE EXCEPTION 'transfer_store_mismatch' USING ERRCODE = '42501';
    END IF;
    RETURN QUERY SELECT v_t.id, v_t.status, true;
    RETURN;
  END IF;

  v_from_wh := NULLIF(p_transfer->>'from_warehouse_id', '')::uuid;
  v_to_store := NULLIF(p_transfer->>'to_store_id', '')::uuid;
  IF v_from_wh IS NULL OR v_to_store IS NULL THEN RAISE EXCEPTION 'transfer_fields_invalid' USING ERRCODE = '22023'; END IF;
  IF v_to_store = v_ctx.out_store_id THEN RAISE EXCEPTION 'transfer_same_store' USING ERRCODE = '22023'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.stores s WHERE s.id = v_to_store AND s.tenant_id = v_ctx.out_tenant_id) THEN
    RAISE EXCEPTION 'transfer_to_store_invalid' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.warehouses w WHERE w.id = v_from_wh AND w.store_id = v_ctx.out_store_id AND w.tenant_id = v_ctx.out_tenant_id) THEN
    RAISE EXCEPTION 'warehouse_not_in_store' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(p_transfer->'items') <> 'array' OR jsonb_array_length(p_transfer->'items') = 0 THEN
    RAISE EXCEPTION 'items_required' USING ERRCODE = '22023';
  END IF;
  v_created := LEAST(COALESCE(NULLIF(p_transfer->>'created_at', '')::timestamptz, now()), now());

  INSERT INTO public.stock_transfers (id, tenant_id, from_store_id, from_warehouse_id, to_store_id, status, note, created_by_device, created_at, dispatched_at)
  VALUES (v_id, v_ctx.out_tenant_id, v_ctx.out_store_id, v_from_wh, v_to_store, 'dispatched', NULLIF(p_transfer->>'note', ''), v_ctx.out_device_id, v_created, now());

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_transfer->'items') LOOP
    v_pid := NULLIF(v_item->>'product_id', '')::uuid;
    v_qty := NULLIF(v_item->>'qty', '')::numeric;
    IF v_pid IS NULL OR v_qty IS NULL OR v_qty <= 0 THEN RAISE EXCEPTION 'item_invalid' USING ERRCODE = '22023'; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.products p WHERE p.id = v_pid AND p.tenant_id = v_ctx.out_tenant_id) THEN
      RAISE EXCEPTION 'item_product_not_in_tenant' USING ERRCODE = '42501';
    END IF;
    INSERT INTO public.stock_transfer_items (tenant_id, transfer_id, product_id, qty_requested, qty_sent, cost_layers)
    VALUES (v_ctx.out_tenant_id, v_id, v_pid, v_qty, v_qty,
            CASE WHEN jsonb_typeof(v_item->'cost_layers') = 'array' THEN v_item->'cost_layers' ELSE NULL END);
    INSERT INTO public.store_products (tenant_id, store_id, product_id) VALUES (v_ctx.out_tenant_id, v_ctx.out_store_id, v_pid)
    ON CONFLICT (store_id, product_id) DO NOTHING;
    -- device_id NÃO incluído aqui de propósito: preserva exactamente o comportamento
    -- original (Device também nunca o gravava nesta função) — estas linhas são
    -- consumidas pelo pull DEDICADO de transferências Store->Store
    -- (syncTransfersFromCloud/applyRemoteTransfers em api/syncService.js), nunca pelo
    -- pull genérico do ledger da Fase 1, que é o único sítio onde device_id importa.
    INSERT INTO public.stock_movements (tenant_id, store_id, warehouse_id, from_warehouse_id, product_id, type, quantity, reference_id, created_at, cost_layers)
    VALUES (v_ctx.out_tenant_id, v_ctx.out_store_id, v_from_wh, v_from_wh, v_pid, 'transfer_out', -v_qty,
            'transfer:' || v_id::text || ':' || v_pid::text || ':out', v_created,
            CASE WHEN jsonb_typeof(v_item->'cost_layers') = 'array' THEN v_item->'cost_layers' ELSE NULL END);
  END LOOP;

  RETURN QUERY SELECT v_id, 'dispatched'::text, false;
END;
$$;
REVOKE ALL ON FUNCTION public.transfer_dispatch(JSONB, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.transfer_dispatch(JSONB, UUID) TO authenticated;

DROP FUNCTION IF EXISTS public.transfer_receive(UUID, UUID, JSONB);

CREATE OR REPLACE FUNCTION public.transfer_receive(p_id UUID, p_to_warehouse UUID, p_items JSONB, p_store_id UUID DEFAULT NULL)
RETURNS TABLE (out_status TEXT, out_applied BOOLEAN, out_has_divergence BOOLEAN)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_ctx RECORD;
  v_t public.stock_transfers%ROWTYPE;
  v_wh UUID;
  v_it public.stock_transfer_items%ROWTYPE;
  v_recv NUMERIC;
  v_diverge BOOLEAN := false;
  v_sp_created BOOLEAN;
BEGIN
  SELECT * INTO v_ctx FROM public._device_ctx(p_store_id);
  PERFORM pg_advisory_xact_lock(hashtext('transfer:' || p_id::text));
  SELECT * INTO v_t FROM public.stock_transfers WHERE id = p_id AND tenant_id = v_ctx.out_tenant_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'transfer_not_found' USING ERRCODE = '42501'; END IF;
  IF v_t.to_store_id <> v_ctx.out_store_id THEN RAISE EXCEPTION 'transfer_not_for_store' USING ERRCODE = '42501'; END IF;
  IF v_t.status = 'received' THEN RETURN QUERY SELECT v_t.status, false, v_t.has_divergence; RETURN; END IF;
  IF v_t.status = 'cancelled' THEN RETURN QUERY SELECT v_t.status, false, false; RETURN; END IF;
  IF v_t.status <> 'dispatched' THEN RAISE EXCEPTION 'transfer_state_invalid' USING ERRCODE = '22023'; END IF;

  IF p_to_warehouse IS NULL THEN
    SELECT w.id INTO v_wh FROM public.warehouses w
    WHERE w.store_id = v_ctx.out_store_id AND w.tenant_id = v_ctx.out_tenant_id AND w.is_default AND w.is_active;
  ELSE
    SELECT w.id INTO v_wh FROM public.warehouses w
    WHERE w.id = p_to_warehouse AND w.store_id = v_ctx.out_store_id AND w.tenant_id = v_ctx.out_tenant_id AND w.is_active;
  END IF;
  IF v_wh IS NULL THEN RAISE EXCEPTION 'warehouse_not_in_store' USING ERRCODE = '42501'; END IF;
  IF jsonb_typeof(p_items) <> 'array' THEN RAISE EXCEPTION 'received_items_invalid' USING ERRCODE = '22023'; END IF;

  FOR v_it IN SELECT * FROM public.stock_transfer_items i WHERE i.transfer_id = p_id LOOP
    SELECT NULLIF(e->>'qty_received', '')::numeric INTO v_recv
    FROM jsonb_array_elements(p_items) e WHERE (e->>'product_id')::uuid = v_it.product_id LIMIT 1;
    IF v_recv IS NULL OR v_recv < 0 THEN RAISE EXCEPTION 'received_items_incomplete' USING ERRCODE = '22023'; END IF;
    IF v_recv <> v_it.qty_sent THEN v_diverge := true; END IF;

    INSERT INTO public.store_products (tenant_id, store_id, product_id) VALUES (v_ctx.out_tenant_id, v_ctx.out_store_id, v_it.product_id)
    ON CONFLICT (store_id, product_id) DO NOTHING;
    v_sp_created := FOUND;

    UPDATE public.stock_transfer_items SET qty_received = v_recv, divergence_qty = v_recv - v_it.qty_sent,
      dest_store_product_created = v_sp_created WHERE id = v_it.id;
    IF v_recv > 0 THEN
      INSERT INTO public.stock_movements (tenant_id, store_id, warehouse_id, from_warehouse_id, to_warehouse_id, product_id, type, quantity, reference_id, cost_layers)
      VALUES (v_ctx.out_tenant_id, v_ctx.out_store_id, v_wh, v_t.from_warehouse_id, v_wh, v_it.product_id, 'transfer_in', v_recv,
              'transfer:' || p_id::text || ':' || v_it.product_id::text || ':in', v_it.cost_layers);
    END IF;
  END LOOP;

  UPDATE public.stock_transfers SET status = 'received', to_warehouse_id = v_wh, received_at = now(), received_by_device = v_ctx.out_device_id,
    has_divergence = v_diverge, divergence_status = CASE WHEN v_diverge THEN 'pending' END
  WHERE id = p_id;
  RETURN QUERY SELECT 'received'::text, true, v_diverge;
END;
$$;
REVOKE ALL ON FUNCTION public.transfer_receive(UUID, UUID, JSONB, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.transfer_receive(UUID, UUID, JSONB, UUID) TO authenticated;

DROP FUNCTION IF EXISTS public.transfer_cancel(UUID, TEXT);

CREATE OR REPLACE FUNCTION public.transfer_cancel(p_id UUID, p_reason TEXT, p_store_id UUID DEFAULT NULL)
RETURNS TABLE (out_status TEXT, out_applied BOOLEAN)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_ctx RECORD;
  v_t public.stock_transfers%ROWTYPE;
  v_it public.stock_transfer_items%ROWTYPE;
BEGIN
  SELECT * INTO v_ctx FROM public._device_ctx(p_store_id);
  PERFORM pg_advisory_xact_lock(hashtext('transfer:' || p_id::text));
  SELECT * INTO v_t FROM public.stock_transfers WHERE id = p_id AND tenant_id = v_ctx.out_tenant_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'transfer_not_found' USING ERRCODE = '42501'; END IF;
  IF v_t.from_store_id <> v_ctx.out_store_id THEN RAISE EXCEPTION 'transfer_not_from_store' USING ERRCODE = '42501'; END IF;
  IF v_t.status <> 'dispatched' THEN RETURN QUERY SELECT v_t.status, false; RETURN; END IF;

  FOR v_it IN SELECT * FROM public.stock_transfer_items i WHERE i.transfer_id = p_id LOOP
    INSERT INTO public.stock_movements (tenant_id, store_id, warehouse_id, from_warehouse_id, product_id, type, quantity, reference_id, cost_layers)
    VALUES (v_ctx.out_tenant_id, v_ctx.out_store_id, v_t.from_warehouse_id, v_t.from_warehouse_id, v_it.product_id, 'transfer_reversal', v_it.qty_sent,
            'transfer:' || p_id::text || ':' || v_it.product_id::text || ':reversal', v_it.cost_layers);
  END LOOP;
  UPDATE public.stock_transfers SET status = 'cancelled', cancelled_at = now(), cancelled_by_device = v_ctx.out_device_id,
    cancel_reason = NULLIF(p_reason, '') WHERE id = p_id;
  RETURN QUERY SELECT 'cancelled'::text, true;
END;
$$;
REVOKE ALL ON FUNCTION public.transfer_cancel(UUID, TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.transfer_cancel(UUID, TEXT, UUID) TO authenticated;

-- Leitura das transferências pela sessão humana do Backoffice (aditiva; nunca altera a
-- policy do Device).
CREATE POLICY stock_transfers_select_backoffice ON public.stock_transfers FOR SELECT
  USING (tenant_id = public.backoffice_current_tenant_id()
         AND (public.backoffice_can_access_store(from_store_id) OR public.backoffice_can_access_store(to_store_id)));
CREATE POLICY stock_transfer_items_select_backoffice ON public.stock_transfer_items FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.stock_transfers t
                 WHERE t.id = stock_transfer_items.transfer_id AND t.tenant_id = stock_transfer_items.tenant_id
                   AND (public.backoffice_can_access_store(t.from_store_id) OR public.backoffice_can_access_store(t.to_store_id))));

-- Warehouse->Warehouse (mesma Store): par transfer_out/transfer_in atómico, sem
-- validação de saldo (política actual preservada — ver nota no topo). Mesma idempotência
-- por par (tenant,product,type,reference_id) que já existe na tabela.
CREATE OR REPLACE FUNCTION public.backoffice_transfer_stock(
  p_store_id UUID,
  p_from_warehouse_id UUID,
  p_to_warehouse_id UUID,
  p_product_id UUID,
  p_quantity NUMERIC,
  p_idempotency_key TEXT
)
RETURNS TABLE (out_status TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant_id TEXT;
  v_ref_out TEXT;
  v_ref_in TEXT;
  v_rows INT;
  v_conflict BOOLEAN := false;
BEGIN
  v_tenant_id := public.backoffice_current_tenant_id();
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'unauthenticated_or_no_access' USING ERRCODE = '28000';
  END IF;
  IF p_store_id IS NULL OR NOT public.backoffice_can_access_store(p_store_id) THEN
    RAISE EXCEPTION 'store_not_authorized' USING ERRCODE = '42501';
  END IF;
  IF p_from_warehouse_id IS NULL OR p_to_warehouse_id IS NULL OR p_from_warehouse_id = p_to_warehouse_id THEN
    RAISE EXCEPTION 'transfer_warehouses_invalid' USING ERRCODE = '22023';
  END IF;
  IF (SELECT count(*) FROM public.warehouses w WHERE w.id IN (p_from_warehouse_id, p_to_warehouse_id) AND w.store_id = p_store_id AND w.tenant_id = v_tenant_id) <> 2 THEN
    RAISE EXCEPTION 'warehouse_not_in_store' USING ERRCODE = '42501';
  END IF;
  IF p_product_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.products p WHERE p.id = p_product_id AND p.tenant_id = v_tenant_id) THEN
    RAISE EXCEPTION 'item_product_not_in_tenant' USING ERRCODE = '42501';
  END IF;
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'quantity_must_be_positive' USING ERRCODE = '22023';
  END IF;
  IF p_idempotency_key IS NULL OR btrim(p_idempotency_key) = '' THEN
    RAISE EXCEPTION 'idempotency_key_required' USING ERRCODE = '22023';
  END IF;

  v_ref_out := 'backoffice:' || btrim(p_idempotency_key) || ':out';
  v_ref_in := 'backoffice:' || btrim(p_idempotency_key) || ':in';

  INSERT INTO public.store_products (tenant_id, store_id, product_id) VALUES (v_tenant_id, p_store_id, p_product_id)
  ON CONFLICT (store_id, product_id) DO NOTHING;

  INSERT INTO public.stock_movements (tenant_id, store_id, warehouse_id, from_warehouse_id, to_warehouse_id, product_id, type, quantity, reference_id, device_id)
  VALUES (v_tenant_id, p_store_id, p_from_warehouse_id, p_from_warehouse_id, p_to_warehouse_id, p_product_id, 'transfer_out', -p_quantity, v_ref_out, NULL)
  ON CONFLICT (tenant_id, product_id, type, reference_id) DO NOTHING;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN v_conflict := true; END IF;

  INSERT INTO public.stock_movements (tenant_id, store_id, warehouse_id, from_warehouse_id, to_warehouse_id, product_id, type, quantity, reference_id, device_id)
  VALUES (v_tenant_id, p_store_id, p_to_warehouse_id, p_from_warehouse_id, p_to_warehouse_id, p_product_id, 'transfer_in', p_quantity, v_ref_in, NULL)
  ON CONFLICT (tenant_id, product_id, type, reference_id) DO NOTHING;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN v_conflict := true; END IF;

  IF v_conflict THEN
    -- Idempotente por chave: se AMBAS as linhas já existem com esta referência, é um
    -- retry legítimo (duplicate); qualquer outra combinação (só uma existe, ou existe
    -- com outros valores) é um conflito real, nunca corrigido em silêncio.
    IF EXISTS (SELECT 1 FROM public.stock_movements m WHERE m.tenant_id = v_tenant_id AND m.product_id = p_product_id AND m.type = 'transfer_out' AND m.reference_id = v_ref_out)
       AND EXISTS (SELECT 1 FROM public.stock_movements m WHERE m.tenant_id = v_tenant_id AND m.product_id = p_product_id AND m.type = 'transfer_in' AND m.reference_id = v_ref_in)
    THEN
      RETURN QUERY SELECT 'duplicate'::text;
      RETURN;
    END IF;
    RAISE EXCEPTION 'movement_conflict' USING ERRCODE = '23505';
  END IF;

  RETURN QUERY SELECT 'transferred'::text;
END;
$$;
REVOKE ALL ON FUNCTION public.backoffice_transfer_stock(UUID, UUID, UUID, UUID, NUMERIC, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.backoffice_transfer_stock(UUID, UUID, UUID, UUID, NUMERIC, TEXT) TO authenticated;
