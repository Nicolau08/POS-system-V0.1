-- Etapa 1G.2B.5 - transferencias Store -> Store (documento + maquina de estados arbitrada pela cloud).
--  draft (so local) -> dispatched -> received ; dispatched -> cancelled (so via cloud, com movimento compensatorio).
--  * Stock sai da origem no DISPATCH (transfer_out); o destino so recebe no RECEIVE (transfer_in). Entre os dois,
--    a quantidade esta "em transito" (view stock_in_transit) e nao e stock fisico da origem nem disponivel no destino.
--  * Transicoes atomicas e compare-and-set (FOR UPDATE na linha do documento): a primeira transicao valida vence.
--  * Nenhuma Store escreve no ledger da outra: origem escreve so no seu armazem (out / reversal), destino so no seu (in).
--  * Divergencia (qty_received <> qty_sent) fica REGISTADA e pendente; nunca gera ajuste/perda automatico.
--  * Politica do produto: preparar/despachar nao exige o produto activo no destino; o RECEIVE cria explicitamente
--    store_products(destino, produto) se faltar (nunca duplica products; nunca reactiva um descontinuado).

ALTER TABLE public.stock_movements DROP CONSTRAINT stock_movements_type_check;
ALTER TABLE public.stock_movements ADD CONSTRAINT stock_movements_type_check
  CHECK (type IN ('sale', 'restock', 'adjustment', 'transfer_out', 'transfer_in', 'opening', 'transfer_reversal'));

CREATE TABLE public.stock_transfers (
  id UUID PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  from_store_id UUID NOT NULL,
  from_warehouse_id UUID NOT NULL,
  to_store_id UUID NOT NULL,
  to_warehouse_id UUID,
  status TEXT NOT NULL CHECK (status IN ('draft', 'dispatched', 'received', 'cancelled')),
  note TEXT,
  created_by_device UUID,
  received_by_device UUID,
  cancelled_by_device UUID,
  cancel_reason TEXT,
  has_divergence BOOLEAN NOT NULL DEFAULT false,
  divergence_status TEXT CHECK (divergence_status IS NULL OR divergence_status IN ('pending')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  dispatched_at TIMESTAMPTZ,
  received_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT stock_transfers_stores_differ CHECK (from_store_id <> to_store_id),
  CONSTRAINT stock_transfers_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT stock_transfers_from_store_fkey FOREIGN KEY (tenant_id, from_store_id) REFERENCES public.stores (tenant_id, id),
  CONSTRAINT stock_transfers_to_store_fkey FOREIGN KEY (tenant_id, to_store_id) REFERENCES public.stores (tenant_id, id),
  CONSTRAINT stock_transfers_from_wh_fkey FOREIGN KEY (tenant_id, from_store_id, from_warehouse_id) REFERENCES public.warehouses (tenant_id, store_id, id),
  CONSTRAINT stock_transfers_to_wh_fkey FOREIGN KEY (tenant_id, to_store_id, to_warehouse_id) REFERENCES public.warehouses (tenant_id, store_id, id)
);
CREATE INDEX stock_transfers_from_store_idx ON public.stock_transfers (from_store_id, status);
CREATE INDEX stock_transfers_to_store_idx ON public.stock_transfers (to_store_id, status);
CREATE TRIGGER stock_transfers_set_updated_at BEFORE UPDATE ON public.stock_transfers
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.stock_transfers_scope_immutable()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.from_store_id IS DISTINCT FROM OLD.from_store_id
     OR NEW.to_store_id IS DISTINCT FROM OLD.to_store_id OR NEW.from_warehouse_id IS DISTINCT FROM OLD.from_warehouse_id THEN
    RAISE EXCEPTION 'scope_immutable' USING ERRCODE = '28000';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER stock_transfers_scope_immutable BEFORE UPDATE ON public.stock_transfers
  FOR EACH ROW EXECUTE FUNCTION public.stock_transfers_scope_immutable();

CREATE TABLE public.stock_transfer_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL,
  transfer_id UUID NOT NULL,
  product_id UUID NOT NULL,
  qty_requested NUMERIC NOT NULL CHECK (qty_requested > 0),
  qty_sent NUMERIC NOT NULL CHECK (qty_sent > 0),
  qty_received NUMERIC CHECK (qty_received IS NULL OR qty_received >= 0),
  divergence_qty NUMERIC,
  cost_layers JSONB,
  dest_store_product_created BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT stock_transfer_items_transfer_fkey FOREIGN KEY (tenant_id, transfer_id) REFERENCES public.stock_transfers (tenant_id, id),
  CONSTRAINT stock_transfer_items_product_fkey FOREIGN KEY (tenant_id, product_id) REFERENCES public.products (tenant_id, id),
  CONSTRAINT stock_transfer_items_transfer_product_key UNIQUE (transfer_id, product_id)
);

