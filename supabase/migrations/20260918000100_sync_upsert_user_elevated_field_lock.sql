-- Etapa 1F.6.1 — fecha o P1 encontrado na 1F.6: o guard de escalonamento de
-- privilégio da Etapa 1E.9 (sync_upsert_user) impede CRIAR/PROMOVER um
-- utilizador elevado (access_level>=9 ou role='admin'), mas para um
-- utilizador que JÁ é elevado deixava passar QUALQUER alteração — incluindo
-- pin_hash, role e access_level — sem nenhuma restrição adicional. Um Device
-- JWT válido (identidade de TERMINAL, nunca prova de autoridade humana)
-- conseguia por isso reescrever o PIN de um admin existente, ou rebaixá-lo,
-- via este canal.
--
-- Política escolhida (secção 1 do pedido 1F.6.1, F: "FAIL ou downgrade
-- conforme política explicitamente escolhida" — escolhida FAIL, não
-- downgrade-only, por ser mais simples de raciocinar/testar e por fechar
-- também o risco de um device desactivar a autoridade de um admin via
-- downgrade):
--
--   Para um utilizador alvo que JÁ é elevado (access_level>=9 OU
--   role='admin') na BD:
--     - role, access_level, pin_hash tornam-se IMUTÁVEIS por esta RPC —
--       qualquer pedido que tente mudar QUALQUER um destes três campos face
--       ao valor já gravado FALHA com 'elevated_user_protected_field'.
--     - name e active continuam a sincronizar livremente (identidade
--       cosmética / disponibilidade — não concedem nem retiram autoridade a
--       ninguém).
--     - Um re-sync idempotente que reenvie exactamente os MESMOS
--       role/access_level/pin_hash já gravados continua a passar em
--       silêncio (nunca quebra o fluxo normal de sync de um admin que
--       sincroniza o seu próprio registo sem alterações).
--
-- Para um utilizador alvo NÃO elevado, o comportamento é EXACTAMENTE o
-- mesmo de antes (Etapa 1E.9) — sem alterações.

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
  v_existing_role TEXT;
  v_existing_access_level INTEGER;
  v_existing_pin_hash TEXT;
  v_found BOOLEAN;
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
  -- v6, prefixo $2a$/$2b$/$2y$, 60 caracteres).
  IF p_pin_hash IS NULL OR p_pin_hash !~ '^\$2[aby]\$[0-9]{2}\$[./A-Za-z0-9]{53}$' THEN
    RAISE EXCEPTION 'pin_hash_must_be_bcrypt' USING ERRCODE = '22023';
  END IF;

  SELECT true, u.role, u.access_level, u.pin_hash
  INTO v_found, v_existing_role, v_existing_access_level, v_existing_pin_hash
  FROM public.users u
  WHERE u.id = p_id AND u.tenant_id = v_tenant_id;
  v_existing_elevated := COALESCE(v_found, false)
    AND (COALESCE(v_existing_access_level, 0) >= 9 OR lower(COALESCE(v_existing_role, '')) = 'admin');

  -- Guard de escalonamento de privilégio (Etapa 1E.9, inalterado): nem
  -- utilizador novo nem promoção de um existente não-elevado pode pedir
  -- privilégio elevado.
  v_requested_elevated := (COALESCE(p_access_level, 0) >= 9) OR (lower(COALESCE(p_role, '')) = 'admin');
  IF v_requested_elevated AND NOT v_existing_elevated THEN
    RAISE EXCEPTION 'privilege_escalation_denied' USING ERRCODE = '42501';
  END IF;

  -- NOVO (Etapa 1F.6.1): para um alvo JÁ elevado, role/access_level/pin_hash
  -- ficam imutáveis por esta RPC — só passa se pedir exactamente os mesmos
  -- valores já gravados (re-sync idempotente) ou se o alvo nunca foi elevado.
  IF v_existing_elevated THEN
    IF lower(COALESCE(p_role, '')) IS DISTINCT FROM lower(COALESCE(v_existing_role, ''))
       OR COALESCE(p_access_level, 0) IS DISTINCT FROM COALESCE(v_existing_access_level, 0)
       OR p_pin_hash IS DISTINCT FROM v_existing_pin_hash
    THEN
      RAISE EXCEPTION 'elevated_user_protected_field' USING ERRCODE = '42501';
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
