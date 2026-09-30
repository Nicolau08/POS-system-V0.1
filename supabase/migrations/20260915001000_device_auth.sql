-- Etapa 1E.4 — bloco 010: device_activation_tokens, pos_devices, rate limiting,
-- bootstrap/rotate RPCs.
--
-- REGRA P0 (secção 1 do pedido): o HMAC local (POS_LICENSE_HMAC_SECRET) NÃO é
-- root of trust para bootstrap cloud. Esse HMAC continua a existir só para validação
-- OFFLINE local (fora desta base de dados) — nada aqui o lê ou confia nele. A
-- autoridade para criar um pos_devices vem exclusivamente de um
-- `device_activation_tokens` válido, criado e resolvido só pelo servidor
-- (license-console, com service_role), nunca por algo que o cliente possa forjar.
--
-- Inventário do que já existia (secção 17) — nenhum reaproveitado como root of trust
-- de device bootstrap, todos continuam a servir o seu próprio propósito:
--  - license_vouchers/license_issues/license_reactivation_tokens: NÃO EXISTEM nesta
--    baseline nova ainda (a 1E não os recriou — ver óbvio pendente no relatório).
--    Mesmo que existissem, cada um serve um estágio de vida da LICENÇA (ativação
--    inicial, registo do HMAC emitido, reactivação por voucher) — nenhum foi
--    desenhado para "autorizar este pos_devices específico". Sobrecarregar um deles
--    para isso misturaria duas responsabilidades distintas.
--  - device-activation/serial-activation (endpoints license-console): mesma razão —
--    resolvem/ativam a LICENÇA, não emitem uma credencial de bootstrap de device.
--  Conclusão: nenhum serve; criada uma tabela dedicada e mínima.

CREATE TABLE public.device_activation_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  license_id UUID NOT NULL,
  -- Só o hash é persistido — o valor em claro (CSPRNG >=256 bits, gerado pelo
  -- license-console) é devolvido UMA vez a quem cria a credencial e nunca mais lido.
  token_hash TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  used_by_device_id UUID,
  revoked_at TIMESTAMPTZ,
  CONSTRAINT device_activation_tokens_tenant_license_fkey
    FOREIGN KEY (tenant_id, license_id) REFERENCES public.licenses (tenant_id, id)
);
CREATE INDEX device_activation_tokens_tenant_id_idx ON public.device_activation_tokens (tenant_id);
CREATE INDEX device_activation_tokens_license_id_idx ON public.device_activation_tokens (license_id);

ALTER TABLE public.device_activation_tokens ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.device_activation_tokens FROM PUBLIC, anon, authenticated;


CREATE TABLE public.pos_devices (
  -- UUID v4 gerado no lado confiável (license-console), NUNCA derivado de
  -- machine_id — reinstalação/troca de máquina são conceitos distintos: a mesma
  -- instalação lógica pode manter o mesmo device_id trocando de machine_id (troca
  -- de hardware) e vice-versa (não modelado ainda; fora do escopo desta etapa).
  id UUID PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  license_id UUID NOT NULL,
  machine_id TEXT NOT NULL,
  station_code TEXT,
  refresh_token_hash TEXT NOT NULL,
  refresh_token_expires_at TIMESTAMPTZ NOT NULL,
  refresh_token_last_used_at TIMESTAMPTZ,
  refresh_token_rotated_at TIMESTAMPTZ,
  previous_refresh_token_hash TEXT,
  previous_refresh_valid_until TIMESTAMPTZ,
  -- Excepção deliberada e documentada (ver Etapa 1D): cache de resposta curta para
  -- garantir idempotência real da rotação sob concorrência — nunca um refresh
  -- token "permanente" em claro.
  previous_response_refresh_plaintext TEXT,
  previous_response_access_token TEXT,
  token_version INTEGER NOT NULL DEFAULT 1,
  revoked_at TIMESTAMPTZ,
  revoked_reason TEXT,
  last_seen_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- "device tenant A + license tenant B" estruturalmente impossível.
  CONSTRAINT pos_devices_tenant_license_fkey
    FOREIGN KEY (tenant_id, license_id) REFERENCES public.licenses (tenant_id, id)
);
CREATE INDEX pos_devices_tenant_id_idx ON public.pos_devices (tenant_id);
CREATE INDEX pos_devices_license_id_idx ON public.pos_devices (license_id);
CREATE INDEX pos_devices_refresh_token_hash_idx ON public.pos_devices (refresh_token_hash);
CREATE INDEX pos_devices_previous_refresh_token_hash_idx
  ON public.pos_devices (previous_refresh_token_hash) WHERE previous_refresh_token_hash IS NOT NULL;
