-- Etapa 1G.4 Fase 9 — Gestão de Utilizadores do Backoffice (owner cria/gere utilizadores
-- do seu próprio Tenant). Reutiliza integralmente o modelo da Fase 8: novo utilizador
-- nasce com requires_first_access=true + must_change_password=true + sem recovery_email
-- — segue exactamente o mesmo fluxo /first-access já construído (password -> email de
-- recuperação -> verificação), sem qualquer alteração a esse código.
--
-- Identidade Auth interna DETERMINÍSTICA aqui (diferente da Fase 8/License Console, que
-- usa um email aleatório): sha256(tenant_id || ':' || lower(username)) — permite
-- recuperar um Auth user órfão num retry (admin.createUser volta a falhar com "already
-- registered" para o MESMO username, e esse erro é o sinal para ir buscar o id existente
-- em vez de criar um duplicado). Isto é seguro porque o email nunca é a credencial real
-- (a password é) e nunca é mostrado a ninguém — só um identificador interno do GoTrue.
-- A License Console mantém o seu email aleatório (aprovado/fechado na Fase 8) porque é
-- uma operação de baixíssima frequência (1 vez por Tenant); esta é potencialmente mais
-- frequente (cada novo funcionário), por isso justifica a robustez extra do retry.

-- Owners passam a poder listar TODOS os utilizadores/atribuições do seu Tenant (não só a
-- própria linha) — aditivo, a policy "self select only" da Fase 2 continua intacta para
-- quem não é owner.
CREATE POLICY backoffice_users_select_owner ON public.backoffice_users
  FOR SELECT USING (tenant_id = public.backoffice_current_tenant_id() AND public.backoffice_current_role() = 'owner');
CREATE POLICY backoffice_user_stores_select_owner ON public.backoffice_user_stores
  FOR SELECT USING (tenant_id = public.backoffice_current_tenant_id() AND public.backoffice_current_role() = 'owner');

-- Só service_role (nunca authenticated) — usada pelo Route Handler para recuperar o id de
-- um Auth user órfão de uma tentativa anterior falhada, dado o email interno determinístico.
CREATE OR REPLACE FUNCTION public.backoffice_lookup_internal_auth_user(p_email TEXT)
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT id FROM auth.users WHERE email = p_email LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.backoffice_lookup_internal_auth_user(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.backoffice_lookup_internal_auth_user(TEXT) TO service_role;

-- Cria a membership (backoffice_users + backoffice_user_stores) para um Auth user já
-- criado pelo Route Handler (Admin API não corre em SQL). SECURITY DEFINER: só owner
-- activo, só do PRÓPRIO tenant (nunca do cliente), advisory lock por (tenant,username)
-- torna a verificação de duplicado + insert atómica mesmo sob concorrência real — a
-- UNIQUE(tenant_id, lower(username)) já existente continua como backstop final.
CREATE OR REPLACE FUNCTION public.backoffice_create_user(
  p_auth_user_id UUID,
  p_auth_internal_email TEXT,
  p_username TEXT,
  p_role TEXT,
  p_store_ids UUID[] DEFAULT '{}'
)
RETURNS TABLE (out_user_id UUID)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant_id TEXT;
  v_store_id UUID;
BEGIN
  IF public.backoffice_current_role() IS DISTINCT FROM 'owner' THEN
    RAISE EXCEPTION 'only_owner_can_manage_users' USING ERRCODE = '42501';
  END IF;
  v_tenant_id := public.backoffice_current_tenant_id();
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'unauthenticated_or_no_access' USING ERRCODE = '28000';
  END IF;
  IF p_role NOT IN ('owner', 'store_operator') THEN
    RAISE EXCEPTION 'invalid_role' USING ERRCODE = '22023';
  END IF;
  IF p_username IS NULL OR btrim(p_username) = '' THEN
    RAISE EXCEPTION 'username_required' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_tenant_id || ':user:' || lower(p_username), 0));

  IF EXISTS (SELECT 1 FROM public.backoffice_users WHERE tenant_id = v_tenant_id AND lower(username) = lower(p_username)) THEN
    RAISE EXCEPTION 'username_already_exists' USING ERRCODE = '23505';
  END IF;

  INSERT INTO public.backoffice_users (user_id, tenant_id, role, status, username, auth_internal_email, requires_first_access, must_change_password)
  VALUES (p_auth_user_id, v_tenant_id, p_role, 'active', p_username, p_auth_internal_email, true, true);

  IF p_role = 'store_operator' AND p_store_ids IS NOT NULL THEN
    FOREACH v_store_id IN ARRAY p_store_ids LOOP
      IF NOT EXISTS (SELECT 1 FROM public.stores s WHERE s.id = v_store_id AND s.tenant_id = v_tenant_id) THEN
        RAISE EXCEPTION 'store_not_in_tenant' USING ERRCODE = '42501';
      END IF;
      INSERT INTO public.backoffice_user_stores (user_id, store_id, tenant_id) VALUES (p_auth_user_id, v_store_id, v_tenant_id);
    END LOOP;
  END IF;

  RETURN QUERY SELECT p_auth_user_id;
