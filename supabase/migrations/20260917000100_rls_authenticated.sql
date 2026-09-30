-- Etapa 1E.8 — RLS + autorização real do device JWT.
--
-- MODELO (ver relatório da etapa para a análise completa por tabela):
--  - categories/products/customers: BIDIRECTIONAL, baixo risco — GRANT directo
--    (SELECT/INSERT/UPDATE) + RLS tenant-scoped. Sem DELETE (nunca hard delete —
--    secção 10; "apagar" continua a ser uma UPDATE do campo `deleted`/`active`).
--  - users: sensível (pin_hash/role/access_level propaga-se para OUTROS terminais
--    do mesmo tenant via pull) — SELECT directo (RLS), mas INSERT/UPDATE só via
--    `sync_upsert_user` (SECURITY DEFINER), nunca GRANT directo. Sem DELETE.
--  - orders/order_items/stock_movements: SELECT directo (RLS — pull/idempotência/
--    diagnóstico, uso real confirmado em syncService.js), mas ZERO GRANT de
--    escrita — o único caminho de escrita continua `create_order_with_items`.
--  - document_sequences: nenhuma necessidade real de acesso directo encontrada —
--    continua sem GRANT nenhum a `authenticated` (já assim desde 007_sales.sql).
--  - pos_devices/licenses/device_activation_tokens/license_issues: Control Plane,
--    inalterado — zero GRANT a `authenticated`.
--
-- Estratégia de validação do device (secção 12 do pedido) — A para leitura, C para
-- escrita:
--  A) SELECT usa só `current_tenant_id()` (claim do JWT) — sem consultar
--     `pos_devices` por linha/por query. Risco residual aceite: um device revogado
--     mantém leitura até o access token expirar (≤1h) — informação que já lhe
--     pertencia legitimamente enquanto estava íntegro; não é fuga cross-tenant.
--     Um helper que consultasse `pos_devices` a cada SELECT teria custo real por
--     query (secção 25) para mitigar um risco pequeno e já limitado pelo TTL curto.
--  C) Toda a escrita sensível (vendas, users) passa por RPC `SECURITY DEFINER` que
--     JÁ revalida tenant/licença/device a cada chamada (create_order_with_items,
--     Etapa 1E.4/1E.5) — não se repete essa validação em RLS.
-- (B — helper function validando device por linha em toda a RLS — foi considerada
-- e rejeitada: custo por linha sem benefício adicional face a A+C.)

-- =====================================================================================
-- categories / products / customers — GRANT directo + RLS tenant-scoped
-- =====================================================================================
GRANT SELECT, INSERT, UPDATE ON public.categories TO authenticated;
CREATE POLICY categories_select_tenant ON public.categories FOR SELECT USING (tenant_id = public.current_tenant_id());
CREATE POLICY categories_insert_tenant ON public.categories FOR INSERT WITH CHECK (tenant_id = public.current_tenant_id());
CREATE POLICY categories_update_tenant ON public.categories FOR UPDATE
  USING (tenant_id = public.current_tenant_id()) WITH CHECK (tenant_id = public.current_tenant_id());

GRANT SELECT, INSERT, UPDATE ON public.products TO authenticated;
CREATE POLICY products_select_tenant ON public.products FOR SELECT USING (tenant_id = public.current_tenant_id());
CREATE POLICY products_insert_tenant ON public.products FOR INSERT WITH CHECK (tenant_id = public.current_tenant_id());
CREATE POLICY products_update_tenant ON public.products FOR UPDATE
  USING (tenant_id = public.current_tenant_id()) WITH CHECK (tenant_id = public.current_tenant_id());

GRANT SELECT, INSERT, UPDATE ON public.customers TO authenticated;
CREATE POLICY customers_select_tenant ON public.customers FOR SELECT USING (tenant_id = public.current_tenant_id());
CREATE POLICY customers_insert_tenant ON public.customers FOR INSERT WITH CHECK (tenant_id = public.current_tenant_id());
CREATE POLICY customers_update_tenant ON public.customers FOR UPDATE
  USING (tenant_id = public.current_tenant_id()) WITH CHECK (tenant_id = public.current_tenant_id());
-- Nenhuma policy de DELETE em nenhuma das três => DELETE sempre negado (RLS nega
-- por omissão quando não há policy permissiva para o comando).