-- Deliberadamente NÃO único: reatribuição de estação é normal (ver Etapa 1C/1D).
CREATE INDEX pos_devices_tenant_station_idx ON public.pos_devices (tenant_id, station_code);

CREATE TRIGGER pos_devices_set_updated_at
  BEFORE UPDATE ON public.pos_devices
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.pos_devices ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.pos_devices FROM PUBLIC, anon, authenticated;


CREATE TABLE public.pos_device_auth_rate_limits (
  rate_key TEXT PRIMARY KEY,
  attempt_count INTEGER NOT NULL DEFAULT 1,
  window_started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.pos_device_auth_rate_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.pos_device_auth_rate_limits FROM PUBLIC, anon, authenticated;


-- =====================================================================================
-- bootstrap_pos_device — só chamada pelo backend (license-console, service_role).
-- SECURITY INVOKER (omisso): service_role já contorna RLS/grants por si só (bypassrls
-- da plataforma) — não há razão nenhuma para DEFINER aqui, ao contrário de
-- create_order_with_items (que precisa ser chamável por `authenticated`).
-- =====================================================================================
CREATE OR REPLACE FUNCTION public.bootstrap_pos_device(
  p_activation_token_hash TEXT,
  p_device_id UUID,
  p_machine_id TEXT,
  p_station_code TEXT,
  p_refresh_token_hash TEXT,
  p_refresh_token_expires_at TIMESTAMPTZ
)
RETURNS TABLE (
  out_tenant_id TEXT,
  out_license_id UUID,
  out_device_id UUID,
  out_token_version INTEGER
)
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_activation public.device_activation_tokens%ROWTYPE;
  v_license public.licenses%ROWTYPE;
  v_device_count INTEGER;
BEGIN
  -- Lock da linha da credencial: serializa qualquer tentativa concorrente de a
  -- reivindicar (replay ao mesmo tempo por dois processos nunca "passa duas vezes").
  SELECT * INTO v_activation FROM public.device_activation_tokens
  WHERE token_hash = p_activation_token_hash
  FOR UPDATE;

  IF v_activation.id IS NULL THEN
    RAISE EXCEPTION 'activation_token_not_found' USING ERRCODE = '28000';
  END IF;
  IF v_activation.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'activation_token_revoked' USING ERRCODE = '28000';
  END IF;
  IF v_activation.expires_at <= now() THEN
    RAISE EXCEPTION 'activation_token_expired' USING ERRCODE = '28000';
  END IF;
  IF v_activation.used_at IS NOT NULL THEN
    RAISE EXCEPTION 'activation_token_already_used' USING ERRCODE = '28000';
  END IF;

  -- Lock da linha da licença: serializa bootstraps CONCORRENTES da MESMA licença —
  -- é isto que torna o enforcement de max_devices concurrency-safe (nunca
  -- "SELECT count() depois INSERT" sem lock).
  SELECT * INTO v_license FROM public.licenses
  WHERE id = v_activation.license_id AND tenant_id = v_activation.tenant_id
  FOR UPDATE;

  IF v_license.id IS NULL THEN
    RAISE EXCEPTION 'license_not_found' USING ERRCODE = '28000';
  END IF;
  IF v_license.status = 'suspended' THEN
    RAISE EXCEPTION 'license_suspended' USING ERRCODE = '28000';
  END IF;
  IF v_license.status = 'revoked' THEN
    RAISE EXCEPTION 'license_revoked' USING ERRCODE = '28000';
  END IF;
  IF v_license.expires_at IS NOT NULL AND v_license.expires_at <= now() THEN
    RAISE EXCEPTION 'license_expired' USING ERRCODE = '28000';
  END IF;

  IF v_license.max_devices IS NOT NULL THEN
    SELECT count(*) INTO v_device_count FROM public.pos_devices
    WHERE license_id = v_license.id AND revoked_at IS NULL;
    IF v_device_count >= v_license.max_devices THEN
      RAISE EXCEPTION 'max_devices_reached' USING ERRCODE = '28000';
    END IF;
  END IF;

  UPDATE public.device_activation_tokens
  SET used_at = now(), used_by_device_id = p_device_id
  WHERE id = v_activation.id;

  INSERT INTO public.pos_devices (
    id, tenant_id, license_id, machine_id, station_code,
    refresh_token_hash, refresh_token_expires_at, token_version
  ) VALUES (
    p_device_id, v_activation.tenant_id, v_activation.license_id, p_machine_id, p_station_code,
    p_refresh_token_hash, p_refresh_token_expires_at, 1
  );

  out_tenant_id := v_activation.tenant_id;
  out_license_id := v_activation.license_id;
  out_device_id := p_device_id;
  out_token_version := 1;
  RETURN NEXT;
END;
$$;
REVOKE ALL ON FUNCTION public.bootstrap_pos_device(TEXT, UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;


-- =====================================================================================
-- rotate_pos_device_refresh_token — desenho validado contra Postgres real na Etapa 1D,
-- adaptado ao novo modelo tenant/license: verifica ADICIONALMENTE tenant.status e
-- licenses.status/expires_at a cada rotação (não só no bootstrap) — é aqui que a
-- suspensão/revogação/expiração do tenant/licença se torna efectiva para o refresh
-- (opção A da secção 15; a opção B — verificação a cada venda — fica em
-- create_order_with_items, bloco 011).
-- =====================================================================================
CREATE OR REPLACE FUNCTION public.rotate_pos_device_refresh_token(
  p_presented_hash TEXT,
  p_candidate_new_hash TEXT,
  p_candidate_new_refresh_plaintext TEXT,
  p_candidate_access_token TEXT,
  p_new_expires_at TIMESTAMPTZ,
  p_grace_seconds INTEGER
)
RETURNS TABLE (
  out_device_id UUID,
  out_tenant_id TEXT,
  out_license_id UUID,
  out_station_code TEXT,
  out_token_version INTEGER,
  out_matched_via TEXT,
  out_refresh_token TEXT,
  out_access_token TEXT
)
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_device public.pos_devices%ROWTYPE;
  v_tenant_status TEXT;
  v_license public.licenses%ROWTYPE;
  v_matched_current BOOLEAN;
  v_now TIMESTAMPTZ := now();
BEGIN
  SELECT * INTO v_device FROM public.pos_devices
  WHERE refresh_token_hash = p_presented_hash OR previous_refresh_token_hash = p_presented_hash
  FOR UPDATE;

  IF v_device.id IS NULL THEN
    RAISE EXCEPTION 'device_not_found' USING ERRCODE = '28000';
  END IF;
  IF v_device.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'device_revoked' USING ERRCODE = '28000';
  END IF;

  SELECT status INTO v_tenant_status FROM public.tenants WHERE id = v_device.tenant_id;
  IF v_tenant_status IS NULL OR v_tenant_status <> 'active' THEN
    RAISE EXCEPTION 'tenant_not_active' USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_license FROM public.licenses WHERE id = v_device.license_id;
  IF v_license.id IS NULL THEN
    RAISE EXCEPTION 'license_not_found' USING ERRCODE = '28000';
  END IF;
  IF v_license.status = 'suspended' THEN
    RAISE EXCEPTION 'license_suspended' USING ERRCODE = '28000';
  END IF;
  IF v_license.status = 'revoked' THEN
    RAISE EXCEPTION 'license_revoked' USING ERRCODE = '28000';
  END IF;
  IF v_license.expires_at IS NOT NULL AND v_license.expires_at <= v_now THEN
    RAISE EXCEPTION 'license_expired' USING ERRCODE = '28000';
  END IF;

  v_matched_current := (v_device.refresh_token_hash = p_presented_hash);

  IF v_matched_current THEN
    IF v_device.refresh_token_expires_at < v_now THEN
      RAISE EXCEPTION 'refresh_expired' USING ERRCODE = '28000';
    END IF;

    UPDATE public.pos_devices SET
      previous_refresh_token_hash = refresh_token_hash,
      previous_refresh_valid_until = v_now + make_interval(secs => p_grace_seconds),
      previous_response_refresh_plaintext = p_candidate_new_refresh_plaintext,
      previous_response_access_token = p_candidate_access_token,
      refresh_token_hash = p_candidate_new_hash,
      refresh_token_expires_at = p_new_expires_at,
      refresh_token_rotated_at = v_now,
      refresh_token_last_used_at = v_now,
      last_seen_at = v_now
    WHERE id = v_device.id;

    out_device_id := v_device.id;
    out_tenant_id := v_device.tenant_id;
    out_license_id := v_device.license_id;
    out_station_code := v_device.station_code;
    out_token_version := v_device.token_version;
    out_matched_via := 'current';
    out_refresh_token := p_candidate_new_refresh_plaintext;
    out_access_token := p_candidate_access_token;
    RETURN NEXT;
    RETURN;
  END IF;

  -- Corresponde só ao hash anterior.
  IF v_device.previous_refresh_valid_until IS NULL OR v_device.previous_refresh_valid_until < v_now THEN
    -- Replay fora da janela de graça: devolvido como linha normal (nunca RAISE
    -- EXCEPTION aqui) — um RAISE faria ROLLBACK à própria revogação (bug real
    -- encontrado e corrigido na Etapa 1D; não reintroduzido).
    UPDATE public.pos_devices
    SET revoked_at = v_now, revoked_reason = 'refresh_replay_detected'
    WHERE id = v_device.id;

    out_device_id := v_device.id;
    out_tenant_id := v_device.tenant_id;
    out_license_id := v_device.license_id;
    out_station_code := v_device.station_code;
    out_token_version := v_device.token_version;
    out_matched_via := 'replay_detected';
    out_refresh_token := NULL;
    out_access_token := NULL;
    RETURN NEXT;
    RETURN;
  END IF;

  IF v_device.previous_response_refresh_plaintext IS NULL THEN
    RAISE EXCEPTION 'refresh_cache_missing' USING ERRCODE = '28000';
  END IF;

  UPDATE public.pos_devices SET refresh_token_last_used_at = v_now, last_seen_at = v_now WHERE id = v_device.id;

  out_device_id := v_device.id;
  out_tenant_id := v_device.tenant_id;
  out_license_id := v_device.license_id;
  out_station_code := v_device.station_code;
  out_token_version := v_device.token_version;
  out_matched_via := 'previous_cached';
  out_refresh_token := v_device.previous_response_refresh_plaintext;
  out_access_token := v_device.previous_response_access_token;
  RETURN NEXT;
END;
$$;
REVOKE ALL ON FUNCTION public.rotate_pos_device_refresh_token(TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, INTEGER) FROM PUBLIC, anon, authenticated;


CREATE OR REPLACE FUNCTION public.check_and_increment_rate_limit(
  p_rate_key TEXT,
  p_max_attempts INTEGER,
  p_window_seconds INTEGER
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row public.pos_device_auth_rate_limits%ROWTYPE;
  v_now TIMESTAMPTZ := now();
BEGIN
  SELECT * INTO v_row FROM public.pos_device_auth_rate_limits WHERE rate_key = p_rate_key FOR UPDATE;

  IF v_row.rate_key IS NULL THEN
    INSERT INTO public.pos_device_auth_rate_limits (rate_key, attempt_count, window_started_at)
    VALUES (p_rate_key, 1, v_now);
    RETURN true;
  END IF;

  IF v_now - v_row.window_started_at > make_interval(secs => p_window_seconds) THEN
    UPDATE public.pos_device_auth_rate_limits
    SET attempt_count = 1, window_started_at = v_now, updated_at = v_now
    WHERE rate_key = p_rate_key;
    RETURN true;
  END IF;

  IF v_row.attempt_count >= p_max_attempts THEN
    RETURN false;
  END IF;

  UPDATE public.pos_device_auth_rate_limits
  SET attempt_count = attempt_count + 1, updated_at = v_now
  WHERE rate_key = p_rate_key;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.check_and_increment_rate_limit(TEXT, INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
