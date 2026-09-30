-- Etapa 1G.4 Fase 3C.1 — Backoffice Stock: consulta + entrada.
--
-- LEITURA: stock_movements/warehouses só tinham policy Device (current_tenant_id()/
-- current_store_id(), claims do JWT do Device — nunca presentes numa sessão humana).
-- Acrescento policies ADITIVAS do Backoffice (backoffice_current_tenant_id() +
-- backoffice_can_access_store()), nunca alterando as do Device. warehouse_stock é uma
-- VIEW "WITH (security_invoker = true)" sobre stock_movements (SUM(quantity) GROUP BY —
-- ver 20260920000100) — herda a RLS da tabela por baixo, por isso a policy nova em
-- stock_movements já chega para a view ficar visível ao Backoffice, sem policy própria.
--
-- ESCRITA: sem GRANT de INSERT nenhum em stock_movements (mantém-se: mesmo o Device só
-- escreve via RPC SECURITY DEFINER — sync_stock_movements — nunca por GRANT directo,
-- ver 20260917000100 "escrita só via RPC"). Sigo a MESMA disciplina para o Backoffice,
-- em vez de abrir um GRANT directo (que seria uma protecção MENOR que a do Device para
-- a tabela mais sensível do schema): nova RPC backoffice_create_stock_movement,
-- SECURITY DEFINER, que valida Tenant/Store/Warehouse/Produto e escreve type='restock'
-- SEMPRE hardcoded (Fase 3C.1 não inclui ajuste/contagem nem transferências — nunca um
-- parâmetro `type`, para o scope ficar imposto no servidor, não só na UI) e
-- device_id=NULL (o pull da Fase 1 já sabe aplicar isto exactamente uma vez — CASO 3).
-- Idempotência pelo MESMO mecanismo já existente: UNIQUE(tenant_id, product_id, type,
-- reference_id) em stock_movements — reference_id = 'backoffice:' + chave de
-- idempotência fornecida pelo cliente (gerada uma vez por submissão, nunca reutilizada
-- entre entradas distintas) — nunca um id do payload a controlar a linha inserida.
--
-- Sem "referência/observação" livre: stock_movements não tem nenhuma coluna de texto
-- livre (nem para o Device) — não se inventa uma agora (mesma disciplina de
-- customers/suppliers: nada sem evidência). "Referência" aqui é só a chave de
-- idempotência (visível como reference_id), não um campo de notas.

CREATE POLICY warehouses_select_backoffice ON public.warehouses
  FOR SELECT USING (tenant_id = public.backoffice_current_tenant_id() AND public.backoffice_can_access_store(store_id));

CREATE POLICY stock_movements_select_backoffice ON public.stock_movements
  FOR SELECT USING (tenant_id = public.backoffice_current_tenant_id() AND public.backoffice_can_access_store(store_id));

CREATE OR REPLACE FUNCTION public.backoffice_create_stock_movement(
  p_store_id UUID,
  p_warehouse_id UUID,
  p_product_id UUID,
  p_quantity NUMERIC,
  p_idempotency_key TEXT
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
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'quantity_must_be_positive' USING ERRCODE = '22023';
  END IF;
  IF p_idempotency_key IS NULL OR btrim(p_idempotency_key) = '' THEN
    RAISE EXCEPTION 'idempotency_key_required' USING ERRCODE = '22023';
  END IF;

  v_reference_id := 'backoffice:' || btrim(p_idempotency_key);

  -- o produto passa a existir na Store (mesmo efeito colateral que sync_stock_movements
  -- já tem para o Device — nunca reactiva um descontinuado, só cria se faltar).
  INSERT INTO public.store_products (tenant_id, store_id, product_id)
  VALUES (v_tenant_id, p_store_id, p_product_id)
  ON CONFLICT (store_id, product_id) DO NOTHING;

  INSERT INTO public.stock_movements (tenant_id, store_id, warehouse_id, product_id, type, quantity, reference_id, device_id)
  VALUES (v_tenant_id, p_store_id, p_warehouse_id, p_product_id, 'restock', p_quantity, v_reference_id, NULL)
  ON CONFLICT (tenant_id, product_id, type, reference_id) DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NOT NULL THEN
    RETURN QUERY SELECT v_id, 'inserted'::text;
    RETURN;
  END IF;

  SELECT * INTO v_existing FROM public.stock_movements m
  WHERE m.tenant_id = v_tenant_id AND m.product_id = p_product_id AND m.type = 'restock' AND m.reference_id = v_reference_id;
  IF v_existing.store_id = p_store_id AND v_existing.warehouse_id = p_warehouse_id AND v_existing.quantity = p_quantity THEN
    RETURN QUERY SELECT v_existing.id, 'duplicate'::text;
    RETURN;
  END IF;
  RAISE EXCEPTION 'movement_conflict' USING ERRCODE = '23505';
END;
$$;
REVOKE ALL ON FUNCTION public.backoffice_create_stock_movement(UUID, UUID, UUID, NUMERIC, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.backoffice_create_stock_movement(UUID, UUID, UUID, NUMERIC, TEXT) TO authenticated;