-- =====================================================================================
-- orders / order_items / stock_movements — SELECT directo, escrita só via RPC
-- =====================================================================================
GRANT SELECT ON public.orders TO authenticated;
CREATE POLICY orders_select_tenant ON public.orders FOR SELECT USING (tenant_id = public.current_tenant_id());

GRANT SELECT ON public.order_items TO authenticated;
CREATE POLICY order_items_select_tenant ON public.order_items FOR SELECT USING (tenant_id = public.current_tenant_id());

GRANT SELECT ON public.stock_movements TO authenticated;
CREATE POLICY stock_movements_select_tenant ON public.stock_movements FOR SELECT USING (tenant_id = public.current_tenant_id());
-- Sem GRANT de INSERT/UPDATE/DELETE nestas três — nem RLS o permitiria de qualquer
-- forma, mas o GRANT é a primeira camada (mais fundamental que a RLS).

-- document_sequences: nenhuma mudança — continua sem GRANT nenhum a authenticated
-- (nenhuma necessidade real de acesso directo encontrada nesta etapa).

-- =====================================================================================
-- users — SELECT directo (RLS), escrita só via sync_upsert_user
-- =====================================================================================
GRANT SELECT ON public.users TO authenticated;
CREATE POLICY users_select_tenant ON public.users FOR SELECT USING (tenant_id = public.current_tenant_id());
-- Sem GRANT de INSERT/UPDATE directo — só a RPC abaixo escreve.

CREATE OR REPLACE FUNCTION public.sync_upsert_user(
  p_id UUID,
  p_name TEXT,
  p_role TEXT,
  p_access_level INTEGER,
  p_pin_hash TEXT,
  p_active BOOLEAN
)
RETURNS TABLE (out_id UUID, out_updated_at TIMESTAMPTZ)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant_id TEXT;
  v_id UUID;
  v_updated_at TIMESTAMPTZ;
BEGIN
  v_tenant_id := public.current_tenant_id();
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'unauthenticated_or_missing_tenant' USING ERRCODE = '28000';
  END IF;
  IF p_id IS NULL THEN
    RAISE EXCEPTION 'id_required' USING ERRCODE = '22023';
  END IF;
  IF NULLIF(btrim(p_name), '') IS NULL THEN
    RAISE EXCEPTION 'name_required' USING ERRCODE = '22023';
  END IF;
  -- Protecção estrutural (secção 16): nunca aceitar um PIN que não pareça hash.
  -- Um bcrypt real tem sempre 60 caracteres; isto não PROVA "é bcrypt" (a
  -- verificação real é isBcryptHash() no código, antes do push — requisito de
  -- integração ainda por implementar), só rejeita o caso óbvio de alguém enviar
  -- um PIN em claro (4-6 dígitos) por engano ou bug.
  IF p_pin_hash IS NULL OR length(p_pin_hash) < 20 THEN
    RAISE EXCEPTION 'pin_hash_must_be_hashed' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.users (id, tenant_id, name, role, access_level, pin_hash, active)
  VALUES (
    p_id, v_tenant_id, btrim(p_name),
    COALESCE(NULLIF(btrim(p_role), ''), 'cashier'),
    COALESCE(p_access_level, 0),
    p_pin_hash,
    COALESCE(p_active, true)
  )
  ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    role = EXCLUDED.role,
    access_level = EXCLUDED.access_level,
    pin_hash = EXCLUDED.pin_hash,
    active = EXCLUDED.active
  -- Estrutural (secção 21/22): só actualiza se a linha em conflito já pertencer ao
  -- MESMO tenant do chamador — nunca "reclama" um id de outro tenant.
  WHERE public.users.tenant_id = v_tenant_id
  RETURNING public.users.id, public.users.updated_at INTO v_id, v_updated_at;

  IF v_id IS NULL THEN
    RAISE EXCEPTION 'user_id_belongs_to_other_tenant' USING ERRCODE = '42501';
  END IF;

  out_id := v_id;
  out_updated_at := v_updated_at;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_upsert_user(UUID, TEXT, TEXT, INTEGER, TEXT, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sync_upsert_user(UUID, TEXT, TEXT, INTEGER, TEXT, BOOLEAN) TO authenticated;