ALTER TABLE public.stock_transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_transfer_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.stock_transfers, public.stock_transfer_items FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.stock_transfers, public.stock_transfer_items TO authenticated;
CREATE POLICY stock_transfers_select_involved ON public.stock_transfers FOR SELECT
  USING (tenant_id = public.current_tenant_id()
         AND (from_store_id = public.current_store_id() OR to_store_id = public.current_store_id()));
CREATE POLICY stock_transfer_items_select_involved ON public.stock_transfer_items FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.stock_transfers t
                 WHERE t.id = stock_transfer_items.transfer_id AND t.tenant_id = stock_transfer_items.tenant_id
                   AND (t.from_store_id = public.current_store_id() OR t.to_store_id = public.current_store_id())));

-- Vista do Device: direcao calculada no servidor (a Store nunca vem do cliente).
CREATE VIEW public.device_stock_transfers WITH (security_invoker = true) AS
SELECT t.*, CASE WHEN t.from_store_id = public.current_store_id() THEN 'out' ELSE 'in' END AS direction
FROM public.stock_transfers t;
GRANT SELECT ON public.device_stock_transfers TO authenticated, service_role;

-- Stock em transito: distinto do stock fisico da origem (ja debitado) e do disponivel no destino (ainda nao creditado).
CREATE VIEW public.stock_in_transit WITH (security_invoker = true) AS
SELECT t.tenant_id, t.id AS transfer_id, t.from_store_id, t.from_warehouse_id, t.to_store_id, t.to_warehouse_id,
       i.product_id, i.qty_sent AS quantity, t.dispatched_at
FROM public.stock_transfers t
JOIN public.stock_transfer_items i ON i.transfer_id = t.id AND i.tenant_id = t.tenant_id
WHERE t.status = 'dispatched';
GRANT SELECT ON public.stock_in_transit TO authenticated, service_role;

-- contexto do Device (tenant + Store derivados do JWT; falha fechada)
CREATE OR REPLACE FUNCTION public._device_ctx()
RETURNS TABLE (out_tenant_id TEXT, out_store_id UUID, out_device_id UUID)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_tenant TEXT := public.current_tenant_id();
  v_dev UUID;
  v_row public.pos_devices%ROWTYPE;
BEGIN
  IF v_tenant IS NULL OR v_tenant = '' THEN RAISE EXCEPTION 'unauthenticated_or_missing_tenant' USING ERRCODE = '28000'; END IF;
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
END;
$$;
REVOKE ALL ON FUNCTION public._device_ctx() FROM PUBLIC, anon, authenticated;

-- DISPATCH: cria o documento ja despachado e debita a ORIGEM (idempotente por id; 1.a transicao vence)
CREATE OR REPLACE FUNCTION public.transfer_dispatch(p_transfer JSONB)
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
  SELECT * INTO v_ctx FROM public._device_ctx();
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
    INSERT INTO public.stock_movements (tenant_id, store_id, warehouse_id, from_warehouse_id, product_id, type, quantity, reference_id, created_at, cost_layers)
    VALUES (v_ctx.out_tenant_id, v_ctx.out_store_id, v_from_wh, v_from_wh, v_pid, 'transfer_out', -v_qty,
            'transfer:' || v_id::text || ':' || v_pid::text || ':out', v_created,
            CASE WHEN jsonb_typeof(v_item->'cost_layers') = 'array' THEN v_item->'cost_layers' ELSE NULL END);
  END LOOP;

  RETURN QUERY SELECT v_id, 'dispatched'::text, false;
END;
$$;
REVOKE ALL ON FUNCTION public.transfer_dispatch(JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.transfer_dispatch(JSONB) TO authenticated;

-- RECEIVE: so o Device da Store DESTINO; dispatched -> received (CAS); credita o destino; regista divergencia
CREATE OR REPLACE FUNCTION public.transfer_receive(p_id UUID, p_to_warehouse UUID, p_items JSONB)
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
  SELECT * INTO v_ctx FROM public._device_ctx();
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
REVOKE ALL ON FUNCTION public.transfer_receive(UUID, UUID, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.transfer_receive(UUID, UUID, JSONB) TO authenticated;

-- CANCEL pos-dispatch (so cloud, so a Store ORIGEM): dispatched -> cancelled + movimento COMPENSATORIO (nunca apaga)
CREATE OR REPLACE FUNCTION public.transfer_cancel(p_id UUID, p_reason TEXT)
RETURNS TABLE (out_status TEXT, out_applied BOOLEAN)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_ctx RECORD;
  v_t public.stock_transfers%ROWTYPE;
  v_it public.stock_transfer_items%ROWTYPE;
BEGIN
  SELECT * INTO v_ctx FROM public._device_ctx();
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
REVOKE ALL ON FUNCTION public.transfer_cancel(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.transfer_cancel(UUID, TEXT) TO authenticated;
