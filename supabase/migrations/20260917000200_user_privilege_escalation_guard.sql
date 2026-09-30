-- Etapa 1E.9 — fecha a vulnerabilidade de escalonamento de privilégio provada nesta
-- etapa: um device (identidade de TERMINAL, nunca prova de autoridade humana — ver
-- relatório secção 3) conseguia, com o desenho da Etapa 1E.8, chamar
-- sync_upsert_user e promover qualquer utilizador do seu próprio tenant a
-- role='admin'/access_level>=9, propagando essa promoção para todos os outros
-- terminais no próximo pull.
--
-- Modelo real local confirmado (api/middlewares/auth.js:requireAdmin): só um
-- operador já admin (role='admin' OU access_level>=9) pode criar/editar users.
-- `role` não é um enum independente na UI real — é derivado de access_level
-- (app/management/components/UsersSecurityManager.tsx:425:
-- `role = accessLevel>=9 ? 'admin' : 'user'`) — por isso o guard abaixo trata os
-- dois sinais como equivalentes, tal como o próprio requireAdmin já faz.
--
-- Decisão (opção B refinada, ver relatório secção 4): device pode sincronizar
-- IDENTIDADE (nome/PIN/activo) livremente e pode MANTER/REDUZIR privilégio já
-- existente, mas NUNCA pode CONCEDER privilégio elevado novo via este canal —
-- nem para um utilizador novo, nem promovendo um existente. Só preserva o que já
-- estava gravado na cloud como elevado (ex.: o próprio admin a sincronizar o seu
-- PIN). Isto fecha a escalação sem depender de infra-estrutura de assinatura
-- nova — não é prova de autoria humana (fora do escopo desta etapa "pequena"),
-- só remove a via de escalonamento através do canal de sync.

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
  v_requested_elevated BOOLEAN;
  v_existing_elevated BOOLEAN;
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

  -- PIN: bcrypt REAL — mesma regex de api/pinAuth.js:isBcryptHash() (Node bcrypt
  -- v6, prefixo $2a$/$2b$/$2y$, 60 caracteres). `length >= 20` (1E.8) era
  -- insuficiente — qualquer string comprida passava. Confirmado contra um hash
  -- real gerado pelo POS: $2b$10$..., 60 chars.
  IF p_pin_hash IS NULL OR p_pin_hash !~ '^\$2[aby]\$[0-9]{2}\$[./A-Za-z0-9]{53}$' THEN
    RAISE EXCEPTION 'pin_hash_must_be_bcrypt' USING ERRCODE = '22023';
  END IF;

  -- Guard de escalonamento de privilégio (secção 1/4/9 do pedido).
  v_requested_elevated := (COALESCE(p_access_level, 0) >= 9) OR (lower(COALESCE(p_role, '')) = 'admin');
  IF v_requested_elevated THEN
    SELECT (u.access_level >= 9 OR lower(u.role) = 'admin')
    INTO v_existing_elevated
    FROM public.users u
    WHERE u.id = p_id AND u.tenant_id = v_tenant_id;

    IF COALESCE(v_existing_elevated, false) = false THEN
      -- Nem utilizador novo com privilégio elevado, nem promoção de um existente
      -- — só é permitido re-sincronizar (preservar) um que já estava elevado.
      RAISE EXCEPTION 'privilege_escalation_denied' USING ERRCODE = '42501';
    END IF;
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
