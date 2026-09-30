-- Etapa 1G.4 (Fase 1 do Backoffice) - identidade do Device em stock_movements.
--
-- Falta confirmada por auditoria real: sync_stock_movements JA autentica o pedido por
-- auth.jwt()->>'device_id' (contra pos_devices, com revogacao e token_version validados),
-- mas nunca persiste essa identidade na linha inserida. Sem isto, o pull cloud->local nao
-- tem como distinguir "movimento que EU proprio enviei" (nunca reaplicar a quantidade) de
-- "movimento de outro Device/Backoffice" (aplicar exactamente uma vez).
--
-- device_id NULL = origem nao-Device (Backoffice/sistema); um Device sempre grava o seu
-- proprio id, nunca o de outro (nunca aceite do payload — ver sync_stock_movements abaixo).
--
-- FK para pos_devices: por construcao, sync_stock_movements so chega a inserir depois de
-- validar `SELECT * INTO v_device FROM pos_devices WHERE id = v_device_id` (RAISE
-- device_not_found caso contrario) — ao contrario de orders.device_id (que e anterior a
-- pos_devices existir e por isso ficou deliberadamente sem FK), aqui a linha referenciada
-- esta sempre garantida no momento do INSERT. ON DELETE SET NULL (nunca CASCADE): remover
-- um device no futuro nunca apaga historico de stock, so perde a atribuicao informativa.
ALTER TABLE public.stock_movements ADD COLUMN device_id UUID
  REFERENCES public.pos_devices (id) ON DELETE SET NULL;
CREATE INDEX stock_movements_device_id_idx ON public.stock_movements (device_id) WHERE device_id IS NOT NULL;