END;
$$;
REVOKE ALL ON FUNCTION public.backoffice_create_user(UUID, TEXT, TEXT, TEXT, UUID[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.backoffice_create_user(UUID, TEXT, TEXT, TEXT, UUID[]) TO authenticated;

-- Activar/desactivar. Nunca a própria linha (auto-lockout/auto-promoção); nunca o
-- último owner activo do tenant (protecção contra Tenant sem administrador nenhum).
CREATE OR REPLACE FUNCTION public.backoffice_set_user_status(p_user_id UUID, p_status TEXT)
RETURNS TABLE (out_user_id UUID, out_status TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant_id TEXT;
  v_target public.backoffice_users%ROWTYPE;
  v_other_active_owners INT;
BEGIN
  IF public.backoffice_current_role() IS DISTINCT FROM 'owner' THEN
    RAISE EXCEPTION 'only_owner_can_manage_users' USING ERRCODE = '42501';
  END IF;
  v_tenant_id := public.backoffice_current_tenant_id();
  IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'unauthenticated_or_no_access' USING ERRCODE = '28000'; END IF;
  IF p_status NOT IN ('active', 'disabled') THEN RAISE EXCEPTION 'invalid_status' USING ERRCODE = '22023'; END IF;
  IF p_user_id = auth.uid() THEN RAISE EXCEPTION 'cannot_change_own_status' USING ERRCODE = '42501'; END IF;

  SELECT * INTO v_target FROM public.backoffice_users WHERE user_id = p_user_id AND tenant_id = v_tenant_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'user_not_in_tenant' USING ERRCODE = '42501'; END IF;

  IF p_status = 'disabled' AND v_target.role = 'owner' AND v_target.status = 'active' THEN
    -- Sem este lock, dois owners a desactivarem-se um ao outro em simultâneo podiam
    -- ambos ler "ainda há outro owner activo" ANTES de qualquer um confirmar — e o
    -- Tenant ficava sem nenhum owner activo. Serializa por tenant (só quando a
    -- contagem de owners está mesmo em jogo, nunca para desactivar um store_operator).
    PERFORM pg_advisory_xact_lock(hashtextextended(v_tenant_id || ':owner_status', 0));
    SELECT count(*) INTO v_other_active_owners
    FROM public.backoffice_users
    WHERE tenant_id = v_tenant_id AND role = 'owner' AND status = 'active' AND user_id <> p_user_id;
    IF v_other_active_owners = 0 THEN
      RAISE EXCEPTION 'last_owner_protected' USING ERRCODE = '42501';
    END IF;
  END IF;

  UPDATE public.backoffice_users SET status = p_status WHERE user_id = p_user_id;
  RETURN QUERY SELECT p_user_id, p_status;
END;
$$;
REVOKE ALL ON FUNCTION public.backoffice_set_user_status(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.backoffice_set_user_status(UUID, TEXT) TO authenticated;

-- Substitui o conjunto de Stores atribuídas a um store_operator (delete+insert atómico
-- dentro da própria função). Não aplicável a owner (acesso já é ao tenant inteiro).
CREATE OR REPLACE FUNCTION public.backoffice_set_user_stores(p_user_id UUID, p_store_ids UUID[])
RETURNS TABLE (out_user_id UUID, out_store_count INT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant_id TEXT;
  v_target public.backoffice_users%ROWTYPE;
  v_store_id UUID;
  v_count INT := 0;
BEGIN
  IF public.backoffice_current_role() IS DISTINCT FROM 'owner' THEN
    RAISE EXCEPTION 'only_owner_can_manage_users' USING ERRCODE = '42501';
  END IF;
  v_tenant_id := public.backoffice_current_tenant_id();
  IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'unauthenticated_or_no_access' USING ERRCODE = '28000'; END IF;

  SELECT * INTO v_target FROM public.backoffice_users WHERE user_id = p_user_id AND tenant_id = v_tenant_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'user_not_in_tenant' USING ERRCODE = '42501'; END IF;
  IF v_target.role <> 'store_operator' THEN RAISE EXCEPTION 'owner_has_all_stores' USING ERRCODE = '22023'; END IF;

  DELETE FROM public.backoffice_user_stores WHERE user_id = p_user_id;
  IF p_store_ids IS NOT NULL THEN
    FOREACH v_store_id IN ARRAY p_store_ids LOOP
      IF NOT EXISTS (SELECT 1 FROM public.stores s WHERE s.id = v_store_id AND s.tenant_id = v_tenant_id) THEN
        RAISE EXCEPTION 'store_not_in_tenant' USING ERRCODE = '42501';
      END IF;
      INSERT INTO public.backoffice_user_stores (user_id, store_id, tenant_id) VALUES (p_user_id, v_store_id, v_tenant_id);
      v_count := v_count + 1;
    END LOOP;
  END IF;

  RETURN QUERY SELECT p_user_id, v_count;
END;
$$;
REVOKE ALL ON FUNCTION public.backoffice_set_user_stores(UUID, UUID[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.backoffice_set_user_stores(UUID, UUID[]) TO authenticated;
