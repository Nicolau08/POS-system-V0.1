-- Etapa 1G.2B.4 - catalogo por Store. products = mestre do Tenant; store_products = disponibilidade/config nessa Store.
--  * _store_product_apply: nucleo unico (cria/actualiza store_products; NUNCA cria produto, stock ou movimentos).
--  * set_store_product: o Device configura/activa/descontinua na SUA Store (Store derivada do Device JWT).
--  * admin_set_store_product: so service_role (consola do dono): copia/activa/descontinua numa Store escolhida
--    do MESMO tenant (ex.: "copiar P para a Store B"), reutilizando o mesmo products.id.
--  config JSONB: chaves presentes sao aplicadas; null limpa price_override/min_stock; chaves ausentes mantem-se.

CREATE OR REPLACE FUNCTION public._store_product_apply(
  p_tenant_id TEXT,
  p_store_id UUID,
  p_product_id UUID,
  p_config JSONB
)
RETURNS TABLE (out_status TEXT, out_price_override NUMERIC, out_min_stock NUMERIC, out_created BOOLEAN)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_cfg JSONB := COALESCE(p_config, '{}'::jsonb);
  v_status TEXT;
  v_created BOOLEAN := false;
  v_row public.store_products%ROWTYPE;
BEGIN
  IF jsonb_typeof(v_cfg) <> 'object' THEN
    RAISE EXCEPTION 'config_invalid' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.stores s WHERE s.id = p_store_id AND s.tenant_id = p_tenant_id) THEN
    RAISE EXCEPTION 'store_not_in_tenant' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.products p WHERE p.id = p_product_id AND p.tenant_id = p_tenant_id) THEN
    RAISE EXCEPTION 'product_not_in_tenant' USING ERRCODE = '42501';
  END IF;
  IF v_cfg ? 'status' THEN
    v_status := v_cfg->>'status';
    IF v_status IS NULL OR v_status NOT IN ('active', 'discontinued') THEN
      RAISE EXCEPTION 'status_invalid' USING ERRCODE = '22023';
    END IF;
  END IF;

  INSERT INTO public.store_products (tenant_id, store_id, product_id, status)
  VALUES (p_tenant_id, p_store_id, p_product_id, COALESCE(v_status, 'active'))
  ON CONFLICT (store_id, product_id) DO NOTHING;
  v_created := FOUND;

  UPDATE public.store_products sp
  SET status = COALESCE(v_status, sp.status),
      price_override = CASE WHEN v_cfg ? 'price_override' THEN NULLIF(v_cfg->>'price_override', '')::numeric ELSE sp.price_override END,
      min_stock = CASE WHEN v_cfg ? 'min_stock' THEN NULLIF(v_cfg->>'min_stock', '')::numeric ELSE sp.min_stock END
  WHERE sp.store_id = p_store_id AND sp.product_id = p_product_id
  RETURNING * INTO v_row;

  RETURN QUERY SELECT v_row.status, v_row.price_override, v_row.min_stock, v_created;
END;
$$;
REVOKE ALL ON FUNCTION public._store_product_apply(TEXT, UUID, UUID, JSONB) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.set_store_product(p_product_id UUID, p_config JSONB)
RETURNS TABLE (out_status TEXT, out_price_override NUMERIC, out_min_stock NUMERIC, out_created BOOLEAN)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant_id TEXT := public.current_tenant_id();
  v_device_id UUID;
  v_device public.pos_devices%ROWTYPE;
BEGIN
  IF v_tenant_id IS NULL OR v_tenant_id = '' THEN
    RAISE EXCEPTION 'unauthenticated_or_missing_tenant' USING ERRCODE = '28000';
  END IF;
  v_device_id := NULLIF(auth.jwt() ->> 'device_id', '')::uuid;
  IF v_device_id IS NULL THEN RAISE EXCEPTION 'device_identity_required' USING ERRCODE = '28000'; END IF;
  SELECT * INTO v_device FROM public.pos_devices WHERE id = v_device_id AND tenant_id = v_tenant_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'device_not_found' USING ERRCODE = '28000'; END IF;
  IF v_device.revoked_at IS NOT NULL THEN RAISE EXCEPTION 'device_revoked' USING ERRCODE = '28000'; END IF;
  IF NULLIF(auth.jwt() ->> 'token_version', '')::int IS DISTINCT FROM v_device.token_version THEN
    RAISE EXCEPTION 'device_token_version_mismatch' USING ERRCODE = '28000';
  END IF;
  IF v_device.store_id IS NULL THEN RAISE EXCEPTION 'device_store_missing' USING ERRCODE = '28000'; END IF;
  -- a Store NUNCA vem do cliente: e sempre a do Device
  RETURN QUERY SELECT * FROM public._store_product_apply(v_tenant_id, v_device.store_id, p_product_id, p_config);
END;
$$;
REVOKE ALL ON FUNCTION public.set_store_product(UUID, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_store_product(UUID, JSONB) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_set_store_product(p_tenant_id TEXT, p_store_id UUID, p_product_id UUID, p_config JSONB)
RETURNS TABLE (out_status TEXT, out_price_override NUMERIC, out_min_stock NUMERIC, out_created BOOLEAN)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN QUERY SELECT * FROM public._store_product_apply(p_tenant_id, p_store_id, p_product_id, p_config);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_set_store_product(TEXT, UUID, UUID, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_store_product(TEXT, UUID, UUID, JSONB) TO service_role;