-- sync_stock_movements: identico ao anterior (20260922000100), so acrescenta a gravacao de
-- device_id = v_device_id (ja autenticado acima na funcao, nunca aceite de p_groups/payload).
CREATE OR REPLACE FUNCTION public.sync_stock_movements(p_groups JSONB)
RETURNS TABLE (
  out_reference_id TEXT,
  out_type TEXT,
  out_status TEXT,
  out_error TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant_id TEXT := public.current_tenant_id();
  v_device_id UUID;
  v_jwt_tv INT;
  v_device public.pos_devices%ROWTYPE;
  v_store_id UUID;
  v_group JSONB;
  v_item JSONB;
  v_out JSONB := '[]'::jsonb;
  v_group_out JSONB;
  v_type TEXT;
  v_ref TEXT;
  v_product UUID;
  v_wh UUID;
  v_from UUID;
  v_to UUID;
  v_qty NUMERIC;
  v_created TIMESTAMPTZ;
  v_rows INT;
  v_existing public.stock_movements%ROWTYPE;
  v_conflict BOOLEAN;
  v_status TEXT;
  v_err TEXT;
BEGIN
  IF v_tenant_id IS NULL OR v_tenant_id = '' THEN
    RAISE EXCEPTION 'unauthenticated_or_missing_tenant' USING ERRCODE = '28000';
  END IF;
  v_device_id := NULLIF(auth.jwt() ->> 'device_id', '')::uuid;
  IF v_device_id IS NULL THEN
    RAISE EXCEPTION 'device_identity_required' USING ERRCODE = '28000';
  END IF;
  SELECT * INTO v_device FROM public.pos_devices WHERE id = v_device_id AND tenant_id = v_tenant_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'device_not_found' USING ERRCODE = '28000'; END IF;
  IF v_device.revoked_at IS NOT NULL THEN RAISE EXCEPTION 'device_revoked' USING ERRCODE = '28000'; END IF;
  v_jwt_tv := NULLIF(auth.jwt() ->> 'token_version', '')::int;
  IF v_jwt_tv IS DISTINCT FROM v_device.token_version THEN
    RAISE EXCEPTION 'device_token_version_mismatch' USING ERRCODE = '28000';
  END IF;
  v_store_id := v_device.store_id;
  IF v_store_id IS NULL THEN RAISE EXCEPTION 'device_store_missing' USING ERRCODE = '28000'; END IF;

  IF p_groups IS NULL OR jsonb_typeof(p_groups) <> 'array' THEN
    RAISE EXCEPTION 'groups_required' USING ERRCODE = '22023';
  END IF;

  FOR v_group IN SELECT * FROM jsonb_array_elements(p_groups) LOOP
    v_group_out := '[]'::jsonb;
    BEGIN
      v_conflict := false;
      FOR v_item IN SELECT * FROM jsonb_array_elements(v_group) LOOP
        v_type := v_item->>'type';
        v_ref := NULLIF(btrim(COALESCE(v_item->>'reference_id', '')), '');
        IF v_ref IS NULL THEN RAISE EXCEPTION 'reference_id_required' USING ERRCODE = '22023'; END IF;
        IF v_type IS NULL OR v_type NOT IN ('restock', 'adjustment', 'transfer_out', 'transfer_in', 'opening') THEN
          RAISE EXCEPTION 'movement_type_not_syncable' USING ERRCODE = '22023';
        END IF;
        v_product := NULLIF(v_item->>'product_id', '')::uuid;
        v_wh := NULLIF(v_item->>'warehouse_id', '')::uuid;
        v_from := NULLIF(v_item->>'from_warehouse_id', '')::uuid;
        v_to := NULLIF(v_item->>'to_warehouse_id', '')::uuid;
        v_qty := NULLIF(v_item->>'quantity', '')::numeric;
        IF v_product IS NULL OR v_wh IS NULL OR v_qty IS NULL OR v_qty = 0 THEN
          RAISE EXCEPTION 'movement_fields_invalid' USING ERRCODE = '22023';
        END IF;
        IF v_type IN ('restock') AND v_qty < 0 THEN RAISE EXCEPTION 'movement_sign_invalid' USING ERRCODE = '22023'; END IF;
        IF NOT EXISTS (SELECT 1 FROM public.products p WHERE p.id = v_product AND p.tenant_id = v_tenant_id) THEN
          RAISE EXCEPTION 'item_product_not_in_tenant' USING ERRCODE = '42501';
        END IF;
        -- warehouse (e from/to) tem de pertencer a Store do DEVICE; nunca a outra Store
        IF NOT EXISTS (SELECT 1 FROM public.warehouses w WHERE w.id = v_wh AND w.store_id = v_store_id AND w.tenant_id = v_tenant_id) THEN
          RAISE EXCEPTION 'warehouse_not_in_store' USING ERRCODE = '42501';
        END IF;
        IF v_type IN ('transfer_out', 'transfer_in') THEN
          IF v_from IS NULL OR v_to IS NULL OR v_from = v_to THEN
            RAISE EXCEPTION 'transfer_warehouses_invalid' USING ERRCODE = '22023';
          END IF;
          IF (SELECT count(*) FROM public.warehouses w WHERE w.id IN (v_from, v_to) AND w.store_id = v_store_id AND w.tenant_id = v_tenant_id) <> 2 THEN
            RAISE EXCEPTION 'warehouse_not_in_store' USING ERRCODE = '42501';
          END IF;
          IF (v_type = 'transfer_out' AND (v_qty >= 0 OR v_wh <> v_from))
             OR (v_type = 'transfer_in' AND (v_qty <= 0 OR v_wh <> v_to)) THEN
            RAISE EXCEPTION 'transfer_direction_invalid' USING ERRCODE = '22023';
          END IF;
        ELSE
          v_from := NULL;
          v_to := NULL;
        END IF;
        v_created := LEAST(COALESCE(NULLIF(v_item->>'created_at', '')::timestamptz, now()), now());

        -- o produto passa a existir na Store (nunca reactiva um descontinuado)
        INSERT INTO public.store_products (tenant_id, store_id, product_id)
        VALUES (v_tenant_id, v_store_id, v_product)
        ON CONFLICT (store_id, product_id) DO NOTHING;

        INSERT INTO public.stock_movements
          (tenant_id, store_id, warehouse_id, from_warehouse_id, to_warehouse_id, product_id, type, quantity, reference_id, created_at, cost_layers, device_id)
        VALUES
          (v_tenant_id, v_store_id, v_wh, v_from, v_to, v_product, v_type, v_qty, v_ref, v_created,
           CASE WHEN jsonb_typeof(v_item->'cost_layers') = 'array' THEN v_item->'cost_layers' ELSE NULL END,
           v_device_id)
        ON CONFLICT (tenant_id, product_id, type, reference_id) DO NOTHING;
        GET DIAGNOSTICS v_rows = ROW_COUNT;

        IF v_rows = 1 THEN
          v_status := 'inserted';
        ELSE
          SELECT * INTO v_existing FROM public.stock_movements m
          WHERE m.tenant_id = v_tenant_id AND m.product_id = v_product AND m.type = v_type AND m.reference_id = v_ref;
          IF v_existing.store_id = v_store_id AND v_existing.warehouse_id = v_wh AND v_existing.quantity = v_qty THEN
            v_status := 'duplicate';
          ELSE
            v_status := 'conflict';
            v_conflict := true;
          END IF;
        END IF;
        v_group_out := v_group_out || jsonb_build_object('ref', v_ref, 'type', v_type, 'status', v_status, 'error', NULL);
      END LOOP;

      IF v_conflict THEN
        RAISE EXCEPTION 'movement_conflict' USING ERRCODE = '23505';
      END IF;
      v_out := v_out || v_group_out;
    EXCEPTION WHEN OTHERS THEN
      -- o grupo inteiro (par out/in incluido) e revertido; nada fica a meio
      v_err := SQLERRM;
      v_status := CASE WHEN v_err = 'item_product_not_in_tenant' THEN 'retry'
                       WHEN v_err = 'movement_conflict' THEN 'conflict'
                       ELSE 'rejected' END;
      FOR v_item IN SELECT * FROM jsonb_array_elements(v_group) LOOP
        v_out := v_out || jsonb_build_object('ref', v_item->>'reference_id', 'type', v_item->>'type', 'status', v_status, 'error', v_err);
      END LOOP;
    END;
  END LOOP;

  RETURN QUERY
  SELECT e->>'ref', e->>'type', e->>'status', e->>'error' FROM jsonb_array_elements(v_out) e;
END;
$$;
REVOKE ALL ON FUNCTION public.sync_stock_movements(JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sync_stock_movements(JSONB) TO authenticated;
